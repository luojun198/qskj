import type Database from 'better-sqlite3'

/**
 * v70：回填供应链细化权限
 *
 * 原 scm:stock 一刀切被拆分为业务域 + 操作权限。为避免现有角色失权，
 * 凡含 scm:stock（或 * 但 * 已天然放行）的角色，补全新细化权限：
 * - 业务域：采购/销售/库存业务/生产/委外/往来/报表
 * - 操作：审核(scm:audit)/删除(scm:delete)
 * 与 v55 回填同模式（含旧权限即补新权限）。
 */
const NEW_FINE = [
  'scm:purchase', 'scm:sale', 'scm:inventory', 'scm:production',
  'scm:outsource', 'scm:arap', 'scm:report', 'scm:audit', 'scm:delete',
]

export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
  const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let changed = 0
  for (const r of roles) {
    let perms: string[]
    try { perms = JSON.parse(r.permissions || '[]') } catch { continue }
    if (!Array.isArray(perms) || perms.includes('*')) continue
    // 含旧 scm:stock 的角色视为「曾拥有全部供应链单据权限」，补齐细化权限
    if (!perms.includes('scm:stock')) continue
    const set = new Set(perms)
    const before = set.size
    NEW_FINE.forEach(p => set.add(p))
    if (set.size !== before) { upd.run(JSON.stringify([...set]), r.id); changed++ }
  }
  console.log(`✓ 回填供应链细化权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {}
