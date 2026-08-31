import Database from 'better-sqlite3'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// 内联修复（与 databaseIntegrityRepair.ts 一致）
function repairDatabaseReferentialIntegrity(db) {
  const stats = { orphanLoginSessions: 0, orphanUserRoles: 0, orphanUsers: 0 }
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_sets'").get()) {
    return stats
  }
  db.pragma('foreign_keys = OFF')
  try {
    const run = db.transaction(() => {
      stats.orphanLoginSessions = db
        .prepare(
          `DELETE FROM user_login_sessions
           WHERE account_set_id NOT IN (SELECT id FROM account_sets)
              OR user_id NOT IN (SELECT id FROM users)`
        )
        .run().changes
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'").get()) {
        stats.orphanUserRoles = db
          .prepare(
            `DELETE FROM user_roles
             WHERE account_set_id NOT IN (SELECT id FROM account_sets)
                OR user_id NOT IN (SELECT id FROM users)
                OR role_id NOT IN (SELECT id FROM roles)`
          )
          .run().changes
      }
      stats.orphanUsers = db
        .prepare(
          `DELETE FROM users
           WHERE account_set_id IS NOT NULL
             AND account_set_id NOT IN (SELECT id FROM account_sets)`
        )
        .run().changes
      db.prepare(
        `UPDATE users SET role_id = NULL
         WHERE role_id IS NOT NULL AND role_id NOT IN (SELECT id FROM roles)`
      ).run()
      db.prepare(
        `UPDATE roles SET owner_user_id = NULL
         WHERE owner_user_id IS NOT NULL AND owner_user_id NOT IN (SELECT id FROM users)`
      ).run()
    })
    run()
  } finally {
    db.pragma('foreign_keys = ON')
  }
  return stats
}

const dbPath = process.env.DB_PATH || resolve(process.cwd(), 'data', 'finance.db')
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

console.log('DB:', dbPath)
console.log('foreign_keys:', db.pragma('foreign_keys', { simple: true }))

const repairStats = repairDatabaseReferentialIntegrity(db)
console.log('repair stats:', repairStats)

const sets = db.prepare('SELECT id, name, status FROM account_sets').all()
console.log('account_sets:', sets.length)

const checks = [
  ['orphan users', `SELECT u.id, u.username, u.account_set_id FROM users u LEFT JOIN account_sets a ON u.account_set_id = a.id WHERE u.account_set_id IS NOT NULL AND a.id IS NULL`],
  ['orphan sessions', `SELECT s.id, s.account_set_id, s.user_id FROM user_login_sessions s LEFT JOIN account_sets a ON s.account_set_id = a.id LEFT JOIN users u ON s.user_id = u.id WHERE a.id IS NULL OR u.id IS NULL`],
  ['bad user_roles', `SELECT ur.id, ur.user_id, ur.role_id FROM user_roles ur LEFT JOIN users u ON ur.user_id = u.id LEFT JOIN roles r ON ur.role_id = r.id WHERE u.id IS NULL OR r.id IS NULL`],
  ['users missing role', `SELECT u.id, u.username, u.role_id FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.role_id IS NOT NULL AND r.id IS NULL`],
  ['roles bad owner', `SELECT r.id, r.code, r.owner_user_id FROM roles r LEFT JOIN users u ON r.owner_user_id = u.id WHERE r.owner_user_id IS NOT NULL AND u.id IS NULL`],
]

for (const [name, sql] of checks) {
  try {
    const rows = db.prepare(sql).all()
    if (rows.length) console.log(name + ':', rows)
  } catch (e) {
    console.log(name + ' (skip):', e.message)
  }
}

if (sets[0]) {
  const testUser = db.prepare('SELECT * FROM users WHERE account_set_id = ? LIMIT 1').get(sets[0].id)
  if (testUser) {
    try {
      db.prepare(
        `INSERT INTO user_login_sessions (id, account_set_id, user_id, username, login_ip, status, login_at, last_seen_at)
         VALUES ('test-fk', ?, ?, ?, '127.0.0.1', 'active', datetime('now'), datetime('now'))`
      ).run(sets[0].id, testUser.id, testUser.username)
      db.prepare("DELETE FROM user_login_sessions WHERE id = 'test-fk'").run()
      console.log('test session insert: OK for', testUser.username)
    } catch (e) {
      console.log('test session insert FAIL:', e.message)
    }
  }
}

// 模拟登录写 session（取第一个账套 admin）
const admin = db
  .prepare(
    `SELECT u.id, u.username, u.account_set_id, a.name
     FROM users u
     JOIN account_sets a ON u.account_set_id = a.id
     WHERE u.username = 'admin'
     ORDER BY a.created_at DESC
     LIMIT 1`
  )
  .get()
if (admin) {
  try {
    db.prepare(
      `INSERT INTO user_login_sessions (id, account_set_id, user_id, username, login_ip, status, login_at, last_seen_at)
       VALUES ('test-login', ?, ?, ?, '127.0.0.1', 'active', datetime('now'), datetime('now'))`
    ).run(admin.account_set_id, admin.id, admin.username)
    db.prepare("DELETE FROM user_login_sessions WHERE id = 'test-login'").run()
    console.log('admin login session OK:', admin.name)
  } catch (e) {
    console.log('admin login session FAIL:', e.message)
  }
}

db.close()
