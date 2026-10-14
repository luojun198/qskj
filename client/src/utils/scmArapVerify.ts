export interface ArapVerifyRow {
  id: string
  open_amount: number
}

export interface ArapPartnerLike {
  partner_type?: string
}

export const roundArapAmount = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function sumArapOpenAmount(rows: ArapVerifyRow[]) {
  return roundArapAmount(rows.reduce((total, row) => total + Math.max(0, Number(row.open_amount) || 0), 0))
}

/** 按列表顺序分配目标核销额，最后一笔自动取部分金额，使合计精确找平。 */
export function allocateArapAmount(rows: ArapVerifyRow[], targetAmount: number) {
  const result: Record<string, number> = {}
  let remaining = Math.min(Math.max(0, roundArapAmount(targetAmount)), sumArapOpenAmount(rows))

  for (const row of rows) {
    const amount = Math.min(Math.max(0, Number(row.open_amount) || 0), remaining)
    result[row.id] = roundArapAmount(amount)
    remaining = roundArapAmount(remaining - amount)
  }

  return result
}

export interface ArapAutoMatchRow extends ArapVerifyRow {
  currency?: string | null
  due_date?: string | null
  doc_date?: string | null
  created_at?: string | null
}

export interface ArapMatch { in_log_id: string; out_log_id: string; amount: number }

export interface ArapAutoMatchResult {
  matches: ArapMatch[]
  inAmounts: Record<string, number>
  outAmounts: Record<string, number>
  total: number
}

const dateKey = (...vals: Array<string | null | undefined>) => vals.map(v => String(v || '')).join('|')

/**
 * 自动勾稽：同币别内先把金额完全相等的应收应付 / 收付款一对一配对，
 * 剩余按日期从早到晚先进先出冲抵（最后一笔可部分核销）。只生成预览，由用户确认后提交。
 */
export function autoMatchArap(inRows: ArapAutoMatchRow[], outRows: ArapAutoMatchRow[]): ArapAutoMatchResult {
  const matches: ArapMatch[] = []
  const inAmounts: Record<string, number> = {}
  const outAmounts: Record<string, number> = {}
  const add = (inId: string, outId: string, amount: number) => {
    const amt = roundArapAmount(amount)
    if (amt <= 0.005) return
    matches.push({ in_log_id: inId, out_log_id: outId, amount: amt })
    inAmounts[inId] = roundArapAmount((inAmounts[inId] || 0) + amt)
    outAmounts[outId] = roundArapAmount((outAmounts[outId] || 0) + amt)
  }
  const open = (r: ArapAutoMatchRow) => roundArapAmount(r.open_amount)
  const ins = inRows.filter(r => open(r) > 0.005)
    .sort((a, b) => dateKey(a.due_date || a.doc_date, a.created_at).localeCompare(dateKey(b.due_date || b.doc_date, b.created_at)))
  const outs = outRows.filter(r => open(r) > 0.005)
    .sort((a, b) => dateKey(a.doc_date, a.created_at).localeCompare(dateKey(b.doc_date, b.created_at)))

  const currencies = new Set(ins.map(r => r.currency || ''))
  for (const cur of currencies) {
    const ci = ins.filter(r => (r.currency || '') === cur).map(r => ({ id: r.id, left: open(r) }))
    const co = outs.filter(r => (r.currency || '') === cur).map(r => ({ id: r.id, left: open(r) }))
    if (!co.length) continue
    // 第一轮：金额相等一对一
    for (const i of ci) {
      const o = co.find(x => x.left > 0.005 && Math.abs(x.left - i.left) <= 0.005)
      if (!o) continue
      add(i.id, o.id, i.left)
      i.left = 0; o.left = 0
    }
    // 第二轮：先进先出
    let j = 0
    for (const i of ci) {
      while (i.left > 0.005 && j < co.length) {
        const o = co[j]
        if (o.left <= 0.005) { j++; continue }
        const m = roundArapAmount(Math.min(i.left, o.left))
        add(i.id, o.id, m)
        i.left = roundArapAmount(i.left - m); o.left = roundArapAmount(o.left - m)
      }
    }
  }
  return { matches, inAmounts, outAmounts, total: roundArapAmount(matches.reduce((s, m) => s + m.amount, 0)) }
}

export function arapPartnerRole(partner: ArapPartnerLike): 'customer' | 'supplier' | 'both' {
  const type = String(partner?.partner_type || '').trim().toLowerCase()
  if (!type || type === 'both' || type === '双向' || type === '3') return 'both'
  if (/customer|客户|^1$/.test(type)) return 'customer'
  if (/supplier|供应|^2$/.test(type)) return 'supplier'
  return 'both'
}

export function partnerMatchesArapSide(partner: ArapPartnerLike, side: 'ar' | 'ap') {
  const role = arapPartnerRole(partner)
  return role === 'both' || role === (side === 'ar' ? 'customer' : 'supplier')
}
