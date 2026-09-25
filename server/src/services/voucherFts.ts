import type { Database } from 'better-sqlite3'

/**
 * 凭证全文索引（FTS5）维护。
 *
 * FIX-320：
 *  - 旧定义（迁移 12）里 vouchers_fts.voucher_id 存 vouchers.rowid，而 voucher_entries_fts.voucher_id 存凭证 UUID，
 *    查询统一按 v.rowid 过滤，导致「按分录摘要 / 科目」搜索永远命中不了；rowid 在 VACUUM 后还可能重排。
 *  - 库被重建 / 恢复后虚表丢失（schema_migrations 仍记着迁移 12 已执行）时，启动自愈重建。
 *
 * FIX-321：FIX-320 初版触发器用 `WHERE voucher_id = old.id` 定位索引行，而该列在 FTS5 里 UNINDEXED，
 * 每改一张凭证 / 分录都全表扫描索引（10 万凭证时 14.5ms/张，批量审核 3000 张 104s、批量记账 188s 并阻塞服务）。
 * 改为：FTS 的 rowid 取自对照表的整数主键（INTEGER PRIMARY KEY，VACUUM 不重排），触发器按 rowid 定位（O(log n)）；
 * 更新触发器只在可检索字段变化时执行。索引列里仍存凭证 id（UUID），查询按 v.id 过滤。
 */

export const VOUCHER_FTS_VERSION = 'rowid-key-v2'

const TRIGGERS = [
  'vouchers_fts_insert', 'vouchers_fts_update', 'vouchers_fts_delete',
  'voucher_entries_fts_insert', 'voucher_entries_fts_update', 'voucher_entries_fts_delete',
]

const VKEY = `(SELECT k FROM voucher_fts_key WHERE voucher_id = %s)`
const EKEY = `(SELECT k FROM voucher_entry_fts_key WHERE entry_id = %s)`

export function rebuildVoucherFts(db: Database): void {
  db.exec(`
    ${TRIGGERS.map(t => `DROP TRIGGER IF EXISTS ${t};`).join('\n')}
    DROP TABLE IF EXISTS vouchers_fts;
    DROP TABLE IF EXISTS voucher_entries_fts;
    DROP TABLE IF EXISTS voucher_fts_key;
    DROP TABLE IF EXISTS voucher_entry_fts_key;

    -- ${VOUCHER_FTS_VERSION}：整数键对照表（INTEGER PRIMARY KEY 不随 VACUUM 重排）
    CREATE TABLE voucher_fts_key (k INTEGER PRIMARY KEY, voucher_id TEXT NOT NULL UNIQUE);
    CREATE TABLE voucher_entry_fts_key (k INTEGER PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE);

    CREATE VIRTUAL TABLE vouchers_fts USING fts5(
      voucher_id UNINDEXED, voucher_no, remark, maker_name, auditor_name, poster_name,
      tokenize='unicode61'
    );
    CREATE VIRTUAL TABLE voucher_entries_fts USING fts5(
      entry_id UNINDEXED, voucher_id UNINDEXED, summary, account_code, account_name,
      tokenize='unicode61'
    );

    INSERT INTO voucher_fts_key(voucher_id) SELECT id FROM vouchers;
    INSERT INTO voucher_entry_fts_key(entry_id) SELECT id FROM voucher_entries;
    INSERT INTO vouchers_fts(rowid, voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
    SELECT k.k, v.id, v.voucher_no, COALESCE(v.remark, ''), COALESCE(v.maker_name, ''), COALESCE(v.auditor_name, ''), COALESCE(v.poster_name, '')
    FROM vouchers v JOIN voucher_fts_key k ON k.voucher_id = v.id;
    INSERT INTO voucher_entries_fts(rowid, entry_id, voucher_id, summary, account_code, account_name)
    SELECT k.k, e.id, e.voucher_id, COALESCE(e.summary, ''), COALESCE(e.account_code, ''), COALESCE(e.account_name, '')
    FROM voucher_entries e JOIN voucher_entry_fts_key k ON k.entry_id = e.id;

    CREATE TRIGGER vouchers_fts_insert AFTER INSERT ON vouchers BEGIN
      INSERT OR IGNORE INTO voucher_fts_key(voucher_id) VALUES (new.id);
      INSERT INTO vouchers_fts(rowid, voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
      VALUES (${VKEY.replace('%s', 'new.id')}, new.id, new.voucher_no, COALESCE(new.remark, ''), COALESCE(new.maker_name, ''),
              COALESCE(new.auditor_name, ''), COALESCE(new.poster_name, ''));
    END;
    CREATE TRIGGER vouchers_fts_update AFTER UPDATE OF id, voucher_no, remark, maker_name, auditor_name, poster_name ON vouchers BEGIN
      UPDATE voucher_fts_key SET voucher_id = new.id WHERE voucher_id = old.id;
      UPDATE vouchers_fts SET voucher_id = new.id, voucher_no = new.voucher_no, remark = COALESCE(new.remark, ''),
        maker_name = COALESCE(new.maker_name, ''), auditor_name = COALESCE(new.auditor_name, ''), poster_name = COALESCE(new.poster_name, '')
      WHERE rowid = ${VKEY.replace('%s', 'new.id')};
    END;
    CREATE TRIGGER vouchers_fts_delete AFTER DELETE ON vouchers BEGIN
      DELETE FROM vouchers_fts WHERE rowid = ${VKEY.replace('%s', 'old.id')};
      DELETE FROM voucher_fts_key WHERE voucher_id = old.id;
    END;

    CREATE TRIGGER voucher_entries_fts_insert AFTER INSERT ON voucher_entries BEGIN
      INSERT OR IGNORE INTO voucher_entry_fts_key(entry_id) VALUES (new.id);
      INSERT INTO voucher_entries_fts(rowid, entry_id, voucher_id, summary, account_code, account_name)
      VALUES (${EKEY.replace('%s', 'new.id')}, new.id, new.voucher_id, COALESCE(new.summary, ''), COALESCE(new.account_code, ''), COALESCE(new.account_name, ''));
    END;
    CREATE TRIGGER voucher_entries_fts_update AFTER UPDATE OF id, voucher_id, summary, account_code, account_name ON voucher_entries BEGIN
      UPDATE voucher_entry_fts_key SET entry_id = new.id WHERE entry_id = old.id;
      UPDATE voucher_entries_fts SET entry_id = new.id, voucher_id = new.voucher_id, summary = COALESCE(new.summary, ''),
        account_code = COALESCE(new.account_code, ''), account_name = COALESCE(new.account_name, '')
      WHERE rowid = ${EKEY.replace('%s', 'new.id')};
    END;
    CREATE TRIGGER voucher_entries_fts_delete AFTER DELETE ON voucher_entries BEGIN
      DELETE FROM voucher_entries_fts WHERE rowid = ${EKEY.replace('%s', 'old.id')};
      DELETE FROM voucher_entry_fts_key WHERE entry_id = old.id;
    END;
  `)
}

function hasObject(db: Database, type: 'table' | 'trigger', name: string): boolean {
  return !!db.prepare('SELECT 1 FROM sqlite_master WHERE type=? AND name=?').get(type, name)
}

/** 全文索引是否完整且为当前版本（虚表 + 对照表 + 六个按 rowid 定位的触发器） */
export function isVoucherFtsHealthy(db: Database): boolean {
  for (const t of ['vouchers_fts', 'voucher_entries_fts', 'voucher_fts_key', 'voucher_entry_fts_key']) {
    if (!hasObject(db, 'table', t)) return false
  }
  if (!TRIGGERS.every(t => hasObject(db, 'trigger', t))) return false
  // 旧版触发器（按 UNINDEXED 列定位）视为不健康，需重建
  const upd = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='vouchers_fts_update'").get() as { sql?: string } | undefined
  return !!upd?.sql?.includes('voucher_fts_key')
}

/** 启动自愈：凭证表存在而全文索引缺失 / 不完整 / 旧版时重建；返回是否执行了重建 */
export function ensureVoucherFts(db: Database): boolean {
  if (!hasObject(db, 'table', 'vouchers') || !hasObject(db, 'table', 'voucher_entries')) return false
  if (isVoucherFtsHealthy(db)) return false
  db.transaction(() => rebuildVoucherFts(db))()
  return true
}
