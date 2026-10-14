/**
 * 供应链「对方科目」解析
 *
 * 供应链生成凭证要用一批对方科目（应收/应付/收入/成本/生产成本/进项税/销项税…），
 * 原实现是「系统参数没配就用一个硬编码默认编码」。问题是那批默认编码来自《企业会计准则》
 * 科目表，而 ACD 导入的账套用的是润衡科目表——进项税在这里是 `2221001001` 而不是 `22210101`。
 * 实测三个账套（含两个 ACD 导入的）**没有一个**存在 `22210101` / `22210105`，
 * 于是客户录第一张带税的采购入库单点「生成凭证」就撞上「科目不存在：22210101」，
 * 而提示语并不告诉他该配成什么。
 *
 * 这里改成三级解析，且只读不写——任何账套（现有的、新建的、导入的、备份恢复的）都自动生效，
 * 不需要迁移，也不会漏掉以后新增的建账路径：
 *   1. 系统参数已配 → 用它（用户显式配置永远优先）
 *   2. 默认编码在本账套存在 → 用它（与旧行为完全一致，已能出凭证的账套不受影响）
 *   3. 都不行 → 按科目名称在本账套里探测（先精确名、再模糊名，优先末级科目）
 * 2、3 命中的若是上级科目，一律下探到最底层末级（上级科目不能直接记账，余额表会丢数）。
 */
import type Database from 'better-sqlite3'
import { descendToLeaf, resolveAssetAccount } from './assetAccountResolver.js'

export interface ScmAccountSpec {
  key: string
  /** 界面上的叫法，用于报错提示 */
  label: string
  /** 按优先级尝试的默认编码（覆盖企业会计准则 / 小企业准则 / 润衡等常见科目表） */
  codes: string[]
  /** 编码都落空时按名称找：先整名相等，再包含匹配 */
  names: string[]
  /** 包含匹配时要排除的名称片段，例如「进项税额转出」不是进项税额 */
  excludes?: string[]
  /** 命中上级科目时，下探末级优先选名称含这些词的（按顺序） */
  leafHints?: string[]
}

export const SCM_ACCOUNT_SPECS: ScmAccountSpec[] = [
  { key: 'scm:acc_ap', label: '应付账款', codes: ['2202', '2121'], names: ['应付账款'] },
  { key: 'scm:acc_ar', label: '应收账款', codes: ['1122', '1131'], names: ['应收账款'] },
  { key: 'scm:acc_revenue', label: '主营业务收入', codes: ['6001', '5001'], names: ['主营业务收入', '销售收入'], leafHints: ['主营', '销售', '销货', '商品', '产品'] },
  { key: 'scm:acc_cost', label: '主营业务成本', codes: ['6401', '5401'], names: ['主营业务成本', '销售成本'], leafHints: ['主营', '销售', '销货', '商品', '产品'] },
  { key: 'scm:acc_other', label: '其他出入库对方科目', codes: ['1901'], names: ['待处理财产损溢'], leafHints: ['流动资产'] },
  { key: 'scm:acc_production', label: '生产成本', codes: ['5001', '4101'], names: ['生产成本'], leafHints: ['直接材料', '材料', '基本生产'] },
  { key: 'scm:acc_labor', label: '应付职工薪酬', codes: ['2211', '2151'], names: ['应付职工薪酬', '应付工资'], leafHints: ['工资'] },
  { key: 'scm:acc_overhead', label: '制造费用', codes: ['5101', '4105'], names: ['制造费用'] },
  { key: 'scm:acc_process_income', label: '受托加工收入', codes: ['6051'], names: ['其他业务收入'], leafHints: ['加工'] },
  {
    key: 'scm:acc_tax_input',
    label: '应交税费—进项税额',
    codes: ['22210101', '2221001001'],
    names: ['进项税额'],
    excludes: ['转出', '待认证', '待抵扣'],
    leafHints: ['进项'],
  },
  {
    key: 'scm:acc_tax_output',
    label: '应交税费—销项税额',
    codes: ['22210105', '2221001005'],
    names: ['销项税额'],
    excludes: ['转出', '待转'],
    leafHints: ['销项'],
  },
]

const SPEC_BY_KEY = new Map(SCM_ACCOUNT_SPECS.map(s => [s.key, s]))

/**
 * param        用户在系统参数里显式配置
 * code         命中默认编码，且该科目名称与业务含义相符
 * name         默认编码不存在，按科目名称探测到
 * code_mismatch 默认编码存在但名称对不上（如行政事业科目表里 6401 叫「经营预算收入」）——
 *              沿用它以保持旧行为不变，但要提醒用户手工配置
 */
export type ScmAccountSource = 'param' | 'code' | 'name' | 'code_mismatch'

export interface ResolvedScmAccount {
  code: string
  name: string
  source: ScmAccountSource
  /** 自动匹配命中的是上级科目、已下探到末级时，记下原上级编码（界面提示用） */
  parent_code?: string
}

interface AccountRow { code: string; name: string }

/** 末级科目优先、编码短的优先——父科目挂账在多数账套里是禁止的 */
function pickBest(db: Database.Database, accountSetId: string, rows: AccountRow[]): AccountRow | undefined {
  if (rows.length <= 1) return rows[0]
  const hasChild = db.prepare(
    'SELECT 1 FROM accounts WHERE account_set_id=? AND code<>? AND code LIKE ? LIMIT 1',
  )
  const scored = rows.map(row => ({
    row,
    leaf: hasChild.get(accountSetId, row.code, `${row.code}%`) ? 0 : 1,
  }))
  scored.sort((a, b) => (b.leaf - a.leaf) || (a.row.code.length - b.row.code.length) || a.row.code.localeCompare(b.row.code))
  return scored[0].row
}

function findByCodes(db: Database.Database, accountSetId: string, codes: string[]): AccountRow | undefined {
  const stmt = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
  for (const code of codes) {
    const hit = stmt.get(accountSetId, code) as AccountRow | undefined
    if (hit) return hit
  }
  return undefined
}

/**
 * 默认编码命中后还要看名称对不对得上。
 * 不同科目表会复用同一段编码：行政事业单位的 6401 叫「经营预算收入」、1901 叫「长期待摊费用」，
 * 只认编码会把主营业务成本静默记进经营预算收入。
 */
function nameLooksRight(spec: ScmAccountSpec, name: string): boolean {
  const text = String(name || '')
  if (!text) return false
  if ((spec.excludes || []).some(word => text.includes(word))) return false
  return spec.names.some(n => text.includes(n) || n.includes(text))
}

function findByNames(db: Database.Database, accountSetId: string, spec: ScmAccountSpec): AccountRow | undefined {
  const excluded = (name: string) => (spec.excludes || []).some(word => name.includes(word))
  // 先整名相等：「进项税额」不会误命中「进项税额转出」
  const exact = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND name=?')
  for (const name of spec.names) {
    const rows = (exact.all(accountSetId, name) as AccountRow[]).filter(r => !excluded(r.name))
    const best = pickBest(db, accountSetId, rows)
    if (best) return best
  }
  // 再包含匹配：兼容「应交增值税(进项税额)」这类写法
  const like = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND name LIKE ?')
  for (const name of spec.names) {
    const rows = (like.all(accountSetId, `%${name}%`) as AccountRow[]).filter(r => !excluded(r.name))
    const best = pickBest(db, accountSetId, rows)
    if (best) return best
  }
  return undefined
}

/** 自动匹配到的是上级科目时下探到最底层末级（启用优先、按 leafHints 优先） */
function toLeaf(
  db: Database.Database,
  accountSetId: string,
  spec: ScmAccountSpec,
  hit: AccountRow,
  source: ScmAccountSource,
): ResolvedScmAccount {
  const leafCode = descendToLeaf(db, accountSetId, hit.code, spec.leafHints || [])
  if (leafCode === hit.code) return { code: hit.code, name: hit.name, source }
  const leaf = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
    .get(accountSetId, leafCode) as AccountRow | undefined
  return { code: leafCode, name: leaf?.name || '', source, parent_code: hit.code }
}

/** 某科目编码下探到最底层末级（已是末级 / 不存在则原样返回） */
export function descendScmAccountToLeaf(db: Database.Database, accountSetId: string, code: string, key?: string): string {
  return descendToLeaf(db, accountSetId, code, (key && SPEC_BY_KEY.get(key)?.leafHints) || [])
}

/**
 * 物料存货科目（物料档案未配时的口径）：按物料类型找根科目再下探到最底层末级。
 * 0 原辅材料 → 原材料；6 半成品 → 自制半成品，找不到退库存商品；其余（成品等）→ 库存商品 / 产成品。
 * 找不到返回 null，调用方再决定兜底。
 */
export function resolveInventoryAccount(
  db: Database.Database,
  accountSetId: string,
  itemType: string | null | undefined,
): { code: string; name: string } | null {
  const type = String(itemType ?? '').trim()
  const goods = { names: ['库存商品', '产成品'], codes: ['1405', '1406', '1243'], excludes: ['跌价', '差异'] }
  if (type === '0') {
    return resolveAssetAccount(db, accountSetId, { names: ['原材料'], codes: ['1403', '1211'], excludes: ['跌价', '差异', '采购'] })
      ?? resolveAssetAccount(db, accountSetId, goods)
  }
  if (type === '6') {
    return resolveAssetAccount(db, accountSetId, { names: ['自制半成品', '半成品'], excludes: ['跌价'] })
      ?? resolveAssetAccount(db, accountSetId, goods)
  }
  return resolveAssetAccount(db, accountSetId, goods)
}

function readParam(db: Database.Database, accountSetId: string, key: string): string {
  const row = db.prepare('SELECT param_value FROM system_params WHERE account_set_id=? AND param_key=?')
    .get(accountSetId, key) as { param_value?: string } | undefined
  return String(row?.param_value ?? '').trim()
}

/**
 * 解析一个供应链对方科目。
 * @returns 命中的科目；账套里确实没有对应科目时返回 null
 */
export function resolveScmAccount(
  db: Database.Database,
  accountSetId: string,
  key: string,
  options: { ignoreParam?: boolean } = {},
): ResolvedScmAccount | null {
  const spec = SPEC_BY_KEY.get(key)
  if (!spec) return null

  // 1) 用户显式配置优先——哪怕配的科目不存在也照用，好让报错指向他配的那个
  //    ignoreParam：按「未配置」口径算（一键预设用）
  const configured = options.ignoreParam ? '' : readParam(db, accountSetId, key)
  if (configured) {
    const hit = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')
      .get(accountSetId, configured) as AccountRow | undefined
    return { code: configured, name: hit?.name || '', source: 'param' }
  }
  // 2) 默认编码存在、且科目名称也对得上 → 用它（与旧行为一致）
  const byCode = findByCodes(db, accountSetId, spec.codes)
  if (byCode && nameLooksRight(spec, byCode.name)) return toLeaf(db, accountSetId, spec, byCode, 'code')
  // 3) 按名称探测
  const byName = findByNames(db, accountSetId, spec)
  if (byName) return toLeaf(db, accountSetId, spec, byName, 'name')
  // 4) 名称也找不到时，仍沿用编码命中的那个科目——不改变旧行为，但标记为需要人工确认
  if (byCode) return toLeaf(db, accountSetId, spec, byCode, 'code_mismatch')
  return null
}

/** 批量解析，供 gen-voucher 一次取齐 */
export function resolveScmAccounts(
  db: Database.Database,
  accountSetId: string,
): Record<string, ResolvedScmAccount | null> {
  const out: Record<string, ResolvedScmAccount | null> = {}
  for (const spec of SCM_ACCOUNT_SPECS) out[spec.key] = resolveScmAccount(db, accountSetId, spec.key)
  return out
}

/** 某个编码对应哪个参数（报错时用来说清楚「这是哪个科目」） */
export function specByDefaultCode(code: string): ScmAccountSpec | undefined {
  return SCM_ACCOUNT_SPECS.find(s => s.codes.includes(code))
}

/** 本账套里该参数的候选科目，供报错提示与参数页占位提示 */
export function suggestScmAccounts(
  db: Database.Database,
  accountSetId: string,
  key: string,
  limit = 5,
): AccountRow[] {
  const spec = SPEC_BY_KEY.get(key)
  if (!spec) return []
  const excluded = (name: string) => (spec.excludes || []).some(word => name.includes(word))
  const seen = new Set<string>()
  const out: AccountRow[] = []
  const push = (rows: AccountRow[]) => {
    for (const r of rows) {
      if (excluded(r.name) || seen.has(r.code)) continue
      seen.add(r.code)
      out.push(r)
      if (out.length >= limit) return
    }
  }
  const byCode = findByCodes(db, accountSetId, spec.codes)
  if (byCode) push([byCode])
  const like = db.prepare('SELECT code, name FROM accounts WHERE account_set_id=? AND name LIKE ? ORDER BY code')
  for (const name of spec.names) {
    if (out.length >= limit) break
    push(like.all(accountSetId, `%${name}%`) as AccountRow[])
  }
  return out
}

/**
 * 生成「科目不存在」的可操作提示：说清楚缺的是哪个业务科目、本账套里有哪些候选、去哪配。
 */
export function buildMissingAccountMessage(
  db: Database.Database,
  accountSetId: string,
  missingCodes: string[],
): string {
  const parts = missingCodes.map(code => {
    const spec = specByDefaultCode(code)
    if (!spec) return code
    const candidates = suggestScmAccounts(db, accountSetId, spec.key)
    const tail = candidates.length
      ? `，本账套可用：${candidates.map(c => `${c.code} ${c.name}`).join('、')}`
      : '，本账套未找到同类科目'
    return `${code}（${spec.label}${tail}）`
  })
  return `科目不存在：${parts.join('；')}。请在「基础资料 → 业务凭证设置 → 进销存凭证设置」中配置，或在会计科目中补建。`
}
