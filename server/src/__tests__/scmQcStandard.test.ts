/**
 * 质检检验标准 / 抽样 / 判定引擎 + IQC 入库闸。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { saveQcStandard, resolveQcStandard, sampleSize, judgeLine, judgeDoc, writeQcLineResults, readQcLineResults, listQcStandards, deleteQcStandard } from '../services/scmQcStandard.js'
import { validateReceiptQc, QC_REQUIRED_FOR_RECEIPT_PARAM } from '../services/scmQcControl.js'

const AID = 'QC-STD'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, spec TEXT);
    CREATE TABLE scm_qc_standard (id TEXT PRIMARY KEY, account_set_id TEXT, item_code TEXT, qc_type TEXT DEFAULT '', name TEXT,
      sampling_mode TEXT DEFAULT 'full', sampling_value REAL DEFAULT 0, min_sample REAL DEFAULT 1, accept_defects REAL DEFAULT 0,
      is_enabled INTEGER DEFAULT 1, remark TEXT, created_at TEXT, updated_at TEXT, UNIQUE(account_set_id, item_code, qc_type));
    CREATE TABLE scm_qc_standard_item (id TEXT PRIMARY KEY, account_set_id TEXT, standard_id TEXT, seq INTEGER, name TEXT, method TEXT,
      value_type TEXT, target REAL, lower_limit REAL, upper_limit REAL, unit TEXT, is_key INTEGER, remark TEXT);
    CREATE TABLE scm_qc_line_result (id TEXT PRIMARY KEY, account_set_id TEXT, qc_line_id TEXT, standard_item_id TEXT, seq INTEGER, name TEXT,
      value_type TEXT, target REAL, lower_limit REAL, upper_limit REAL, unit TEXT, is_key INTEGER, value_num REAL, value_bool INTEGER, passed INTEGER, remark TEXT);
    CREATE TABLE scm_qc_doc (id TEXT, account_set_id TEXT, qc_no TEXT, qc_type TEXT, source_doc_id TEXT, source_doc_no TEXT, result TEXT, status TEXT);
    CREATE TABLE scm_qc_line (id TEXT, account_set_id TEXT, qc_doc_id TEXT, item_code TEXT, qualified_qty REAL, defect_qty REAL);
  `)
  d.prepare('INSERT INTO scm_item VALUES (?,?,?,?)').run(AID, 'M1', '物料甲', null)
  return d
}

const STD = {
  item_code: 'M1', qc_type: 'IQC', sampling_mode: 'percent', sampling_value: 10, min_sample: 5, accept_defects: 1,
  items: [
    { name: '直径', value_type: 'numeric', lower_limit: 9.8, upper_limit: 10.2, unit: 'mm', is_key: 1 },
    { name: '外观', value_type: 'bool', is_key: 0 },
  ],
}

describe('检验标准与抽样', () => {
  beforeEach(() => { db = createDb() })

  it('新增 / 解析：精确类型优先于通用；停用不参与；同物料同类型不可重复', () => {
    const generic = saveQcStandard(db, AID, { ...STD, qc_type: '', accept_defects: 3 })
    const iqc = saveQcStandard(db, AID, STD)
    expect(resolveQcStandard(db, AID, 'M1', 'IQC')?.id).toBe(iqc)
    expect(resolveQcStandard(db, AID, 'M1', 'FQC')?.id).toBe(generic)
    expect(resolveQcStandard(db, AID, 'M1', 'FQC')?.items).toHaveLength(2)
    expect(() => saveQcStandard(db, AID, STD)).toThrow(/已存在/)
    saveQcStandard(db, AID, { ...STD, is_enabled: 0 }, iqc)
    expect(resolveQcStandard(db, AID, 'M1', 'IQC')?.id).toBe(generic)
    expect(listQcStandards(db, AID)).toHaveLength(2)
    deleteQcStandard(db, AID, iqc)
    expect(listQcStandards(db, AID)).toHaveLength(1)
  })

  it('校验：比例区间、固定数、检验项上下限、至少一项', () => {
    expect(() => saveQcStandard(db, AID, { ...STD, sampling_value: 120 })).toThrow(/比例/)
    expect(() => saveQcStandard(db, AID, { ...STD, sampling_mode: 'fixed', sampling_value: 0 })).toThrow(/固定抽样/)
    expect(() => saveQcStandard(db, AID, { ...STD, items: [{ name: 'x', lower_limit: 5, upper_limit: 1 }] })).toThrow(/下限大于上限/)
    expect(() => saveQcStandard(db, AID, { ...STD, items: [] })).toThrow(/至少/)
  })

  it('抽样数：全检 / 比例（向上取整、不低于最小样本、不超检验数）/ 固定', () => {
    expect(sampleSize({ sampling_mode: 'full', sampling_value: 0, min_sample: 1 }, 37)).toBe(37)
    expect(sampleSize({ sampling_mode: 'percent', sampling_value: 10, min_sample: 5 }, 37)).toBe(5)
    expect(sampleSize({ sampling_mode: 'percent', sampling_value: 10, min_sample: 5 }, 120)).toBe(12)
    expect(sampleSize({ sampling_mode: 'percent', sampling_value: 10, min_sample: 5 }, 3)).toBe(3)
    expect(sampleSize({ sampling_mode: 'fixed', sampling_value: 8, min_sample: 1 }, 100)).toBe(8)
    expect(sampleSize({ sampling_mode: 'fixed', sampling_value: 8, min_sample: 1 }, 6)).toBe(6)
    expect(sampleSize(null, 6)).toBe(6)
  })
})

describe('判定引擎', () => {
  beforeEach(() => { db = createDb() })
  const numeric = (v: number | null, key = 1) => ({ name: '直径', value_type: 'numeric' as const, lower_limit: 9.8, upper_limit: 10.2, is_key: key, value_num: v })
  const bool = (v: number | null, key = 0) => ({ name: '外观', value_type: 'bool' as const, is_key: key, value_bool: v })

  it('关键项超限 → 不合格；非关键项不合格只记录；未填关键项 → 待检', () => {
    expect(judgeLine([numeric(10.0), bool(1)], 0, 1)).toBe(true)
    expect(judgeLine([numeric(10.3), bool(1)], 0, 1)).toBe(false)
    expect(judgeLine([numeric(10.0), bool(0)], 0, 1)).toBe(true)
    expect(judgeLine([numeric(10.0), bool(0, 1)], 0, 1)).toBe(false)
    expect(judgeLine([numeric(null), bool(1)], 0, 1)).toBeNull()
    expect(judgeLine([numeric(10.0)], 2, 1)).toBe(false)     // 不良 2 > 允收 1
    expect(judgeLine([numeric(10.0)], 1, 1)).toBe(true)
  })

  it('整单：任一行不合格 → fail；有待检 → null；无逐项结果 → null（沿用人工）', () => {
    expect(judgeDoc([{ item_code: 'M1', defect_qty: 0, results: [numeric(10)], accept_defects: 0 }, { item_code: 'M2', defect_qty: 0, results: [numeric(9)], accept_defects: 0 }])).toBe('fail')
    expect(judgeDoc([{ item_code: 'M1', defect_qty: 0, results: [numeric(10)], accept_defects: 0 }])).toBe('pass')
    expect(judgeDoc([{ item_code: 'M1', defect_qty: 0, results: [numeric(null)], accept_defects: 0 }])).toBeNull()
    expect(judgeDoc([{ item_code: 'M1', defect_qty: 5, results: [], accept_defects: 0 }])).toBeNull()
  })

  it('逐项结果落库并回读，passed 已判定', () => {
    writeQcLineResults(db, AID, 'L1', [numeric(10.5), bool(1)])
    const rows = readQcLineResults(db, 'L1')
    expect(rows.map(r => [r.name, r.passed])).toEqual([['直径', 0], ['外观', 1]])
    writeQcLineResults(db, AID, 'L1', undefined)
    expect(readQcLineResults(db, 'L1')).toHaveLength(0)
  })
})

describe('采购入库 IQC 闸', () => {
  beforeEach(() => { db = createDb() })
  const pi = { id: 'PI1', doc_no: 'PI-001', doc_type: 'PI' }
  const lines = [{ item_code: 'M1', qty: 10 }]
  const qc = (id: string, opts: Partial<{ result: string; status: string; src: string | null; srcNo: string | null }> = {}) =>
    db.prepare('INSERT INTO scm_qc_doc VALUES (?,?,?,?,?,?,?,?)').run(id, AID, 'IQC-' + id, 'IQC', opts.src === undefined ? 'PI1' : opts.src, opts.srcNo ?? null, opts.result ?? 'pass', opts.status ?? 'audited')
  const qcLine = (qcId: string, item: string, qualified: number) =>
    db.prepare('INSERT INTO scm_qc_line VALUES (?,?,?,?,?,?)').run(qcId + item, AID, qcId, item, qualified, 0)

  it('参数未开启不校验；开启后无合格 IQC 拦截；合格数不足拦截；覆盖后放行；让步接收也放行', () => {
    expect(validateReceiptQc(db, AID, pi, lines)).toBeNull()
    db.prepare('INSERT INTO system_params VALUES (?,?,?,?)').run('p', AID, QC_REQUIRED_FOR_RECEIPT_PARAM, '1')
    expect(validateReceiptQc(db, AID, pi, lines)).toMatch(/没有判定合格/)
    qc('Q1'); qcLine('Q1', 'M1', 6)
    expect(validateReceiptQc(db, AID, pi, lines)).toMatch(/少于入库数/)
    qc('Q2', { result: 'concession', src: null, srcNo: 'PI-001' }); qcLine('Q2', 'M1', 4)
    expect(validateReceiptQc(db, AID, pi, lines)).toBeNull()
    expect(validateReceiptQc(db, AID, pi, [{ item_code: 'M9', qty: 1 }])).toMatch(/未覆盖物料 M9/)
    expect(validateReceiptQc(db, AID, { ...pi, doc_type: 'SO' }, lines)).toBeNull()
  })
})
