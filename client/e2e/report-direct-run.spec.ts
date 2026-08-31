import { test, expect } from '@playwright/test'

test('点击资产负债表应保持直达运行路由并弹出生成框', async ({ page, request }) => {
  const captchaRes = await request.get('http://localhost:3105/api/auth/captcha')
  const captchaData = await captchaRes.json()
  const svg = Buffer.from(String(captchaData.captchaUrl).split(',')[1], 'base64').toString('utf-8')
  const match = svg.match(/>(\d+)\s*\+\s*(\d+)\s*=\s*\?</)
  if (!match) throw new Error('无法解析验证码')
  const captchaAnswer = String(Number(match[1]) + Number(match[2]))

  await page.goto('/')
  await page.click('.el-select')
  await page.click('.el-select-dropdown__item')
  await page.fill('input[placeholder="用户名"]', 'admin')
  await page.fill('input[placeholder="密码"]', 'admin123')
  await page.fill('input[placeholder="验证码"]', captchaAnswer)

  await page.evaluate(captchaId => {
    const setDeep = (obj: unknown, seen = new Set<unknown>()): boolean => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return false
      seen.add(obj)
      if ('captchaId' in (obj as Record<string, unknown>)) {
        ;(obj as { captchaId: string }).captchaId = captchaId
        return true
      }
      for (const value of Object.values(obj as Record<string, unknown>)) {
        if (setDeep(value, seen)) return true
      }
      return false
    }
    setDeep(window)
  }, captchaData.captchaId)

  await page.getByRole('button', { name: '登 录' }).click()
  await page.waitForURL(/\/dashboard/)

  await page.click('text=报表管理')
  await page.click('text=资产负债表')

  await expect(page).toHaveURL(/\/report\/run\/1/)
  await expect(page.locator('.report-generate-message-box')).toBeVisible()
  await expect(page.locator('.report-generate-dialog__title')).toContainText('资产负债表')
  await expect(page.locator('button:has-text("保存模板")')).toHaveCount(0)
  await expect(page.locator('button:has-text("导入 Excel")')).toHaveCount(0)
})
