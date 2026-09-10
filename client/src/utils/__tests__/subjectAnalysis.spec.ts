import { describe, expect, it } from 'vitest'
import {
  buildAnnualRows,
  buildMonthlyRows,
  monthlyValues,
  type SubjectAnalysisRow,
} from '../subjectAnalysis'
import { resolvePresetAccount } from '@/config/subjectAnalysis'

function row(
  code: string,
  name: string,
  monthAmounts: Partial<Record<number, { debit?: number; credit?: number }>>,
  extra: Partial<SubjectAnalysisRow> = {}
): SubjectAnalysisRow {
  const months = Array.from({ length: 12 }, (_, i) => ({
    debit: monthAmounts[i + 1]?.debit ?? 0,
    credit: monthAmounts[i + 1]?.credit ?? 0,
  }))
  return {
    account_id: code,
    account_code: code,
    account_name: name,
    direction: 'debit',
    level: 2,
    is_leaf: true,
    init_balance: 0,
    months,
    year_debit: months.reduce((s, m) => s + m.debit, 0),
    year_credit: months.reduce((s, m) => s + m.credit, 0),
    end_balance: 0,
    ...extra,
  }
}

// 对照示范图：管理费用 2026 年 12 月发生额
const sample: SubjectAnalysisRow[] = [
  row('6602', '管理费用', {}, { level: 1, is_leaf: false }),
  row('6602001', '通讯费', { 12: { debit: 450.21 } }),
  row('6602002', '差旅费', { 12: { debit: 1940 } }),
  row('6602003', '业务招待费', {}),
  row('6602004', '办公费', { 12: { debit: 503.95 } }),
  row('6602007', '折旧费', { 12: { debit: 3650.06 } }),
  row('6602008', '交通费', { 12: { debit: 1370.58 } }),
  row('6602009', '职工薪酬', { 12: { debit: 16341.55 } }),
]

describe('subjectAnalysis 取数与派生列', () => {
  it('余额口径按方向逐月累计，费用类等于累计借方', () => {
    const r = row('x', 'x', { 1: { debit: 100 }, 2: { debit: 50, credit: 20 } })
    expect(monthlyValues(r, 'balance').slice(0, 3)).toEqual([100, 130, 130])
    expect(monthlyValues({ ...r, direction: 'credit' }, 'balance').slice(0, 2)).toEqual([-100, -130])
    expect(monthlyValues(r, 'debit').slice(0, 2)).toEqual([100, 50])
    expect(monthlyValues(r, 'credit').slice(0, 2)).toEqual([0, 20])
  })

  it('年度表只列末级，合计 / 月均 / 比例与示范一致', () => {
    const { rows, totals, total, average } = buildAnnualRows(sample, 'balance')
    expect(rows.map(r => r.account_code)).not.toContain('6602')
    expect(rows).toHaveLength(7)
    expect(totals[11]).toBe(24256.35)
    expect(total).toBe(24256.35)
    expect(average).toBe(2021.36)
    const salary = rows.find(r => r.account_code === '6602009')!
    expect(salary.total).toBe(16341.55)
    expect(salary.ratio).toBe(67.37)
  })

  it('月度表隐藏无发生额行，本月数 / 本年累计 / 比例正确', () => {
    const { rows, currentTotal, ytdTotal } = buildMonthlyRows(sample, 12, 'balance')
    expect(rows.map(r => r.account_code)).toEqual([
      '6602001',
      '6602002',
      '6602004',
      '6602007',
      '6602008',
      '6602009',
    ])
    expect(currentTotal).toBe(24256.35)
    expect(ytdTotal).toBe(24256.35)
    const comm = rows[0]
    expect(comm.current).toBe(450.21)
    expect(comm.currentRatio).toBe(1.86)
    expect(comm.ytdRatio).toBe(1.86)
  })

  it('月度余额口径：本月数为净变动，本年累计为月末余额', () => {
    const r = row('a', 'a', { 1: { debit: 100 }, 2: { debit: 50 } })
    const { rows } = buildMonthlyRows([r], 2, 'balance')
    expect(rows[0].current).toBe(50)
    expect(rows[0].ytd).toBe(150)
  })
})

describe('resolvePresetAccount', () => {
  const accounts = [
    { code: '5101', name: '单位管理费用', level: 1 },
    { code: '6602', name: '管理费用', level: 1 },
    { code: '1122', name: '应收账款', level: 1 },
  ]

  it('名称优先匹配', () => {
    expect(resolvePresetAccount('admin', accounts)?.code).toBe('6602')
    expect(resolvePresetAccount('ar', accounts)?.code).toBe('1122')
  })

  it('政府科目仅有「单位管理费用」时按名称兜底', () => {
    expect(resolvePresetAccount('admin', accounts.filter(a => a.code !== '6602'))?.code).toBe('5101')
  })

  it('找不到返回 null；custom 恒为 null', () => {
    expect(resolvePresetAccount('sales', accounts)).toBeNull()
    expect(resolvePresetAccount('custom', accounts)).toBeNull()
  })
})
