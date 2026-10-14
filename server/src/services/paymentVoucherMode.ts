/**
 * 收付款制证方式（系统参数 payment_voucher_mode）
 *
 * 收款单 RCV / 付款单 PAY 审核时同时写往来台账和出纳日记账（scmArAp.applyPayment），
 * 之后供应链「生成凭证」与出纳「生成凭证」两个入口都能对同一笔资金制证——同一笔收付款在总账记两遍。
 * 这里统一规定只有一侧能制证：
 *   - scm     ：收付款单直接生成凭证（默认），凭证号回写到关联的出纳流水，出纳侧对这些流水不得再制证
 *   - cashier ：通过出纳生成凭证，收付款单不得制证；出纳把同一张收付款单的流水合并成一张凭证并回写 scm_doc.voucher_id
 * 两种模式下都保留「另一侧已制证则拦截」的护栏，防止切换参数后产生重复。
 *
 * 本文件不依赖 cashierQuery / scmArAp，两边都可以引用而不形成循环依赖。
 */
import type Database from 'better-sqlite3'
import { assertModuleLicensed } from './licenseService.js'

export const PAYMENT_VOUCHER_MODE_KEY = 'payment_voucher_mode'
export type PaymentVoucherMode = 'scm' | 'cashier'
export const PAYMENT_VOUCHER_MODES: readonly PaymentVoucherMode[] = ['scm', 'cashier']
export const PAYMENT_DOC_TYPES = ['RCV', 'PAY'] as const

export function isPaymentDocType(docType: unknown): boolean {
  return docType === 'RCV' || docType === 'PAY'
}

export function paymentDocLabel(docType: string): string {
  return docType === 'RCV' ? '收款单' : docType === 'PAY' ? '付款单' : docType
}

/** 参数值校验（系统参数保存时调用） */
export function validatePaymentVoucherMode(value: string): string | null {
  if (!value) return null
  return (PAYMENT_VOUCHER_MODES as readonly string[]).includes(value) ? null : '收付款制证方式参数无效'
}

/**
 * 当前账套的收付款制证方式。未设置按 scm；未注册出纳模块时只能由收付款单制证。
 */
export function getPaymentVoucherMode(db: Database.Database, accountSetId: string): PaymentVoucherMode {
  let value = ''
  try {
    const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=? LIMIT 1')
      .get(accountSetId, PAYMENT_VOUCHER_MODE_KEY) as { param_value?: string } | undefined
    value = String(row?.param_value || '')
  } catch {
    return 'scm'
  }
  if (value !== 'cashier') return 'scm'
  try {
    return assertModuleLicensed('cashier', db) ? 'scm' : 'cashier'
  } catch {
    // 授权表缺失的老库 / 测试库：以参数为准
    return 'cashier'
  }
}

/** SQL 片段：出纳流水 j 来源于收付款单（往来台账挂了这条流水）。调用处须把日记账别名设为 j */
export const SCM_LINKED_JOURNAL_SQL =
  `EXISTS (SELECT 1 FROM scm_ar_ap_log sl WHERE sl.account_set_id=j.account_set_id AND sl.cashier_journal_id=j.id AND sl.doc_type IN ('RCV','PAY'))`

export interface ScmJournalSource {
  journal_id: string
  doc_type: string
  doc_no: string
  doc_id: string | null
  doc_voucher_id: string | null
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

/** 按流水 id 批量查来源收付款单；不是来源行的 id 不出现在结果里 */
export function getScmSourcesOfJournals(db: Database.Database, accountSetId: string, journalIds: string[]): Map<string, ScmJournalSource> {
  const map = new Map<string, ScmJournalSource>()
  if (!journalIds.length || !hasTable(db, 'scm_ar_ap_log')) return map
  const hasDoc = hasTable(db, 'scm_doc')
  for (let i = 0; i < journalIds.length; i += 500) {
    const chunk = journalIds.slice(i, i + 500)
    const rows = db.prepare(`
      SELECT l.cashier_journal_id AS journal_id, l.doc_type, l.doc_no,
             ${hasDoc ? 'd.id' : 'NULL'} AS doc_id, ${hasDoc ? 'd.voucher_id' : 'NULL'} AS doc_voucher_id
      FROM scm_ar_ap_log l
      ${hasDoc ? 'LEFT JOIN scm_doc d ON d.account_set_id=l.account_set_id AND d.doc_type=l.doc_type AND d.doc_no=l.doc_no' : ''}
      WHERE l.account_set_id=? AND l.doc_type IN ('RCV','PAY') AND l.cashier_journal_id IN (${chunk.map(() => '?').join(',')})
    `).all(accountSetId, ...chunk) as ScmJournalSource[]
    for (const r of rows) map.set(r.journal_id, r)
  }
  return map
}

export function getScmSourceOfJournal(db: Database.Database, accountSetId: string, journalId: string): ScmJournalSource | null {
  return getScmSourcesOfJournals(db, accountSetId, [journalId]).get(journalId) || null
}

export interface LinkedJournalRow {
  id: string
  account_code: string
  biz_date: string
  summary: string | null
  debit: number
  credit: number
  voucher_id: string | null
  voucher_no: string | null
}

/** 收付款单关联的全部出纳流水（审核时写入） */
export function getLinkedJournals(db: Database.Database, accountSetId: string, docType: string, docNo: string): LinkedJournalRow[] {
  if (!hasTable(db, 'scm_ar_ap_log') || !hasTable(db, 'cashier_journal')) return []
  return db.prepare(`
    SELECT j.id, j.account_code, j.biz_date, j.summary, j.debit, j.credit, j.voucher_id, j.voucher_no
    FROM scm_ar_ap_log l JOIN cashier_journal j ON j.id = l.cashier_journal_id AND j.account_set_id = l.account_set_id
    WHERE l.account_set_id=? AND l.doc_type=? AND l.doc_no=?
    ORDER BY j.biz_date, j.seq
  `).all(accountSetId, docType, docNo) as LinkedJournalRow[]
}
