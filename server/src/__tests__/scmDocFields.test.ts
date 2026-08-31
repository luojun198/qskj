import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { listDocFieldDefs, listAllDocFieldDefs, upsertDocFieldDefs } from '../services/scmDocFields.js'

const AID = 'DF-TEST'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE scm_doc_field_defs (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, doc_type TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT 'header', field_key TEXT NOT NULL, field_name TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text', options_json TEXT, sort_order INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(account_set_id, doc_type, field_key)
    );
  `)
  return db
}

describe('scmDocFields 单据自定义字段定义', () => {
  let db: Database.Database
  beforeEach(() => { db = createDb() })

  it('插入新字段，列表按 表头→表体→表尾 + sort_order 排序', () => {
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'foot1', field_name: '页脚条款', position: 'footer', sort_order: 0 },
      { field_key: 'body1', field_name: '行备注', position: 'body', sort_order: 0 },
      { field_key: 'head2', field_name: '抬头备注', position: 'header', sort_order: 1 },
      { field_key: 'head1', field_name: '抬头编号', position: 'header', sort_order: 0 },
    ])
    const list = listDocFieldDefs(db, AID, 'PI') as any[]
    expect(list.map(f => f.field_key)).toEqual(['head1', 'head2', 'body1', 'foot1'])
    expect(list[0].position).toBe('header')
    expect(list[2].position).toBe('body')
    expect(list[3].position).toBe('footer')
  })

  it('is_visible：缺省为 1（显示）；显式 0 持久化为隐藏，仍在启用列表中', () => {
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'shown', field_name: '显示字段' },
      { field_key: 'hidden', field_name: '隐藏字段', is_visible: 0 },
    ])
    const list = listDocFieldDefs(db, AID, 'PI') as any[]
    const map = Object.fromEntries(list.map(f => [f.field_key, f]))
    expect(map.shown.is_visible).toBe(1)
    expect(map.hidden.is_visible).toBe(0)
    // is_visible=0 不等于软停用：字段仍在启用列表里
    expect(list.map(f => f.field_key).sort()).toEqual(['hidden', 'shown'])
  })

  it('select 类型的 options 数组被序列化为 JSON 存储', () => {
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'grade', field_name: '等级', field_type: 'select', options_json: ['A', 'B', 'C'] },
    ])
    const list = listDocFieldDefs(db, AID, 'PI') as any[]
    expect(list[0].field_type).toBe('select')
    expect(JSON.parse(list[0].options_json)).toEqual(['A', 'B', 'C'])
  })

  it('覆盖式 upsert：不在新列表中的旧字段被软停用（从启用列表消失）', () => {
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'a', field_name: '甲' },
      { field_key: 'b', field_name: '乙' },
    ])
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'a', field_name: '甲改' },
    ])
    const list = listDocFieldDefs(db, AID, 'PI') as any[]
    expect(list.map(f => f.field_key)).toEqual(['a'])
    expect(list[0].field_name).toBe('甲改')
    // 软停用：b 仍在表里但 is_enabled=0
    const b = db.prepare('SELECT is_enabled FROM scm_doc_field_defs WHERE account_set_id=? AND doc_type=? AND field_key=?').get(AID, 'PI', 'b') as any
    expect(b.is_enabled).toBe(0)
  })

  it('更新已存在 field_key 不产生重复行', () => {
    upsertDocFieldDefs(db, AID, 'PI', [{ field_key: 'a', field_name: '甲', position: 'header' }])
    upsertDocFieldDefs(db, AID, 'PI', [{ field_key: 'a', field_name: '甲2', position: 'footer' }])
    const rows = db.prepare('SELECT * FROM scm_doc_field_defs WHERE account_set_id=? AND doc_type=? AND field_key=?').all(AID, 'PI', 'a') as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].field_name).toBe('甲2')
    expect(rows[0].position).toBe('footer')
  })

  it('单据类型隔离：配置 PI 不影响 SO', () => {
    upsertDocFieldDefs(db, AID, 'SO', [{ field_key: 'so1', field_name: '销售字段' }])
    upsertDocFieldDefs(db, AID, 'PI', [{ field_key: 'pi1', field_name: '采购字段' }])
    expect((listDocFieldDefs(db, AID, 'SO') as any[]).map(f => f.field_key)).toEqual(['so1'])
    expect((listDocFieldDefs(db, AID, 'PI') as any[]).map(f => f.field_key)).toEqual(['pi1'])
  })

  it('账套隔离：不同账套互不影响', () => {
    upsertDocFieldDefs(db, AID, 'PI', [{ field_key: 'a', field_name: '甲' }])
    upsertDocFieldDefs(db, 'OTHER-AID', 'PI', [{ field_key: 'a', field_name: '别套甲' }])
    expect((listDocFieldDefs(db, AID, 'PI') as any[])[0].field_name).toBe('甲')
    expect((listDocFieldDefs(db, 'OTHER-AID', 'PI') as any[])[0].field_name).toBe('别套甲')
  })

  it('listAllDocFieldDefs：跨单据类型汇总本账套全部启用字段（停用项不计、跨账套隔离）', () => {
    upsertDocFieldDefs(db, AID, 'PI', [
      { field_key: 'p1', field_name: '采购头', position: 'header' },
      { field_key: 'p2', field_name: '采购尾', position: 'footer' },
    ])
    upsertDocFieldDefs(db, AID, 'SQ', [{ field_key: 's1', field_name: '报价有效期', position: 'footer' }])
    upsertDocFieldDefs(db, AID, 'PI', [{ field_key: 'p1', field_name: '采购头' }]) // 停用 p2
    upsertDocFieldDefs(db, 'OTHER-AID', 'SO', [{ field_key: 'x', field_name: '别套' }])

    const all = listAllDocFieldDefs(db, AID) as any[]
    const summary = all.map(f => `${f.doc_type}:${f.field_key}`)
    expect(summary).toEqual(['PI:p1', 'SQ:s1']) // 按 doc_type 排序，p2 已停用不计，别套不计
  })
})
