import type Database from 'better-sqlite3'
import { rebuildVoucherFts } from '../../services/voucherFts.js'

/**
 * FIX-320：凭证全文索引改为按凭证 id / 分录 id 关联（原迁移 12 用 rowid，且两张表口径不一致，
 * 按分录摘要 / 科目搜索永远命中不了）。重建两张 FTS 虚表与触发器并回填。
 */
export function up(db: Database.Database): void {
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
  if (!has('vouchers') || !has('voucher_entries')) return
  rebuildVoucherFts(db as any)
}

export function down(): void {
  // 不回退到 rowid 口径（旧口径本身有缺陷）；保留新索引
}
