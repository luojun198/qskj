/**
 * 新建账套时写入的默认凭证打印模板（hiprint panel）。
 *
 * 排版与客户端 `printTemplateDefaultsHiprint.ts` 的 buildDefaultVoucherPanel() 完全一致：
 * 服务端不能引用客户端代码，直接使用由客户端生成的 JSON 快照（voucherStandardPanel.ts），
 * 客户端测试会比对两边，避免手工移植走样。
 * 凭证纸 220×140；摘要 / 会计科目（全称）/ 借方 / 贷方四列，固定 6 行，合计行带大写金额。
 */
import { VOUCHER_STANDARD_PANEL } from './voucherStandardPanel.js'

/** 见客户端 VOUCHER_ROWS_FILL_SLACK_PT：补空行循环会删掉最后 clone 的一行，行高必须留余量 */
const ROWS_FILL_SLACK_PT = 2
const MIN_BODY_ROW_HEIGHT_PT = 8

/** 标准凭证每张固定打印的分录行数（不含合计行） */
export const DEFAULT_VOUCHER_FIXED_ROWS = 6

/** 标准凭证纸（mm），与前端 client/src/utils/printTemplateDefaultsHiprint.ts 一致 */
export const VOUCHER_PAPER_WIDTH_MM = 220
export const VOUCHER_PAPER_HEIGHT_MM = 140

/** 标准凭证模板版本（面板上的 cwLayoutVersion）；低于此版本且未被改过的默认模板会被迁移升级 */
export const VOUCHER_STANDARD_LAYOUT_VERSION = 2

/**
 * 列头 + N 行 + 合计行均分表格框可用高度得到的统一行高（见客户端 computeVoucherBodyRowHeightPt）。
 */
export function computeBodyRowHeightPt(tableHeightPt: number, rows: number): number {
  if (rows <= 0) return 0
  const usable = tableHeightPt - ROWS_FILL_SLACK_PT
  return Math.max(Math.floor((usable / (rows + 2)) * 2) / 2, MIN_BODY_ROW_HEIGHT_PT)
}

/** 标准记账凭证默认面板（深拷贝，调用方可放心修改） */
export function buildDefaultVoucherHiprintPanel() {
  return JSON.parse(JSON.stringify(VOUCHER_STANDARD_PANEL)) as {
    panels: Array<Record<string, any> & { printElements: Array<Record<string, any>> }>
  }
}
