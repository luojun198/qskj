/**
 * 供应链往来台账期末汇率重估（多币种双轨收尾）。
 *
 * 总账「期末调汇」按科目外币余额出汇兑损益凭证，其中已包含供应链外币应收/应付分录；
 * 这里只把往来台账里外币行的**未核销部分**按同一期末汇率重估到本位币，
 * 使往来余额表 / 账龄 / 信用占用（本位币）与总账 1122/2202 一致。不生成凭证。
 *
 *   新本位币 amount = 已核销本位币 + 未核销原币 × 期末汇率；行汇率改为期末汇率（其后核销按新汇率折算）。
 *   每次重估记录旧/新值，可撤销恢复。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { resolveClosingExchangeRateWithSource, type FxRateSource } from './fxRevaluation.js'
import { getScmBaseCurrency } from './scmCurrency.js'

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export interface ScmFxRevalRow {
  log_id: string
  partner_code: string
  partner_name: string | null
  doc_type: string
  doc_no: string
  doc_date: string
  direction: 'in' | 'out'
  currency: string
  open_fc: number
  old_rate: number
  old_open_base: number
  new_rate: number
  new_open_base: number
  adjustment: number
}

export interface ScmFxRevalPreview {
  year: number
  period: number
  base_currency: string
  rates: Array<{ currency: string; rate: number; source: FxRateSource }>
  rows: ScmFxRevalRow[]
  total_adjustment: number
  existing: { id: string; created_at: string; total_adjustment: number } | null
}

function periodEnd(year: number, period: number) {
  return `${year}-${String(period).padStart(2, '0')}-${String(new Date(year, period, 0).getDate()).padStart(2, '0')}`
}

export function previewScmFxRevaluation(db: Database.Database, aid: string, year: number, period: number, rateOverrides: Record<string, number> = {}): ScmFxRevalPreview {
  const base = getScmBaseCurrency(db, aid)
  const asOf = periodEnd(year, period)
  const existing = db.prepare('SELECT id, created_at, total_adjustment FROM scm_fx_revaluation WHERE account_set_id=? AND year=? AND period=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(aid, year, period) as any || null
  const logs = db.prepare(`SELECT l.id, l.partner_code, p.name AS partner_name, l.doc_type, l.doc_no, l.doc_date, l.direction, l.currency,
      l.exchange_rate, l.amount, l.verified_amount, COALESCE(l.amount_fc, l.amount) AS amount_fc, COALESCE(l.verified_fc, l.verified_amount) AS verified_fc
    FROM scm_ar_ap_log l LEFT JOIN scm_partner p ON p.account_set_id=l.account_set_id AND p.code=l.partner_code
    WHERE l.account_set_id=? AND l.currency IS NOT NULL AND l.currency<>? AND l.doc_date<=?
      AND (COALESCE(l.amount_fc, l.amount) - COALESCE(l.verified_fc, l.verified_amount)) > 0.005
    ORDER BY l.currency, l.partner_code, l.doc_date`).all(aid, base, asOf) as any[]
  const rates = new Map<string, { rate: number; source: FxRateSource }>()
  const rows: ScmFxRevalRow[] = []
  for (const l of logs) {
    const cur = String(l.currency)
    if (!rates.has(cur)) {
      const override = Number(rateOverrides[cur])
      rates.set(cur, override > 0 ? { rate: override, source: 'default' } : resolveClosingExchangeRateWithSource(db as any, aid, cur, year, period))
    }
    const newRate = rates.get(cur)!.rate
    const openFc = r2(Number(l.amount_fc) - Number(l.verified_fc))
    const oldOpenBase = r2(Number(l.amount) - Number(l.verified_amount))
    const newOpenBase = r2(openFc * newRate)
    const adjustment = r2(newOpenBase - oldOpenBase)
    rows.push({
      log_id: l.id, partner_code: l.partner_code, partner_name: l.partner_name, doc_type: l.doc_type, doc_no: l.doc_no, doc_date: l.doc_date,
      direction: l.direction, currency: cur, open_fc: openFc, old_rate: Number(l.exchange_rate) || 1, old_open_base: oldOpenBase,
      new_rate: newRate, new_open_base: newOpenBase, adjustment,
    })
  }
  return {
    year, period, base_currency: base,
    rates: [...rates.entries()].map(([currency, r]) => ({ currency, rate: r.rate, source: r.source })),
    rows,
    total_adjustment: r2(rows.reduce((s, r) => s + (r.direction === 'in' ? r.adjustment : -r.adjustment), 0)),
    existing,
  }
}

/** 执行重估：改写台账行本位币金额与汇率，记录旧值供撤销。同一期间已有未撤销记录时拒绝。 */
export function runScmFxRevaluation(db: Database.Database, aid: string, year: number, period: number, user: string, rateOverrides: Record<string, number> = {}) {
  const preview = previewScmFxRevaluation(db, aid, year, period, rateOverrides)
  if (preview.existing) throw new Error(`${year} 年 ${period} 期已做过往来汇率重估（${preview.existing.created_at}），请先撤销再重做`)
  const effective = preview.rows.filter(r => Math.abs(r.adjustment) >= 0.005 || Math.abs(r.new_rate - r.old_rate) > 1e-9)
  if (!effective.length) throw new Error('本期没有需要重估的外币未清往来')
  const id = uuidv4()
  db.transaction(() => {
    const upd = db.prepare('UPDATE scm_ar_ap_log SET amount=?, exchange_rate=? WHERE id=? AND account_set_id=?')
    const lines = effective.map(r => {
      const row = db.prepare('SELECT amount, verified_amount FROM scm_ar_ap_log WHERE id=?').get(r.log_id) as any
      const newAmount = r2(Number(row.verified_amount) + r.new_open_base)
      upd.run(newAmount, r.new_rate, r.log_id, aid)
      return { log_id: r.log_id, old_amount: Number(row.amount), new_amount: newAmount, old_rate: r.old_rate, new_rate: r.new_rate, adjustment: r.adjustment, direction: r.direction }
    })
    db.prepare('INSERT INTO scm_fx_revaluation (id, account_set_id, year, period, rates_json, lines_json, total_adjustment, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, aid, year, period, JSON.stringify(preview.rates), JSON.stringify(lines), preview.total_adjustment, user)
  })()
  return { id, count: effective.length, total_adjustment: preview.total_adjustment }
}

/** 撤销重估：按记录恢复台账行旧金额与旧汇率（行已被后续核销改动时仍按差额回退 amount） */
export function revokeScmFxRevaluation(db: Database.Database, aid: string, id: string) {
  const run = db.prepare('SELECT * FROM scm_fx_revaluation WHERE id=? AND account_set_id=?').get(id, aid) as any
  if (!run) throw new Error('重估记录不存在')
  if (run.revoked_at) throw new Error('该记录已撤销')
  const later = db.prepare('SELECT id FROM scm_fx_revaluation WHERE account_set_id=? AND revoked_at IS NULL AND (year > ? OR (year = ? AND period > ?)) LIMIT 1').get(aid, run.year, run.year, run.period)
  if (later) throw new Error('存在更晚期间的重估记录，请先撤销更晚期间')
  const lines = JSON.parse(run.lines_json) as Array<{ log_id: string; old_amount: number; new_amount: number; old_rate: number; new_rate: number }>
  db.transaction(() => {
    for (const l of lines) {
      const row = db.prepare('SELECT amount FROM scm_ar_ap_log WHERE id=?').get(l.log_id) as any
      if (!row) continue
      const delta = r2(l.new_amount - l.old_amount)
      db.prepare('UPDATE scm_ar_ap_log SET amount=ROUND(amount-?,2), exchange_rate=? WHERE id=?').run(delta, l.old_rate, l.log_id)
    }
    db.prepare("UPDATE scm_fx_revaluation SET revoked_at=datetime('now') WHERE id=?").run(id)
  })()
  return { id, count: lines.length }
}

export function listScmFxRevaluations(db: Database.Database, aid: string) {
  return db.prepare('SELECT id, year, period, total_adjustment, created_by, created_at, revoked_at, rates_json FROM scm_fx_revaluation WHERE account_set_id=? ORDER BY year DESC, period DESC, created_at DESC').all(aid) as any[]
}
