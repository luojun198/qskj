import { formatAmount } from '@/utils/format'

export interface NoNegativeBalanceViolation {
  accountName: string
  auxCategoryName?: string
  auxItemName?: string
  projectedBalance: number
  constraintAccountName?: string
}

const STYLE = {
  wrap: 'font-size:13px;line-height:1.6;color:#606266;',
  intro: 'margin:0 0 12px;',
  table: 'width:100%;border-collapse:collapse;table-layout:fixed;',
  th: 'text-align:left;padding:8px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  thRight: 'text-align:right;padding:8px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  td: 'padding:8px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;word-break:break-all;',
  tdRight:
    'padding:8px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;',
  tdMuted: 'color:#c0c4cc;',
  account: 'color:#409eff;font-weight:600;',
  category: 'color:#67c23a;font-weight:600;',
  item: 'color:#303133;font-weight:500;',
  negative: 'color:#f56c6c;font-weight:700;',
  warn: 'color:#e6a23c;font-weight:600;',
  foot: 'margin:12px 0 0;font-size:12px;color:#909399;',
} as const

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dashCell(): string {
  return `<td style="${STYLE.td};${STYLE.tdMuted};text-align:center;">—</td>`
}

export function buildNoNegativeBalanceAlertHtml(
  violations: NoNegativeBalanceViolation[]
): string {
  if (violations.length === 0) {
    return `<div style="${STYLE.wrap}">余额不允许为负数，无法保存凭证。</div>`
  }

  const rows = violations
    .map(v => {
      const hasAux = !!(v.auxCategoryName && v.auxItemName)
      const amount = formatAmount(v.projectedBalance)
      return `<tr>
        <td style="${STYLE.td}"><span style="${STYLE.account}">${escapeHtml(v.accountName)}</span></td>
        ${
          hasAux
            ? `<td style="${STYLE.td}"><span style="${STYLE.category}">${escapeHtml(v.auxCategoryName!)}</span></td>
               <td style="${STYLE.td}"><span style="${STYLE.item}">${escapeHtml(v.auxItemName!)}</span></td>`
            : `${dashCell()}${dashCell()}`
        }
        <td style="${STYLE.tdRight}"><span style="${STYLE.negative}">${escapeHtml(amount)}</span></td>
      </tr>`
    })
    .join('')

  const constraintNames = [
    ...new Set(violations.map(v => v.constraintAccountName).filter(Boolean)),
  ] as string[]

  const constraintNote =
    constraintNames.length > 0
      ? `<p style="${STYLE.foot}">受上级科目 <span style="${STYLE.warn}">${escapeHtml(constraintNames.join('、'))}</span>「余额不允许为负数」约束</p>`
      : ''

  return `<div style="${STYLE.wrap}">
    <p style="${STYLE.intro}">
      以下 <span style="${STYLE.warn}">${violations.length}</span> 项
      <span style="${STYLE.warn}">核算余额</span> 保存后将变为
      <span style="${STYLE.negative}">负数</span>，无法保存凭证：
    </p>
    <table style="${STYLE.table}">
      <colgroup>
        <col style="width:28%" />
        <col style="width:18%" />
        <col style="width:28%" />
        <col style="width:26%" />
      </colgroup>
      <thead>
        <tr>
          <th style="${STYLE.th}">科目</th>
          <th style="${STYLE.th}">核算类目</th>
          <th style="${STYLE.th}">核算项目</th>
          <th style="${STYLE.thRight}">保存后余额</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${constraintNote}
  </div>`
}
