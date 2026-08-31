import type Database from 'better-sqlite3'

const PRESET_ROLE_CODES = ['accountant', 'auditor', 'poster', 'reporter', 'readonly']
const DASHBOARD_PERMISSION = 'system:dashboard'

function mergeDashboardPermission(permissions: unknown): string[] {
  let list: string[] = []
  if (typeof permissions === 'string') {
    try {
      list = JSON.parse(permissions)
    } catch {
      list = []
    }
  } else if (Array.isArray(permissions)) {
    list = permissions.filter((item): item is string => typeof item === 'string')
  }
  if (list.includes('*') || list.includes(DASHBOARD_PERMISSION)) {
    return list
  }
  return [...list, DASHBOARD_PERMISSION]
}

export function up(db: Database.Database) {
  const roles = db
    .prepare(`SELECT id, code, permissions FROM roles WHERE code IN (${PRESET_ROLE_CODES.map(() => '?').join(', ')})`)
    .all(...PRESET_ROLE_CODES) as Array<{ id: string; code: string; permissions: string | null }>

  const update = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  for (const role of roles) {
    const next = mergeDashboardPermission(role.permissions)
    update.run(JSON.stringify(next), role.id)
  }
}

export function down(db: Database.Database) {
  const roles = db
    .prepare(`SELECT id, permissions FROM roles WHERE code IN (${PRESET_ROLE_CODES.map(() => '?').join(', ')})`)
    .all(...PRESET_ROLE_CODES) as Array<{ id: string; permissions: string | null }>

  const update = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  for (const role of roles) {
    let list: string[] = []
    try {
      list = JSON.parse(role.permissions || '[]')
    } catch {
      list = []
    }
    const next = list.filter(code => code !== DASHBOARD_PERMISSION)
    update.run(JSON.stringify(next), role.id)
  }
}
