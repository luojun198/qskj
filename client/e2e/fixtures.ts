/**
 * E2E 测试共用 fixture
 *
 * 通过 API 直接登录并注入 localStorage，绕过 el-select 下拉登录 UI，
 * 使测试聚焦在功能验证而非登录交互。
 */
import { test as base, expect, type Page } from '@playwright/test'

export const API_BASE = 'http://127.0.0.1:3105'
const USERNAME = 'admin'
const PASSWORD = 'admin123'

/** 曾经硬编码的行政账套 id；库若还在就优先用它，保证与历史用例数据落在同一账套 */
const PREFERRED_ACCOUNT_SET_ID = '5945a5a8-e9f2-4145-968f-86862ce54aa3'

let cachedAccountSetId: string | null = null

/**
 * 运行时解析账套 id。
 *
 * 原先各处硬编码 PREFERRED_ACCOUNT_SET_ID，一旦开发库被重建/重新导入，
 * 账套 id 就会变，整个 E2E 套件在登录这一步全军覆没且报错为难以理解的 401。
 * 改为向 /api/auth/account-sets（免鉴权）实时查询。
 */
export async function resolveAccountSetId(request: {
  get: (url: string) => Promise<{ json: () => Promise<any> }>
}): Promise<string> {
  if (cachedAccountSetId) return cachedAccountSetId

  const resp = await request.get(`${API_BASE}/api/auth/account-sets`)
  const body = await resp.json()
  const list = (body?.data ?? []) as Array<{ id: string; name?: string }>
  if (!list.length) throw new Error('账套列表为空，请先初始化数据库')

  const hit = list.find(a => a.id === PREFERRED_ACCOUNT_SET_ID) ?? list[0]
  cachedAccountSetId = hit.id
  return hit.id
}

/** 登录并返回 API 请求头（供纯接口用例复用） */
export async function apiHeaders(request: any) {
  const asid = await resolveAccountSetId(request)
  const lr = await request.post(`${API_BASE}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD, targetAccountSetId: asid },
  })
  const body = await lr.json()
  if (!body.token) throw new Error('登录失败: ' + JSON.stringify(body))
  return { Authorization: `Bearer ${body.token}`, 'x-account-set-id': asid }
}

/** 通过 API 登录并注入 token 到 localStorage */
async function apiLogin(page: Page) {
  const accountSetId = await resolveAccountSetId(page.request)
  const resp = await page.request.post(`${API_BASE}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD, targetAccountSetId: accountSetId },
  })
  const body = await resp.json()
  if (!body.token) throw new Error('登录失败: ' + JSON.stringify(body))

  await page.goto('/')
  await page.evaluate(({ token, asid }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('accountSetId', asid)
  }, { token: body.token, asid: accountSetId })
  await page.goto('/dashboard')
  await page.waitForSelector('.app-rail', { timeout: 8000 })
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

/**
 * 便捷函数：通过左侧导航跳转到某个页面。
 *
 * 导航改版后不再是 el-menu 的可折叠树，而是「应用栏（.app-rail）选应用 →
 * 导航面板（.app-nav-panel）选页面」两步。应用栏上的名称是缩写（见 AppRail.shortLabel），
 * 所以匹配时按前两个字做前缀匹配，再用面板标题确认选中的是目标应用。
 */
export async function navTo(page: Page, group: string, item: string) {
  await page.waitForSelector('.app-rail', { timeout: 8000 })

  // 应用栏标签是 shortLabel（≤4 字，去「管理」后缀），按前两字前缀匹配
  const railItem = page
    .locator('.app-rail__item', { hasText: group.slice(0, 2) })
    .first()
  await railItem.click()

  // 二级导航面板已取消：点应用进入模块主页（/group/<模块>），页内流程卡 / 链接列 / 宫格全是 router-link
  const home = page.locator('.module-home')
  await home.waitFor({ state: 'visible', timeout: 8000 })
  const link = home.locator('a', { hasText: item }).first()
  await link.waitFor({ state: 'visible', timeout: 5000 })
  await link.click()
  await page.waitForTimeout(300)
}
