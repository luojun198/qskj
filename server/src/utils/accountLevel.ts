/**
 * 科目编码级次推断（与账套 system_params.account_code_lengths 一致）
 */

export interface AccountCodeConfigLike {
  maxLevels: number
  codeLengths: number[]
}

/** 按编码长度精确匹配级次；长度不符合任一级累计长度时返回 null */
export function inferLevelByCodeLength(
  code: string,
  codeLengths: number[],
  maxLevels?: number
): number | null {
  const limit = maxLevels ?? codeLengths.length
  let expectedLength = 0
  for (let index = 0; index < limit; index++) {
    expectedLength += codeLengths[index] || 0
    if (code.length === expectedLength) return index + 1
  }
  return null
}

/** 根据级次截取直接上级科目编码 */
export function getParentCodeByLevel(code: string, level: number, codeLengths: number[]): string | null {
  if (level <= 1) return null
  let length = 0
  for (let i = 0; i < level - 1; i++) {
    length += codeLengths[i] || 0
  }
  return code.substring(0, length)
}

/** 在已有编码集合中，按最长前缀匹配直接上级编码（parent_id 缺失时的兜底） */
export function findDirectParentCodeByPrefix(code: string, allCodes: Iterable<string>): string | null {
  let best: string | null = null
  for (const parentCode of allCodes) {
    if (
      parentCode.length > 0 &&
      parentCode.length < code.length &&
      code.startsWith(parentCode) &&
      (!best || parentCode.length > best.length)
    ) {
      best = parentCode
    }
  }
  return best
}
