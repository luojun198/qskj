/**
 * 阶段 C-1：BOM 版本/生效期选版 + 替代料组折叠。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { pickActiveBom, bomComponents, substituteStock } from '../services/scmBom.js'

const AID = 'BOM-T'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE scm_bom (id TEXT, account_set_id TEXT, code TEXT, item_code TEXT, status TEXT, is_default INTEGER DEFAULT 0,
      version TEXT, effective_date TEXT, expire_date TEXT);
    CREATE TABLE scm_bom_line (id TEXT, account_set_id TEXT, bom_id TEXT, seq INTEGER, item_code TEXT, qty REAL, unit TEXT,
      scrap_rate REAL DEFAULT 0, remark TEXT, line_type TEXT DEFAULT 'component', sub_group TEXT, sub_priority INTEGER);
    CREATE TABLE scm_stock (account_set_id TEXT, warehouse_code TEXT, item_code TEXT, qty REAL);
  `)
  return d
}
const bom = (id: string, item: string, opts: Partial<{ status: string; is_default: number; version: string; eff: string | null; exp: string | null }> = {}) =>
  db.prepare('INSERT INTO scm_bom (id,account_set_id,code,item_code,status,is_default,version,effective_date,expire_date) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, AID, id, item, opts.status ?? 'active', opts.is_default ?? 0, opts.version ?? '1.0', opts.eff ?? null, opts.exp ?? null)
const line = (bomId: string, seq: number, item: string, qty: number, group: string | null = null, prio = 0, type = 'component') =>
  db.prepare('INSERT INTO scm_bom_line (id,account_set_id,bom_id,seq,item_code,qty,line_type,sub_group,sub_priority) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`${bomId}-${seq}`, AID, bomId, seq, item, qty, type, group, prio)

describe('BOM 选版（版本 / 生效期）', () => {
  beforeEach(() => { db = createDb() })

  it('按日期只取生效期覆盖的版本；同期多版取默认，再取生效日晚者', () => {
    bom('B1', 'FP', { version: '1.0', eff: '2026-01-01', exp: '2026-06-30' })
    bom('B2', 'FP', { version: '2.0', eff: '2026-07-01', exp: null })
    expect(pickActiveBom(db, AID, 'FP', '2026-03-15')?.id).toBe('B1')
    expect(pickActiveBom(db, AID, 'FP', '2026-09-10')?.id).toBe('B2')
    expect(pickActiveBom(db, AID, 'FP', '2025-12-31')).toBeNull()
    bom('B3', 'FP', { version: '2.1', eff: '2026-08-01', exp: null })
    expect(pickActiveBom(db, AID, 'FP', '2026-09-10')?.id).toBe('B3')       // 生效日更晚
    bom('B4', 'FP', { version: '1.5', eff: '2026-07-15', exp: null, is_default: 1 })
    expect(pickActiveBom(db, AID, 'FP', '2026-09-10')?.id).toBe('B4')       // 默认优先
    bom('B5', 'FP', { version: '9.9', eff: null, exp: null, status: 'inactive' })
    expect(pickActiveBom(db, AID, 'FP', '2026-09-10')?.id).toBe('B4')       // 停用不参与
  })

  it('未填生效期的版本任何日期都可用', () => {
    bom('B0', 'FP')
    expect(pickActiveBom(db, AID, 'FP', '2000-01-01')?.id).toBe('B0')
    expect(pickActiveBom(db, AID, 'FP')?.id).toBe('B0')
  })
})

describe('BOM 替代料组', () => {
  beforeEach(() => { db = createDb() })

  it('同组折叠为主料一行（优先级最小者），其余挂 substitutes；副产品不进用料', () => {
    bom('B1', 'FP')
    line('B1', 1, 'M-A', 2)
    line('B1', 2, 'M-B2', 3, 'G1', 2)
    line('B1', 3, 'M-B1', 3, 'G1', 1)
    line('B1', 4, 'M-B3', 3, 'G1', 3)
    line('B1', 5, 'BY', 1, null, 0, 'by_product')
    const comps = bomComponents(db, 'B1')
    expect(comps.map(c => c.item_code)).toEqual(['M-A', 'M-B1'])
    expect(comps[1].substitutes.map(s => s.item_code)).toEqual(['M-B2', 'M-B3'])
  })

  it('替代料在库量按优先级给出', () => {
    bom('B1', 'FP')
    line('B1', 1, 'M-B1', 3, 'G1', 1)
    line('B1', 2, 'M-B2', 3, 'G1', 2)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'W1', 'M-B2', 40)
    db.prepare('INSERT INTO scm_stock VALUES (?,?,?,?)').run(AID, 'W2', 'M-B2', 5)
    const comp = bomComponents(db, 'B1')[0]
    expect(substituteStock(db, AID, comp)).toEqual([{ item_code: 'M-B2', sub_priority: 2, on_hand: 45 }])
    expect(substituteStock(db, AID, comp, 'W1')[0].on_hand).toBe(40)
  })
})
