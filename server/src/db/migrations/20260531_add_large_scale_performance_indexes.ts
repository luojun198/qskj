import type Database from 'better-sqlite3'

/**
 * 十万级辅助项目 / 大批量凭证场景下的查询与导入性能索引
 */
export function up(db: Database.Database) {
  db.exec(`
    -- aux_items：分页列表、按 status+code 排序
    CREATE INDEX IF NOT EXISTS idx_aux_items_list
      ON aux_items(account_set_id, type, status, code);

    -- aux_items：按名称精确匹配（导入校验、默认项目）
    CREATE INDEX IF NOT EXISTS idx_aux_items_type_name
      ON aux_items(account_set_id, type, name);

    -- init_balances：辅助期初按 aux_item_id 引用检查
    CREATE INDEX IF NOT EXISTS idx_init_balances_aux_item
      ON init_balances(account_set_id, aux_item_id)
      WHERE aux_item_id != '';

    -- account_balances：累计发生额 SUM(period <= ?) GROUP BY account_id
    CREATE INDEX IF NOT EXISTS idx_account_balances_account_cum
      ON account_balances(account_set_id, year, account_id, period);

    -- account_balances：辅助余额行
    CREATE INDEX IF NOT EXISTS idx_account_balances_aux
      ON account_balances(account_set_id, account_id, aux_item_id, year, period);

    -- voucher_entries：辅助固定列（删除守卫、账簿筛选）
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_dept
      ON voucher_entries(account_set_id, dept_id)
      WHERE dept_id IS NOT NULL AND dept_id != '';
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_project
      ON voucher_entries(account_set_id, project_id)
      WHERE project_id IS NOT NULL AND project_id != '';
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_supplier
      ON voucher_entries(account_set_id, supplier_id)
      WHERE supplier_id IS NOT NULL AND supplier_id != '';
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_person
      ON voucher_entries(account_set_id, person_id)
      WHERE person_id IS NOT NULL AND person_id != '';
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_func_class
      ON voucher_entries(account_set_id, func_class_id)
      WHERE func_class_id IS NOT NULL AND func_class_id != '';
  `)
  console.log('✓ 十万级性能索引已创建')
}

export function down(db: Database.Database) {
  db.exec(`
    DROP INDEX IF EXISTS idx_aux_items_list;
    DROP INDEX IF EXISTS idx_aux_items_type_name;
    DROP INDEX IF EXISTS idx_init_balances_aux_item;
    DROP INDEX IF EXISTS idx_account_balances_account_cum;
    DROP INDEX IF EXISTS idx_account_balances_aux;
    DROP INDEX IF EXISTS idx_voucher_entries_dept;
    DROP INDEX IF EXISTS idx_voucher_entries_project;
    DROP INDEX IF EXISTS idx_voucher_entries_supplier;
    DROP INDEX IF EXISTS idx_voucher_entries_person;
    DROP INDEX IF EXISTS idx_voucher_entries_func_class;
  `)
  console.log('✓ 十万级性能索引已删除')
}
