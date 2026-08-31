import { formatAmount } from '@/utils/format'

export interface AuxCategoryMismatchField {
  /** opening_debit / opening_credit / pre_book_debit / pre_book_credit */
  key: string
  /** 中文标签：期初借方 / 期初贷方 / 账前借方发生额 / 账前贷方发生额 */
  label: string
}

export interface AuxCategoryMismatchItem {
  account_code: string
  account_name: string
  message?: string
  categories: Array<{
    category_name: string
    init_balance: number
    /** 4 个分项的原始值（后端 AuxCategoryBalanceSummary） */
    opening_debit?: number
    opening_credit?: number
    pre_book_debit?: number
    pre_book_credit?: number
  }>
  /** 不一致的分项字段（4 个分项独立校验后填充） */
  mismatched_fields?: AuxCategoryMismatchField[]
}

export function calcAuxMismatchDifference(
  categories: Array<{ init_balance: number }>
): number {
  if (categories.length < 2) return 0
  const balances = categories.map(c => c.init_balance || 0)
  return Math.abs(Math.max(...balances) - Math.min(...balances))
}

function formatAuxAmount(value: number | undefined | null): string {
  const abs = Math.abs(Number(value) || 0)
  if (abs < 0.005) return '¥0'
  return `¥${formatAmount(abs)}`
}

/**
 * 优先按"不一致的分项"展示（用户能直接看到哪个字段不一致、各类目分别多少）；
 * 没有分项级信息时回退到净余额展示。
 */
export function formatAuxMismatchSummary(item: AuxCategoryMismatchItem): string {
  // 分项级差异：按"分项名 + 各类目值"列出
  if (item.mismatched_fields && item.mismatched_fields.length > 0) {
    const segments = item.mismatched_fields.map(field => {
      const cells = item.categories.map(c => {
        const value = (c as Record<string, any>)[field.key]
        return `「${c.category_name}」${formatAuxAmount(value)}`
      })
      return `${field.label}：${cells.join(' ≠ ')}`
    })
    return `${item.account_code} ${item.account_name}：${segments.join('；')}`
  }

  // 兜底：净余额展示
  const diff = calcAuxMismatchDifference(item.categories)
  const parts = item.categories.map(c => {
    return `「${c.category_name}」${formatAuxAmount(c.init_balance)}`
  })
  return `${item.account_code} ${item.account_name}：${parts.join(' ≠ ')}（差额 ¥${formatAmount(diff)}）`
}
