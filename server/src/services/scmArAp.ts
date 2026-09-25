/**
 * 供应链往来/收付款 & 出纳联动服务（P4）
 *
 * 收付款单（PAY/RCV）审核时：写入往来台账、生成出纳日记账。
 * 销售发货（SO）/ 采购入库（PI）审核时：按**价税合计**挂应收/应付暂估，
 *   口径与凭证的应收/应付分录一致——不含税挂账会让总账余额与往来余额差一个税额，
 *   且含税收款永远核销不平。
 * 采购/销售发票（RP/RS）审核时：有来源单据的校正该单暂估额（不新增，避免双计），
 *   独立录入的新挂一条。见 applyInvoice / reverseInvoice。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { assertCashierPeriodOpen, normalizeBizDate, parseBizDate } from './cashierPeriodClosing.js'
import { assertGlPeriodOpen } from './voucherMutationGuard.js'
import { lookupCashierAccountCurrency, getCashierBaseCurrency, normalizeCashierCurrency } from './cashierQuery.js'
import { docExchangeRate, getScmBaseCurrency, isScmBaseCurrency, normalizeScmCurrency, toBase } from './scmCurrency.js'

/**
 * 多币种双轨（P2-14）：台账行的币别 / 汇率 / 原币金额。
 * 本位币单据：currency=本位币、rate=1、amount_fc=amount；外币单据：amount = amount_fc × rate。
 */
function logCurrency(db: Database.Database, accountSetId: string, doc: any): { currency: string; rate: number } {
  const rate = docExchangeRate(db, accountSetId, doc)
  const currency = isScmBaseCurrency(db, accountSetId, doc?.currency) ? getScmBaseCurrency(db, accountSetId) : normalizeScmCurrency(doc.currency)
  return { currency, rate }
}

/**
 * 在台账行上累加已核销原币额，本位币已核销额按该行**当前汇率**增量折算（期末重估后汇率即期末汇率）；
 * 原币核销完时本位币已核销额 = 本位币金额（整行关闭、无汇兑残留），核销归零时本位币也归零。
 */
function bumpVerified(db: Database.Database, logId: string, deltaFc: number) {
  const row = db.prepare('SELECT amount, amount_fc, verified_fc, verified_amount, exchange_rate FROM scm_ar_ap_log WHERE id=?').get(logId) as any
  if (!row) return
  const amountFc = Number(row.amount_fc ?? row.amount) || 0
  const rate = Number(row.exchange_rate) || 1
  const verifiedFc = Math.max(0, Math.round(((Number(row.verified_fc) || 0) + deltaFc) * 100) / 100)
  let verifiedBase: number
  if (verifiedFc >= amountFc - 0.005) verifiedBase = Number(row.amount) || 0
  else if (verifiedFc <= 0.005) verifiedBase = 0
  else verifiedBase = Math.round(((Number(row.verified_amount) || 0) + deltaFc * rate) * 100) / 100
  verifiedBase = Math.min(Math.max(0, verifiedBase), Number(row.amount) || 0)
  db.prepare('UPDATE scm_ar_ap_log SET verified_fc=?, verified_amount=? WHERE id=?').run(verifiedFc, verifiedBase, logId)
}

/**
 * P1-1：收付款单写 / 删出纳日记账前必须过出纳结账闸。
 * 此前审核 / 反审核直接 INSERT / DELETE cashier_journal，已结账月份的出纳余额被静默篡改。
 * 评审 P0-3：与出纳自身写入口（assertJournalDateWritable）同口径，再过总账期间闸——
 * 否则总账已结账 / 已年结的月份仍能写出纳流水，随后制证被总账闸拦下，成为「有流水、无凭证」的僵尸行。
 */
function assertCashierWritable(db: Database.Database, accountSetId: string, docDate: unknown): string {
  let bizDate: string
  try {
    bizDate = normalizeBizDate(docDate)
  } catch (e: any) {
    throw new Error(`单据日期不合法：${e?.message || String(docDate)}`)
  }
  try {
    assertCashierPeriodOpen(db, accountSetId, bizDate)
  } catch (e: any) {
    throw new Error(`${e?.message || '出纳已结账'}（收付款单不能在已结账月份审核 / 反审核）`)
  }
  const ym = parseBizDate(bizDate)!
  try {
    assertGlPeriodOpen(db, accountSetId, ym.year, ym.month)
  } catch (e: any) {
    throw new Error(`${e?.message || '总账已结账'}（收付款单不能在总账已结账月份审核 / 反审核）`)
  }
  return bizDate
}

/** 到期日：单据显式 due_date 优先；否则 doc_date + 账期天数（单据 credit_days 优先，其次往来单位 credit_days）。UTC 计算避免时区漂移。 */
export function computeDueDate(doc: any, partner: any): string {
  const base = String(doc?.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  if (doc?.due_date) return String(doc.due_date).slice(0, 10)
  const days = Number(doc?.credit_days) || Number(partner?.credit_days) || 0
  if (!days) return base
  const d = new Date(base + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 审核收付款单：生成往来台账、出纳日记账，并自动核销已选源单。 */
export function applyPayment(db: Database.Database, accountSetId: string, doc: any, lines: any[], operator: string) {
  const isReceive = doc.doc_type === 'RCV'
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const cashCode = String(doc.settle_account || '')
  // P1-2：写出纳流水统一落账套本位币口径（单据默认 CNY、出纳默认 RMB 此前被拆成两个币种，收付款流水在出纳视图里消失）
  // FIX-260：出纳流水币种跟结算科目走——外币科目按原币入账（带汇率与本位币金额），本位币科目按折算后的本位币入账
  const baseCurrency = getCashierBaseCurrency(db, accountSetId)
  const docCurrency = normalizeCashierCurrency(doc.currency, baseCurrency)
  // 结算科目不存在（历史数据 / 未维护）时回退到单据币种
  const currency = (cashCode ? lookupCashierAccountCurrency(db, accountSetId, cashCode) : null) ?? docCurrency
  if (currency !== baseCurrency && currency !== docCurrency) {
    throw new Error(`结算科目 ${cashCode} 的核算币种为 ${currency}，与单据币种 ${docCurrency} 不一致`)
  }
  const bizDate = assertCashierWritable(db, accountSetId, doc.doc_date)
  const settleType = ({ cash: '现金', transfer: '转账', credit: '挂账' } as Record<string, string>)[doc.payment_type] || doc.payment_type || null
  const paramKey = isReceive ? 'scm:acc_ar' : 'scm:acc_ap'
  const defaultArAp = isReceive ? '1122' : '2202'
  const paramAccount = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?').get(accountSetId, paramKey) as any
  const arApCode = isReceive ? (partner?.ar_account || paramAccount?.param_value || defaultArAp) : (partner?.ap_account || paramAccount?.param_value || defaultArAp)

  // 往来台账 wldj 表（挂 scm_ar_ap_log）：amount 本位币、amount_fc 原币
  const fx = logCurrency(db, accountSetId, doc)
  const insWl = db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  // 出纳日记账
  const insCj = db.prepare(`INSERT INTO cashier_journal
    (id, account_set_id, account_code, currency, biz_date, summary, debit, credit, exchange_rate, base_debit, base_credit, settle_type, counter_account, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  const matches: Array<{ in_log_id: string; out_log_id: string; amount: number }> = []
  for (const l of lines) {
    const amount = Math.round(Number(l.amount || 0) * 100) / 100
    if (amount <= 0) continue

    // 出纳日记账
    const journalId = uuidv4()
    const baseAmount = toBase(amount, fx.rate)
    // 外币科目：原币 = 单据金额、汇率 = 单据汇率；本位币科目：原币即本位币金额、汇率 1
    const cjAmount = currency === baseCurrency ? baseAmount : amount
    const cjRate = currency === baseCurrency ? 1 : fx.rate
    insCj.run(
      journalId, accountSetId, cashCode, currency, bizDate,
      l.remark || doc.remark || `${isReceive ? '收款' : '付款'}：${doc.doc_no} ${partner?.name || doc.partner_code}`,
      isReceive ? cjAmount : 0, isReceive ? 0 : cjAmount, cjRate,
      isReceive ? baseAmount : 0, isReceive ? 0 : baseAmount, settleType, arApCode, operator
    )

    // 往来台账：收付款均为核销，往来余额减少 → direction='out'（out 行不参与账龄，到期日=单据日）
    const outLogId = uuidv4()
    insWl.run(outLogId, accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, doc.doc_date,
      'out', toBase(amount, fx.rate), partner?.ar_account || null, partner?.ap_account || null, journalId,
      l.remark || doc.remark, fx.currency, fx.rate, amount)
    if (l.arap_source_log_id) {
      matches.push({ in_log_id: String(l.arap_source_log_id), out_log_id: outLogId, amount })
    }
  }
  if (matches.length) {
    return verifyArAp(db, accountSetId, {
      partner_code: doc.partner_code,
      verify_date: doc.doc_date,
      operator,
      matches,
    })
  }
  return { verify_no: '', count: 0 }
}

/** 单据价税合计 = Σ(行金额 + 行税额)。往来台账与凭证统一取这个口径。 */
export function sumGrossAmount(lines: any[]): number {
  let total = 0
  for (const l of lines) total += Math.round((Number(l.amount || 0) + Number(l.tax_amount || 0)) * 100) / 100
  return Math.round(total * 100) / 100
}

/**
 * 审核采购/销售发票（RP/RS）：维护应收应付台账（不产生出纳流水）。
 *
 * 两种情形：
 *  1. **由来源单据下推的发票**（有 source_doc_id）——发货/入库时已按价税合计挂了暂估往来，
 *     此处不能再挂一次，否则同一笔业务被双计。改为把来源单据那条台账的金额**校正**为
 *     发票金额（开票金额与发货金额不一致时以发票为准），并在备注里留下发票号。
 *  2. **独立录入的发票**（无来源单据）——按发票价税合计新挂一条台账。
 *
 * 返回本次实际动作，供审核接口回显。
 */
export function applyInvoice(
  db: Database.Database, accountSetId: string, doc: any, lines: any[]
): { mode: 'adjust' | 'create' | 'skip'; amount: number; sourceDocNo?: string } {
  const total = sumGrossAmount(lines)
  if (total <= 0 || !doc.partner_code) return { mode: 'skip', amount: 0 }

  // ① 有来源单据：校正来源单据的暂估台账，不新增
  const srcLog = doc.source_doc_id ? findSourceArApLog(db, accountSetId, doc.source_doc_id) : null
  if (srcLog) {
    const invCur = logCurrency(db, accountSetId, doc).currency
    if (srcLog.currency && srcLog.currency !== invCur) {
      throw new Error(`发票币别 ${invCur} 与来源单据「${srcLog.doc_no}」币别 ${srcLog.currency} 不一致，不能校正其往来挂账`)
    }
    const verifiedFc = Number(srcLog.verified_fc ?? srcLog.verified_amount) || 0
    if (total < Math.round(verifiedFc * 100) / 100 - 0.005) {
      throw new Error(
        `发票金额 ${total} 小于来源单据「${srcLog.doc_no}」已核销金额 ${verifiedFc}，请先反核销`
      )
    }
    // 校正的是金额不是汇率：本位币按来源单记账汇率折算
    const rate = Number(srcLog.exchange_rate) || 1
    db.prepare(
      `UPDATE scm_ar_ap_log SET amount=?, amount_fc=?, remark=? WHERE id=?`
    ).run(toBase(total, rate), total, `${srcLog.remark ? srcLog.remark + ' ' : ''}[发票 ${doc.doc_no}]`, srcLog.id)
    return { mode: 'adjust', amount: total, sourceDocNo: srcLog.doc_no }
  }

  // ② 独立发票：新挂一条
  applyInvoiceLog(db, accountSetId, doc, total)
  return { mode: 'create', amount: total }
}

/** 取来源单据（SO/PI 等）挂出的那条应收应付台账 */
function findSourceArApLog(db: Database.Database, accountSetId: string, sourceDocId: string): any {
  const src = db.prepare(
    'SELECT doc_type, doc_no FROM scm_doc WHERE id=? AND account_set_id=?'
  ).get(sourceDocId, accountSetId) as any
  if (!src) return null
  return db.prepare(
    `SELECT * FROM scm_ar_ap_log
      WHERE account_set_id=? AND doc_type=? AND doc_no=? AND direction='in'
      ORDER BY rowid LIMIT 1`
  ).get(accountSetId, src.doc_type, src.doc_no) as any
}

/**
 * 撤销发票对往来台账的影响（反审核 / 删单）。
 * 校正过来源单据的，按来源单据的行重算价税合计还原；独立发票的直接删除自己的台账。
 */
export function reverseInvoice(db: Database.Database, accountSetId: string, doc: any): void {
  const srcLog = doc.source_doc_id ? findSourceArApLog(db, accountSetId, doc.source_doc_id) : null
  if (srcLog) {
    const srcLines = db.prepare('SELECT amount, tax_amount FROM scm_doc_line WHERE doc_id=?')
      .all(doc.source_doc_id) as any[]
    const restored = sumGrossAmount(srcLines)
    const verifiedFc = Number(srcLog.verified_fc ?? srcLog.verified_amount) || 0
    if (restored < Math.round(verifiedFc * 100) / 100 - 0.005) {
      throw new Error(
        `还原后的来源单据金额 ${restored} 小于已核销金额 ${verifiedFc}，请先反核销`
      )
    }
    const rate = Number(srcLog.exchange_rate) || 1
    db.prepare('UPDATE scm_ar_ap_log SET amount=?, amount_fc=?, remark=? WHERE id=?')
      .run(toBase(restored, rate), restored, srcLog.remark ? String(srcLog.remark).replace(/\s*\[发票 [^\]]*\]$/, '') || null : null, srcLog.id)
    return
  }
  reversePayment(db, accountSetId, doc)
}

/** 新挂一条发票往来台账 */
function applyInvoiceLog(db: Database.Database, accountSetId: string, doc: any, total: number) {
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const fx = logCurrency(db, accountSetId, doc)
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, computeDueDate(doc, partner),
    'in', toBase(total, fx.rate),
    doc.doc_type === 'RS' ? (partner?.ar_account || '1131') : null,
    doc.doc_type === 'RP' ? (partner?.ap_account || '2121') : null,
    null, doc.remark, fx.currency, fx.rate, total
  )
}

/**
 * 审核销售发货单（SO 销售出库）：按价税合计生成应收账款台账（无出纳流水）。
 *
 * 口径为**含税**——与凭证借方应收（amt + tax，见 scmDoc.ts 的 sale 分支）一致。
 * 原实现只挂不含税金额，导致：① 总账应收余额 ≠ 往来余额表/账龄/对账单；
 * ② 客户按含税额付款时，税额部分永远核销不掉，堆在「未核销收款」里污染预收统计。
 */
export function applyReceivableFromShipment(db: Database.Database, accountSetId: string, doc: any, lines: any[]) {
  if (!doc.partner_code) return  // 无客户则不挂应收
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const total = sumGrossAmount(lines)
  if (total <= 0) return
  const fx = logCurrency(db, accountSetId, doc)
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, computeDueDate(doc, partner),
    'in', toBase(total, fx.rate), partner?.ar_account || '1131', null, null, doc.remark, fx.currency, fx.rate, total
  )
}

/** 审核采购入库单（PI 采购入库）：按价税合计生成应付账款台账（无出纳流水）。口径同 applyReceivableFromShipment。 */
export function applyPayableFromReceipt(db: Database.Database, accountSetId: string, doc: any, lines: any[]) {
  if (!doc.partner_code) return  // 无供应商（如现购/无往来）则不挂应付
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const total = sumGrossAmount(lines)
  if (total <= 0) return
  const fx = logCurrency(db, accountSetId, doc)
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, computeDueDate(doc, partner),
    'in', toBase(total, fx.rate), null, partner?.ap_account || '2121', null, doc.remark, fx.currency, fx.rate, total
  )
}

/**
 * 审核退货单（PR 采购退货 / SR 销售退货）：按价税合计冲减往来（FIX-204）。
 *
 * 写 `direction='out'` 的台账行：余额、账龄、对账单都按 in/out 带符号累计，退货自然冲减；
 * 凭证侧 PR 借应付、SR 贷应收（见 scmDoc.ts 采购/销售分支）也是同一口径，往来余额与总账 1122/2202 对得上。
 * 该行可作为核销中的「出」方与来源发货/入库单的「入」方对冲（verifyArAp 只认 in↔out），
 * 未对冲前在未清项里以「退货」标签列示（enrichStatementRows 的 isAdjustment）。
 */
export function applyReturnAdjustment(db: Database.Database, accountSetId: string, doc: any, lines: any[]) {
  if (!doc.partner_code) return  // 无往来单位则不冲减
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const total = sumGrossAmount(lines)
  if (total <= 0) return
  const isSale = doc.doc_type === 'SR'
  const fx = logCurrency(db, accountSetId, doc)
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, doc.doc_date,
    'out', toBase(total, fx.rate),
    isSale ? (partner?.ar_account || '1131') : null,
    isSale ? null : (partner?.ap_account || '2121'),
    null, doc.remark, fx.currency, fx.rate, total
  )
}

/** 审核委外入库(WI)：按加工费价税合计生成委外厂应付账款台账。 */
export function applyOutsourceFeePayable(db: Database.Database, accountSetId: string, doc: any, grossAmount: number, taxAmount = 0) {
  if (!doc.partner_code || !(grossAmount > 0)) return  // 无委外厂或无加工费则不挂应付
  const partner = db.prepare('SELECT * FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, doc.partner_code) as any
  const fx = logCurrency(db, accountSetId, doc)
  const grossFc = Math.round(grossAmount * 100) / 100
  db.prepare(`INSERT INTO scm_ar_ap_log
    (id, account_set_id, partner_code, doc_type, doc_no, doc_date, due_date, direction, amount, ar_account, ap_account, cashier_journal_id, remark, currency, exchange_rate, amount_fc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uuidv4(), accountSetId, doc.partner_code, doc.doc_type, doc.doc_no, doc.doc_date, computeDueDate(doc, partner),
    'in', toBase(grossFc, fx.rate), null, partner?.ap_account || '2121', null,
    `${doc.doc_no} 委外加工费（其中税额 ${Math.round(taxAmount * 100) / 100}）`, fx.currency, fx.rate, grossFc
  )
}

/** 回退收付款：先回退该收付款日志参与的全部核销，再删除往来台账和出纳流水。 */
export function reversePayment(db: Database.Database, accountSetId: string, doc: any) {
  const logs = db.prepare('SELECT id, cashier_journal_id FROM scm_ar_ap_log WHERE account_set_id=? AND doc_type=? AND doc_no=?')
    .all(accountSetId, doc.doc_type, doc.doc_no) as any[]
  const outIds = logs.map(r => r.id)
  if (outIds.length) {
    const ph = outIds.map(() => '?').join(',')
    const verifies = db.prepare(`SELECT id, in_log_id, out_log_id, amount FROM scm_ar_ap_verify
      WHERE account_set_id=? AND out_log_id IN (${ph})`).all(accountSetId, ...outIds) as any[]
    const delVerify = db.prepare('DELETE FROM scm_ar_ap_verify WHERE id=?')
    for (const v of verifies) {
      bumpVerified(db, v.in_log_id, -Number(v.amount))
      bumpVerified(db, v.out_log_id, -Number(v.amount))
      delVerify.run(v.id)
    }
  }
  // P1-1：删出纳流水前先过闸（按流水自身的 biz_date，兼容单据日期被改过的情况）
  for (const r of logs) {
    if (!r.cashier_journal_id) continue
    const j = db.prepare('SELECT biz_date FROM cashier_journal WHERE id=?').get(r.cashier_journal_id) as any
    if (j) assertCashierWritable(db, accountSetId, j.biz_date)
  }
  for (const r of logs) {
    if (r.cashier_journal_id) db.prepare('DELETE FROM cashier_journal WHERE id=?').run(r.cashier_journal_id)
  }
  db.prepare('DELETE FROM scm_ar_ap_log WHERE account_set_id=? AND doc_type=? AND doc_no=?')
    .run(accountSetId, doc.doc_type, doc.doc_no)
}

// 应收类 / 应付类单据（用于往来快速筛选）
const AR_DOC_TYPES = ['SO', 'SR', 'RS', 'RCV']
const AP_DOC_TYPES = ['PI', 'PR', 'RP', 'PAY', 'WI', 'OP']

/** 返回 doc_type 过滤子句；alias 为表别名（如 'l'），无别名传空串 */
function arapDocTypeCond(arapType: string | undefined, alias = '') {
  const col = alias ? `${alias}.doc_type` : 'doc_type'
  const set = arapType === 'ar' ? AR_DOC_TYPES : arapType === 'ap' ? AP_DOC_TYPES : null
  if (!set) return { sql: '', params: [] as string[] }
  return { sql: `${col} IN (${set.map(() => '?').join(',')})`, params: set }
}

function enrichStatementRows(db: Database.Database, accountSetId: string, rows: any[]) {
  const ids = rows.map(row => row.id).filter(Boolean)
  const relationMap = new Map<string, string[]>()
  if (ids.length) {
    const ph = ids.map(() => '?').join(',')
    const relations = db.prepare(`SELECT v.verify_no,v.in_log_id,v.out_log_id,li.doc_no AS in_doc_no,lo.doc_no AS out_doc_no
      FROM scm_ar_ap_verify v
      JOIN scm_ar_ap_log li ON li.id=v.in_log_id JOIN scm_ar_ap_log lo ON lo.id=v.out_log_id
      WHERE v.account_set_id=? AND (v.in_log_id IN (${ph}) OR v.out_log_id IN (${ph}))`)
      .all(accountSetId, ...ids, ...ids) as any[]
    for (const relation of relations) {
      const add = (id: string, otherNo: string) => {
        const values = relationMap.get(id) || []
        values.push(`${relation.verify_no} / ${otherNo}`); relationMap.set(id, values)
      }
      add(relation.in_log_id, relation.out_doc_no); add(relation.out_log_id, relation.in_doc_no)
    }
  }
  const labels: Record<string, string> = { SO: '销售发货', SR: '销售退货', RS: '销售发票', RCV: '客户收款',
    PI: '采购入库', PR: '采购退货', RP: '采购发票', PAY: '供应商付款', WI: '委外加工费', OP: '工序委外费' }
  return rows.map(row => {
    const isSettlement = ['PAY', 'RCV'].includes(row.doc_type)
    const isAdjustment = ['PR', 'SR'].includes(row.doc_type)
    return { ...row, business_label: labels[row.doc_type] || row.doc_type,
      increase_amount: row.direction === 'in' && !isAdjustment ? Number(row.amount) || 0 : 0,
      settlement_amount: isSettlement ? Number(row.amount) || 0 : 0,
      adjustment_amount: isAdjustment || (row.direction === 'out' && !isSettlement) ? Number(row.amount) || 0 : 0,
      related_doc_nos: (relationMap.get(row.id) || []).join('；') }
  })
}

/** 往来台账查询：某单位指定期间的应收应付发生额与余额 */
/** 全部往来台账（不指定往来单位时）：跨所有往来单位的逐笔明细，余额按往来单位分别累计（切换往来时重置）。 */
export function getAllPartnerLedger(db: Database.Database, accountSetId: string, startDate?: string, endDate?: string, arapType?: string) {
  const conds = ['l.account_set_id=?']; const ps: any[] = [accountSetId]
  if (startDate) { conds.push('l.doc_date>=?'); ps.push(startDate) }
  if (endDate) { conds.push('l.doc_date<=?'); ps.push(endDate) }
  const arapMain = arapDocTypeCond(arapType, 'l')
  if (arapMain.sql) { conds.push(arapMain.sql); ps.push(...arapMain.params) }
  const rows = db.prepare(`SELECT l.*, p.name AS partner_name, p.partner_type
    FROM scm_ar_ap_log l LEFT JOIN scm_partner p ON p.account_set_id=l.account_set_id AND p.code=l.partner_code
    WHERE ${conds.join(' AND ')} ORDER BY l.partner_code, l.doc_date, l.created_at`).all(...ps) as any[]
  // 各往来单位期初（startDate 之前净额）
  const openingMap = new Map<string, number>()
  if (startDate) {
    const arapOb = arapDocTypeCond(arapType)
    const obs = db.prepare(`SELECT partner_code, COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) bal
      FROM scm_ar_ap_log WHERE account_set_id=? AND doc_date<?${arapOb.sql ? ' AND ' + arapOb.sql : ''} GROUP BY partner_code`).all(accountSetId, startDate, ...arapOb.params) as any[]
    for (const o of obs) openingMap.set(o.partner_code, o.bal || 0)
  }
  // 逐笔余额：按往来单位分别累计（首笔以其期初为起点）
  const runMap = new Map<string, number>()
  let totalIn = 0, totalOut = 0
  const detail = rows.map((r: any) => {
    const prev = runMap.has(r.partner_code) ? (runMap.get(r.partner_code) as number) : (openingMap.get(r.partner_code) || 0)
    const cur = prev + (r.direction === 'in' ? r.amount : -r.amount)
    runMap.set(r.partner_code, cur)
    if (r.direction === 'in') totalIn += r.amount; else totalOut += r.amount
    return { ...r, balance: Math.round(cur * 100) / 100 }
  })
  return {
    detail: enrichStatementRows(db, accountSetId, detail),
    total_in: Math.round(totalIn * 100) / 100,
    total_out: Math.round(totalOut * 100) / 100,
    closing: Math.round((totalIn - totalOut) * 100) / 100,
  }
}

/**
 * 往来余额表：仍按往来单位一行汇总，但明确拆分应收/收款、应付/付款。
 * 不能只按 direction=in/out 汇总，否则应收和应付都会落入“增加”，收款和付款都会落入“减少”，
 * 前端既无法正确着色，客户兼供应商的余额也无法判断业务属性。
 */
export function getPartnerBalanceSummary(db: Database.Database, accountSetId: string, startDate?: string, endDate?: string, arapType?: string) {
  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
  const arTypesSql = AR_DOC_TYPES.map(t => `'${t}'`).join(',')
  const apTypesSql = AP_DOC_TYPES.map(t => `'${t}'`).join(',')
  type Opening = { ar: number; ap: number }
  const openingMap = new Map<string, Opening>()
  if (startDate) {
    const arapOb = arapDocTypeCond(arapType)
    const obs = db.prepare(`SELECT partner_code,
        COALESCE(SUM(CASE
          WHEN doc_type IN (${arTypesSql}) AND direction='in' THEN amount
          WHEN doc_type IN (${arTypesSql}) AND direction='out' THEN -amount ELSE 0 END),0) ar_opening,
        COALESCE(SUM(CASE
          WHEN doc_type IN (${apTypesSql}) AND direction='in' THEN amount
          WHEN doc_type IN (${apTypesSql}) AND direction='out' THEN -amount ELSE 0 END),0) ap_opening
      FROM scm_ar_ap_log WHERE account_set_id=? AND doc_date<?${arapOb.sql ? ' AND ' + arapOb.sql : ''}
      GROUP BY partner_code`).all(accountSetId, startDate, ...arapOb.params) as any[]
    for (const o of obs) openingMap.set(o.partner_code, { ar: Number(o.ar_opening) || 0, ap: Number(o.ap_opening) || 0 })
  }
  // 本期发生按业务性质分别聚合，最终仍是一家往来单位一行。
  const arapMain = arapDocTypeCond(arapType)
  const conds = ['account_set_id=?']; const ps: any[] = [accountSetId]
  if (startDate) { conds.push('doc_date>=?'); ps.push(startDate) }
  if (endDate) { conds.push('doc_date<=?'); ps.push(endDate) }
  if (arapMain.sql) { conds.push(arapMain.sql); ps.push(...arapMain.params) }
  const rows = db.prepare(`SELECT partner_code,
      COALESCE(SUM(CASE WHEN doc_type IN (${arTypesSql}) AND direction='in'  THEN amount ELSE 0 END),0) AS receivable_amount,
      COALESCE(SUM(CASE WHEN doc_type IN (${arTypesSql}) AND direction='out' THEN amount ELSE 0 END),0) AS received_amount,
      COALESCE(SUM(CASE WHEN doc_type IN (${apTypesSql}) AND direction='in'  THEN amount ELSE 0 END),0) AS payable_amount,
      COALESCE(SUM(CASE WHEN doc_type IN (${apTypesSql}) AND direction='out' THEN amount ELSE 0 END),0) AS paid_amount
    FROM scm_ar_ap_log WHERE ${conds.join(' AND ')} GROUP BY partner_code`).all(...ps) as any[]
  // 合并期初 + 本期；余额分别保留应收、应付，净额仅用于“全部往来”的期末净额列。
  const codes = new Set<string>([...openingMap.keys(), ...rows.map((r: any) => r.partner_code)])
  const summary = [...codes].map(code => {
    const row: any = rows.find((x: any) => x.partner_code === code) || {}
    const ob = openingMap.get(code) || { ar: 0, ap: 0 }
    const receivable = Number(row.receivable_amount) || 0
    const received = Number(row.received_amount) || 0
    const payable = Number(row.payable_amount) || 0
    const paid = Number(row.paid_amount) || 0
    const arClosing = ob.ar + receivable - received
    const apClosing = ob.ap + payable - paid
    const opening = arapType === 'ar' ? ob.ar : arapType === 'ap' ? ob.ap : ob.ar - ob.ap
    const closing = arapType === 'ar' ? arClosing : arapType === 'ap' ? apClosing : arClosing - apClosing
    return {
      partner_code: code,
      ar_opening: r2(ob.ar), ap_opening: r2(ob.ap),
      receivable_amount: r2(receivable), received_amount: r2(received),
      payable_amount: r2(payable), paid_amount: r2(paid),
      ar_closing: r2(arClosing), ap_closing: r2(apClosing),
      opening: r2(opening), closing: r2(closing),
      // 兼容原调用方：筛选应收/应付时分别对应业务列；全部时为两类发生额合计。
      period_in: r2(arapType === 'ar' ? receivable : arapType === 'ap' ? payable : receivable + payable),
      period_out: r2(arapType === 'ar' ? received : arapType === 'ap' ? paid : received + paid),
    }
  }).filter(e => Math.abs(e.ar_opening) + Math.abs(e.ap_opening) + Math.abs(e.receivable_amount)
      + Math.abs(e.received_amount) + Math.abs(e.payable_amount) + Math.abs(e.paid_amount) > 0.005)
  // 挂 partner 名称/类型
  if (summary.length) {
    const names = db.prepare(`SELECT code, name, partner_type FROM scm_partner WHERE account_set_id=? AND code IN (${summary.map(() => '?').join(',')})`)
      .all(accountSetId, ...summary.map(s => s.partner_code)) as any[]
    const nm = new Map<string, any>(names.map((n: any) => [n.code, n]))
    for (const s of summary) { (s as any).partner_name = nm.get(s.partner_code)?.name || null; (s as any).partner_type = nm.get(s.partner_code)?.partner_type || null }
  }
  return {
    summary,
    total_opening: r2(summary.reduce((s, e) => s + e.opening, 0)),
    total_in: r2(summary.reduce((s, e) => s + e.period_in, 0)),
    total_out: r2(summary.reduce((s, e) => s + e.period_out, 0)),
    total_closing: r2(summary.reduce((s, e) => s + e.closing, 0)),
    total_ar_opening: r2(summary.reduce((s, e) => s + e.ar_opening, 0)),
    total_ap_opening: r2(summary.reduce((s, e) => s + e.ap_opening, 0)),
    total_receivable: r2(summary.reduce((s, e) => s + e.receivable_amount, 0)),
    total_received: r2(summary.reduce((s, e) => s + e.received_amount, 0)),
    total_payable: r2(summary.reduce((s, e) => s + e.payable_amount, 0)),
    total_paid: r2(summary.reduce((s, e) => s + e.paid_amount, 0)),
    total_ar_closing: r2(summary.reduce((s, e) => s + e.ar_closing, 0)),
    total_ap_closing: r2(summary.reduce((s, e) => s + e.ap_closing, 0)),
  }
}

export function getPartnerLedger(db: Database.Database, accountSetId: string, partnerCode: string, startDate?: string, endDate?: string, arapType?: string) {
  const conds = ['account_set_id=?', 'partner_code=?']; const ps: any[] = [accountSetId, partnerCode]
  if (startDate) { conds.push('doc_date>=?'); ps.push(startDate) }
  if (endDate) { conds.push('doc_date<=?'); ps.push(endDate) }
  const arapMain = arapDocTypeCond(arapType)
  if (arapMain.sql) { conds.push(arapMain.sql); ps.push(...arapMain.params) }
  const rows = db.prepare(`SELECT * FROM scm_ar_ap_log WHERE ${conds.join(' AND ')} ORDER BY doc_date, created_at`).all(...ps)
  // calc opening balance
  let opening = 0
  if (startDate) {
    const arapOb = arapDocTypeCond(arapType)
    const ob = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction=? THEN amount ELSE -amount END),0) as bal FROM scm_ar_ap_log WHERE account_set_id=? AND partner_code=? AND doc_date<?${arapOb.sql ? ' AND ' + arapOb.sql : ''}`).get('in', accountSetId, partnerCode, startDate, ...arapOb.params) as any
    opening = ob?.bal || 0
  }
  let running = opening
  const detail = (rows as any[]).map((r: any) => { running += r.direction === 'in' ? r.amount : -r.amount; return { ...r, balance: Math.round(running * 100) / 100 } })
  return { opening: Math.round(opening * 100) / 100, detail: enrichStatementRows(db, accountSetId, detail), closing: Math.round(running * 100) / 100 }
}

// ── 单据级核销 + 预收预付（Phase 1） ─────────────────────────────────────
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** 核销单号：HX-YYYYMM-NNN（账套内按月流水） */
function nextVerifyNo(db: Database.Database, accountSetId: string): string {
  const now = new Date()
  const prefix = `HX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`
  const rows = db.prepare('SELECT verify_no FROM scm_ar_ap_verify WHERE account_set_id=? AND verify_no LIKE ?').all(accountSetId, `${prefix}%`) as Array<{ verify_no: string }>
  let max = 0
  for (const r of rows) {
    const m = String(r.verify_no).match(/(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return prefix + String(max + 1).padStart(3, '0')
}

/**
 * 未核销明细：返回某往来单位 应收应付方(in) 与 收付款/预收预付方(out) 的未核销行。
 * side: 'ar'(应收) / 'ap'(应付)；不传则全部。
 */
export function getOpenItems(db: Database.Database, accountSetId: string, partnerCode: string, side?: 'ar' | 'ap') {
  const arap = arapDocTypeCond(side === 'ar' ? 'ar' : side === 'ap' ? 'ap' : undefined, 'l')
  const extra = arap.sql ? ' AND ' + arap.sql : ''
  // 多币种：open_amount 为**原币**未清（核销按原币），open_amount_base 为本位币未清（汇总口径）
  const q = (dir: 'in' | 'out') => db.prepare(
    `SELECT l.*, (COALESCE(l.amount_fc, l.amount) - COALESCE(l.verified_fc, l.verified_amount)) AS open_amount,
       (l.amount - l.verified_amount) AS open_amount_base,
       CAST((julianday('now') - julianday(COALESCE(l.due_date, l.doc_date))) AS INTEGER) AS overdue_days
     FROM scm_ar_ap_log l
     WHERE l.account_set_id=? AND l.partner_code=? AND l.direction=?
       AND (COALESCE(l.amount_fc, l.amount) - COALESCE(l.verified_fc, l.verified_amount)) > 0.005${extra}
     ORDER BY COALESCE(l.due_date, l.doc_date), l.created_at`
  ).all(accountSetId, partnerCode, dir, ...arap.params) as any[]
  const inItems = q('in')     // 应收/应付（待核销）
  const outItems = q('out')   // 收付款 / 未核销即预收预付
  const sum = (rows: any[]) => r2(rows.reduce((s, r) => s + (Number(r.open_amount_base) || 0), 0))
  return {
    in_items: inItems, out_items: outItems,
    open_in: sum(inItems),            // 未收/未付合计（本位币）
    advance: sum(outItems),           // 预收/预付余额（本位币）
  }
}

/** 收付款单可选择的应收应付源单。RCV=销售发货，PAY=采购/委外入库。 */
export function getPaymentSources(
  db: Database.Database,
  accountSetId: string,
  partnerCode: string,
  paymentDocType: 'RCV' | 'PAY',
  currency?: string | null,
) {
  const sourceTypes = paymentDocType === 'RCV' ? ['SO'] : ['PI', 'WI', 'OP']
  const ph = sourceTypes.map(() => '?').join(',')
  // 多币种：只列同币别的源单（核销须同币别），金额为原币
  const cur = currency ? (isScmBaseCurrency(db, accountSetId, currency) ? getScmBaseCurrency(db, accountSetId) : normalizeScmCurrency(currency)) : ''
  const curSql = cur ? " AND COALESCE(l.currency, '') IN (?, '')" : ''
  const curParams = cur ? [cur] : []
  return db.prepare(`SELECT
      l.id AS arap_source_log_id,
      d.id AS source_doc_id,
      l.doc_type AS source_doc_type,
      l.doc_no AS source_doc_no,
      l.doc_date AS source_doc_date,
      l.due_date,
      l.currency,
      ROUND(COALESCE(l.amount_fc, l.amount),2) AS source_amount,
      ROUND(COALESCE(l.verified_fc, l.verified_amount),2) AS settled_amount,
      ROUND(COALESCE(l.amount_fc, l.amount)-COALESCE(l.verified_fc, l.verified_amount),2) AS open_amount,
      l.remark
    FROM scm_ar_ap_log l
    JOIN scm_doc d ON d.account_set_id=l.account_set_id AND d.doc_type=l.doc_type AND d.doc_no=l.doc_no
    WHERE l.account_set_id=? AND l.partner_code=? AND l.direction='in'
      AND l.doc_type IN (${ph}) AND d.status='audited'${curSql}
      AND (COALESCE(l.amount_fc, l.amount)-COALESCE(l.verified_fc, l.verified_amount))>0.005
    ORDER BY l.doc_date, l.created_at`).all(accountSetId, partnerCode, ...sourceTypes, ...curParams) as any[]
}

/**
 * 执行核销：matches 每项用一笔 out(收付款) 核销一笔 in(应收应付)。
 * 单事务：插入 scm_ar_ap_verify + 累加两侧 verified_amount，越界即抛错回滚。
 */
export function verifyArAp(db: Database.Database, accountSetId: string, params: {
  partner_code: string
  verify_date?: string
  operator?: string
  matches: Array<{ in_log_id: string; out_log_id: string; amount: number }>
}): { verify_no: string; count: number } {
  const { partner_code, matches } = params
  if (!partner_code) throw new Error('缺少往来单位')
  const valid = (matches || []).filter(m => m && m.in_log_id && m.out_log_id && Number(m.amount) > 0)
  if (!valid.length) throw new Error('没有可核销的匹配项')
  const getLog = db.prepare('SELECT id, partner_code, direction, doc_type, amount, verified_amount, currency, COALESCE(amount_fc, amount) AS amount_fc, COALESCE(verified_fc, verified_amount) AS verified_fc FROM scm_ar_ap_log WHERE id=? AND account_set_id=?')
  const insV = db.prepare(`INSERT INTO scm_ar_ap_verify
    (id, account_set_id, partner_code, verify_no, verify_date, in_log_id, out_log_id, amount, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))`)
  const verifyNo = nextVerifyNo(db, accountSetId)
  const verifyDate = params.verify_date || new Date().toISOString().slice(0, 10)
  const run = db.transaction(() => {
    for (const m of valid) {
      const amt = r2(m.amount)
      const inRow = getLog.get(m.in_log_id, accountSetId) as any
      const outRow = getLog.get(m.out_log_id, accountSetId) as any
      if (!inRow || !outRow) throw new Error('核销对象不存在')
      if (inRow.direction !== 'in' || outRow.direction !== 'out') throw new Error('核销方向不正确（须用收付款核销应收应付）')
      if (inRow.partner_code !== partner_code || outRow.partner_code !== partner_code) throw new Error('核销双方往来单位不一致')
      // FIX-215：业务方向必须一致——应收只能用收款/销售退货核销，应付只能用付款/采购退货核销。
      // 原来只校验 in/out，客户兼供应商时收款单可把应付核销掉，应收账龄虚增、应付账龄虚减。
      const inIsAr = AR_DOC_TYPES.includes(inRow.doc_type), inIsAp = AP_DOC_TYPES.includes(inRow.doc_type)
      const outIsAr = AR_DOC_TYPES.includes(outRow.doc_type), outIsAp = AP_DOC_TYPES.includes(outRow.doc_type)
      if ((inIsAr && !outIsAr) || (inIsAp && !outIsAp)) {
        throw new Error(`核销业务方向不一致：${inIsAr ? '应收' : '应付'}「${inRow.doc_type}」不能用「${outRow.doc_type}」核销`)
      }
      // 多币种：只能同币别核销；核销额是原币，本位币已核销额按比例折算（scm_ar_ap_verify.amount 记原币）
      if (inRow.currency && outRow.currency && inRow.currency !== outRow.currency) {
        throw new Error(`核销双方币别不一致（${inRow.currency} / ${outRow.currency}），不能直接核销`)
      }
      if (r2(inRow.verified_fc + amt) > r2(inRow.amount_fc) + 0.005) throw new Error(`应收应付「${m.in_log_id}」核销额超出未核销余额`)
      if (r2(outRow.verified_fc + amt) > r2(outRow.amount_fc) + 0.005) throw new Error(`收付款「${m.out_log_id}」核销额超出可用余额`)
      insV.run(uuidv4(), accountSetId, partner_code, verifyNo, verifyDate, m.in_log_id, m.out_log_id, amt, params.operator || null)
      bumpVerified(db, m.in_log_id, amt)
      bumpVerified(db, m.out_log_id, amt)
    }
  })
  run()
  return { verify_no: verifyNo, count: valid.length }
}

/** 反核销：删除该核销单的所有明细，并回退两侧 verified_amount。 */
export function cancelVerify(db: Database.Database, accountSetId: string, verifyNo: string): { count: number } {
  const rows = db.prepare('SELECT id, in_log_id, out_log_id, amount FROM scm_ar_ap_verify WHERE account_set_id=? AND verify_no=?').all(accountSetId, verifyNo) as any[]
  if (!rows.length) throw new Error('核销单不存在')
  const del = db.prepare('DELETE FROM scm_ar_ap_verify WHERE id=?')
  const run = db.transaction(() => {
    for (const r of rows) {
      bumpVerified(db, r.in_log_id, -Number(r.amount))
      bumpVerified(db, r.out_log_id, -Number(r.amount))
      del.run(r.id)
    }
  })
  run()
  return { count: rows.length }
}

/** 核销单列表（按核销单号汇总） */
export function listVerifies(db: Database.Database, accountSetId: string, partnerCode?: string) {
  const conds = ['v.account_set_id=?']; const ps: any[] = [accountSetId]
  if (partnerCode) { conds.push('v.partner_code=?'); ps.push(partnerCode) }
  return db.prepare(`SELECT v.verify_no, v.partner_code, p.name AS partner_name, v.verify_date,
      COUNT(*) AS line_count, ROUND(SUM(v.amount),2) AS total_amount, MAX(v.created_by) AS created_by, MAX(v.created_at) AS created_at
    FROM scm_ar_ap_verify v LEFT JOIN scm_partner p ON p.account_set_id=v.account_set_id AND p.code=v.partner_code
    WHERE ${conds.join(' AND ')} GROUP BY v.verify_no ORDER BY v.created_at DESC`).all(...ps) as any[]
}

// ── 到期账龄 / 到期提醒 / 信用额度（Phase 2 & 3） ─────────────────────────
/** 应收应付账龄：按到期日 COALESCE(due_date,doc_date) 分桶，金额取未核销额（amount−verified_amount）。 */
/**
 * 账龄表（FIX-213）：
 *  - 只取单据日期 ≤ 截止日的台账（原来不截断，未来单据混入余额与分桶）；
 *  - 按到期日分桶：未到期 / 逾期 ≤30 / 31-60 / 61-90 / 90 以上（原来「未到期」混在「当前」桶里）；
 *  - 到期日不可解析时退回单据日期，不再因 NaN 丢行。
 */
export function getArApAging(db: Database.Database, accountSetId: string, asOf: string) {
  const rows = db.prepare(`SELECT l.partner_code, p.name AS partner_name, p.partner_type, l.direction,
      COALESCE(l.due_date, l.doc_date) AS due_date, l.doc_date, (l.amount - l.verified_amount) AS open_amt
    FROM scm_ar_ap_log l LEFT JOIN scm_partner p ON p.account_set_id=l.account_set_id AND p.code=l.partner_code
    WHERE l.account_set_id=? AND l.doc_date <= ? AND (l.amount - l.verified_amount) > 0.005`).all(accountSetId, asOf) as any[]
  const map = new Map<string, any>()
  const asOfMs = new Date(asOf + 'T00:00:00Z').getTime()
  for (const r of rows) {
    if (!map.has(r.partner_code)) map.set(r.partner_code, { partner_code: r.partner_code, partner_name: r.partner_name, partner_type: r.partner_type, balance: 0, not_due: 0, current: 0, d30: 0, d60: 0, over90: 0 })
    let dueMs = new Date(String(r.due_date || '') + 'T00:00:00Z').getTime()
    if (!Number.isFinite(dueMs)) dueMs = new Date(String(r.doc_date) + 'T00:00:00Z').getTime()
    const days = Number.isFinite(dueMs) ? Math.floor((asOfMs - dueMs) / 86400000) : 0
    const age = days < 0 ? 'not_due' : days <= 30 ? 'current' : days <= 60 ? 'd30' : days <= 90 ? 'd60' : 'over90'
    const amt = r.direction === 'in' ? r.open_amt : -r.open_amt
    const e = map.get(r.partner_code)!
    e.balance = Math.round((e.balance + amt) * 100) / 100
    e[age] = Math.round((e[age] + amt) * 100) / 100
  }
  return [...map.values()].filter(e => Math.abs(e.balance) > 0.01)
}

/** 到期提醒：未核销应收应付(in) 中已逾期 与 临近到期(asOf..asOf+upcomingDays) 的清单。 */
export function getDueReminder(db: Database.Database, accountSetId: string, asOf: string, upcomingDays = 7) {
  const rows = db.prepare(`SELECT l.id, l.partner_code, p.name AS partner_name, l.doc_type, l.doc_no,
      COALESCE(l.due_date, l.doc_date) AS due_date, (l.amount - l.verified_amount) AS open_amount,
      CAST((julianday(?) - julianday(COALESCE(l.due_date, l.doc_date))) AS INTEGER) AS overdue_days
    FROM scm_ar_ap_log l LEFT JOIN scm_partner p ON p.account_set_id=l.account_set_id AND p.code=l.partner_code
    WHERE l.account_set_id=? AND l.direction='in' AND (l.amount - l.verified_amount) > 0.005
    ORDER BY due_date`).all(asOf, accountSetId) as any[]
  const overdue: any[] = [], upcoming: any[] = []
  for (const r of rows) {
    if (r.overdue_days > 0) overdue.push(r)
    else if (r.overdue_days >= -upcomingDays) upcoming.push(r)
  }
  const sum = (a: any[]) => Math.round(a.reduce((s, r) => s + (Number(r.open_amount) || 0), 0) * 100) / 100
  return { overdue, upcoming, overdue_total: sum(overdue), upcoming_total: sum(upcoming) }
}

/** 某客户未核销应收总额（信用占用核心）。 */
export function getPartnerOpenAr(db: Database.Database, accountSetId: string, partnerCode: string): number {
  const ph = AR_DOC_TYPES.map(() => '?').join(',')
  // 未核销的销售退货(SR, direction=out) 同样冲减客户欠款（FIX-204）；未核销收款属预收，不抵占用
  const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount - verified_amount
      WHEN doc_type='SR' THEN -(amount - verified_amount) ELSE 0 END),0) v FROM scm_ar_ap_log
    WHERE account_set_id=? AND partner_code=? AND doc_type IN (${ph})`).get(accountSetId, partnerCode, ...AR_DOC_TYPES) as any
  return Math.round((Number(r?.v) || 0) * 100) / 100
}

/** 信用占用：额度 / 已用(未核销应收) / 可用。 */
export function getPartnerCredit(db: Database.Database, accountSetId: string, partnerCode: string) {
  const p = db.prepare('SELECT credit_limit, name FROM scm_partner WHERE account_set_id=? AND code=?').get(accountSetId, partnerCode) as any
  const limit = Math.round((Number(p?.credit_limit) || 0) * 100) / 100
  const usedAr = getPartnerOpenAr(db, accountSetId, partnerCode)
  return { partner_code: partnerCode, partner_name: p?.name || '', credit_limit: limit, used_ar: usedAr, available: Math.round((limit - usedAr) * 100) / 100 }
}

/** 反审核安全网：该单据(doc_no)对应的往来台账行是否已参与核销（verified_amount>0）。 */
export function getDocVerifiedInfo(db: Database.Database, accountSetId: string, docNo: string): { verified: boolean; verify_nos: string[] } {
  const logs = db.prepare('SELECT id FROM scm_ar_ap_log WHERE account_set_id=? AND doc_no=? AND COALESCE(verified_fc, verified_amount) > 0.005').all(accountSetId, docNo) as any[]
  if (!logs.length) return { verified: false, verify_nos: [] }
  const nos = db.prepare(`SELECT DISTINCT verify_no FROM scm_ar_ap_verify
    WHERE account_set_id=? AND (in_log_id IN (SELECT id FROM scm_ar_ap_log WHERE account_set_id=? AND doc_no=?)
       OR out_log_id IN (SELECT id FROM scm_ar_ap_log WHERE account_set_id=? AND doc_no=?))`)
    .all(accountSetId, accountSetId, docNo, accountSetId, docNo) as any[]
  return { verified: true, verify_nos: nos.map(n => n.verify_no) }
}
