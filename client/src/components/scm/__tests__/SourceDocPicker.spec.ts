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
})
