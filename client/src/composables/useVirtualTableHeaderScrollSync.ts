import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * el-table-v2 的表头容器（.el-table-v2__header-wrapper）是 overflow:hidden，正常只由表体滚动同步过去。
 * 但在表头上拖选（例如拖列宽时没有精确按到手把、或从表头空白处拖动）会触发浏览器的
 * 选区自动滚动，把表头单独滚开，表体不跟随，表现为表头与表体错位数十像素。
 * 这里监听表头容器自身的 scroll，只要与表体滚动位置不一致就强制拉回。
 *
 * @param rootRef el-table-v2 所在的容器 ref（组件实例或 DOM 元素均可）
 */
export function useVirtualTableHeaderScrollSync(rootRef: Ref<any>) {
  let header: HTMLElement | null = null
  let observer: MutationObserver | null = null

  const rootEl = (): HTMLElement | null => {
    const v = rootRef.value
    if (!v) return null
    return (v instanceof HTMLElement ? v : v.$el) as HTMLElement | null
  }

  /** 表体的横向滚动容器：.el-table-v2__body（el-vl__wrapper）的直接子元素即虚拟列表窗口（overflow hidden，靠 EP 自绘滚动条驱动） */
  const bodyScroller = (): HTMLElement | null => {
    const main = rootEl()?.querySelector<HTMLElement>('.el-table-v2__main')
    if (!main) return null
    const win = main.querySelector<HTMLElement>('.el-table-v2__body > div')
    if (win && win.scrollWidth >= win.clientWidth) return win
    return null
  }

  const onHeaderScroll = () => {
    if (!header) return
    const body = bodyScroller()
    const target = body ? body.scrollLeft : 0
    if (Math.abs(header.scrollLeft - target) > 0.5) header.scrollLeft = target
  }

  /** 表体（或拖列宽重绘后）滚动位置变化时，把表头拉到同一位置：拖宽最右侧列时总宽变化，表头会停在旧位置导致整体错位 */
  const onAnyScroll = (e: Event) => {
    if (!header || e.target === header) return
    const body = bodyScroller()
    if (body && e.target === body) onHeaderScroll()
  }

  const bind = () => {
    const el = rootEl()?.querySelector<HTMLElement>('.el-table-v2__header-wrapper') ?? null
    if (el === header) return
    header?.removeEventListener('scroll', onHeaderScroll)
    header = el
    header?.addEventListener('scroll', onHeaderScroll, { passive: true })
  }

  onMounted(() => {
    bind()
    // el-auto-resizer / v-if 会重建表格 DOM，表头节点变化时重新绑定
    const root = rootEl()
    if (root) {
      root.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })
      observer = new MutationObserver(bind)
      observer.observe(root, { childList: true, subtree: true })
    }
  })

  onBeforeUnmount(() => {
    header?.removeEventListener('scroll', onHeaderScroll)
    rootEl()?.removeEventListener('scroll', onAnyScroll, { capture: true } as any)
    observer?.disconnect()
    header = null
  })
  return { sync: onHeaderScroll }
}
