import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReversedEntries,
  getVoucherBalanceError,
  isVoucherBalanced,
  calculateVoucherTotalsCents,
  type VoucherEntryInput,
} from '../services/voucherEntry.js'

const entry = (
  direction: 'debit' | 'credit',
  amount: number,
  extra: Record<string, unknown> = {}
): VoucherEntryInput =>
  ({
    account_id: 'a1',
    account_code: '1001',
    account_name: '库存现金',
    direction,
    amount,
    ...extra,
  }) as any

describe('凭证冲红：红字分录构造', () => {
  it('方向保持不变，金额取负', () => {
    const reversed = buildReversedEntries([entry('debit', 100), entry('credit', 100)])
    expect(reversed.map(e => e.direction)).toEqual(['debit', 'credit'])
    expect(reversed.map(e => e.amount)).toEqual([-100, -100])
  })

  it('amount_cents 同步取负', () => {
    const reversed = buildReversedEntries([entry('debit', 1234.56, { amount_cents: 123456 })])
    expect((reversed[0] as any).amount_cents).toBe(-123456)
  })

  it('缺少 amount_cents 时由 amount 推导并取负', () => {
    const reversed = buildReversedEntries([entry('credit', 0.07)])
    expect((reversed[0] as any).amount_cents).toBe(-7)
  })

  it('科目 / 辅助核算 / 现金流量等字段原样保留', () => {
    const reversed = buildReversedEntries([
      entry('debit', 100, {
        dept_id: 'd1',
        dept_name: '销售部',
        project_id: 'p1',
        cash_flow_code: '01',
        aux_data: '{"dept":{"id":"d1"}}',
      }),
    ])
    const e = reversed[0] as any
    expect(e.dept_id).toBe('d1')
    expect(e.dept_name).toBe('销售部')
    expect(e.project_id).toBe('p1')
    expect(e.cash_flow_code).toBe('01')
    expect(e.aux_data).toBe('{"dept":{"id":"d1"}}')
  })

  it('原凭证平衡则红字凭证必然平衡', () => {
    const origin = [
      entry('debit', 300.33),
      entry('credit', 100.11),
      entry('credit', 200.22),
    ]
    expect(isVoucherBalanced(origin)).toBe(true)
    const reversed = buildReversedEntries(origin)
    expect(getVoucherBalanceError(reversed)).toBeNull()
    const { debitCents, creditCents } = calculateVoucherTotalsCents(reversed)
    expect(debitCents).toBe(-30033)
    expect(creditCents).toBe(-30033)
  })

  it('对红字分录再次取负回到原值（幂等对合）', () => {
    const origin = [entry('debit', 88.88), entry('credit', 88.88)]
    const twice = buildReversedEntries(buildReversedEntries(origin))
    expect(twice.map(e => e.amount)).toEqual([88.88, 88.88])
  })
})

describe('凭证冲红：路由前置校验', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const routes = fs.readFileSync(path.join(srcDir, 'routes', 'voucher.ts'), 'utf8')

  it('注册了 POST /vouchers/:id/reverse 端点', () => {
    expect(routes).toContain("'/vouchers/:id/reverse'")
  })

  it('草稿凭证 / 已冲红 / 红字凭证再冲红均被拦截', () => {
    expect(routes).toContain('仅已审核或已记账的凭证可以冲红')
    expect(routes).toContain('不能重复冲红')
    expect(routes).toContain('红字凭证本身不能再次冲红')
  })

  it('删除凭证时清理冲红关联的对端引用（FIX-132 后统一在 voucherDelete 服务）', () => {
    const svc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../services/voucherDelete.ts'), 'utf-8')
    expect(svc).toMatch(/UPDATE vouchers SET reversed_by_voucher_id=NULL/)
    expect(svc).toMatch(/UPDATE vouchers SET reversal_of_voucher_id=NULL/)
    expect(routes).toContain('deleteVoucherWithRefs(')
  })
})
