import { Migration } from './migrations.js'
import {
  up as scopeRolesByAccountSetUp,
  down as scopeRolesByAccountSetDown,
} from './migrations/20260515_scope_roles_by_account_set.js'
import {
  up as addAccountSetImportSourceUp,
  down as addAccountSetImportSourceDown,
} from './migrations/20260515_add_account_set_import_source.js'
import {
  up as addCashFlowUp,
  down as addCashFlowDown,
} from './migrations/20260514_add_cash_flow.js'
import {
  up as addBudgetSurplusAdjustmentsUp,
  down as addBudgetSurplusAdjustmentsDown,
} from './migrations/20260518_add_budget_surplus_adjustments.js'
import {
  up as removeVoucherTypePrefixUp,
  down as removeVoucherTypePrefixDown,
} from './migrations/20260518_remove_voucher_type_prefix.js'
import {
  up as initBalancesAuxUniqueUp,
  down as initBalancesAuxUniqueDown,
} from './migrations/20260518_init_balances_aux_unique.js'
import {
  up as normalizeReportDefinitionsSortOrderUp,
  down as normalizeReportDefinitionsSortOrderDown,
} from './migrations/20260523_normalize_report_definitions_sort_order.js'
import {
  up as addPermissionAssignmentModesUp,
  down as addPermissionAssignmentModesDown,
} from './migrations/20260524_add_permission_assignment_modes.js'
import {
  up as addMultiRoleSupportUp,
  down as addMultiRoleSupportDown,
} from './migrations/20260525_add_multi_role_support.js'
import {
  up as fixVoucherNullTypeUniqueUp,
  down as fixVoucherNullTypeUniqueDown,
} from './migrations/20260524_fix_voucher_null_type_unique.js'
import {
  up as addInitBalanceSourceUp,
  down as addInitBalanceSourceDown,
} from './migrations/20260525_add_init_balance_source.js'
import {
  up as addDashboardPermissionUp,
  down as addDashboardPermissionDown,
} from './migrations/20260525_add_dashboard_permission.js'
import {
  up as addAccountScopesUp,
  down as addAccountScopesDown,
} from './migrations/20260526_add_account_scopes.js'
import {
  up as addLicenseActivationUp,
  down as addLicenseActivationDown,
} from './migrations/20260526_add_license_activation.js'
import {
  up as addAsyncTasksUp,
  down as addAsyncTasksDown,
} from './migrations/20260530_add_async_tasks.js'
import {
  up as addLargeScalePerformanceIndexesUp,
  down as addLargeScalePerformanceIndexesDown,
} from './migrations/20260531_add_large_scale_performance_indexes.js'
import {
  up as removeRedundantAuxItemsTypeIndexUp,
  down as removeRedundantAuxItemsTypeIndexDown,
} from './migrations/20260715_remove_redundant_aux_items_type_index.js'
import {
  up as upgradeDashboardRulesV2Up,
  down as upgradeDashboardRulesV2Down,
} from './migrations/20260716_upgrade_dashboard_rules_v2.js'
import {
  up as addMrpDocumentsUp,
  down as addMrpDocumentsDown,
} from './migrations/20260717_add_mrp_documents.js'
import {
  up as addProductionIssuePerformanceIndexesUp,
  down as addProductionIssuePerformanceIndexesDown,
} from './migrations/20260718_add_production_issue_performance_indexes.js'
import {
  up as addOutsourceFeeTaxUp,
  down as addOutsourceFeeTaxDown,
} from './migrations/20260718_add_outsource_fee_tax.js'
import {
  up as addScmDocumentActionIndexesUp,
  down as addScmDocumentActionIndexesDown,
} from './migrations/20260718_add_scm_document_action_indexes.js'
import {
  up as addScmDocListIndexesUp,
  down as addScmDocListIndexesDown,
} from './migrations/20260720_add_scm_doc_list_indexes.js'
import {
  up as addScmArapDocIndexUp,
  down as addScmArapDocIndexDown,
} from './migrations/20260720_add_scm_arap_doc_index.js'
import {
  up as addScmItemDefaultWarehouseUp,
  down as addScmItemDefaultWarehouseDown,
} from './migrations/20260722_add_scm_item_default_warehouse.js'
import {
  up as extendRhStandardReportEditableUp,
  down as extendRhStandardReportEditableDown,
} from './migrations/20260901_extend_rh_standard_report_editable.js'
import {
  up as fixStandardReportTitleMergeUp,
  down as fixStandardReportTitleMergeDown,
} from './migrations/20260901_fix_standard_report_title_merge.js'
import {
  up as backfillUnitNameFromAcdUp,
  down as backfillUnitNameFromAcdDown,
} from './migrations/20260901_backfill_unit_name_from_acd.js'
import {
  up as addAssetPurchaseVoucherIdUp,
  down as addAssetPurchaseVoucherIdDown,
} from './migrations/20260610_add_asset_purchase_voucher_id.js'
import {
  up as backfillAssetChangePermissionsUp,
  down as backfillAssetChangePermissionsDown,
} from './migrations/20260610_backfill_asset_change_permissions.js'
import {
  up as extendAssetChangeUp,
  down as extendAssetChangeDown,
} from './migrations/20260611_extend_asset_change.js'
import {
  up as addAssetImpairmentUp,
  down as addAssetImpairmentDown,
} from './migrations/20260612_add_asset_impairment.js'
import {
  up as addAssetRequisitionUp,
  down as addAssetRequisitionDown,
} from './migrations/20260613_add_asset_requisition.js'
import {
  up as addVoucherReversalUp,
  down as addVoucherReversalDown,
} from './migrations/20260904_add_voucher_reversal.js'
import {
  up as addForeignCurrencyUp,
  down as addForeignCurrencyDown,
} from './migrations/20260905_add_foreign_currency.js'
import {
  up as alignStandardReportBoldUp,
  down as alignStandardReportBoldDown,
} from './migrations/20260906_align_standard_report_bold.js'
import {
  up as centerStandardReportHeaderDateUp,
  down as centerStandardReportHeaderDateDown,
} from './migrations/20260906_center_standard_report_header_date.js'
import {
  up as moveStandardReportHeaderLabelUp,
  down as moveStandardReportHeaderLabelDown,
} from './migrations/20260906_move_standard_report_header_label.js'
import {
  up as currencyBeginEndRateUp,
  down as currencyBeginEndRateDown,
} from './migrations/20260908_currency_begin_end_rate.js'
import {
  up as fxRevaluationRunsUp,
  down as fxRevaluationRunsDown,
} from './migrations/20260908_fx_revaluation_runs.js'
import {
  up as addQuantityAccountingUp,
  down as addQuantityAccountingDown,
} from './migrations/20260909_add_quantity_accounting.js'
import {
  up as voucherTypeIsClosingUp,
  down as voucherTypeIsClosingDown,
} from './migrations/20260915_voucher_type_is_closing.js'
import {
  up as backfillInitBalanceOpeningUp,
  down as backfillInitBalanceOpeningDown,
} from './migrations/20260915_backfill_init_balance_opening.js'
import {
  up as fixSalvageRateUnitUp,
  down as fixSalvageRateUnitDown,
} from './migrations/20260915_fix_salvage_rate_unit.js'
import {
  up as fixBalanceSheetTemplateFormulasUp,
  down as fixBalanceSheetTemplateFormulasDown,
} from './migrations/20260531_fix_balance_sheet_template_formulas.js'
import {
  up as fixBalanceSheetLiabSumUp,
  down as fixBalanceSheetLiabSumDown,
} from './migrations/20260531_fix_balance_sheet_liab_sum.js'
import {
  up as addCashierUp,
  down as addCashierDown,
} from './migrations/20260601_add_cashier.js'
import {
  up as addFixedAssetUp,
  down as addFixedAssetDown,
} from './migrations/20260601_add_fixed_asset.js'
import {
  up as addVoucherSourceUp,
  down as addVoucherSourceDown,
} from './migrations/20260601_add_voucher_source.js'
import {
  up as addAssetChangeTypeUp,
  down as addAssetChangeTypeDown,
} from './migrations/20260602_add_asset_change_type.js'
import {
  up as addAssetWorkloadUp,
  down as addAssetWorkloadDown,
} from './migrations/20260602_add_asset_workload.js'
import {
  up as addAssetInventoryUp,
  down as addAssetInventoryDown,
} from './migrations/20260602_add_asset_inventory.js'
import {
  up as addCashierJournalAuxUp,
  down as addCashierJournalAuxDown,
} from './migrations/20260603_cashier_journal_aux.js'
import {
  up as addCashierInitBalanceDateUp,
  down as addCashierInitBalanceDateDown,
} from './migrations/20260603_cashier_init_balance_date.js'
import {
  up as addCashierJournalMatchBatchUp,
  down as addCashierJournalMatchBatchDown,
} from './migrations/20260603_cashier_journal_match_batch.js'
import {
  up as addAssetCategoryAccountingFieldsUp,
  down as addAssetCategoryAccountingFieldsDown,
} from './migrations/20260603_add_asset_category_accounting_fields.js'
import {
  up as addDeprVoucherLinkUp,
  down as addDeprVoucherLinkDown,
} from './migrations/20260604_add_depr_voucher_link.js'
import {
  up as addCashierAttachmentsUp,
  down as addCashierAttachmentsDown,
} from './migrations/20260605_add_cashier_attachments.js'
import {
  up as backfillCashierAssetPermsUp,
  down as backfillCashierAssetPermsDown,
} from './migrations/20260605_backfill_cashier_asset_permissions.js'
import {
  up as addScmCoreUp,
  down as addScmCoreDown,
} from './migrations/20260605_add_scm_core.js'
import {
  up as addScmArapBomUp,
  down as addScmArapBomDown,
} from './migrations/20260605_add_scm_arap_bom.js'
import {
  up as addAssetScrapVoucherUp,
  down as addAssetScrapVoucherDown,
} from './migrations/20260604_add_asset_scrap_voucher.js'
import {
  up as backfillScmPermsUp,
  down as backfillScmPermsDown,
} from './migrations/20260605_backfill_scm_permissions.js'
import {
  up as addRhStandardReportsUp,
  down as addRhStandardReportsDown,
} from './migrations/20260605_add_rh_standard_reports.js'
import {
  up as extendPrintTemplatesHiprintUp,
  down as extendPrintTemplatesHiprintDown,
} from './migrations/20260606_extend_print_templates_for_hiprint.js'
import {
  up as addScmDocBomIdUp,
  down as addScmDocBomIdDown,
} from './migrations/20260608_add_scm_doc_bom_id.js'
import {
  up as addScmUnitUp,
  down as addScmUnitDown,
} from './migrations/20260608_add_scm_unit.js'
import {
  up as addScmItemTreeUp,
  down as addScmItemTreeDown,
} from './migrations/20260608_add_scm_item_tree.js'
import {
  up as addScmItemNatureUp,
  down as addScmItemNatureDown,
} from './migrations/20260609_add_scm_item_nature.js'
import {
  up as addScmItemCustomFieldsUp,
  down as addScmItemCustomFieldsDown,
} from './migrations/20260609_add_scm_item_custom_fields.js'
import {
  up as addScmDocTypeFieldConfigUp,
  down as addScmDocTypeFieldConfigDown,
} from './migrations/20260618_add_scm_doctype_field_config.js'
import {
  up as extendScmDocFieldsUp,
  down as extendScmDocFieldsDown,
} from './migrations/20260618_extend_scm_doc_fields.js'
import {
  up as extendScmProductionUp,
  down as extendScmProductionDown,
} from './migrations/20260618_extend_scm_production.js'
import {
  up as extendScmMasterUp,
  down as extendScmMasterDown,
} from './migrations/20260618_extend_scm_master.js'
import {
  up as addProductionPlanTypeUp,
  down as addProductionPlanTypeDown,
} from './migrations/20260619_add_production_plan_type.js'
import {
  up as addDocLineSupplierAndMrUp,
  down as addDocLineSupplierAndMrDown,
} from './migrations/20260619_add_doc_line_supplier_and_mr.js'
import {
  up as addItemSourcePartnerOutsourceUp,
  down as addItemSourcePartnerOutsourceDown,
} from './migrations/20260619_add_item_source_partner_outsource.js'
import {
  up as addDocPlanIdUp,
  down as addDocPlanIdDown,
} from './migrations/20260620_add_doc_plan_id.js'
import {
  up as backfillScmFinePermsUp,
  down as backfillScmFinePermsDown,
} from './migrations/20260620_backfill_scm_fine_perms.js'
import {
  up as addPartnerPriceLevelUp,
  down as addPartnerPriceLevelDown,
} from './migrations/20260621_add_partner_price_level.js'
import {
  up as addBatchTrackingUp,
  down as addBatchTrackingDown,
} from './migrations/20260621_add_batch_tracking.js'
import {
  up as addSerialTrackingUp,
  down as addSerialTrackingDown,
} from './migrations/20260621_add_serial_tracking.js'
import {
  up as addScmDictAndBinUp,
  down as addScmDictAndBinDown,
} from './migrations/20260621_add_scm_dict_and_bin.js'
import {
  up as addScmColSchemeUp,
  down as addScmColSchemeDown,
} from './migrations/20260622_add_scm_col_scheme.js'
import {
  up as addScmDocFieldDefsUp,
  down as addScmDocFieldDefsDown,
} from './migrations/20260623_add_scm_doc_field_defs.js'
import {
  up as addPlanSourceLineUp,
  down as addPlanSourceLineDown,
} from './migrations/20260624_add_plan_source_line.js'
import {
  up as backfillPlanBomUp,
  down as backfillPlanBomDown,
} from './migrations/20260624_backfill_plan_bom.js'
import {
  up as addProductionPlanLineUp,
  down as addProductionPlanLineDown,
} from './migrations/20260624_add_production_plan_line.js'
import {
  up as addPlanLineWarehouseUp,
  down as addPlanLineWarehouseDown,
} from './migrations/20260624_add_plan_line_warehouse.js'
import {
  up as addDocHeaderTaxRateUp,
  down as addDocHeaderTaxRateDown,
} from './migrations/20260624_add_doc_header_tax_rate.js'
import {
  up as addPlanProductUp,
  down as addPlanProductDown,
} from './migrations/20260625_add_plan_product.js'
import {
  up as addPlanProductSourceUp,
  down as addPlanProductSourceDown,
} from './migrations/20260625_add_plan_product_source.js'
import {
  up as addDocFieldIsVisibleUp,
  down as addDocFieldIsVisibleDown,
} from './migrations/20260626_add_doc_field_is_visible.js'
import {
  up as addDocLineProductGroupUp,
  down as addDocLineProductGroupDown,
} from './migrations/20260630_add_doc_line_product_group.js'
import {
  up as addDocLineRoleUp,
  down as addDocLineRoleDown,
} from './migrations/20260628_add_doc_line_role.js'
import {
  up as addArapVerifyUp,
  down as addArapVerifyDown,
} from './migrations/20260706_add_arap_verify.js'
import {
  up as addWorkCenterRoutingUp,
  down as addWorkCenterRoutingDown,
} from './migrations/20260707_add_work_center_routing.js'
import {
  up as addBomVersionSubstituteUp,
  down as addBomVersionSubstituteDown,
} from './migrations/20260707_add_bom_version_substitute.js'
import {
  up as addQcUp,
  down as addQcDown,
} from './migrations/20260707_add_qc.js'
import {
  up as addPlanLaborAbsorbedUp,
  down as addPlanLaborAbsorbedDown,
} from './migrations/20260708_add_plan_labor_absorbed.js'
import {
  up as fixPaymentDocConfigUp,
  down as fixPaymentDocConfigDown,
} from './migrations/20260713_fix_payment_doc_config.js'
import {
  up as addPaymentSourceLogUp,
  down as addPaymentSourceLogDown,
} from './migrations/20260713_add_payment_source_log.js'
import {
  up as addScmReportQuerySchemeUp,
  down as addScmReportQuerySchemeDown,
} from './migrations/20260714_add_scm_report_query_scheme.js'
import {
  up as cashierPeriodClosingUp,
  down as cashierPeriodClosingDown,
} from './migrations/20260916_cashier_period_closing.js'
import {
  up as detachStandardReportFooterUp,
  down as detachStandardReportFooterDown,
} from './migrations/20260916_detach_standard_report_footer.js'
import {
  up as faSalvageRateGuardUp,
  down as faSalvageRateGuardDown,
} from './migrations/20260917_fa_salvage_rate_guard.js'
import {
  up as cashierJournalLinksUp,
  down as cashierJournalLinksDown,
} from './migrations/20260917_cashier_journal_links.js'
import {
  up as cashierCurrencyAliasUp,
  down as cashierCurrencyAliasDown,
} from './migrations/20260917_cashier_currency_alias.js'
import {
  up as scmArapCurrencyUp,
  down as scmArapCurrencyDown,
} from './migrations/20260917_scm_arap_currency.js'
import {
  up as scmFxRevaluationUp,
  down as scmFxRevaluationDown,
} from './migrations/20260917_scm_fx_revaluation.js'
import {
  up as scmQcStandardUp,
  down as scmQcStandardDown,
} from './migrations/20260917_scm_qc_standard.js'
import {
  up as scmStockLayerUp,
  down as scmStockLayerDown,
} from './migrations/20260918_scm_stock_layer.js'
import {
  up as scmCostingPeriodUp,
  down as scmCostingPeriodDown,
} from './migrations/20260918_scm_costing_period.js'
import {
  up as scmPlanActualDatesUp,
  down as scmPlanActualDatesDown,
} from './migrations/20260918_scm_plan_actual_dates.js'
import {
  up as scmPlanChangeUp,
  down as scmPlanChangeDown,
} from './migrations/20260918_scm_plan_change.js'
import {
  up as scmPlanProcessUp,
  down as scmPlanProcessDown,
} from './migrations/20260918_scm_plan_process.js'
import {
  up as scmWipCountUp,
  down as scmWipCountDown,
} from './migrations/20260918_scm_wip_count.js'
import {
  up as scmScheduleUp,
  down as scmScheduleDown,
} from './migrations/20260918_scm_schedule.js'
import {
  up as scmOverheadVarianceUp,
  down as scmOverheadVarianceDown,
} from './migrations/20260918_scm_overhead_variance.js'
import {
  up as scmItemOutsourceFeeUp,
  down as scmItemOutsourceFeeDown,
} from './migrations/20260918_scm_item_outsource_fee.js'
import {
  up as scmPerfIndexesUp,
  down as scmPerfIndexesDown,
} from './migrations/20260918_scm_perf_indexes.js'
import {
  up as ledgerBalanceIndexesUp,
  down as ledgerBalanceIndexesDown,
} from './migrations/20260919_ledger_balance_indexes.js'
import {
  up as bankStatementColumnsUp,
  down as bankStatementColumnsDown,
} from './migrations/20260920_bank_statement_columns.js'
import {
  up as cashierJournalFxUp,
  down as cashierJournalFxDown,
} from './migrations/20260921_cashier_journal_fx.js'
import {
  up as cashierBankOpeningUp,
  down as cashierBankOpeningDown,
} from './migrations/20260923_cashier_bank_opening.js'
import {
  up as cashierGlMatchUp,
  down as cashierGlMatchDown,
} from './migrations/20260924_cashier_gl_match.js'
import {
  up as assetStatusDisposedNameUp,
  down as assetStatusDisposedNameDown,
} from './migrations/20260925_asset_status_disposed_name.js'
import {
  up as assetStatusDisposedBackfillUp,
  down as assetStatusDisposedBackfillDown,
} from './migrations/20260925_asset_status_disposed_backfill.js'
import {
  up as voucherFtsByIdUp,
  down as voucherFtsByIdDown,
} from './migrations/20260925_voucher_fts_by_id.js'
import {
  up as voucherFtsRowidKeyUp,
  down as voucherFtsRowidKeyDown,
} from './migrations/20260925_voucher_fts_rowid_key.js'
import {
  up as cashierJournalCurrencyIndexUp,
  down as cashierJournalCurrencyIndexDown,
} from './migrations/20260925_cashier_journal_currency_index.js'
import {
  up as cashierJournalCoverIndexUp,
  down as cashierJournalCoverIndexDown,
} from './migrations/20260925_cashier_journal_cover_index.js'

/**
 * 迁移示例：添加新字段
 *
 * 使用方法：
 * 1. 在此文件中定义所有迁移
 * 2. 按版本号顺序排列
 * 3. 运行 npm run db:migrate 执行迁移
 */

export const migrations: Migration[] = [
  {
    version: 3,
    name: 'update_voucher_unique_constraint_add_period_and_type',
    up: db => {
      // 修改凭证表的唯一约束，从 (account_set_id, year, voucher_no) 改为 (account_set_id, year, period, voucher_type_id, voucher_no)
      // 确保同年同月同类型不能有相同编号
      db.exec(`
        PRAGMA foreign_keys = OFF;

        -- 创建新表结构
        CREATE TABLE vouchers_new (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          voucher_no TEXT NOT NULL,
          voucher_type_id TEXT REFERENCES voucher_types(id),
          voucher_date TEXT NOT NULL,
          year INTEGER NOT NULL,
          period INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'audited', 'posted')),
          total_amount REAL NOT NULL DEFAULT 0,
          maker_id TEXT REFERENCES users(id),
          maker_name TEXT,
          auditor_id TEXT REFERENCES users(id),
          auditor_name TEXT,
          poster_id TEXT REFERENCES users(id),
          poster_name TEXT,
          posted_at TEXT,
          attachments INTEGER DEFAULT 0,
          remark TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, year, period, voucher_type_id, voucher_no)
        );

        -- 复制数据
        INSERT INTO vouchers_new SELECT * FROM vouchers;

        -- 删除旧表
        DROP TABLE vouchers;

        -- 重命名新表
        ALTER TABLE vouchers_new RENAME TO vouchers;

        -- 重建索引
        CREATE INDEX IF NOT EXISTS idx_vouchers_account_set ON vouchers(account_set_id);
        CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(voucher_date);
        CREATE INDEX IF NOT EXISTS idx_vouchers_year_period ON vouchers(year, period);
        CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);

        PRAGMA foreign_keys = ON;
      `)
    },
    down: db => {
      // 回滚：恢复原来的唯一约束
      db.exec(`
        CREATE TABLE vouchers_old (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          voucher_no TEXT NOT NULL,
          voucher_type_id TEXT REFERENCES voucher_types(id),
          voucher_date TEXT NOT NULL,
          year INTEGER NOT NULL,
          period INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'audited', 'posted')),
          total_amount REAL NOT NULL DEFAULT 0,
          maker_id TEXT REFERENCES users(id),
          maker_name TEXT,
          auditor_id TEXT REFERENCES users(id),
          auditor_name TEXT,
          poster_id TEXT REFERENCES users(id),
          poster_name TEXT,
          posted_at TEXT,
          attachments INTEGER DEFAULT 0,
          remark TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, year, voucher_no)
        );

        INSERT INTO vouchers_old SELECT * FROM vouchers;
        DROP TABLE vouchers;
        ALTER TABLE vouchers_old RENAME TO vouchers;

        CREATE INDEX IF NOT EXISTS idx_vouchers_account_set ON vouchers(account_set_id);
        CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(voucher_date);
        CREATE INDEX IF NOT EXISTS idx_vouchers_year_period ON vouchers(year, period);
        CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
      `)
    },
  },
  {
    version: 4,
    name: 'update_auto_transfer_runs_add_transfer_type_code',
    up: db => {
      // 更新 auto_transfer_runs 表，添加 transfer_type_code 字段并修改唯一约束
      db.exec(`
        PRAGMA foreign_keys = OFF;

        -- 创建新表结构
        CREATE TABLE auto_transfer_runs_new (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          year INTEGER NOT NULL,
          period INTEGER NOT NULL,
          transfer_type TEXT NOT NULL,
          transfer_type_code TEXT,
          voucher_id TEXT NOT NULL REFERENCES vouchers(id),
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, year, period, transfer_type_code)
        );

        -- 复制数据（旧数据的 transfer_type_code 设为 NULL）
        INSERT INTO auto_transfer_runs_new
        SELECT id, account_set_id, year, period, transfer_type, NULL, voucher_id, created_by, created_at
        FROM auto_transfer_runs;

        -- 删除旧表
        DROP TABLE auto_transfer_runs;

        -- 重命名新表
        ALTER TABLE auto_transfer_runs_new RENAME TO auto_transfer_runs;

        PRAGMA foreign_keys = ON;
      `)
    },
    down: db => {
      // 回滚：恢复原来的表结构
      db.exec(`
        CREATE TABLE auto_transfer_runs_old (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          year INTEGER NOT NULL,
          period INTEGER NOT NULL,
          transfer_type TEXT NOT NULL,
          voucher_id TEXT NOT NULL REFERENCES vouchers(id),
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, year, period, transfer_type)
        );

        INSERT INTO auto_transfer_runs_old
        SELECT id, account_set_id, year, period, transfer_type, voucher_id, created_by, created_at
        FROM auto_transfer_runs;

        DROP TABLE auto_transfer_runs;
        ALTER TABLE auto_transfer_runs_old RENAME TO auto_transfer_runs;
      `)
    },
  },
  {
    version: 5,
    name: 'add_ledger_enhancement_fields',
    up: db => {
      // 为账簿管理功能增强添加新字段
      db.exec(`
        -- 1. 为 voucher_entries 表添加数量金额式账簿所需字段
        ALTER TABLE voucher_entries ADD COLUMN quantity REAL DEFAULT 0;
        ALTER TABLE voucher_entries ADD COLUMN unit_price REAL DEFAULT 0;
        ALTER TABLE voucher_entries ADD COLUMN unit TEXT;

        -- 2. 为 accounts 表添加账簿格式配置字段
        ALTER TABLE accounts ADD COLUMN ledger_format TEXT DEFAULT 'three_column'
          CHECK(ledger_format IN ('three_column', 'multi_column', 'quantity_amount'));

        -- 3. 优化明细账查询索引
        CREATE INDEX IF NOT EXISTS idx_voucher_entries_account_date
          ON voucher_entries(account_id, voucher_id);

        -- 4. 优化余额表查询索引
        CREATE INDEX IF NOT EXISTS idx_account_balances_period
          ON account_balances(account_set_id, year, period);

        -- 5. 优化凭证分录查询索引
        CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher
          ON voucher_entries(voucher_id, seq);
      `)
    },
    down: db => {
      // 回滚：删除新增的字段和索引
      // 注意：SQLite 不支持 DROP COLUMN，需要重建表
      db.exec(`
        PRAGMA foreign_keys = OFF;

        -- 删除索引
        DROP INDEX IF EXISTS idx_voucher_entries_account_date;
        DROP INDEX IF EXISTS idx_account_balances_period;
        DROP INDEX IF EXISTS idx_voucher_entries_voucher;

        -- 重建 voucher_entries 表（移除新增字段）
        CREATE TABLE voucher_entries_old (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          voucher_id TEXT NOT NULL REFERENCES vouchers(id),
          seq INTEGER NOT NULL,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          account_code TEXT NOT NULL,
          account_name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
          amount REAL NOT NULL DEFAULT 0,
          summary TEXT,
          dept_id TEXT,
          dept_name TEXT,
          project_id TEXT,
          project_name TEXT,
          supplier_id TEXT,
          supplier_name TEXT,
          person_id TEXT,
          person_name TEXT,
          func_class_id TEXT,
          func_class_name TEXT,
          aux_data TEXT DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO voucher_entries_old
        SELECT id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
               direction, amount, summary, dept_id, dept_name, project_id, project_name,
               supplier_id, supplier_name, person_id, person_name, func_class_id, func_class_name,
               aux_data, created_at, updated_at
        FROM voucher_entries;

        DROP TABLE voucher_entries;
        ALTER TABLE voucher_entries_old RENAME TO voucher_entries;

        -- 重建 accounts 表（移除 ledger_format 字段）
        CREATE TABLE accounts_old (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
          level INTEGER NOT NULL DEFAULT 1,
          parent_id TEXT,
          is_aux INTEGER DEFAULT 0,
          aux_types TEXT,
          balance TEXT CHECK(balance IN ('initial', 'normal', 'temp')),
          is_cash INTEGER DEFAULT 0,
          is_bank INTEGER DEFAULT 0,
          is_enabled INTEGER DEFAULT 1,
          allow_delete INTEGER DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, code)
        );

        INSERT INTO accounts_old
        SELECT id, account_set_id, code, name, direction, level, parent_id, is_aux, aux_types,
               balance, is_cash, is_bank, is_enabled, allow_delete, created_at, updated_at
        FROM accounts;

        DROP TABLE accounts;
        ALTER TABLE accounts_old RENAME TO accounts;

        PRAGMA foreign_keys = ON;
      `)
    },
  },
  {
    version: 6,
    name: 'add_print_templates_table',
    up: db => {
      // 添加打印模版表
      db.exec(`
        -- 创建打印模版表
        CREATE TABLE IF NOT EXISTS print_templates (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          name TEXT NOT NULL,
          paper_size TEXT NOT NULL DEFAULT 'custom' CHECK(paper_size IN ('custom', 'A4', 'A5')),
          paper_width REAL NOT NULL DEFAULT 220,
          paper_height REAL NOT NULL DEFAULT 140,
          margin_top REAL NOT NULL DEFAULT 15,
          margin_bottom REAL NOT NULL DEFAULT 15,
          margin_left REAL NOT NULL DEFAULT 10,
          margin_right REAL NOT NULL DEFAULT 10,
          elements TEXT NOT NULL DEFAULT '[]',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 创建索引
        CREATE INDEX IF NOT EXISTS idx_print_templates_account_set
          ON print_templates(account_set_id);
        CREATE INDEX IF NOT EXISTS idx_print_templates_default
          ON print_templates(account_set_id, is_default);
      `)
    },
    down: db => {
      // 回滚：删除打印模版表
      db.exec(`
        DROP INDEX IF EXISTS idx_print_templates_account_set;
        DROP INDEX IF EXISTS idx_print_templates_default;
        DROP TABLE IF EXISTS print_templates;
      `)
    },
  },
  {
    version: 7,
    name: 'add_init_balance_detail_fields',
    up: db => {
      // 期初余额表新增年初借贷方、账前借贷方字段
      db.prepare('ALTER TABLE init_balances ADD COLUMN opening_debit REAL NOT NULL DEFAULT 0').run()
      db.prepare(
        'ALTER TABLE init_balances ADD COLUMN opening_credit REAL NOT NULL DEFAULT 0'
      ).run()
      db.prepare(
        'ALTER TABLE init_balances ADD COLUMN pre_book_debit REAL NOT NULL DEFAULT 0'
      ).run()
      db.prepare(
        'ALTER TABLE init_balances ADD COLUMN pre_book_credit REAL NOT NULL DEFAULT 0'
      ).run()
    },
    down: db => {
      db.prepare('ALTER TABLE init_balances DROP COLUMN opening_debit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN opening_credit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN pre_book_debit').run()
      db.prepare('ALTER TABLE init_balances DROP COLUMN pre_book_credit').run()
    },
  },
  {
    version: 8,
    name: 'create_keyboard_shortcuts',
    up: db => {
      // 创建快捷键配置表
      db.exec(`
        CREATE TABLE keyboard_shortcuts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          module VARCHAR(50) NOT NULL,
          action VARCHAR(50) NOT NULL,
          key VARCHAR(20) NOT NULL,
          ctrl BOOLEAN DEFAULT 0,
          alt BOOLEAN DEFAULT 0,
          shift BOOLEAN DEFAULT 0,
          meta BOOLEAN DEFAULT 0,
          description TEXT,
          component_path VARCHAR(200),
          is_enabled BOOLEAN DEFAULT 1,
          is_custom BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_keyboard_shortcuts_module ON keyboard_shortcuts(module);
        CREATE INDEX idx_keyboard_shortcuts_enabled ON keyboard_shortcuts(is_enabled);
      `)

      // 插入默认快捷键数据
      const insert = db.prepare(`
        INSERT INTO keyboard_shortcuts
        (module, action, key, ctrl, alt, shift, meta, description, component_path, is_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const defaultShortcuts = [
        [
          '凭证录入表单',
          '保存',
          's',
          1,
          0,
          0,
          0,
          '保存当前凭证',
          'client/src/components/voucher/VoucherEntryForm.vue',
          1,
        ],
        [
          '凭证录入表单',
          '保存并新增',
          'n',
          1,
          0,
          0,
          0,
          '保存当前凭证并新增下一张',
          'client/src/components/voucher/VoucherEntryForm.vue',
          1,
        ],
        [
          '凭证录入表单',
          '上传附件',
          'f',
          1,
          0,
          0,
          0,
          '打开文件选择对话框',
          'client/src/components/voucher/VoucherEntryForm.vue',
          1,
        ],
        [
          '凭证录入表单',
          '关闭',
          'Escape',
          0,
          0,
          0,
          0,
          '关闭凭证表单',
          'client/src/components/voucher/VoucherEntryForm.vue',
          1,
        ],
        [
          '凭证录入页面',
          '新增凭证',
          'n',
          1,
          0,
          0,
          0,
          '打开新增凭证对话框',
          'client/src/views/voucher/Entry.vue',
          1,
        ],
        [
          '凭证录入页面',
          '刷新列表',
          'r',
          1,
          0,
          0,
          0,
          '刷新草稿凭证列表',
          'client/src/views/voucher/Entry.vue',
          1,
        ],
        [
          '凭证审核页面',
          '批量操作',
          'e',
          1,
          0,
          0,
          0,
          '打开批量操作对话框',
          'client/src/views/voucher/Audit.vue',
          1,
        ],
        [
          '凭证审核页面',
          '批量反记账',
          'd',
          1,
          0,
          0,
          0,
          '批量反记账操作',
          'client/src/views/voucher/Audit.vue',
          1,
        ],
      ]

      for (const shortcut of defaultShortcuts) {
        insert.run(...shortcut)
      }
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_keyboard_shortcuts_module;
        DROP INDEX IF EXISTS idx_keyboard_shortcuts_enabled;
        DROP TABLE IF EXISTS keyboard_shortcuts;
      `)
    },
  },
  {
    version: 9,
    name: 'create_voucher_templates',
    up: db => {
      // 创建凭证模版表
      db.exec(`
        CREATE TABLE voucher_templates (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id),
          template_no TEXT NOT NULL,
          template_name TEXT NOT NULL,
          voucher_type_id TEXT REFERENCES voucher_types(id),
          total_amount REAL NOT NULL DEFAULT 0,
          remark TEXT,
          entries_data TEXT NOT NULL,
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_set_id, template_no)
        );

        CREATE INDEX idx_voucher_templates_account_set ON voucher_templates(account_set_id);
        CREATE INDEX idx_voucher_templates_type ON voucher_templates(voucher_type_id);
      `)
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_voucher_templates_account_set;
        DROP INDEX IF EXISTS idx_voucher_templates_type;
        DROP TABLE IF EXISTS voucher_templates;
      `)
    },
  },
  {
    version: 10,
    name: 'add_voucher_query_performance_indexes',
    up: db => {
      // 添加凭证查询性能优化索引
      db.exec(`
        -- 凭证查询复合索引（最常用的查询条件组合）
        CREATE INDEX IF NOT EXISTS idx_vouchers_query_main
          ON vouchers(account_set_id, status, voucher_date DESC);

        -- 凭证号查询索引
        CREATE INDEX IF NOT EXISTS idx_vouchers_no_lookup
          ON vouchers(account_set_id, voucher_no);

        -- 年月期间查询索引（已存在但确保创建）
        CREATE INDEX IF NOT EXISTS idx_vouchers_period_status
          ON vouchers(account_set_id, year, period, status);

        -- 分录查询优化索引（使用 seq 而不是 entry_order）
        CREATE INDEX IF NOT EXISTS idx_entries_voucher_seq
          ON voucher_entries(voucher_id, seq);

        -- 分录科目查询索引
        CREATE INDEX IF NOT EXISTS idx_entries_account_lookup
          ON voucher_entries(account_id);

        -- 凭证类型关联查询索引
        CREATE INDEX IF NOT EXISTS idx_vouchers_type_date
          ON vouchers(voucher_type_id, voucher_date DESC);

        -- 制单人、审核人、记账人查询索引
        CREATE INDEX IF NOT EXISTS idx_vouchers_maker
          ON vouchers(maker_id, voucher_date DESC);

        CREATE INDEX IF NOT EXISTS idx_vouchers_auditor
          ON vouchers(auditor_id, voucher_date DESC);

        CREATE INDEX IF NOT EXISTS idx_vouchers_poster
          ON vouchers(poster_id, voucher_date DESC);
      `)
    },
    down: db => {
      // 回滚：删除性能优化索引
      db.exec(`
        DROP INDEX IF EXISTS idx_vouchers_query_main;
        DROP INDEX IF EXISTS idx_vouchers_no_lookup;
        DROP INDEX IF EXISTS idx_vouchers_period_status;
        DROP INDEX IF EXISTS idx_entries_voucher_seq;
        DROP INDEX IF EXISTS idx_entries_account_lookup;
        DROP INDEX IF EXISTS idx_vouchers_type_date;
        DROP INDEX IF EXISTS idx_vouchers_maker;
        DROP INDEX IF EXISTS idx_vouchers_auditor;
        DROP INDEX IF EXISTS idx_vouchers_poster;
      `)
    },
  },
  {
    version: 11,
    name: 'add_fts5_fulltext_search',
    up: db => {
      // 创建 FTS5 全文索引表（不启用 content= 模式，由触发器手动同步）
      db.exec(`
        -- 凭证全文索引表
        CREATE VIRTUAL TABLE IF NOT EXISTS vouchers_fts USING fts5(
          voucher_id UNINDEXED,
          voucher_no,
          remark,
          maker_name,
          auditor_name,
          poster_name,
          tokenize='unicode61'
        );

        -- 分录全文索引表
        CREATE VIRTUAL TABLE IF NOT EXISTS voucher_entries_fts USING fts5(
          entry_id UNINDEXED,
          voucher_id UNINDEXED,
          summary,
          account_code,
          account_name,
          tokenize='unicode61'
        );
      `)

      // 初始化现有数据到 FTS5 表
      db.exec(`
        INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
        SELECT rowid, voucher_no, COALESCE(remark, ''), COALESCE(maker_name, ''),
               COALESCE(auditor_name, ''), COALESCE(poster_name, '')
        FROM vouchers;

        INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
        SELECT rowid, voucher_id, COALESCE(summary, ''), account_code, account_name
        FROM voucher_entries;
      `)

      // 创建触发器保持同步 - 凭证表
      db.exec(`
        -- 凭证插入触发器
        CREATE TRIGGER IF NOT EXISTS vouchers_fts_insert AFTER INSERT ON vouchers BEGIN
          INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
          VALUES (new.rowid, new.voucher_no, COALESCE(new.remark, ''),
                  COALESCE(new.maker_name, ''), COALESCE(new.auditor_name, ''),
                  COALESCE(new.poster_name, ''));
        END;

        -- 凭证更新触发器
        CREATE TRIGGER IF NOT EXISTS vouchers_fts_update AFTER UPDATE ON vouchers BEGIN
          UPDATE vouchers_fts
          SET voucher_no = new.voucher_no,
              remark = COALESCE(new.remark, ''),
              maker_name = COALESCE(new.maker_name, ''),
              auditor_name = COALESCE(new.auditor_name, ''),
              poster_name = COALESCE(new.poster_name, '')
          WHERE voucher_id = old.rowid;
        END;

        -- 凭证删除触发器
        CREATE TRIGGER IF NOT EXISTS vouchers_fts_delete AFTER DELETE ON vouchers BEGIN
          DELETE FROM vouchers_fts WHERE voucher_id = old.rowid;
        END;
      `)

      // 创建触发器保持同步 - 分录表
      db.exec(`
        -- 分录插入触发器
        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_insert AFTER INSERT ON voucher_entries BEGIN
          INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
          VALUES (new.rowid, new.voucher_id, COALESCE(new.summary, ''),
                  new.account_code, new.account_name);
        END;

        -- 分录更新触发器
        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_update AFTER UPDATE ON voucher_entries BEGIN
          UPDATE voucher_entries_fts
          SET voucher_id = new.voucher_id,
              summary = COALESCE(new.summary, ''),
              account_code = new.account_code,
              account_name = new.account_name
          WHERE entry_id = old.rowid;
        END;

        -- 分录删除触发器
        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_delete AFTER DELETE ON voucher_entries BEGIN
          DELETE FROM voucher_entries_fts WHERE entry_id = old.rowid;
        END;
      `)
    },
    down: db => {
      // 回滚：删除触发器和 FTS5 表
      db.exec(`
        -- 删除凭证触发器
        DROP TRIGGER IF EXISTS vouchers_fts_insert;
        DROP TRIGGER IF EXISTS vouchers_fts_update;
        DROP TRIGGER IF EXISTS vouchers_fts_delete;

        -- 删除分录触发器
        DROP TRIGGER IF EXISTS voucher_entries_fts_insert;
        DROP TRIGGER IF EXISTS voucher_entries_fts_update;
        DROP TRIGGER IF EXISTS voucher_entries_fts_delete;

        -- 删除 FTS5 表
        DROP TABLE IF EXISTS vouchers_fts;
        DROP TABLE IF EXISTS voucher_entries_fts;
      `)
    },
  },
  {
    version: 12,
    name: 'fix_fts5_content_mode',
    up: db => {
      // 修复 FTS5 表定义：移除 content= 模式
      // 原定义用了 content='vouchers'，但列名不匹配（voucher_id vs id）
      // 导致 FTS5 生成内部查询 SELECT ... T.voucher_id FROM vouchers AS T 时报错
      db.exec(`
        -- 1. 删除旧触发器（必须先删，因为依赖 FTS 表）
        DROP TRIGGER IF EXISTS vouchers_fts_insert;
        DROP TRIGGER IF EXISTS vouchers_fts_update;
        DROP TRIGGER IF EXISTS vouchers_fts_delete;
        DROP TRIGGER IF EXISTS voucher_entries_fts_insert;
        DROP TRIGGER IF EXISTS voucher_entries_fts_update;
        DROP TRIGGER IF EXISTS voucher_entries_fts_delete;

        -- 2. 删除旧 FTS5 表
        DROP TABLE IF EXISTS vouchers_fts;
        DROP TABLE IF EXISTS voucher_entries_fts;

        -- 3. 重建 FTS5 表（standalone 模式，由触发器手动同步）
        CREATE VIRTUAL TABLE IF NOT EXISTS vouchers_fts USING fts5(
          voucher_id UNINDEXED,
          voucher_no,
          remark,
          maker_name,
          auditor_name,
          poster_name,
          tokenize='unicode61'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS voucher_entries_fts USING fts5(
          entry_id UNINDEXED,
          voucher_id UNINDEXED,
          summary,
          account_code,
          account_name,
          tokenize='unicode61'
        );

        -- 4. 初始化现有数据到 FTS5 表
        INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
        SELECT rowid, voucher_no, COALESCE(remark, ''), COALESCE(maker_name, ''),
               COALESCE(auditor_name, ''), COALESCE(poster_name, '')
        FROM vouchers;

        INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
        SELECT rowid, voucher_id, COALESCE(summary, ''), account_code, account_name
        FROM voucher_entries;

        -- 5. 重建触发器
        CREATE TRIGGER IF NOT EXISTS vouchers_fts_insert AFTER INSERT ON vouchers BEGIN
          INSERT INTO vouchers_fts(voucher_id, voucher_no, remark, maker_name, auditor_name, poster_name)
          VALUES (new.rowid, new.voucher_no, COALESCE(new.remark, ''),
                  COALESCE(new.maker_name, ''), COALESCE(new.auditor_name, ''),
                  COALESCE(new.poster_name, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS vouchers_fts_update AFTER UPDATE ON vouchers BEGIN
          UPDATE vouchers_fts
          SET voucher_no = new.voucher_no,
              remark = COALESCE(new.remark, ''),
              maker_name = COALESCE(new.maker_name, ''),
              auditor_name = COALESCE(new.auditor_name, ''),
              poster_name = COALESCE(new.poster_name, '')
          WHERE voucher_id = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS vouchers_fts_delete AFTER DELETE ON vouchers BEGIN
          DELETE FROM vouchers_fts WHERE voucher_id = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_insert AFTER INSERT ON voucher_entries BEGIN
          INSERT INTO voucher_entries_fts(entry_id, voucher_id, summary, account_code, account_name)
          VALUES (new.rowid, new.voucher_id, COALESCE(new.summary, ''),
                  new.account_code, new.account_name);
        END;

        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_update AFTER UPDATE ON voucher_entries BEGIN
          UPDATE voucher_entries_fts
          SET summary = COALESCE(new.summary, ''),
              account_code = new.account_code,
              account_name = new.account_name
          WHERE entry_id = old.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS voucher_entries_fts_delete AFTER DELETE ON voucher_entries BEGIN
          DELETE FROM voucher_entries_fts WHERE entry_id = old.rowid;
        END;
      `)
    },
    down: db => {
      db.exec(`
        DROP TRIGGER IF EXISTS vouchers_fts_insert;
        DROP TRIGGER IF EXISTS vouchers_fts_update;
        DROP TRIGGER IF EXISTS vouchers_fts_delete;
        DROP TRIGGER IF EXISTS voucher_entries_fts_insert;
        DROP TRIGGER IF EXISTS voucher_entries_fts_update;
        DROP TRIGGER IF EXISTS voucher_entries_fts_delete;
        DROP TABLE IF EXISTS vouchers_fts;
        DROP TABLE IF EXISTS voucher_entries_fts;
      `)
    },
  },
  {
    version: 13,
    name: 'add_performance_indexes',
    up: db => {
      // 添加关键索引以优化查询性能
      db.exec(`
        -- voucher_entries 表索引：优化账簿查询
        -- 用于总账、明细账、余额表等查询
        CREATE INDEX IF NOT EXISTS idx_voucher_entries_balance
          ON voucher_entries(account_set_id, account_id, direction);

        -- init_balances 表索引：优化期初余额查询
        CREATE INDEX IF NOT EXISTS idx_init_balances_lookup
          ON init_balances(account_set_id, account_id, year);

        -- operation_logs 表索引：优化日志查询
        CREATE INDEX IF NOT EXISTS idx_operation_logs_query
          ON operation_logs(account_set_id, created_at);

        -- vouchers 表索引：优化凭证查询（如果不存在）
        CREATE INDEX IF NOT EXISTS idx_vouchers_date
          ON vouchers(account_set_id, voucher_date);

        CREATE INDEX IF NOT EXISTS idx_vouchers_status
          ON vouchers(account_set_id, status);
      `)
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_voucher_entries_balance;
        DROP INDEX IF EXISTS idx_init_balances_lookup;
        DROP INDEX IF EXISTS idx_operation_logs_query;
        DROP INDEX IF EXISTS idx_vouchers_date;
        DROP INDEX IF EXISTS idx_vouchers_status;
      `)
    },
  },
  {
    version: 14,
    name: 'convert_amount_to_integer_cents',
    up: db => {
      console.log('开始浮点精度改造：将金额从 REAL 转换为 INTEGER（分）...')

      // 检查字段是否已存在
      const checkColumn = (table: string, column: string): boolean => {
        const result = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
        return result.some((col: any) => col.name === column)
      }

      // 第一步：为所有金额字段添加新的整数字段（单位：分）
      if (!checkColumn('voucher_entries', 'amount_cents')) {
        db.exec(`ALTER TABLE voucher_entries ADD COLUMN amount_cents INTEGER;`)
        console.log('✓ voucher_entries.amount_cents 字段添加完成')
      } else {
        console.log('⊙ voucher_entries.amount_cents 字段已存在，跳过')
      }

      if (!checkColumn('init_balances', 'init_balance_cents')) {
        db.exec(`ALTER TABLE init_balances ADD COLUMN init_balance_cents INTEGER;`)
        console.log('✓ init_balances.init_balance_cents 字段添加完成')
      } else {
        console.log('⊙ init_balances.init_balance_cents 字段已存在，跳过')
      }

      if (!checkColumn('account_balances', 'current_debit_cents')) {
        db.exec(`
          ALTER TABLE account_balances ADD COLUMN current_debit_cents INTEGER;
          ALTER TABLE account_balances ADD COLUMN current_credit_cents INTEGER;
        `)
        console.log('✓ account_balances 的分字段添加完成')
      } else {
        console.log('⊙ account_balances 的分字段已存在，跳过')
      }

      // 第二步：数据迁移 - 将浮点数转换为整数（分）
      db.exec(`
        -- 迁移 voucher_entries 的金额数据
        UPDATE voucher_entries
        SET amount_cents = CAST(ROUND(amount * 100) AS INTEGER)
        WHERE amount_cents IS NULL;

        -- 迁移 init_balances 的期初余额数据
        UPDATE init_balances
        SET init_balance_cents = CAST(ROUND(init_balance * 100) AS INTEGER)
        WHERE init_balance_cents IS NULL;

        -- 迁移 account_balances 的发生额数据
        UPDATE account_balances
        SET current_debit_cents = CAST(ROUND(current_debit * 100) AS INTEGER),
            current_credit_cents = CAST(ROUND(current_credit * 100) AS INTEGER)
        WHERE current_debit_cents IS NULL OR current_credit_cents IS NULL;
      `)

      console.log('✓ 数据迁移完成')

      // 第三步：验证数据一致性
      const validation = db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN ABS(amount - amount_cents / 100.0) > 0.01 THEN 1 ELSE 0 END) as inconsistent
        FROM voucher_entries
        WHERE amount_cents IS NOT NULL
      `
        )
        .get() as any

      if (validation.inconsistent > 0) {
        throw new Error(`数据验证失败：发现 ${validation.inconsistent} 条不一致的记录`)
      }

      console.log(`✓ 数据验证通过：${validation.total} 条记录`)
      console.log('✓ 浮点精度改造完成')
      console.log('⚠️  注意：旧的 REAL 字段已保留，应用层需要同时更新两个字段')
      console.log('⚠️  后续版本将删除旧字段，完全切换到整数字段')
    },
    down: db => {
      // 回滚：删除新添加的整数字段
      console.log('回滚浮点精度改造...')

      db.exec(`
        -- 删除 voucher_entries 的 amount_cents 字段
        -- 注意：SQLite 不支持 DROP COLUMN，需要重建表
        PRAGMA foreign_keys = OFF;

        CREATE TABLE voucher_entries_backup AS SELECT * FROM voucher_entries;

        DROP TABLE voucher_entries;

        CREATE TABLE voucher_entries (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL,
          voucher_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          account_id INTEGER NOT NULL,
          account_code TEXT NOT NULL,
          account_name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('debit', 'credit')),
          amount REAL NOT NULL DEFAULT 0,
          summary TEXT,
          dept_id INTEGER,
          project_id INTEGER,
          supplier_id INTEGER,
          person_id INTEGER,
          func_class_id INTEGER,
          aux_data TEXT,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
        );

        INSERT INTO voucher_entries
        SELECT id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
               direction, amount, summary, dept_id, project_id, supplier_id, person_id,
               func_class_id, aux_data, created_at
        FROM voucher_entries_backup;

        DROP TABLE voucher_entries_backup;

        PRAGMA foreign_keys = ON;
      `)

      // 类似地处理其他表...
      console.log('✓ 回滚完成')
    },
  },
  {
    version: 17,
    name: 'scope_roles_by_account_set',
    up: scopeRolesByAccountSetUp,
    down: scopeRolesByAccountSetDown,
  },
  {
    version: 18,
    name: 'add_account_set_import_source',
    up: addAccountSetImportSourceUp,
    down: addAccountSetImportSourceDown,
  },
  {
    version: 19,
    name: 'add_cash_flow',
    up: addCashFlowUp,
    down: addCashFlowDown,
  },
  {
    version: 20,
    name: 'keyboard_shortcuts_use_ctrl_alt_n',
    up: db => {
      // 浏览器占用 Ctrl+N（新窗口），页面无法可靠拦截；默认改为 Ctrl+Alt+N
      db.prepare(
        `
        UPDATE keyboard_shortcuts
        SET alt = 1, updated_at = CURRENT_TIMESTAMP
        WHERE IFNULL(is_custom, 0) = 0
          AND key = 'n' AND ctrl = 1 AND IFNULL(alt, 0) = 0
          AND IFNULL(shift, 0) = 0 AND IFNULL(meta, 0) = 0
          AND (
            (module = '凭证录入表单' AND action = '保存并新增')
            OR (module = '凭证录入页面' AND action = '新增凭证')
          );
      `
      ).run()
    },
    down: db => {
      db.prepare(
        `
        UPDATE keyboard_shortcuts
        SET alt = 0, updated_at = CURRENT_TIMESTAMP
        WHERE IFNULL(is_custom, 0) = 0
          AND key = 'n' AND ctrl = 1 AND IFNULL(alt, 0) = 1
          AND IFNULL(shift, 0) = 0 AND IFNULL(meta, 0) = 0
          AND (
            (module = '凭证录入表单' AND action = '保存并新增')
            OR (module = '凭证录入页面' AND action = '新增凭证')
          );
      `
      ).run()
    },
  },
  {
    version: 21,
    name: 'keyboard_shortcuts_save_and_add_shift_s',
    up: db => {
      db.prepare(
        `
        UPDATE keyboard_shortcuts
        SET key = 's', ctrl = 0, alt = 0, shift = 1, meta = 0, updated_at = CURRENT_TIMESTAMP
        WHERE IFNULL(is_custom, 0) = 0
          AND (
            (module = '凭证录入表单' AND action = '保存并新增')
            OR (module = '凭证录入页面' AND action = '新增凭证')
          );
      `
      ).run()
    },
    down: db => {
      db.prepare(
        `
        UPDATE keyboard_shortcuts
        SET key = 'n', ctrl = 1, alt = 1, shift = 0, meta = 0, updated_at = CURRENT_TIMESTAMP
        WHERE IFNULL(is_custom, 0) = 0
          AND key = 's' AND IFNULL(ctrl, 0) = 0 AND IFNULL(alt, 0) = 0 AND shift = 1
          AND (
            (module = '凭证录入表单' AND action = '保存并新增')
            OR (module = '凭证录入页面' AND action = '新增凭证')
          );
      `
      ).run()
    },
  },
  {
    version: 22,
    name: 'add_user_login_sessions',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_login_sessions (
          id TEXT PRIMARY KEY,
          account_set_id TEXT NOT NULL REFERENCES account_sets(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          username TEXT NOT NULL,
          login_ip TEXT,
          user_agent TEXT,
          login_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'forced', 'logout', 'expired')),
          forced_logout_at TEXT,
          forced_by_ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_user_login_sessions_user_status ON user_login_sessions(user_id, account_set_id, status);
        CREATE INDEX IF NOT EXISTS idx_user_login_sessions_active_ip ON user_login_sessions(user_id, account_set_id, login_ip, status);
      `)
    },
    down: db => {
      db.exec(`
        DROP INDEX IF EXISTS idx_user_login_sessions_active_ip;
        DROP INDEX IF EXISTS idx_user_login_sessions_user_status;
        DROP TABLE IF EXISTS user_login_sessions;
      `)
    },
  },
  {
    version: 23,
    name: 'add_budget_surplus_adjustments',
    up: addBudgetSurplusAdjustmentsUp,
    down: addBudgetSurplusAdjustmentsDown,
  },
  {
    version: 24,
    name: 'remove_voucher_type_prefix',
    up: removeVoucherTypePrefixUp,
    down: removeVoucherTypePrefixDown,
  },
  {
    version: 25,
    name: 'init_balances_aux_unique',
    up: initBalancesAuxUniqueUp,
    down: initBalancesAuxUniqueDown,
  },
  {
    version: 26,
    name: 'normalize_report_definitions_sort_order',
    up: normalizeReportDefinitionsSortOrderUp,
    down: normalizeReportDefinitionsSortOrderDown,
  },
  {
    version: 27,
    name: 'add_permission_assignment_modes',
    up: addPermissionAssignmentModesUp,
    down: addPermissionAssignmentModesDown,
  },
  {
    version: 28,
    name: 'add_multi_role_support',
    up: addMultiRoleSupportUp,
    down: addMultiRoleSupportDown,
  },
  {
    version: 29,
    name: 'fix_voucher_null_type_unique',
    up: fixVoucherNullTypeUniqueUp,
    down: fixVoucherNullTypeUniqueDown,
  },
  {
    version: 30,
    name: 'add_init_balance_source',
    up: addInitBalanceSourceUp,
    down: addInitBalanceSourceDown,
  },
  {
    version: 31,
    name: 'add_dashboard_permission',
    up: addDashboardPermissionUp,
    down: addDashboardPermissionDown,
  },
  {
    version: 32,
    name: 'add_account_scopes',
    up: addAccountScopesUp,
    down: addAccountScopesDown,
  },
  {
    version: 33,
    name: 'add_license_activation',
    up: addLicenseActivationUp,
    down: addLicenseActivationDown,
  },
  {
    version: 34,
    name: 'add_async_tasks',
    up: addAsyncTasksUp,
    down: addAsyncTasksDown,
  },
  {
    version: 35,
    name: 'add_large_scale_performance_indexes',
    up: addLargeScalePerformanceIndexesUp,
    down: addLargeScalePerformanceIndexesDown,
  },
  {
    version: 36,
    name: 'fix_balance_sheet_template_formulas',
    up: fixBalanceSheetTemplateFormulasUp,
    down: fixBalanceSheetTemplateFormulasDown,
  },
  {
    version: 37,
    name: 'fix_balance_sheet_liab_sum',
    up: fixBalanceSheetLiabSumUp,
    down: fixBalanceSheetLiabSumDown,
  },
  {
    version: 38,
    name: 'add_cashier',
    up: addCashierUp,
    down: addCashierDown,
  },
  {
    version: 39,
    name: 'add_fixed_asset',
    up: addFixedAssetUp,
    down: addFixedAssetDown,
  },
  {
    version: 40,
    name: 'add_voucher_source',
    up: addVoucherSourceUp,
    down: addVoucherSourceDown,
  },
  {
    version: 41,
    name: 'add_asset_change_type',
    up: addAssetChangeTypeUp,
    down: addAssetChangeTypeDown,
  },
  {
    version: 42,
    name: 'add_asset_workload',
    up: addAssetWorkloadUp,
    down: addAssetWorkloadDown,
  },
  {
    version: 43,
    name: 'add_asset_inventory',
    up: addAssetInventoryUp,
    down: addAssetInventoryDown,
  },
  {
    version: 44,
    name: 'cashier_journal_aux',
    up: addCashierJournalAuxUp,
    down: addCashierJournalAuxDown,
  },
  {
    version: 45,
    name: 'cashier_init_balance_date',
    up: addCashierInitBalanceDateUp,
    down: addCashierInitBalanceDateDown,
  },
  {
    version: 46,
    name: 'cashier_journal_match_batch',
    up: addCashierJournalMatchBatchUp,
    down: addCashierJournalMatchBatchDown,
  },
  {
    version: 47,
    name: 'add_asset_category_accounting_fields',
    up: addAssetCategoryAccountingFieldsUp,
    down: addAssetCategoryAccountingFieldsDown,
  },
  {
    version: 48,
    name: 'add_depr_voucher_link',
    up: addDeprVoucherLinkUp,
    down: addDeprVoucherLinkDown,
  },
  {
    version: 49,
    name: 'add_cashier_attachments',
    up: addCashierAttachmentsUp,
    down: addCashierAttachmentsDown,
  },
  {
    version: 50,
    name: 'backfill_cashier_asset_permissions',
    up: backfillCashierAssetPermsUp,
    down: backfillCashierAssetPermsDown,
  },
  {
    version: 51,
    name: 'add_scm_core',
    up: addScmCoreUp,
    down: addScmCoreDown,
  },
  {
    version: 52,
    name: 'add_rh_standard_reports',
    up: addRhStandardReportsUp,
    down: addRhStandardReportsDown,
  },
  {
    version: 53,
    name: 'add_scm_arap_bom',
    up: addScmArapBomUp,
    down: addScmArapBomDown,
  },
  {
    version: 54,
    name: 'add_asset_scrap_voucher',
    up: addAssetScrapVoucherUp,
    down: addAssetScrapVoucherDown,
  },
  {
    version: 55,
    name: 'backfill_scm_permissions',
    up: backfillScmPermsUp,
    down: backfillScmPermsDown,
  },
  {
    version: 56,
    name: 'extend_print_templates_for_hiprint',
    up: extendPrintTemplatesHiprintUp,
    down: extendPrintTemplatesHiprintDown,
  },
  {
    version: 57,
    name: 'add_scm_doc_bom_id',
    up: addScmDocBomIdUp,
    down: addScmDocBomIdDown,
  },
  {
    version: 58,
    name: 'add_scm_unit',
    up: addScmUnitUp,
    down: addScmUnitDown,
  },
  {
    version: 59,
    name: 'add_scm_item_tree',
    up: addScmItemTreeUp,
    down: addScmItemTreeDown,
  },
  {
    version: 60,
    name: 'add_scm_item_nature',
    up: addScmItemNatureUp,
    down: addScmItemNatureDown,
  },
  {
    version: 61,
    name: 'add_scm_item_custom_fields',
    up: addScmItemCustomFieldsUp,
    down: addScmItemCustomFieldsDown,
  },
  {
    version: 62,
    name: 'add_scm_doctype_field_config',
    up: addScmDocTypeFieldConfigUp,
    down: addScmDocTypeFieldConfigDown,
  },
  {
    version: 63,
    name: 'extend_scm_doc_fields',
    up: extendScmDocFieldsUp,
    down: extendScmDocFieldsDown,
  },
  {
    version: 64,
    name: 'extend_scm_production',
    up: extendScmProductionUp,
    down: extendScmProductionDown,
  },
  {
    version: 65,
    name: 'extend_scm_master',
    up: extendScmMasterUp,
    down: extendScmMasterDown,
  },
  {
    version: 66,
    name: 'add_production_plan_type',
    up: addProductionPlanTypeUp,
    down: addProductionPlanTypeDown,
  },
  {
    version: 67,
    name: 'add_doc_line_supplier_and_mr',
    up: addDocLineSupplierAndMrUp,
    down: addDocLineSupplierAndMrDown,
  },
  {
    version: 68,
    name: 'add_item_source_partner_outsource',
    up: addItemSourcePartnerOutsourceUp,
    down: addItemSourcePartnerOutsourceDown,
  },
  {
    version: 69,
    name: 'add_doc_plan_id',
    up: addDocPlanIdUp,
    down: addDocPlanIdDown,
  },
  {
    version: 70,
    name: 'backfill_scm_fine_perms',
    up: backfillScmFinePermsUp,
    down: backfillScmFinePermsDown,
  },
  {
    version: 71,
    name: 'add_partner_price_level',
    up: addPartnerPriceLevelUp,
    down: addPartnerPriceLevelDown,
  },
  {
    version: 72,
    name: 'add_batch_tracking',
    up: addBatchTrackingUp,
    down: addBatchTrackingDown,
  },
  {
    version: 73,
    name: 'add_serial_tracking',
    up: addSerialTrackingUp,
    down: addSerialTrackingDown,
  },
  {
    version: 74,
    name: 'add_scm_dict_and_bin',
    up: addScmDictAndBinUp,
    down: addScmDictAndBinDown,
  },
  {
    version: 75,
    name: 'add_scm_col_scheme',
    up: addScmColSchemeUp,
    down: addScmColSchemeDown,
  },
  {
    version: 76,
    name: 'add_scm_doc_field_defs',
    up: addScmDocFieldDefsUp,
    down: addScmDocFieldDefsDown,
  },
  {
    version: 77,
    name: 'add_plan_source_line',
    up: addPlanSourceLineUp,
    down: addPlanSourceLineDown,
  },
  {
    version: 78,
    name: 'backfill_plan_bom',
    up: backfillPlanBomUp,
    down: backfillPlanBomDown,
  },
  {
    version: 79,
    name: 'add_production_plan_line',
    up: addProductionPlanLineUp,
    down: addProductionPlanLineDown,
  },
  {
    version: 80,
    name: 'add_plan_line_warehouse',
    up: addPlanLineWarehouseUp,
    down: addPlanLineWarehouseDown,
  },
  {
    version: 81,
    name: 'add_doc_header_tax_rate',
    up: addDocHeaderTaxRateUp,
    down: addDocHeaderTaxRateDown,
  },
  {
    version: 82,
    name: 'add_plan_product',
    up: addPlanProductUp,
    down: addPlanProductDown,
  },
  {
    version: 83,
    name: 'add_plan_product_source',
    up: addPlanProductSourceUp,
    down: addPlanProductSourceDown,
  },
  {
    version: 84,
    name: 'add_doc_field_is_visible',
    up: addDocFieldIsVisibleUp,
    down: addDocFieldIsVisibleDown,
  },
  {
    version: 85,
    name: 'add_doc_line_role',
    up: addDocLineRoleUp,
    down: addDocLineRoleDown,
  },
  {
    version: 86,
    name: 'add_doc_line_product_group',
    up: addDocLineProductGroupUp,
    down: addDocLineProductGroupDown,
  },
  {
    version: 87,
    name: 'add_arap_verify',
    up: addArapVerifyUp,
    down: addArapVerifyDown,
  },
  {
    version: 88,
    name: 'add_work_center_routing',
    up: addWorkCenterRoutingUp,
    down: addWorkCenterRoutingDown,
  },
  {
    version: 89,
    name: 'add_bom_version_substitute',
    up: addBomVersionSubstituteUp,
    down: addBomVersionSubstituteDown,
  },
  {
    version: 90,
    name: 'add_qc',
    up: addQcUp,
    down: addQcDown,
  },
  {
    version: 91,
    name: 'add_plan_labor_absorbed',
    up: addPlanLaborAbsorbedUp,
    down: addPlanLaborAbsorbedDown,
  },
  {
    version: 92,
    name: 'fix_payment_doc_config',
    up: fixPaymentDocConfigUp,
    down: fixPaymentDocConfigDown,
  },
  {
    version: 93,
    name: 'add_payment_source_log',
    up: addPaymentSourceLogUp,
    down: addPaymentSourceLogDown,
  },
  {
    version: 94,
    name: 'add_scm_report_query_scheme',
    up: addScmReportQuerySchemeUp,
    down: addScmReportQuerySchemeDown,
  },
  {
    version: 95,
    name: 'remove_redundant_aux_items_type_index',
    up: removeRedundantAuxItemsTypeIndexUp,
    down: removeRedundantAuxItemsTypeIndexDown,
  },
  {
    version: 96,
    name: 'upgrade_dashboard_rules_v2',
    up: upgradeDashboardRulesV2Up,
    down: upgradeDashboardRulesV2Down,
  },
  {
    version: 97,
    name: 'add_mrp_documents',
    up: addMrpDocumentsUp,
    down: addMrpDocumentsDown,
  },
  {
    version: 99,
    name: 'add_production_issue_performance_indexes',
    up: addProductionIssuePerformanceIndexesUp,
    down: addProductionIssuePerformanceIndexesDown,
  },
  {
    version: 100,
    name: 'add_outsource_fee_tax',
    up: addOutsourceFeeTaxUp,
    down: addOutsourceFeeTaxDown,
  },
  {
    version: 101,
    name: 'add_scm_document_action_indexes',
    up: addScmDocumentActionIndexesUp,
    down: addScmDocumentActionIndexesDown,
  },
  {
    version: 102,
    name: 'add_scm_doc_list_indexes',
    up: addScmDocListIndexesUp,
    down: addScmDocListIndexesDown,
  },
  {
    version: 103,
    name: 'add_scm_arap_doc_index',
    up: addScmArapDocIndexUp,
    down: addScmArapDocIndexDown,
  },
  {
    version: 104,
    name: 'add_scm_item_default_warehouse',
    up: addScmItemDefaultWarehouseUp,
    down: addScmItemDefaultWarehouseDown,
  },
  {
    version: 105,
    name: 'extend_rh_standard_report_editable',
    up: extendRhStandardReportEditableUp,
    down: extendRhStandardReportEditableDown,
  },
  {
    version: 106,
    name: 'fix_standard_report_title_merge',
    up: fixStandardReportTitleMergeUp,
    down: fixStandardReportTitleMergeDown,
  },
  {
    version: 107,
    name: 'backfill_unit_name_from_acd',
    up: backfillUnitNameFromAcdUp,
    down: backfillUnitNameFromAcdDown,
  },
  {
    version: 108,
    name: 'add_asset_purchase_voucher_id',
    up: addAssetPurchaseVoucherIdUp,
    down: addAssetPurchaseVoucherIdDown,
  },
  {
    version: 109,
    name: 'backfill_asset_change_permissions',
    up: backfillAssetChangePermissionsUp,
    down: backfillAssetChangePermissionsDown,
  },
  {
    version: 110,
    name: 'extend_asset_change',
    up: extendAssetChangeUp,
    down: extendAssetChangeDown,
  },
  {
    version: 111,
    name: 'add_asset_impairment',
    up: addAssetImpairmentUp,
    down: addAssetImpairmentDown,
  },
  {
    version: 112,
    name: 'add_asset_requisition',
    up: addAssetRequisitionUp,
    down: addAssetRequisitionDown,
  },
  {
    version: 113,
    name: 'add_voucher_reversal',
    up: addVoucherReversalUp,
    down: addVoucherReversalDown,
  },
  {
    version: 114,
    name: 'add_foreign_currency',
    up: addForeignCurrencyUp,
    down: addForeignCurrencyDown,
  },
  {
    version: 115,
    name: 'align_standard_report_bold',
    up: alignStandardReportBoldUp,
    down: alignStandardReportBoldDown,
  },
  {
    version: 116,
    name: 'center_standard_report_header_date',
    up: centerStandardReportHeaderDateUp,
    down: centerStandardReportHeaderDateDown,
  },
  {
    version: 117,
    name: 'move_standard_report_header_label',
    up: moveStandardReportHeaderLabelUp,
    down: moveStandardReportHeaderLabelDown,
  },
  {
    version: 118,
    name: 'currency_begin_end_rate',
    up: currencyBeginEndRateUp,
    down: currencyBeginEndRateDown,
  },
  {
    version: 119,
    name: 'fx_revaluation_runs',
    up: fxRevaluationRunsUp,
    down: fxRevaluationRunsDown,
  },
  {
    version: 120,
    name: 'add_quantity_accounting',
    up: addQuantityAccountingUp,
    down: addQuantityAccountingDown,
  },
  {
    version: 121,
    name: 'voucher_type_is_closing',
    up: voucherTypeIsClosingUp,
    down: voucherTypeIsClosingDown,
  },
  {
    version: 122,
    name: 'backfill_init_balance_opening',
    up: backfillInitBalanceOpeningUp,
    down: backfillInitBalanceOpeningDown,
  },
  {
    version: 123,
    name: 'fix_salvage_rate_unit',
    up: fixSalvageRateUnitUp,
    down: fixSalvageRateUnitDown,
  },
  {
    version: 124,
    name: 'cashier_period_closing',
    up: cashierPeriodClosingUp,
    down: cashierPeriodClosingDown,
  },
  {
    version: 125,
    name: 'detach_standard_report_footer',
    up: detachStandardReportFooterUp,
    down: detachStandardReportFooterDown,
  },
  {
    version: 126,
    name: 'fa_salvage_rate_guard',
    up: faSalvageRateGuardUp,
    down: faSalvageRateGuardDown,
  },
  {
    version: 127,
    name: 'cashier_journal_links',
    up: cashierJournalLinksUp,
    down: cashierJournalLinksDown,
  },
  {
    version: 128,
    name: 'cashier_currency_alias',
    up: cashierCurrencyAliasUp,
    down: cashierCurrencyAliasDown,
  },
  {
    version: 129,
    name: 'scm_arap_currency',
    up: scmArapCurrencyUp,
    down: scmArapCurrencyDown,
  },
  {
    version: 130,
    name: 'scm_fx_revaluation',
    up: scmFxRevaluationUp,
    down: scmFxRevaluationDown,
  },
  {
    version: 131,
    name: 'scm_qc_standard',
    up: scmQcStandardUp,
    down: scmQcStandardDown,
  },
  {
    version: 132,
    name: 'scm_stock_layer',
    up: scmStockLayerUp,
    down: scmStockLayerDown,
  },
  {
    version: 133,
    name: 'scm_costing_period',
    up: scmCostingPeriodUp,
    down: scmCostingPeriodDown,
  },
  {
    version: 134,
    name: 'scm_plan_actual_dates',
    up: scmPlanActualDatesUp,
    down: scmPlanActualDatesDown,
  },
  {
    version: 135,
    name: 'scm_plan_change',
    up: scmPlanChangeUp,
    down: scmPlanChangeDown,
  },
  {
    version: 136,
    name: 'scm_plan_process',
    up: scmPlanProcessUp,
    down: scmPlanProcessDown,
  },
  {
    version: 137,
    name: 'scm_wip_count',
    up: scmWipCountUp,
    down: scmWipCountDown,
  },
  {
    version: 138,
    name: 'scm_schedule',
    up: scmScheduleUp,
    down: scmScheduleDown,
  },
  {
    version: 139,
    name: 'scm_overhead_variance',
    up: scmOverheadVarianceUp,
    down: scmOverheadVarianceDown,
  },
  {
    version: 140,
    name: 'scm_item_outsource_fee',
    up: scmItemOutsourceFeeUp,
    down: scmItemOutsourceFeeDown,
  },
  {
    version: 141,
    name: 'scm_perf_indexes',
    up: scmPerfIndexesUp,
    down: scmPerfIndexesDown,
  },
  {
    version: 142,
    name: 'ledger_balance_indexes',
    up: ledgerBalanceIndexesUp,
    down: ledgerBalanceIndexesDown,
  },
  {
    version: 143,
    name: 'bank_statement_columns',
    up: bankStatementColumnsUp,
    down: bankStatementColumnsDown,
  },
  {
    version: 144,
    name: 'cashier_journal_fx',
    up: cashierJournalFxUp,
    down: cashierJournalFxDown,
  },
  {
    version: 145,
    name: 'cashier_bank_opening',
    up: cashierBankOpeningUp,
    down: cashierBankOpeningDown,
  },
  {
    version: 146,
    name: 'cashier_gl_match',
    up: cashierGlMatchUp,
    down: cashierGlMatchDown,
  },
  {
    version: 147,
    name: 'asset_status_disposed_name',
    up: assetStatusDisposedNameUp,
    down: assetStatusDisposedNameDown,
  },
  {
    version: 148,
    name: 'asset_status_disposed_backfill',
    up: assetStatusDisposedBackfillUp,
    down: assetStatusDisposedBackfillDown,
  },
  {
    version: 149,
    name: 'voucher_fts_by_id',
    up: voucherFtsByIdUp,
    down: voucherFtsByIdDown,
  },
  {
    version: 150,
    name: 'voucher_fts_rowid_key',
    up: voucherFtsRowidKeyUp,
    down: voucherFtsRowidKeyDown,
  },
  {
    version: 151,
    name: 'cashier_journal_currency_index',
    up: cashierJournalCurrencyIndexUp,
    down: cashierJournalCurrencyIndexDown,
  },
  {
    version: 152,
    name: 'cashier_journal_cover_index',
    up: cashierJournalCoverIndexUp,
    down: cashierJournalCoverIndexDown,
  },
]
