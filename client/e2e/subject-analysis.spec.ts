import { test, expect, API_BASE, apiHeaders } from './fixtures'

/**
 * 财务总账 → 财务分析 → 管理费用：条件弹窗 → 年度表 → 重选月度 → 月度表。
 */
test.describe('财务分析 · 科目分析', () => {
  test('接口：subject-analysis 返回 12 个月且排除结转', async ({ request }) => {
    const headers = await apiHeaders(request)
    const accounts = await request.get(`${API_BASE}/api/base/accounts?all=1&is_enabled=1`, { headers })
    const list = (await accounts.json()).data as Array<{ code: string; name: string; level: number }>
    const admin = list.find(a => a.name === '管理费用' || a.name === '单位管理费用') ?? list.find(a => a.level === 1)
    expect(admin).toBeTruthy()

    const year = new Date().getFullYear()
    const resp = await request.get(
      `${API_BASE}/api/ledger/subject-analysis?year=${year}&account_code=${admin!.code}&include_unposted=true`,
      { headers }
    )
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    expect(body.code).toBe(0)
    expect(Array.isArray(body.data)).toBe(true)
    for (const row of body.data) {
      expect(row.months).toHaveLength(12)
      expect(row.account_code.startsWith(admin!.code)).toBe(true)
    }
  })

  test('页面：管理费用年度 / 月度分析', async ({ loggedInPage: page }) => {
    await page.goto('/group/%E8%B4%A2%E5%8A%A1%E6%80%BB%E8%B4%A6')
    await page.waitForSelector('.gl-workspace', { timeout: 10000 })

    const adminBtn = page.locator('.gl-sidebar-btn', { hasText: '管理费用' }).first()
    await expect(adminBtn).not.toHaveClass(/placeholder/)
    await adminBtn.click()

    const dialog = page.locator('.el-dialog', { hasText: '温馨提示：财务分析的数据不包含损益结转' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.el-dialog__header')).toContainText('管理费用分析')

    // 年度分析。弹窗打开后科目异步回填，未填好就点确定只会提示「请选择要分析的科目」，弹窗不关
    await expect(dialog).toContainText(/\d+ 管理费用/)
    await dialog.getByRole('button', { name: '确定' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.el-table__header')).toContainText('12月')
    await expect(page.locator('.el-table__footer')).toContainText('合 计')

    // 重选 → 月度分析
    await page.getByRole('button', { name: '重选' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByText('月度分析').click()
    await expect(dialog.getByText('按余额')).toBeHidden()
    await dialog.getByRole('button', { name: '确定' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.el-table__header')).toContainText('本年累计')

    // 返回财务总账
    await page.locator('.subject-analysis-page .page-actions').getByRole('button', { name: '返回' }).click()
    await page.waitForSelector('.gl-workspace', { timeout: 10000 })
  })
})
