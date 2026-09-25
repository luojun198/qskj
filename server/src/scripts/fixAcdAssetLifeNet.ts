/**
 * FIX-274 配套数据修正：ACD 导入的固定资产卡片「使用月数 / 使用年限」互换 + 净值为 0。
 *
 * 背景（评审 P0-1 / P0-2）：
 *   - 旧导入把 zc_gdzc.synx（年限）写进 use_months、synx_y（月数）写进 use_years，
 *     折旧预览条件 depr_months_done < use_months 恒假，资产静默不计提；
 *   - 净值列 zcjz 为空时落 0，折旧基数（净值 − 残值）归零。
 * 导入代码已修正，但重新导入前的存量卡片不会自愈，需要本脚本修正。
 *
 * 处理范围：fixed_asset 中 acd_raw 非空（来自 ACD）的卡片。
 *   - 年限：仅当卡片仍是旧错位状态（use_months == synx 且 use_years == synx_y）时改为正确值；
 *     被人工改过的卡片跳过并列出，交由人工判断。
 *   - 净值：仅当 ACD 净值列为空、库内 net_value = 0、且「原值 − 累计折旧 − 减值」≠ 0 时补算。
 * 幂等，可重复执行。
 *
 * 用法：
 *   # 只看会改什么，不写库（默认）
 *   npx tsx server/src/scripts/fixAcdAssetLifeNet.ts [accountSetId] [--csv=清单.csv]
 *   # 确认无误后真正写库
 *   npx tsx server/src/scripts/fixAcdAssetLifeNet.ts [accountSetId] --apply
 */
import type { Database } from 'better-sqlite3'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { getDb } from '../db/index.js'
import { acdAssetLife } from './importAcdCashierAsset.js'

const r2 = (n: number) => Math.round(n * 100) / 100
const toInt = (v: unknown): number | null => {
  const n = parseInt(String(v ?? '').replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export interface AcdAssetFixRow {
  id: string
  account_set_id: string
  asset_no: string
  asset_name: string
  status_code: string | null
  original_value: number
  accum_depr: number
  depr_months_done: number
  old_use_months: number | null
  old_use_years: number | null
  new_use_months: number | null
  new_use_years: number | null
  old_net_value: number
  new_net_value: number
  life: 'fix' | 'ok' | 'skip_edited'
  net: 'fix' | 'ok'
  /** 修正后已计提月数 ≥ 使用月数（已提满），仅提示 */
  fullyDepreciated: boolean
}

export function fixAcdAssetLifeNet(
  accountSetId?: string,
  options: { apply?: boolean; db?: Database } = {}
) {
  const db = options.db ?? getDb()
  const rows = db
    .prepare(
      `SELECT id, account_set_id, asset_no, asset_name, status_code, original_value, accum_depr,
              COALESCE(impairment_amount, 0) AS impairment_amount, net_value, use_months, use_years,
              COALESCE(depr_months_done, 0) AS depr_months_done, acd_raw
       FROM fixed_asset
       WHERE acd_raw IS NOT NULL ${accountSetId ? 'AND account_set_id = ?' : ''}
       ORDER BY account_set_id, asset_no`
    )
    .all(...(accountSetId ? [accountSetId] : [])) as any[]

  const result: AcdAssetFixRow[] = []
  for (const a of rows) {
    let raw: string[]
    try {
      raw = JSON.parse(a.acd_raw)
    } catch {
      continue
    }
    if (!Array.isArray(raw)) continue

    const life = acdAssetLife(raw[11], raw[34])
    let lifeAction: AcdAssetFixRow['life'] = 'ok'
    if (a.use_months !== life.useMonths || a.use_years !== life.useYears) {
      const stillSwapped = a.use_months === toInt(raw[11]) && a.use_years === toInt(raw[34])
      lifeAction = stillSwapped ? 'fix' : 'skip_edited'
    }

    const expectedNet = r2(Number(a.original_value || 0) - Number(a.accum_depr || 0) - Number(a.impairment_amount || 0))
    const netAction: AcdAssetFixRow['net'] =
      String(raw[23] ?? '').trim() === '' && Number(a.net_value || 0) === 0 && expectedNet !== 0 ? 'fix' : 'ok'

    if (lifeAction === 'ok' && netAction === 'ok') continue
    const newUseMonths = lifeAction === 'fix' ? life.useMonths : a.use_months
    result.push({
      id: a.id,
      account_set_id: a.account_set_id,
      asset_no: a.asset_no,
      asset_name: a.asset_name,
      status_code: a.status_code,
      original_value: a.original_value,
      accum_depr: a.accum_depr,
      depr_months_done: a.depr_months_done,
      old_use_months: a.use_months,
      old_use_years: a.use_years,
      new_use_months: newUseMonths,
      new_use_years: lifeAction === 'fix' ? life.useYears : a.use_years,
      old_net_value: a.net_value,
      new_net_value: netAction === 'fix' ? expectedNet : a.net_value,
      life: lifeAction,
      net: netAction,
      fullyDepreciated: newUseMonths != null && a.depr_months_done >= newUseMonths,
    })
  }

  if (options.apply) {
    const upd = db.prepare(
      `UPDATE fixed_asset SET use_months = ?, use_years = ?, net_value = ?, updated_at = datetime('now') WHERE id = ?`
    )
    db.transaction(() => {
      for (const r of result) {
        if (r.life !== 'fix' && r.net !== 'fix') continue
        upd.run(r.new_use_months, r.new_use_years, r.new_net_value, r.id)
      }
    })()
  }

  return {
    rows: result,
    lifeFixed: result.filter(r => r.life === 'fix').length,
    lifeSkipped: result.filter(r => r.life === 'skip_edited').length,
    netFixed: result.filter(r => r.net === 'fix').length,
  }
}

function toCsv(rows: AcdAssetFixRow[]): string {
  const head = [
    '账套ID', '资产编号', '资产名称', '状态', '原值', '累计折旧', '已计提月数',
    '原使用月数', '新使用月数', '原使用年限', '新使用年限', '原净值', '新净值', '年限处理', '净值处理', '已提满',
  ]
  const esc = (v: unknown) => {
    const t = v == null ? '' : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const lines = rows.map(r =>
    [
      r.account_set_id, r.asset_no, r.asset_name, r.status_code, r.original_value, r.accum_depr, r.depr_months_done,
      r.old_use_months, r.new_use_months, r.old_use_years, r.new_use_years, r.old_net_value, r.new_net_value,
      r.life, r.net, r.fullyDepreciated ? '是' : '',
    ].map(esc).join(',')
  )
  return '﻿' + [head.join(','), ...lines].join('\n')
}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false
  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('fixAcdAssetLifeNet')) {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const csvArg = args.find(a => a.startsWith('--csv='))
  const accountSetId = args.find(a => !a.startsWith('--'))
  const result = fixAcdAssetLifeNet(accountSetId, { apply })

  if (csvArg) writeFileSync(csvArg.slice('--csv='.length), toCsv(result.rows), 'utf8')
  for (const r of result.rows.filter(x => x.life === 'skip_edited')) {
    console.log(`跳过（年限被人工改过）${r.asset_no} ${r.asset_name}：use_months=${r.old_use_months} use_years=${r.old_use_years}`)
  }
  console.log(
    `\n${apply ? '已写库' : '试运行（未写库，加 --apply 生效）'}：` +
      `年限互换 ${result.lifeFixed} 张，净值补算 ${result.netFixed} 张，年限跳过 ${result.lifeSkipped} 张，涉及 ${result.rows.length} 张`
  )
}
