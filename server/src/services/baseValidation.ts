// 基础设置通用校验和工具函数
// normalizeImport* 与 client/src/utils/textNormalize.ts 保持同步

type SqlParam = string | number

export function buildWhereClause(conditions: string[]) {
  if (conditions.length === 0) {
    return ''
  }

  return ` WHERE ${conditions.join(' AND ')}`
}

const punctuationMap: Record<string, string> = {
  '——': '--',
  '，': ',',
  '。': '.',
  '；': ';',
  '：': ':',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '｛': '{',
  '｝': '}',
  '\u201C': '"',
  '\u201D': '"',
  '\u2018': "'",
  '\u2019': "'",
  '《': '<',
  '》': '>',
  '？': '?',
  '！': '!',
  '、': ',',
  '—': '-',
  '－': '-',
  '～': '~',
}

function normalizeFullWidthAscii(value: string): string {
  return value.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

export function normalizePunctuation(value: string) {
  return value.replace(/——|[，。；：（）【】｛｝""''《》？！、—－～]/g, match => punctuationMap[match] ?? match)
}

export function normalizeImportText(value: string): string {
  let s = String(value ?? '').trim()
  if (!s) return ''
  s = normalizeFullWidthAscii(s)
  s = normalizePunctuation(s)
  s = s.replace(/\u3000/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

export function normalizeImportCode(value: string): string {
  return normalizeImportText(value).replace(/\s+/g, '')
}

export function normalizeDuplicateKey(value: string) {
  return normalizeImportText(value)
    .replace(/[\s,.;:()\[\]{}"'<>?!~\-]/g, '')
    .toLowerCase()
}

export type { SqlParam }
