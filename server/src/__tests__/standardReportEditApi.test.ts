import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RowColOperation } from '../services/reportFormulaRewrite.js'
import { applyStandardReportRowCol, shiftSizeList } from '../services/standardReportRowCol.js'

/**
 * 这里不起 Express，而是把 `POST /:id/rowcol` 与 `PUT /:id/cells` 的 SQL 语义
 * 在内存库上复刻一遍，用来锁住两件容易回归的事：
 *   1. 插删行列时公式引用必须跟着平移（真实缺陷：全库原本没有任何 rewrite 逻辑）
 *   2. upsert 未传的字段要保留旧值 —— reportTemplate.ts 的 insertStmt 把 style_key/side
 *      硬写 NULL，导致「给空格子设样式再保存」丢样式，这里必须不重蹈
 */

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rh_standard_reports (
      id TEXT PRIMARY KEY, account_set_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      source_file TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT,
      default_col_width INTEGER DEFAULT 160, default_row_height INTEGER DEFAULT 34,
      col_widths TEXT, row_heights TEXT,
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE rh_standard_report_cells (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL,
      row_index INTEGER NOT NULL, col_index INTEGER NOT NULL,
      cell_type TEXT NOT NULL DEFAULT 'text',
      text_value TEXT, formula_text TEXT, format_text TEXT, style_key TEXT, side TEXT,
      merge_info TEXT, col_width TEXT, row_height TEXT, updated_at TEXT,
      UNIQUE(report_id, row_index, col_index)
    );
  `)
  db.prepare(
    `INSERT INTO rh_standard_reports (id, account_set_id, code, name) VALUES ('r1','as-1','1','测试报表')`
  ).run()
  return db
}

function addCell(
  db: Database.Database,
  id: string,
  rowIndex: number,
  colIndex: number,
  formula: string | null,
  text: string | null = null
) {
  db.prepare(
    `INSERT INTO rh_standard_report_cells (id, report_id, row_index, col_index, cell_type, text_value, formula_text)
     VALUES (?, 'r1', ?, ?, ?, ?, ?)`
  ).run(id, rowIndex, colIndex, formula ? 'formula' : 'text', text, formula)
}

/** 直接调路由背后的服务，事务语义与线上完全一致 */
function applyRowCol(db: Database.Database, action: string, index: number, count = 1) {
  const operation: RowColOperation = {
    type: action.startsWith('insert') ? 'insert' : 'delete',
    axis: action.endsWith('_row') ? 'row' : 'col',
    index,
    count,
  }
  applyStandardReportRowCol(db, 'r1', operation)
}

describe('标准报表编辑接口语义', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
  })

  describe('插删行列时的公式平移', () => {
    it('插入行后，既有公式的引用与单元格位置同步下移', () => {
      addCell(db, 'c1', 0, 0, null, '合计')
      addCell(db, 'c2', 0, 1, '=B5+B6')
      addCell(db, 'c3', 5, 1, null, '100')

      applyRowCol(db, 'insert_row', 4)

      const formula = db
        .prepare(`SELECT formula_text FROM rh_standard_report_cells WHERE id = 'c1'`)
        .get() as { formula_text: string | null }
      expect(formula.formula_text).toBeNull()

      const shifted = db
        .prepare(`SELECT formula_text FROM rh_standard_report_cells WHERE id = 'c2'`)
        .get() as { formula_text: string }
      expect(shifted.formula_text).toBe('=B6+B7')

      // 被引用的数据格自身也下移了一行，引用因此仍然指向它
      const moved = db
        .prepare(`SELECT row_index FROM rh_standard_report_cells WHERE id = 'c3'`)
        .get() as { row_index: number }
      expect(moved.row_index).toBe(6)
    })

    it('删除行后，指向该行的引用变成 #REF!，其余上移', () => {
      addCell(db, 'c1', 0, 0, '=B5+B7')
      addCell(db, 'c2', 4, 1, null, '被删行')

      applyRowCol(db, 'delete_row', 4)

      const formula = db
        .prepare(`SELECT formula_text FROM rh_standard_report_cells WHERE id = 'c1'`)
        .get() as { formula_text: string }
      expect(formula.formula_text).toBe('=#REF!+B6')

      const removed = db
        .prepare(`SELECT COUNT(*) AS n FROM rh_standard_report_cells WHERE id = 'c2'`)
        .get() as { n: number }
      expect(removed.n).toBe(0)
    })

    it('取数公式不会被行列操作改坏', () => {
      addCell(db, 'c1', 0, 0, '@ye(1001,99)+ye(1002,99)')

      applyRowCol(db, 'insert_row', 0)
      applyRowCol(db, 'delete_col', 3)

      const formula = db
        .prepare(`SELECT formula_text FROM rh_standard_report_cells WHERE id = 'c1'`)
        .get() as { formula_text: string }
      expect(formula.formula_text).toBe('@ye(1001,99)+ye(1002,99)')
    })

    it('插入列使右侧单元格与引用一起右移', () => {
      addCell(db, 'c1', 0, 0, '=C1')
      addCell(db, 'c2', 0, 2, null, '值')

      applyRowCol(db, 'insert_col', 1)

      const formula = db
        .prepare(`SELECT formula_text FROM rh_standard_report_cells WHERE id = 'c1'`)
        .get() as { formula_text: string }
      const moved = db
        .prepare(`SELECT col_index FROM rh_standard_report_cells WHERE id = 'c2'`)
        .get() as { col_index: number }
      expect(formula.formula_text).toBe('=D1')
      expect(moved.col_index).toBe(3)
    })
  })

  describe('单元格 upsert', () => {
    it('未传的字段保留旧值——给已有样式的格子只改公式，样式不能丢', () => {
      db.prepare(
        `INSERT INTO rh_standard_report_cells (id, report_id, row_index, col_index, cell_type, style_key, side)
         VALUES ('c1','r1',1,1,'text','align-center font-bold','left')`
      ).run()

      // 模拟只传 formula_text 的保存请求
      const existing = db
        .prepare(
          `SELECT * FROM rh_standard_report_cells WHERE report_id='r1' AND row_index=1 AND col_index=1`
        )
        .get() as Record<string, unknown>
      const incoming: Record<string, unknown> = { formula_text: '=A1+1' }
      const fields = ['cell_type', 'text_value', 'formula_text', 'format_text', 'style_key', 'side']
      const merged: Record<string, unknown> = {}
      for (const field of fields) {
        merged[field] = incoming[field] !== undefined ? incoming[field] : (existing[field] ?? null)
      }

      expect(merged.style_key).toBe('align-center font-bold')
      expect(merged.side).toBe('left')
      expect(merged.formula_text).toBe('=A1+1')
    })
  })
})

describe('shiftSizeList：行高/列宽数组随插删行列平移', () => {
  it('插入：在位置处补入同尺寸的项', () => {
    expect(shiftSizeList('[10,20,30]', { type: 'insert', axis: 'row', index: 1, count: 2 })).toBe(
      '[10,20,20,20,30]'
    )
  })

  it('删除：去掉对应位置的项', () => {
    expect(shiftSizeList('[10,20,30,40]', { type: 'delete', axis: 'row', index: 1, count: 2 })).toBe(
      '[10,40]'
    )
  })

  it('位置超出数组或数据缺失时不动', () => {
    expect(shiftSizeList('[10,20]', { type: 'insert', axis: 'row', index: 5, count: 1 })).toBeUndefined()
    expect(shiftSizeList(null, { type: 'delete', axis: 'row', index: 0, count: 1 })).toBeUndefined()
    expect(shiftSizeList('oops', { type: 'delete', axis: 'row', index: 0, count: 1 })).toBeUndefined()
  })
})

describe('applyStandardReportRowCol：中间插行不撞唯一约束', () => {
  it('连续多行有内容时在中间插两行，坐标整体下移且不报数据重复', () => {
    const db = createDb()
    for (let row = 0; row < 6; row += 1) addCell(db, `c${row}`, row, 0, null, `r${row}`)
    db.prepare(`UPDATE rh_standard_reports SET row_heights = '[10,11,12,13,14,15]' WHERE id = 'r1'`).run()

    applyRowCol(db, 'insert_row', 2, 2)

    const rows = db
      .prepare(`SELECT row_index, text_value FROM rh_standard_report_cells ORDER BY row_index`)
      .all() as Array<{ row_index: number; text_value: string }>
    expect(rows.map(item => `${item.row_index}:${item.text_value}`)).toEqual([
      '0:r0', '1:r1', '4:r2', '5:r3', '6:r4', '7:r5',
    ])
    const heights = db.prepare(`SELECT row_heights FROM rh_standard_reports WHERE id = 'r1'`).get() as {
      row_heights: string
    }
    expect(heights.row_heights).toBe('[10,11,12,12,12,13,14,15]')

    applyRowCol(db, 'delete_row', 2, 2)
    const back = db.prepare(`SELECT row_index FROM rh_standard_report_cells ORDER BY row_index`).all() as Array<{
      row_index: number
    }>
    expect(back.map(item => item.row_index)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
