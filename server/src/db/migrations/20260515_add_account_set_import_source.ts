import type { Database } from 'better-sqlite3'

/**
 * 添加账套来源标记字段
 * 用于区分手动创建的账套和从 ACD 导入的账套
 */
export function up(db: Database): void {
  console.log('[Migration] 添加 account_sets.import_source 字段')

  const columns = db.prepare('PRAGMA table_info(account_sets)').all() as Array<{ name: string }>
  const hasImportSource = columns.some(column => column.name === 'import_source')

  if (!hasImportSource) {
    db.exec(`
      ALTER TABLE account_sets ADD COLUMN import_source TEXT DEFAULT 'manual';
    `)
  }

  // 自动识别已导入的 ACD 账套（通过检查是否有 MANAGER 用户）
  db.exec(`
    UPDATE account_sets
    SET import_source = 'acd'
    WHERE id IN (
      SELECT DISTINCT account_set_id
      FROM users
      WHERE username = 'MANAGER'
    );
  `)

  console.log('[Migration] account_sets.import_source 字段添加完成')
}

export function down(db: Database): void {
  console.log('[Migration] 回滚 account_sets.import_source 字段')

  // SQLite 不支持 DROP COLUMN，需要重建表
  // 但为了简化，这里只是清空该字段的值
  db.exec(`
    UPDATE account_sets SET import_source = 'manual';
  `)

  console.log('[Migration] account_sets.import_source 字段已重置')
}
