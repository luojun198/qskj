import type Database from 'better-sqlite3'

/**
 * v108：fixed_asset 新增 purchase_voucher_id（P0-3）
 *
 * 背景：删除资产卡片时，原实现按 `remark LIKE '%（编号 X）%'` 反查购置凭证。
 * 备注一旦被改动、或资产编号含特殊字符，就会漏删凭证（留下孤儿凭证）
 * 或误删他人凭证。改为外键列直连，与 scrap_voucher_id 的做法保持一致。
 *
 * 本迁移同时用一次性 LIKE 回填历史数据——这是 LIKE 反查最后一次被使用。
 */
export function up(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(fixed_asset)').all() as any[]).map((c: any) => c.name)
  if (!cols.includes('purchase_voucher_id')) {
    db.exec(`ALTER TABLE fixed_asset ADD COLUMN purchase_voucher_id TEXT;`)
    console.log('✓ fixed_asset.purchase_voucher_id 字段添加完成')
  }

  const result = db
    .prepare(
      `UPDATE fixed_asset
          SET purchase_voucher_id = (
                SELECT v.id FROM vouchers v
                 WHERE v.account_set_id = fixed_asset.account_set_id
                   AND v.source = 'asset_purchase'
                   AND v.remark LIKE '%（编号 ' || fixed_asset.asset_no || '）%'
                 LIMIT 1
              )
        WHERE purchase_voucher_id IS NULL`
    )
    .run()
  console.log(`✓ 回填历史购置凭证关联，扫描 ${result.changes} 行`)
}

export function down(_db: Database.Database) {
  // SQLite 不支持 DROP COLUMN，跳过
}
