/**
 * 进销存 ACD 导入：基础档案
 *   ckda → scm_warehouse，dlk / xlk → scm_item_category，cpda → scm_item（+ scm_unit / scm_item_unit），
 *   khda → scm_partner；cpsx 物料属性映射到本系统物料属性字典（scm:item_types）。
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { assertLeafAccountCode } from '../accountReferences.js'
import { type AcdTableSet, acdNum, acdStr } from './acdTables.js'
import { type ImportContext, type ImportCounter, newCounter, partnerTypeFromAcd, pushIssue } from './types.js'

export { partnerTypeFromAcd }

export interface MasterStats {
  warehouses: ImportCounter
  categories: ImportCounter
  units: ImportCounter
  items: ImportCounter
  partners: ImportCounter
  placeholders: { items: string[]; partners: string[]; warehouses: string[] }
}

/** 本系统内置物料属性：0 原辅材料 / 6 半成品 / 9 成品 */
const BUILTIN_ITEM_TYPES: Record<string, string> = { '0': '原辅材料', '6': '半成品', '9': '成品' }

/** 按名称把润衡物料属性（cpsx）映射到本系统属性码；没有对应的追加为自定义属性 */
export function buildItemTypeMap(db: Database.Database, aid: string, cpsx: Array<{ sx: string; sx_mc: string }>): Map<string, string> {
  const row = db.prepare("SELECT id, param_value FROM system_params WHERE account_set_id=? AND param_key='scm:item_types'").get(aid) as any
  let custom: Record<string, string> = {}
  try { custom = row?.param_value ? JSON.parse(row.param_value) : {} } catch { custom = {} }
  const all = (): Record<string, string> => ({ ...BUILTIN_ITEM_TYPES, ...custom })
  const findByName = (name: string) => Object.entries(all()).find(([, n]) => n === name)?.[0]
  const map = new Map<string, string>()
  let changed = false
  for (const r of cpsx) {
    const name = String(r.sx_mc || '').trim()
    if (!r.sx || !name) continue
    let code = findByName(name)
    if (!code && /原材料|原料|材料/.test(name)) code = '0'
    if (!code && /半成品/.test(name)) code = '6'
    if (!code && /成品/.test(name)) code = '9'
    if (!code) {
      const next = Math.max(10, ...Object.keys(all()).map(Number).filter(n => !Number.isNaN(n))) + 1
      code = String(next)
      custom[code] = name
      changed = true
    }
    map.set(r.sx, code)
  }
  if (changed) {
    const value = JSON.stringify(custom)
    if (row) db.prepare('UPDATE system_params SET param_value=? WHERE id=?').run(value, row.id)
    else db.prepare('INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?,?,?,?)').run(uuidv4(), aid, 'scm:item_types', value)
  }
  return map
}

/** 科目在目标账套存在且为末级才保留，否则置空；不合格科目按编码汇总，导入结束统一提示 */
function makeAccountChecker(db: Database.Database, ctx: ImportContext) {
  const cache = new Map<string, boolean>()
  const bad = new Map<string, { count: number; labels: Set<string> }>()
  const check = (code: string | null, label: string): string | null => {
    if (!code) return null
    let ok = cache.get(code)
    if (ok === undefined) {
      try { assertLeafAccountCode(db as any, ctx.accountSetId, code, label); ok = true } catch { ok = false }
      cache.set(code, ok)
    }
    if (!ok) {
      const b = bad.get(code) || { count: 0, labels: new Set<string>() }
      b.count++; b.labels.add(label)
      bad.set(code, b)
    }
    return ok ? code : null
  }
  const flush = () => {
    for (const [code, b] of bad) {
      pushIssue(ctx, 'warn', '科目', `科目 ${code} 在本账套不存在或不是末级科目：${b.count} 个档案的${[...b.labels].join(' / ')}已置空，请补建科目后在档案中补选`)
    }
  }
  return { check, flush }
}

export function importMasterData(db: Database.Database, t: AcdTableSet, ctx: ImportContext): MasterStats {
  const aid = ctx.accountSetId
  const overwrite = ctx.options.conflict === 'overwrite'
  const stats: MasterStats = {
    warehouses: newCounter(), categories: newCounter(), units: newCounter(), items: newCounter(), partners: newCounter(),
    placeholders: { items: [], partners: [], warehouses: [] },
  }
  const accountChecker = makeAccountChecker(db, ctx)
  const checkAccount = accountChecker.check

  // ── 仓库 ckda ──
  const whExists = db.prepare('SELECT id FROM scm_warehouse WHERE account_set_id=? AND code=?')
  const whIns = db.prepare(`INSERT INTO scm_warehouse (id, account_set_id, code, name, attr, keeper, address, phone, partner_code, import_batch_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const whUpd = db.prepare('UPDATE scm_warehouse SET name=?, attr=?, keeper=?, address=?, phone=?, partner_code=? WHERE id=?')
  for (const r of t.get('ckda')) {
    const code = acdStr(r.ckbh)
    if (!code) continue
    const vals = [acdStr(r.ckmc) || code, acdStr(r.sx), acdStr(r.lxr), acdStr(r.txdz), acdStr(r.lxdh), acdStr(r.khbh)]
    const ex = whExists.get(aid, code) as any
    if (!ex) { whIns.run(uuidv4(), aid, code, ...vals, ctx.batchId); stats.warehouses.inserted++ }
    else if (overwrite) { whUpd.run(...vals, ex.id); stats.warehouses.updated++ }
    else stats.warehouses.skipped++
  }

  // ── 分类 dlk（大类）/ xlk（小类）：润衡两者编码各自独立，小类加 X 前缀避免与大类撞号 ──
  const catExists = db.prepare('SELECT id FROM scm_item_category WHERE account_set_id=? AND code=?')
  const catIns = db.prepare('INSERT INTO scm_item_category (id, account_set_id, code, name, parent_code, import_batch_id) VALUES (?,?,?,?,?,?)')
  const catUpd = db.prepare('UPDATE scm_item_category SET name=? WHERE id=?')
  const addCat = (code: string | null, name: string | null) => {
    if (!code) return
    const ex = catExists.get(aid, code) as any
    if (!ex) { catIns.run(uuidv4(), aid, code, name || code, null, ctx.batchId); stats.categories.inserted++ }
    else if (overwrite) { catUpd.run(name || code, ex.id); stats.categories.updated++ }
    else stats.categories.skipped++
  }
  for (const r of t.get('dlk')) addCat(acdStr(r.dlm), acdStr(r.dlmc))
  for (const r of t.get('xlk')) { const c = acdStr(r.xlm); addCat(c ? `X${c}` : null, acdStr(r.xlmc)) }

  // ── 计量单位：取物料档案里出现过的单位名称 ──
  const unitByName = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=? AND name=?')
  const unitCodes = db.prepare('SELECT code FROM scm_unit WHERE account_set_id=?')
  const unitIns = db.prepare('INSERT INTO scm_unit (id, account_set_id, code, name, import_batch_id) VALUES (?,?,?,?,?)')
  let unitSeq = 0
  for (const r of unitCodes.all(aid) as any[]) {
    const m = String(r.code || '').match(/^UN(\d+)$/)
    if (m) unitSeq = Math.max(unitSeq, Number(m[1]))
  }
  const ensureUnit = (name: string | null): string | null => {
    if (!name) return null
    const ex = unitByName.get(aid, name) as any
    if (ex) return ex.code
    unitSeq++
    const code = `UN${String(unitSeq).padStart(4, '0')}`
    unitIns.run(uuidv4(), aid, code, name, ctx.batchId)
    stats.units.inserted++
    return code
  }

  // ── 物料 cpda ──
  const typeMap = buildItemTypeMap(db, aid, t.get('cpsx') as any)
  const itemExists = db.prepare('SELECT id FROM scm_item WHERE account_set_id=? AND code=?')
  const itemIns = db.prepare(`INSERT INTO scm_item
    (id, account_set_id, code, name, spec, barcode, short_code, unit, category_code, subcategory_code, item_type,
     purchase_price, sale_price, ref_cost, inv_account, sale_account, batch_flag, supplier_code, remark, enabled,
     shelf_life_days, volume, buyer, sale_price2, sale_price3, acd_raw, import_batch_id, audit_status, audited_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'audited', datetime('now','localtime'))`)
  const itemUpd = db.prepare(`UPDATE scm_item SET name=?, spec=?, barcode=?, short_code=?, unit=?, category_code=?, subcategory_code=?, item_type=?,
     purchase_price=?, sale_price=?, ref_cost=?, inv_account=?, sale_account=?, batch_flag=?, supplier_code=?, remark=?, enabled=?,
     shelf_life_days=?, volume=?, buyer=?, sale_price2=?, sale_price3=?, acd_raw=?, updated_at=datetime('now') WHERE id=?`)
  const itemUnitDel = db.prepare('DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code=?')
  const itemUnitIns = db.prepare('INSERT INTO scm_item_unit (id, account_set_id, item_code, unit_code, is_primary, conversion_rate) VALUES (?,?,?,?,1,1)')
  for (const r of t.get('cpda')) {
    const code = acdStr(r.cpbh)
    if (!code) continue
    const unitName = acdStr(r.jldw)
    const unitCode = ensureUnit(unitName)
    const sx = acdStr(r.sx)
    const itemType = sx ? (typeMap.get(sx) ?? null) : null
    const remark = [acdStr(r.sm0), acdStr(r.hg_bh) ? `海关编码 ${r.hg_bh}` : null].filter(Boolean).join('；') || null
    const vals = [
      acdStr(r.cpmc) || code, acdStr(r.gg), acdStr(r.txm), acdStr(r.jm), unitName,
      acdStr(r.dlm), acdStr(r.xlm) ? `X${r.xlm}` : null, itemType,
      acdNum(r.rkdj), acdNum(r.xsdj), acdNum(r.ckdj),
      checkAccount(acdStr(r.kmbm), '物料存货科目'), checkAccount(acdStr(r.kmbm_xs), '物料收入科目'),
      r.ph_bz === '1' ? 1 : 0, acdStr(r.khbh), remark, r.ty_bz === '1' ? 0 : 1,
      Math.trunc(acdNum(r.bzq)), acdNum(r.tj), acdStr(r.s_cgy), acdNum(r.yddj1), acdNum(r.yddj2),
      JSON.stringify(r),
    ]
    const ex = itemExists.get(aid, code) as any
    if (!ex) {
      itemIns.run(uuidv4(), aid, code, ...vals, ctx.batchId)
      stats.items.inserted++
    } else if (overwrite) {
      itemUpd.run(...vals, ex.id)
      stats.items.updated++
    } else { stats.items.skipped++; continue }
    if (unitCode) { itemUnitDel.run(aid, code); itemUnitIns.run(uuidv4(), aid, code, unitCode) }
  }

  // ── 往来单位 khda ──
  const pExists = db.prepare('SELECT id FROM scm_partner WHERE account_set_id=? AND code=?')
  const pIns = db.prepare(`INSERT INTO scm_partner
    (id, account_set_id, code, name, short_name, partner_type, partner_attr, ar_account, ap_account, credit_limit, tax_rate,
     region_code, contact, phone, address, bank_name, bank_account, tax_no, salesman, remark, ship_address, ship_phone, ship_contact,
     province, city, county, country, payment_type, credit_days, qq, email, wechat, enabled, acd_raw, import_batch_id, audit_status, audited_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'audited', datetime('now','localtime'))`)
  const pUpd = db.prepare(`UPDATE scm_partner SET name=?, short_name=?, partner_type=?, partner_attr=?, ar_account=?, ap_account=?, credit_limit=?, tax_rate=?,
     region_code=?, contact=?, phone=?, address=?, bank_name=?, bank_account=?, tax_no=?, salesman=?, remark=?, ship_address=?, ship_phone=?, ship_contact=?,
     province=?, city=?, county=?, country=?, payment_type=?, credit_days=?, qq=?, email=?, wechat=?, enabled=?, acd_raw=?, updated_at=datetime('now') WHERE id=?`)
  for (const r of t.get('khda')) {
    const code = acdStr(r.dwbh)
    if (!code) continue
    const ptype = partnerTypeFromAcd(r.sx)
    const vals = [
      acdStr(r.dwmc) || code, acdStr(r.dw_jc), ptype, acdStr(r.sx),
      checkAccount(acdStr(r.yskm), '往来单位应收科目'), checkAccount(acdStr(r.yfkm), '往来单位应付科目'),
      acdNum(r.xyed), acdNum(r.slv),
      acdStr(r.dqbh), acdStr(r.lxr), acdStr(r.lxdh), acdStr(r.txdz), acdStr(r.khyh), acdStr(r.yhzh), acdStr(r.nsh), acdStr(r.ywy),
      [acdStr(r.bz), acdStr(r.fpzl) ? `发票类型：${r.fpzl}` : null].filter(Boolean).join('；') || null,
      acdStr(r.shdz), acdStr(r.shdh), acdStr(r.shlxr),
      acdStr(r.shen), acdStr(r.shi), acdStr(r.xian), acdStr(r.gj), acdStr(r.fklx), Math.trunc(acdNum(r.ts)),
      acdStr(r.qq), acdStr(r.email), acdStr(r.wx), 1, JSON.stringify(r),
    ]
    const ex = pExists.get(aid, code) as any
    if (!ex) { pIns.run(uuidv4(), aid, code, ...vals, ctx.batchId); stats.partners.inserted++ }
    else if (overwrite) { pUpd.run(...vals, ex.id); stats.partners.updated++ }
    else stats.partners.skipped++
  }
  accountChecker.flush()
  return stats
}

/**
 * 单据引用了档案里没有的编码（润衡删了档案但单据还在）：补一个停用的占位档案，保证单据能导入，并在报告里列出。
 */
export function ensurePlaceholders(
  db: Database.Database, ctx: ImportContext, stats: MasterStats,
  refs: { items: Set<string>; partners: Set<string>; warehouses: Set<string> }
) {
  const aid = ctx.accountSetId
  const has = (table: string) => db.prepare(`SELECT 1 FROM ${table} WHERE account_set_id=? AND code=?`)
  const hasItem = has('scm_item'); const hasPartner = has('scm_partner'); const hasWh = has('scm_warehouse')
  for (const code of refs.items) {
    if (hasItem.get(aid, code)) continue
    db.prepare(`INSERT INTO scm_item (id, account_set_id, code, name, enabled, remark, import_batch_id) VALUES (?,?,?,?,0,?,?)`)
      .run(uuidv4(), aid, code, `未知物料 ${code}`, '润衡档案中已不存在，导入单据时自动补建', ctx.batchId)
    stats.placeholders.items.push(code)
    pushIssue(ctx, 'warn', '档案', `物料 ${code} 在润衡物料档案中不存在（单据仍引用），已补建停用的占位物料，请核对名称规格`)
  }
  for (const code of refs.partners) {
    if (hasPartner.get(aid, code)) continue
    db.prepare(`INSERT INTO scm_partner (id, account_set_id, code, name, partner_type, enabled, remark, import_batch_id) VALUES (?,?,?,?,'both',0,?,?)`)
      .run(uuidv4(), aid, code, `未知单位 ${code}`, '润衡档案中已不存在，导入单据时自动补建', ctx.batchId)
    stats.placeholders.partners.push(code)
    pushIssue(ctx, 'warn', '档案', `往来单位 ${code} 在润衡档案中不存在（单据仍引用），已补建占位单位`)
  }
  for (const code of refs.warehouses) {
    if (hasWh.get(aid, code)) continue
    db.prepare(`INSERT INTO scm_warehouse (id, account_set_id, code, name, remark, import_batch_id) VALUES (?,?,?,?,?,?)`)
      .run(uuidv4(), aid, code, `仓库 ${code}`, '润衡档案中已不存在，导入单据时自动补建', ctx.batchId)
    stats.placeholders.warehouses.push(code)
    pushIssue(ctx, 'warn', '档案', `仓库 ${code} 在润衡档案中不存在（单据仍引用），已补建占位仓库`)
  }
}
