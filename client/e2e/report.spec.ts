/**
 * 财务报表：动态报表页（资产负债表 / 利润表由报表模板驱动，路由 /report/dynamic/:code）
 */
import { test, expect, apiHeaders, API_BASE, navTo } from './fixtures'

test.describe('报表管理', () => {
  test('报表模板列表可取到资产负债表', async ({ request }) => {
    const headers = await apiHeaders(request)
    const resp = await request.get(`${API_BASE}/api/report/templates`, { headers })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    const list = body?.data?.list ?? body?.data ?? []
    expect(Array.isArray(list)).toBeTruthy()
    expect(JSON.stringify(list)).toContain('资产负债表')
  })

  test('应该能够访问动态报表页', async ({ loggedInPage: page }) => {
    await page.goto('/report/dynamic')
    await page.waitForSelector('.page, .dynamic-report, .el-table, .el-empty', { timeout: 10000 })
    await expect(page.locator('.apple-breadcrumb')).toBeVisible()
  })

  test('总账工作台 → 标准报表页含资产负债表', async ({ loggedInPage: page }) => {
    await navTo(page, '财务总账', '报表')
    await expect(page).toHaveURL(/standard-report/)
    await expect(page.locator('body')).toContainText('资产负债表')
  })
})
