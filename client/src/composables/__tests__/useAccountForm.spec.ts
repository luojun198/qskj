import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { useAccountForm } from '@/composables/useAccountForm'

vi.mock('@/api/request', () => ({
  default: {
    get: vi.fn(),
  },
}))

describe('useAccountForm', () => {
  const auxCategories = ref([
    { id: 'dept', name: '部门' },
    { id: 'project', name: '项目' },
  ])
  const auxItemById = ref(
    new Map([
      ['dept1', { id: 'dept1', type: 'dept', name: '财务部' }],
      ['dept2', { id: 'dept2', type: 'dept', name: '行政部' }],
      ['proj1', { id: 'proj1', type: 'project', name: '项目A' }],
    ])
  )
  const auxItemsByCategory = ref(
    new Map([
      [
        'dept',
        [
          { id: 'dept1', type: 'dept', name: '财务部' },
          { id: 'dept2', type: 'dept', name: '行政部' },
        ],
      ],
      ['project', [{ id: 'proj1', type: 'project', name: '项目A' }]],
    ])
  )

  let composable: ReturnType<typeof useAccountForm>

  beforeEach(() => {
    composable = useAccountForm(auxCategories, { auxItemById, auxItemsByCategory })
  })

  it('should initialize with default form', () => {
    expect(composable.form.value.is_enabled).toBe(1)
    expect(composable.form.value.no_negative).toBe(0)
  })

  it('should get aux items by category', () => {
    const items = composable.getAuxItemsByCat('dept')
    expect(items).toHaveLength(2)
    expect(items[0].name).toBe('财务部')
  })

  it('should return empty array for invalid category', () => {
    const items = composable.getAuxItemsByCat('invalid')
    expect(items).toHaveLength(0)
  })

  it('should get available categories', () => {
    composable.form.value.aux_list = [
      { cat_id: 'dept', item_id: null },
      { cat_id: null, item_id: null },
    ]
    const available = composable.getAvailableCats(composable.form.value.aux_list[1])
    expect(available).toHaveLength(1)
    expect(available[0].id).toBe('project')
  })

  it('should clear item_id when category changes', () => {
    const item = { cat_id: 'dept', item_id: 'dept1' }
    composable.onAuxCatChange(item, 'project')
    expect(item.item_id).toBeNull()
  })

  it('should add aux item', () => {
    composable.form.value.aux_list = [{ cat_id: null, item_id: null }]
    composable.addAux()
    expect(composable.form.value.aux_list).toHaveLength(2)
  })

  it('should remove aux item when more than 1 exists', () => {
    composable.form.value.aux_list = [
      { cat_id: 'dept', item_id: null },
      { cat_id: 'project', item_id: null },
    ]
    composable.removeAux(0)
    expect(composable.form.value.aux_list).toHaveLength(1)
  })

  it('should create add form with default values', () => {
    const form = composable.createAddForm()
    expect(form.is_enabled).toBe(1)
    expect(form.direction).toBe('debit')
    expect(form.aux_list).toHaveLength(1)
  })

  it('should build save payload correctly', () => {
    composable.form.value = {
      code: '1001',
      name: '现金',
      aux_list: [
        { cat_id: 'dept', item_id: 'dept1' },
        { cat_id: 'project', item_id: null },
      ],
    }
    const payload = composable.buildSavePayload()
    expect(payload.code).toBe('1001')
    expect(payload.aux_types).toEqual({ dept: 'dept1', project: null })
    expect(payload.aux_list).toBeUndefined()
  })

  it('getAuxNames 使用 Map 查找默认项目', () => {
    const names = composable.getAuxNames({
      aux_types: { dept: 'dept1', project: null },
    })
    expect(names).toEqual(['部门:财务部', '项目'])
  })
})

describe('科目编码按系统参数生成与校验（4-3-3）', () => {
  const accountLevels = ref(3)
  const accountCodeLengths = ref([4, 3, 3])
  const auxCategories = ref<any[]>([])
  const auxItemById = ref(new Map<string, any>())
  const auxItemsByCategory = ref(new Map<string, any[]>())
  let c: ReturnType<typeof useAccountForm>

  const flat = [
    { id: 'p2202', code: '2202', name: '应付账款', level: 1, parent_id: null, direction: 'credit' },
  ]
  const flatten = (nodes: any[]) => nodes

  beforeEach(() => {
    c = useAccountForm(
      auxCategories,
      { auxItemById, auxItemsByCategory },
      { accountLevels, accountCodeLengths }
    )
  })

  it('无子科目时按第 2 级分段长度补足 3 位后缀', async () => {
    c.form.value = { code: '', parent_id: null, aux_list: [] }
    await c.onParentChange('p2202', flat, flatten)
    expect(c.form.value.code).toBe('2202001')
    expect(c.form.value.level).toBe(2)
  })

  it('已有子科目时按分段长度递增', async () => {
    const withChild = [...flat, { id: 'c1', code: '2202001', parent_id: 'p2202', level: 2 }]
    c.form.value = { code: '', parent_id: null, aux_list: [] }
    await c.onParentChange('p2202', withChild, flatten)
    expect(c.form.value.code).toBe('2202002')
  })

  it('校验 6 位编码时给出第 2 级应为 7 位的提示', () => {
    c.form.value = { code: '220201', parent_id: 'p2202', aux_list: [] }
    expect(c.validateCode(flat)).toContain('第2级科目编码长度应为7位')
  })

  it('7 位编码通过校验', () => {
    c.form.value = { code: '2202001', parent_id: 'p2202', aux_list: [] }
    expect(c.validateCode(flat)).toBeNull()
  })
})
