# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: client\e2e\cashier.spec.ts >> 出纳管理 >> 出纳期初余额页面能正常渲染
- Location: client\e2e\cashier.spec.ts:157:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1  | /**
  2  |  * E2E 测试共用 fixture
  3  |  *
  4  |  * 通过 API 直接登录并注入 localStorage，绕过 el-select 下拉登录 UI，
  5  |  * 使测试聚焦在功能验证而非登录交互。
  6  |  */
  7  | import { test as base, expect, type Page } from '@playwright/test'
  8  | 
  9  | const API_BASE = 'http://127.0.0.1:3005'
  10 | const ACCOUNT_SET_ID = '5945a5a8-e9f2-4145-968f-86862ce54aa3'  // 行政账套
  11 | const USERNAME = 'admin'
  12 | const PASSWORD = 'admin123'
  13 | 
  14 | /** 通过 API 登录并注入 token 到 localStorage */
  15 | async function apiLogin(page: Page) {
  16 |   const resp = await page.request.post(`${API_BASE}/api/auth/login`, {
  17 |     data: { username: USERNAME, password: PASSWORD, targetAccountSetId: ACCOUNT_SET_ID },
  18 |   })
  19 |   const body = await resp.json()
  20 |   if (!body.token) throw new Error('登录失败: ' + JSON.stringify(body))
  21 | 
> 22 |   await page.goto('/')
     |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  23 |   await page.evaluate(({ token, asid }) => {
  24 |     localStorage.setItem('token', token)
  25 |     localStorage.setItem('accountSetId', asid)
  26 |   }, { token: body.token, asid: ACCOUNT_SET_ID })
  27 |   await page.goto('/dashboard')
  28 |   await page.waitForSelector('.el-menu', { timeout: 8000 })
  29 | }
  30 | 
  31 | /** 扩展 test，提供已登录的 page fixture */
  32 | export const test = base.extend<{ loggedInPage: Page }>({
  33 |   loggedInPage: async ({ page }, use) => {
  34 |     await apiLogin(page)
  35 |     await use(page)
  36 |   },
  37 | })
  38 | 
  39 | export { expect }
  40 | 
  41 | /** 便捷函数：等待 el-table 加载（不含 loading 状态） */
  42 | export async function waitForTable(page: Page) {
  43 |   await page.waitForSelector('.el-table', { timeout: 8000 })
  44 |   await page.waitForFunction(() => !document.querySelector('.el-loading-mask'), { timeout: 5000 })
  45 | }
  46 | 
  47 | /** 便捷函数：点击侧边菜单导航 */
  48 | export async function navTo(page: Page, group: string, item: string) {
  49 |   // 展开菜单分组（如果还未展开）
  50 |   const groupEl = page.locator('.el-menu .el-sub-menu__title', { hasText: group })
  51 |   const isOpen = await page.locator(`.el-menu .el-sub-menu.is-opened .el-sub-menu__title`, { hasText: group }).isVisible().catch(() => false)
  52 |   if (!isOpen) await groupEl.click()
  53 |   await page.locator('.el-menu-item', { hasText: item }).click()
  54 |   await page.waitForTimeout(300)
  55 | }
  56 | 
```