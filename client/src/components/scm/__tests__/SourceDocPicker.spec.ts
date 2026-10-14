import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SourceDocPicker from '../SourceDocPicker.vue'

const { getDocs, getParams } = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getParams: vi.fn(),
}))

vi.mock('@/api/scm', () => ({
  scmApi: {
    getDocs,
    getParams,
  },
}))

describe('SourceDocPicker', () => {
  beforeEach(() => {
    getDocs.mockReset()
    getParams.mockReset()
    getDocs.mockResolvedValue({
      code: 0,
      data: { list: [] },
    })
    getParams.mockResolvedValue({
      code: 0,
      data: [],
    })
  })

  it.each([
    { sourceDocType: 'PO', detailSource: 'self' as const },
    { sourceDocType: 'PQ', detailSource: 'self' as const },
    { sourceDocType: 'SOa', detailSource: 'self' as const },
    { sourceDocType: 'SQ', detailSource: 'self' as const },
    { sourceDocType: 'PO', detailSource: 'received' as const },
    { sourceDocType: 'SOa', detailSource: 'received' as const },
    { sourceDocType: 'SO', detailSource: 'self' as const },
  ])('首次挂载即打开时加载 $sourceDocType/$detailSource 源单', async ({ sourceDocType, detailSource }) => {
    const wrapper = mount(SourceDocPicker, {
      props: {
        modelValue: true,
        sourceDocType,
        detailSource,
      },
      global: {
        plugins: [ElementPlus],
      },
    })

    await flushPromises()

    expect(getDocs).toHaveBeenCalledWith({
      doc_type: sourceDocType,
      status: 'audited',
      partner_code: undefined,
      page_size: 200,
    })
    wrapper.unmount()
  })

  it('关闭后重新打开时重新加载源单', async () => {
    const wrapper = mount(SourceDocPicker, {
      props: {
        modelValue: true,
        sourceDocType: 'SOa',
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(getDocs).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('明细行支持全选、全不选、反选，勾上时带入数量为 0 的行复位为正常剩余', async () => {
    const wrapper = mount(SourceDocPicker, {
      props: { modelValue: true, sourceDocType: 'SO' },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    const vm = wrapper.vm as any
    const mk = (checked: boolean, bringQty: number) => ({
      doc_id: 'd1', doc_no: 'SO-1', partner_code: 'C1', line: { id: 'l' }, remain: 10, baseRemain: 10, checked, bringQty,
    })
    vm.detailRows = [mk(true, 10), mk(false, 0), mk(false, 0)]
    await flushPromises()
    expect(vm.someChecked).toBe(true)
    expect(vm.allChecked).toBe(false)

    vm.toggleAllChecked(true)
    expect(vm.allChecked).toBe(true)
    expect(vm.detailRows.map((r: any) => r.bringQty)).toEqual([10, 10, 10])

    vm.invertChecked()
    expect(vm.someChecked).toBe(false)

    vm.toggleAllChecked(false)
    expect(vm.checkedCount).toBe(0)
    wrapper.unmount()
  })
})
