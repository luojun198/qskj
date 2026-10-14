import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { up } from '../db/migrations/20261013_voucher_standard_template_v2.js'

function setup() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE print_templates (
    id TEXT PRIMARY KEY, name TEXT, template_type TEXT, template_key TEXT, panel TEXT,
    paper_size TEXT, paper_width REAL, paper_height REAL, created_at TEXT, updated_at TEXT)`)
  const ins = db.prepare(`INSERT INTO print_templates VALUES (?, ?, 'voucher', ?, ?, 'custom', 210, 148, ?, ?)`)
  const oldPanel = JSON.stringify({ panels: [{ width: 210, height: 148, printElements: [] }] })
  ins.run('untouched', '标准记账凭证', 'voucher:standard', oldPanel, '2026-10-07 12:00:00', '2026-10-07 12:00:00')
  ins.run('edited', '标准记账凭证', 'voucher:standard', oldPanel, '2026-10-07 12:00:00', '2026-10-09 08:00:00')
  ins.run('renamed', '我的凭证', 'voucher:standard', oldPanel, '2026-10-07 12:00:00', '2026-10-07 12:00:00')
  return db
}

const get = (db: Database.Database, id: string) =>
  db.prepare('SELECT * FROM print_templates WHERE id = ?').get(id) as Record<string, any>

describe('v165 标准记账凭证模板升级新版式', () => {
  it('只升级系统生成且未改过的默认模板，保持 updated_at = created_at；可重复执行', () => {
    const db = setup()
    up(db)
    up(db)

    const u = get(db, 'untouched')
    const panel = JSON.parse(u.panel).panels[0]
    expect(panel.cwLayoutVersion).toBe(2)
    expect([panel.width, panel.height]).toEqual([220, 140])
    expect([u.paper_width, u.paper_height]).toEqual([220, 140])
    expect(u.updated_at).toBe(u.created_at)

    // 用户改过 / 改了名的不动
    for (const id of ['edited', 'renamed']) {
      const row = get(db, id)
      expect(JSON.parse(row.panel).panels[0].width).toBe(210)
      expect(row.paper_width).toBe(210)
    }
  })

  it('老库没有 hiprint 字段时直接跳过', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE print_templates (id TEXT PRIMARY KEY, name TEXT)')
    expect(() => up(db)).not.toThrow()
  })
})
