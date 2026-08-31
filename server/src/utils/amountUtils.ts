/**
 * 金额转换工具函数
 * 用于在元（REAL）和分（INTEGER）之间转换
 */

/**
 * 元转分：将浮点数金额转换为整数分
 *
 * FIX-019 / P2-30：增加 NaN / Infinity / 非数字防护。
 * 旧实现 `Math.round(NaN * 100) = NaN`，会被作为整数字段写入 DB，造成脏数据。
 * 现在异常输入统一返回 0（与 `validateVoucherEntryAmounts` 协同：上层会先拦截 0 元分录）。
 *
 * @param yuan 金额（元）
 * @returns 金额（分）；输入非有限数时返回 0
 */
export function yuanToCents(yuan: number): number {
  const v = Number(yuan)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100)
}

/**
 * 分转元：将整数分转换为浮点数金额
 * @param cents 金额（分）
 * @returns 金额（元）
 */
export function centsToYuan(cents: number): number {
  return cents / 100
}

/**
 * 格式化金额显示（保留两位小数）
 * @param cents 金额（分）
 * @returns 格式化后的金额字符串
 */
export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * 验证金额精度（检查是否为有效的分值）
 * @param cents 金额（分）
 * @returns 是否为整数
 */
export function isValidCents(cents: number): boolean {
  return Number.isInteger(cents)
}

/**
 * 批量转换：元数组转分数组
 * @param yuanArray 金额数组（元）
 * @returns 金额数组（分）
 */
export function batchYuanToCents(yuanArray: number[]): number[] {
  return yuanArray.map(yuanToCents)
}

/**
 * 批量转换：分数组转元数组
 * @param centsArray 金额数组（分）
 * @returns 金额数组（元）
 */
export function batchCentsToYuan(centsArray: number[]): number[] {
  return centsArray.map(centsToYuan)
}

/**
 * 安全的金额加法（避免浮点误差）
 * @param cents1 金额1（分）
 * @param cents2 金额2（分）
 * @returns 相加结果（分）
 */
export function addCents(cents1: number, cents2: number): number {
  return cents1 + cents2
}

/**
 * 安全的金额减法（避免浮点误差）
 * @param cents1 金额1（分）
 * @param cents2 金额2（分）
 * @returns 相减结果（分）
 */
export function subtractCents(cents1: number, cents2: number): number {
  return cents1 - cents2
}

/**
 * 金额求和（分）
 * @param centsArray 金额数组（分）
 * @returns 总和（分）
 */
export function sumCents(centsArray: number[]): number {
  return centsArray.reduce((sum, cents) => sum + cents, 0)
}

/**
 * 金额精度容差（元）：半个分，用于借贷平衡等比较
 * 中国会计实务中使用的标准精度
 */
export const MONEY_EPSILON = 0.005

// FIX-012 / P1-18：移除原 `amountsEqual(cents1, cents2)`
//
// 旧函数命名暗示"严格相等"但实现允许 1 分误差，存在被误用导致 1 分误差悄悄通过的风险。
// 财务实务中两个 cents 必须**严格相等**才能视为相等；如确需近似比较，应显式调用：
//   Math.abs(cents1 - cents2) <= someTolerance
// 并在调用处明确说明容差来源与业务理由。
//
// 调用方搜索（grep amountsEqual）：无引用，直接删除安全。
