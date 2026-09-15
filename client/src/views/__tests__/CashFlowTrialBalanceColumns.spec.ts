import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { ElTable, ElTableColumn } from 'element-plus'

/**
 * FIX-155：现金流量凭证检查表用 h(ElTableColumn) 渲染列，`default` 必须作为插槽（第三参数）传入，
 * 作为 prop 传入时列内容为空。这里锁定两种写法的差异，防止回退。
 */
const rows = [{ direction: 'debit', amount: 12.5 }]

function mountWith(columnsFactory: () => any[]) {
  const Columns = defineComponent({ setup: () => () => columnsFactory() })
  return mount(
    defineComponent({
      render: () => h(ElTable, { data: rows }, { default: () => h(Columns) }),
    }),
    { attachTo: document.body }
  )
}

describe('ElTableColumn 渲染函数插槽写法', () => {
  it('插槽走第三参数：单元格有内容', async () => {
    const wrapper = mountWith(() => [
      h(ElTableColumn, { label: '方向', width: '70' }, { default: ({ row }: any) => (row.direction === 'debit' ? '借' : '贷') }),
    ])
    await nextTick()
    await nextTick()
    expect(wrapper.text()).toContain('借')
    wrapper.unmount()
  })

  it('（回归对照）default 当 prop 传：单元格为空', async () => {
    const wrapper = mountWith(() => [
      h(ElTableColumn, { label: '方向', width: '70', default: ({ row }: any) => (row.direction === 'debit' ? '借' : '贷') } as any),
    ])
    await nextTick()
    await nextTick()
    expect(wrapper.text()).not.toContain('借')
    wrapper.unmount()
  })
})
