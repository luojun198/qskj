import type Database from 'better-sqlite3'

/**
 * 2026-09-17 综合评审 P1-2：出纳流水币别 CNY → RMB 归一。
 * 供应链收付款单默认币别 CNY，出纳全链路默认 RMB，同一本位币被拆成两个"币种"，
 * 收付款流水在出纳日记账 / 账户余额表默认视图里消失。写入侧已统一归一，这里修正存量。
 */
export function up(db: Database.Database): void {
  const fix = (table: string) => {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists) return 0
    return db.prepare(`UPDATE ${table} SET currency='RMB' WHERE UPPER(TRIM(currency))='CNY'`).run().changes
  }
  const j = fix('cashier_journal')
  const b = fix('cashier_init_balance')
  console.log(`✓ 出纳币别 CNY→RMB：cashier_journal ${j} 行、cashier_init_balance ${b} 行`)
}

export function down(_db: Database.Database): void {
  console.log('⚠ 币别归一不可逆（无法区分原始写法），跳过回滚')
}
