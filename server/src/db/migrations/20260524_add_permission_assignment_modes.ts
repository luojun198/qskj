import type Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, col: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === col)
}

export function up(db: Database.Database) {
  // 1. 为 users 表添加权限分配模式字段
  if (!hasColumn(db, 'users', 'permission_mode')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN permission_mode TEXT DEFAULT 'role' 
        CHECK(permission_mode IN ('role', 'custom'));
    `)
    console.log('✓ users.permission_mode 字段添加完成')
  }

  if (!hasColumn(db, 'users', 'custom_permissions')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN custom_permissions TEXT;
    `)
    console.log('✓ users.custom_permissions 字段添加完成')
  }

  // 2. 为 roles 表添加个人角色标识字段
  if (!hasColumn(db, 'roles', 'is_personal')) {
    db.exec(`
      ALTER TABLE roles ADD COLUMN is_personal INTEGER DEFAULT 0;
    `)
    console.log('✓ roles.is_personal 字段添加完成')
  }

  if (!hasColumn(db, 'roles', 'owner_user_id')) {
    db.exec(`
      ALTER TABLE roles ADD COLUMN owner_user_id TEXT REFERENCES users(id);
    `)
    console.log('✓ roles.owner_user_id 字段添加完成')
  }

  // 3. 为现有用户设置默认权限模式为 'role'
  const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  if (usersCount.count > 0) {
    db.prepare(`
      UPDATE users 
      SET permission_mode = 'role' 
      WHERE permission_mode IS NULL
    `).run()
    console.log(`✓ 已为 ${usersCount.count} 个现有用户设置 permission_mode='role'`)
  }

  // 4. 为现有角色设置 is_personal=0
  const rolesCount = db.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number }
  if (rolesCount.count > 0) {
    db.prepare(`
      UPDATE roles 
      SET is_personal = 0 
      WHERE is_personal IS NULL
    `).run()
    console.log(`✓ 已为 ${rolesCount.count} 个现有角色设置 is_personal=0`)
  }

  // 5. 创建索引以优化查询性能
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_permission_mode 
      ON users(account_set_id, permission_mode);
    
    CREATE INDEX IF NOT EXISTS idx_roles_personal 
      ON roles(account_set_id, is_personal);
    
    CREATE INDEX IF NOT EXISTS idx_roles_owner 
      ON roles(owner_user_id);
  `)
  console.log('✓ 索引创建完成')

  console.log('✓ 权限分配模式迁移完成')
}

export function down(db: Database.Database) {
  // 回滚：删除索引
  db.exec(`
    DROP INDEX IF EXISTS idx_users_permission_mode;
    DROP INDEX IF EXISTS idx_roles_personal;
    DROP INDEX IF EXISTS idx_roles_owner;
  `)
  console.log('✓ 索引已删除')

  // 注意：SQLite 不支持 DROP COLUMN，需要重建表
  // 由于这是新增字段，回滚时可以选择保留字段但不使用
  // 或者通过重建表来完全删除字段
  
  console.log('⚠️  注意：SQLite 不支持 DROP COLUMN')
  console.log('⚠️  新增字段已保留但不再使用')
  console.log('⚠️  如需完全删除字段，请手动重建表')
  
  // 如果需要完全删除字段，可以取消注释以下代码：
  /*
  db.exec('PRAGMA foreign_keys = OFF;')

  // 重建 users 表（移除新增字段）
  db.exec(`
    CREATE TABLE users_old (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT,
      role_id TEXT,
      email TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'locked')),
      last_login_at TEXT,
      last_login_ip TEXT,
      failed_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      password_expire_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, username)
    );

    INSERT INTO users_old 
    SELECT id, account_set_id, username, password, nickname, role_id, email, phone,
           status, last_login_at, last_login_ip, failed_attempts, locked_until,
           password_expire_at, created_at, updated_at
    FROM users;

    DROP TABLE users;
    ALTER TABLE users_old RENAME TO users;

    CREATE INDEX IF NOT EXISTS idx_users_account_set ON users(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `)

  // 重建 roles 表（移除新增字段）
  db.exec(`
    CREATE TABLE roles_old (
      id TEXT PRIMARY KEY,
      account_set_id TEXT REFERENCES account_sets(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      permissions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_set_id, code)
    );

    INSERT INTO roles_old 
    SELECT id, account_set_id, name, code, description, is_system, permissions, created_at
    FROM roles;

    DROP TABLE roles;
    ALTER TABLE roles_old RENAME TO roles;

    CREATE INDEX IF NOT EXISTS idx_roles_account_set_id ON roles(account_set_id);
    CREATE INDEX IF NOT EXISTS idx_roles_account_set_code ON roles(account_set_id, code);
  `)

  db.exec('PRAGMA foreign_keys = ON;')
  console.log('✓ 表结构已恢复')
  */
}
