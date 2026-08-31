/**
 * 格式化金额（千分位）
 */
export function formatAmount(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '0.00'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * 格式化金额（带正负号和颜色类）
 */
export function formatAmountWithSign(amount: number | string | null | undefined): {
  text: string
  class: string
} {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount || 0)
  const text = formatAmount(num)
  const className = num < 0 ? 'amount-negative' : num > 0 ? 'amount-positive' : 'amount-zero'
  return { text, class: className }
}

/**
 * 格式化日期
 */
export function formatDate(date: string | Date | null | undefined, format = 'YYYY-MM-DD'): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''

  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

/** 账套启用日期默认值：当月 1 日 */
export function getAccountSetDefaultStartDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

/**
 * 格式化凭证号
 */
export function formatVoucherNo(
  typeCode: string | null | undefined,
  no: string | number | null | undefined
): string {
  if (!no) return ''
  const noStr = String(no).padStart(3, '0')
  return typeCode ? `${typeCode}-${noStr}` : noStr
}

/**
 * 格式化科目编码和名称
 */
export function formatAccount(code: string, name: string): string {
  return `${code} ${name}`
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0%'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0%'
  return `${num.toFixed(2)}%`
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/**
 * 截断文本
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}
