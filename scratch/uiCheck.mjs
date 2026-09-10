import { chromium } from 'playwright'
import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'

const setId = '96e41c72-0699-45b0-ad49-35048b1e875e'
const db = new Database('./data/finance-0523.db', { readonly: true })
const admin = db.prepare("SELECT id,username,role_id FROM users WHERE account_set_id=? AND username='admin'").get(setId)
const session = db
  .prepare("SELECT id FROM user_login_sessions WHERE user_id=? AND account_set_id=? AND status='active' ORDER BY last_seen_at DESC LIMIT 1")
  .get(admin.id, setId)
const token = jwt.sign(
  { userId: admin.id, userName: admin.username, accountSetId: setId, roleId: admin.role_id, sessionId: session?.id, remember: true },
  'your-secret-key-change-this-in-production',
  { expiresIn: '30m' }
)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.type(), m.text().slice(0, 300)) })
page.on('pageerror', e => console.log('[pageerror]', e.message))
page.on('response', async r => {
  if (r.url().includes('/api/voucher/vouchers')) {
    let body = ''
    try { body = (await r.text()).slice(0, 200) } catch {}
    console.log('[api]', r.status(), r.url().replace('http://localhost:5275', ''), body)
  }
})
await page.goto('http://localhost:5275/login')
await page.evaluate(({ token, setId }) => {
  localStorage.setItem('token', token)
  localStorage.setItem('accountSetId', setId)
}, { token, setId })
await page.goto('http://localhost:5275/voucher/entry')
await page.waitForTimeout(6000)
const layout = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return sel + ': null'
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return `${sel} => h=${Math.round(r.height)} w=${Math.round(r.width)} top=${Math.round(r.top)} display=${cs.display} overflow=${cs.overflow} height=${cs.height} maxH=${cs.maxHeight} minH=${cs.minHeight} flex=${cs.flex} pos=${cs.position}`
  }
  return [
    '.page', '.voucher-list-page', '.voucher-list-main', '.draft-card', '.draft-card .el-card__body',
    '.gl-entry-table', '.gl-entry-table .el-table__inner-wrapper', '.gl-entry-table .el-table__header-wrapper',
    '.gl-entry-table .el-table__body-wrapper', '.gl-entry-table .el-scrollbar', '.gl-entry-table .el-scrollbar__wrap',
    '.gl-entry-table .el-table__body', '.gl-entry-table .el-table__body tr', '.draft-pagination',
  ].map(pick).join('\n')
})
console.log(layout)
const matched = await page.evaluate(() => {
  const targets = [
    ['.voucher-list-main', ['flex', 'flex-grow', 'height', 'min-height', 'max-height', 'overflow']],
    ['.gl-entry-table', ['height', 'max-height', 'flex', 'min-height']],
    ['.draft-card .el-card__body', ['flex', 'height', 'min-height']],
  ]
  const out = []
  for (const [sel, propsWanted] of targets) {
    const el = document.querySelector(sel)
    if (!el) continue
    out.push(`## ${sel} inline style="${el.getAttribute('style') || ''}"`)
    for (const sheet of Array.from(document.styleSheets)) {
      let rules = []
      try { rules = Array.from(sheet.cssRules || []) } catch { continue }
      const walk = (list, media) => {
        for (const r of list) {
          if (r.cssRules && r.conditionText !== undefined) { walk(Array.from(r.cssRules), r.conditionText); continue }
          if (!r.selectorText) continue
          let hit = false
          try { hit = el.matches(r.selectorText) } catch { continue }
          if (!hit) continue
          const decl = propsWanted.filter(p => r.style.getPropertyValue(p)).map(p => `${p}:${r.style.getPropertyValue(p)}${r.style.getPropertyPriority(p) ? ' !important' : ''}`)
          if (decl.length) out.push(`  [${media || 'base'}] ${r.selectorText.slice(0, 160)} { ${decl.join('; ')} }`)
        }
      }
      walk(rules)
    }
  }
  return out.join('\n')
})
console.log(matched)
const chain = await page.evaluate(() => {
  let el = document.querySelector('.voucher-list-main')
  const parts = []
  while (el && parts.length < 8) {
    const cs = getComputedStyle(el)
    parts.push(`${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')} [display=${cs.display} flex=${cs.flex} h=${Math.round(el.getBoundingClientRect().height)}]`)
    el = el.parentElement
  }
  return parts.join('\n  <- ')
})
console.log('CHAIN', chain)
const siblings = await page.evaluate(() => Array.from(document.querySelector('.voucher-list-page').children).map(c => `${c.tagName.toLowerCase()}.${Array.from(c.classList).join('.')} h=${Math.round(c.getBoundingClientRect().height)}`).join(' | '))
console.log('SIBLINGS', siblings)
const sel = await page.evaluate(() => {
  const el = document.querySelector('.voucher-list-main')
  const tests = [
    '.page > .voucher-list-main',
    '.main .page.voucher-list-page > .el-card:has(.el-table)',
    '.page:not(.voucher-list-page) > .el-card:has(.el-table)',
  ]
  const res = tests.map(t => { try { return `${t} => ${el.matches(t)}` } catch (e) { return `${t} => ERR ${e.message}` } })
  // is the rule present in any loaded sheet?
  let found = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = []
    try { rules = Array.from(sheet.cssRules || []) } catch { continue }
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes('.voucher-list-main')) found.push(`${(sheet.href || sheet.ownerNode?.getAttribute?.('data-vite-dev-id') || 'inline').split('/').slice(-2).join('/')}: ${r.selectorText.slice(0, 120)} {${r.style.cssText.slice(0, 80)}}`)
    }
  }
  return res.concat(['--- rules mentioning .voucher-list-main:'], found).join('\n')
})
console.log('SELECTORS\n' + sel)
const sheets = await page.evaluate(() => {
  return Array.from(document.styleSheets).map(s => {
    let n = -1, last = ''
    try { n = s.cssRules.length; const r = s.cssRules[n - 1]; last = (r?.selectorText || r?.cssText || '').slice(0, 80) } catch {}
    const id = s.href || s.ownerNode?.getAttribute?.('data-vite-dev-id') || 'inline'
    return `${id.split('/').slice(-3).join('/')} rules=${n} last=${last}`
  }).filter(x => /common|styles\.css|apple|Layout|voucher/.test(x)).join('\n')
})
console.log('SHEETS\n' + sheets)
const commonScan = await page.evaluate(() => {
  const s = Array.from(document.styleSheets).find(s => (s.ownerNode?.getAttribute?.('data-vite-dev-id') || '').includes('styles/common.css'))
  if (!s) return 'common.css sheet NOT FOUND'
  const rules = Array.from(s.cssRules)
  const idx = rules.findIndex(r => r.selectorText && r.selectorText.includes('voucher-list-main'))
  const big = rules.map((r, i) => [i, (r.cssText || '').length]).filter(([, l]) => l > 5000)
  return `rules=${rules.length} idxVoucherListMain=${idx} bigRules=${JSON.stringify(big)} first=${rules[0]?.cssText.slice(0, 100)} rule10=${rules[10]?.selectorText}`
})
console.log('COMMON', commonScan)
const rows = await page.locator('.gl-entry-table .el-table__body tr').count()
const empty = await page.locator('.gl-entry-table .el-table__empty-text').count()
const info = await page.locator('.draft-pagination__text').first().textContent().catch(() => null)
console.log('url', page.url(), 'rows', rows, 'emptyText', empty, 'info', info)
await page.screenshot({ path: 'scratch/entry.png', fullPage: false })
await browser.close()
