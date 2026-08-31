import { ref, onMounted, onActivated, watch, nextTick, computed, type Ref, type ComputedRef } from 'vue'

export interface SizeMemory {
  [key: string]: number
}

/** 从 el-table 列对象解析存储键（与 column-key / prop 一致） */
export function resolveTableColumnKey(column: any): string | undefined {
  if (!column || column.type === 'selection') return undefined
  const key = column.columnKey ?? column.property
  if (key != null && key !== '') return String(key)
  if (typeof column.label === 'string' && column.label) return column.label
  return undefined
}

/** 列宽变化或表格挂载后触发布局（解决 el-table 不跟新 width 的问题） */
export function bindTableColumnLayout(
  widths: Ref<SizeMemory>,
  tableRef: Ref<{ doLayout?: () => void } | undefined>
) {
  let relayoutPending = false

  function relayout() {
    if (relayoutPending) return
    relayoutPending = true
    nextTick(() => {
      relayoutPending = false
      tableRef.value?.doLayout?.()
    })
  }

  // 仅列宽记忆变更时重排（加载 localStorage、拖拽列头），避免与 tableRef 监听叠加成循环
  watch(widths, relayout, { deep: true })

  // 表格首次挂载时应用一次列宽（v-if / 骨架屏延迟渲染）
  watch(
    () => tableRef.value,
    val => {
      if (val) relayout()
    },
    { flush: 'post', once: true }
  )
}

/**
 * 表格列宽记忆 composable
 * 使用方法：
 * 1. const { widths, onDragEnd } = useColumnWidthMemory('table_key')
 * 2. 在表格上添加 @header-dragend="onDragEnd"
 * 3. 在列上使用 :width="widths.columnKey || defaultWidth"
 */
export function useColumnWidthMemory(
  tableKey: string,
  options?: { storageKey?: string }
) {
  const storageKey = options?.storageKey ?? `table_column_width_${tableKey}`
  const rowHeightStorageKey = `table_row_height_${tableKey}`
  const widths = ref<SizeMemory>({})
  const heights = ref<SizeMemory>({})

  // 从 localStorage 加载列宽和行高
  function load() {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        widths.value = { ...JSON.parse(stored) }
      }
    } catch (error) {
      console.warn('加载列宽失败:', error)
    }

    try {
      const stored = localStorage.getItem(rowHeightStorageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        heights.value = parsed
      }
    } catch (error) {
      console.warn('加载行高失败:', error)
    }
  }

  // 保存列宽和行高到 localStorage
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths.value))
    } catch (error) {
      console.warn('保存列宽失败:', error)
    }

    try {
      localStorage.setItem(rowHeightStorageKey, JSON.stringify(heights.value))
    } catch (error) {
      console.warn('保存行高失败:', error)
    }
  }

  // 处理列拖动事件
  function onDragEnd(newWidth: number, _oldWidth: number, column: any) {
    const key = resolveTableColumnKey(column)
    if (!key) return

    widths.value = { ...widths.value, [key]: Math.round(newWidth) }
    save()
  }

  // 清除所有列宽和行高
  function clear() {
    widths.value = {}
    heights.value = {}
    localStorage.removeItem(storageKey)
    localStorage.removeItem(rowHeightStorageKey)
  }

  // 获取列宽（模板绑定用）
  function colWidth(columnKey: string, fallback: number): number {
    const saved = widths.value[columnKey]
    return saved && saved > 0 ? saved : fallback
  }

  function getColumnWidth(columnKey: string, defaultWidth?: number): number | undefined {
    const saved = widths.value[columnKey]
    if (saved && saved > 0) return saved
    return defaultWidth
  }

  function saveColumnWidth(columnKey: string, width: number) {
    widths.value = { ...widths.value, [columnKey]: Math.round(width) }
    save()
  }

  function bindTable(tableRef: Ref<{ doLayout?: () => void } | undefined>) {
    bindTableColumnLayout(widths, tableRef)
  }

  // 获取行高
  function getRowHeight(rowKey: string, defaultHeight?: number): number | undefined {
    return heights.value[rowKey] || defaultHeight
  }

  // 保存行高
  function saveRowHeight(rowKey: string, height: number) {
    heights.value[rowKey] = height
    save()
  }

  // 创建时同步加载，避免首屏用默认宽度渲染后无法应用本地记录
  load()

  onMounted(() => {
    load()
  })

  return {
    widths,
    heights,
    onDragEnd,
    load,
    colWidth,
    clear,
    getColumnWidth,
    saveColumnWidth,
    bindTable,
    getRowHeight,
    saveRowHeight,
  }
}

/** 列表页标准列宽记忆（含 tableRef、bindTable、keep-alive 重新加载） */
export function useListColumnWidth(tableKey: string, options?: { storageKey?: string }) {
  const tableRef = ref<{ doLayout?: () => void }>()
  const memory = useColumnWidthMemory(tableKey, options)
  memory.bindTable(tableRef)
  onActivated(() => {
    memory.load()
  })

  let relayoutPending = false
  async function relayoutTable() {
    if (relayoutPending) return
    relayoutPending = true
    await nextTick()
    relayoutPending = false
    tableRef.value?.doLayout?.()
  }

  return {
    tableRef,
    relayoutTable,
    ...memory,
  }
}

/** border 表格右侧 gutter 列（与 EP 布局一致） */
export const EL_TABLE_BORDER_GUTTER = 15

/** 累加列宽；fit=false 时 EP 不再单独占 gutter，辅助账簿应传 includeGutter:false */
export function sumColWidths(
  colWidth: (key: string, fallback: number) => number,
  defs: Array<{ key: string; fallback: number }>,
  options?: { includeGutter?: boolean }
): number {
  const base = options?.includeGutter !== false ? EL_TABLE_BORDER_GUTTER : 0
  return defs.reduce((sum, d) => sum + colWidth(d.key, d.fallback), base)
}

function readTableBlockWidth(el: HTMLElement | null): number {
  if (!el) return 0
  return Math.max(el.scrollWidth, el.offsetWidth, el.getBoundingClientRect().width)
}

/** 按表头/表体/合计 table 实测宽度取最大值，避免 scrollWidth 偏小滚不到最右 */
export function measureAuxTableLayoutWidth(root: HTMLElement): number {
  let max = 0
  max = Math.max(
    max,
    readTableBlockWidth(root.querySelector('.el-table__header-wrapper table') as HTMLElement | null),
    readTableBlockWidth(root.querySelector('.el-table__body-wrapper table.el-table__body') as HTMLElement | null),
    readTableBlockWidth(root.querySelector('.el-table__footer-wrapper table') as HTMLElement | null)
  )

  const header = root.querySelector('.el-table__header-wrapper')
  if (header) {
    const cells = header.querySelectorAll('thead th.el-table__cell')
    let sum = 0
    cells.forEach(th => {
      sum += (th as HTMLElement).offsetWidth
    })
    max = Math.max(max, sum)
  }
  return Math.ceil(max)
}

function applyAuxTableInnerWidth(root: HTMLElement, widthPx: number) {
  const w = `${widthPx}px`
  root.style.width = w
  root.style.minWidth = ''
  root.style.maxWidth = 'none'
  root.style.flexShrink = '0'
  for (const sel of [
    '.el-table__header-wrapper table',
    '.el-table__body-wrapper table.el-table__body',
    '.el-table__footer-wrapper table',
  ]) {
    const el = root.querySelector(sel) as HTMLElement | null
    if (el) {
      el.style.width = w
      el.style.minWidth = ''
      el.style.tableLayout = 'fixed'
    }
  }
}

/** 宽表横向滚动已改由外层 .table-summary-scroll--wide 承担，此处保留空实现供调用方兼容 */
export function bindAuxTableHorizontalScrollSync(_root: HTMLElement) {
  void _root
}

/** 同步宽表表头/表体/合计行 table 宽度，避免右侧与外框留缝 */
export function syncAuxTableBodyWidth(
  tableRef: Ref<{ $el?: HTMLElement } | undefined>,
  widthPx: number
) {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return
  const w = `${widthPx}px`
  nextTick(() => {
    requestAnimationFrame(() => {
      const root = tableRef.value?.$el as HTMLElement | undefined
      if (!root) return
      root.style.setProperty('width', w, 'important')
      root.style.flexShrink = '0'
      for (const sel of [
        '.el-table__header-wrapper table',
        '.el-table__body-wrapper table.el-table__body',
        '.el-table__footer-wrapper table',
      ]) {
        const el = root.querySelector(sel) as HTMLElement | null
        if (el) {
          el.style.width = w
          el.style.tableLayout = 'fixed'
        }
      }
    })
  })
}

/** 辅助账簿宽表：列宽合计定宽 + 根节点锁定，避免空数据 doLayout 循环拉宽 */
export function useAuxWideTable(
  tableKey: string,
  columnDefs: ComputedRef<Array<{ key: string; fallback: number }>>,
  options?: {
    columnKey?: ComputedRef<string>
    afterLayout?: () => void | Promise<void>
  }
) {
  const { tableRef, onDragEnd: onColDragEnd, colWidth } = useAuxColumnWidth(tableKey)

  const tableWidth = computed(() =>
    sumColWidths(colWidth, columnDefs.value, { includeGutter: false })
  )

  function syncTableWidth() {
    syncAuxTableBodyWidth(tableRef, tableWidth.value)
  }

  watch(tableWidth, syncTableWidth, { flush: 'post' })

  if (options?.columnKey) {
    watch(
      options.columnKey,
      () => {
        syncTableWidth()
      },
      { flush: 'post' }
    )
  }

  watch(
    tableRef,
    el => {
      if (el) syncTableWidth()
    },
    { flush: 'post' }
  )

  function onDragEnd(newWidth: number, oldWidth: number, column: any) {
    onColDragEnd(newWidth, oldWidth, column)
    syncTableWidth()
  }

  async function afterTableLayout() {
    syncTableWidth()
    await nextTick()
    syncTableWidth()
    if (options?.afterLayout) {
      await options.afterLayout()
    }
  }

  return {
    tableRef,
    colWidth,
    tableWidth,
    onDragEnd,
    syncTableWidth,
    afterTableLayout,
  }
}

/** 辅助账簿列表列宽记忆：不绑定 doLayout，避免与固定表格宽度互相触发 */
export function useAuxColumnWidth(tableKey: string, options?: { storageKey?: string }) {
  const tableRef = ref<{ doLayout?: () => void }>()
  const memory = useColumnWidthMemory(tableKey, options)
  // 不在 onActivated 再次 load，避免列宽对象替换触发表格重算（列宽已在创建时 load）
  return {
    tableRef,
    ...memory,
  }
}
