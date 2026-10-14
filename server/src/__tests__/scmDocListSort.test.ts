import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { buildDocListOrderBy, DOC_LIST_SORT_WHITELIST } from '../services/scmDocListSort'

const AID = 'as1'
let db: Database.Database

beforeAll(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_partner (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_warehouse (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE vouchers (id TEXT, account_set_id TEXT, voucher_no TEXT);
    CREATE TABLE scm_doc (id TEXT PRIMARY KEY, account_set_id TEXT, doc_type TEXT, doc_no TEXT, doc_date TEXT, partner_code TEXT,
      warehouse_code TEXT, dest_warehouse_code TEXT, total_qty REAL, total_amount REAL, total_tax REAL, voucher_id TEXT,
      source_doc_id TEXT, biz_person TEXT, field_values TEXT, status TEXT, remark TEXT);
  `)
  for (const [c, n] of [['C1', 'B客户'], ['C2', 'A客户'], ['C3', 'C客户']]) db.prepare('INSERT INTO scm_partner VALUES (?,?,?,?)').run(c, AID, c, n)
  db.prepare('INSERT INTO scm_warehouse VALUES (?,?,?,?)').run('W1', AID, 'W1', '成品仓')
  db.prepare('INSERT INTO vouchers VALUES (?,?,?)').run('V1', AID, '记-002')
  db.prepare('INSERT INTO vouchers VALUES (?,?,?)').run('V2', AID, '记-001')
  const ins = db.prepare('INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,total_qty,total_amount,total_tax,voucher_id,source_doc_id,field_values) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  //      id    set  type  no     date          partner qty  amount tax  voucher source  field_values
  ins.run('d1', AID, 'SO', 'S-01', '2026-10-01', 'C1', 'W1', 3, 100, 10, null, null, JSON.stringify({ level: 'B' }))
  ins.run('d2', AID, 'SO', 'S-02', '2026-10-02', 'C2', 'W1', 5, 300, 0, 'V1', 'd1', JSON.stringify({ level: 'A' }))
  ins.run('d3', AID, 'SO', 'S-03', '2026-10-02', 'C2', 'W1', 1, 200, 0, 'V2', 'd1', 'not-json')
  ins.run('d4', AID, 'SO', 'S-04', '2026-10-03', 'C3', null, 9, 50, 5, null, 'd2', null)
  ins.run('d5', 'other', 'SO', 'S-05', '2026-10-09', 'C1', 'W1', 1, 1, 0, null, null, null)
})

const ids = (sort: unknown) =>
  (db.prepare(`SELECT d.id FROM scm_doc d WHERE d.account_set_id=? ${buildDocListOrderBy(sort).sql}`).all(AID) as any[]).map(r => r.id)

describe('buildDocListOrderBy', () => {
  it('未传 sort：日期降序、单据号降序（旧行为）', () => {
    expect(ids(undefined)).toEqual(['d4', 'd3', 'd2', 'd1'])
    expect(ids('nonsense:asc')).toEqual(['d4', 'd3', 'd2', 'd1'])
  })
  it('第一排序 往来单位名升序 → 第二排序 金额降序', () => {
    // A客户(d2 300, d3 200) → B客户(d1) → C客户(d4)；名称按 SQLite 二进制序（中文即 Unicode 码点序，非拼音）
    expect(ids('partner:asc,total_amount:desc')).toEqual(['d2', 'd3', 'd1', 'd4'])
  })
  it('价税合计 = 金额 + 税额，三级排序', () => {
    // 价税合计：d1 110, d2 300, d3 200, d4 55
    expect(ids('total_with_tax:desc')).toEqual(['d2', 'd3', 'd1', 'd4'])
    expect(ids('doc_date:desc,total_qty:asc')).toEqual(['d4', 'd3', 'd2', 'd1'])   // 同日 10-02：数量 1(d3) < 5(d2)
  })
  it('仓库为空的单据始终排最后（无论升降序）', () => {
    expect(ids('warehouse:asc').at(-1)).toBe('d4')
    expect(ids('warehouse:desc').at(-1)).toBe('d4')
  })
  it('凭证号 / 源单号（相关子查询）', () => {
    expect(ids('voucher_no:asc').slice(0, 2)).toEqual(['d3', 'd2'])   // 记-001(d3) < 记-002(d2)，其余无凭证置后
    expect(ids('source_doc_no:asc')).toEqual(['d3', 'd2', 'd4', 'd1'])   // S-01(d3,d2 同值按单据号降序兜底) < S-02(d4)，无源单的 d1 置后
  })
  it('自定义字段 cf:level（含非法 JSON 的行不报错，置后）', () => {
    const r = ids('cf:level:asc')
    expect(r.slice(0, 2)).toEqual(['d2', 'd1'])   // A < B；d3 非 JSON、d4 为空 → 置后
    expect(new Set(r.slice(2))).toEqual(new Set(['d3', 'd4']))
  })
  it('自定义字段键含非法字符 → 被忽略，回退默认排序，且不会产生注入', () => {
    const r = buildDocListOrderBy("cf:a'); DROP TABLE scm_doc;--:asc")
    expect(r.applied).toEqual([])
    expect(r.sql).not.toMatch(/DROP/)
  })
  it('白名单覆盖前端 LIST_ALL_COLS 中除 push 外的全部标准列', () => {
    const frontKeys = ['doc_no', 'doc_date', 'doc_type', 'partner', 'warehouse', 'dest_warehouse', 'biz_person', 'dept_code', 'contract_no', 'payment_type',
      'settle_account', 'io_category', 'transport_method', 'expect_date', 'credit_days', 'due_date', 'invoice_type', 'invoice_no', 'invoice_date', 'currency',
      'exchange_rate', 'discount_rate', 'tax_rate', 'total_qty', 'total_amount', 'total_tax', 'total_with_tax', 'operator', 'maker', 'created_at', 'auditor',
      'audited_at', 'updated_at', 'source_doc_no', 'voucher_no', 'print_count', 'status', 'remark']
    for (const k of frontKeys) expect(DOC_LIST_SORT_WHITELIST[k], k).toBeTruthy()
    expect(DOC_LIST_SORT_WHITELIST.push).toBeUndefined()
  })
})
