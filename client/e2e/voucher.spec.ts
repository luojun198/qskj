/**
 * 凭证：录入 / 查询 / 审核记账 三个页面可达并渲染
 */
import { test, expect, navTo } from './fixtures'

test.describe('凭证管理', () => {
  test('应该能够通过模块主页进入凭证录入', async ({ loggedInPage: page }) => {
    await navTo(page, '财务总账', '凭证录入')
    await expect(page).toHaveURL(/\/voucher\/entry/)
    await expect(page.locator('.voucher-list-page')).toBeVisible()
    await expect(page.locator('.apple-breadcrumb')).toContainText('凭证录入')
  })

  test('应该能够查看凭证列表', async ({ loggedInPage: page }) => {
    await page.goto('/voucher/query')
    await page.waitForSelector('.voucher-list-page', { timeout: 8000 })
    await expect(page.locator('.voucher-audit-table-v2, .el-table, .el-empty').first()).toBeVisible()
  })

  test('应该能够访问审核记账页面', async ({ loggedInPage: page }) => {
    await page.goto('/voucher/audit')
    await page.waitForSelector('.voucher-list-page', { timeout: 8000 })
    await expect(page.locator('.voucher-list-page')).toBeVisible()
  })
})
