import { h, ref, type VNodeChild } from 'vue'
import type { Column } from 'element-plus'

export const VIRTUAL_TABLE_MIN_COL_WIDTH = 40

export interface VirtualTableColumnResizeOptions {
  /** 当前列宽（含记忆），拖动起点 */
  getWidth: (key: string) => number
  /** 拖动过程中实时更新（未落盘） */
  onResize: (key: string, width: number) => void
  /** 松开鼠标后落盘 */
  onResizeEnd: (key: string, width: number, oldWidth: number) => void
  minWidth?: number
}

type HeaderRenderer = NonNullable<Column<any>['headerCellRenderer']>

/**
 * el-table-v2 没有原生列宽拖动，这里用自定义表头 + pointer 事件补上。
 * 返回 headerCellRenderer 工厂，拖动手把放在表头右缘。
 */
export function useVirtualTableColumnResize(options: VirtualTableColumnResizeOptions) {
  const minWidth = options.minWidth ?? VIRTUAL_TABLE_MIN_COL_WIDTH
  const draggingKey = ref<string | null>(null)

  function startDrag(key: string, event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = options.getWidth(key)
    let lastWidth = startWidth
    draggingKey.value = key
    document.body.classList.add('vt-resizing')

    const onMove = (e: PointerEvent) => {
      lastWidth = Math.max(minWidth, Math.round(startWidth + (e.clientX - startX)))
      options.onResize(key, lastWidth)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('vt-resizing')
      draggingKey.value = null
      options.onResizeEnd(key, lastWidth, startWidth)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function renderResizer(key: string) {
    return h('span', {
      class: ['vt-header-cell__resizer', { 'is-dragging': draggingKey.value === key }],
      onPointerdown: (e: PointerEvent) => startDrag(key, e),
      onClick: (e: MouseEvent) => e.stopPropagation(),
      onDblclick: (e: MouseEvent) => e.stopPropagation(),
    })
  }

  /**
   * 生成带拖动手把的表头渲染器。
   * @param key 列 key（同列宽记忆 key）
   * @param content 表头内容：字符串标题或自定义 VNode 工厂
   * @param align 与列 align 保持一致
   */
  function resizableHeader(
    key: string,
    content: string | (() => VNodeChild),
    align?: 'left' | 'center' | 'right'
  ): HeaderRenderer {
    return ((() =>
      h(
        'div',
        {
          class: ['vt-header-cell', align && align !== 'left' ? `vt-header-cell--${align}` : ''],
        },
        [
          h(
            'span',
            { class: 'vt-header-cell__title', title: typeof content === 'string' ? content : undefined },
            typeof content === 'string' ? content : [content()]
          ),
          renderResizer(key),
        ]
      )) as unknown) as HeaderRenderer
  }

  return { resizableHeader, draggingKey }
}
