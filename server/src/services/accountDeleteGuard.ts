import type Database from 'better-sqlite3'

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table)
}

/** 报表公式中引用科目编码的常见写法（@ye(1001, …) 等） */
function buildAccountCodeFormulaPatterns(code: string): string[] {
  const c = String(code).trim()
  if (!c) return []
  const fnPrefixes = ['ye', 'nc', 'df', 'jqy', 'jdf', 'jf', 'dfye']
  const patterns = [`%(${c},%`, `%(${c})%`, `%(${c};%`, `%(${c}'%`, `%"${c}"%`]
  for (const fn of fnPrefixes) {
    patterns.push(`%@${fn}(${c}%`, `%${fn}(${c}%`)
  }
  return patterns
}

/**
 * 科目是否被报表公式引用（动态报表 report_cells / 固定模板 report_template_items）
 * 不查询已废弃的 report_template_cells 表。
 */
export function getAccountReportTemplateBlockReason(
  db: Database.Database,
  accountSetId: string,
  accountCode: string
): string | null {
  const patterns = buildAccountCodeFormulaPatterns(accountCode)
  if (patterns.length === 0) return null

  if (tableExists(db, 'report_cells')) {
    const cond = patterns.map(() => 'rc.formula_text LIKE ?').join(' OR ')
    const row = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM report_cells rc
        INNER JOIN report_sheets rs ON rs.id = rc.report_sheet_id
        INNER JOIN report_definitions rd ON rd.id = rs.report_definition_id
        WHERE rd.account_set_id = ?
          AND rc.formula_text IS NOT NULL
          AND TRIM(rc.formula_text) != ''
          AND (${cond})
      `
      )
      .get(accountSetId, ...patterns) as { count: number } | undefined

    if ((row?.count ?? 0) > 0) {
      return '该科目在动态报表模板公式中使用，请先修改相关报表'
    }
  }

  if (tableExists(db, 'report_template_items') && tableExists(db, 'report_templates')) {
    const cond = patterns
      .flatMap(() => ['rti.formula_begin LIKE ?', 'rti.formula_end LIKE ?'])
      .join(' OR ')
    const params = patterns.flatMap(p => [p, p])
    const row = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM report_template_items rti
        INNER JOIN report_templates rt ON rt.id = rti.template_id
        WHERE rt.account_set_id = ?
          AND (${cond})
      `
      )
      .get(accountSetId, ...params) as { count: number } | undefined

    if ((row?.count ?? 0) > 0) {
      return '该科目在报表模板中使用，请先修改报表模板'
    }
  }

  return null
}
