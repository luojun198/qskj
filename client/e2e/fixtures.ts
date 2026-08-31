/**
 * E2E 测试共用 fixture
 *
 * 通过 API 直接登录并注入 localStorage，绕过 el-select 下拉登录 UI，
 * 使测试聚焦在功能验证而非登录交互。
 */
import { test as base, expect, type Page } from '@playwright/test'

const API_BASE = 'http://127.0.0.1:3105'
const ACCOUNT_SET_ID = '5945a5a8-e9f2-4145-968f-86862ce54aa3'  // 行政账套
const USERNAME = 'admin'
const PASSWORD = 'admin123'

/** 通过 API 登录并注入 token 到 localStorage */
async function apiLogin(page: Page) {
  const resp = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD, targetAccountSetId: ACCOUNT_SET_ID },
  })
  const body = await resp.json()
  if (!body.token) throw new Error('登录失败: ' + JSON.stringify(body))

  await page.goto('/')
  await page.evaluate(({ token, asid }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('accountSetId', asid)
  }, { token: body.token, asid: ACCOUNT_SET_ID })
  await page.goto('/dashboard')
  await page.waitForSelector('.el-menu', { timeout: 8000 })
}

/** 扩展 test，提供已登录的 page fixture */
export const test = base.extend<{ loggedInPage: Page }>({
  loggedInPage: async ({ page }, use) => {
    await apiLogin(page)
    await use(page)
  },
})

export { expect }

/** 便捷函数：等待 el-table 加载（不含 loading 状态） */
export async function waitForTable(page: Page) {
  await page.waitForSelector('.el-table', { timeout: 8000 })
  await page.waitForFunction(() => !document.querySelector('.el-loading-mask'), { timeout: 5000 })
}

/** 便捷函数：点击侧边菜单导航 */
export async function navTo(page: Page, group: string, item: string) {
  // 展开菜单分组（如果还未展开）
  const groupEl = page.locator('.el-menu .el-sub-menu__title', { hasText: group })
  const isOpen = await page.locator(`.el-menu .el-sub-menu.is-opened .el-sub-menu__title`, { hasText: group }).isVisible().catch(() => false)
  if (!isOpen) await groupEl.click()
  await page.locator('.el-menu-item', { hasText: item }).click()
  await page.waitForTimeout(300)
}
