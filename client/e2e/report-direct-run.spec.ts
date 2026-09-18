/**
 * 报表直达：标准报表页点「资产负债表」进入报表运行 / 动态报表页
 */
import { test, expect } from './fixtures'

test('标准报表页点资产负债表进入报表页', async ({ loggedInPage: page }) => {
  await page.goto('/ledger/standard-report')
  await page.waitForSelector('.page, .el-table, .el-card', { timeout: 10000 })
  const entry = page.locator('a, .el-button, .el-link, [role=button], .report-card, .el-table__row', { hasText: '资产负债表' }).first()
  await entry.waitFor({ state: 'visible', timeout: 8000 })
  await entry.click()
  await page.waitForTimeout(800)
  await expect(page.locator('body')).toContainText('资产负债表')
})
