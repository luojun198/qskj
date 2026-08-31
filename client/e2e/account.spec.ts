import { test, expect } from '@playwright/test'

test.describe('基础设置', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('/')
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/)
  })

  test('应该能够访问会计科目页面', async ({ page }) => {
    // 导航到会计科目
    await page.click('text=基础设置')
    await page.click('text=会计科目')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('会计科目')
    await expect(page.locator('.el-table')).toBeVisible()
  })

  test('应该能够展开和折叠科目树', async ({ page }) => {
    await page.click('text=基础设置')
    await page.click('text=会计科目')

    // 点击展开按钮
    await page.click('button:has-text("底层")')
    await page.waitForTimeout(500)

    // 点击折叠按钮
    await page.click('button:has-text("顶层")')
    await page.waitForTimeout(500)
  })

  test('应该能够搜索科目', async ({ page }) => {
    await page.click('text=基础设置')
    await page.click('text=会计科目')

    // 输入搜索关键词
    await page.fill('input[placeholder="搜索科目"]', '现金')
    await page.waitForTimeout(500)

    // 验证搜索结果
    await expect(page.locator('.el-table')).toBeVisible()
  })
})
