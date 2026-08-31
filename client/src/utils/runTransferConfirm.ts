export interface RunTransferPreviewItem {
  transferTypeName: string
  transferTypeCode: string
  voucherType: string
}

const STYLE = {
  wrap: 'font-size:13px;line-height:1.65;color:#606266;',
  intro: 'margin:0 0 14px;',
  period: 'color:#409eff;font-weight:700;',
  action: 'color:#67c23a;font-weight:700;',
  sectionTitle: 'margin:0 0 8px;color:#303133;font-weight:600;',
  table: 'width:100%;border-collapse:collapse;table-layout:fixed;',
  th: 'text-align:left;padding:7px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  thCenter:
    'text-align:center;padding:7px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;width:48px;',
  thRight:
    'text-align:right;padding:7px 10px;background:#f5f7fa;color:#909399;font-weight:600;font-size:12px;border-bottom:1px solid #dcdfe6;',
  td: 'padding:7px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;word-break:break-all;',
  tdCenter:
    'padding:7px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;text-align:center;color:#909399;font-variant-numeric:tabular-nums;',
  tdRight:
    'padding:7px 10px;border-bottom:1px solid #ebeef5;vertical-align:middle;text-align:right;white-space:nowrap;',
  typeName: 'color:#303133;font-weight:600;',
  typeCode: 'color:#909399;font-size:12px;',
  voucherType: 'color:#409eff;font-weight:600;',
  count: 'color:#e6a23c;font-weight:700;',
  info:
    'margin:12px 0 0;padding:10px 12px;border-radius:4px;background:#f0f9eb;color:#606266;font-size:12px;line-height:1.7;',
  infoHighlight: 'color:#67c23a;font-weight:700;',
  infoAction: 'color:#409eff;font-weight:600;',
} as const

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildRunTransferConfirmHtml(
  year: number,
  period: number,
  items: RunTransferPreviewItem[]
): string {
  const rows = items
    .map(
      (item, index) => `<tr>
        <td style="${STYLE.tdCenter}">${index + 1}</td>
        <td style="${STYLE.td}">
          <span style="${STYLE.typeName}">${escapeHtml(item.transferTypeName)}</span>
          <span style="${STYLE.typeCode}"> · ${escapeHtml(item.transferTypeCode)}</span>
        </td>
        <td style="${STYLE.tdRight}"><span style="${STYLE.voucherType}">${escapeHtml(item.voucherType || '-')}</span></td>
      </tr>`
    )
    .join('')

  const count = items.length

  return `<div style="${STYLE.wrap}">
    <p style="${STYLE.intro}">
      确认对 <span style="${STYLE.period}">${year}年${period}期</span> 执行
      <span style="${STYLE.action}">生成结转凭证</span> 吗？
    </p>
    <p style="${STYLE.sectionTitle}">
      将生成以下 <span style="${STYLE.count}">${count}</span> 张结转凭证：
    </p>
    <table style="${STYLE.table}">
      <colgroup>
        <col style="width:12%" />
        <col style="width:58%" />
        <col style="width:30%" />
      </colgroup>
      <thead>
        <tr>
          <th style="${STYLE.thCenter}">序号</th>
          <th style="${STYLE.th}">结转类型</th>
          <th style="${STYLE.thRight}">凭证字</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="${STYLE.info}">
      凭证将 <span style="${STYLE.infoHighlight}">自动审核并记账</span>，请确认
      <span style="${STYLE.infoAction}">期间与结转类型</span> 无误后再操作。
    </p>
  </div>`
}
