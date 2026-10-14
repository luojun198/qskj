/**
 * 编码规则模板 ⇄ 分段数组（供「多段编码编辑器」使用）。
 * 模板占位符与后端 server/src/services/scmNoRule.ts 一致：
 * {YYYY}{YY}{MM}{DD}{CODE}{SEQ:n}{F:字段key[:取前n位]}，其余字符为固定文字。
 */
export type NoSegType = 'text' | 'year4' | 'year2' | 'month' | 'day' | 'code' | 'seq' | 'field'

export interface NoSeg {
  id: number
  type: NoSegType
  /** text：固定文字 */
  text?: string
  /** seq：流水位数（1~10）；field：取前 n 位（0=全部） */
  len?: number
  /** field：业务字段 key */
  field?: string
}

let uid = 1
export const newSeg = (type: NoSegType, extra: Partial<NoSeg> = {}): NoSeg => ({ id: uid++, type, ...extra })

const TOKEN = /\{(YYYY|YY|MM|DD|CODE|SEQ(?::(\d+))?|F:([a-z_]+)(?::(\d+))?)\}/g

export function parseTpl(tpl: string): NoSeg[] {
  const src = String(tpl || '')
  const segs: NoSeg[] = []
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    if (m.index! > last) segs.push(newSeg('text', { text: src.slice(last, m.index) }))
    const t = m[1]
    if (t === 'YYYY') segs.push(newSeg('year4'))
    else if (t === 'YY') segs.push(newSeg('year2'))
    else if (t === 'MM') segs.push(newSeg('month'))
    else if (t === 'DD') segs.push(newSeg('day'))
    else if (t === 'CODE') segs.push(newSeg('code'))
    else if (t.startsWith('SEQ')) segs.push(newSeg('seq', { len: m[2] ? Math.min(10, Math.max(1, +m[2])) : 3 }))
    else segs.push(newSeg('field', { field: m[3], len: m[4] ? +m[4] : 0 }))
    last = m.index! + m[0].length
  }
  if (last < src.length) segs.push(newSeg('text', { text: src.slice(last) }))
  return segs
}

export function serializeTpl(segs: NoSeg[]): string {
  return segs.map(s => {
    switch (s.type) {
      case 'text': return s.text || ''
      case 'year4': return '{YYYY}'
      case 'year2': return '{YY}'
      case 'month': return '{MM}'
      case 'day': return '{DD}'
      case 'code': return '{CODE}'
      case 'seq': return `{SEQ:${Math.min(10, Math.max(1, s.len || 3))}}`
      case 'field': return s.field ? (s.len ? `{F:${s.field}:${s.len}}` : `{F:${s.field}}`) : ''
    }
  }).join('')
}

export interface PreviewOpts {
  code?: string
  /** 业务字段示例值 key → 值 */
  fieldSamples?: Record<string, string>
  date?: Date
  seq?: number
}

export function renderPreview(segs: NoSeg[], opts: PreviewOpts = {}): string {
  const d = opts.date || new Date()
  const yyyy = String(d.getFullYear())
  return segs.map(s => {
    switch (s.type) {
      case 'text': return s.text || ''
      case 'year4': return yyyy
      case 'year2': return yyyy.slice(2)
      case 'month': return String(d.getMonth() + 1).padStart(2, '0')
      case 'day': return String(d.getDate()).padStart(2, '0')
      case 'code': return opts.code ?? ''
      case 'seq': return String(opts.seq ?? 1).padStart(Math.min(10, Math.max(1, s.len || 3)), '0')
      case 'field': {
        const v = opts.fieldSamples?.[s.field || ''] ?? ''
        return s.len ? v.slice(0, s.len) : v
      }
    }
  }).join('')
}

/** 流水号重置口径：由日期段推导 */
export function resetHint(segs: NoSeg[]): string {
  const has = (t: NoSegType) => segs.some(s => s.type === t)
  if (has('day')) return '流水号每天从 1 重新开始'
  if (has('month')) return '流水号每月从 1 重新开始'
  if (has('year4') || has('year2')) return '流水号每年从 1 重新开始'
  return '流水号连续递增，不重置'
}

/** 校验：必须有且仅有一个流水号；业务字段段必须选了字段 */
export function validateSegs(segs: NoSeg[]): string {
  const n = segs.filter(s => s.type === 'seq').length
  if (n === 0) return '请添加一个「流水号」段'
  if (n > 1) return '流水号只能有一段'
  if (segs.some(s => s.type === 'field' && !s.field)) return '业务字段段请先选择字段'
  return ''
}

export const SEG_LABEL: Record<NoSegType, string> = {
  text: '固定文字', year4: '年(4位)', year2: '年(2位)', month: '月', day: '日',
  code: '单据类型代码', seq: '流水号', field: '业务字段',
}
