import type Database from 'better-sqlite3'

/**
 * 订单列表「关联单号」（客户反馈：参照金蝶采购订单序时簿的「关联入库单号」）。
 *
 * - 采购订单 PO → 关联入库单（PI）+ 核销了这些入库单的付款单（PAY）
 * - 销售订单 SOa → 关联出库单（SO）+ 核销了这些出库单的收款单（RCV）
 *
 * 下游关联两种口径都要认：明细行 source_line_id 直接指向订单行；
 * 合并下推时 source_line_id 为空、来源写在 field_values.source_line_allocations。
 * 只按当前页订单批量查询，避免列表 N+1。
 */
export interface LinkedDocRef {
  id: string
  doc_no: string
  doc_type: string
  status: string
}

export interface OrderLinkedDocs {
  linked_docs: LinkedDocRef[]
  linked_payments: LinkedDocRef[]
}

const CHILD_TYPE: Record<string, string> = { PO: 'PI', SOa: 'SO' }
const PAYMENT_TYPE: Record<string, string> = { PO: 'PAY', SOa: 'RCV' }

function allocationSourceIds(fieldValues: unknown): string[] {
  if (!fieldValues) return []
  try {
    const values = typeof fieldValues === 'string' ? JSON.parse(fieldValues) : fieldValues
    const allocations = (values as any)?.source_line_allocations
    if (!Array.isArray(allocations)) return []
    return allocations.map(a => String(a?.source_line_id || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

const byDocNo = (a: LinkedDocRef, b: LinkedDocRef) => a.doc_no.localeCompare(b.doc_no, 'zh-CN')

export function getOrderLinkedDocs(
  db: Database.Database,
  accountSetId: string,
  orders: Array<{ id: string; doc_type: string }>,
): Map<string, OrderLinkedDocs> {
  const result = new Map<string, OrderLinkedDocs>()
  for (const orderType of Object.keys(CHILD_TYPE)) {
    const orderIds = orders.filter(o => o.doc_type === orderType).map(o => o.id)
    if (!orderIds.length) continue
    for (const id of orderIds) result.set(id, { linked_docs: [], linked_payments: [] })
    const childType = CHILD_TYPE[orderType]

    // 订单行 → 订单
    const ph = orderIds.map(() => '?').join(',')
    const orderLines = db.prepare(`SELECT id, doc_id FROM scm_doc_line WHERE account_set_id=? AND doc_id IN (${ph})`)
      .all(accountSetId, ...orderIds) as Array<{ id: string; doc_id: string }>
    if (!orderLines.length) continue
    const orderOfLine = new Map(orderLines.map(l => [l.id, l.doc_id]))
    const lineIds = [...orderOfLine.keys()]

    // 下游单 → 订单集合
    const childDocs = new Map<string, LinkedDocRef>()
    const ordersOfChild = new Map<string, Set<string>>()
    const link = (child: LinkedDocRef, sourceLineId: string) => {
      const orderId = orderOfLine.get(sourceLineId)
      if (!orderId) return
      childDocs.set(child.id, child)
      if (!ordersOfChild.has(child.id)) ordersOfChild.set(child.id, new Set())
      ordersOfChild.get(child.id)!.add(orderId)
    }
    // 1) 直接引用（分批 IN，避免超出 SQLite 变量上限）
    for (let i = 0; i < lineIds.length; i += 500) {
      const chunk = lineIds.slice(i, i + 500)
      const rows = db.prepare(`SELECT DISTINCT l.source_line_id, d.id, d.doc_no, d.doc_type, d.status
        FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
        WHERE d.account_set_id=? AND d.doc_type=? AND d.status<>'voided' AND l.source_line_id IN (${chunk.map(() => '?').join(',')})`)
        .all(accountSetId, childType, ...chunk) as any[]
      for (const r of rows) link({ id: r.id, doc_no: r.doc_no, doc_type: r.doc_type, status: r.status }, r.source_line_id)
    }
    // 2) 合并下推（source_line_allocations）
    const allocRows = db.prepare(`SELECT l.field_values, d.id, d.doc_no, d.doc_type, d.status
      FROM scm_doc_line l JOIN scm_doc d ON d.id=l.doc_id
      WHERE d.account_set_id=? AND d.doc_type=? AND d.status<>'voided'
        AND l.source_line_id IS NULL AND l.field_values LIKE '%source_line_allocations%'`)
      .all(accountSetId, childType) as any[]
    for (const r of allocRows) {
      for (const sid of allocationSourceIds(r.field_values)) link({ id: r.id, doc_no: r.doc_no, doc_type: r.doc_type, status: r.status }, sid)
    }
    for (const [childId, orderSet] of ordersOfChild) {
      for (const orderId of orderSet) result.get(orderId)!.linked_docs.push(childDocs.get(childId)!)
    }

    // 3) 收付款：核销了这些下游单往来台账的收款 / 付款单
    const childNos = [...childDocs.values()].map(c => c.doc_no)
    if (!childNos.length) continue
    const childIdByNo = new Map([...childDocs.values()].map(c => [c.doc_no, c.id]))
    const paymentsOfChild = new Map<string, Map<string, LinkedDocRef>>()
    for (let i = 0; i < childNos.length; i += 500) {
      const chunk = childNos.slice(i, i + 500)
      const rows = db.prepare(`SELECT DISTINCT li.doc_no AS child_no, pd.id, pd.doc_no, pd.doc_type, pd.status
        FROM scm_ar_ap_log li
        JOIN scm_ar_ap_verify v ON v.in_log_id=li.id
        JOIN scm_ar_ap_log lo ON lo.id=v.out_log_id
        JOIN scm_doc pd ON pd.account_set_id=lo.account_set_id AND pd.doc_type=lo.doc_type AND pd.doc_no=lo.doc_no
        WHERE li.account_set_id=? AND li.doc_type=? AND lo.doc_type=? AND li.doc_no IN (${chunk.map(() => '?').join(',')})`)
        .all(accountSetId, childType, PAYMENT_TYPE[orderType], ...chunk) as any[]
      for (const r of rows) {
        const childId = childIdByNo.get(r.child_no)
        if (!childId) continue
        if (!paymentsOfChild.has(childId)) paymentsOfChild.set(childId, new Map())
        paymentsOfChild.get(childId)!.set(r.id, { id: r.id, doc_no: r.doc_no, doc_type: r.doc_type, status: r.status })
      }
    }
    for (const [childId, orderSet] of ordersOfChild) {
      const pays = paymentsOfChild.get(childId)
      if (!pays) continue
      for (const orderId of orderSet) {
        const target = result.get(orderId)!.linked_payments
        for (const p of pays.values()) if (!target.some(t => t.id === p.id)) target.push(p)
      }
    }
  }
  for (const v of result.values()) { v.linked_docs.sort(byDocNo); v.linked_payments.sort(byDocNo) }
  return result
}

/**
 * 收付款单列表「核销信息 / 关联单据」：已核销、未核销（原币，与单据金额同口径）、核销单号、
 * 以及与之核销的对方单据（收款单所选应收源单 / 预收被哪些单据消耗）。
 * 只按当前页收付款单批量查询（台账 + 核销表各一次分块 IN），避免列表 N+1。
 * 草稿 / 已反审核的单据没有台账行，返回 null 金额。
 */
export interface PaymentVerifyInfo {
  verified_amount: number | null
  unverified_amount: number | null
  currency: string
  verify_nos: string[]
  pay_linked_docs: LinkedDocRef[]
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function getPaymentVerifyInfo(
  db: Database.Database,
  accountSetId: string,
  docs: Array<{ id: string; doc_type: string; doc_no: string }>,
): Map<string, PaymentVerifyInfo> {
  const result = new Map<string, PaymentVerifyInfo>()
  const pays = docs.filter(d => d.doc_type === 'RCV' || d.doc_type === 'PAY')
  for (const d of pays) result.set(d.id, { verified_amount: null, unverified_amount: null, currency: '', verify_nos: [], pay_linked_docs: [] })
  if (!pays.length) return result
  const idOf = new Map(pays.map(d => [`${d.doc_type}|${d.doc_no}`, d.id]))
  const nos = [...new Set(pays.map(d => d.doc_no))]

  const logOwner = new Map<string, string>() // out_log_id → 收付款单 id
  for (let i = 0; i < nos.length; i += 500) {
    const chunk = nos.slice(i, i + 500)
    const rows = db.prepare(`SELECT id, doc_type, doc_no, currency,
        COALESCE(amount_fc, amount) AS amt, COALESCE(verified_fc, verified_amount) AS ver
      FROM scm_ar_ap_log
      WHERE account_set_id=? AND direction='out' AND doc_type IN ('RCV','PAY') AND doc_no IN (${chunk.map(() => '?').join(',')})`)
      .all(accountSetId, ...chunk) as any[]
    for (const r of rows) {
      const docId = idOf.get(`${r.doc_type}|${r.doc_no}`)
      if (!docId) continue
      const info = result.get(docId)!
      logOwner.set(r.id, docId)
      info.verified_amount = r2((info.verified_amount || 0) + r.ver)
      info.unverified_amount = r2((info.unverified_amount || 0) + r.amt - r.ver)
      if (!info.currency && r.currency) info.currency = r.currency
    }
  }

  const logIds = [...logOwner.keys()]
  for (let i = 0; i < logIds.length; i += 500) {
    const chunk = logIds.slice(i, i + 500)
    const rows = db.prepare(`SELECT v.out_log_id, v.verify_no, li.doc_type AS in_type, li.doc_no AS in_no, d.id AS in_id, d.status AS in_status
      FROM scm_ar_ap_verify v
      JOIN scm_ar_ap_log li ON li.id=v.in_log_id
      LEFT JOIN scm_doc d ON d.account_set_id=li.account_set_id AND d.doc_type=li.doc_type AND d.doc_no=li.doc_no
      WHERE v.account_set_id=? AND v.out_log_id IN (${chunk.map(() => '?').join(',')})
      ORDER BY v.verify_no`).all(accountSetId, ...chunk) as any[]
    for (const r of rows) {
      const info = result.get(logOwner.get(r.out_log_id)!)!
      if (!info.verify_nos.includes(r.verify_no)) info.verify_nos.push(r.verify_no)
      if (r.in_id && !info.pay_linked_docs.some(x => x.id === r.in_id)) {
        info.pay_linked_docs.push({ id: r.in_id, doc_no: r.in_no, doc_type: r.in_type, status: r.in_status })
      }
    }
  }
  for (const v of result.values()) v.pay_linked_docs.sort(byDocNo)
  return result
}
