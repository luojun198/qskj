/**
 * 质检检验标准与判定引擎（质量管控）。
 *
 *  - 标准解析：物料 + 检验类型 精确匹配 → 该物料的通用标准（qc_type=''）；停用的不参与。
 *  - 抽样：full 全检；percent 按检验数百分比（向上取整）；fixed 固定抽样数；均不低于 min_sample、不超过检验数。
 *  - 判定：每个检验项按数值上下限 / 判定型 得出 passed；关键项(is_key)任一不合格 → 行不合格；
 *          非关键项不合格只记录；行不良数 > 允收不良数(accept_defects) → 行不合格。
 *          整单：任一行不合格 → fail；否则 pass。让步接收(concession)由人工在不合格基础上改判。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export interface QcStandardItem {
  id: string; seq: number; name: string; method?: string | null; value_type: 'numeric' | 'bool'
  target?: number | null; lower_limit?: number | null; upper_limit?: number | null; unit?: string | null; is_key: number; remark?: string | null
}
export interface QcStandard {
  id: string; item_code: string; qc_type: string; name?: string | null
  sampling_mode: 'full' | 'percent' | 'fixed'; sampling_value: number; min_sample: number; accept_defects: number
  is_enabled: number; remark?: string | null; items: QcStandardItem[]
}
export interface QcLineResultInput {
  standard_item_id?: string | null; seq?: number; name: string; value_type?: 'numeric' | 'bool'
  target?: number | null; lower_limit?: number | null; upper_limit?: number | null; unit?: string | null; is_key?: number | boolean
  value_num?: number | null; value_bool?: number | boolean | null; remark?: string | null
}

const hasTable = (db: Database.Database, t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)

export function listQcStandards(db: Database.Database, aid: string, filters: { item_code?: string; qc_type?: string; keyword?: string } = {}) {
  const conds = ['s.account_set_id=?']; const ps: any[] = [aid]
  if (filters.item_code) { conds.push('s.item_code=?'); ps.push(filters.item_code) }
  if (filters.qc_type) { conds.push("(s.qc_type=? OR s.qc_type='')"); ps.push(filters.qc_type) }
  if (filters.keyword) { conds.push('(s.item_code LIKE ? OR i.name LIKE ? OR s.name LIKE ?)'); const k = `%${filters.keyword}%`; ps.push(k, k, k) }
  return db.prepare(`SELECT s.*, i.name AS item_name, i.spec,
      (SELECT COUNT(*) FROM scm_qc_standard_item x WHERE x.standard_id=s.id) AS item_count
    FROM scm_qc_standard s LEFT JOIN scm_item i ON i.account_set_id=s.account_set_id AND i.code=s.item_code
    WHERE ${conds.join(' AND ')} ORDER BY s.item_code, s.qc_type`).all(...ps) as any[]
}

export function getQcStandard(db: Database.Database, aid: string, id: string): QcStandard | null {
  const s = db.prepare('SELECT * FROM scm_qc_standard WHERE id=? AND account_set_id=?').get(id, aid) as any
  if (!s) return null
  s.items = db.prepare('SELECT * FROM scm_qc_standard_item WHERE standard_id=? ORDER BY seq').all(id)
  return s
}

/** 物料 + 检验类型 → 生效标准（精确类型优先，其次通用） */
export function resolveQcStandard(db: Database.Database, aid: string, itemCode: string, qcType: string): QcStandard | null {
  if (!hasTable(db, 'scm_qc_standard')) return null
  const s = db.prepare(`SELECT * FROM scm_qc_standard WHERE account_set_id=? AND item_code=? AND is_enabled=1 AND qc_type IN (?, '')
    ORDER BY CASE WHEN qc_type=? THEN 0 ELSE 1 END LIMIT 1`).get(aid, itemCode, String(qcType || ''), String(qcType || '')) as any
  if (!s) return null
  s.items = db.prepare('SELECT * FROM scm_qc_standard_item WHERE standard_id=? ORDER BY seq').all(s.id)
  return s
}

export function saveQcStandard(db: Database.Database, aid: string, body: any, id?: string): string {
  const itemCode = String(body?.item_code || '').trim()
  if (!itemCode) throw new Error('物料不能为空')
  const qcType = ['IQC', 'IPQC', 'FQC'].includes(String(body?.qc_type || '')) ? String(body.qc_type) : ''
  const mode = ['full', 'percent', 'fixed'].includes(String(body?.sampling_mode)) ? String(body.sampling_mode) : 'full'
  const value = Number(body?.sampling_value) || 0
  if (mode === 'percent' && (value <= 0 || value > 100)) throw new Error('按比例抽样的比例须在 (0, 100]')
  if (mode === 'fixed' && value <= 0) throw new Error('固定抽样数须大于 0')
  const dup = db.prepare('SELECT id FROM scm_qc_standard WHERE account_set_id=? AND item_code=? AND qc_type=? AND id<>?').get(aid, itemCode, qcType, id || '') as any
  if (dup) throw new Error(`物料 ${itemCode} 的${qcType || '通用'}检验标准已存在`)
  const items = Array.isArray(body?.items) ? body.items.filter((x: any) => x && String(x.name || '').trim()) : []
  if (!items.length) throw new Error('至少需要一个检验项')
  const sid = id || uuidv4()
  db.transaction(() => {
    if (id) {
      db.prepare(`UPDATE scm_qc_standard SET item_code=?, qc_type=?, name=?, sampling_mode=?, sampling_value=?, min_sample=?, accept_defects=?, is_enabled=?, remark=?, updated_at=datetime('now')
        WHERE id=? AND account_set_id=?`).run(itemCode, qcType, body.name ?? null, mode, value, Math.max(1, Number(body.min_sample) || 1), Math.max(0, Number(body.accept_defects) || 0), body.is_enabled === 0 || body.is_enabled === false ? 0 : 1, body.remark ?? null, sid, aid)
      db.prepare('DELETE FROM scm_qc_standard_item WHERE standard_id=?').run(sid)
    } else {
      db.prepare(`INSERT INTO scm_qc_standard (id, account_set_id, item_code, qc_type, name, sampling_mode, sampling_value, min_sample, accept_defects, is_enabled, remark)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sid, aid, itemCode, qcType, body.name ?? null, mode, value, Math.max(1, Number(body.min_sample) || 1), Math.max(0, Number(body.accept_defects) || 0), body.is_enabled === 0 || body.is_enabled === false ? 0 : 1, body.remark ?? null)
    }
    const ins = db.prepare('INSERT INTO scm_qc_standard_item (id, account_set_id, standard_id, seq, name, method, value_type, target, lower_limit, upper_limit, unit, is_key, remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    items.forEach((x: any, i: number) => {
      const vt = x.value_type === 'bool' ? 'bool' : 'numeric'
      const lo = x.lower_limit === '' || x.lower_limit == null ? null : Number(x.lower_limit)
      const hi = x.upper_limit === '' || x.upper_limit == null ? null : Number(x.upper_limit)
      if (vt === 'numeric' && lo != null && hi != null && lo > hi) throw new Error(`检验项「${x.name}」下限大于上限`)
      ins.run(uuidv4(), aid, sid, i + 1, String(x.name).trim(), x.method ?? null, vt, x.target === '' || x.target == null ? null : Number(x.target), lo, hi, x.unit ?? null, x.is_key === 0 || x.is_key === false ? 0 : 1, x.remark ?? null)
    })
  })()
  return sid
}

export function deleteQcStandard(db: Database.Database, aid: string, id: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM scm_qc_standard_item WHERE standard_id=? AND account_set_id=?').run(id, aid)
    db.prepare('DELETE FROM scm_qc_standard WHERE id=? AND account_set_id=?').run(id, aid)
  })()
}

/** 抽样数：按标准与检验数计算 */
export function sampleSize(std: Pick<QcStandard, 'sampling_mode' | 'sampling_value' | 'min_sample'> | null, inspectQty: number): number {
  const q = Math.max(0, Number(inspectQty) || 0)
  if (!std || q <= 0) return q
  let n = q
  if (std.sampling_mode === 'percent') n = Math.ceil(q * (Number(std.sampling_value) || 100) / 100)
  else if (std.sampling_mode === 'fixed') n = Number(std.sampling_value) || q
  n = Math.max(Math.min(q, Math.max(1, Number(std.min_sample) || 1)), n)
  return Math.min(q, n)
}

/** 单个检验项判定 */
export function judgeResult(r: QcLineResultInput): boolean | null {
  if ((r.value_type || 'numeric') === 'bool') {
    if (r.value_bool == null || r.value_bool === '' as any) return null
    return !!(r.value_bool === true || Number(r.value_bool) === 1)
  }
  if (r.value_num == null || r.value_num === '' as any || !Number.isFinite(Number(r.value_num))) return null
  const v = Number(r.value_num)
  if (r.lower_limit != null && v < Number(r.lower_limit) - 1e-9) return false
  if (r.upper_limit != null && v > Number(r.upper_limit) + 1e-9) return false
  return true
}

/**
 * 行判定：关键项任一不合格 → false；有未填的关键项 → null（待检）；不良数 > 允收数 → false；否则 true
 */
export function judgeLine(results: QcLineResultInput[], defectQty: number, acceptDefects: number): boolean | null {
  let pending = false
  for (const r of results) {
    const p = judgeResult(r)
    if (p === null) { if (r.is_key === 1 || r.is_key === true || r.is_key === undefined) pending = true; continue }
    if (!p && (r.is_key === 1 || r.is_key === true || r.is_key === undefined)) return false
  }
  if ((Number(defectQty) || 0) > (Number(acceptDefects) || 0) + 1e-9) return false
  return pending ? null : true
}

/** 写入质检明细行的逐项结果并返回行判定 */
export function writeQcLineResults(db: Database.Database, aid: string, qcLineId: string, results: QcLineResultInput[] | undefined) {
  if (!hasTable(db, 'scm_qc_line_result')) return
  db.prepare('DELETE FROM scm_qc_line_result WHERE qc_line_id=?').run(qcLineId)
  if (!Array.isArray(results)) return
  const ins = db.prepare(`INSERT INTO scm_qc_line_result (id, account_set_id, qc_line_id, standard_item_id, seq, name, value_type, target, lower_limit, upper_limit, unit, is_key, value_num, value_bool, passed, remark)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  results.forEach((r, i) => {
    if (!r || !String(r.name || '').trim()) return
    const passed = judgeResult(r)
    ins.run(uuidv4(), aid, qcLineId, r.standard_item_id ?? null, r.seq ?? i + 1, String(r.name).trim(), r.value_type === 'bool' ? 'bool' : 'numeric',
      r.target ?? null, r.lower_limit ?? null, r.upper_limit ?? null, r.unit ?? null, r.is_key === 0 || r.is_key === false ? 0 : 1,
      r.value_num == null || r.value_num === '' as any ? null : Number(r.value_num),
      r.value_bool == null || r.value_bool === '' as any ? null : (r.value_bool === true || Number(r.value_bool) === 1 ? 1 : 0),
      passed == null ? null : (passed ? 1 : 0), r.remark ?? null)
  })
}

export function readQcLineResults(db: Database.Database, qcLineId: string) {
  if (!hasTable(db, 'scm_qc_line_result')) return []
  return db.prepare('SELECT * FROM scm_qc_line_result WHERE qc_line_id=? ORDER BY seq').all(qcLineId) as any[]
}

/**
 * 整单自动判定：所有行都有逐项结果或标准时才自动判定。
 * 返回 'pass' | 'fail' | null（null = 无标准/无结果，沿用人工判定）
 */
export function judgeDoc(lines: Array<{ item_code: string; defect_qty: number; results?: QcLineResultInput[]; accept_defects?: number }>): 'pass' | 'fail' | null {
  let judged = false
  for (const l of lines) {
    if (!l.results || !l.results.length) continue
    judged = true
    const r = judgeLine(l.results, l.defect_qty, l.accept_defects ?? 0)
    if (r === false) return 'fail'
    if (r === null) return null
  }
  return judged ? 'pass' : null
}
