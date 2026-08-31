import type Database from 'better-sqlite3'

/**
 * v50：回填出纳/资产细化权限，兼容"启用路由权限校验"前的既有角色
 *
 * 背景：出纳/资产路由原先无 requirePermission，任何登录用户都能用；本次启用校验后，
 * 已被显式授予出纳/资产权限的角色应保留访问。规则：
 *  - 含 `cashier:journal` 的角色 → 补全全部 cashier:* 细化权限
 *  - 含任一旧资产权限(asset:view/edit/dict) 的角色 → 补全全部 asset:* 细化权限
 *  - 含 `*` 的角色（admin）不动
 */
const NEW_CASHIER = ['cashier:voucher', 'cashier:import', 'cashier:report', 'cashier:param']
const NEW_ASSET = ['asset:depr', 'asset:dispose', 'asset:inventory', 'asset:report', 'asset:param']
const OLD_ASSET_ANY = ['asset:view', 'asset:edit', 'asset:dict']

export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{ id: string; permissions: string }>
  const upd = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let changed = 0
  for (const r of roles) {
    let perms: string[]
    try {
      perms = JSON.parse(r.permissions || '[]')
    } catch {
      continue
    }
    if (!Array.isArray(perms) || perms.includes('*')) continue
    const set = new Set(perms)
    const before = set.size
    if (set.has('cashier:journal')) NEW_CASHIER.forEach(p => set.add(p))
    if (OLD_ASSET_ANY.some(p => set.has(p))) NEW_ASSET.forEach(p => set.add(p))
    if (set.size !== before) {
      upd.run(JSON.stringify([...set]), r.id)
      changed++
    }
  }
  console.log(`✓ 回填出纳/资产权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {
  // 回填类迁移不提供精确回滚（不移除已补权限）
}
