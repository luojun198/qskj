/** 与 server/src/services/baseValidation.ts 保持同步（导入文本规范化） */

const PUNCTUATION_MAP: Record<string, string> = {
  '\u2014\u2014': '--',
  '\uff0c': ',',
  '\u3002': '.',
  '\uff1b': ';',
  '\uff1a': ':',
  '\uff08': '(',
  '\uff09': ')',
  '\u3010': '[',
  '\u3011': ']',
  '\uff5b': '{',
  '\uff5d': '}',
  '\u300c': '"',
  '\u300d': '"',
  '\u201c': '"',
  '\u201d': '"',
  '\u2018': "'",
  '\u2019': "'",
  '\u300a': '<',
  '\u300b': '>',
  '\uff01': '!',
  '\uff1f': '?',
  '\u3001': ',',
  '\u2014': '-',
  '\uff0d': '-',
  '\uff5e': '~',
}

const PUNCTUATION_PATTERN =
  /\u2014\u2014|[\uff0c\u3002\uff1b\uff1a\uff08\uff09\u3010\u3011\uff5b\uff5d\u300c\u300d\u201c\u201d\u2018\u2019\u300a\u300b\uff01\uff1f\u3001\u2014\uff0d\uff5e]/g

/** 全角 ASCII 块 → 半角（数字、字母、括号等） */
function normalizeFullWidthAscii(value: string): string {
  return value.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/** 全角标点等规范为半角 */
export function normalizePunctuation(value: string): string {
  return value.replace(PUNCTUATION_PATTERN, match => PUNCTUATION_MAP[match] ?? match)
}

/**
 * 导入名称/备注等文本：半角化 + 压连续空白
 * 入库与第一级精确匹配使用
 */
export function normalizeImportText(value: string): string {
  let s = String(value ?? '').trim()
  if (!s) return ''
  s = normalizeFullWidthAscii(s)
  s = normalizePunctuation(s)
  s = s.replace(/\u3000/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** 导入编码：半角化 + 去掉全部空白 */
export function normalizeImportCode(value: string): string {
  return normalizeImportText(value).replace(/\s+/g, '')
}

/** Excel 单元格 → 导入文本 */
export function normalizeImportCell(value: unknown): string {
  return normalizeImportText(String(value ?? ''))
}

/** Excel 单元格 → 导入编码 */
export function normalizeImportCodeCell(value: unknown): string {
  return normalizeImportCode(String(value ?? ''))
}

/** 去标点空白后的小写键，用于名称去重与模糊匹配（忽略空格差异） */
export function normalizeDuplicateKey(value: string): string {
  return normalizeImportText(value)
    .replace(/[\s,.;:()\[\]{}"'<>?!~\-]/g, '')
    .toLowerCase()
}

/** 名称是否匹配：精确（压空格后）或忽略空格/标点 */
export function namesMatchForImport(a: string, b: string): boolean {
  const na = normalizeImportText(a)
  const nb = normalizeImportText(b)
  if (na && nb && na === nb) return true
  const ka = normalizeDuplicateKey(a)
  const kb = normalizeDuplicateKey(b)
  return !!ka && ka === kb
}
