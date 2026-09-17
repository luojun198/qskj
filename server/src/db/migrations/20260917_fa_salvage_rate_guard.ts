import type Database from 'better-sqlite3'

/**
 * 2026-09-17 综合评审 P0-3：残值率量纲 DB 层兜底。
 *
 * 迁移 123 只修正了一次存量，之后拆分（applySplit）/ 盘盈调增（adjustSurplusAssets）
 * 没有走 normalizeSalvageRate，供应链采购生成卡片写 5、ACD 导入原样写 czl，
 * 百分数口径又会重新混进来——残值被放大 100 倍、资产静默停止折旧。
 * 应用层入口已全部归一，这里再加触发器：任何写入 >1 或 <0 的 salvage_rate 直接失败，
 * 让漏网路径"报错"而不是"静默产生错账"。
 */
const TABLES = ['fixed_asset', 'fixed_asset_category']

function hasTable(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
}

export function up(db: Database.Database): void {
  for (const table of TABLES) {
    if (!hasTable(db, table)) continue
    // 先把存量再修正一次（与迁移 123 同规则），避免触发器建好后旧行阻塞后续 UPDATE
    const fixed = db
      .prepare(`UPDATE ${table} SET salvage_rate = ROUND(salvage_rate / 100, 6) WHERE salvage_rate > 1`)
      .run().changes
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${table}_salvage_rate_ins
      BEFORE INSERT ON ${table}
      FOR EACH ROW WHEN NEW.salvage_rate IS NOT NULL AND (NEW.salvage_rate > 1 OR NEW.salvage_rate < 0)
      BEGIN
        SELECT RAISE(ABORT, 'salvage_rate 必须为 0~1 的小数（如 0.05 表示 5%）');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_${table}_salvage_rate_upd
      BEFORE UPDATE OF salvage_rate ON ${table}
      FOR EACH ROW WHEN NEW.salvage_rate IS NOT NULL AND (NEW.salvage_rate > 1 OR NEW.salvage_rate < 0)
      BEGIN
        SELECT RAISE(ABORT, 'salvage_rate 必须为 0~1 的小数（如 0.05 表示 5%）');
      END;
    `)
    console.log(`✓ ${table}：残值率触发器已建，存量修正 ${fixed} 行`)
  }
}

export function down(db: Database.Database): void {
  for (const table of TABLES) {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_${table}_salvage_rate_ins;
      DROP TRIGGER IF EXISTS trg_${table}_salvage_rate_upd;
    `)
  }
}
