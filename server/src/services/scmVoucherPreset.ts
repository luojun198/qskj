/**
 * 进销存凭证设置「一键自动预设」——只算建议，不写库。
 *
 * 规则（主人确认）：
 *   - 已配置且是末级的保持不动；未配置 / 配成上级 / 科目不存在的才给建议；
 *   - 一律预设到 **最底层末级**：配成上级的从该上级下探（尊重原意），其余按自动匹配口径（已下探）；
 *   - 辅助核算来源恢复为自动识别、匹配规则恢复「名称完全一致」；
 *   - 同时覆盖物料存货科目、往来单位应收 / 应付科目。
 * 结果由前端填到页面，用户核对后随「保存设置」一并提交。
 */
import type Database from 'better-sqlite3'
import {
  SCM_ACCOUNT_SPECS,
  descendScmAccountToLeaf,
  resolveInventoryAccount,
  resolveScmAccount,
} from './scmAccountResolver.js'
import { guessAuxSource, type ScmAuxMatchMode, type ScmAuxSource } from './scmVoucherAux.js'

type Db = Database.Database

export type PresetReason = '未配置' | '非末级' | '科目不存在' | '本账套找不到同类科目'

export interface PresetAccount {
  param_key: string
  label: string
  current: string
  current_name: string
  proposed: string
  proposed_name: string
  reason: PresetReason
}

export interface PresetItem {
  code: string
  name: string
  item_type: string | null
  current: string
  current_name: string
  proposed: string
  proposed_name: string
  reason: PresetReason
}

export interface PresetPartner {
  code: string
  name: string
  partner_type: string
  field: 'ar_account' | 'ap_account'
  current: string
  current_name: string
  proposed: string
  proposed_name: string
  reason: PresetReason
}

export interface ScmPreset {
  accounts: PresetAccount[]
  match_mode: ScmAuxMatchMode
  source_map: Record<string, ScmAuxSource>
  items: PresetItem[]
  partners: PresetPartner[]
}

interface AccState { exists: boolean; leaf: boolean; name: string }

function accountChecker(db: Db, aid: string) {
  const cache = new Map<string, AccState>()
  const get = db.prepare('SELECT id, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  const child = db.prepare('SELECT 1 FROM accounts WHERE account_set_id=? AND parent_id=? LIMIT 1')
  return (code: string): AccState => {
    if (cache.has(code)) return cache.get(code)!
    const row = get.get(aid, code) as { id: string; name: string } | undefined
    const state = row
      ? { exists: true, leaf: !child.get(aid, row.id), name: row.name }
      : { exists: false, leaf: false, name: '' }
    cache.set(code, state)
    return state
  }
}

/**
 * 某个已有取值是否需要预设，需要则给出末级建议。
 * @param fresh 未配置 / 不存在时的建议来源（已是末级）
 */
function proposeFor(
  db: Db, aid: string, check: ReturnType<typeof accountChecker>,
  current: string, fresh: () => string, key?: string,
): { reason: PresetReason; proposed: string } | null {
  const cur = String(current || '').trim()
  let reason: PresetReason
  let proposed: string
  if (!cur) {
    reason = '未配置'; proposed = fresh()
  } else {
    const st = check(cur)
    if (st.exists && st.leaf) return null
    if (st.exists) {
      reason = '非末级'; proposed = descendScmAccountToLeaf(db, aid, cur, key)
    } else {
      reason = '科目不存在'; proposed = fresh()
    }
  }
  // 兜底再确认一次：建议值必须存在且是末级，否则视为找不到
  const st = proposed ? check(proposed) : null
  if (!st || !st.exists || !st.leaf) return { reason: '本账套找不到同类科目', proposed: '' }
  return { reason, proposed }
}

export function buildScmPreset(db: Db, aid: string): ScmPreset {
  const check = accountChecker(db, aid)
  const readParam = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')

  // ── 10 个对方科目 ──
  const accounts: PresetAccount[] = []
  // 预设后的有效取值（往来单位应收 / 应付为空时沿用）
  const effective: Record<string, string> = {}
  for (const spec of SCM_ACCOUNT_SPECS) {
    const current = String((readParam.get(aid, spec.key) as { param_value?: string } | undefined)?.param_value ?? '').trim()
    // 未配置 / 不存在时按自动匹配口径（ignoreParam）重算，结果已下探末级
    const fresh = () => resolveScmAccount(db, aid, spec.key, { ignoreParam: true })?.code || ''
    const p = proposeFor(db, aid, check, current, fresh, spec.key)
    effective[spec.key] = p ? p.proposed : current
    if (!p) continue
    accounts.push({
      param_key: spec.key,
      label: spec.label,
      current,
      current_name: current ? check(current).name : '',
      proposed: p.proposed,
      proposed_name: p.proposed ? check(p.proposed).name : '',
      reason: p.reason,
    })
  }

  // ── 辅助来源 / 匹配规则恢复默认 ──
  const source_map: Record<string, ScmAuxSource> = {}
  const hasAux = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='aux_categories'").get()
  if (hasAux) {
    for (const c of db.prepare('SELECT id, code, name FROM aux_categories WHERE account_set_id=?').all(aid) as Array<{ id: string; code: string; name: string }>) {
      source_map[c.id] = guessAuxSource(c)
    }
  }

  // ── 物料存货科目 ──
  const items: PresetItem[] = []
  const invByType = new Map<string, string>()
  const invFresh = (type: string | null) => {
    const k = String(type ?? '')
    if (!invByType.has(k)) invByType.set(k, resolveInventoryAccount(db, aid, k)?.code || '')
    return invByType.get(k)!
  }
  const itemRows = db.prepare("SELECT code, name, item_type, inv_account FROM scm_item WHERE account_set_id=? AND COALESCE(enabled,1)<>0 ORDER BY code")
    .all(aid) as Array<{ code: string; name: string; item_type: string | null; inv_account: string | null }>
  for (const it of itemRows) {
    const current = String(it.inv_account || '').trim()
    const p = proposeFor(db, aid, check, current, () => invFresh(it.item_type))
    if (!p) continue
    items.push({
      code: it.code, name: it.name || '', item_type: it.item_type,
      current, current_name: current ? check(current).name : '',
      proposed: p.proposed, proposed_name: p.proposed ? check(p.proposed).name : '', reason: p.reason,
    })
  }

  // ── 往来单位应收 / 应付 ──
  const partners: PresetPartner[] = []
  const partnerRows = db.prepare("SELECT code, name, partner_type, ar_account, ap_account FROM scm_partner WHERE account_set_id=? AND COALESCE(enabled,1)<>0 ORDER BY code")
    .all(aid) as Array<{ code: string; name: string; partner_type: string | null; ar_account: string | null; ap_account: string | null }>
  for (const pt of partnerRows) {
    const type = pt.partner_type || 'both'
    const fields: Array<['ar_account' | 'ap_account', string]> = []
    if (type !== 'supplier') fields.push(['ar_account', 'scm:acc_ar'])
    if (type !== 'customer') fields.push(['ap_account', 'scm:acc_ap'])
    for (const [field, key] of fields) {
      const current = String(pt[field] || '').trim()
      const p = proposeFor(db, aid, check, current, () => effective[key] || '', key)
      if (!p) continue
      partners.push({
        code: pt.code, name: pt.name || '', partner_type: type, field,
        current, current_name: current ? check(current).name : '',
        proposed: p.proposed, proposed_name: p.proposed ? check(p.proposed).name : '', reason: p.reason,
      })
    }
  }

  return { accounts, match_mode: 'name', source_map, items, partners }
}

