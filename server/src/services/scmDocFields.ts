import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/**
 * 业务单据 表头/表体/表尾 自定义字段定义服务
 *
 * 数据表 scm_doc_field_defs（按 账套 + 单据类型 + 位置 header/body/footer）。
 * 表头/表尾值存于 scm_doc.field_values JSON；表体（明细行）值存于 scm_doc_line.field_values JSON。
 * 本服务只管理「定义」。仿物料档案 scm_item_field_defs 的覆盖式 upsert 语义。
 *
 * is_visible：是否在录入页渲染（0=隐藏但保留定义与历史值），与 is_enabled（=软删除）是两件事。
 */
export interface DocFieldDefInput {
  field_key: string
  field_name: string
  field_type?: string
  position?: 'header' | 'body' | 'footer' | string
  options_json?: string | string[] | null
  sort_order?: number
  is_visible?: number | boolean
}

// 字段位置排序：表头(0) → 表体(1) → 表尾(2)
const POSITION_ORDER = `(CASE position WHEN 'header' THEN 0 WHEN 'body' THEN 1 ELSE 2 END)`

/** 列出某单据类型的启用字段定义（含 header+body+footer），表头→表体→表尾、再按 sort_order */
export function listDocFieldDefs(db: Database.Database, accountSetId: string, docType: string) {
  return db.prepare(
    `SELECT * FROM scm_doc_field_defs
     WHERE account_set_id=? AND doc_type=? AND is_enabled=1
     ORDER BY ${POSITION_ORDER}, sort_order, created_at`
  ).all(accountSetId, docType)
}

/** 汇总本账套全部启用字段定义（跨单据类型），供配置页「已配置概览」用 */
export function listAllDocFieldDefs(db: Database.Database, accountSetId: string) {
  return db.prepare(
    `SELECT * FROM scm_doc_field_defs
     WHERE account_set_id=? AND is_enabled=1
     ORDER BY doc_type, ${POSITION_ORDER}, sort_order, created_at`
  ).all(accountSetId)
}

/**
 * 覆盖式 upsert 某单据类型的字段定义（仅作用于该 doc_type）：
 *  - 该类型下、不在新列表里的旧字段 → is_enabled=0（软停用，历史值保留）
 *  - 已存在 field_key → 更新；新 field_key → 插入
 */
export function upsertDocFieldDefs(
  db: Database.Database,
  accountSetId: string,
  docType: string,
  fields: DocFieldDefInput[]
) {
  const existing = db.prepare(
    'SELECT id, field_key FROM scm_doc_field_defs WHERE account_set_id=? AND doc_type=?'
  ).all(accountSetId, docType) as Array<{ id: string; field_key: string }>
  const existingMap = new Map(existing.map(f => [f.field_key, f.id]))
  const newKeys = new Set(fields.filter(f => f.field_key).map(f => f.field_key))

  const tx = db.transaction(() => {
    // 停用不在新列表中的旧字段（软删，保留历史值）
    for (const ef of existing) {
      if (!newKeys.has(ef.field_key)) {
        db.prepare("UPDATE scm_doc_field_defs SET is_enabled=0, updated_at=datetime('now','localtime') WHERE id=?").run(ef.id)
      }
    }
    // Upsert
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]
      if (!f.field_key || !f.field_name) continue
      const optJson = Array.isArray(f.options_json) ? JSON.stringify(f.options_json) : (f.options_json ?? null)
      const pos = ['header', 'body', 'footer'].includes(f.position as string) ? f.position : 'header'
      const ftype = f.field_type || 'text'
      const visible = f.is_visible === 0 || f.is_visible === false ? 0 : 1
      if (existingMap.has(f.field_key)) {
        db.prepare(
          "UPDATE scm_doc_field_defs SET field_name=?, field_type=?, position=?, options_json=?, sort_order=?, is_visible=?, is_enabled=1, updated_at=datetime('now','localtime') WHERE id=?"
        ).run(f.field_name, ftype, pos, optJson, f.sort_order ?? i, visible, existingMap.get(f.field_key))
      } else {
        db.prepare(
          'INSERT INTO scm_doc_field_defs (id, account_set_id, doc_type, position, field_key, field_name, field_type, options_json, sort_order, is_visible, is_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,1)'
        ).run(uuidv4(), accountSetId, docType, pos, f.field_key, f.field_name, ftype, optJson, f.sort_order ?? i, visible)
      }
    }
  })
  tx()
}
