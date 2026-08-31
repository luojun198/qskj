import { ref } from 'vue'
import { ElLoading } from 'element-plus'

/**
 * 全局 Loading 管理
 */
export function useLoading() {
  const loading = ref(false)
  let loadingInstance: ReturnType<typeof ElLoading.service> | null = null

  const showLoading = (text = '加载中...') => {
    loading.value = true
    loadingInstance = ElLoading.service({
      lock: true,
      text,
      background: 'rgba(0, 0, 0, 0.7)',
    })
  }

  const hideLoading = () => {
    loading.value = false
    loadingInstance?.close()
    loadingInstance = null
  }

  return {
    loading,
    showLoading,
    hideLoading,
  }
}

/**
 * 异步操作包装器，自动显示 Loading
 */
export async function withLoading<T>(
  fn: () => Promise<T>,
  loadingText = '处理中...'
): Promise<T> {
  const { showLoading, hideLoading } = useLoading()
  try {
    showLoading(loadingText)
    return await fn()
  } finally {
    hideLoading()
  }
}
