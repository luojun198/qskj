import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'
import { useAutoBlankRow } from '../useAutoBlankRow'

const make = () => ({ item_code: '', qty: 1 })

describe('useAutoBlankRow', () => {
  it('空数组：初始化即补一个空行', () => {
    const arr = ref<any[]>([])
    useAutoBlankRow(() => arr.value, make)
    expect(arr.value.length).toBe(1)
    expect(arr.value[0].item_code).toBe('')
  })

  it('填了末行 → 自动追加新空行', async () => {
    const arr = ref<any[]>([])
    useAutoBlankRow(() => arr.value, make)
    expect(arr.value.length).toBe(1)
    arr.value[0].item_code = 'A'
    await nextTick()
    expect(arr.value.length).toBe(2)
    expect(arr.value[1].item_code).toBe('')
  })

  it('连续填写连续补行；末行始终为空', async () => {
    const arr = ref<any[]>([])
    useAutoBlankRow(() => arr.value, make)
    arr.value[arr.value.length - 1].item_code = 'A'
    await nextTick()
    arr.value[arr.value.length - 1].item_code = 'B'
    await nextTick()
    expect(arr.value.map(r => r.item_code)).toEqual(['A', 'B', ''])
  })

  it('enabled=false 时不补空行', async () => {
    const arr = ref<any[]>([])
    useAutoBlankRow(() => arr.value, make, { enabled: () => false })
    expect(arr.value.length).toBe(0)
  })

  it('已有非空末行时，初始化即补空行', () => {
    const arr = ref<any[]>([{ item_code: 'X', qty: 2 }])
    useAutoBlankRow(() => arr.value, make)
    expect(arr.value.length).toBe(2)
    expect(arr.value[1].item_code).toBe('')
  })

  it('自定义 filled 判据', async () => {
    const arr = ref<any[]>([])
    useAutoBlankRow(() => arr.value, () => ({ name: '' }), { filled: r => !!r.name })
    expect(arr.value.length).toBe(1)
    arr.value[0].name = '甲'
    await nextTick()
    expect(arr.value.length).toBe(2)
  })

  it('getArr 返回空值时安全（不抛错）', () => {
    expect(() => useAutoBlankRow(() => null, make)).not.toThrow()
  })
})
