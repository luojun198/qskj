/** Excel 批量导入：统一摘要与异常条目结构 */

import { yieldToMain } from './asyncChunk'

export interface SpreadsheetImportIssue {
  rowIndex: number
  title: string
  detail: string
}

export function buildImportSummary(params: {
  contentRowCount: number
  validCount: number
  issueCount: number
  blankSkipped: number
  templateWarning: string | null
}): { alertType: 'success' | 'warning' | 'error'; message: string; hint: string } {
  const { contentRowCount, validCount, issueCount, blankSkipped, templateWarning } = params

  if (templateWarning) {
    return {
      alertType: 'warning',
      message: templateWarning,
      hint:
        issueCount > 0
          ? `另有 ${issueCount} 行数据未能通过校验，可点击「查看异常说明」了解详情。`
          : '请修正模板列名后重新上传。',
    }
  }

  if (contentRowCount === 0) {
    return {
      alertType: 'warning',
      message: '文件中没有可识别的数据行，请检查是否按模板填写。',
      hint: '',
    }
  }

  if (validCount === 0 && issueCount > 0) {
    return {
      alertType: 'error',
      message: `共读取 ${contentRowCount} 行有效内容，目前没有一行可以通过校验。`,
      hint: '请点击下方「查看异常说明」，按行号修正模板后重新导入。',
    }
  }

  if (issueCount > 0) {
    const parts = [
      `模板中共 ${contentRowCount} 行有数据，其中 ${validCount} 行可以导入`,
      `${issueCount} 行因填写不规范或未匹配将不会写入`,
    ]
    if (blankSkipped > 0) parts.push(`已自动跳过 ${blankSkipped} 行空白行`)
    return {
      alertType: 'warning',
      message: parts.join('；') + '。',
      hint: '可继续导入已通过校验的行，或点击「查看异常说明」核对后再改模板。',
    }
  }

  const msg =
    blankSkipped > 0
      ? `共 ${validCount} 行数据已通过校验（另跳过 ${blankSkipped} 行空白行），可以确认导入。`
      : `共 ${validCount} 行数据已通过校验，可以确认导入。`
  return {
    alertType: 'success',
    message: msg,
    hint: '',
  }
}

export function collectImportIssues<T extends { matched: boolean; rowIndex: number }>(
  rows: T[],
  describe: (row: T) => SpreadsheetImportIssue
): SpreadsheetImportIssue[] {
  return rows
    .filter(r => !r.matched)
    .map(describe)
    .sort((a, b) => a.rowIndex - b.rowIndex)
}

function buildImportIssueGroupKey(row: { error?: string }): string {
  return row.error?.trim() || 'unknown'
}

function aggregateImportIssueTitle(
  described: SpreadsheetImportIssue,
  rowIndices: number[],
  count: number
): string {
  if (count <= 1) return described.title
  const min = rowIndices[0]
  const max = rowIndices[rowIndices.length - 1]
  const suffix = described.title.includes('：')
    ? described.title.split('：').slice(1).join('：')
    : described.title
  return `第 ${min}-${max} 行（共 ${count} 行）：${suffix}`
}

function issuesFromImportGroups<T extends { matched: boolean; rowIndex: number; error?: string }>(
  groups: Map<string, { rowIndices: number[]; sample: T }>,
  describe: (row: T) => SpreadsheetImportIssue,
  maxGroups: number
): SpreadsheetImportIssue[] {
  const totalIssueRows = [...groups.values()].reduce((sum, g) => sum + g.rowIndices.length, 0)
  if (totalIssueRows === 0) return []

  const sorted = [...groups.entries()]
    .sort((a, b) => b[1].rowIndices.length - a[1].rowIndices.length)
    .slice(0, maxGroups)

  const issues: SpreadsheetImportIssue[] = []
  if (groups.size > maxGroups) {
    issues.push({
      rowIndex: 0,
      title: '异常汇总',
      detail: `共有 ${totalIssueRows} 行未能导入，分为 ${groups.size} 类问题。以下按影响行数列出前 ${maxGroups} 类，请按说明修正模板后重新导入。`,
    })
  }

  for (const [, group] of sorted) {
    group.rowIndices.sort((a, b) => a - b)
    const described = describe(group.sample)
    issues.push({
      rowIndex: group.rowIndices[0],
      title: aggregateImportIssueTitle(described, group.rowIndices, group.rowIndices.length),
      detail: described.detail,
    })
  }

  return issues.sort((a, b) => a.rowIndex - b.rowIndex)
}

/** 将同类异常合并为汇总条目（同步版） */
export function aggregateImportIssues<T extends { matched: boolean; rowIndex: number; error?: string }>(
  rows: T[],
  describe: (row: T) => SpreadsheetImportIssue,
  options?: { maxGroups?: number }
): SpreadsheetImportIssue[] {
  const maxGroups = options?.maxGroups ?? 100
  const groups = new Map<string, { rowIndices: number[]; sample: T }>()
  for (const row of rows) {
    if (row.matched) continue
    const key = buildImportIssueGroupKey(row)
    let group = groups.get(key)
    if (!group) {
      group = { rowIndices: [], sample: row }
      groups.set(key, group)
    }
    group.rowIndices.push(row.rowIndex)
  }
  return issuesFromImportGroups(groups, describe, maxGroups)
}

/** 分块汇总异常说明，避免大批量导入时阻塞主线程 */
export async function aggregateImportIssuesAsync<
  T extends { matched: boolean; rowIndex: number; error?: string },
>(
  rows: T[],
  describe: (row: T) => SpreadsheetImportIssue,
  options?: {
    maxGroups?: number
    yieldEvery?: number
    onProgress?: (pct: number) => void
  }
): Promise<SpreadsheetImportIssue[]> {
  const maxGroups = options?.maxGroups ?? 100
  const yieldEvery = options?.yieldEvery ?? 5000
  const groups = new Map<string, { rowIndices: number[]; sample: T }>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.matched) continue
    const key = buildImportIssueGroupKey(row)
    let group = groups.get(key)
    if (!group) {
      group = { rowIndices: [], sample: row }
      groups.set(key, group)
    }
    group.rowIndices.push(row.rowIndex)

    if (i > 0 && i % yieldEvery === 0) {
      options?.onProgress?.(Math.min(85, Math.floor((i / rows.length) * 85)))
      await yieldToMain()
    }
  }

  options?.onProgress?.(90)
  await yieldToMain()
  const result = issuesFromImportGroups(groups, describe, maxGroups)
  options?.onProgress?.(100)
  return result
}
