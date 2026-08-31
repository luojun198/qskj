import type Database from 'better-sqlite3'

function hasTable(db: Database.Database, tableName: string): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName)
  return !!result
}

export function up(db: Database.Database) {
  console.log('开始多角色支持迁移...')

  // 1. 创建 user_roles 关联表
  if (!hasTable(db, 'user_roles')) {
    db.exec(`
      CREATE TABLE user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        account_set_id TEXT NOT NULL REFERENCES account_sets(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, role_id, account_set_id)
      );
    `)
    console.log('✓ user_roles 表创建完成')
  } else {
    console.log('⚠ user_roles 表已存在，跳过创建')
  }

  // 2. 迁移现有数据：将 users.role_id 迁移到 user_roles 表
  const usersWithRoles = db
    .prepare('SELECT id, role_id, account_set_id FROM users WHERE role_id IS NOT NULL')
    .all() as Array<{ id: string; role_id: string; account_set_id: string }>

  if (usersWithRoles.length > 0) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO user_roles (id, user_id, role_id, account_set_id)
      VALUES (?, ?, ?, ?)
    `)

    let migratedCount = 0
    usersWithRoles.forEach(user => {
      // 生成 UUID
      const id = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 256)
          .toString(16)
          .padStart(2, '0')
      ).join('')

      const result = insertStmt.run(id, user.id, user.role_id, user.account_set_id)
      if (result.changes > 0) {
        migratedCount++
      }
    })

    console.log(`✓ 已迁移 ${migratedCount} 个用户的角色关联到 user_roles 表`)
  } else {
    console.log('⚠ 没有需要迁移的用户角色数据')
  }

  // 3. 创建索引优化查询性能
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_roles_user 
      ON user_roles(user_id, account_set_id);
    
    CREATE INDEX IF NOT EXISTS idx_user_roles_role 
      ON user_roles(role_id, account_set_id);
    
    CREATE INDEX IF NOT EXISTS idx_user_roles_account 
      ON user_roles(account_set_id);
  `)
  console.log('✓ 索引创建完成')

  console.log('✓ 多角色支持迁移完成')
  console.log('ℹ 注意：users.role_id 和 users.permission_mode 字段已保留用于向后兼容')
}

export function down(db: Database.Database) {
  console.log('开始回滚多角色支持迁移...')

  // 删除索引
  db.exec(`
    DROP INDEX IF EXISTS idx_user_roles_user;
    DROP INDEX IF EXISTS idx_user_roles_role;
    DROP INDEX IF EXISTS idx_user_roles_account;
  `)
  console.log('✓ 索引已删除')

  // 删除 user_roles 表
  db.exec('DROP TABLE IF EXISTS user_roles;')
  console.log('✓ user_roles 表已删除')

  console.log('✓ 多角色支持迁移回滚完成')
}
