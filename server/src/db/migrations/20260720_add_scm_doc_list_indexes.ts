import type Database from 'better-sqlite3'

/**
 * 供应链单据列表性能索引
 *
 * 背景：GET /scm/docs 列表与上下游追溯共用 queryDocRows()。重写为「主行 + IN(...) 批量聚合 +
 * JS 合并」后，瓶颈从「N×16 个行级关联子查询」转移到若干次按 doc_id / source_doc_id / source_line_id
 * 的批量聚合查询。本迁移补充这些批量查询、列表分页排序和主表 JOIN 所需的复合索引。
 */
export function up(db: Database.Database) {
  db.exec(`
    -- 1. 列表分页排序：覆盖最常用的 ORDER BY doc_date DESC, doc_no DESC
    --    （account_set_id + doc_type 是过滤条件，后两列匹配排序，可避免 filesort）
    CREATE INDEX IF NOT EXISTS idx_scm_doc_list_sort
      ON scm_doc(account_set_id, doc_type, doc_date DESC, doc_no DESC);

    -- 2. scm_doc_line 按 doc_id 聚合的核心索引
    --    （queryDocRows 批量取明细行：WHERE doc_id IN (...) GROUP BY doc_id）
    CREATE INDEX IF NOT EXISTS idx_scm_doc_line_doc_set
      ON scm_doc_line(doc_id, account_set_id);

    -- 3. partner / warehouse JOIN 用的复合索引（原只有 account_set_id 单列索引）
    CREATE INDEX IF NOT EXISTS idx_scm_partner_set_code
      ON scm_partner(account_set_id, code);
    CREATE INDEX IF NOT EXISTS idx_scm_warehouse_set_code
      ON scm_warehouse(account_set_id, code);

    -- 4. MRP source 按 source_id 关联（idx_scm_mrp_source_origin 是 source_kind 在前，
    --    列表批量聚合时 source_id 在前更友好）
    CREATE INDEX IF NOT EXISTS idx_scm_mrp_source_id
      ON scm_mrp_source(source_id, source_kind, account_set_id);
  `)
  console.log('✓ 已添加供应链单据列表性能索引')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_scm_doc_list_sort;
    DROP INDEX IF EXISTS idx_scm_doc_line_doc_set;
    DROP INDEX IF EXISTS idx_scm_partner_set_code;
    DROP INDEX IF EXISTS idx_scm_warehouse_set_code;
    DROP INDEX IF EXISTS idx_scm_mrp_source_id;
  `)
}
