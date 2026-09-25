import type { Database } from 'better-sqlite3'

/**
 * 凭证全文索引（FTS5）维护。FIX-320：
 *  - 旧定义（迁移 12）里 vouchers_fts.voucher_id 存 vouchers.rowid，而 voucher_entries_fts.voucher_id 存凭证 UUID，
 *    查询统一按 v.rowid 过滤，导致「按分录摘要 / 科目」搜索永远命中不了；rowid 在 VACUUM 后还可能重排。
 *  - 两张表统一存凭证 id（UUID），分录表存分录 id，触发器按 id 同步。
 *  - 库被重建 / 恢复后虚表丢失（schema_migrations 仍记着迁移 12 已执行）时，启动自愈重建。
 */

const TRIGGERS = [
  'vouchers_fts_insert', 'vouchers_fts_update', 'vouchers_fts_delete',
  'voucher_entries_fts_insert', 'voucher_entries_fts_update', 'voucher_entries_fts_delete',
]

export function rebuildVoucherFts(db: Database): void {
  db.exec(`
    ${TRIGGERS.map(t => `DROP TRIGGER IF EXISTS ${t};`).join('\n')}
    DROP TABLE IF EXISTS vouchers_fts;
    DROP TABLE IF EXISTS voucher_entries_fts;

    CREATE VIRTUAL TABLE vouchers_fts USING fts5(
      voucher_id UNINDEXED, voucher_no, remark, maker_name, auditor_name, poster_name,
      tokenize='unicode61'
    );
    CREATE VIRTUAL TABLE voucher_entries_fts USING fts5(
      entry_id UNINDEXED, voucher_id UNINDEXED, summary, account_code, account_name,
      tokenize='unicode61'
    );

    INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
    SELECT id, voucher_no, COALESCE(remark, ''), COALESCE(maker_name, ''), COALESCE(auditor_name, ''), COALESCE(poster_name, '')
    FROM vouchers;
    INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
    SELECT id, voucher_id, COALESCE(summary, ''), COALESCE(account_code, ''), COALESCE(account_name, '')
    FROM voucher_entries;

    CREATE TRIGGER vouchers_fts_insert AFTER INSERT ON vouchers BEGIN
      INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
      VALUES (new.id, new.voucher_no, COALESCE(new.remark, ''), COALESCE(new.maker_name, ''),
              COALESCE(new.auditor_name, ''), COALESCE(new.poster_name, ''));
    END;
    CREATE TRIGGER vouchers_fts_update AFTER UPDATE ON vouchers BEGIN
      DELETE FROM vouchers_fts WHERE voucher_id = old.id;
      INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
      VALUES (new.id, new.voucher_no, COALESCE(new.remark, ''), COALESCE(new.maker_name, ''),
              COALESCE(new.auditor_name, ''), COALESCE(new.poster_name, ''));
    END;
    CREATE TRIGGER vouchers_fts_delete AFTER DELETE ON vouchers BEGIN
      DELETE FROM vouchers_fts WHERE voucher_id = old.id;
    END;
    CREATE TRIGGER voucher_entries_fts_insert AFTER INSERT ON voucher_entries BEGIN
      INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
      VALUES (new.id, new.voucher_id, COALESCE(new.summary, ''), COALESCE(new.account_code, ''), COALESCE(new.account_name, ''));
    END;
    CREATE TRIGGER voucher_entries_fts_update AFTER UPDATE ON voucher_entries BEGIN
      DELETE FROM voucher_entries_fts WHERE entry_id = old.id;
      INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
      VALUES (new.id, new.voucher_id, COALESCE(new.summary, ''), COALESCE(new.account_code, ''), COALESCE(new.account_name, ''));
    END;
    CREATE TRIGGER voucher_entries_fts_delete AFTER DELETE ON voucher_entries BEGIN
      DELETE FROM voucher_entries_fts WHERE entry_id = old.id;
    END;
  `)
}

function hasObject(db: Database, type: 'table' | 'trigger', name: string): boolean {
  return !!db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get(type, name)
}

/** 全文索引是否完整（两张虚表 + 六个触发器都在） */
export function isVoucherFtsHealthy(db: Database): boolean {
  if (!hasObject(db, 'table', 'vouchers_fts') || !hasObject(db, 'table', 'voucher_entries_fts')) return false
  return TRIGGERS.every(t => hasObject(db, 'trigger', t))
}

/** 启动自愈：凭证表存在而全文索引缺失 / 不完整时重建；返回是否执行了重建 */
export function ensureVoucherFts(db: Database): boolean {
  if (!hasObject(db, 'table', 'vouchers') || !hasObject(db, 'table', 'voucher_entries')) return false
  if (isVoucherFtsHealthy(db)) return false
  db.transaction(() => rebuildVoucherFts(db))()
  return true
}
