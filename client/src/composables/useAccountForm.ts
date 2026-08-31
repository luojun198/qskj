import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import request from '@/api/request'
import { isAuxCategoryExcludedFromAccount } from '@/utils/accountCashFlow'

export interface AccountAuxLookupRefs {
  auxItemById: Ref<Map<string, any>>
  auxItemsByCategory: Ref<Map<string, any[]>>
  ensureAuxItemsForCategory?: (catId: string) => Promise<void>
}

export function useAccountForm(auxCategories: Ref<any[]>, auxLookup: AccountAuxLookupRefs) {
  const form = ref<any>({ is_enabled: 1, no_negative: 0 })
  const parentUsage = ref<any>(null)

  function getAuxItemsByCat(catId: string) {
    if (!catId) return []
    return auxLookup.auxItemsByCategory.value.get(catId) || []
  }

  function getAvailableCats(item: any) {
    return auxCategories.value.filter(cat => {
      if (isAuxCategoryExcludedFromAccount(cat.code)) return false
      return !form.value.aux_list.some((i: any) => i !== item && i.cat_id === cat.id)
    })
  }

  function isCashFlowAuxCategoryId(catId: string): boolean {
    const cat = auxCategories.value.find(c => c.id === catId)
    return isAuxCategoryExcludedFromAccount(cat?.code)
  }

  function onAuxCatChange(item: any, val: string) {
    item.item_id = null
    if (val) {
      void auxLookup.ensureAuxItemsForCategory?.(val)
      const cat = auxCategories.value.find(c => c.id === val)
      if (cat?.default_item_id) {
        item.item_id = cat.default_item_id
      }
    }
  }

  function addAux() {
    form.value.aux_list.push({ cat_id: null, item_id: null })
  }

  function removeAux(index: number) {
    if (form.value.aux_list.length > 1) {
      form.value.aux_list.splice(index, 1)
    }
  }

  function getAuxNames(row: any): string[] {
    if (!row.aux_types) return []
    try {
      const parsed = typeof row.aux_types === 'string' ? JSON.parse(row.aux_types) : row.aux_types
      if (!parsed) return []
      const names: string[] = []
      for (const [catId, itemId] of Object.entries(parsed)) {
        const cat = auxCategories.value.find(c => c.id === catId)
        if (!cat) continue
        if (itemId) {
          const item = auxLookup.auxItemById.value.get(String(itemId))
          names.push(item ? `${cat.name}:${item.name}` : cat.name)
        } else {
          names.push(cat.name)
        }
      }
      return names
    } catch {
      return []
    }
  }

  async function onParentChange(parentId: string, treeData: any[], flattenRows: (nodes: any[]) => any[]) {
    parentUsage.value = null
    if (!parentId) {
      form.value.code = ''
      return
    }
    const flat = flattenRows(treeData)
    const parent = flat.find((r: any) => r.id === parentId)
    if (!parent) return

    const children = flat.filter((r: any) => r.parent_id === parentId)
    if (children.length > 0) {
      const childCodes = children.map((c: any) => c.code).sort()
      const lastCode = childCodes[childCodes.length - 1]
      const baseLen = parent.code.length + 1
      const lastSuffix = parseInt(lastCode.slice(baseLen)) || 0
      form.value.code = parent.code + String(lastSuffix + 1).padStart(lastCode.length - baseLen, '0')
    } else {
      form.value.code = parent.code + '01'
    }
    form.value.direction = parent.direction
    form.value.level = (parent.level || 0) + 1

    try {
      const res = await request.get<any>(`/base/accounts/${parentId}/usage`)
      if (res.code === 0 && res.data.voucherCount > 0) {
        parentUsage.value = res.data
      }
    } catch {
      /* ignore */
    }
  }

  function createAddForm(currentRowId?: string) {
    return {
      is_enabled: 1,
      is_cash: 0,
      is_bank: 0,
      direction: 'debit',
      no_negative: 0,
      aux_list: [{ cat_id: null, item_id: null }],
      parent_id: currentRowId || null,
    }
  }

  function createEditForm(row: any) {
    const aux_list: any[] = []
    try {
      const parsed = typeof row.aux_types === 'string' ? JSON.parse(row.aux_types) : row.aux_types
      if (parsed && typeof parsed === 'object') {
        for (const [catId, itemId] of Object.entries(parsed)) {
          if (isCashFlowAuxCategoryId(catId)) continue
          aux_list.push({ cat_id: catId, item_id: itemId || null })
        }
      }
    } catch {
      /* ignore */
    }
    if (aux_list.length === 0) {
      aux_list.push({ cat_id: null, item_id: null })
    }
    return {
      ...row,
      aux_list,
      is_cash: row.is_cash ? 1 : 0,
      is_bank: row.is_bank ? 1 : 0,
      no_negative: row.no_negative ? 1 : 0,
    }
  }

  function buildSavePayload() {
    const aux_types: Record<string, any> = {}
    for (const item of form.value.aux_list) {
      if (item.cat_id && !isCashFlowAuxCategoryId(item.cat_id)) {
        aux_types[item.cat_id] = item.item_id || null
      }
    }
    const payload = {
      ...form.value,
      aux_types: Object.keys(aux_types).length > 0 ? aux_types : null,
    }
    delete payload.aux_list
    return payload
  }

  return {
    form,
    parentUsage,
    getAuxItemsByCat,
    getAvailableCats,
    onAuxCatChange,
    addAux,
    removeAux,
    getAuxNames,
    onParentChange,
    createAddForm,
    createEditForm,
    buildSavePayload,
  }
}

/** 将扁平 auxItems 数组适配为 Map 查找结构（凭证录入等仍全量加载的场景） */
export function createFlatAuxLookupRefs(auxItems: Ref<any[]>): AccountAuxLookupRefs {
  const auxItemById = computed(() => {
    const map = new Map<string, any>()
    for (const item of auxItems.value) {
      map.set(item.id, item)
    }
    return map
  })
  const auxItemsByCategory = computed(() => {
    const map = new Map<string, any[]>()
    for (const item of auxItems.value) {
      const catId = item.type
      if (!catId) continue
      const list = map.get(catId) || []
      list.push(item)
      map.set(catId, list)
    }
    return map
  })
  return { auxItemById, auxItemsByCategory }
}
