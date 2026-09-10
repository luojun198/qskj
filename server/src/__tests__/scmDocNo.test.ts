/**
 * S12：单据号的年月取自单据日期，而非服务器当前日期。
 *
 * 补录上月单据时若按当前月取号，{YYYY}{MM} 规则下的单号月份会与单据期间对不上。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))

import { nextDocNo } from '../routes/scmDoc.js'

const AID = 'DN-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT);
  `)
  return db
}
const addDoc = (db: Database.Database, no: string, type = 'PI') =>
  db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no) VALUES (?,?,?,?)').run(uuidv4(), AID, type, no)

describe('S12 单据号按单据日期取号', () => {
  beforeEach(() => { testDb = createDb() })

  it('默认规则下年月取自 doc_date', () => {
    expect(nextDocNo(testDb, AID, 'PI', '2026-03-15')).toBe('202603-PI-001')
  })

  it('同月已有单据时序号递增；不同月各自独立起号', () => {
    addDoc(testDb, '202603-PI-001')
    addDoc(testDb, '202603-PI-002')
    expect(nextDocNo(testDb, AID, 'PI', '2026-03-20')).toBe('202603-PI-003')
    // 4 月是新号段，不受 3 月已有单据影响
    expect(nextDocNo(testDb, AID, 'PI', '2026-04-01')).toBe('202604-PI-001')
  })

  it('未传 doc_date 时退回服务器当前日期（保持原行为）', () => {
    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(nextDocNo(testDb, AID, 'PI')).toBe(`${ym}-PI-001`)
  })

  it('非法日期串退回当前日期，不产生 NaN 单号', () => {
    expect(nextDocNo(testDb, AID, 'PI', 'not-a-date')).not.toMatch(/NaN/)
  })

  it('自定义规则同样按单据日期展开', () => {
    testDb.prepare("INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)")
      .run(uuidv4(), AID, 'scm:doc_no_rule', '{CODE}{YY}{MM}{DD}-{SEQ:4}')
    expect(nextDocNo(testDb, AID, 'SO', '2026-03-05')).toBe('SO260305-0001')
  })
})
