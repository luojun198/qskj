import { test, expect } from '@playwright/test'

test.describe('报表管理', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('/')
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/dashboard/)
  })

  test('应该能够访问资产负债表', async ({ page }) => {
    // 导航到资产负债表
    await page.click('text=报表管理')
    await page.click('text=资产负债表')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('资产负债表')
  })

  test('应该能够访问收入费用表', async ({ page }) => {
    // 导航到收入费用表
    await page.click('text=报表管理')
    await page.click('text=收入费用表')

    // 验证页面加载
    await expect(page.locator('h3')).toContainText('收入费用表')
  })

  test('应该能够选择报表期间', async ({ page }) => {
    await page.click('text=报表管理')
    await page.click('text=资产负债表')

    // 选择年份
    await page.click('.el-select:has-text("年份")')
    await page.click('.el-select-dropdown__item:has-text("2026")')

    // 选择期间
    await page.click('.el-select:has-text("期间")')
    await page.click('.el-select-dropdown__item:has-text("4")')

    // 点击查询按钮
    await page.click('button:has-text("查询")')
    await page.waitForTimeout(1000)
  })
})
