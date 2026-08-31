import type { Account } from '@/types/base'

export type AccountTreeNode = Account & {
  children: AccountTreeNode[]
}

/** 模糊匹配：支持空格分词，编码/名称包含即命中 */
export function fuzzyMatchAccount(
  keyword: string,
  account: Pick<Account, 'code' | 'name'>
): boolean {
  const tokens = keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = `${account.code || ''} ${account.name || ''}`.toLowerCase()
  return tokens.every(token => haystack.includes(token))
}

export function buildAccountTree(accounts: Account[]): AccountTreeNode[] {
  const map: Record<string, AccountTreeNode> = {}
  const roots: AccountTreeNode[] = []
  const seen = new Set<string>()

  for (const account of accounts) {
    const id = String(account.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    map[id] = { ...account, children: [] }
  }

  const pushed = new Set<string>()
  for (const account of accounts) {
    const id = String(account.id)
    if (!id || pushed.has(id) || !map[id]) continue
    pushed.add(id)
    const parentId = account.parent_id != null ? String(account.parent_id) : ''
    if (parentId && map[parentId]) {
      map[parentId].children.push(map[id])
    } else {
      roots.push(map[id])
    }
  }

  const sortNodes = (nodes: AccountTreeNode[]) => {
    nodes.sort((a, b) => String(a.code).localeCompare(String(b.code), 'zh-CN'))
    for (const node of nodes) {
      if (node.children.length) sortNodes(node.children)
    }
  }
  sortNodes(roots)
  return roots
}

/** 将保存的一级编码展开为树勾选所需的全部科目编码 */
export function expandCodeRootsToCheckedCodes(roots: string[], accounts: Account[]): string[] {
  const normalizedRoots = roots.map(item => String(item || '').trim()).filter(Boolean)
  if (normalizedRoots.length === 0) return []

  const codes = new Set<string>()
  for (const account of accounts) {
    const code = String(account.code || '').trim()
    if (!code) continue
    if (normalizedRoots.some(root => code === root || code.startsWith(root))) {
      codes.add(code)
    }
  }
  return [...codes]
}

/** 勾选结果折叠为最小一级编码（父科目已选则不再单独保存子科目） */
export function collapseCheckedCodesToRoots(codes: string[]): string[] {
  const sorted = [...new Set(codes.map(item => String(item || '').trim()).filter(Boolean))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b, 'zh-CN')
  )
  const roots: string[] = []
  for (const code of sorted) {
    if (roots.some(root => code !== root && code.startsWith(root))) continue
    roots.push(code)
  }
  return roots
}

export function countDescendantsForRoots(roots: string[], accounts: Account[]): number {
  return expandCodeRootsToCheckedCodes(roots, accounts).length
}

export function formatAccountRootsSummary(roots: string[], accounts: Account[]): string {
  const normalized = roots.map(item => String(item || '').trim()).filter(Boolean)
  if (normalized.length === 0) return '未选择'
  const total = countDescendantsForRoots(normalized, accounts)
  if (total === normalized.length) {
    return `已选 ${normalized.length} 个科目`
  }
  return `已选 ${normalized.length} 个一级科目，共 ${total} 个（含下级）`
}
