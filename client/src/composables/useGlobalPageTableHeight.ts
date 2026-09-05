import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { measureTableFillHeight } from './useFillHeightTable'

const MANAGED_ATTR = 'data-cw-table-fill'

/** 为 .page 下直接使用 height="100%" 的 el-table 写入像素高度（无法绑 :height 时的全局兜底） */
function applyDirectPageTableHeights() {
  // 先把所有量算做完再统一写样式：边读边写会让每个表格都触发一次强制重排，
  // 切换路由时这里一次要处理整页的表格，逐个重排累加起来就是肉眼可见的顿。
  const plans: Array<{ node: HTMLElement; height: number }> = []
  const mainBottom =
    document.querySelector('.main')?.getBoundingClientRect().bottom ?? window.innerHeight

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

    const top = node.getBoundingClientRect().top
    plans.push({ node, height: Math.max(200, Math.floor(mainBottom - top - reserve - 12)) })
  })

  for (const { node, height } of plans) {
    node.setAttribute(MANAGED_ATTR, '1')
    node.style.setProperty('height', `${height}px`, 'important')
    node.style.setProperty('max-height', `${height}px`, 'important')
    node.style.setProperty('flex', '1 1 auto', 'important')
    node.style.setProperty('min-height', '0', 'important')
  }
}

/** 表格容器尚未绑 composable 时，确保 .table-summary-scroll 本身有像素高度 */
function applyScrollContainerHeights() {
  // 同样先量后写，避免逐个容器触发强制重排
  const plans: Array<{ node: HTMLElement; height: number; flow: boolean; hasFixed: boolean }> = []

  document.querySelectorAll('.page .table-summary-scroll, .page > .page-table-fill').forEach(node => {
    if (!(node instanceof HTMLElement)) return
    const table = node.querySelector(':scope > .el-table') as HTMLElement | null
    if (table?.hasAttribute(MANAGED_ATTR)) return

    const h = measureTableFillHeight(node)
    if (h <= 120) return

    const flow = node.classList.contains('table-summary-scroll--flow')
    const hasFixed =
      flow &&
      !!node.querySelector(
        ':scope > .el-table .el-table__fixed, :scope > .el-table .el-table__fixed-right'
      )
    plans.push({ node, height: h, flow, hasFixed })
  })

  for (const { node, height, flow, hasFixed } of plans) {
    node.style.setProperty('height', `${height}px`, 'important')
    node.style.setProperty('max-height', `${height}px`, 'important')
    node.style.setProperty('min-height', '0', 'important')
    if (flow) {
      node.style.setProperty('overflow-y', 'hidden', 'important')
      node.style.setProperty('overflow-x', hasFixed ? 'hidden' : 'auto', 'important')
    }
  }
}

function applyReportGridHeights() {
  const plans: Array<{ node: HTMLElement; height: number }> = []

  document.querySelectorAll('.report-page .sheet-grid-wrap, .cash-flow-page .report-body').forEach(node => {
    if (!(node instanceof HTMLElement)) return
    const h = measureTableFillHeight(node)
    if (h <= 120) return
    plans.push({ node, height: h })
  })

  for (const { node, height } of plans) {
    node.style.setProperty('height', `${height}px`, 'important')
    node.style.setProperty('max-height', `${height}px`, 'important')
    node.style.setProperty('overflow', 'auto', 'important')
  }
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
