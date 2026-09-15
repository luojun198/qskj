/**
 * 供应链 / 系统管理 冒烟 E2E
 *
 * 供应链是最大模块（56 个视图）却此前无 E2E 覆盖；这里只做「导航可达 + 表格渲染」级冒烟，
 * 深度交互用例后续按业务优先级补。
 *
 * 前置：后端 3105 + 前端 5275 均已启动（playwright.config 的 webServer 会自动拉起）。
 */
import { test, expect, navTo, waitForTable } from './fixtures'

test.describe('供应链冒烟', () => {
  test('物料档案页可渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '供应链', '物料档案')
    await expect(page.locator('.apple-breadcrumb')).toContainText('物料档案')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
  })

  test('库存查询页可渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '供应链', '库存查询')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
  })
})

test.describe('系统管理冒烟', () => {
  test('用户管理页可渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '系统管理', '用户管理')
    await expect(page.locator('.apple-breadcrumb')).toContainText('用户管理')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
  })
})
