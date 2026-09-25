/**
 * FIX-251 验证：明细账页 mock 单科目 N 行分录（默认 100,000），真实 Chromium 渲染，
 * 统计：首屏出表耗时、最长 longtask、DOM 行数、JS 堆。对应压测报告 §四 #1/#2。
 *   node scratch/detailRenderPerf.mjs [--rows=100000]
 * 需 3105 / 5275 已启动。
 */
import { chromium } from '@playwright/test'
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--(\w+)=(.+)$/); return m ? [m[1], Number(m[2])] : [a, true] }))
const ROWS = args.rows || 100000
const API = 'http://localhost:3105', WEB = 'http://localhost:5275'

const sets = (await (await fetch(`${API}/api/auth/account-sets`)).json()).data
const asid = (sets.find(s => s.name.includes('云霞')) || sets[0]).id
const lr = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: asid }) })).json()
if (!lr.token) throw new Error('登录失败 ' + JSON.stringify(lr))

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
await page.goto(WEB + '/')
await page.evaluate(({ token, asid }) => { localStorage.setItem('token', token); localStorage.setItem('accountSetId', asid); localStorage.removeItem('ledger_detail_display_page_size') }, { token: lr.token, asid })

// mock 明细账接口：按 page/pageSize 切片返回
await page.route('**/api/ledger/detail?**', route => {
  const u = new URL(route.request().url())
  const p = Number(u.searchParams.get('page') || 1), ps = Number(u.searchParams.get('pageSize') || 10000)
  const start = (p - 1) * ps, end = Math.min(ROWS, start + ps)
  const data = []
  for (let i = start; i < end; i++) {
    const m = String(1 + Math.floor(i / (ROWS / 12))).padStart(2, '0')
    data.push({ id: 'e' + i, voucher_id: 'v' + i, voucher_date: `2026-${m}-15`, voucher_no: String(i + 1), voucher_type_name: '记', summary: '模拟摘要 ' + i, opposite_accounts: '1002 银行存款', direction: i % 2 ? 'credit' : 'debit', amount: 100 + (i % 900), status: 'posted' })
  }
  route.fulfill({ json: { code: 0, data, total: ROWS, initBalance: 1000 } })
})

await page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] }) })
const t0 = Date.now()
// 页面挂载时自动选中首个科目并查询，直接从导航开始计时
await page.goto(WEB + '/ledger/detail')
const dialog = page.locator('.el-message-box')
try { await dialog.waitFor({ timeout: 8000 }); console.log('确认框:', (await dialog.locator('.el-message-box__message').innerText()).slice(0, 90)); await dialog.locator('.el-button--primary').click() } catch { console.log('未出现确认框（total ≤ 阈值）') }
await page.waitForFunction(() => document.querySelectorAll('.page-ledger .el-table__body tr').length > 10, null, { timeout: 120000 })
const firstPaint = Date.now() - t0
await page.waitForTimeout(1500)
const stat = await page.evaluate(() => ({
  domRows: document.querySelectorAll('.page-ledger .el-table__body tr').length,
  longest: Math.max(0, ...window.__lt), longtasks: window.__lt.length,
  heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  totalTip: document.querySelector('.total-tip')?.textContent, pager: document.querySelector('.pagination .el-pagination') ? '有' : '无',
}))
console.log(`行数 ${ROWS.toLocaleString()}：首屏出表 ${firstPaint}ms，DOM 行 ${stat.domRows}，最长长任务 ${stat.longest}ms（共 ${stat.longtasks} 个），JS 堆 ${stat.heapMB}MB，${stat.totalTip}，分页器${stat.pager}`)

// 翻页与切页大小的响应
await page.evaluate(() => { window.__lt = [] })
const t1 = Date.now(); await page.click('.pagination .btn-next'); await page.waitForTimeout(800)
const s2 = await page.evaluate(() => ({ rows: document.querySelectorAll('.page-ledger .el-table__body tr').length, longest: Math.max(0, ...window.__lt), page: document.querySelector('.pagination .el-pager .is-active')?.textContent }))
console.log(`翻到第 ${s2.page} 页：${Date.now() - t1}ms，DOM 行 ${s2.rows}，最长长任务 ${s2.longest}ms`)
await page.screenshot({ path: 'scratch/tmp/detail-100k.png' })
await browser.close()
