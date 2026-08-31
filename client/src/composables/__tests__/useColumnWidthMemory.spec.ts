import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  resolveTableColumnKey,
  bindTableColumnLayout,
  useColumnWidthMemory,
  useListColumnWidth,
  measureAuxTableLayoutWidth,
} from '../useColumnWidthMemory'

describe('useColumnWidthMemory', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] ?? null
      },
      setItem(key: string, value: string) {
        this.store[key] = value
      },
      removeItem(key: string) {
        delete this.store[key]
      },
    })
  })

  it('resolveTableColumnKey 优先使用 property', () => {
    expect(resolveTableColumnKey({ property: 'voucher_no', label: '凭证号' })).toBe('voucher_no')
  })

  it('resolveTableColumnKey 跳过选择列', () => {
    expect(resolveTableColumnKey({ type: 'selection' })).toBeUndefined()
  })

  it('resolveTableColumnKey 无 property 时使用 label', () => {
    expect(resolveTableColumnKey({ label: '操作' })).toBe('操作')
  })

  it('创建时从 localStorage 同步加载列宽', () => {
    localStorage.setItem(
      'table_column_width_test_table',
      JSON.stringify({ voucher_no: 200 })
    )
    const { colWidth, widths } = useColumnWidthMemory('test_table')
    expect(widths.value.voucher_no).toBe(200)
    expect(colWidth('voucher_no', 80)).toBe(200)
  })

  it('操作列拖动后保存宽度并立即用于渲染', () => {
    const { colWidth, onDragEnd } = useColumnWidthMemory('scm_doc_list')
    onDragEnd(196, 132, { columnKey: '操作', label: '操作' })

    expect(colWidth('操作', 132)).toBe(196)
    expect(JSON.parse(localStorage.getItem('table_column_width_scm_doc_list') || '{}')).toMatchObject({ 操作: 196 })
  })

  it('表格挂载后触发布局', async () => {
    const widths = ref<Record<string, number>>({ voucher_no: 180 })
    const doLayout = vi.fn()
    const tableRef = ref<{ doLayout?: () => void } | undefined>(undefined)

    bindTableColumnLayout(widths, tableRef)
    tableRef.value = { doLayout }
    await nextTick()
    await nextTick()

    expect(doLayout).toHaveBeenCalled()
  })

  it('measureAuxTableLayoutWidth 取表头 th 与 table scrollWidth 较大值', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="el-table__header-wrapper">
        <table><thead>
          <tr>
            <th class="el-table__cell"></th>
            <th class="el-table__cell"></th>
          </tr>
        </thead></table>
      </div>
      <div class="el-table__body-wrapper">
        <table class="el-table__body"></table>
      </div>
    `
    const th0 = root.querySelector('th')!
    const th1 = root.querySelectorAll('th')[1]!
    Object.defineProperty(th0, 'offsetWidth', { value: 100, configurable: true })
    Object.defineProperty(th1, 'offsetWidth', { value: 150, configurable: true })
    const headerTable = root.querySelector('.el-table__header-wrapper table') as HTMLElement
    Object.defineProperty(headerTable, 'scrollWidth', { value: 320, configurable: true })
    expect(measureAuxTableLayoutWidth(root)).toBe(320)
  })

  it('useListColumnWidth 返回 tableRef 与 colWidth', () => {
    const { tableRef, colWidth, onDragEnd, relayoutTable } = useListColumnWidth('list_demo')
    expect(tableRef.value).toBeUndefined()
    expect(colWidth('code', 100)).toBe(100)
    expect(typeof onDragEnd).toBe('function')
    expect(typeof relayoutTable).toBe('function')
  })
})
