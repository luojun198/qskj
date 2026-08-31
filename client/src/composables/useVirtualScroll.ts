import { ref, computed } from 'vue'

export interface VirtualScrollOptions {
  itemHeight: number // 每行高度
  bufferSize?: number // 缓冲区大小（上下各多渲染几行）
  threshold?: number // 启用虚拟滚动的最小数据量
}

/**
 * 虚拟滚动 composable
 * 用于优化大数据量表格的渲染性能
 *
 * @example
 * const { visibleData, containerStyle, onScroll } = useVirtualScroll(
 *   tableData,
 *   { itemHeight: 48, threshold: 100 }
 * )
 */
export function useVirtualScroll<T>(
  data: T[] | (() => T[]),
  options: VirtualScrollOptions
) {
  const { itemHeight, bufferSize = 5, threshold = 100 } = options

  const scrollTop = ref(0)
  const containerHeight = ref(600) // 默认容器高度

  const dataArray = computed(() => {
    return typeof data === 'function' ? data() : data
  })

  // 是否启用虚拟滚动
  const isVirtualEnabled = computed(() => {
    return dataArray.value.length >= threshold
  })

  // 可见区域的起始索引
  const startIndex = computed(() => {
    if (!isVirtualEnabled.value) return 0
    const index = Math.floor(scrollTop.value / itemHeight) - bufferSize
    return Math.max(0, index)
  })

  // 可见区域的结束索引
  const endIndex = computed(() => {
    if (!isVirtualEnabled.value) return dataArray.value.length
    const visibleCount = Math.ceil(containerHeight.value / itemHeight)
    const index = startIndex.value + visibleCount + bufferSize * 2
    return Math.min(dataArray.value.length, index)
  })

  // 可见的数据
  const visibleData = computed(() => {
    if (!isVirtualEnabled.value) {
      return dataArray.value
    }
    return dataArray.value.slice(startIndex.value, endIndex.value)
  })

  // 容器样式
  const containerStyle = computed(() => {
    if (!isVirtualEnabled.value) {
      return {}
    }
    return {
      height: `${containerHeight.value}px`,
      overflow: 'auto',
      position: 'relative' as const,
    }
  })

  // 内容包装器样式
  const wrapperStyle = computed(() => {
    if (!isVirtualEnabled.value) {
      return {}
    }
    return {
      height: `${dataArray.value.length * itemHeight}px`,
      position: 'relative' as const,
    }
  })

  // 内容偏移样式
  const contentStyle = computed(() => {
    if (!isVirtualEnabled.value) {
      return {}
    }
    return {
      transform: `translateY(${startIndex.value * itemHeight}px)`,
    }
  })

  // 滚动事件处理
  function onScroll(event: Event) {
    const target = event.target as HTMLElement
    scrollTop.value = target.scrollTop
  }

  // 设置容器高度
  function setContainerHeight(height: number) {
    containerHeight.value = height
  }

  // 滚动到指定索引
  function scrollToIndex(index: number, _behavior: ScrollBehavior = 'smooth') {
    const top = index * itemHeight
    scrollTop.value = top
    // 如果有实际的 DOM 元素，也滚动它
    // 这需要在组件中通过 ref 传递容器元素
  }

  return {
    visibleData,
    containerStyle,
    wrapperStyle,
    contentStyle,
    onScroll,
    setContainerHeight,
    scrollToIndex,
    isVirtualEnabled,
    startIndex,
    endIndex,
  }
}
