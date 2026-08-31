import { ref, onBeforeUnmount, onMounted, watch, nextTick } from 'vue'

/** 宽表外层横向滚动条占用高度（避免合计行被 overflow-y:hidden 裁切） */
export const WIDE_TABLE_H_SCROLLBAR_RESERVE = 17

/** 统计父节点内某元素之后、仍占据布局的兄弟节点高度（含 margin） */
export function measureAfterSiblingReserve(anchor: HTMLElement, parent: HTMLElement): number {
  let reserve = 0
  let afterAnchor = false
  for (const child of Array.from(parent.children)) {
    if (child === anchor) {
      afterAnchor = true
      continue
    }
    if (!afterAnchor || !(child instanceof HTMLElement)) continue
    const style = getComputedStyle(child)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (style.position === 'absolute' || style.position === 'fixed') continue
    reserve +=
      child.getBoundingClientRect().height +
      parseFloat(style.marginTop || '0') +
      parseFloat(style.marginBottom || '0')
  }
  return reserve
}

/**
 * 根据容器在视口中的位置计算表格可用高度（不依赖 clientHeight，避免 flex 失效时被内容撑高）。
 */
export function measureTableFillHeight(container: HTMLElement): number {
  const top = container.getBoundingClientRect().top
  if (!Number.isFinite(top) || top <= 0) return 0

  const page = container.closest('.page') as HTMLElement | null
  const main =
    (container.closest('.main') as HTMLElement | null) ??
    (container.closest('.main-view') as HTMLElement | null)

  // 嵌套在 .table-wrap 内时，用 wrap 参与页级 flex 布局计算
  let layoutNode: HTMLElement = container
  const tableWrap = container.closest('.table-wrap') as HTMLElement | null
  if (tableWrap && page?.contains(tableWrap)) {
    layoutNode = tableWrap
  }

  let siblingReserve = 0
  if (page) {
    siblingReserve = measureAfterSiblingReserve(layoutNode, page)
  }

  // table-wrap 内还有 footer-bar / pagination-bar 等，需一并扣除
  if (layoutNode !== container && layoutNode.contains(container)) {
    siblingReserve += measureAfterSiblingReserve(container, layoutNode)
  }

  let bottomAnchor: number
  let bottomReserve = 8
  if (layoutNode !== container) {
    bottomAnchor = layoutNode.getBoundingClientRect().bottom
  } else if (page) {
    const pageRect = page.getBoundingClientRect()
    const pageStyle = getComputedStyle(page)
    bottomAnchor = pageRect.bottom - parseFloat(pageStyle.paddingBottom || '0')
  } else {
    bottomAnchor = main?.getBoundingClientRect().bottom ?? window.innerHeight
    bottomReserve = 12
  }

  return Math.floor(bottomAnchor - top - siblingReserve - bottomReserve)
}

/** 从 DOM 读取表格宽度：优先 :style 定宽，避免 offsetWidth 在 doLayout 循环中膨胀 */
function readBoundTableWidth(table: HTMLElement | null): number {
  if (!table) return 0
  const styleW = parseInt(table.style.width || '', 10)
  if (Number.isFinite(styleW) && styleW > 0) return styleW
  return table.offsetWidth ?? 0
}

/** 宽表 el-table :height 需为外层横向滚动条预留空间 */
export function measureTableBodyHeight(container: HTMLElement): number {
  const h = measureTableFillHeight(container)
  if (h <= 120) return h
  if (!container.classList.contains('table-summary-scroll--wide')) return h

  const table = container.querySelector(':scope > .el-table') as HTMLElement | null
  const tableW = readBoundTableWidth(table)
  const needsHScroll = !table || tableW === 0 || tableW > container.clientWidth
  return needsHScroll ? h - WIDE_TABLE_H_SCROLLBAR_RESERVE : h
}

/** 合计行表格 el-table :height（扣除横向滚动条占位） */
export function measureFlowTableHeight(container: HTMLElement): number {
  const h = measureTableFillHeight(container)
  if (h <= 120) return h

  const table = container.querySelector(':scope > .el-table') as HTMLElement | null
  const tableW = readBoundTableWidth(table)
  const needsHScroll = !table || tableW === 0 || tableW > container.clientWidth

  if (!needsHScroll) return h

  // 宽表外层横条 / fixed 列 inner-wrapper 横条 均占底边高度
  return h - WIDE_TABLE_H_SCROLLBAR_RESERVE
}

export interface UseFillHeightTableOptions {
  /**
   * 合计行表格：el-table 定高 + 表体内部纵向滚动，横向滚动条在合计行下方。
   */
  flow?: boolean
}

/**
 * 列表页表格撑满剩余区域。
 * 默认将像素高度传给 el-table（表头固定、表体内部滚动）；
 * flow 模式同样传 :height，适用于 show-summary 列表。
 */
export function useFillHeightTable(options: UseFillHeightTableOptions = {}) {
  const { flow = false } = options
  const containerRef = ref<HTMLElement>()
  const tableHeight = ref<number | undefined>(undefined)
  let observer: ResizeObserver | null = null

  function disconnect() {
    observer?.disconnect()
    observer = null
  }

  function applyContainerHeight(el: HTMLElement, h: number) {
    if (h <= 120) {
      el.style.removeProperty('height')
      el.style.removeProperty('max-height')
      el.style.removeProperty('overflow')
      return
    }
    el.style.setProperty('height', `${h}px`, 'important')
    el.style.setProperty('max-height', `${h}px`, 'important')
    el.style.setProperty('min-height', '0', 'important')
    if (flow) {
      const hasFixed = !!el.querySelector(
        ':scope > .el-table .el-table__fixed, :scope > .el-table .el-table__fixed-right'
      )
      el.style.setProperty('overflow-y', 'hidden', 'important')
      el.style.setProperty('overflow-x', hasFixed ? 'hidden' : 'auto', 'important')
    }
  }

  function updateHeight() {
    const el = containerRef.value
    if (!el) {
      tableHeight.value = undefined
      return
    }
    const containerH = measureTableFillHeight(el)
    if (flow) {
      const h = measureFlowTableHeight(el)
      tableHeight.value = h > 120 ? h : undefined
      applyContainerHeight(el, containerH)
      return
    }
    const h = measureTableBodyHeight(el)
    tableHeight.value = h > 120 ? h : undefined
    applyContainerHeight(el, measureTableFillHeight(el))
  }

  let heightRaf: number | null = null
  function scheduleUpdateHeight() {
    if (heightRaf != null) return
    heightRaf = requestAnimationFrame(() => {
      heightRaf = null
      updateHeight()
    })
  }

  function observe(el: HTMLElement) {
    disconnect()
    updateHeight()
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => scheduleUpdateHeight())
    observer.observe(el)
    if (!flow) {
      const table = el.querySelector(':scope > .el-table')
      if (table instanceof HTMLElement) observer.observe(table)
    }
    const tableWrap = el.closest('.table-wrap')
    if (tableWrap instanceof HTMLElement && tableWrap !== el) observer.observe(tableWrap)
    if (!flow) {
      const page = el.closest('.page')
      if (page) observer.observe(page)
      const main = el.closest('.main')
      if (main) observer.observe(main)
    }
  }

  watch(
    containerRef,
    el => {
      if (el) observe(el)
      else {
        disconnect()
        tableHeight.value = undefined
      }
    },
    { flush: 'post' }
  )

  onMounted(() => {
    window.addEventListener('resize', scheduleUpdateHeight)
    requestAnimationFrame(() => {
      updateHeight()
      requestAnimationFrame(updateHeight)
    })
  })

  onBeforeUnmount(() => {
    disconnect()
    if (heightRaf != null) cancelAnimationFrame(heightRaf)
    window.removeEventListener('resize', scheduleUpdateHeight)
  })

  /** 数据加载 / 列宽变化后重算表格高度（flow 与定高模式均适用） */
  async function relayoutAfterData() {
    await nextTick()
    updateHeight()
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        updateHeight()
        requestAnimationFrame(() => {
          updateHeight()
          resolve()
        })
      })
    })
  }

  return { containerRef, tableHeight, updateHeight, relayoutAfterData }
}
