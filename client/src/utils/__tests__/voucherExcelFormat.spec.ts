import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildVoucherExcelMatrix, parseVoucherExcelFile } from '../voucherExcelFormat'
import type { VoucherExcelColumn } from '@/api/voucherExcel'

const columns: VoucherExcelColumn[] = [
  { key: 'seq', label: '凭证序号', required: true },
  { key: 'voucher_type', label: '凭证类型', required: false },
  { key: 'voucher_date', label: '凭证日期', required: true },
  { key: 'summary', label: '摘要', required: false },
  { key: 'account_code', label: '科目编码', required: true },
  { key: 'debit', label: '借方金额', required: false },
  { key: 'credit', label: '贷方金额', required: false },
  { key: 'aux_dept', label: '部门', required: false, auxCategoryCode: 'dept' },
]

const vouchers = [
  {
    voucher_no: '记-001',
    voucher_type_name: '记账',
    voucher_date: '2026-09-05',
    entries: [
      { account_code: '660201', direction: 'debit', amount: 100, summary: '办公费', aux_data: JSON.stringify({ dept: { id: 'x', name: '销售部' } }) },
      { account_code: '1001', direction: 'credit', amount: 100, summary: '办公费', aux_data: null },
    ],
  },
]

describe('voucherExcelFormat', () => {
  it('转出矩阵：首行表头（必填带 *），一行一分录，辅助列写项目名称', () => {
    const m = buildVoucherExcelMatrix(vouchers, columns)
    expect(m[0]).toEqual(['凭证序号*', '凭证类型', '凭证日期*', '摘要', '科目编码*', '借方金额', '贷方金额', '部门'])
    expect(m[1]).toEqual(['记-001', '记账', '2026-09-05', '办公费', '660201', 100, '', '销售部'])
    expect(m[2]).toEqual(['记-001', '记账', '2026-09-05', '办公费', '1001', '', 100, ''])
  })

  it('转出的文件可原样解析回 rows（回导）', async () => {
    const ws = XLSX.utils.aoa_to_sheet(buildVoucherExcelMatrix(vouchers, columns))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '凭证')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([buf], 'v.xlsx')
    const { rows, unknownHeaders } = await parseVoucherExcelFile(file, columns)
    expect(unknownHeaders).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ seq: '记-001', voucher_date: '2026-09-05', account_code: '660201', debit: 100, aux_dept: '销售部' })
    expect(rows[1]).toMatchObject({ account_code: '1001', credit: 100 })
  })
})
