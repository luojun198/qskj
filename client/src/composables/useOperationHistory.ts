import { ref } from 'vue'

export interface OperationRecord {
  id: string
  type: 'create' | 'update' | 'delete'
  module: string
  description: string
  timestamp: number
  data?: any
}

const MAX_HISTORY_SIZE = 50

/**
 * 操作历史记录 composable
 *
 * @example
 * const { addRecord, getHistory, clearHistory } = useOperationHistory()
 * addRecord('create', '凭证管理', '新增凭证 PZ001')
 */
export function useOperationHistory() {
  const history = ref<OperationRecord[]>([])

  /**
   * 添加操作记录
   */
  function addRecord(
    type: OperationRecord['type'],
    module: string,
    description: string,
    data?: any
  ) {
    const record: OperationRecord = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      module,
      description,
      timestamp: Date.now(),
      data,
    }

    history.value.unshift(record)

    // 限制历史记录数量
    if (history.value.length > MAX_HISTORY_SIZE) {
      history.value = history.value.slice(0, MAX_HISTORY_SIZE)
    }

    // 持久化到 localStorage
    saveToStorage()
  }

  /**
   * 获取历史记录
   */
  function getHistory(limit?: number): OperationRecord[] {
    if (limit) {
      return history.value.slice(0, limit)
    }
    return history.value
  }

  /**
   * 按模块获取历史记录
   */
  function getHistoryByModule(module: string, limit?: number): OperationRecord[] {
    const filtered = history.value.filter(record => record.module === module)
    if (limit) {
      return filtered.slice(0, limit)
    }
    return filtered
  }

  /**
   * 清空历史记录
   */
  function clearHistory() {
    history.value = []
    localStorage.removeItem('operation_history')
  }

  /**
   * 保存到 localStorage
   */
  function saveToStorage() {
    try {
      localStorage.setItem('operation_history', JSON.stringify(history.value))
    } catch (error) {
      console.warn('Failed to save operation history:', error)
    }
  }

  /**
   * 从 localStorage 加载
   */
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem('operation_history')
      if (stored) {
        history.value = JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to load operation history:', error)
    }
  }

  /**
   * 格式化时间
   */
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // 小于 1 分钟
    if (diff < 60000) {
      return '刚刚'
    }

    // 小于 1 小时
    if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} 分钟前`
    }

    // 小于 1 天
    if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} 小时前`
    }

    // 小于 7 天
    if (diff < 604800000) {
      return `${Math.floor(diff / 86400000)} 天前`
    }

    // 显示完整日期
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 初始化时加载历史记录
  loadFromStorage()

  return {
    history,
    addRecord,
    getHistory,
    getHistoryByModule,
    clearHistory,
    formatTime,
  }
}

// 全局单例
let globalHistory: ReturnType<typeof useOperationHistory> | null = null

/**
 * 获取全局操作历史实例
 */
export function useGlobalOperationHistory() {
  if (!globalHistory) {
    globalHistory = useOperationHistory()
  }
  return globalHistory
}
