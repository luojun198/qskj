export type VoucherTypeSortKey = [numericRank: number, numericValue: number, text: string]

const NUMERIC_CODE_RE = /^\d+$/

/** 与 baseVoucherType / voucherQuery 凭证类型 ORDER BY 语义一致 */
export function getVoucherTypeSortKey(code?: string | null): VoucherTypeSortKey {
  const normalized = String(code ?? '').trim()
  if (!normalized) {
    return [2, Number.MAX_SAFE_INTEGER, '']
  }
  if (NUMERIC_CODE_RE.test(normalized)) {
    return [0, parseInt(normalized, 10), normalized]
  }
  return [1, Number.MAX_SAFE_INTEGER, normalized.toLowerCase()]
}

export function compareVoucherTypeCode(a?: string | null, b?: string | null): number {
  const keyA = getVoucherTypeSortKey(a)
  const keyB = getVoucherTypeSortKey(b)
  for (let i = 0; i < keyA.length; i += 1) {
    if (keyA[i] < keyB[i]) return -1
    if (keyA[i] > keyB[i]) return 1
  }
  return 0
}
