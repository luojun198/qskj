import type Database from 'better-sqlite3'

/**
 * v168：物料 / 往来单位档案审核（第六份反馈：物料、客户、供应商增加批量审核）
 *
 * - scm_item / scm_partner 增加 audit_status（draft 未审核 / audited 已审核）、auditor、audited_at；
 *   列默认 draft（新增、Excel 导入的档案默认未审核），**存量档案一律置为已审核**，不影响现有使用。
 * - 新权限 scm:master-audit（档案审核）：凡已有 scm:item 或 scm:partner 的角色补上，避免现有角色失权。
 */
function addColumn(db: Database.Database, table: string, ddl: string) {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run() }
  catch (e: any) { if (!String(e.message).includes('duplicate column name')) throw e }
}

export function up(db: Database.Database) {
  for (const t of ['scm_item', 'scm_partner']) {
    const had = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some(c => c.name === 'audit_status')
    addColumn(db, t, "audit_status TEXT NOT NULL DEFAULT 'draft'")
    addColumn(db, t, 'auditor TEXT')
    addColumn(db, t, 'audited_at TEXT')
    if (!had) db.prepare(`UPDATE ${t} SET audit_status='audited', audited_at=COALESCE(audited_at, datetime('now','localtime'))`).run()
  }

  let changed = 0
  try {
    const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
    const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
    for (const r of roles) {
      let perms: string[]
      try { perms = JSON.parse(r.permissions || '[]') } catch { continue }
      if (!Array.isArray(perms) || perms.includes('*') || perms.includes('scm:master-audit')) continue
      if (!perms.includes('scm:item') && !perms.includes('scm:partner')) continue
      upd.run(JSON.stringify([...perms, 'scm:master-audit']), r.id)
      changed++
    }
  } catch { /* 无角色表的旧库 / 单测库 */ }
  console.log(`✓ 档案审核：scm_item / scm_partner.audit_status 已就绪（存量置已审核），补档案审核权限 ${changed} 个角色`)
}

export function down(_db: Database.Database) {
  // SQLite 旧版本不支持 DROP COLUMN；新增列有默认值，保留不影响旧逻辑
}
