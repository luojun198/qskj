import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ReportPageSetup, { type ReportPageSetupValue } from '../ReportPageSetup.vue'

const BASE: ReportPageSetupValue = {
  paperSize: 'A4',
  orientation: 'portrait',
  scale: 1,
  marginTop: 8,
  marginBottom: 8,
  marginLeft: 8,
  marginRight: 8,
}

/** 只测算法，不渲染 Element Plus 的弹层 */
function setup(contentSize: { width: number; height: number }, value = BASE) {
  return mount(ReportPageSetup, {
    props: { modelValue: { ...value }, contentSize },
    global: {
      stubs: {
        'el-popover': { template: '<div><slot name="reference" /><slot /></div>' },
        'el-button': true,
        'el-select': true,
        'el-option': true,
        'el-radio-group': true,
        'el-radio-button': true,
        'el-input-number': true,
      },
    },
  })
}

/** A4 纵向、四边 8mm：可打印区约 (210-16)mm x (297-16)mm */
const A4_PRINTABLE_W = ((210 - 16) * 96) / 25.4
const A4_PRINTABLE_H = ((297 - 16) * 96) / 25.4

describe('ReportPageSetup 自动缩放', () => {
  it('内容超出纸张时按较紧的一边缩放，保证一页放得下', () => {
    // 宽度是瓶颈：内容宽 = 可打印宽的两倍
    const wrapper = setup({ width: A4_PRINTABLE_W * 2, height: 100 })
    const vm = wrapper.vm as unknown as { scalePercent: number }

    expect(vm.scalePercent).toBe(50)
  })

  it('高度是瓶颈时按高度缩放', () => {
    const wrapper = setup({ width: 100, height: A4_PRINTABLE_H * 4 })
    const vm = wrapper.vm as unknown as { scalePercent: number }

    expect(vm.scalePercent).toBe(25)
  })

  it('内容比纸张小时不放大，保持 100%', () => {
    const wrapper = setup({ width: 200, height: 200 })
    const vm = wrapper.vm as unknown as { scalePercent: number }

    expect(vm.scalePercent).toBe(100)
  })

  it('换成横向后可打印宽度变大，缩放随之放宽', () => {
    const portrait = setup({ width: A4_PRINTABLE_W * 2, height: 100 })
    const landscape = setup({ width: A4_PRINTABLE_W * 2, height: 100 }, {
      ...BASE,
      orientation: 'landscape',
    })

    const p = (portrait.vm as unknown as { scalePercent: number }).scalePercent
    const l = (landscape.vm as unknown as { scalePercent: number }).scalePercent
    expect(l).toBeGreaterThan(p)
  })

  it('页边距变大会挤压可打印区，缩放变小', () => {
    const narrow = setup({ width: A4_PRINTABLE_W, height: 100 })
    const wide = setup({ width: A4_PRINTABLE_W, height: 100 }, {
      ...BASE,
      marginLeft: 30,
      marginRight: 30,
    })

    const a = (narrow.vm as unknown as { scalePercent: number }).scalePercent
    const b = (wide.vm as unknown as { scalePercent: number }).scalePercent
    expect(b).toBeLessThan(a)
  })

  it('手动改过缩放后，改纸张不再自动覆盖', async () => {
    const wrapper = setup({ width: A4_PRINTABLE_W * 2, height: 100 })
    const vm = wrapper.vm as unknown as {
      scalePercent: number
      manualScale: boolean
      markManual: () => void
      paperSize: string
    }

    vm.scalePercent = 80
    vm.markManual()
    await wrapper.vm.$nextTick()

    vm.paperSize = 'A3'
    await wrapper.vm.$nextTick()

    expect(vm.scalePercent).toBe(80)
  })

  it('点「自动适配」可重新按纸张计算', async () => {
    const wrapper = setup({ width: A4_PRINTABLE_W * 2, height: 100 })
    const vm = wrapper.vm as unknown as {
      scalePercent: number
      markManual: () => void
      applyAutoScale: () => void
    }

    vm.scalePercent = 80
    vm.markManual()
    await wrapper.vm.$nextTick()

    vm.applyAutoScale()
    expect(vm.scalePercent).toBe(50)
  })

  it('缩放有下限，不会算出小到看不清的比例', () => {
    const wrapper = setup({ width: A4_PRINTABLE_W * 100, height: 100 })
    const vm = wrapper.vm as unknown as { scalePercent: number }

    expect(vm.scalePercent).toBeGreaterThanOrEqual(20)
  })
})
