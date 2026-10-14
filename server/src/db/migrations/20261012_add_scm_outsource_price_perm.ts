import type Database from 'better-sqlite3'

/**
 * v164：新增「委外加工单价修改」权限 scm:outsource-price
 *
 * 加工单价原则上在委外计划中制定，委外入库时带出；能否在入库时改由此权限控制。
 * 为避免现有角色失权，凡含 scm:outsource 的角色补上新权限；管理员可在角色管理中按需收回（* 角色天然放行）。
 */
export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
  const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let changed = 0
  for (const r of roles) {
    let perms: string[]
    try { perms = JSON.parse(r.permissions || '[]') } catch { continue }
    if (!Array.isArray(perms) || perms.includes('*')) continue
    if (!perms.includes('scm:outsource') || perms.includes('scm:outsource-price')) continue
    upd.run(JSON.stringify([...perms, 'scm:outsource-price']), r.id)
    changed++
  }
  console.log(`✓ 回填委外加工单价修改权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {}
