/**
 * FIX-103 配套数据迁移：把历史「不含税」的往来台账补成价税合计。
 *
 * 背景：SO 销售发货 / PI 采购入库审核时，旧实现只按 Σ行金额（不含税）挂应收/应付，
 * 而凭证的应收/应付是含税的。两边差一个税额，导致：
 *   - 总账应收/应付余额 ≠ 往来余额表 / 账龄 / 对账单；
 *   - 客户按含税额付款时，税额部分永远核销不掉，堆在「未核销收款」里。
 * 代码已统一为含税口径，但**存量台账不会自动更正**，需要本脚本补齐。
 *
 * 处理范围：`scm_ar_ap_log` 中 doc_type ∈ (SO, PI)、direction='in' 的记录，
 * 按其来源单据的明细行重算价税合计；只在「现值 == 不含税合计」时才改（说明确实是旧口径），
 * 现值已等于含税合计的跳过（幂等，可重复执行）。其余情况一律跳过并列入 skipped，
 * 交由人工判断——金额被手工改过的记录不应被脚本覆盖。
 *
 * 用法：
 *   # 只看会改什么，不写库（默认）
 *   npx tsx server/src/scripts/fixArApGrossAmount.ts
 *   # 指定账套
 *   npx tsx server/src/scripts/fixArApGrossAmount.ts <accountSetId>
 *   # 确认无误后真正写库
 *   npx tsx server/src/scripts/fixArApGrossAmount.ts <accountSetId> --apply
 */
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/index.js'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface ArApFixRow {
  id: string
  account_set_id: string
  doc_type: string
  doc_no: string
  current_amount: number
  net_amount: number
  gross_amount: number
  verified_amount: number
  action: 'update' | 'already_gross' | 'skip_mismatch' | 'skip_no_source' | 'skip_verified'
}

export interface ArApFixResult {
  applied: boolean
  rows: ArApFixRow[]
  updated: number
  alreadyGross: number
  skipped: number
}

export function fixArApGrossAmount(
  accountSetId?: string,
  options: { apply?: boolean; db?: Database } = {}
): ArApFixResult {
  const db = options.db ?? getDb()
  const apply = options.apply === true

  const conds = ["l.direction='in'", "l.doc_type IN ('SO','PI')"]
  const params: any[] = []
  if (accountSetId) { conds.push('l.account_set_id=?'); params.push(accountSetId) }

  const logs = db.prepare(
    `SELECT l.id, l.account_set_id, l.doc_type, l.doc_no, l.amount, l.verified_amount
       FROM scm_ar_ap_log l
      WHERE ${conds.join(' AND ')}
      ORDER BY l.account_set_id, l.doc_type, l.doc_no`
  ).all(...params) as any[]

  const sumLines = db.prepare(
    `SELECT COALESCE(SUM(ln.amount),0) AS net, COALESCE(SUM(ln.tax_amount),0) AS tax
       FROM scm_doc d JOIN scm_doc_line ln ON ln.doc_id = d.id
      WHERE d.account_set_id=? AND d.doc_type=? AND d.doc_no=?`
  )

  const rows: ArApFixRow[] = []
  for (const log of logs) {
    const s = sumLines.get(log.account_set_id, log.doc_type, log.doc_no) as any
    const net = r2(Number(s?.net || 0))
    const gross = r2(net + Number(s?.tax || 0))
    const current = r2(Number(log.amount || 0))
    const verified = r2(Number(log.verified_amount || 0))

    const base = {
      id: log.id, account_set_id: log.account_set_id, doc_type: log.doc_type, doc_no: log.doc_no,
      current_amount: current, net_amount: net, gross_amount: gross, verified_amount: verified,
    }

    if (net === 0 && gross === 0) { rows.push({ ...base, action: 'skip_no_source' }); continue }
    if (Math.abs(current - gross) < 0.005) { rows.push({ ...base, action: 'already_gross' }); continue }
    // 只认「现值恰好等于不含税合计」的记录——这才是旧口径留下的。
    // 金额被手工改过的（既不等于净额也不等于含税额）不碰，避免脚本覆盖人工调整。
    if (Math.abs(current - net) >= 0.005) { rows.push({ ...base, action: 'skip_mismatch' }); continue }
    // 补税后金额只会变大，不会低于已核销额；此处仍做一次防御性校验
    if (gross < verified - 0.005) { rows.push({ ...base, action: 'skip_verified' }); continue }
    rows.push({ ...base, action: 'update' })
  }

  const toUpdate = rows.filter(r => r.action === 'update')
  if (apply && toUpdate.length) {
    const upd = db.prepare('UPDATE scm_ar_ap_log SET amount=? WHERE id=?')
    db.transaction(() => { for (const r of toUpdate) upd.run(r.gross_amount, r.id) })()
  }

  return {
    applied: apply,
    rows,
    updated: toUpdate.length,
    alreadyGross: rows.filter(r => r.action === 'already_gross').length,
    skipped: rows.filter(r => r.action.startsWith('skip')).length,
  }
}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false
  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('fixArApGrossAmount')) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const accountSetId = args.find(a => !a.startsWith('--'))
  const result = fixArApGrossAmount(accountSetId, { apply })

  for (const r of result.rows) {
    if (r.action === 'already_gross') continue
    const tag = r.action === 'update' ? '将更新' : `跳过(${r.action})`
    console.log(`${tag}  ${r.doc_type} ${r.doc_no}  现值 ${r.current_amount} → 含税 ${r.gross_amount}（不含税 ${r.net_amount}，已核销 ${r.verified_amount}）`)
  }
  console.log(
    `\n${apply ? '已写库' : '试运行（未写库，加 --apply 生效）'}：` +
    `待更新 ${result.updated} 条，已是含税 ${result.alreadyGross} 条，跳过 ${result.skipped} 条，共扫描 ${result.rows.length} 条`
  )
}
