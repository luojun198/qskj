/**
 * 生产 / 委外 / 进销存新增页面渲染冒烟（FIX-239 ~ FIX-248）
 *
 * 只验证「路由可达 + 页面骨架渲染 + 无前端报错」；业务口径由 scratch/scmSmokeTest.mjs（HTTP 冒烟）与单测覆盖。
 */
import { test, expect, navTo } from './fixtures'

const PAGES: Array<{ path: string; title: string; marker: string }> = [
  { path: '/scm/production-plans?plan_type=self', title: '生产计划', marker: '.el-table' },
  { path: '/scm/work-reports', title: '生产报工', marker: '.el-table' },
  { path: '/scm/plan-changes', title: '工单变更单', marker: '.el-table' },
  { path: '/scm/schedule', title: '自动排程', marker: '.rpt-table' },
  { path: '/scm/kitting', title: '齐套分析', marker: '.kit-page' },
  { path: '/scm/report/production/execution', title: '生产执行及在制结存表', marker: '.el-table' },
  { path: '/scm/report/production/hours', title: '工时统计', marker: '.rpt-table' },
  { path: '/scm/report/production/daily', title: '生产日报', marker: '.rpt-table' },
  { path: '/scm/report/production/cost', title: '工单成本明细表', marker: '.rpt-table' },
  { path: '/scm/report/production/process-wip', title: '工序在制表', marker: '.rpt-table' },
  { path: '/scm/report/production/capacity', title: '产能负荷表', marker: '.rpt-table' },
  { path: '/scm/cost-variance', title: '标准成本差异', marker: '.cv-page' },
  { path: '/scm/costing/overhead-variance', title: '制费/人工吸收差异结转', marker: '.summary-grid, .el-empty, .runs' },
  { path: '/scm/report/stock-layers', title: '库存成本层', marker: '.layers-table' },
  { path: '/scm/report/month-avg-costing', title: '全月平均成本计算', marker: '.ma-table' },
  { path: '/scm/report/sales/execution', title: '销售订单执行表', marker: '.rpt-table' },
  { path: '/scm/qc-standards', title: '检验标准', marker: '.el-table' },
  { path: '/scm/arap-fx-reval', title: '汇率重估', marker: '.fx-reval-page' },
]

test.describe('生产 / 委外 / 进销存新页面渲染', () => {
  for (const p of PAGES) {
    test(`${p.title} 可渲染`, async ({ loggedInPage: page }) => {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(String(e)))
      await page.goto(p.path)
      await page.waitForSelector(p.marker, { timeout: 10000 })
      await page.waitForFunction(() => !document.querySelector('.el-loading-mask'), { timeout: 8000 }).catch(() => undefined)
      await expect(page.locator('body')).toContainText(p.title.split('/')[0].slice(0, 4))
      expect(errors, `页面 ${p.path} 前端报错：${errors.join(' | ')}`).toEqual([])
    })
  }

  test('生产模块主页可经应用栏进入并含核心流程入口', async ({ loggedInPage: page }) => {
    await navTo(page, '生产制造', '生产计划')
    await expect(page).toHaveURL(/production-plans/)
    await expect(page.locator('.el-table')).toBeVisible()
  })

  test('委外模块主页含委外计划 / 工序委外单', async ({ loggedInPage: page }) => {
    await page.goto('/group/' + encodeURIComponent('委外管理'))
    await page.locator('.module-home').waitFor({ state: 'visible', timeout: 8000 })
    await expect(page.locator('.module-home a', { hasText: '委外计划' }).first()).toBeVisible()
    await expect(page.locator('.module-home a', { hasText: '工序委外单' }).first()).toBeVisible()
  })
})
