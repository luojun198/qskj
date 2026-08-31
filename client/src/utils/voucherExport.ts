import request from '@/api/request'
import { exportStyledTable, type ExportColumnDef } from './exportStyledExcel'

const statusText: Record<string, string> = {
  draft: '草稿',
  audited: '已审核',
  posted: '已记账',
}

export async function fetchAllVouchers(params: Record<string, unknown> = {}) {
  const res = await request.get<any[]>('/voucher/vouchers', {
    params: {
      ...params,
      page: 1,
      pageSize: -1,
    },
  })
  return Array.isArray(res.data) ? res.data : []
}

type VoucherExportRow = {
  凭证号: string
  日期: string
  摘要: string
  科目编码: string
  科目名称: string
  借方金额: number | ''
  贷方金额: number | ''
  制单人: string
  审核人: string
  记账人: string
  状态: string
}

function buildVoucherExportColumns(): ExportColumnDef<VoucherExportRow>[] {
  return [
    { label: '凭证号', width: 100, align: 'center', value: row => row.凭证号 },
    { label: '日期', width: 100, value: row => row.日期 },
    { label: '摘要', width: 180, value: row => row.摘要 },
    { label: '科目编码', width: 100, value: row => row.科目编码 },
    { label: '科目名称', width: 160, value: row => row.科目名称 },
    {
      label: '借方金额',
      width: 130,
      align: 'right',
      type: 'amount',
      value: row => row.借方金额,
    },
    {
      label: '贷方金额',
      width: 130,
      align: 'right',
      type: 'amount',
      value: row => row.贷方金额,
    },
    { label: '制单人', width: 90, value: row => row.制单人 },
    { label: '审核人', width: 90, value: row => row.审核人 },
    { label: '记账人', width: 90, value: row => row.记账人 },
    { label: '状态', width: 80, align: 'center', value: row => row.状态 },
  ]
}

function buildVoucherExportRow(voucher: any, entry: any | null): VoucherExportRow {
  const isDebit = entry?.direction === 'debit'
  const isCredit = entry?.direction === 'credit'
  return {
    凭证号: voucher.voucher_no,
    日期: voucher.voucher_date,
    摘要: entry ? entry.summary : voucher.summary,
    科目编码: entry?.account_code || '',
    科目名称: entry?.account_name || '',
    借方金额: entry ? (isDebit ? entry.amount : '') : voucher.total_debit || '',
    贷方金额: entry ? (isCredit ? entry.amount : '') : voucher.total_credit || '',
    制单人: voucher.maker_name || '',
    审核人: voucher.auditor_name || '',
    记账人: voucher.poster_name || '',
    状态: statusText[voucher.status] || voucher.status,
  }
}

export async function exportVouchersToExcel(
  vouchers: any[],
  options: {
    sheetName: string
    filePrefix: string
    title?: string
    subtitle?: string
  }
) {
  const rows: VoucherExportRow[] = []

  for (const voucher of vouchers) {
    if (!voucher.entries || voucher.entries.length === 0) {
      rows.push(buildVoucherExportRow(voucher, null))
      continue
    }

    for (const entry of voucher.entries) {
      rows.push(buildVoucherExportRow(voucher, entry))
    }
  }

  await exportStyledTable({
    fileName: `${options.filePrefix}_${Date.now()}.xlsx`,
    sheetName: options.sheetName,
    title: options.title || options.sheetName,
    subtitle: options.subtitle,
    columns: buildVoucherExportColumns(),
    rows,
  })
}
