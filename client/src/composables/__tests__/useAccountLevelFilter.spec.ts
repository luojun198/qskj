import { describe, expect, it, vi } from 'vitest'

import { useAccountLevelFilter } from '../useAccountLevelFilter'

function setup(maxLevel: number) {
  const onChange = vi.fn()
  const filter = useAccountLevelFilter({
    getMaxLevel: () => maxLevel,
    onChange,
    shortcuts: false,
  })
  return { filter, onChange }
}

describe('useAccountLevelFilter', () => {
  it('默认底层：不限级次，下级 / 底层不可用', () => {
    const { filter } = setup(4)
    expect(filter.accountLevel.value).toBeNull()
    expect(filter.effectiveLevel.value).toBe(4)
    expect(filter.atBottom.value).toBe(true)
    expect(filter.atTop.value).toBe(false)
  })

  it('顶层 → 1 级；到顶后顶层 / 上级不可用', () => {
    const { filter, onChange } = setup(4)
    filter.goTop()
    expect(filter.accountLevel.value).toBe(1)
    expect(filter.atTop.value).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)

    filter.goUp()
    filter.goTop()
    expect(filter.accountLevel.value).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('从底层点上级落到最深级减一，而不是写死的 4', () => {
    const { filter } = setup(6)
    filter.goUp()
    expect(filter.accountLevel.value).toBe(5)
  })

  it('下级逐级加深，到最深级时回到底层（null）', () => {
    const { filter, onChange } = setup(3)
    filter.goTop()
    filter.goDown()
    expect(filter.accountLevel.value).toBe(2)
    filter.goDown()
    expect(filter.accountLevel.value).toBeNull()
    expect(filter.atBottom.value).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(3)

    filter.goDown()
    filter.goBottom()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('没有数据时按 6 级兜底', () => {
    const { filter } = setup(0)
    expect(filter.effectiveLevel.value).toBe(6)
    filter.goUp()
    expect(filter.accountLevel.value).toBe(5)
  })
})
