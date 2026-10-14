/**
 * 收付款单 / 出纳重复制证：存量数据检测与修复（配套「收付款制证方式」参数 payment_voucher_mode）
 *
 * 背景：收款单 RCV / 付款单 PAY 审核时同时写往来台账与出纳流水。旧版本两侧都能生成凭证且互不回写，
 * 同一笔资金可能在总账里记了两张凭证（银行、应收应付翻倍）。代码已改为严格单侧制证，
 * 但**存量数据不会自动更正**，需要本脚本检测 / 修复。
 *
 * 分类（按单据）：
 *   ok            两侧一致（单据凭证 = 全部流水凭证），或都未制证
 *   duplicate     单据凭证与出纳凭证并存 → 按账套当前参数保留一侧，删除另一侧未记账凭证并补回写
 *   scm_only      只有单据凭证、流水未回写 → 把单据凭证号回写到流水
 *   cashier_only  只有出纳凭证、单据未回写 → 流水共用同一张凭证时回写 scm_doc.voucher_id，否则仅报告
 *   posted_conflict 重复但待删一侧已记账 → 仅报告，需先反记账后再跑
 *
 * 用法（默认试运行，不写库）：
 *   npm run db:fix:scm-cashier-dup --workspace=server
 *   npm run db:fix:scm-cashier-dup --workspace=server -- <accountSetId>
 *   npm run db:fix:scm-cashier-dup --workspace=server -- [accountSetId] --apply   # 写库前自动备份数据库文件
 */
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.js'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { deleteVoucherWithRefs } from '../services/voucherDelete.js'
import { getPaymentVoucherMode, type PaymentVoucherMode } from '../services/paymentVoucherMode.js'

export type DupAction = 'ok' | 'duplicate' | 'scm_only' | 'cashier_only' | 'posted_conflict' | 'manual'

export interface DupRow {
  account_set_id: string
  mode: PaymentVoucherMode
  doc_id: string
  doc_type: string
  doc_no: string
  scm_voucher_no: string | null
  cashier_voucher_nos: string[]
  action: DupAction
  note: string
}

interface VoucherLite { id: string; voucher_no: string; status: string; source: string | null; year: number; period: number; voucher_type_id: string | null }

function hasTable(db: Database, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}

export function fixScmCashierDupVoucher(
  accountSetId?: string,
  options: { apply?: boolean; db?: Database } = {},
): { applied: boolean; rows: DupRow[] } {
  const db = options.db ?? getDb()
  const apply = options.apply === true
  const rows: DupRow[] = []
  if (!hasTable(db, 'scm_doc') || !hasTable(db, 'scm_ar_ap_log') || !hasTable(db, 'cashier_journal')) return { applied: apply, rows }

  const docs = db.prepare(`
    SELECT d.id, d.account_set_id, d.doc_type, d.doc_no, d.voucher_id FROM scm_doc d
    WHERE d.doc_type IN ('RCV','PAY') AND d.status='audited' ${accountSetId ? 'AND d.account_set_id=?' : ''}
    ORDER BY d.account_set_id, d.doc_date, d.doc_no
  `).all(...(accountSetId ? [accountSetId] : [])) as Array<{ id: string; account_set_id: string; doc_type: string; doc_no: string; voucher_id: string | null }>

  const getVoucher = db.prepare('SELECT id, voucher_no, status, source, year, period, voucher_type_id FROM vouchers WHERE id=?')
  const getVoucherByNo = db.prepare(`SELECT id, voucher_no, status, source, year, period, voucher_type_id FROM vouchers
    WHERE account_set_id=? AND year=? AND period=? AND CAST(voucher_no AS TEXT)=CAST(? AS TEXT) AND source='cashier' LIMIT 1`)
  const linked = db.prepare(`SELECT j.id, j.voucher_id, j.voucher_no, j.voucher_year, j.voucher_month
    FROM scm_ar_ap_log l JOIN cashier_journal j ON j.id=l.cashier_journal_id AND j.account_set_id=l.account_set_id
    WHERE l.account_set_id=? AND l.doc_type=? AND l.doc_no=?`)
  const writeJournal = db.prepare(`UPDATE cashier_journal SET voucher_year=?, voucher_month=?, voucher_type=?, voucher_no=?, voucher_id=? WHERE id=?`)
  const writeDoc = db.prepare('UPDATE scm_doc SET voucher_id=? WHERE id=?')
  const modeCache = new Map<string, PaymentVoucherMode>()

  const work: Array<() => void> = []
  for (const d of docs) {
    let mode = modeCache.get(d.account_set_id)
    if (!mode) { mode = getPaymentVoucherMode(db as any, d.account_set_id); modeCache.set(d.account_set_id, mode) }
    const journals = linked.all(d.account_set_id, d.doc_type, d.doc_no) as any[]
    if (!journals.length) continue
    const scmV = d.voucher_id ? (getVoucher.get(d.voucher_id) as VoucherLite | undefined) || null : null
    // 每条流水实际指向的凭证（存量行可能只有 年/期/号）
    const jv = new Map<string, VoucherLite | null>()
    for (const j of journals) {
      const v = j.voucher_id
        ? (getVoucher.get(j.voucher_id) as VoucherLite | undefined) || null
        : j.voucher_no != null ? (getVoucherByNo.get(d.account_set_id, j.voucher_year, j.voucher_month, j.voucher_no) as VoucherLite | undefined) || null : null
      jv.set(j.id, v)
    }
    const cashierVs = [...new Map([...jv.values()].filter((v): v is VoucherLite => !!v && v.id !== scmV?.id).map(v => [v.id, v])).values()]
    const base = {
      account_set_id: d.account_set_id, mode, doc_id: d.id, doc_type: d.doc_type, doc_no: d.doc_no,
      scm_voucher_no: scmV?.voucher_no ?? null, cashier_voucher_nos: cashierVs.map(v => v.voucher_no),
    }
    const allOnScm = !!scmV && journals.every(j => jv.get(j.id)?.id === scmV.id)
    if ((!scmV && !cashierVs.length) || allOnScm) { rows.push({ ...base, action: 'ok', note: '' }); continue }

    const backfillJournals = (v: VoucherLite) => () => {
      for (const j of journals) writeJournal.run(v.year, v.period, v.voucher_type_id, v.voucher_no, v.id, j.id)
    }

    if (scmV && !cashierVs.length) {
      rows.push({ ...base, action: 'scm_only', note: '把单据凭证号回写到流水' })
      work.push(backfillJournals(scmV))
      continue
    }
    if (!scmV) {
      const allSame = cashierVs.length === 1 && journals.every(j => jv.get(j.id)?.id === cashierVs[0].id)
      if (allSame) {
        rows.push({ ...base, action: 'cashier_only', note: '回写单据凭证号' })
        work.push(() => writeDoc.run(cashierVs[0].id, d.id))
      } else {
        rows.push({ ...base, action: 'manual', note: '出纳按行拆成多张凭证 / 部分流水未制证，请人工处理（建议删除出纳凭证后按当前参数重新制证）' })
      }
      continue
    }
    // 两侧都有凭证：重复
    const dropSide: VoucherLite[] = mode === 'scm' ? cashierVs : [scmV]
    const posted = dropSide.filter(v => v.status === 'posted')
    if (posted.length) {
      rows.push({ ...base, action: 'posted_conflict', note: `待删凭证已记账：${posted.map(v => v.voucher_no).join('、')}，请先反记账` })
      continue
    }
    if (mode === 'cashier' && !(cashierVs.length === 1 && journals.every(j => jv.get(j.id)?.id === cashierVs[0].id))) {
      rows.push({ ...base, action: 'manual', note: '出纳凭证不是整单一张，无法自动保留出纳侧，请人工处理' })
      continue
    }
    rows.push({ ...base, action: 'duplicate', note: `保留${mode === 'scm' ? '单据' : '出纳'}凭证，删除 ${dropSide.map(v => v.voucher_no).join('、')}` })
    work.push(() => {
      for (const v of dropSide) deleteVoucherWithRefs(db as any, d.account_set_id, v)
      if (mode === 'scm') backfillJournals(scmV)()
      else writeDoc.run(cashierVs[0].id, d.id)
    })
  }

  if (apply && work.length) db.transaction(() => { for (const w of work) w() })()
  return { applied: apply, rows }
}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false
  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('fixScmCashierDupVoucher')) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const accountSetId = args.find(a => !a.startsWith('--'))
  const run = async () => {
    if (apply) {
      const db = getDb()
      const backupPath = `${db.name}.bak-scm-cashier-dup-${new Date().toISOString().replace(/[:.]/g, '-')}`
      await db.backup(backupPath)
      console.log(`已备份数据库：${backupPath}`)
    }
    const { rows } = fixScmCashierDupVoucher(accountSetId, { apply })
    const label: Record<DupAction, string> = {
      ok: '一致', duplicate: '重复制证', scm_only: '流水未回写', cashier_only: '单据未回写', posted_conflict: '重复(已记账)', manual: '需人工',
    }
    for (const r of rows) {
      if (r.action === 'ok') continue
      console.log(`[${label[r.action]}] 账套 ${r.account_set_id}（${r.mode === 'scm' ? '单据制证' : '出纳制证'}） ${r.doc_type} ${r.doc_no}` +
        `  单据凭证 ${r.scm_voucher_no ?? '-'}  出纳凭证 ${r.cashier_voucher_nos.join('、') || '-'}  ${r.note}`)
    }
    const count = (a: DupAction) => rows.filter(r => r.action === a).length
    console.log(`\n${apply ? '已写库' : '试运行（未写库，加 --apply 生效）'}：共 ${rows.length} 张收付款单；` +
      `重复 ${count('duplicate')}、流水未回写 ${count('scm_only')}、单据未回写 ${count('cashier_only')}、` +
      `已记账冲突 ${count('posted_conflict')}、需人工 ${count('manual')}、一致 ${count('ok')}`)
  }
  run().catch(e => { console.error(e); process.exit(1) })
}
