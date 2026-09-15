import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * FIX-134 / FIX-135：筛选模式批量记账 / 反记账 / 反审核必须带科目授权范围过滤、
 * 已结账期间排除，且 requireAudit / allowDirectPost 读真实系统参数。
 * 项目无路由级测试基建，这里以源码断言锁定关键实现（同 voucherReverse.test.ts 的做法）。
 */
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const routes = fs.readFileSync(path.join(srcDir, 'routes', 'voucherBatch.ts'), 'utf8')

describe('voucherBatch 筛选模式守卫', () => {
  it('统一走 loadStatusFilteredVouchers，并带 accountScope 过滤', () => {
    expect(routes).toContain('buildVoucherAllEntriesInScopeSql(req.accountScope')
    expect((routes.match(/loadStatusFilteredVouchers\(\{/g) || []).length).toBeGreaterThanOrEqual(6)
  })

  it('已结账期间统一跳过', () => {
    expect(routes).toContain('getPeriodClosingRecord({ db, accountSetId, year: v.year, period: v.period })')
    expect(routes).toContain('所选凭证均属于已结账期间，不能记账')
    expect(routes).toContain('所选凭证均属于已结账期间，不能反审核')
  })

  it('requireAudit 不再硬编码 false', () => {
    expect(routes).not.toMatch(/requireAudit:\s*false,\s*\n\s*allowDirectPost:\s*true/)
    expect(routes).toContain("param_key='require_audit'")
    expect(routes).toContain('getRequireAuditEnabled(')
  })

  it('全部 preview 接口带权限码', () => {
    for (const op of ['batch-audit', 'batch-delete', 'batch-unaudit', 'batch-post', 'batch-unpost']) {
      const idx = routes.indexOf(`'/vouchers/${op}/preview'`)
      expect(idx).toBeGreaterThan(0)
      expect(routes.slice(idx, idx + 120)).toMatch(/requirePermission\('voucher:/)
    }
  })
})
