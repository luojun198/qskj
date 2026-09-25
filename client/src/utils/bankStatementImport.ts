/**
 * 银行对账单导入（任意 Excel + 自定义列映射）的纯函数工具：
 * 表头识别、列自动匹配、金额 / 日期规范化、已保存映射按表头名回填。
 */

export type AmountMode = 'dc' | 'single'

export type StatementField =
  | 'biz_date' | 'debit' | 'credit' | 'amount' | 'direction'
  | 'summary' | 'counter_name' | 'counter_account' | 'balance' | 'bill_no' | 'settle_type'

export type StatementMapping = Partial<Record<StatementField, number | undefined>>

export interface ImportProfile {
  sheet_name?: string
  header_row?: number
  data_start_row?: number
  /** 旧协议字段 */
  skip_rows?: number
  amount_mode?: AmountMode
  mapping?: Record<string, number | undefined>
  direction_in_values?: string[]
  /** 保存时的表头文字（按列索引），用于下次按名回填 */
  header_labels?: string[]
}

/** 本地字段定义（顺序即映射面板顺序） */
export const FIELD_DEFS: Array<{ key: StatementField; label: string; mode?: AmountMode; required?: boolean; hint?: string }> = [
  { key: 'biz_date', label: '交易日期', required: true },
  { key: 'debit', label: '借方（收入）', mode: 'dc', hint: '银行流水常叫「贷方发生额 / 收入金额」' },
  { key: 'credit', label: '贷方（支出）', mode: 'dc', hint: '银行流水常叫「借方发生额 / 支出金额」' },
  { key: 'amount', label: '交易金额', mode: 'single', required: true },
  { key: 'direction', label: '方向标志', mode: 'single', hint: '不选则按金额正负号判断' },
  { key: 'summary', label: '摘要' },
  { key: 'counter_name', label: '对方户名' },
  { key: 'counter_account', label: '对方账号' },
  { key: 'balance', label: '余额' },
  { key: 'bill_no', label: '票据号' },
  { key: 'settle_type', label: '结算方式' },
]

/** 默认视为「收入」的方向标志值 */
export const DEFAULT_IN_FLAGS = ['收', '收入', '贷', '贷方', 'C', 'CR', '+', '入', '转入', '来账']

/** 列索引 → Excel 列号（A、B … Z、AA、AB …） */
export function colLabel(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/**
 * 表头文字 → 本地字段。关键词有先后：
 * 银行流水里「贷方发生额」= 客户收入、「借方发生额」= 客户支出，故先按「借/贷」字面匹配，再看「收/支」。
 */
export function matchStatementField(label: unknown): StatementField | null {
  const s = String(label ?? '').replace(/\s/g, '')
  if (!s) return null
  if (/日期|交易日|时间/.test(s)) return 'biz_date'
  if (/余额/.test(s)) return 'balance'
  if (/借贷标志|收付标志|借贷方向|收付方向|借贷标识|收付标识|方向|标志/.test(s)) return 'direction'
  if (/对方户名|对方名称|对方单位|对手方名称|收付款人|付款人|收款人|往来单位|对方账户名/.test(s)) return 'counter_name'
  if (/对方账号|对方账户|对方帐号|对手方账号|收付款账号/.test(s)) return 'counter_account'
  if (/摘要|用途|附言|备注|交易描述|说明/.test(s)) return 'summary'
  if (/票据|凭证号|凭证编号|流水号|交易序号|参考号/.test(s)) return 'bill_no'
  if (/结算方式|结算|交易类型|业务类型|交易方式/.test(s)) return 'settle_type'
  // 对账单是银行视角：贷方 = 收入（本方借方）
  if (/贷方|贷记|贷/.test(s)) return 'debit'
  if (/借方|借记|借/.test(s)) return 'credit'
  if (/收入|存入|转入|收款/.test(s)) return 'debit'
  if (/支出|支取|转出|付款/.test(s)) return 'credit'
  if (/金额|发生额/.test(s)) return 'amount'
  return null
}

/**
 * 映射来源：exact = 表头与字段名 / 无歧义别名完全一致；smart = 关键词或字面相似度推测（需人工确认）；
 * profile = 按该科目上次保存的映射回填；manual = 用户手选或已确认
 */
export type MatchSource = 'exact' | 'smart' | 'profile' | 'manual'

/**
 * 各字段的标准叫法：表头完全等于其中之一视为精确匹配，同时作为字面相似度的比对对象。
 * 「借方发生额 / 贷方发生额」涉及银行视角借贷反转，故意不放进来，仍走关键词推测并要求确认。
 */
export const FIELD_ALIASES: Record<StatementField, string[]> = {
  biz_date: ['交易日期', '日期', '记账日期', '入账日期', '交易时间'],
  debit: ['借方（收入）', '收入', '收入金额', '存入金额'],
  credit: ['贷方（支出）', '支出', '支出金额', '支取金额'],
  amount: ['交易金额', '金额', '发生额'],
  direction: ['方向标志', '借贷标志', '收付标志', '借贷方向', '收支标志'],
  summary: ['摘要', '用途', '附言', '备注'],
  counter_name: ['对方户名', '对方名称', '对方账户名'],
  counter_account: ['对方账号', '对方账户'],
  balance: ['余额', '账户余额'],
  bill_no: ['票据号', '流水号', '凭证号'],
  settle_type: ['结算方式', '交易类型'],
}

const normHeader = (v: unknown) => String(v ?? '').replace(/[\s:：*]/g, '')
/** 相似度比较前再去掉括号内容、金额单位，统一「帐 / 账」 */
const normFuzzy = (v: unknown) =>
  normHeader(v).replace(/[（(【\[].*?[）)】\]]/g, '').replace(/人民币|RMB|元$/gi, '').replace(/帐/g, '账')

/** 字面相似度（字符多重集 Dice 系数，0~1），与字序无关，适合「交易额 ≈ 交易金额」这类中文缩写 */
export function similarity(a: unknown, b: unknown): number {
  const x = [...normFuzzy(a)]
  const y = [...normFuzzy(b)]
  if (!x.length || !y.length) return 0
  const pool = new Map<string, number>()
  y.forEach(c => pool.set(c, (pool.get(c) || 0) + 1))
  let common = 0
  for (const c of x) {
    const n = pool.get(c) || 0
    if (n > 0) { common++; pool.set(c, n - 1) }
  }
  return (2 * common) / (x.length + y.length)
}

/** 字面相似度达到该值才作为智能匹配候选 */
export const SIMILARITY_THRESHOLD = 0.6

/**
 * 按表头行智能匹配：精确 > 关键词 > 字面相似度，按得分从高到低贪心分配，保证一字段一列、一列一字段。
 * 返回映射及每个字段的来源（exact / smart）。
 */
export function smartMapByHeader(headerRow: unknown[]): { mapping: StatementMapping; sources: Partial<Record<StatementField, MatchSource>> } {
  const cands: Array<{ col: number; field: StatementField; score: number; exact: boolean }> = []
  const fields = Object.keys(FIELD_ALIASES) as StatementField[]
  headerRow.forEach((cell, col) => {
    const s = normHeader(cell)
    if (!s) return
    const exact = fields.find(f => FIELD_ALIASES[f].some(a => normHeader(a) === s))
    if (exact) return cands.push({ col, field: exact, score: 3, exact: true })
    const kw = matchStatementField(cell)
    if (kw) return cands.push({ col, field: kw, score: 2, exact: false })
    for (const f of fields) {
      const sim = Math.max(...FIELD_ALIASES[f].map(a => similarity(cell, a)))
      if (sim >= SIMILARITY_THRESHOLD) cands.push({ col, field: f, score: sim, exact: false })
    }
  })
  cands.sort((a, b) => b.score - a.score || a.col - b.col)
  const mapping: StatementMapping = {}
  const sources: Partial<Record<StatementField, MatchSource>> = {}
  const usedCols = new Set<number>()
  for (const c of cands) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue
    mapping[c.field] = c.col
    sources[c.field] = c.exact ? 'exact' : 'smart'
    usedCols.add(c.col)
  }
  return { mapping, sources }
}

/** 按表头行自动匹配所有列（一字段一列） */
export function autoMapByHeader(headerRow: unknown[]): StatementMapping {
  return smartMapByHeader(headerRow).mapping
}

/** 根据映射判断金额模式：有借 / 贷列用 dc，否则有金额列用 single */
export function inferAmountMode(m: StatementMapping): AmountMode {
  if (m.debit !== undefined || m.credit !== undefined) return 'dc'
  if (m.amount !== undefined) return 'single'
  return 'dc'
}

/**
 * 在前若干行里找表头行：含日期列且含金额类列（借 / 贷 / 金额）的第一行。
 * 找不到返回 -1。
 */
export function guessHeaderRow(rows: unknown[][], maxScan = 20): number {
  for (let r = 0; r < Math.min(maxScan, rows.length); r++) {
    const m = autoMapByHeader(rows[r] || [])
    if (m.biz_date !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined)) return r
  }
  return -1
}

/** 银行流水末尾常见的合计 / 小计行（日期列是文字），预览与导入都跳过 */
export function isTotalRowText(v: unknown): boolean {
  return /合计|小计|总计|共计/.test(String(v ?? ''))
}

/** 是否已是 YYYY-MM-DD 规整日期 */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** 金额解析：去千分位逗号 / 空白 / 货币符号 */
export function parseAmount(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = parseFloat(String(v).replace(/[,，\s¥￥]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 日期规范化为 YYYY-MM-DD（含 Excel 序列号）；无法识别返回原字符串 */
export function normExcelDate(v: unknown): string {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial >= 61 && serial <= 2958465) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000))
      const y = dt.getUTCFullYear(), mm = String(dt.getUTCMonth() + 1).padStart(2, '0'), dd = String(dt.getUTCDate()).padStart(2, '0')
      return `${y}-${mm}-${dd}`
    }
  }
  return s
}

/**
 * 把已保存的映射套到新文件上：
 * - 保存时带有表头文字且新文件也有表头：只按表头名定位同名列（列序变了也能对上；对不上的字段留空交给自动识别）；
 * - 否则（旧配置无表头文字 / 新文件无表头）：退回保存的列索引（须在范围内）。
 */
export function applyProfile(profile: ImportProfile, headerRow: unknown[] | null, colCount: number): StatementMapping {
  const saved = profile.mapping || {}
  const labels = profile.header_labels || []
  const names = (headerRow || []).map(c => String(c ?? '').trim())
  const byName = labels.some(Boolean) && names.some(Boolean)
  const out: StatementMapping = {}
  for (const [field, idxRaw] of Object.entries(saved)) {
    if (idxRaw === undefined || idxRaw === null) continue
    const idx = Number(idxRaw)
    if (!Number.isFinite(idx) || idx < 0) continue
    let target = -1
    if (byName) {
      const savedName = String(labels[idx] ?? '').trim()
      if (savedName) target = names.indexOf(savedName)
    } else if (idx < colCount) {
      target = idx
    }
    if (target >= 0) out[field as StatementField] = target
  }
  return out
}

/**
 * 已保存方案与当前表头的吻合度：方案里每个已映射字段都能按表头名找到同名列时返回命中字段数，否则 0。
 * 方案没有表头文字（无法按名比对）也返回 0，不参与自动套用。
 */
export function schemeFitScore(profile: ImportProfile, headerRow: unknown[] | null): number {
  const labels = profile.header_labels || []
  if (!headerRow || !labels.some(Boolean)) return 0
  const wanted = Object.values(profile.mapping || {})
    .filter(v => v !== undefined && v !== null && String(labels[Number(v)] ?? '').trim())
  if (!wanted.length) return 0
  const hit = Object.keys(applyProfile(profile, headerRow, headerRow.length)).length
  return hit === wanted.length ? hit : 0
}

/** 单行按映射转换为规整记录（预览用，与服务端规则一致） */
export function convertRow(
  row: unknown[],
  mapping: StatementMapping,
  mode: AmountMode,
  inFlags: string[]
): { biz_date: string; summary: string; debit: number; credit: number; balance: number | null; counter_name: string } {
  const get = (f: StatementField) => (mapping[f] === undefined ? undefined : row[mapping[f] as number])
  const txt = (f: StatementField) => String(get(f) ?? '').trim()
  let debit = 0
  let credit = 0
  if (mode === 'dc') {
    debit = parseAmount(get('debit'))
    credit = parseAmount(get('credit'))
  } else {
    const amount = parseAmount(get('amount'))
    if (mapping.direction !== undefined) {
      if (inFlags.includes(txt('direction'))) debit = Math.abs(amount)
      else credit = Math.abs(amount)
    } else if (amount >= 0) debit = amount
    else credit = -amount
  }
  const balRaw = get('balance')
  return {
    biz_date: normExcelDate(get('biz_date')),
    summary: txt('summary'),
    debit,
    credit,
    balance: balRaw === undefined || String(balRaw).trim() === '' ? null : parseAmount(balRaw),
    counter_name: txt('counter_name'),
  }
}
