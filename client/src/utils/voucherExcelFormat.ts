/**
 * 凭证 Excel 转出 / 转入 的文件格式工具
 *
 * 首行为表头（必填列带 *），一行一条分录；列定义来自服务端 /voucher/excel-import/columns，
 * 转出写出的文件可直接在「转入」页回导。
 */
import type { VoucherExcelColumn } from '@/api/voucherExcel'

function parseAuxData(raw: unknown): Record<string, { id?: string; name?: string }> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, { id?: string; name?: string }>
  try {
    return JSON.parse(String(raw)) || {}
  } catch {
    return {}
  }
}

function numOrEmpty(v: unknown): number | '' {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n : ''
}

/** 把凭证列表（含 entries）展开成一行一分录的二维数组（含表头） */
export function buildVoucherExcelMatrix(vouchers: any[], columns: VoucherExcelColumn[]): unknown[][] {
  const header = columns.map(c => (c.required ? `${c.label}*` : c.label))
  const rows: unknown[][] = [header]
  for (const v of vouchers) {
    const entries: any[] = Array.isArray(v.entries) ? v.entries : []
    for (const e of entries) {
      const aux = parseAuxData(e.aux_data)
      const isDebit = e.direction === 'debit'
      const row = columns.map(c => {
        if (c.auxCategoryCode) return aux[c.auxCategoryCode]?.name ?? ''
        switch (c.key) {
          case 'seq':
            return v.voucher_no ?? ''
          case 'voucher_type':
            return v.voucher_type_name ?? ''
          case 'voucher_date':
            return v.voucher_date ?? ''
          case 'summary':
            return e.summary ?? ''
          case 'account_code':
            return e.account_code ?? ''
          case 'account_name':
            return e.account_name ?? ''
          case 'debit':
            return isDebit ? numOrEmpty(e.amount) : ''
          case 'credit':
            return isDebit ? '' : numOrEmpty(e.amount)
          case 'currency_code':
            return e.currency_code ?? ''
          case 'exchange_rate':
            return numOrEmpty(e.exchange_rate)
          case 'foreign_amount':
            return numOrEmpty(e.foreign_amount)
          case 'quantity':
            return numOrEmpty(e.quantity)
          case 'unit':
            return e.unit ?? ''
          case 'unit_price':
            return numOrEmpty(e.unit_price)
          case 'cash_flow_code':
            return e.cash_flow_code ?? ''
          case 'cash_flow_name':
            return e.cash_flow_name ?? ''
          case 'remark':
            return v.remark ?? ''
          default:
            return ''
        }
      })
      rows.push(row)
    }
  }
  return rows
}

/** 转出：写 xlsx 文件（首行即表头，可回导） */
export async function exportVouchersForImport(
  vouchers: any[],
  columns: VoucherExcelColumn[],
  fileName = `凭证转出_${Date.now()}.xlsx`
) {
  const { utils, writeFile } = await import('xlsx')
  const matrix = buildVoucherExcelMatrix(vouchers, columns)
  const ws = utils.aoa_to_sheet(matrix)
  ws['!cols'] = columns.map(c => ({ wch: Math.max(10, c.label.length * 2 + 2) }))
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '凭证')
  writeFile(wb, fileName)
  return matrix.length - 1
}

/** 生成空模板（表头 + 一行示例） */
export async function downloadVoucherExcelTemplate(columns: VoucherExcelColumn[]) {
  const { utils, writeFile } = await import('xlsx')
  const header = columns.map(c => (c.required ? `${c.label}*` : c.label))
  const sample = columns.map(c => {
    switch (c.key) {
      case 'seq':
        return '1'
      case 'voucher_type':
        return '记账凭证'
      case 'voucher_date':
        return new Date().toISOString().slice(0, 10)
      case 'summary':
        return '示例行，导入前请删除'
      case 'account_code':
        return '1001'
      case 'account_name':
        return '库存现金'
      case 'debit':
        return 100
      default:
        return ''
    }
  })
  const ws = utils.aoa_to_sheet([header, sample])
  ws['!cols'] = columns.map(c => ({ wch: Math.max(10, c.label.length * 2 + 2) }))
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '凭证')
  writeFile(wb, '凭证转入模板.xlsx')
}

export interface ParsedExcelResult {
  rows: Record<string, unknown>[]
  unknownHeaders: string[]
}

/** 转入：读 xlsx，表头去 * 后按 label 反查 key；跳过全空行；Date → YYYY-MM-DD */
export async function parseVoucherExcelFile(file: File, columns: VoucherExcelColumn[]): Promise<ParsedExcelResult> {
  const { utils, read } = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
  if (matrix.length < 2) throw new Error('文件中没有数据行')

  const header = (matrix[0] as unknown[]).map(h => String(h ?? '').replace(/\*$/, '').trim())
  const labelToKey = new Map(columns.map(c => [c.label, c.key]))
  const keyByIndex = header.map(h => labelToKey.get(h) ?? null)
  const unknownHeaders = header.filter((h, i) => h && !keyByIndex[i])
  if (!keyByIndex.some(Boolean)) throw new Error('表头无法识别，请使用「转出」或「下载模板」生成的表头')

  const rows: Record<string, unknown>[] = []
  for (const raw of matrix.slice(1)) {
    const arr = raw as unknown[]
    const obj: Record<string, unknown> = {}
    keyByIndex.forEach((key, i) => {
      if (!key) return
      const v = arr[i]
      if (v instanceof Date) {
        obj[key] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      } else {
        obj[key] = v
      }
    })
    if (Object.values(obj).every(v => v == null || String(v).trim() === '')) continue
    rows.push(obj)
  }
  if (!rows.length) throw new Error('文件中没有有效数据行')
  return { rows, unknownHeaders }
}
