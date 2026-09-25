import type Database from 'better-sqlite3'
import { rebuildVoucherFts } from '../../services/voucherFts.js'

/**
 * FIX-321：凭证全文索引触发器改为按整数键 rowid 定位（迁移 149 版本按 UNINDEXED 列定位，
 * 每改一张凭证都全表扫描索引，批量审核 / 记账严重变慢并阻塞服务）。重建索引、对照表与触发器。
 */
export function up(db: Database.Database): void {
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
  if (!has('vouchers') || !has('voucher_entries')) return
  rebuildVoucherFts(db as any)
}

export function down(): void {
  // 不回退到按 UNINDEXED 列定位的慢触发器
}
