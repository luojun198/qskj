import { getDb } from '../db/index.js'
import { log } from '../utils/logger.js'

/**
 * 确保FTS触发器正确
 * 在启动时检查触发器是否存在且正确，如果有问题则自动修复
 */
export function ensureFTSTriggers() {
  const db = getDb()

  try {
    // 检查触发器是否存在且正确
    const trigger = db
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type='trigger' AND name='voucher_entries_fts_update'`
      )
      .get() as any

    // 检查触发器SQL是否包含错误的 rowid 引用
    const needsFix =
      !trigger || trigger.sql.includes('old.rowid') || trigger.sql.includes('new.rowid')

    if (needsFix) {
      log.info('检测到FTS触发器需要修复，正在修复...')

      // 删除旧触发器
      db.prepare('DROP TRIGGER IF EXISTS voucher_entries_fts_insert').run()
      db.prepare('DROP TRIGGER IF EXISTS voucher_entries_fts_update').run()
      db.prepare('DROP TRIGGER IF EXISTS voucher_entries_fts_delete').run()

      // 创建正确的INSERT触发器
      db.prepare(`
        CREATE TRIGGER voucher_entries_fts_insert AFTER INSERT ON voucher_entries BEGIN
          INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
          VALUES (new.id, new.voucher_id, COALESCE(new.summary, ''), new.account_code, new.account_name);
        END
      `).run()

      // 创建正确的UPDATE触发器
      db.prepare(`
        CREATE TRIGGER voucher_entries_fts_update AFTER UPDATE ON voucher_entries BEGIN
          DELETE FROM voucher_entries_fts WHERE entry_id = old.id;
          INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
          VALUES (new.id, new.voucher_id, COALESCE(new.summary, ''), new.account_code, new.account_name);
        END
      `).run()

      // 创建正确的DELETE触发器
      db.prepare(`
        CREATE TRIGGER voucher_entries_fts_delete AFTER DELETE ON voucher_entries BEGIN
          DELETE FROM voucher_entries_fts WHERE entry_id = old.id;
        END
      `).run()

      log.info('✓ FTS触发器已修复')
    } else {
      log.info('✓ FTS触发器正常')
    }
  } catch (error) {
    log.error('FTS触发器检查失败:', error)
    // 不抛出错误，避免影响服务启动
  }
}
