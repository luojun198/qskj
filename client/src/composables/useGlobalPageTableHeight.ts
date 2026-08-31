import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { measureTableFillHeight } from './useFillHeightTable'

const MANAGED_ATTR = 'data-cw-table-fill'

/** 为 .page 下直接使用 height="100%" 的 el-table 写入像素高度（无法绑 :height 时的全局兜底） */
function applyDirectPageTableHeights() {
  document.querySelectorAll('.page > .el-table').forEach(node => {
    if (!(node instanceof HTMLElement)) return
    if (node.closest('.table-summary-scroll, .page-table-fill, .table-fill-wrap')) return

    const page = node.parentElement
    if (!page) return

    let reserve = 0
    let afterTable = false
    for (const child of Array.from(page.children)) {
      if (child === node) {
        afterTable = true
        continue
      }
      if (!afterTable || !(child instanceof HTMLElement)) continue
      const style = getComputedStyle(child)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      reserve +=
        child.getBoundingClientRect().height +
        parseFloat(style.marginTop || '0') +
        parseFloat(style.marginBottom || '0')
    }

    const mainBottom =
      document.querySelector('.main')?.getBoundingClientRect().bottom ?? window.innerHeight
    const top = node.getBoundingClientRect().top
    const h = Math.max(200, Math.floor(mainBottom - top - reserve - 12))

    node.setAttribute(MANAGED_ATTR, '1')
    node.style.setProperty('height', `${h}px`, 'important')
    node.style.setProperty('max-height', `${h}px`, 'important')
    node.style.setProperty('flex', '1 1 auto', 'important')
    node.style.setProperty('min-height', '0', 'important')
  })
}

/** 表格容器尚未绑 composable 时，确保 .table-summary-scroll 本身有像素高度 */
function applyScrollContainerHeights() {
  document.querySelectorAll('.page .table-summary-scroll, .page > .page-table-fill').forEach(node => {
    if (!(node instanceof HTMLElement)) return
    const table = node.querySelector(':scope > .el-table') as HTMLElement | null
    if (table?.hasAttribute(MANAGED_ATTR)) return

    const h = measureTableFillHeight(node)
    if (h <= 120) return

    node.style.setProperty('height', `${h}px`, 'important')
    node.style.setProperty('max-height', `${h}px`, 'important')
    node.style.setProperty('min-height', '0', 'important')
    if (node.classList.contains('table-summary-scroll--flow')) {
      const hasFixed = !!node.querySelector(
        ':scope > .el-table .el-table__fixed, :scope > .el-table .el-table__fixed-right'
      )
      node.style.setProperty('overflow-y', 'hidden', 'important')
      node.style.setProperty('overflow-x', hasFixed ? 'hidden' : 'auto', 'important')
    }
  })
}

function applyReportGridHeights() {
  document.querySelectorAll('.report-page .sheet-grid-wrap, .cash-flow-page .report-body').forEach(node => {
    if (!(node instanceof HTMLElement)) return
    const h = measureTableFillHeight(node)
    if (h <= 120) return
    node.style.setProperty('height', `${h}px`, 'important')
    node.style.setProperty('max-height', `${h}px`, 'important')
    node.style.setProperty('overflow', 'auto', 'important')
  })
}

function refreshGlobalTableHeights() {
  nextTick(() => {
    requestAnimationFrame(() => {
      applyScrollContainerHeights()
      applyDirectPageTableHeights()
      applyReportGridHeights()
    })
  })
}

export function useGlobalPageTableHeight() {
  const route = useRoute()

  onMounted(() => {
    window.addEventListener('resize', refreshGlobalTableHeights)
    refreshGlobalTableHeights()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', refreshGlobalTableHeights)
  })

  watch(
    () => route.fullPath,
    () => refreshGlobalTableHeights(),
    { flush: 'post' }
  )
}
