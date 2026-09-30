import { describe, it, expect } from 'vitest'
import { buildImportDocs, normalizeImportDate } from '../services/scmDocImport.js'

const dicts: Record<string, any[]> = {
  scm_item: [{ code: 'A01', name: '螺丝', unit: '个', spec: 'M3' }, { code: 'A02', name: '螺母' }],
  scm_partner: [
    { code: 'S1', name: '供应商甲', partner_type: 'supplier' },
    { code: 'C1', name: '客户乙', partner_type: 'customer' },
  ],
  scm_warehouse: [{ code: 'W1', name: '主仓' }],
}
const db: any = { prepare: (sql: string) => ({ all: () => dicts[Object.keys(dicts).find(k => sql.includes(k))!] }) }

describe('buildImportDocs', () => {
  it('同分组号合并为一张单据，名称可匹配', () => {
    const { docs, issues } = buildImportDocs(db, 'a', 'PI', [
      { _row: 2, group_no: 'G1', partner: '供应商甲', item: 'A01', qty: 2, price: 3 },
      { _row: 3, group_no: 'G1', item: '螺母', qty: 1, price: 4 },
    ])
    expect(issues).toEqual([])
    expect(docs).toHaveLength(1)
    expect(docs[0].lines).toHaveLength(2)
    expect(docs[0].total_amount).toBe(10)
  })
  it('缺供应商、角色不符、物料不存在、数量非法均报错且整张剔除', () => {
    const { docs, issues } = buildImportDocs(db, 'a', 'PI', [
      { _row: 2, group_no: 'G1', item: 'A01', qty: 1 },
      { _row: 3, group_no: 'G2', partner: 'C1', item: 'A01', qty: 1 },
      { _row: 4, group_no: 'G3', partner: 'S1', item: 'X', qty: 1 },
      { _row: 5, group_no: 'G4', partner: 'S1', item: 'A01', qty: 0 },
      { _row: 6, group_no: 'G5', partner: 'S1', item: 'A01', qty: 1 },
    ])
    expect(docs.map(d => d.group_no)).toEqual(['G5'])
    expect(issues.map(i => i.row)).toEqual([2, 3, 4, 5])
  })
  it('分组号留空则每行一张；日期支持序列号', () => {
    const { docs } = buildImportDocs(db, 'a', 'IS', [
      { _row: 2, item: 'A01', qty: 1 }, { _row: 3, item: 'A02', qty: 1 },
    ])
    expect(docs).toHaveLength(2)
    expect(normalizeImportDate(45292)).toBe('2024-01-01')
    expect(normalizeImportDate('2024/2/30')).toBeNull()
  })
})
