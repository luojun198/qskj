/**
 * 资产模块默认科目解析：按「科目名称」定位根科目，再下探到最底层末级科目。
 *
 * 不再把 1601 / 1602 / 1606 / 6602 这类一级编码写死：不同会计制度的科目编码不同，
 * 写死的编码在别的制度里不存在，甚至是别的科目（如 5001 在小企业准则是「生产成本」，在其他制度是「主营业务收入」），
 * 而一级科目有下级时也不能直接记账（FIX-336）。找不到就返回 null，由调用方留空并提示，绝不猜编码。
 */
import type Database from 'better-sqlite3'

type Db = Database.Database

export interface AssetAccountSpec {
  /** 根科目名称关键词（包含即匹配） */
  names: string[]
  /** 名称含这些词的排除（如固定资产要排除「清理/累计」） */
  excludes?: string[]
  /** 常见默认编码：命中编码且名称也匹配才优先采纳，防止同码异名错配 */
  codes?: string[]
  /** 下探末级时优先选名称含这些词的（按顺序） */
  leafHints?: string[]
  /** 根科目有下级时，必须命中 leafHints 才采纳（折旧费用不能随手取一个「维修费」），否则视为找不到 */
  requireHint?: boolean
}

export interface ResolvedAssetAccount { code: string; name: string }

interface Row { id: string; code: string; name: string; parent_id?: string | null; is_enabled?: number }

function hasColumn(db: Db, table: string, column: string): boolean {
  return !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name=?').get(table, column)
}

/** 读取账套科目并建好父子关系（有 parent_id 用 parent_id，否则按编码前缀推断） */
function loadTree(db: Db, accountSetId: string) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get()) {
    return { rows: [] as Row[], kids: new Map<string, Row[]>(), depth: () => 0, enabled: () => true }
  }
  const hasParent = hasColumn(db, 'accounts', 'parent_id')
  const hasEnabled = hasColumn(db, 'accounts', 'is_enabled')
  const rows = db.prepare(
    `SELECT id, code, name${hasParent ? ', parent_id' : ''}${hasEnabled ? ', is_enabled' : ''} FROM accounts WHERE account_set_id=? ORDER BY code`
  ).all(accountSetId) as Row[]
  const byId = new Map(rows.map(r => [r.id, r]))
  const kids = new Map<string, Row[]>()
  const parentOf = new Map<string, Row | null>()
  for (const r of rows) {
    let parent: Row | null = null
    if (hasParent) {
      parent = r.parent_id ? byId.get(r.parent_id) || null : null
    } else {
      // 最长的、且是其前缀的其它科目编码
      for (const o of rows) {
        if (o.code !== r.code && r.code.startsWith(o.code) && (!parent || o.code.length > parent.code.length)) parent = o
      }
    }
    parentOf.set(r.id, parent)
    if (parent) {
      const arr = kids.get(parent.id) || []
      arr.push(r)
      kids.set(parent.id, arr)
    }
  }
  const depth = (r: Row): number => {
    let d = 0
    for (let p = parentOf.get(r.id); p; p = parentOf.get(p.id)) d++
    return d
  }
  const enabled = (r: Row) => r.is_enabled === undefined || Number(r.is_enabled) !== 0
  return { rows, kids, depth, enabled }
}

type Tree = ReturnType<typeof loadTree>

/** 取 root 下全部后代末级科目，按提示词顺序优先，其次按编码（启用优先）；root 本身是末级则返回 root */
function pickLeaf(tree: Tree, root: Row, leafHints: string[] = [], requireHint = false): Row | null {
  const leaves: Row[] = []
  const walk = (r: Row) => {
    const ks = tree.kids.get(r.id) || []
    if (!ks.length) { if (r !== root) leaves.push(r); return }
    ks.forEach(walk)
  }
  walk(root)
  if (!leaves.length) return root
  const usable = leaves.filter(tree.enabled)
  const pool = usable.length ? usable : leaves
  for (const h of leafHints) {
    const hit = pool.find(l => (l.name || '').includes(h))
    if (hit) return hit
  }
  return requireHint ? null : pool[0]
}

/** 从已知根编码下探到最底层末级；账套里没有该编码则原样返回（保留旧调用方语义） */
export function descendToLeaf(db: Db, accountSetId: string, rootCode: string, leafHints: string[] = []): string {
  const tree = loadTree(db, accountSetId)
  const root = tree.rows.find(r => r.code === rootCode)
  if (!root) return rootCode
  return pickLeaf(tree, root, leafHints)?.code ?? rootCode
}

function leafDescendants(tree: Tree, root: Row): Row[] {
  const leaves: Row[] = []
  const walk = (r: Row) => {
    const ks = tree.kids.get(r.id) || []
    if (!ks.length) {
      if (r !== root) leaves.push(r)
      return
    }
    ks.forEach(walk)
  }
  walk(root)
  return leaves
}

function isLeafRow(tree: Tree, row: Row): boolean {
  return !(tree.kids.get(row.id) || []).length
}

/**
 * 把「配置里的科目」解析成可以记账的明细科目。
 *
 * 资产类别曾绑在一级科目上（如 1602 累计折旧），之后又在其下加了明细科目时，
 * 一级科目不能再直接记账。规则：
 * - 配置本身已是明细，或账套里没有这个编码：原样返回（没有编码交给后续「科目不存在」提示）
 * - 调用方另外指定了明细科目（重新生成页上选的）：用指定的
 * - 下面只有一个明细科目：自动改用它
 * - 有多个明细又没指定：报错并列出可选科目，不猜
 */
export function createPostingAccountResolver(db: Db, accountSetId: string) {
  const tree = loadTree(db, accountSetId)
  const cache = new Map<string, string>()
  return (configured: string | null | undefined, options?: { preferred?: string | null; role?: string }): string => {
    const code = (configured || '').trim()
    if (!code) return ''
    const preferred = (options?.preferred || '').trim()
    const key = `${code}\n${preferred}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit

    const node = tree.rows.find(r => r.code === code)
    if (!node || isLeafRow(tree, node)) {
      cache.set(key, code)
      return code
    }

    const leaves = leafDescendants(tree, node)
    const usable = leaves.filter(tree.enabled)
    const pool = usable.length ? usable : leaves

    if (preferred && preferred !== code) {
      const pref = tree.rows.find(r => r.code === preferred)
      if (pref && isLeafRow(tree, pref)) {
        cache.set(key, pref.code)
        return pref.code
      }
    }

    if (pool.length === 1) {
      cache.set(key, pool[0].code)
      return pool[0].code
    }

    const role = options?.role || '科目'
    const list = pool.map(l => `${l.code} ${l.name}`).join('、')
    throw new Error(
      `${role}「${node.code} ${node.name}」下面已有明细科目：${list}。不能记在上级科目上，请改选其中一个明细科目，或到「资产类别」中修改。`
    )
  }
}

/** 按名称定位根科目并下探到最底层末级；找不到返回 null */
export function resolveAssetAccount(db: Db, accountSetId: string, spec: AssetAccountSpec): ResolvedAssetAccount | null {
  const tree = loadTree(db, accountSetId)
  const excludes = spec.excludes || []
  const matches = tree.rows.filter(r => {
    const n = (r.name || '').trim()
    return n && spec.names.some(k => n.includes(k)) && !excludes.some(x => n.includes(x)) && tree.enabled(r)
  })
  if (!matches.length) return null
  const rank = (r: Row) => [
    spec.codes?.includes(r.code) ? 0 : 1,
    spec.names.some(k => (r.name || '').trim() === k) ? 0 : 1,
    tree.depth(r),
  ]
  matches.sort((a, b) => {
    const ra = rank(a); const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return a.code.localeCompare(b.code)
  })
  const leaf = pickLeaf(tree, matches[0], spec.leafHints, spec.requireHint)
  return leaf ? { code: leaf.code, name: leaf.name } : null
}

/** 资产模块各角色科目的定位规则 */
export const ASSET_ACCOUNT_SPECS = {
  /** 固定资产原值；hints 按资产类别区分（房屋 / 机器 / 运输 / 电子 / 家具） */
  original: (hints: string[] = []): AssetAccountSpec => ({
    names: ['固定资产'], excludes: ['清理', '累计', '折旧', '减值', '在建', '公共基础设施', '保障性住房'], codes: ['1601'], leafHints: hints,
  }),
  accum: { names: ['累计折旧'], excludes: ['公共基础设施', '保障性住房', '无形'], codes: ['1602'] } as AssetAccountSpec,
  clearing: { names: ['固定资产清理'], codes: ['1606'] } as AssetAccountSpec,
  impairment: { names: ['固定资产减值准备'], codes: ['1603'] } as AssetAccountSpec,
  /** 折旧费用：按资产用途区分费用根科目，下探时优先「折旧」 */
  depreciationExpense: (names: string[], codes: string[]): AssetAccountSpec => ({
    names, codes, leafHints: ['折旧'], requireHint: true,
  }),
}

/**
 * 类别没配科目时的运行时兜底：按名称找固定资产原值的最底层末级科目，找不到才退回历史默认编码，
 * 由后续 resolveAccounts 给出「不存在 / 有下级」的明确报错。
 */
export function fallbackOriginalAccount(db: Db, accountSetId: string, legacyCode = '1601'): string {
  return resolveAssetAccount(db, accountSetId, ASSET_ACCOUNT_SPECS.original())?.code || legacyCode
}
