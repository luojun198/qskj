import type Database from 'better-sqlite3'

/**
 * v55：回填供应链模块权限
 *
 * 含 asset:* 或 * 的角色补全新 scm:*（与 v50 回填 asset/cashier 同模式），
 * 确保现有管理员/财务角色可直接使用新模块。
 */
const NEW_SCM = ['scm:item', 'scm:partner', 'scm:warehouse', 'scm:category', 'scm:stock', 'scm:opening', 'scm:import', 'scm:param']

export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
  const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let changed = 0
  for (const r of roles) {
    let perms: string[]
    try { perms = JSON.parse(r.permissions || '[]') } catch { continue }
    if (!Array.isArray(perms) || perms.includes('*')) continue
    const set = new Set(perms)
    const before = set.size
    if (set.has('asset:view') || set.has('asset:edit')) NEW_SCM.forEach(p => set.add(p))
    if (set.size !== before) { upd.run(JSON.stringify([...set]), r.id); changed++ }
  }
  console.log(`✓ 回填供应链权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {}
