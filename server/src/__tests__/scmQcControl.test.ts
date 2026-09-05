/**
 * 质检单与生产链路联动的单元测试（services/scmQcControl.ts）
 *
 * 质检单此前建了审了对入库和成本毫无影响，不良数量也只能人工另开单。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  getQcDefectLines,
  isQcRequiredForFinish,
  QC_REQUIRED_FOR_FINISH_PARAM,
  validateFinishQc,
  validateQcDefectPush,
} from '../services/scmQcControl.js'

const AID = 'AS-QC'
const PLAN = 'PLAN-1'
const PF_DOC = 'DOC-PF'

let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE scm_qc_doc (id TEXT, account_set_id TEXT, qc_no TEXT, qc_type TEXT, qc_date TEXT,
      source_doc_type TEXT, source_doc_id TEXT, result TEXT, status TEXT);
    CREATE TABLE scm_qc_line (id TEXT, account_set_id TEXT, qc_doc_id TEXT, seq INTEGER, item_code TEXT,
      batch_no TEXT, inspect_qty REAL, qualified_qty REAL, defect_qty REAL, defect_reason TEXT);
  `)
  return d
}

function enableParam(value = '1') {
  db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
    .run('p1', AID, QC_REQUIRED_FOR_FINISH_PARAM, value)
}

function qcDoc(id: string, opts: { type?: string; status?: string; result?: string; sourceId?: string | null; sourceType?: string } = {}) {
  db.prepare(
    'INSERT INTO scm_qc_doc (id,account_set_id,qc_no,qc_type,qc_date,source_doc_type,source_doc_id,result,status)'
    + " VALUES (?,?,?,?,'2026-09-04',?,?,?,?)",
  ).run(id, AID, 'FQC' + id, opts.type ?? 'FQC', opts.sourceType ?? 'production_plan',
    opts.sourceId === undefined ? PLAN : opts.sourceId, opts.result ?? 'pass', opts.status ?? 'audited')
}

function qcLine(qcId: string, seq: number, item: string, defect: number, batch: string | null = null, reason: string | null = null) {
  db.prepare(
    'INSERT INTO scm_qc_line (id,account_set_id,qc_doc_id,seq,item_code,batch_no,inspect_qty,qualified_qty,defect_qty,defect_reason)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(`${qcId}-${seq}`, AID, qcId, seq, item, batch, 10, 10 - defect, defect, reason)
}

const pfDoc = { id: PF_DOC, doc_no: 'PF-001', doc_type: 'PF', plan_id: PLAN }

describe('完工入库质检校验', () => {
  beforeEach(() => { db = createDb() })

  it('参数未开启时不做校验', () => {
    expect(isQcRequiredForFinish(db, AID)).toBe(false)
    expect(validateFinishQc(db, AID, pfDoc)).toBeNull()
  })

  it('参数开启但没有质检单时拦截，提示怎么补', () => {
    enableParam()
    const err = validateFinishQc(db, AID, pfDoc)
    expect(err).toContain('PF-001')
    expect(err).toContain('FQC')
    expect(err).toContain('质检管理')
  })

  it('挂在工单上的合格 FQC 放行', () => {
    enableParam()
    qcDoc('Q1', { sourceId: PLAN })
    expect(validateFinishQc(db, AID, pfDoc)).toBeNull()
  })

  it('挂在完工单上的合格 FQC 也放行（补检场景）', () => {
    enableParam()
    qcDoc('Q1', { sourceId: PF_DOC, sourceType: 'scm_doc' })
    expect(validateFinishQc(db, AID, pfDoc)).toBeNull()
  })

  it('草稿 / 判定不合格 / 非 FQC / 挂别的工单，都不算数', () => {
    enableParam()
    qcDoc('Q1', { status: 'draft' })
    qcDoc('Q2', { result: 'reject' })
    qcDoc('Q3', { type: 'IQC' })
    qcDoc('Q4', { sourceId: 'OTHER-PLAN' })
    expect(validateFinishQc(db, AID, pfDoc)).toContain('没有判定合格的已审核完工检验单')
  })

  it('只对完工类单据生效', () => {
    enableParam()
    expect(validateFinishQc(db, AID, { ...pfDoc, doc_type: 'PL' })).toBeNull()
    expect(validateFinishQc(db, AID, { ...pfDoc, doc_type: 'WI' })).toContain('FQC')
  })

  it('完工单未挂工单时只按单据 id 找质检单', () => {
    enableParam()
    qcDoc('Q1', { sourceId: PLAN })
    expect(validateFinishQc(db, AID, { ...pfDoc, plan_id: null })).toContain('FQC')
    qcDoc('Q2', { sourceId: PF_DOC })
    expect(validateFinishQc(db, AID, { ...pfDoc, plan_id: null })).toBeNull()
  })
})

describe('质检不良明细下推', () => {
  beforeEach(() => { db = createDb() })

  it('只取不良数量大于 0 的行，带上批次与不良原因', () => {
    qcDoc('Q1')
    qcLine('Q1', 1, 'FP1', 2, 'B-20260904', '外观划伤')
    qcLine('Q1', 2, 'FP2', 0)
    qcLine('Q1', 3, 'FP3', 1.5)
    expect(getQcDefectLines(db, AID, 'Q1')).toEqual([
      { item_code: 'FP1', qty: 2, batch_no: 'B-20260904', remark: '外观划伤' },
      { item_code: 'FP3', qty: 1.5, batch_no: null, remark: null },
    ])
  })

  it('下推前置校验', () => {
    const lines = [{ item_code: 'FP1', qty: 2, batch_no: null, remark: null }]
    expect(validateQcDefectPush(undefined, PLAN, lines)).toContain('质检单不存在')
    expect(validateQcDefectPush({ status: 'draft' }, PLAN, lines)).toContain('请先审核质检单')
    expect(validateQcDefectPush({ status: 'audited' }, null, lines)).toContain('未关联工单')
    expect(validateQcDefectPush({ status: 'audited' }, PLAN, [])).toContain('没有不良数量')
    expect(validateQcDefectPush({ status: 'audited' }, PLAN, lines)).toBeNull()
  })
})
