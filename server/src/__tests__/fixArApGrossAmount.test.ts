/**
 * FIX-103 数据迁移脚本：历史不含税往来台账补成价税合计。
 * 重点验证「只改确实是旧口径的记录」与「可重复执行」。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { fixArApGrossAmount } from '../scripts/fixArApGrossAmount.js'

const AID = 'MIG-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT);
    CREATE TABLE scm_doc_line (id TEXT, account_set_id TEXT, doc_id TEXT, amount REAL, tax_amount REAL);
    CREATE TABLE scm_ar_ap_log (id TEXT, account_set_id TEXT, doc_type TEXT, doc_no TEXT,
      direction TEXT, amount REAL, verified_amount REAL DEFAULT 0);
  `)
  return db
}

/** 建一张单据 + 一条对应的往来台账 */
function seed(db: Database.Database, docType: string, docNo: string,
  lines: Array<[number, number]>, logAmount: number, verified = 0, direction = 'in') {
  const docId = uuidv4()
  db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no) VALUES (?,?,?,?)').run(docId, AID, docType, docNo)
  for (const [amount, tax] of lines) {
    db.prepare('INSERT INTO scm_doc_line (id,account_set_id,doc_id,amount,tax_amount) VALUES (?,?,?,?,?)')
      .run(uuidv4(), AID, docId, amount, tax)
  }
  db.prepare('INSERT INTO scm_ar_ap_log (id,account_set_id,doc_type,doc_no,direction,amount,verified_amount) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), AID, docType, docNo, direction, logAmount, verified)
}

const amountOf = (db: Database.Database, docNo: string) =>
  (db.prepare('SELECT amount FROM scm_ar_ap_log WHERE doc_no=?').get(docNo) as any).amount
const actionOf = (res: any, docNo: string) => res.rows.find((r: any) => r.doc_no === docNo)?.action

describe('fixArApGrossAmount 往来台账补税迁移', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('默认试运行不写库，只报告将要做的改动', () => {
    seed(db, 'SO', 'SO-1', [[1000, 130]], 1000)
    const res = fixArApGrossAmount(AID, { db })
    expect(res.applied).toBe(false)
    expect(res.updated).toBe(1)
    expect(actionOf(res, 'SO-1')).toBe('update')
    expect(amountOf(db, 'SO-1')).toBe(1000)   // 未写库
  })

  it('--apply 后把不含税金额补成价税合计', () => {
    seed(db, 'SO', 'SO-1', [[1000, 130], [500, 65]], 1500)
    const res = fixArApGrossAmount(AID, { db, apply: true })
    expect(res.updated).toBe(1)
    expect(amountOf(db, 'SO-1')).toBe(1695)
  })

  it('可重复执行：第二次运行认出已是含税，不再改动', () => {
    seed(db, 'PI', 'PI-1', [[1000, 130]], 1000)
    fixArApGrossAmount(AID, { db, apply: true })
    expect(amountOf(db, 'PI-1')).toBe(1130)

    const again = fixArApGrossAmount(AID, { db, apply: true })
    expect(again.updated).toBe(0)
    expect(again.alreadyGross).toBe(1)
    expect(amountOf(db, 'PI-1')).toBe(1130)
  })

  it('金额被手工改过的记录跳过，不被脚本覆盖', () => {
    // 现值 1200 既不等于净额 1000 也不等于含税 1130 → 人工调整过
    seed(db, 'SO', 'SO-2', [[1000, 130]], 1200)
    const res = fixArApGrossAmount(AID, { db, apply: true })
    expect(actionOf(res, 'SO-2')).toBe('skip_mismatch')
    expect(amountOf(db, 'SO-2')).toBe(1200)
  })

  it('找不到来源单据明细的记录跳过', () => {
    db.prepare('INSERT INTO scm_ar_ap_log (id,account_set_id,doc_type,doc_no,direction,amount) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), AID, 'SO', 'SO-GONE', 'in', 800)
    const res = fixArApGrossAmount(AID, { db, apply: true })
    expect(actionOf(res, 'SO-GONE')).toBe('skip_no_source')
    expect(amountOf(db, 'SO-GONE')).toBe(800)
  })

  it('无税单据（税额为 0）已等于含税额，不产生改动', () => {
    seed(db, 'SO', 'SO-3', [[400, 0]], 400)
    const res = fixArApGrossAmount(AID, { db, apply: true })
    expect(actionOf(res, 'SO-3')).toBe('already_gross')
    expect(amountOf(db, 'SO-3')).toBe(400)
  })

  it('只处理 SO/PI 的 in 方向，收付款(out)与发票不受影响', () => {
    seed(db, 'SO', 'SO-OUT', [[1000, 130]], 1000, 0, 'out')
    seed(db, 'RP', 'RP-1', [[1000, 130]], 1000)
    const res = fixArApGrossAmount(AID, { db, apply: true })
    expect(res.rows).toHaveLength(0)
    expect(amountOf(db, 'SO-OUT')).toBe(1000)
    expect(amountOf(db, 'RP-1')).toBe(1000)
  })

  it('不传账套时扫描全部账套', () => {
    seed(db, 'SO', 'SO-1', [[1000, 130]], 1000)
    const res = fixArApGrossAmount(undefined, { db })
    expect(res.rows).toHaveLength(1)
  })
})
