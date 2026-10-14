import type Database from 'better-sqlite3'

/**
 * v157：新增「核销单删除（取消核销）」权限 scm:verify-delete
 *
 * 原来有 scm:arap 即可取消核销。为避免现有角色失权，凡含 scm:arap 的角色补上新权限；
 * 管理员可在角色管理中按需收回（* 角色天然放行）。
 */
export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
  const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let changed = 0
  for (const r of roles) {
    let perms: string[]
    try { perms = JSON.parse(r.permissions || '[]') } catch { continue }
    if (!Array.isArray(perms) || perms.includes('*')) continue
    if (!perms.includes('scm:arap') || perms.includes('scm:verify-delete')) continue
    upd.run(JSON.stringify([...perms, 'scm:verify-delete']), r.id)
    changed++
  }
  console.log(`✓ 回填核销单删除权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {}
