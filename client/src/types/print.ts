/**
 * 打印模版相关类型定义
 */

// 纸张尺寸类型
export type PaperSize = 'A4' | 'A5' | 'custom'

// 细粒度字段元素类型
export type FieldElementType =
  | 'title'                    // 标题
  | 'text'                     // 自定义文本
  | 'unit_name'                // 单位名称（系统参数）
  | 'account_set_name'         // 账套名称
  | 'voucher_no'               // 凭证字号
  | 'date'                     // 日期
  | 'voucher_type'             // 凭证类型
  | 'attachments'              // 附件张数
  | 'table'                    // 分录表格
  | 'total_label'              // 合计标签
  | 'total_debit'              // 借方合计
  | 'total_credit'             // 贷方合计
  | 'signature_maker'          // 制单
  | 'signature_auditor'        // 审核
  | 'signature_poster'         // 记账
  | 'signature_supervisor'     // 主管

// 日期格式类型
export type DateFormat = 'YYYY-MM-DD' | 'YYYY年MM月DD日' | 'MM/DD/YYYY'

// 数字格式类型
export type NumberFormat = 'plain' | 'thousand' | 'currency'

// 表格列字段类型
export type TableColumnField = 'summary' | 'account_code' | 'account_name' | 'debit' | 'credit'

// 表格列定义
export interface TableColumn {
  field: TableColumnField | string  // 支持辅助项目类别代码（如 'aux_CAT001'）
  label: string
  width: string
  align?: 'left' | 'center' | 'right'  // 水平对齐
  verticalAlign?: 'top' | 'middle' | 'bottom'  // 垂直对齐
  paddingTop?: number      // 上内边距（mm）
  paddingBottom?: number   // 下内边距（mm）
  paddingLeft?: number     // 左内边距（mm）
  paddingRight?: number    // 右内边距（mm）
  visible?: boolean
  auxCategoryCode?: string  // 辅助项目类别代码（当 field 以 'aux_' 开头时使用）
  showPaddingSettings?: boolean  // 内边距设置面板是否展开（设计器运行时状态）
}

// 字段元素接口（设计器使用）
export interface FieldElement {
  id: string
  type: FieldElementType
  x: number                    // X 坐标（mm）
  y: number                    // Y 坐标（mm）
  width: number                // 宽度（mm）
  height: number               // 高度（mm）
  fontSize: number             // 字体大小（pt）
  fontWeight: 'normal' | 'bold'
  align: 'left' | 'center' | 'right'
  
  // 文本元素
  text?: string
  
  // 日期格式
  dateFormat?: DateFormat
  
  // 数字格式
  numberFormat?: NumberFormat
  
  // 表格配置
  columns?: TableColumn[]
  borderWidth?: number
  showHeader?: boolean
  rowHeight?: number
  printRows?: number             // 打印行数（默认6行，最后一行为合计）
}

// 打印模版
export interface PrintTemplate {
  id: string
  account_set_id: string
  name: string
  paper_size: PaperSize
  paper_width: number // mm
  paper_height: number // mm
  margin_top: number // mm
  margin_bottom: number // mm
  margin_left: number // mm
  margin_right: number // mm
  elements: FieldElement[]     // 改为字段元素数组
  is_default: boolean
  created_at: string
  updated_at: string
  // ===== vue-plugin-hiprint 套打扩展字段 =====
  template_type?: PrintTemplateType   // voucher | ledger | report
  template_key?: string | null        // 业务子类型，如 report:balance_sheet
  panel?: HiprintPanel | null         // hiprint 原生模板 JSON
  background_image?: string | null    // 套打底图 URL
}

/** 打印模板大类 */
export type PrintTemplateType = 'voucher' | 'ledger' | 'report'

/** hiprint 原生模板面板（结构由 vue-plugin-hiprint 定义，此处用宽松类型承接） */
export interface HiprintPanel {
  index?: number
  height?: number
  width?: number
  paperType?: string
  paperHeader?: number
  paperFooter?: number
  printElements?: unknown[]
  background?: string
  [key: string]: unknown
}

/** /print-templates/applicable 返回的轻量条目 */
export interface ApplicableTemplate {
  id: string
  name: string
  template_type: PrintTemplateType
  template_key: string | null
  background_image: string | null
  is_default: boolean
}

// ============ 兼容旧版类型（保留用于迁移） ============

// 旧版打印模版元素类型
export type PrintElementType = 'title' | 'info' | 'table' | 'total' | 'signature'

// 旧版打印模版元素基础接口
export interface PrintElement {
  type: PrintElementType
  fontSize?: number
  fontWeight?: string
  align?: 'left' | 'center' | 'right'
  marginBottom?: number
}

// 旧版标题元素
export interface TitleElement extends PrintElement {
  type: 'title'
  text: string
}

// 旧版信息元素
export interface InfoElement extends PrintElement {
  type: 'info'
  fields: string[]
}

// 旧版表格元素
export interface TableElement extends PrintElement {
  type: 'table'
  columns: TableColumn[]
  borderWidth?: number
}

// 旧版合计元素
export interface TotalElement extends PrintElement {
  type: 'total'
}

// 旧版签名栏字段
export interface SignatureField {
  label: string
  field: string
}

// 旧版签名元素
export interface SignatureElement extends PrintElement {
  type: 'signature'
  fields: SignatureField[]
}

// 旧版打印模版元素配置
export interface PrintTemplateElements {
  title?: TitleElement
  info?: InfoElement
  table?: TableElement
  total?: TotalElement
  signature?: SignatureElement
}

// 凭证分录打印数据
export interface VoucherEntryPrintData {
  summary: string
  account_code: string
  account_name: string
  debit: number
  credit: number
  aux_data?: Record<string, { id: string; name: string; field_values?: Record<string, any> }>  // 辅助项目数据
}

// 凭证打印数据
export interface VoucherPrintData {
  id: string
  voucher_no: string
  date: string
  voucher_type: string
  attachments: number
  account_set_name: string  // 账套名称
  entries: VoucherEntryPrintData[]
  total_debit: number
  total_credit: number
  created_by: string
  created_at: string
  auditor?: string
  audit_time?: string
  poster?: string
  posting_time?: string
  maker?: string
  supervisor?: string
  // 分页打印字段
  pageIndex?: number    // 当前页码（从 1 开始）
  totalPages?: number   // 总页数
  pageEntries?: VoucherEntryPrintData[]  // 当前页的分录（分页后使用）
  pageDebit?: number    // 当前页借方小计
  pageCredit?: number   // 当前页贷方小计
}

// 批量打印请求参数
export interface BatchPrintRequest {
  voucher_ids?: string[]
  voucher_type?: string
  start_date?: string
  end_date?: string
}
