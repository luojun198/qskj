/**
 * 登录页：账套 / 用户下拉 + 密码 + 验证码。
 * 成功登录由 fixtures.apiLogin（API 登录 + 注入 token）覆盖；这里只验证登录页渲染与错误密码被拒。
 */
import { test, expect } from '@playwright/test'
import { API_BASE, resolveAccountSetId } from './fixtures'

test.describe('登录功能', () => {
  test('登录页渲染：账套下拉、密码框、登录按钮', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h2')).toContainText('润衡云')
    await expect(page.locator('.el-select').first()).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /登\s*录/ })).toBeVisible()
  })

  test('错误密码被拒（API）', async ({ request }) => {
    const asid = await resolveAccountSetId(request)
    const resp = await request.post(`${API_BASE}/api/auth/login`, { data: { username: 'admin', password: 'wrongpassword', targetAccountSetId: asid } })
    const body = await resp.json()
    expect(body.token).toBeFalsy()
    expect(resp.status()).toBeGreaterThanOrEqual(400)
  })
})
