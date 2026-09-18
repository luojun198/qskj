/**
 * 基础资料：会计科目页（登录经 fixtures API 注入，页面按路由直达 + 模块主页导航各验一次）
 */
import { test, expect, navTo, waitForTable } from './fixtures'

test.describe('基础设置', () => {
  test('应该能够通过模块主页进入会计科目', async ({ loggedInPage: page }) => {
    await navTo(page, '基础资料', '会计科目')
    await expect(page.locator('.account-page h3')).toContainText('会计科目')
    await waitForTable(page)
  })

  test('应该能够展开和折叠科目树', async ({ loggedInPage: page }) => {
    await page.goto('/base/account')
    await waitForTable(page)
    await page.click('button:has-text("底层")')
    await page.waitForTimeout(300)
    await page.click('button:has-text("顶层")')
    await page.waitForTimeout(300)
    await expect(page.locator('.el-table')).toBeVisible()
  })

  test('应该能够搜索科目', async ({ loggedInPage: page }) => {
    await page.goto('/base/account')
    await waitForTable(page)
    await page.fill('input[placeholder="搜索科目编码或名称"]', '现金')
    await page.waitForTimeout(500)
    await expect(page.locator('.el-table')).toBeVisible()
    await expect(page.locator('.el-table')).toContainText('现金')
  })
})
