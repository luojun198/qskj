/** 批量任务失败详情展示用，避免向用户暴露 UUID */

export function formatAccountDisplayLabel(
  account?: { code?: string; name?: string } | null,
  rowIndex?: number
): string {
  const name = account?.name?.trim()
  const code = account?.code?.trim()
  if (name && code) return `${name}（${code}）`
  if (name) return name
  if (code) return code
  if (rowIndex != null) return formatRowLabel(rowIndex)
  return '未知科目'
}

export function formatVoucherDisplayLabel(voucher?: {
  voucher_no?: string | null
  voucher_date?: string | null
} | null): string {
  const no = voucher?.voucher_no?.trim()
  const date = voucher?.voucher_date?.trim()
  if (no && date) return `${no}（${date}）`
  if (no) return no
  if (date) return `凭证 ${date}`
  return '未知凭证'
}

export function formatRowLabel(rowIndex: number): string {
  return `第 ${rowIndex} 行`
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  )
}
