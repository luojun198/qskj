import { describe, expect, it } from 'vitest'
import { groupAndSortAcdVoucherEntries } from '../scripts/importAcdToCurrentAccountSet.js'

/** 构造最小 pz 行：nf,yf,pzlx,pzbh,pz_xh,kmbm,... */
function pz(
  nf: string,
  yf: string,
  pzlx: string,
  pzbh: string,
  xh: string,
  kmbm: string
): string[] {
  return [nf, yf, pzlx, pzbh, xh, kmbm, '摘要', '100', '0', '0', '0']
}

describe('groupAndSortAcdVoucherEntries - ACD 凭证/分录顺序', () => {
  it('文件乱序时仍按凭证号排序，同一凭证内按 pz_xh 排序', () => {
    // 模拟客户现场：收-18 出现在收-1 之前，且分录 xh 颠倒
    const rows = [
      pz('2025', '12', '2', '18', '2', '1122'),
      pz('2025', '12', '2', '18', '1', '1002'),
      pz('2025', '1', '1', '25', '1', '5602'),
      pz('2025', '1', '2', '4', '1', '1001'),
      pz('2025', '1', '2', '1', '2', '1122'),
      pz('2025', '1', '2', '1', '1', '1002'),
    ]

    const { voucherGroups, sortedGroupKeys } = groupAndSortAcdVoucherEntries(rows)

    expect(sortedGroupKeys).toEqual([
      '2025|1|1|25',
      '2025|1|2|1',
      '2025|1|2|4',
      '2025|12|2|18',
    ])

    expect(voucherGroups.get('2025|1|2|1')!.map(r => r[4])).toEqual(['1', '2'])
    expect(voucherGroups.get('2025|1|2|1')!.map(r => r[5])).toEqual(['1002', '1122'])
    expect(voucherGroups.get('2025|12|2|18')!.map(r => r[4])).toEqual(['1', '2'])
    expect(voucherGroups.get('2025|12|2|18')!.map(r => r[5])).toEqual(['1002', '1122'])
  })

  it('凭证数量与分组键一致，不会因乱序丢行', () => {
    const rows = [
      pz('2026', '9', '3', '80', '1', '1001'),
      pz('2026', '9', '3', '82', '1', '1001'),
      pz('2026', '9', '3', '81', '2', '1122'),
      pz('2026', '9', '3', '81', '1', '1002'),
    ]
    const { voucherGroups, sortedGroupKeys } = groupAndSortAcdVoucherEntries(rows)
    expect(sortedGroupKeys).toEqual(['2026|9|3|80', '2026|9|3|81', '2026|9|3|82'])
    expect(voucherGroups.size).toBe(3)
    expect(voucherGroups.get('2026|9|3|81')!.map(r => r[5])).toEqual(['1002', '1122'])
  })
})
