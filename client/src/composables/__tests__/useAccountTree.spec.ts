import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useAccountTree } from '@/composables/useAccountTree'

describe('useAccountTree', () => {
  const list = ref([
    { id: '1', code: '1001', name: '库存现金', parent_id: null },
    { id: '2', code: '1002', name: '银行存款', parent_id: null },
    { id: '3', code: '100201', name: '基本存款账户', parent_id: '2' },
    { id: '4', code: '100202', name: '一般存款账户', parent_id: '2' },
  ])
  const tableRef = ref(null)

  let composable: ReturnType<typeof useAccountTree>

  beforeEach(() => {
    composable = useAccountTree(list, tableRef)
  })

  it('should build tree data correctly', () => {
    const tree = composable.treeData.value
    expect(tree).toHaveLength(2)
    expect(tree[0].id).toBe('1')
    expect(tree[1].id).toBe('2')
    expect(tree[1].children).toHaveLength(2)
  })

  it('should expand nodes', () => {
    composable.expandAll()
    expect(composable.expandedKeys.value.length).toBeGreaterThan(0)
  })

  it('should collapse all nodes', () => {
    composable.expandAll()
    composable.collapseAll()
    expect(composable.expandedKeys.value).toHaveLength(0)
  })

  it('should flatten tree rows', () => {
    const flat = composable.flattenRows(composable.treeData.value)
    expect(flat).toHaveLength(4)
  })

  it('should handle current row change', () => {
    const row = list.value[0]
    composable.handleCurrentChange(row)
    expect(composable.currentRow.value).toBe(row)
  })
})
