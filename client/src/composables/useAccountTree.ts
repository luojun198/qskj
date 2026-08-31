import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { withAccountTreeSelectLabel } from '@/utils/accountSelectDisplay'

export function useAccountTree(list: Ref<any[]>, tableRef: Ref<any>) {
  const expandedSet = ref<Set<string>>(new Set())
  const currentRow = ref<any>(null)

  const expandedKeys: ComputedRef<string[]> = computed(() => [...expandedSet.value].map(String))

  // 扁平化所有行（含 children 嵌套）
  function flattenRows(nodes: any[], result?: any[]): any[] {
    const arr = result ?? []
    for (const node of nodes) {
      arr.push(node)
      if (node.children?.length) flattenRows(node.children, arr)
    }
    return arr
  }

  function addDepth(nodes: any[], depth: number = 1): any[] {
    return nodes.map(node => ({
      ...node,
      _depth: depth,
      children: node.children?.length ? addDepth(node.children, depth + 1) : [],
    }))
  }

  // 简单树形转换（按 parent_id；缺失时按编码最长前缀兜底）
  const treeData: ComputedRef<any[]> = computed(() => {
    const map: Record<string, any> = {}
    const roots: any[] = []
    const seen = new Set<string>()
    for (const item of list.value) {
      if (!item.id || seen.has(item.id)) continue
      seen.add(item.id)
      map[item.id] = { ...item, children: [] }
    }

    function resolveParentId(item: any): string | null {
      if (item.parent_id && map[item.parent_id]) return item.parent_id
      const code = String(item.code || '')
      if (!code) return null
      let bestId: string | null = null
      let bestLen = 0
      for (const candidate of Object.values(map)) {
        if (candidate.id === item.id) continue
        const parentCode = String(candidate.code || '')
        if (
          parentCode.length > 0 &&
          parentCode.length < code.length &&
          code.startsWith(parentCode) &&
          parentCode.length > bestLen
        ) {
          bestId = candidate.id
          bestLen = parentCode.length
        }
      }
      return bestId
    }

    const pushed = new Set<string>()
    for (const item of list.value) {
      if (!item.id || pushed.has(item.id)) continue
      if (!map[item.id]) continue
      pushed.add(item.id)
      const parentId = resolveParentId(item)
      if (parentId && map[parentId]) {
        map[parentId].children.push(map[item.id])
      } else {
        roots.push(map[item.id])
      }
    }
    return addDepth(roots)
  })

  // 平铺列表（带 _depth，按 code 排序）
  const flatList: ComputedRef<any[]> = computed(() => flattenRows(treeData.value))

  // tree-select 数据（禁用已选中的节点，避免循环引用）
  function getTreeSelectData(formId?: string): any[] {
    const mapNode = (r: any): any => ({
      ...withAccountTreeSelectLabel(r),
      disabled: formId ? r.id === formId : false,
      children: (r.children || []).map(mapNode),
    })
    return treeData.value.map(mapNode)
  }

  function handleCurrentChange(row: any) {
    currentRow.value = row || null
  }

  function handleRowClick(row: any) {
    currentRow.value = row || null
  }

  async function restoreCurrentRow() {
    const currentRowId = currentRow.value?.id
    if (!currentRowId) return

    await new Promise(resolve => setTimeout(resolve, 0))
    const flat = flattenRows(treeData.value)
    const matchedRow = flat.find((row: any) => row?.id === currentRowId)
    if (matchedRow) {
      currentRow.value = matchedRow
      tableRef.value?.setCurrentRow?.(matchedRow)
    } else {
      currentRow.value = null
      tableRef.value?.setCurrentRow?.(null)
    }
  }

  // 处理用户手动展开/折叠行
  function handleExpandChange(row: any, expanded: boolean) {
    if (expanded) {
      expandedSet.value.add(row.id)
    } else {
      expandedSet.value.delete(row.id)
    }
  }

  // 全部展开
  function expandAll() {
    const all = flattenRows(treeData.value)
    expandedSet.value = new Set(all.filter(r => r.children?.length).map(r => r.id))
  }

  // 全部收拢
  function collapseAll() {
    expandedSet.value = new Set()
  }

  // 上一级：收起当前最深的一层
  function goUpLevel() {
    if (expandedSet.value.size === 0) return

    const flat = flattenRows(treeData.value)
    // 找到当前展开节点的最大深度
    const expandedNodes = flat.filter(r => expandedSet.value.has(r.id))
    if (expandedNodes.length === 0) return

    const maxDepth = Math.max(...expandedNodes.map(r => r._depth || 1))
    // 收起最深层级的节点
    const toCollapse = expandedNodes.filter(r => (r._depth || 1) === maxDepth)
    toCollapse.forEach(r => expandedSet.value.delete(r.id))
  }

  // 下一级：展开下一层
  function goDownLevel() {
    const flat = flattenRows(treeData.value)

    // 如果没有展开任何节点，展开第一层（顶层节点）
    if (expandedSet.value.size === 0) {
      const topLevel = treeData.value.filter(r => r.children?.length)
      topLevel.forEach(r => expandedSet.value.add(r.id))
      return
    }

    // 找到当前展开节点的最大深度
    const expandedNodes = flat.filter(r => expandedSet.value.has(r.id))
    const maxDepth = Math.max(...expandedNodes.map(r => r._depth || 1))

    // 展开下一层：找到深度为 maxDepth 的已展开节点的子节点
    const toExpand = flat.filter(r => {
      if (!r.children?.length) return false
      if (expandedSet.value.has(r.id)) return false
      return (r._depth || 1) === maxDepth + 1 && r.parent_id && expandedSet.value.has(r.parent_id)
    })

    toExpand.forEach(r => expandedSet.value.add(r.id))
  }

  // 键盘快捷键
  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === '\\') {
      e.preventDefault()
      collapseAll()
      return
    }
    if (e.ctrlKey && e.shiftKey && e.key === '\\') {
      e.preventDefault()
      expandAll()
      return
    }
    if (e.ctrlKey && e.key === 'ArrowUp') {
      e.preventDefault()
      goUpLevel()
      return
    }
    if (e.ctrlKey && e.key === 'ArrowDown') {
      e.preventDefault()
      goDownLevel()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    treeData,
    flatList,
    expandedKeys,
    currentRow,
    expandAll,
    collapseAll,
    goUpLevel,
    goDownLevel,
    handleCurrentChange,
    handleRowClick,
    restoreCurrentRow,
    flattenRows,
    getTreeSelectData,
    handleExpandChange,
  }
}
