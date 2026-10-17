import type Database from 'better-sqlite3'

/**
 * v170：批次流水记录金额（SCM-8）
 *
 * - scm_batch_move.amount：本笔批次进出的金额。反审核回退批次台账时按它把金额一并还原，
 *   原来只回数量，批次金额 / 单价残留，批次成本与库存金额偏离。
 * - 可空；存量流水为 NULL，回退时按批次当前均价估算。
 */
export function up(db: Database.Database) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scm_batch_move'").get()
  if (!has) return
  const cols = new Set((db.prepare('PRAGMA table_info(scm_batch_move)').all() as Array<{ name: string }>).map(c => c.name))
  if (!cols.has('amount')) db.exec('ALTER TABLE scm_batch_move ADD COLUMN amount REAL')
  console.log('✓ 批次流水：金额列已就绪')
}

export function down(_db: Database.Database) {
  // SQLite 删列需重建表；新增列可空、不影响旧代码，回滚时保留
}
