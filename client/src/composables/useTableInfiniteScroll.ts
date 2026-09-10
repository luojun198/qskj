import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'
import { useThrottleFn } from '@/composables/useDebounceThrottle'

export interface UseTableInfiniteScrollOptions {
  /** 返回包含表格的根元素，或组件实例（会自动取 $el） */
  getScrollEl: () => HTMLElement | { $el?: HTMLElement } | null | undefined
  /** 是否还有下一页 */
  hasMore: Ref<boolean>
  /** 首次/重新加载中 */
  loading: Ref<boolean>
  /** 追加加载中 */
  loadingMore: Ref<boolean>
  /** 触发加载下一页 */
  onLoadMore: () => void | Promise<void>
  /** 距底部多少像素时触发，默认 150 */
  threshold?: number
  /** 数据长度，变化后自动重新绑定并检查是否需要补满首屏 */
  watchSource?: () => number
  /**
   * 自动滚动加载的行数软上限（默认 800）。
   * 超过后停止自动 loadMore / checkFill，需用户点按钮继续。
   * 传 0 / Infinity 表示不限制。
   */
  maxAutoRows?: number
}

/**
 * 表格滚轮下拉自动加载（追加式无限滚动）
 *
 * 适用于 el-table（固定 height / max-height，表体内部滚动）。
 * 不依赖 @vueuse/core，自行管理监听的绑定与解绑，兼容 keep-alive。
 */
export function useTableInfiniteScroll(options: UseTableInfiniteScrollOptions) {
  const {
    getScrollEl,
    hasMore,
    loading,
    loadingMore,
    onLoadMore,
    threshold = 150,
    maxAutoRows = 800,
  } = options

  let scrollEl: HTMLElement | null = null
  let bound = false
  // 补满首屏时的连续触发次数，防止后端异常导致死循环
  let fillGuard = 0

  /** 从表格根元素里解析出真正的滚动容器 */
  function resolveScrollEl(): HTMLElement | null {
    const raw = getScrollEl()
    if (!raw) return null
    // 组件实例（如 el-card）取其根 DOM 元素
    const root: HTMLElement | null =
      raw instanceof HTMLElement ? raw : ((raw as any).$el as HTMLElement) || null
    if (!root || typeof root.querySelector !== 'function') return null
    // Element Plus 2.x：表体外层是 el-scrollbar
    const scrollbarWrap = root.querySelector<HTMLElement>(
      '.el-table__body-wrapper .el-scrollbar__wrap'
    )
    if (scrollbarWrap) return scrollbarWrap
    // el-table-v2 虚拟列表滚动容器
    const v2Scroll = root.querySelector<HTMLElement>(
      '.el-table-v2__body > div, .el-vl__wrapper, .el-table-v2 .el-virtual-scrollbar__wrap'
    )
    if (v2Scroll) return v2Scroll
    // 兜底：老结构直接在 body-wrapper 上滚动
    return root.querySelector<HTMLElement>('.el-table__body-wrapper')
  }

  function currentRowCount() {
    return options.watchSource ? options.watchSource() : 0
  }

  function isOverSoftCap() {
    if (!maxAutoRows || !Number.isFinite(maxAutoRows) || maxAutoRows <= 0) return false
    return currentRowCount() >= maxAutoRows
  }

  function canLoad() {
    return hasMore.value && !loading.value && !loadingMore.value && !isOverSoftCap()
  }

  function handleScroll() {
    if (!scrollEl || !canLoad()) return
    const { scrollTop, clientHeight, scrollHeight } = scrollEl
    if (scrollHeight - scrollTop - clientHeight <= threshold) {
      fillGuard = 0
      void onLoadMore()
    }
  }

  const throttledScroll = useThrottleFn(handleScroll, 100)

  function unbind() {
    if (scrollEl && bound) {
      scrollEl.removeEventListener('scroll', throttledScroll)
    }
    bound = false
    scrollEl = null
  }

  /** 重新解析滚动容器并绑定监听（表格重渲染后调用） */
  async function rebind() {
    await nextTick()
    const next = resolveScrollEl()
    if (next === scrollEl && bound) return
    unbind()
    scrollEl = next
    if (scrollEl) {
      scrollEl.addEventListener('scroll', throttledScroll, { passive: true })
      bound = true
    }
  }

  /**
   * 首屏内容不足一屏时自动再拉一页，
   * 否则滚动条不出现就永远触发不了加载
   */
  async function checkFill() {
    await rebind()
    if (!scrollEl || !canLoad()) return
    if (scrollEl.scrollHeight <= scrollEl.clientHeight + threshold) {
      if (fillGuard >= 20) return
      fillGuard += 1
      void onLoadMore()
    }
  }

  /** 换筛选条件 / 排序 / 每页条数后把滚动条归零 */
  async function scrollToTop() {
    await nextTick()
    const el = scrollEl || resolveScrollEl()
    if (el) el.scrollTop = 0
    fillGuard = 0
  }

  if (options.watchSource) {
    watch(options.watchSource, () => {
      void checkFill()
    })
  }

  onMounted(() => {
    void rebind()
  })
  onActivated(() => {
    void rebind()
  })
  onDeactivated(unbind)
  onUnmounted(unbind)

  return { rebind, unbind, checkFill, scrollToTop, isOverSoftCap }
}
