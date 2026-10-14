import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import MultiSortPanel from '../MultiSortPanel.vue'

// popover 桩：直接渲染 reference 与内容，visible 由 v-model 控制
const stubs = {
  ElPopover: {
    props: ['visible'],
    emits: ['update:visible'],
    template: '<div><span class="ref" @click="$emit(\'update:visible\', true)"><slot name="reference"/></span><div class="pop"><slot/></div></div>',
  },
  ElButton: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>' },
  ElSelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select class="sel" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot/></select>' },
  ElOption: { props: ['label', 'value', 'disabled'], template: '<option :value="value" :disabled="disabled">{{ label }}</option>' },
  ElRadioGroup: { template: '<div><slot/></div>' },
  ElRadioButton: { template: '<span><slot/></span>' },
  ElIcon: { template: '<i><slot/></i>' },
}

const options = [
  { key: 'partner', label: '往来单位' },
  { key: 'total_amount', label: '金额' },
  { key: 'doc_no', label: '单据号' },
]

function make(modelValue: any[] = [], defaultKeys: any[] = []) {
  return mount(MultiSortPanel, { props: { options, modelValue, defaultKeys }, global: { stubs } })
}
const open = async (w: ReturnType<typeof make>) => { await w.find('.ref').trigger('click'); await nextTick() }
const btn = (w: ReturnType<typeof make>, text: string) => w.findAll('button').find(b => b.text().includes(text))!

describe('MultiSortPanel', () => {
  it('打开时按「第一排序 / 第二排序」展示当前设置', async () => {
    const w = make([{ key: 'partner', order: 'asc' }, { key: 'total_amount', order: 'desc' }])
    await open(w)
    const rows = w.findAll('.multi-sort__row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('第一排序')
    expect(rows[1].text()).toContain('第二排序')
  })

  it('已被其它级选用的列在本级下拉里禁用', async () => {
    const w = make([{ key: 'partner', order: 'asc' }, { key: 'total_amount', order: 'asc' }])
    await open(w)
    const first = w.findAll('.multi-sort__row')[0].findAll('option')
    expect(first.find(o => o.text() === '往来单位')!.attributes('disabled')).toBeUndefined()
    expect(first.find(o => o.text() === '金额')!.attributes('disabled')).toBeDefined()
  })

  it('添加排序级会选中第一个未使用的列；应用后发出完整的多级设置', async () => {
    const w = make([{ key: 'partner', order: 'asc' }])
    await open(w)
    await btn(w, '添加排序级').trigger('click')
    expect(w.findAll('.multi-sort__row')).toHaveLength(2)
    await btn(w, '添加排序级').trigger('click')
    expect(w.findAll('.multi-sort__row')).toHaveLength(3)
    expect(btn(w, '添加排序级').attributes('disabled')).toBeDefined()   // 列已用完
    await btn(w, '应用').trigger('click')
    expect(w.emitted('change')![0][0]).toEqual([
      { key: 'partner', order: 'asc' }, { key: 'total_amount', order: 'asc' }, { key: 'doc_no', order: 'asc' },
    ])
  })

  it('上移 / 删除会改变级别顺序；恢复默认回到默认排序', async () => {
    const w = make([{ key: 'partner', order: 'asc' }, { key: 'total_amount', order: 'desc' }], [{ key: 'doc_no', order: 'desc' }])
    await open(w)
    const second = w.findAll('.multi-sort__row')[1].findAll('button')
    await second.find(b => b.attributes('title') === '上移')!.trigger('click')
    await btn(w, '应用').trigger('click')
    expect(w.emitted('change')![0][0]).toEqual([{ key: 'total_amount', order: 'desc' }, { key: 'partner', order: 'asc' }])

    await open(w)
    await btn(w, '恢复默认').trigger('click')
    expect(w.emitted('change')![1][0]).toEqual([{ key: 'doc_no', order: 'desc' }])
  })

  it('按钮上显示已设置的排序级数；未设置时不显示', () => {
    expect(make([{ key: 'doc_no', order: 'desc' }, { key: 'partner', order: 'asc' }]).find('.multi-sort__count').text()).toBe('2')
    expect(make([]).find('.multi-sort__count').exists()).toBe(false)
  })
})
