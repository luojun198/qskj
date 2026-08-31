import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildMrPushPreview, groupMrProductionPlanLines, resolveMrPushNodeSupplier } from '../services/scmMrPush.js'

const AID = 'A1'
const MR = 'MR1'

describe('缺料单多层 BOM 分层下推预览', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT, unit TEXT, source_type TEXT, supplier_code TEXT, purchase_price REAL);
      CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, status TEXT, source_doc_id TEXT, field_values TEXT);
      CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, seq INTEGER, item_code TEXT, warehouse_code TEXT, qty REAL, source_line_id TEXT, source_type TEXT, supplier_code TEXT, line_role TEXT);
      CREATE TABLE scm_bom (id TEXT, account_set_id TEXT, item_code TEXT, code TEXT, status TEXT, is_default INTEGER);
      CREATE TABLE scm_bom_line (id TEXT, bom_id TEXT, seq INTEGER, item_code TEXT, qty REAL, scrap_rate REAL, line_type TEXT);
      CREATE TABLE scm_stock (account_set_id TEXT, item_code TEXT, warehouse_code TEXT, qty REAL);
      CREATE TABLE scm_production_plan (id TEXT, account_set_id TEXT, status TEXT, source_doc_id TEXT);
      CREATE TABLE scm_production_plan_product (id TEXT, account_set_id TEXT, plan_id TEXT, item_code TEXT, plan_qty REAL, finished_qty REAL, source_line_id TEXT);
    `)
    db.prepare('INSERT INTO scm_doc VALUES (?,?,?,?,?,?)').run(MR, AID, 'MR', 'audited', null, '{}')
    const item = db.prepare('INSERT INTO scm_item VALUES (?,?,?,?,?,?,?,?)')
    item.run(AID, '9005', '成品', '', '件', 'self', '', 0)
    item.run(AID, '9002', '半成品', '', '件', 'self', '', 0)
    item.run(AID, 'R1', '原料1', '', '件', 'purchase', 'S1', 2)
    item.run(AID, 'R2', '原料2', '', '件', 'purchase', 'S1', 3)
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('MR-L1', AID, MR, 1, '9005', '', 10, null, 'self', '', null)
    const bom = db.prepare('INSERT INTO scm_bom VALUES (?,?,?,?,?,?)')
    bom.run('B1', AID, '9005', 'BOM-9005', 'active', 1)
    bom.run('B2', AID, '9002', 'BOM-9002', 'active', 1)
    const line = db.prepare('INSERT INTO scm_bom_line VALUES (?,?,?,?,?,?,?)')
    line.run('B1-L1', 'B1', 1, '9002', 1, 0, 'component')
    line.run('B1-L2', 'B1', 2, 'R1', 2, 0, 'component')
    line.run('B2-L1', 'B2', 1, 'R2', 3, 0, 'component')
  })

  it('9005→9002→原料应返回全部层级', () => {
    const result = buildMrPushPreview(db, AID, MR)
    expect(result.has_cycle).toBe(false)
    expect(result.nodes.map(node => [node.item_code, node.level, node.suggest_qty])).toEqual([
      ['9005', 0, 10],
      ['9002', 1, 10],
      ['R1', 1, 20],
      ['R2', 2, 30],
    ])
  })

  it('半成品库存和外部未完工工单只扣一次，并按净需求展开下层', () => {
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, '9002', 'W1', 4)
    db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?)').run('EXT-P', AID, 'released', null)
    db.prepare('INSERT INTO scm_production_plan_product VALUES (?,?,?,?,?,?,?)').run('EXT-PP', AID, 'EXT-P', '9002', 3, 1, null)
    const result = buildMrPushPreview(db, AID, MR)
    expect(result.nodes.find(node => node.item_code === '9002')).toMatchObject({
      dependent_gross_qty: 10, stock_qty: 4, external_supply_qty: 2, required_qty: 4, suggest_qty: 4,
    })
    expect(result.nodes.find(node => node.item_code === 'R2')?.suggest_qty).toBe(12)
  })

  it('父工单已生成后父项建议归零，但子层需求仍保留', () => {
    db.prepare('INSERT INTO scm_production_plan VALUES (?,?,?,?)').run('MR-P', AID, 'draft', MR)
    db.prepare('INSERT INTO scm_production_plan_product VALUES (?,?,?,?,?,?,?)').run('MR-PP', AID, 'MR-P', '9005', 10, 0, 'MR-L1')
    const result = buildMrPushPreview(db, AID, MR)
    expect(result.nodes.find(node => node.item_code === '9005')?.suggest_qty).toBe(0)
    expect(result.nodes.find(node => node.item_code === '9002')?.suggest_qty).toBe(10)
    expect(result.nodes.find(node => node.item_code === 'R2')?.suggest_qty).toBe(30)
  })

  it('公共采购件先汇总后统一扣库存', () => {
    db.prepare('INSERT INTO scm_bom_line VALUES (?,?,?,?,?,?,?)').run('B2-L2', 'B2', 2, 'R1', 1, 0, 'component')
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'R1', 'W1', 5)
    const result = buildMrPushPreview(db, AID, MR)
    const raw = result.nodes.find(node => node.item_code === 'R1')!
    expect(raw.dependent_gross_qty).toBe(30)
    expect(raw.suggest_qty).toBe(25)
  })

  it('采购来源即使存在 BOM 也不继续展开', () => {
    db.prepare("UPDATE scm_item SET source_type='purchase' WHERE code='9002'").run()
    const result = buildMrPushPreview(db, AID, MR)
    expect(result.nodes.some(node => node.item_code === 'R2')).toBe(false)
    expect(result.nodes.find(node => node.item_code === '9002')?.source_type).toBe('purchase')
  })

  it('BOM 循环应显式返回并阻止后续生成', () => {
    db.prepare('INSERT INTO scm_bom_line VALUES (?,?,?,?,?,?,?)').run('B2-CYCLE', 'B2', 9, '9005', 1, 0, 'component')
    const result = buildMrPushPreview(db, AID, MR)
    expect(result.has_cycle).toBe(true)
    expect(result.cycles[0]).toEqual(['9005', '9002', '9005'])
  })
})

describe('MRP 下推供应商覆盖', () => {
  it('采购和委外节点使用本次选择的供应商，自制节点保持原值', () => {
    expect(resolveMrPushNodeSupplier('purchase', 'S1', 'S2')).toBe('S2')
    expect(resolveMrPushNodeSupplier('outsource', 'OS1', 'OS2')).toBe('OS2')
    expect(resolveMrPushNodeSupplier('self', 'S1', 'S2')).toBe('S1')
  })
})

describe('缺料下推生产计划按 BOM 依赖分组', () => {
  it('父件与直接、间接子件不得进入同一生产计划', () => {
    const nodes = [
      { item_code: '9005', parent_item_codes: [] },
      { item_code: '9002', parent_item_codes: ['9005'] },
      { item_code: '9001', parent_item_codes: ['9002'] },
    ]
    const lines = [
      { item_code: '9005', eff_source: 'self' as const, mr_level: 0 },
      { item_code: '9002', eff_source: 'self' as const, mr_level: 1 },
      { item_code: '9001', eff_source: 'self' as const, mr_level: 2 },
    ]

    const groups = groupMrProductionPlanLines(lines, nodes)
    expect(groups).toHaveLength(3)
    expect(groups.map(group => group.lines.map(line => line.item_code))).toEqual([
      ['9005'], ['9002'], ['9001'],
    ])
  })

  it('同层且互不依赖的自制物料仍合并', () => {
    const nodes = [
      { item_code: 'A', parent_item_codes: [] },
      { item_code: 'B', parent_item_codes: [] },
    ]
    const groups = groupMrProductionPlanLines([
      { item_code: 'A', eff_source: 'self' as const, mr_level: 0 },
      { item_code: 'B', eff_source: 'self' as const, mr_level: 0 },
    ], nodes)

    expect(groups).toHaveLength(1)
    expect(groups[0].lines.map(line => line.item_code)).toEqual(['A', 'B'])
  })

  it('层级数据异常时仍按祖先关系强制拆组', () => {
    const nodes = [
      { item_code: 'A', parent_item_codes: [] },
      { item_code: 'B', parent_item_codes: ['A'] },
      { item_code: 'C', parent_item_codes: ['B'] },
    ]
    const groups = groupMrProductionPlanLines([
      { item_code: 'A', eff_source: 'self' as const, mr_level: 0 },
      { item_code: 'C', eff_source: 'self' as const, mr_level: 0 },
    ], nodes)

    expect(groups).toHaveLength(2)
  })

  it('委外按供应商和 BOM 层级共同分组', () => {
    const lines = [
      { item_code: 'O1', eff_source: 'outsource' as const, eff_supplier: 'S1', mr_level: 1 },
      { item_code: 'O2', eff_source: 'outsource' as const, eff_supplier: 'S1', mr_level: 1 },
      { item_code: 'O3', eff_source: 'outsource' as const, eff_supplier: 'S1', mr_level: 2 },
      { item_code: 'O4', eff_source: 'outsource' as const, eff_supplier: 'S2', mr_level: 1 },
    ]
    const nodes = lines.map(line => ({ item_code: line.item_code, parent_item_codes: [] }))
    const groups = groupMrProductionPlanLines(lines, nodes)

    expect(groups).toHaveLength(3)
    expect(groups.map(group => [group.supplier_code, group.level, group.lines.length])).toEqual([
      ['S1', 1, 2], ['S1', 2, 1], ['S2', 1, 1],
    ])
  })
})
