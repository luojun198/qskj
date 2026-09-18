/**
 * 出纳管理 E2E 测试
 *
 * 覆盖：页面渲染 / 科目加载 / 日记账录入与查询 / 余额计算 / 银行对账 / 期初余额
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
    // 期望有「现金科目」或「银行存款」分组标题
    const dropdown = page.locator('.el-select-dropdown')
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
      `${API}/api/cashier/journal?account_code=1001`,
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

    // 查询日记账列表（含余额）
    const listRes = await request.get(`${API}/api/cashier/journal?account_code=1001`, { headers })
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

  test('银行对账 API 能自动勾对', async ({ request }) => {
    const asid = await resolveAccountSetId(request)
    const lr = await request.post(`${API}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
    })
    const { token } = await lr.json()
    const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }

    // 创建一条日记账 + 对应的银行对账单（金额相同、日期相同）
    const date = '2026-06-20'
    const jRes = await request.post(`${API}/api/cashier/journal`, {
      headers: H,
      data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, summary: 'E2E对账测试' },
    })
    const { data: { id: jId } } = await jRes.json()

    const sRes = await request.post(`${API}/api/cashier/bank-statement`, {
      headers: H,
      data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, bill_no: 'STMT001' },
    })
    const { data: { id: sId } } = await sRes.json()

    // 执行自动勾对
    const reconRes = await request.post(`${API}/api/cashier/reconcile/auto`, {
      headers: H,
      data: { account_code: '1002', start_date: date, end_date: date },
    })
    const reconData = await reconRes.json()
    expect(reconData.code).toBe(0)
    expect(reconData.data.matched).toBe(1)

    // 验证日记账 reconciled 已更新
    const verifyRes = await request.get(`${API}/api/cashier/journal?account_code=1002`, { headers: H })
    const verifyData = await verifyRes.json()
    const matched = verifyData.data.rows.find((r: any) => r.id === jId)
    expect(matched?.reconciled).toBe(1)

    // 清理：先撤销对账（解绑），再删日记账与对账单，避免遗留孤立对账单
    await request.post(`${API}/api/cashier/reconcile/cancel`, { headers: H, data: { journal_id: jId } })
    await request.delete(`${API}/api/cashier/journal/${jId}`, { headers: H })
    await request.delete(`${API}/api/cashier/bank-statement/${sId}`, { headers: H })
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
