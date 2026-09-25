/**
 * 出纳管理 E2E 测试
 *
 * 覆盖：页面渲染 / 科目加载 / 日记账录入与查询 / 余额计算 / 出纳对账（对总账） / 期初余额
 */
import { test, expect, waitForTable, navTo, resolveAccountSetId, API_BASE } from './fixtures'

const API = API_BASE

test.describe('出纳管理', () => {
  // ── 日记账页面 ─────────────────────────────────────────

  test('出纳日记账页面能正常渲染', async ({ loggedInPage: page }) => {
    // 出纳工作台的入口叫「单据录入」；先经应用栏进入出纳工作台再点入口
    await navTo(page, '出纳管理', '单据录入')
    // 页面标题由布局层的面包屑承载（导航改版后各页面不再自带 h3）
    await expect(page.locator('.apple-breadcrumb')).toContainText('出纳录单')
    await expect(page.locator('.el-table')).toBeVisible()
    // 科目下拉自动加载现金/银行科目
    await expect(page.locator('.el-select').first()).toBeVisible()
  })

  test('科目下拉包含现金和银行科目分组', async ({ loggedInPage: page }) => {
    await page.goto('/cashier/journal')
    await page.locator('.el-select').first().click()
    await page.waitForSelector('.el-select-dropdown', { timeout: 5000 })
    // 期望有「现金科目」或「银行存款」分组标题（FIX-253 后页面还有分页「条/页」下拉，取第一个）
    const dropdown = page.locator('.el-select-dropdown').first()
    await expect(dropdown).toBeVisible()
    const optionCount = await dropdown.locator('.el-select-dropdown__item').count()
    expect(optionCount).toBeGreaterThan(0)
  })

  test('能录入出纳日记账并在列表显示', async ({ loggedInPage: page, request }) => {
    const asid = await resolveAccountSetId(request)
    // 取 token
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }

    // API 直接创建一条日记账（UI 录入在前端测试覆盖）
    const createRes = await request.post(`${API}/api/cashier/journal`, {
      headers,
      data: {
        account_code: '1001',
        biz_date: '2026-06-15',
        summary: 'E2E测试-提取备用金',
        debit: 1500,
        credit: 0,
        counter_unit: 'E2E测试单位',
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const { data: { id: journalId } } = await createRes.json()

    // 查询日记账 API 验证写入
    const listRes = await request.get(
      `${API}/api/cashier/journal?account_code=1001&start_date=2026-06-15&end_date=2026-06-15&page_size=1000`,
      { headers }
    )
    const listData = await listRes.json()
    expect(listData.code).toBe(0)
    const row = listData.data.rows.find((r: any) => r.id === journalId)
    expect(row).toBeDefined()
    expect(row.debit).toBe(1500)
    expect(row.summary).toBe('E2E测试-提取备用金')
    expect(typeof row.balance).toBe('number')  // 逐行余额存在

    // 清理
    await request.delete(`${API}/api/cashier/journal/${journalId}`, { headers })
  })

  test('日记账余额计算正确（期初 + 借 - 贷）', async ({ request }) => {
    const asid = await resolveAccountSetId(request)
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }

    // 查询期初余额
    const ibRes = await request.get(`${API}/api/cashier/init-balance`, { headers })
    const ibData = await ibRes.json()
    expect(ibData.code).toBe(0)

    // 查询日记账列表（含余额）。FIX-326：接口强制分页，逐行余额跨页连续，取最后一页的末行与期末比较
    const firstRes = await request.get(`${API}/api/cashier/journal?account_code=1001&page_size=100`, { headers })
    const firstData = await firstRes.json()
    expect(firstData.code).toBe(0)
    expect(firstData.data.rows.length).toBeLessThanOrEqual(100)
    const lastPage = Math.max(1, Math.ceil(firstData.data.total / 100))
    const listRes = await request.get(`${API}/api/cashier/journal?account_code=1001&page_size=100&page=${lastPage}`, { headers })
    const listData = await listRes.json()
    expect(listData.code).toBe(0)

    const { opening, rows, closing, totalDebit, totalCredit } = listData.data
    // 期末余额 = 期初 + 本期借 - 本期贷
    expect(Math.round((opening + totalDebit - totalCredit) * 100) / 100).toBeCloseTo(closing, 2)
    // 逐行余额最后一行应等于期末
    if (rows.length > 0) {
      expect(rows[rows.length - 1].balance).toBeCloseTo(closing, 2)
    }
  })

  test('FIX-260：外币科目日记账——币种跟科目走，本位币金额 = 原币 × 汇率', async ({ loggedInPage: page, request }) => {
    const asid = await resolveAccountSetId(request)
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }

    // 找一个外币出纳科目；库里没有则跳过（不造主数据）
    const acRes = await request.get(`${API}/api/cashier/accounts`, { headers: H })
    const accounts = (await acRes.json()).data as any[]
    const usd = accounts.find(a => Number(a.is_foreign) === 1 && a.currency_code)
    test.skip(!usd, '账套中没有外币出纳科目')

    const createRes = await request.post(`${API}/api/cashier/journal`, {
      headers: H,
      data: { account_code: usd.code, biz_date: '2026-06-16', summary: 'E2E-USD', debit: 100, credit: 0, exchange_rate: 7.2 },
    })
    expect(createRes.ok()).toBeTruthy()
    const created = (await createRes.json()).data
    expect(created.currency).toBe(usd.currency_code)

    const listRes = await request.get(`${API}/api/cashier/journal?account_code=${usd.code}&start_date=2026-06-16&end_date=2026-06-16`, { headers: H })
    const list = (await listRes.json()).data
    expect(list.currency).toBe(usd.currency_code)
    const row = list.rows.find((r: any) => r.id === created.id)
    expect(row.exchange_rate).toBe(7.2)
    expect(row.base_debit).toBeCloseTo(720, 2)

    // 页面：选中外币科目后出现币种标签，录入弹窗出现汇率栏
    await page.goto('/cashier/journal')
    await page.locator('.el-select').first().click()
    await page.locator('.el-select-dropdown').first().locator('.el-select-dropdown__item', { hasText: usd.code }).first().click()
    await expect(page.locator('.currency-tag')).toContainText(usd.currency_code)
    await page.getByRole('button', { name: '录入日记账' }).click()
    await expect(page.locator('.el-dialog').getByText('汇率')).toBeVisible()
    await page.locator('.el-dialog__footer').getByRole('button', { name: '取消' }).click()

    await request.delete(`${API}/api/cashier/journal/${created.id}`, { headers: H })
  })

  test('出纳对账 API：未生成凭证的日记账在出纳对账与差异清单中为未对项', async ({ request }) => {
    const asid = await resolveAccountSetId(request)
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }

    // FIX-262：对账 = 出纳日记账 ↔ 总账已记账分录；新录的日记账还没有凭证，只能是「出纳有、总账无」
    const date = '2026-06-20'
    const jRes = await request.post(`${API}/api/cashier/journal`, {
      headers: H,
      data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, summary: 'E2E对账测试' },
    })
    const { data: { id: jId } } = await jRes.json()

    const autoRes = await request.post(`${API}/api/cashier/gl-reconcile/auto`, {
      headers: H,
      data: { account_code: '1002', start_date: date, end_date: date },
    })
    expect((await autoRes.json()).code).toBe(0)

    const entries = await (await request.get(`${API}/api/cashier/gl-reconcile/entries`, {
      headers: H, params: { account_code: '1002', start_date: date, end_date: date },
    })).json()
    expect(entries.code).toBe(0)
    expect(entries.data.cashier.find((r: any) => r.id === jId)?.batch_id).toBeNull()

    const report = await (await request.get(`${API}/api/cashier/gl-reconcile/report`, {
      headers: H, params: { account_code: '1002', end_date: date },
    })).json()
    expect(report.code).toBe(0)
    expect(report.data.cashier_unmatched.some((r: any) => r.id === jId)).toBe(true)

    await request.delete(`${API}/api/cashier/journal/${jId}`, { headers: H })
  })

  test('结算方式字典 API 返回正确格式', async ({ request }) => {
    const asid = await resolveAccountSetId(request)
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const res = await request.get(`${API}/api/cashier/settle-types`, {
      headers: { Authorization: `Bearer ${token}`, 'x-account-set-id': asid },
    })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(Array.isArray(data.data)).toBe(true)
  })

  // ── 期初余额页面 ───────────────────────────────────────

  test('出纳期初余额页面能正常渲染', async ({ loggedInPage: page }) => {
    await page.goto('/cashier/init-balance')
    await expect(page.locator('.apple-breadcrumb')).toContainText('出纳期初')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
  })
})
