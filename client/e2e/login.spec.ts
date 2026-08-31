import { test, expect } from '@playwright/test'

test.describe('登录功能', () => {
  test('应该能够成功登录', async ({ page }) => {
    await page.goto('/')

    // 等待登录页面加载
    await expect(page.locator('h2')).toContainText('登录')

    // 填写登录表单
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')

    // 点击登录按钮
    await page.click('button[type="submit"]')

    // 验证登录成功，跳转到首页
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('.page-header')).toBeVisible()
  })

  test('应该显示错误信息当密码错误时', async ({ page }) => {
    await page.goto('/')

    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // 验证显示错误消息
    await expect(page.locator('.el-message--error')).toBeVisible()
  })
})
