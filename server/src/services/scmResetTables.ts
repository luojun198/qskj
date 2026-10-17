/**
 * 供应链初始化（清空）涉及的表：业务数据 / 基础档案。
 * 供「供应链初始化」与「进销存 ACD 导入撤销」共用，新增业务表时在这里补齐。
 */
// P2-6：业务表补齐序列号/批次流水、核销、MRP 来源、工单成品与用料、质检、报工；主数据补齐工艺路线/工作中心/库位/字段配置。
// 顺序：先明细后头表（无外键约束，但便于阅读与将来加约束）。
export const SCM_RESET_BUSINESS_TABLES = [
  'scm_qc_line', 'scm_qc_doc', 'scm_work_report', 'scm_mrp_source',
  'scm_serial_move', 'scm_serial', 'scm_batch_move', 'scm_stock_batch',
  'scm_ar_ap_verify', 'scm_ar_ap_log',
  'scm_doc_line', 'scm_doc', 'scm_stock_layer_use', 'scm_stock_layer', 'scm_costing_period', 'scm_stock_move', 'scm_stock',
  'scm_production_plan_line', 'scm_production_plan_product', 'scm_production_plan',
  // 订单变更单（2026-10-09 新增）、工单变更单（此前漏列，重新初始化后会残留，FIX-383）
  'scm_order_change', 'scm_production_plan_change',
  // 对账单（2026-10-11 新增）
  'scm_statement_line', 'scm_statement', 'scm_invoice_arap_adjust',
  // OPT-4：在制盘点、工单工序、排程记录、制费/人工差异结转、往来汇率重估（此前漏列，初始化后残留并与新数据混在一起）
  'scm_plan_wip_count_line', 'scm_plan_wip_count', 'scm_production_plan_process', 'scm_schedule_run',
  'scm_overhead_variance_run', 'scm_fx_revaluation',
] as const
export const SCM_RESET_MASTER_TABLES = [
  'scm_routing_line', 'scm_routing', 'scm_work_center',
  'scm_bom_line', 'scm_bom', 'scm_item_unit', 'scm_item_field_defs', 'scm_doc_field_defs',
  'scm_item_category', 'scm_item', 'scm_partner', 'scm_bin', 'scm_warehouse', 'scm_unit',
  'scm_gl_aux_map',
] as const
