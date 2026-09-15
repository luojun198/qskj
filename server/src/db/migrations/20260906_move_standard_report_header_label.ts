import type { Database } from 'better-sqlite3'
import type { Migration } from '../migrations.js'
import { applyStandardReportHeaderLayout } from './20260906_center_standard_report_header_date.js'

/**
 * 抬头「纳税人名称：xxx」挪到日期下一行，让公司名有整行可用、不再被日期截断。
 * 与 116 共用同一套规则（幂等）；单独成一条是因为 116 可能已在没有这条规则时跑过。
 */
export const up: Migration['up'] = (db: Database) => {
  applyStandardReportHeaderLayout(db)
}

export const down: Migration['down'] = () => {}
