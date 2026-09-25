/**
 * 2026-09-25 总账 + 固定资产 + 出纳评审修复：浏览器全流程回归
 *
 * 在真实页面上走一遍本次修复涉及的操作，逐步截图（test-results/review-20260925/*.png）。
 * 用例自建的数据（资产卡片、出纳流水、出纳凭证）在 afterAll 中全部清理，不改动账套原有数据。
 */
import { test, expect, apiHeaders, API_BASE } from './fixtures'
import type { APIRequestContext, Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const SHOT_DIR = 'test-results/review-20260925'
const TAG = 'E2E评审回归'
// 弹窗 / 消息条有 ~300ms 过渡动画，稍等再截图，避免截到半透明画面
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false })
}

let H: Record<string, string>
const created = { cards: [] as string[], journals: [] as string[] }

async function api(request: APIRequestContext, method: 'get' | 'post' | 'put' | 'delete', path: string, data?: unknown) {
  const res = await request.fetch(`${API_BASE}/api${path}`, { method, headers: H, data })
  let body: any = null
  try { body = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status(), body }
}

test.beforeAll(async ({ request }) => {
  H = await apiHeaders(request)
})

test.afterAll(async ({ request }) => {
  for (const id of created.journals) {
    // 先按勾选行删凭证（若还在），再删流水
    await api(request, 'post', '/cashier/delete-vouchers', { account_code: '1001', ids: [id] })
    await api(request, 'delete', `/cashier/journal/${id}`)
  }
  for (const id of created.cards) await api(request, 'delete', `/asset/cards/${id}`)
})

// ── 固定资产 ──────────────────────────────────────────────

test('资产列表：筛选控件可用，按编号筛出目标卡片（FIX-303）', async ({ loggedInPage: page }) => {
  await page.goto('/asset/list')
  const kw = page.getByPlaceholder('编号 / 名称')
  await expect(kw).toBeVisible()
  // el-select 的占位是文字节点而非 input placeholder
  for (const ph of ['资产类别', '使用状态', '使用部门']) {
    await expect(page.locator('.list-toolbar .el-select', { hasText: ph })).toBeVisible()
  }
  await kw.fill('ZCTEST02')
  await kw.press('Enter')
  await expect(page.locator('.el-table__body tr').first()).toContainText('ZCTEST02')
  await expect(page.locator('.el-table__body tr')).toHaveCount(1)
  await shot(page, '01-资产列表筛选')
})

test('有折旧记录的卡片：编辑时原值 / 累计折旧置灰并提示（FIX-277）', async ({ loggedInPage: page }) => {
  await page.goto('/asset/list')
  const kw = page.getByPlaceholder('编号 / 名称')
  await kw.fill('ZCTEST02')
  await kw.press('Enter')
  const row = page.locator('.el-table__body tr', { hasText: 'ZCTEST02' }).first()
  await row.getByRole('button', { name: '编辑' }).click()
  const dialog = page.locator('.el-dialog', { hasText: '编辑固定资产' })
  await expect(dialog).toBeVisible()
  const original = dialog.locator('.el-form-item', { hasText: '原值' }).first().locator('.el-input-number')
  const accum = dialog.locator('.el-form-item', { hasText: '期初累计折旧' }).locator('.el-input-number')
  await expect(original).toHaveClass(/is-disabled/)
  await expect(accum).toHaveClass(/is-disabled/)
  await expect(dialog).toContainText('已有折旧记录')
  await shot(page, '02-已折旧卡片原值锁定')
  await dialog.getByRole('button', { name: '取消' }).click()
})

test('新建、无任何财务痕迹的卡片：原值可编辑；当月应提未提时处置被拦（FIX-277 / FIX-285）', async ({ loggedInPage: page, request }) => {
  const assetNo = `E2EREV${Date.now().toString().slice(-6)}`
  const r = await api(request, 'post', '/asset/cards', {
    asset_no: assetNo, asset_name: `${TAG}-卡片`, original_value: 12000, salvage_rate: 0.05,
    depr_method: '1', use_months: 36, acquire_date: '2026-08-10', start_depr_date: '2026-08-15',
  })
  expect(r.body?.code, JSON.stringify(r.body)).toBe(0)
  created.cards.push(r.body.data.id)

  await page.goto('/asset/list')
  const kw = page.getByPlaceholder('编号 / 名称')
  await kw.fill(assetNo)
  await kw.press('Enter')
  await page.locator('.el-table__body tr', { hasText: assetNo }).first().getByRole('button', { name: '编辑' }).click()
  const dialog = page.locator('.el-dialog', { hasText: '编辑固定资产' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.el-form-item', { hasText: '原值' }).first().locator('.el-input-number')).not.toHaveClass(/is-disabled/)
  await shot(page, '03-新卡片原值可编辑')
  await dialog.getByRole('button', { name: '取消' }).click()

  // 起折 8 月、9 月尚未计提 → 9 月处置应被拦下
  const d = await api(request, 'post', `/asset/cards/${r.body.data.id}/dispose`, { scrap_date: '2026-09-25', scrap_reason: '报废' })
  expect(d.status).toBe(400)
  expect(d.body.message).toContain('当月照提折旧')
})

// ── 出纳 ──────────────────────────────────────────────────

test('出纳期初：可选择启用日期，「读入总账余额」不再报「尚未设置启用日期」（FIX-281）', async ({ loggedInPage: page }) => {
  await page.goto('/cashier/init-balance')
  const date = page.getByPlaceholder('请选择启用日期')
  await expect(date).toBeVisible()
  await date.fill('2026-09-01')
  await date.press('Enter')
  await page.getByRole('button', { name: '读入总账余额' }).click()
  // 结果要么是「无需回填」提示，要么是回填确认框；都不能是启用日期缺失的报错
  const box = page.locator('.el-message-box')
  const msg = page.locator('.el-message')
  await expect(box.or(msg).first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('尚未设置出纳启用日期')
  await shot(page, '04-出纳期初读入总账余额')
  if (await box.isVisible()) await box.getByRole('button', { name: '取消' }).click()
})

test('出纳日记账：生成凭证后修改金额被拒（FIX-305）', async ({ loggedInPage: page, request }) => {
  const j = await api(request, 'post', '/cashier/journal', {
    account_code: '1001', biz_date: '2026-09-15', summary: `${TAG}-出纳收款`, debit: 123.45, credit: 0, counter_account: '6602',
  })
  expect(j.body?.code, JSON.stringify(j.body)).toBe(0)
  const journalId = j.body.data.id
  created.journals.push(journalId)
  const g = await api(request, 'post', '/cashier/generate-voucher', { account_code: '1001', ids: [journalId] })
  expect(g.body?.code, JSON.stringify(g.body)).toBe(0)

  await page.goto('/cashier/journal?account_code=1001')
  const row = page.locator('.el-table__body tr', { hasText: `${TAG}-出纳收款` }).first()
  await expect(row).toBeVisible()
  await row.dblclick()
  const dialog = page.locator('.el-dialog', { hasText: '修改日记账' })
  await expect(dialog).toBeVisible()
  const debit = dialog.locator('.el-form-item', { hasText: '收入(借)' }).locator('input')
  await debit.fill('200')
  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.el-message', { hasText: '已生成凭证' })).toBeVisible()
  await shot(page, '05-已生成凭证改金额被拒')
  await page.keyboard.press('Escape')
})

test('凭证查询：出纳凭证不能在凭证页删除（FIX-313）', async ({ loggedInPage: page }) => {
  await page.goto('/voucher/query')
  // 列表为虚拟滚动，只渲染可见行：逐步向下滚动表格直到目标行渲染出来
  const row = page.getByText(`${TAG}-出纳收款`).first()
  await expect(page.getByText('已全部加载')).toBeVisible({ timeout: 10000 })
  const body = page.locator('.el-table__body-wrapper, .el-table-v2__body, .el-scrollbar__wrap').first()
  for (let i = 0; i < 20 && !(await row.isVisible()); i++) {
    await body.hover()
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(150)
  }
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await page.getByRole('button', { name: '删除' }).first().click()
  await expect(page.locator('.el-message', { hasText: '出纳生成的凭证不允许在此删除' })).toBeVisible()
  await shot(page, '06-凭证页删出纳凭证被拦')
})

test('出纳日记账：行上「删凭证」按勾选行删除成功（FIX-310）', async ({ loggedInPage: page, request }) => {
  await page.goto('/cashier/journal?account_code=1001')
  const row = page.locator('.el-table__body tr', { hasText: `${TAG}-出纳收款` }).first()
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '删凭证' }).click()
  await page.locator('.el-message-box').getByRole('button', { name: /确定|确认/ }).click()
  await expect(page.locator('.el-message', { hasText: '已删除凭证' })).toBeVisible()
  await shot(page, '07-按行删出纳凭证成功')
  // 流水回到「未生成凭证」
  const list = await api(request, 'get', '/cashier/journal?account_code=1001&start_date=2026-09-15&end_date=2026-09-15')
  const mine = list.body.data.rows.find((x: any) => x.id === created.journals[0])
  expect(mine.voucher_no).toBeNull()
})

// ── 总账 ──────────────────────────────────────────────────

test('外币余额表：有「隐藏零值」开关（FIX-291）', async ({ loggedInPage: page }) => {
  await page.goto('/ledger/foreign-balance')
  const cb = page.locator('.el-checkbox', { hasText: '隐藏零值' })
  await expect(cb).toBeVisible()
  await expect(cb).toHaveClass(/is-checked/)
  await cb.click()
  await expect(cb).not.toHaveClass(/is-checked/)
  await shot(page, '08-外币余额表隐藏零值开关')
})

test('账簿 / 报表页面在权限码收紧后仍可正常打开（FIX-286 / FIX-315）', async ({ loggedInPage: page }) => {
  for (const [path, title] of [
    ['/ledger/general', '科目余额表'], ['/ledger/detail', '明细账'], ['/ledger/balance', '总分类账'],
    ['/ledger/chronological', '序时账'], ['/ledger/standard-report', '标准报表'],
  ]) {
    await page.goto(path)
    await expect(page.locator('body')).toContainText(title)
    await expect(page.locator('.el-message--error')).toHaveCount(0)
  }
  await shot(page, '09-标准报表页')
})

test('凭证关键字：含 FTS 语法字符不报错（FIX-288）、按分录摘要能搜到（FIX-320）；金额下限 0 生效（FIX-289）', async ({ request }) => {
  for (const kw of ['"A-1', 'AND', '(付款', '-']) {
    const r = await api(request, 'get', `/voucher/vouchers?keyword=${encodeURIComponent(kw)}&page=1&pageSize=5`)
    expect(r.status, kw).toBe(200)
  }
  // FIX-320：按分录摘要能搜到凭证（旧索引口径不一致时永远 0 条；开发库虚表丢失时直接报错）
  const hit = await api(request, 'get', `/voucher/vouchers?keyword=${encodeURIComponent('调试')}&page=1&pageSize=20`)
  expect(hit.status).toBe(200)
  expect(JSON.stringify(hit.body)).toContain('调试-外币收款')
  const r0 = await api(request, 'get', '/ledger/chronological?start_date=2026-09-01&end_date=2026-09-30&min_amount=0&page=1&pageSize=5')
  expect(r0.status).toBe(200)
})
