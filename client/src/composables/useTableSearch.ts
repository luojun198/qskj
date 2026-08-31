import { ref, computed } from 'vue'

/**
 * 表格搜索高亮 composable
 *
 * @example
 * const { searchKeyword, filteredData, highlightText } = useTableSearch(tableData, ['name', 'code'])
 */
export function useTableSearch<T extends Record<string, any>>(
  data: T[] | (() => T[]),
  searchFields: (keyof T)[]
) {
  const searchKeyword = ref('')

  const dataArray = computed(() => {
    return typeof data === 'function' ? data() : data
  })

  const filteredData = computed(() => {
    if (!searchKeyword.value.trim()) {
      return dataArray.value
    }

    const keyword = searchKeyword.value.toLowerCase().trim()
    return dataArray.value.filter(item => {
      return searchFields.some(field => {
        const value = item[field]
        if (value === null || value === undefined) return false
        return String(value).toLowerCase().includes(keyword)
      })
    })
  })

  /**
   * 高亮匹配的文本
   */
  function escapeHtml(raw: string): string {
    return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function highlightText(text: string | number | null | undefined): string {
    if (text === null || text === undefined) return ''
    const str = escapeHtml(String(text))
    if (!searchKeyword.value.trim()) return str

    const keyword = searchKeyword.value.trim()
    const regex = new RegExp(`(${escapeRegExp(escapeHtml(keyword))})`, 'gi')
    return str.replace(regex, '<mark style="background: #ffeb3b; padding: 0 2px;">$1</mark>')
  }

  /**
   * 转义正则表达式特殊字符
   */
  function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * 清空搜索
   */
  function clearSearch() {
    searchKeyword.value = ''
  }

  return {
    searchKeyword,
    filteredData,
    highlightText,
    clearSearch,
  }
}
