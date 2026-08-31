export interface RevokeTransferVoucherItem {
  transferTypeName: string
  voucherNo: string
}

const STYLE = {
  wrap: 'font-size:13px;line-height:1.65;color:#606266;',
  intro: 'margin:0 0 14px;',
  period: 'color:#409eff;font-weight:700;',
  action: 'color:#f56c6c;font-weight:700;',
  sectionTitle: 'margin:0 0 8px;color:#303133;font-weight:600;',
  table: 'width:100%;border-collapse:collapse;table-layout:fixed;',
  th: 'text-align:left;padding:7px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  thRight:
    'text-align:right;padding:7px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  td: 'padding:7px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;word-break:break-all;',
  tdRight:
    'padding:7px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;',
  typeName: 'color:#303133;font-weight:600;',
  voucherNo: 'color:#409eff;font-weight:600;',
  count: 'color:#e6a23c;font-weight:700;',
  warn: 'margin:12px 0 0;padding:10px 12px;border-radius:4px;background:#fef0f0;color:#606266;font-size:12px;line-height:1.7;',
  warnHighlight: 'color:#f56c6c;font-weight:700;',
  warnAction: 'color:#e6a23c;font-weight:600;',
} as const

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildRevokeTransferConfirmHtml(
  year: number,
  period: number,
  vouchers: RevokeTransferVoucherItem[]
): string {
  const rows = vouchers
    .map(
      item => `<tr>
        <td style="${STYLE.td}"><span style="${STYLE.typeName}">${escapeHtml(item.transferTypeName)}</span></td>
        <td style="${STYLE.tdRight}"><span style="${STYLE.voucherNo}">${escapeHtml(item.voucherNo || '-')}</span></td>
      </tr>`
    )
    .join('')

  const count = vouchers.length

  return `<div style="${STYLE.wrap}">
    <p style="${STYLE.intro}">
      确认对 <span style="${STYLE.period}">${year}年${period}期</span> 执行
      <span style="${STYLE.action}">反结转</span> 吗？
    </p>
    <p style="${STYLE.sectionTitle}">
      将一次性删除以下 <span style="${STYLE.count}">${count}</span> 张结转生成的凭证：
    </p>
    <table style="${STYLE.table}">
      <colgroup>
        <col style="width:58%" />
        <col style="width:42%" />
      </colgroup>
      <thead>
        <tr>
          <th style="${STYLE.th}">结转类型</th>
          <th style="${STYLE.thRight}">凭证号</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="${STYLE.warn}">
      此操作会 <span style="${STYLE.warnAction}">冲回已记账金额</span>，
      <span style="${STYLE.warnHighlight}">删除后不可恢复</span>。
    </p>
  </div>`
}
