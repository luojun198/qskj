import { ref, computed } from 'vue'
import type { Ref } from 'vue'

export interface QueryScheme {
  id: string
  name: string
  description?: string
  filters: Record<string, any>
  isDefault?: boolean
  createdAt: string
  updatedAt: string
}

export interface UseQuerySchemeOptions {
  storageKey: string
  defaultSchemes?: QueryScheme[]
}

export function useQueryScheme(options: UseQuerySchemeOptions) {
  const { storageKey, defaultSchemes = [] } = options

  // 从 localStorage 加载方案
  function loadSchemes(): QueryScheme[] {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const schemes = JSON.parse(stored) as QueryScheme[]
        return schemes
      }
    } catch (error) {
      console.error('加载查询方案失败:', error)
    }
    return defaultSchemes
  }

  // 保存方案到 localStorage
  function saveSchemes(schemes: QueryScheme[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(schemes))
    } catch (error) {
      console.error('保存查询方案失败:', error)
    }
  }

  const schemes = ref<QueryScheme[]>(loadSchemes())

  // 默认方案
  const defaultScheme = computed(() => schemes.value.find(s => s.isDefault))

  // 添加新方案
  function addScheme(name: string, filters: Record<string, any>, description?: string) {
    const newScheme: QueryScheme = {
      id: `scheme_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      filters: JSON.parse(JSON.stringify(filters)), // 深拷贝
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    schemes.value.push(newScheme)
    saveSchemes(schemes.value)
    return newScheme
  }

  // 更新方案
  function updateScheme(id: string, updates: Partial<QueryScheme>) {
    const index = schemes.value.findIndex(s => s.id === id)
    if (index !== -1) {
      schemes.value[index] = {
        ...schemes.value[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      }
      saveSchemes(schemes.value)
      return schemes.value[index]
    }
    return null
  }

  // 删除方案
  function deleteScheme(id: string) {
    const index = schemes.value.findIndex(s => s.id === id)
    if (index !== -1) {
      schemes.value.splice(index, 1)
      saveSchemes(schemes.value)
      return true
    }
    return false
  }

  // 设置默认方案
  function setDefaultScheme(id: string) {
    schemes.value.forEach(s => {
      s.isDefault = s.id === id
    })
    saveSchemes(schemes.value)
  }

  // 清除默认方案
  function clearDefaultScheme() {
    schemes.value.forEach(s => {
      s.isDefault = false
    })
    saveSchemes(schemes.value)
  }

  // 获取方案
  function getScheme(id: string) {
    return schemes.value.find(s => s.id === id)
  }

  // 应用方案（返回过滤条件）
  function applyScheme(id: string) {
    const scheme = getScheme(id)
    if (scheme) {
      return JSON.parse(JSON.stringify(scheme.filters)) // 深拷贝
    }
    return null
  }

  return {
    schemes,
    defaultScheme,
    addScheme,
    updateScheme,
    deleteScheme,
    setDefaultScheme,
    clearDefaultScheme,
    getScheme,
    applyScheme,
  }
}
