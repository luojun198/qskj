import { test, expect } from '@playwright/test'

test.describe('凭证管理', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('/')
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/)
  })

  test('应该能够访问凭证录入页面', async ({ page }) => {
    // 导航到凭证录入
    await page.click('text=凭证管理')
    await page.click('text=凭证录入')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('凭证录入')
    await expect(page.locator('.voucher-form')).toBeVisible()
  })

  test('应该能够查看凭证列表', async ({ page }) => {
    // 导航到凭证查询
    await page.click('text=凭证管理')
    await page.click('text=凭证查询')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('凭证查询')
    await expect(page.locator('.el-table')).toBeVisible()
  })

  test('应该能够访问凭证审核页面', async ({ page }) => {
    // 导航到凭证审核
    await page.click('text=凭证管理')
    await page.click('text=凭证审核')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('凭证审核')
    await expect(page.locator('.el-table')).toBeVisible()
  })
})
