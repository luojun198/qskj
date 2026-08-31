import { ref, watch } from 'vue'

/**
 * 防抖函数
 * 在事件被触发 n 秒后再执行回调，如果在这 n 秒内又被触发，则重新计时
 *
 * @example
 * const debouncedSearch = useDebounceFn(handleSearch, 500)
 */
export function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args)
      timeoutId = null
    }, delay)
  }
}

/**
 * 节流函数
 * 规定在一个单位时间内，只能触发一次函数。如果这个单位时间内触发多次函数，只有一次生效
 *
 * @example
 * const throttledScroll = useThrottleFn(handleScroll, 100)
 */
export function useThrottleFn<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300
): (...args: Parameters<T>) => void {
  let lastTime = 0

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now()

    if (now - lastTime >= delay) {
      fn.apply(this, args)
      lastTime = now
    }
  }
}

/**
 * 防抖 ref
 * 返回一个防抖后的响应式值
 *
 * @example
 * const searchKeyword = ref('')
 * const debouncedKeyword = useDebounce(searchKeyword, 500)
 */
export function useDebounce<T>(value: T, delay: number = 300) {
  const debouncedValue = ref<T>(value) as any
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const updateValue = (newValue: T) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    timeoutId = setTimeout(() => {
      debouncedValue.value = newValue
      timeoutId = null
    }, delay)
  }

  // 如果传入的是 ref，监听它的变化
  if (typeof value === 'object' && value !== null && 'value' in value) {
    watch(
      () => (value as any).value,
      (newValue: T) => {
        updateValue(newValue)
      }
    )
  }

  return debouncedValue
}

/**
 * 防抖请求被新调用 / cancel 打断时抛出的错误。
 * 调用方可通过 `err instanceof DebouncedAbortError` 或 `err.name === 'DebouncedAbortError'` 识别。
 */
export class DebouncedAbortError extends Error {
  constructor(message = 'Debounced request aborted') {
    super(message)
    this.name = 'DebouncedAbortError'
  }
}

/**
 * 请求防抖 composable
 * 用于搜索、自动保存等场景
 *
 * 行为约定：
 * - 同一 useDebouncedRequest 实例上的新 execute() 会取消上一次 pending 的调用；
 *   被取消的旧 Promise 会以 `DebouncedAbortError` reject（而不是永远 pending）。
 * - cancel() 同样会以 `DebouncedAbortError` reject 当前 pending 的 Promise。
 * - 如果 fn 想感知取消，可以读取 `currentSignal`（AbortSignal）。
 *
 * @example
 * const { execute, cancel, isPending, currentSignal } = useDebouncedRequest(
 *   async (keyword: string) => {
 *     return await api.search(keyword, { signal: currentSignal.value })
 *   },
 *   500
 * )
 */
export function useDebouncedRequest<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delay: number = 300
) {
  const isPending = ref(false)
  const isExecuting = ref(false)
  /** 当前一次 execute 的 AbortSignal，调用方可选地把它转发给底层 fetch/axios */
  const currentSignal = ref<AbortSignal | null>(null)

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let abortController: AbortController | null = null
  // 上次 execute 仍未 settle 的 reject 引用，便于新调用/取消时统一拒绝
  let pendingReject: ((reason: unknown) => void) | null = null

  function abortPending(reason: unknown) {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (abortController) {
      try { abortController.abort() } catch { /* ignore */ }
      abortController = null
    }
    if (pendingReject) {
      const reject = pendingReject
      pendingReject = null
      reject(reason)
    }
    currentSignal.value = null
    isPending.value = false
    isExecuting.value = false
  }

  const execute = (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    // 先终止上次调用，确保旧 Promise 不会泄漏
    abortPending(new DebouncedAbortError('Superseded by newer call'))

    return new Promise<Awaited<ReturnType<T>>>((resolve, reject) => {
      pendingReject = reject
      isPending.value = true

      const localController = new AbortController()
      abortController = localController
      currentSignal.value = localController.signal

      timeoutId = setTimeout(async () => {
        timeoutId = null
        // 防抖期间被 abort 的情况下，setTimeout 已被 clearTimeout，此分支不会进入
        try {
          isExecuting.value = true
          const result = (await fn(...args)) as Awaited<ReturnType<T>>
          // settle 之前再校验：可能在 await 期间被新调用打断
          if (localController.signal.aborted) {
            // pendingReject 已在 abortPending 里调用过，这里直接吞掉结果
            return
          }
          pendingReject = null
          resolve(result)
        } catch (error) {
          if (localController.signal.aborted) return
          pendingReject = null
          reject(error)
        } finally {
          isExecuting.value = false
          isPending.value = false
          if (abortController === localController) {
            abortController = null
            currentSignal.value = null
          }
        }
      }, delay)
    })
  }

  const cancel = () => {
    abortPending(new DebouncedAbortError('Cancelled by caller'))
  }

  return {
    execute,
    cancel,
    isPending,
    isExecuting,
    currentSignal,
  }
}

/**
 * 请求节流 composable
 * 用于滚动加载、频繁点击等场景
 *
 * @example
 * const { execute, canExecute } = useThrottledRequest(
 *   async () => {
 *     return await api.loadMore()
 *   },
 *   1000
 * )
 */
export function useThrottledRequest<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delay: number = 300
) {
  const isExecuting = ref(false)
  const canExecute = ref(true)
  let lastTime = 0

  const execute = async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
    const now = Date.now()

    if (now - lastTime < delay) {
      canExecute.value = false
      return null
    }

    try {
      isExecuting.value = true
      canExecute.value = false
      lastTime = now

      const result = await fn(...args)

      return result
    } catch (error) {
      throw error
    } finally {
      isExecuting.value = false
      setTimeout(() => {
        canExecute.value = true
      }, delay)
    }
  }

  return {
    execute,
    isExecuting,
    canExecute,
  }
}
