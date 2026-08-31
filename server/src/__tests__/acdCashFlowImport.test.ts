import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  formatCashFlowDirectionLabel,
  mapAcdCashFlowJd,
} from '../utils/acdCashFlow.js'

describe('mapAcdCashFlowJd', () => {
  it('jd=0 为流入', () => {
    expect(mapAcdCashFlowJd('0')).toBe('inflow')
  })

  it('jd=1 为流出', () => {
    expect(mapAcdCashFlowJd('1')).toBe('outflow')
  })

  it('空或其它为中性', () => {
    expect(mapAcdCashFlowJd('')).toBe('neutral')
    expect(mapAcdCashFlowJd('2')).toBe('neutral')
    expect(mapAcdCashFlowJd(undefined)).toBe('neutral')
  })
})

describe('formatCashFlowDirectionLabel', () => {
  it('英文枚举转中文', () => {
    expect(formatCashFlowDirectionLabel('inflow')).toBe('流入')
    expect(formatCashFlowDirectionLabel('outflow')).toBe('流出')
    expect(formatCashFlowDirectionLabel('neutral')).toBe('中性')
  })
})

describe('ACD 现金流量双写', () => {
  it('aux_items.field_values 与 cash_flow_items.direction 一致', () => {
    const db = new Database(':memory:')
    const accountSetId = 'set1'
    const categoryId = 'cat-cf'
    db.exec(`
      CREATE TABLE aux_categories (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
      CREATE TABLE aux_category_fields (
        id TEXT, category_id TEXT, field_key TEXT, field_name TEXT, field_type TEXT,
        options_json TEXT, show_in_voucher INTEGER, required_in_voucher INTEGER,
        required_in_archive INTEGER, sort_order INTEGER, is_enabled INTEGER
      );
      CREATE TABLE aux_items (
        id TEXT, account_set_id TEXT, type TEXT, code TEXT, name TEXT,
        status TEXT, field_values TEXT
      );
      CREATE TABLE cash_flow_items (
        id TEXT, account_set_id TEXT, code TEXT, name TEXT, direction TEXT,
        parent_code TEXT, level INTEGER, is_leaf INTEGER, sort_order INTEGER, is_active INTEGER
      );
    `)
    db.prepare(`INSERT INTO aux_categories VALUES (?, ?, 'cash_flow', '现金流量')`).run(
      categoryId,
      accountSetId
    )

    const code = '1101'
    const name = '销售商品提供劳务收现'
    const direction = mapAcdCashFlowJd('0')
    const fieldValues = JSON.stringify({ direction })

    db.prepare(
      `INSERT INTO aux_items VALUES (?, ?, ?, ?, ?, 'active', ?)`
    ).run(uuidv4(), accountSetId, categoryId, code, name, fieldValues)
    db.prepare(
      `INSERT INTO cash_flow_items VALUES (?, ?, ?, ?, ?, NULL, 1, 1, 0, 1)`
    ).run(uuidv4(), accountSetId, code, name, direction)

    const aux = db
      .prepare(`SELECT field_values FROM aux_items WHERE code=?`)
      .get(code) as { field_values: string }
    const cf = db
      .prepare(`SELECT direction FROM cash_flow_items WHERE code=?`)
      .get(code) as { direction: string }

    expect(JSON.parse(aux.field_values).direction).toBe('inflow')
    expect(cf.direction).toBe('inflow')
  })
})
