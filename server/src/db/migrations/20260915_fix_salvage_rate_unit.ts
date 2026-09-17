import type Database from 'better-sqlite3'

/**
 * AS-P0-1（2026-09-15 固定资产评审）：残值率（salvage_rate）双量纲混存修正。
 *
 * 历史现状：卡片页/类别字典按「百分数 0~100」录入（如 5 表示 5%），
 * 批量导入按「小数 0~1」校验，而服务端消费端（原值变动重算残值、折旧要素调整）
 * 一律把该列当小数乘——卡片页建的资产走一次原值变动后残值=原值×5，折旧静默停止。
 *
 * 本迁移把存量数据统一为小数口径：>1 视为百分数，÷100。
 * ≤1 的值无法区分是「真小数」还是「0.x% 的百分数」，按真小数处理（导入路径与
 * AssetChange 页输入均为小数，概率上远高于 0.x% 的录入）。
 * 修复后所有写入入口统一走 normalizeSalvageRate（assetVoucherBuilder.ts）。
 */
export function up(db: Database.Database): void {
  const fix = (table: string): number => {
    const exists = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table)
    if (!exists) return 0
    const result = db
      .prepare(`UPDATE ${table} SET salvage_rate = ROUND(salvage_rate / 100, 6) WHERE salvage_rate > 1`)
      .run()
    return Number(result.changes ?? 0)
  }

  const cardFixed = fix('fixed_asset')
  const categoryFixed = fix('fixed_asset_category')
  console.log(`✓ 残值率量纲统一为小数：fixed_asset 修正 ${cardFixed} 行、fixed_asset_category 修正 ${categoryFixed} 行`)
}

export function down(_db: Database.Database): void {
  console.log('⚠ 残值率量纲修正不可逆（无法区分原始量纲），跳过回滚')
}
