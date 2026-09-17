import { describe, it, expect } from 'vitest'
import { ref, reactive } from 'vue'
import { useFilterClear } from '../useFilterClear'

describe('useFilterClear', () => {
  it('清空 ref 目标的所有筛选条件（字符置空、数组置空、日期置空）', () => {
    const filters = ref({ account_code: '1001', keyword: '回款', start_date: '2026-09-01', end_date: '2026-09-30' })
    const { clearFilters } = useFilterClear([filters])
    clearFilters()
    expect(filters.value.account_code).toBe('')
    expect(filters.value.keyword).toBe('')
    expect(filters.value.start_date).toBe('')
    expect(filters.value.end_date).toBe('')
  })

  it('清空 reactive 目标的所有筛选条件，特殊保留项与开关符合全量逻辑', () => {
    const filters = reactive({
      date_range: ['2026-09-01', '2026-09-15'],
      tags: ['a', 'b'],
      include_unposted: true,
      hideZero: true,
      year: 2026,
      period: 9,
    })
    const { clearFilters } = useFilterClear([filters])
    clearFilters()
    expect(filters.date_range).toEqual([])
    expect(filters.tags).toEqual([])
    expect(filters.include_unposted).toBe(true) // 包含未记账，确保统计全量
    expect(filters.hideZero).toBe(false)        // 不隐藏零值，确保全量展示
    expect(filters.year).toBeNull()
    expect(filters.period).toBeNull()
  })

  it('支持传入 options.defaults 指定自定义保留字段', () => {
    const filters = ref({ doc_type: 'PO', warehouse_code: 'WH01', keyword: 'ABC' })
    const { clearFilters } = useFilterClear([filters], {
      defaults: { doc_type: 'PO' }
    })
    clearFilters()
    expect(filters.value.doc_type).toBe('PO')
    expect(filters.value.warehouse_code).toBe('')
    expect(filters.value.keyword).toBe('')
  })

  it('多目标同时清空', () => {
    const keyword = ref('x')
    const dateRange = ref(['2026-08-01', '2026-08-31'])
    const { clearFilters } = useFilterClear([keyword, dateRange])
    clearFilters()
    expect(keyword.value).toBe('')
    expect(dateRange.value).toEqual([])
  })

  it('支持同步重置分页页码到 1', () => {
    const page = ref(5)
    const filters = ref({ keyword: 'test' })
    const { clearFilters } = useFilterClear([filters], { page })
    clearFilters()
    expect(filters.value.keyword).toBe('')
    expect(page.value).toBe(1)
  })
})

