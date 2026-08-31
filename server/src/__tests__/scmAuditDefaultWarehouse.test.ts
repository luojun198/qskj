import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyAuditDefaultWarehouses, inspectAuditDefaultWarehouses } from '../services/scmAuditDefaultWarehouse.js'

const AID = 'A1'

function setup(defaults: Array<string | null>) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, default_warehouse_code TEXT);
    CREATE TABLE scm_warehouse (account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, warehouse_code TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, warehouse_code TEXT);
  `)
  db.prepare('INSERT INTO scm_doc VALUES (?,?,?)').run('D1', AID, null)
  db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?)').run(AID, 'WH0001', '主干仓库')
  db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?)').run(AID, 'WH0002', '配件专库')
  defaults.forEach((warehouse, index) => db.prepare('INSERT INTO scm_item VALUES (?,?,?,?)').run(AID, `I${index + 1}`, `物料${index + 1}`, warehouse))
  return db
}

describe('审核时物料默认仓库补救', () => {
  it('首次可汇总待确认仓库，确认后补明细和一致的表头', () => {
    const db = setup(['WH0002', 'WH0002'])
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?)').run('L1', AID, 'D1', null)
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?)').run('L2', AID, 'D1', null)
    const lines = [{ id: 'L1', seq: 1, item_code: 'I1', qty: 1 }, { id: 'L2', seq: 2, item_code: 'I2', qty: 2 }]
    const result = inspectAuditDefaultWarehouses(db, AID, { id: 'D1' }, lines)
    expect(result).toMatchObject({ missing: [], candidates: [{ warehouse_code: 'WH0002', warehouse_name: '配件专库' }, { warehouse_code: 'WH0002' }] })
    expect(applyAuditDefaultWarehouses(db, AID, { id: 'D1' }, lines, result.candidates)).toBe('WH0002')
    expect(db.prepare('SELECT warehouse_code FROM scm_doc WHERE id=?').get('D1')).toMatchObject({ warehouse_code: 'WH0002' })
  })

  it('默认仓库不同只补明细，不填表头', () => {
    const db = setup(['WH0001', 'WH0002'])
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?)').run('L1', AID, 'D1', null)
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?)').run('L2', AID, 'D1', null)
    const lines = [{ id: 'L1', item_code: 'I1', qty: 1 }, { id: 'L2', item_code: 'I2', qty: 1 }]
    const result = inspectAuditDefaultWarehouses(db, AID, { id: 'D1' }, lines)
    expect(applyAuditDefaultWarehouses(db, AID, { id: 'D1' }, lines, result.candidates)).toBeNull()
    expect(db.prepare('SELECT warehouse_code FROM scm_doc WHERE id=?').get('D1')).toMatchObject({ warehouse_code: null })
  })

  it('存在无默认仓库物料时不产生可确认补仓库方案', () => {
    const db = setup([null])
    db.prepare('INSERT INTO scm_doc_line VALUES (?,?,?,?)').run('L1', AID, 'D1', null)
    const result = inspectAuditDefaultWarehouses(db, AID, { id: 'D1' }, [{ id: 'L1', seq: 1, item_code: 'I1', qty: 1 }])
    expect(result.candidates).toEqual([])
    expect(result.missing).toMatchObject([{ item_name: '物料1' }])
  })
})
