import { ref } from 'vue'
import request from '@/api/request'
import { useDebounceFn } from '@/composables/useDebounceThrottle'

export interface VoucherAuxItem {
  id: string
  code?: string
  name: string
  type: string
  status?: string
}

const DEFAULT_LIMIT = 80

export function useVoucherAuxItems() {
  const optionsByCategory = ref<Record<string, VoucherAuxItem[]>>({})
  const selectedByCategory = ref<Record<string, Map<string, VoucherAuxItem>>>({})
  const loadingByCategory = ref<Record<string, boolean>>({})

  function ensureCategoryMap(catId: string) {
    if (!selectedByCategory.value[catId]) {
      selectedByCategory.value[catId] = new Map()
    }
  }

  function mergeIntoOptions(catId: string, items: VoucherAuxItem[]) {
    const map = new Map<string, VoucherAuxItem>()
    for (const item of optionsByCategory.value[catId] || []) {
      map.set(item.id, item)
    }
    for (const item of items) {
      map.set(item.id, item)
      ensureCategoryMap(catId)
      selectedByCategory.value[catId].set(item.id, item)
    }
    optionsByCategory.value[catId] = Array.from(map.values())
  }

  async function fetchAuxItems(
    catId: string,
    params: { keyword?: string; ids?: string[]; limit?: number } = {}
  ) {
    if (!catId) return []
    loadingByCategory.value[catId] = true
    try {
      const query: Record<string, string | number> = {
        category_id: catId,
        status: 'active',
      }
      if (params.keyword?.trim()) {
        query.keyword = params.keyword.trim()
      }
      if (params.ids?.length) {
        query.ids = params.ids.join(',')
      } else if (params.limit != null) {
        query.limit = params.limit
      } else {
        query.limit = DEFAULT_LIMIT
      }
      const res = await request.get<VoucherAuxItem[]>('/base/aux-items', { params: query })
      const list = res.data || []
      if (params.ids?.length) {
        mergeIntoOptions(catId, list)
      } else {
        optionsByCategory.value[catId] = list
        for (const item of list) {
          ensureCategoryMap(catId)
          selectedByCategory.value[catId].set(item.id, item)
        }
      }
      return list
    } catch (error) {
      console.error('加载辅助核算项目失败', error)
      return []
    } finally {
      loadingByCategory.value[catId] = false
    }
  }

  function getAuxOptions(catId: string): VoucherAuxItem[] {
    return optionsByCategory.value[catId] || []
  }

  function getAuxItemFromCache(catId: string, itemId: string): VoucherAuxItem | undefined {
    return selectedByCategory.value[catId]?.get(itemId)
  }

  function cacheAuxItem(catId: string, item: VoucherAuxItem) {
    ensureCategoryMap(catId)
    selectedByCategory.value[catId].set(item.id, item)
    const existing = optionsByCategory.value[catId] || []
    if (!existing.some(i => i.id === item.id)) {
      optionsByCategory.value[catId] = [item, ...existing]
    }
  }

  async function ensureSelectedItems(catId: string, itemIds: string[]) {
    const missing = itemIds.filter(id => id && !selectedByCategory.value[catId]?.has(id))
    if (missing.length === 0) return
    await fetchAuxItems(catId, { ids: missing })
  }

  async function onDropdownOpen(catId: string) {
    if ((optionsByCategory.value[catId] || []).length > 0) return
    await fetchAuxItems(catId, { limit: DEFAULT_LIMIT })
  }

  const searchAuxItemsDebounced = useDebounceFn(async (catId: string, keyword: string) => {
    await fetchAuxItems(catId, { keyword, limit: DEFAULT_LIMIT })
  }, 300)

  function searchAuxItems(catId: string, keyword: string) {
    void searchAuxItemsDebounced(catId, keyword)
  }

  async function fetchNextAuxCode(catId: string): Promise<string> {
    try {
      const res = await request.get<VoucherAuxItem[]>('/base/aux-items', {
        params: { category_id: catId, status: 'active', limit: 1, order: 'desc' },
      })
      const top = res.data?.[0]
      const n = top?.code ? Number.parseInt(String(top.code), 10) : 0
      const next = Number.isNaN(n) ? 1 : n + 1
      return String(next).padStart(6, '0')
    } catch {
      return '000001'
    }
  }

  function resolveAuxItemName(
    catId: string,
    catCode: string,
    itemId: string,
    entry?: Record<string, unknown> | null
  ): string {
    if (!itemId) return '-'
    const cached = getAuxItemFromCache(catId, itemId)
    if (cached?.name) return cached.name
    const nameKey = `_${catCode}_name`
    const entryName = entry?.[nameKey]
    if (typeof entryName === 'string' && entryName.trim()) return entryName.trim()
    return '-'
  }

  async function ensureSelectedForEntry(
    entry: Record<string, unknown> | null | undefined,
    categories: Array<{ id: string; code: string }>
  ) {
    if (!entry) return
    for (const cat of categories) {
      const itemId = entry[`_${cat.code}_id`]
      if (typeof itemId === 'string' && itemId) {
        await ensureSelectedItems(cat.id, [itemId])
      }
    }
  }

  return {
    optionsByCategory,
    selectedByCategory,
    loadingByCategory,
    getAuxOptions,
    getAuxItemFromCache,
    cacheAuxItem,
    fetchAuxItems,
    ensureSelectedItems,
    ensureSelectedForEntry,
    onDropdownOpen,
    searchAuxItems,
    fetchNextAuxCode,
    resolveAuxItemName,
  }
}
