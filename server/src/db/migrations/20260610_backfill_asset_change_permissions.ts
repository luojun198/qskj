import type Database from 'better-sqlite3'

/**
 * v109：回填固定资产新增细化权限（P0-4）
 *
 * 本次为资产模块新增三个权限码：
 *  - asset:change       资产变动（原值变动/部门调拨/状态变更/折旧要素调整/拆分）
 *  - asset:impair       资产减值与大修改良
 *  - asset:requisition  资产领用归还
 *
 * 规则：已被授予 `asset:edit`（可维护资产卡片）的角色视为有权做资产变动，
 * 自动补齐上述权限，避免升级后原有角色突然 403。含 `*` 的角色（admin）不动。
 */
const NEW_ASSET_PERMS = ['asset:change', 'asset:impair', 'asset:requisition']

export function up(db: Database.Database) {
  const roles = db.prepare('SELECT id, permissions FROM roles').all() as Array<{
    id: string
    permissions: string
  }>
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
    if (!perms.includes('asset:edit')) continue
    const set = new Set(perms)
    const before = set.size
    NEW_ASSET_PERMS.forEach(p => set.add(p))
    if (set.size !== before) {
      upd.run(JSON.stringify([...set]), r.id)
      changed++
    }
  }
  console.log(`✓ 回填资产变动权限完成，更新 ${changed} 个角色`)
}

export function down(_db: Database.Database) {
  // 回填类迁移不提供精确回滚（不移除已补权限）
}
