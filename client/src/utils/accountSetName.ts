/**
 * 从备份文件名智能解析账套名称。
 *
 * 润衡导出的 .acd 文件名形如「zw06广州东汇食品有限公司20260827.acd」：
 * 前面是 zwNN 业务前缀，后面直接跟 8 位备份日期，中间才是真正的单位名。
 * 直接拿文件名当账套名，账套列表和报表抬头里就会出现这一长串。
 *
 * 剥离规则与服务端 `server/src/services/reportUnitName.ts` 的
 * `stripAccountSetNameDecorations()` 保持一致，两边改动请同步。
 */

/** 结尾的 8 位日期（20260827），可带「(2)」这类重名副本后缀 */
const TRAILING_DATE = /(?:19|20)\d{6}(\(\d+\))?$/
/** 开头的 zwNN 型业务前缀：1-4 个字母紧跟 1-4 位数字 */
const LEADING_CODE = /^[a-zA-Z]{1,4}\d{1,4}/
/** CJK 字符：用于判断剥掉前缀后剩下的是不是中文单位名 */
const STARTS_WITH_CJK = /^[一-龥]/
/** 剥完只剩一个 zwNN 业务码，说明文件名里本来就没有单位名 */
const CODE_ONLY = /^[a-zA-Z]{1,4}\d{1,4}$/

export function parseAccountSetName(fileName: string): string {
  const original = String(fileName || '').trim()
  if (!original) return ''

  // 去除文件扩展名
  let name = original.replace(/\.(db|acd|sqlite|sqlite3)$/i, '')

  // 去除常见的前缀
  name = name.replace(/^(备份_|backup_|账套_|导出_|export_)/i, '')

  // 去除常见的后缀（日期时间戳等）
  name = name.replace(/[_-]\d{4}[-_]\d{2}[-_]\d{2}.*$/i, '') // 2025-01-01 或 2025_01_01
  name = name.replace(/[_-]\d{8,}$/i, '') // 时间戳 20250101 或更长
  name = name.replace(/[_-](backup|bak|copy|副本)$/i, '')

  // 紧贴在单位名后面、没有分隔符的备份日期：「…有限公司20260827」
  name = name.replace(TRAILING_DATE, '')

  // 开头的 zwNN 业务前缀。只有剥完剩下的是中文单位名时才剥，
  // 避免把「A1」这种本身就是名字一部分的编号误伤掉。
  const withoutCode = name.replace(LEADING_CODE, '')
  if (withoutCode !== name && STARTS_WITH_CJK.test(withoutCode)) {
    name = withoutCode
  }

  // 去除首尾的特殊字符和空格
  name = name.replace(/^[_\-\s]+|[_\-\s]+$/g, '')

  // 将下划线和连字符替换为空格
  name = name.replace(/[_-]/g, ' ')

  name = name.trim()

  // 剥成空的、只剩数字、或只剩一个业务码，说明这文件名里本就没有单位名，退回去掉扩展名的原样
  if (!name || /^\d+$/.test(name) || CODE_ONLY.test(name)) {
    name = original.replace(/\.(db|acd|sqlite|sqlite3)$/i, '').trim()
  }

  // 限制长度
  return name.length > 50 ? name.substring(0, 50) : name
}
