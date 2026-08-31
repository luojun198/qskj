import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ColumnSettingsDialog from '../ColumnSettingsDialog.vue'

const stubs = {
  ElDialog: { template: '<section><slot/><slot name="footer"/></section>' },
  ElCheckbox: { props: ['modelValue', 'disabled'], template: '<label :data-disabled="disabled"><slot/></label>' },
  ElButton: { props: ['disabled'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>' },
}

describe('ColumnSettingsDialog', () => {
  it('纵向展示每列及四个位置按钮', () => {
    const wrapper = mount(ColumnSettingsDialog, {
      props: {
        modelValue: true,
        columns: [
          { key: 'code', label: '编号', visible: true, required: true },
          { key: 'name', label: '名称', visible: true },
        ],
      },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('编号')
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.findAll('.column-settings-dialog__row')).toHaveLength(2)
    expect(wrapper.findAll('.column-settings-dialog__move button')).toHaveLength(8)
    const firstButtons = wrapper.findAll('.column-settings-dialog__row')[0].findAll('button')
    const lastButtons = wrapper.findAll('.column-settings-dialog__row')[1].findAll('button')
    expect(firstButtons[0].attributes('disabled')).toBeDefined()
    expect(firstButtons[1].attributes('disabled')).toBeDefined()
    expect(lastButtons[2].attributes('disabled')).toBeDefined()
    expect(lastButtons[3].attributes('disabled')).toBeDefined()
    expect(wrapper.find('.column-settings-dialog__checkbox').attributes('data-disabled')).toBe('true')
  })

  it('点击置顶后立即发出新的真实顺序', async () => {
    const wrapper = mount(ColumnSettingsDialog, {
      props: {
        modelValue: true,
        columns: [
          { key: 'code', label: '编号', visible: true },
          { key: 'name', label: '名称', visible: true },
        ],
      },
      global: { stubs },
    })
    const secondRowButtons = wrapper.findAll('.column-settings-dialog__row')[1].findAll('button')
    await secondRowButtons[0].trigger('click')
    const emitted = wrapper.emitted('update:columns')
    expect((emitted?.[0]?.[0] as Array<{ key: string }>).map(c => c.key)).toEqual(['name', 'code'])
  })
})
