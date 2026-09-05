import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MrpForm from '../MrpForm.vue'

const { createMrpDoc, getMrpDoc, getMrpSourceOptions, replace, route } = vi.hoisted(() => ({
  createMrpDoc: vi.fn(),
  getMrpDoc: vi.fn(),
  getMrpSourceOptions: vi.fn(),
  replace: vi.fn(),
  route: {
    name: 'ScmMrpEdit',
    params: { id: 'MRP-1' } as Record<string, string>,
    query: {} as Record<string, string>,
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ push: vi.fn(), replace }),
}))

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}))

vi.mock('@/api/scm', () => ({
  scmApi: {
    createMrpDoc,
    getMrpDoc,
    getMrpSourceOptions,
  },
}))

describe('MRP 编辑页来源候选', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // MrpForm 在 setup 里读取多标签 store，shallowMount 不经过 app.use(pinia)，需手动激活
    setActivePinia(createPinia())
    route.name = 'ScmMrpEdit'
    route.params = { id: 'MRP-1' }
    route.query = {}
    getMrpDoc.mockResolvedValue({
      code: 0,
      data: {
        doc: { id: 'MRP-1', status: 'draft', field_values: {} },
        source_refs: [{ kind: 'sales_order', id: 'SO-1' }],
        source_summaries: [{ kind: 'sales_order', id: 'SO-1', source_no: 'SO-001', demand_qty: 10 }],
        sources: [{ source_kind: 'sales_order', source_id: 'SO-1', source_no: 'SO-001', item_code: 'M1', item_name: '物料一' }],
        lines: [],
        shortage_doc: null,
      },
    })
    getMrpSourceOptions.mockResolvedValue({ code: 0, data: [] })
  })

  it('多张销售订单从新建链接进入时自动创建并跳转计算结果编辑页', async () => {
    route.name = 'ScmMrpNew'
    route.params = {}
    route.query = { source_kind: 'sales_order', source_ids: 'SO-1,SO-2,SO-3' }
    createMrpDoc.mockResolvedValue({ code: 0, data: { id: 'MRP-NEW' } })

    shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true, 'el-button': { template: '<button><slot /></button>' }, 'el-card': true, 'el-checkbox': true,
          'el-date-picker': true, 'el-empty': true, 'el-form': true, 'el-form-item': true,
          'el-icon': true, 'el-input': true, 'el-radio-button': true, 'el-radio-group': true,
          'el-switch': true, 'el-table': true, 'el-table-column': true, 'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect(createMrpDoc).toHaveBeenCalledWith(expect.objectContaining({
      sources: [
        { kind: 'sales_order', id: 'SO-1' },
        { kind: 'sales_order', id: 'SO-2' },
        { kind: 'sales_order', id: 'SO-3' },
      ],
    }))
    expect(replace).toHaveBeenCalledWith({ name: 'ScmMrpEdit', params: { id: 'MRP-NEW' } })
  })

  it('编辑页不再加载已删除的候选来源列表', async () => {
    shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true,
          'el-button': true,
          'el-card': true,
          'el-checkbox': true,
          'el-date-picker': true,
          'el-empty': true,
          'el-form': true,
          'el-form-item': true,
          'el-icon': true,
          'el-input': true,
          'el-radio-button': true,
          'el-radio-group': true,
          'el-switch': true,
          'el-table': true,
          'el-table-column': true,
          'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect(getMrpSourceOptions).not.toHaveBeenCalled()
  })

  it('已计算的编辑页不显示保存并计算按钮', async () => {
    const wrapper = shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true, 'el-button': { template: '<button><slot /></button>' }, 'el-card': true, 'el-checkbox': true,
          'el-date-picker': true, 'el-empty': true, 'el-form': true, 'el-form-item': true,
          'el-icon': true, 'el-input': true, 'el-radio-button': true, 'el-radio-group': true,
          'el-switch': true, 'el-table': true, 'el-table-column': true, 'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('保存并计算')
  })

  it('加载并渲染来源单汇总和需求明细', async () => {
    const wrapper = shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true, 'el-button': true, 'el-card': true, 'el-checkbox': true,
          'el-date-picker': true, 'el-empty': true, 'el-form': true, 'el-form-item': true,
          'el-icon': true, 'el-input': true, 'el-radio-button': true, 'el-radio-group': true,
          'el-switch': true, 'el-table': true, 'el-table-column': true, 'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect((wrapper.vm as any).sourceSummaries).toEqual([
      expect.objectContaining({ source_no: 'SO-001', demand_qty: 10 }),
    ])
    expect((wrapper.vm as any).sources).toEqual([
      expect.objectContaining({ source_no: 'SO-001', item_code: 'M1', item_name: '物料一' }),
    ])
  })

  it('默认收起追加调整，避免常态展示比例、追加与目标量', async () => {
    const wrapper = shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true, 'el-button': true, 'el-card': true, 'el-checkbox': true,
          'el-date-picker': true, 'el-empty': true, 'el-form': true, 'el-form-item': true,
          'el-icon': true, 'el-input': true, 'el-radio-button': true, 'el-radio-group': true,
          'el-switch': true, 'el-table': true, 'el-table-column': true, 'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect((wrapper.vm as any).showAdjustments).toBe(false)
  })

  it('缓存组件处于普通领料单路由时不查询 MRP 单据', async () => {
    route.name = 'ScmDocEdit'
    route.params = { id: 'PL-1' }

    shallowMount(MrpForm, {
      global: {
        stubs: {
          'el-alert': true, 'el-button': true, 'el-card': true, 'el-checkbox': true,
          'el-date-picker': true, 'el-empty': true, 'el-form': true, 'el-form-item': true,
          'el-icon': true, 'el-input': true, 'el-radio-button': true, 'el-radio-group': true,
          'el-switch': true, 'el-table': true, 'el-table-column': true, 'el-tag': true,
        },
        directives: { loading: {} },
      },
    })
    await flushPromises()

    expect(getMrpDoc).not.toHaveBeenCalled()
  })
})
