import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import request from '@/api/request'
import { isAuxCategoryExcludedFromAccount } from '@/utils/accountCashFlow'

export interface AccountAuxLookupRefs {
  auxItemById: Ref<Map<string, any>>
  auxItemsByCategory: Ref<Map<string, any[]>>
  ensureAuxItemsForCategory?: (catId: string) => Promise<void>
}

/** 科目编码规则（来自系统参数）：级数与各级分段长度 */
export interface AccountCodeConfig {
  accountLevels: Ref<number>
  accountCodeLengths: Ref<number[]>
}

const DEFAULT_CODE_LENGTHS = [4, 2, 2, 2, 2, 2, 2, 2, 2, 2]

export function useAccountForm(
  auxCategories: Ref<any[]>,
  auxLookup: AccountAuxLookupRefs,
  codeConfig?: AccountCodeConfig
) {
  const form = ref<any>({ is_enabled: 1, no_negative: 0 })
  const parentUsage = ref<any>(null)

  function codeLengths(): number[] {
    const lengths = codeConfig?.accountCodeLengths.value
    return lengths && lengths.length ? lengths : DEFAULT_CODE_LENGTHS
  }

  function levelLimit(): number {
    const configured = Number(codeConfig?.accountLevels.value)
    return configured > 0 ? configured : codeLengths().length
  }

  function getSegmentLength(level: number) {
    return codeLengths()[level - 1] || 2
  }

  function getCumulativeCodeLength(level: number) {
    return codeLengths()
      .slice(0, level)
      .reduce((sum, len) => sum + (Number(len) || 0), 0)
  }

  function getLevelByCodeLength(code: string): number | null {
    for (let level = 1; level <= levelLimit(); level += 1) {
      if (code.length === getCumulativeCodeLength(level)) return level
    }
    return null
  }

  function getAccountLevel(row: any): number {
    const code = String(row?.code || '').trim()
    const fromCode = getLevelByCodeLength(code)
    const explicit = Number(row?.level)
    if (fromCode) {
      if (explicit > 0 && explicit !== fromCode) return fromCode
      return explicit > 0 ? explicit : fromCode
    }
    if (explicit > 0) return explicit
    const codeLength = code.length
    const lengths = codeLengths()
    let cumulative = 0
    for (let index = 0; index < lengths.length; index += 1) {
      cumulative += Number(lengths[index]) || 0
      if (codeLength <= cumulative) return index + 1
    }
    return 1
  }

  /** 按当前级次的分段长度生成下一个可用编码；级次用尽返回空串 */
  function buildNextCode(parent: any | null, level: number, allAccounts: any[]): string {
    const segmentLength = getSegmentLength(level)
    const parentId = parent?.id || null
    const prefix = parent?.code ? String(parent.code) : ''
    const maxNo = allAccounts.reduce((max, row) => {
      if (!row || row.id === parent?.id) return max
      if ((row.parent_id || null) !== parentId) return max
      const code = String(row.code || '')
      if (!code.startsWith(prefix) || code.length !== prefix.length + segmentLength) return max
      const suffixNo = parseInt(code.slice(prefix.length), 10)
      return Number.isFinite(suffixNo) ? Math.max(max, suffixNo) : max
    }, 0)
    const nextNo = maxNo + 1
    const maxNoInLevel = Math.pow(10, segmentLength) - 1
    if (nextNo > maxNoInLevel) return ''
    return `${prefix}${String(nextNo).padStart(segmentLength, '0')}`
  }

  /** 校验当前表单编码是否符合科目编码规则；通过返回 null，否则返回错误文案 */
  function validateCode(allAccounts: any[]): string | null {
    const code = String(form.value.code || '').trim()
    if (!code) return '请输入科目编码'
    if (!/^\d+$/.test(code)) return '科目编码只能包含数字'

    const parentId = form.value.parent_id || null
    const parent = parentId ? allAccounts.find(row => row.id === parentId) : null
    const expectedLevel = parent ? getAccountLevel(parent) + 1 : getLevelByCodeLength(code)
    if (!expectedLevel || expectedLevel > levelLimit()) {
      return `科目编码长度不符合当前科目长度设置（${codeLengths().slice(0, levelLimit()).join('-')}）`
    }
    if (!parent && expectedLevel !== 1) {
      return `该编码长度对应第${expectedLevel}级科目，请先选择上级科目（顶级科目编码应为${getSegmentLength(1)}位）`
    }
    if (parent && !code.startsWith(String(parent.code || ''))) {
      return '科目编码必须以上级科目编码开头'
    }
    const expectedLength = getCumulativeCodeLength(expectedLevel)
    if (code.length !== expectedLength) {
      return `第${expectedLevel}级科目编码长度应为${expectedLength}位（${codeLengths()
        .slice(0, expectedLevel)
        .join('-')}）`
    }
    return null
  }

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
    const flat = flattenRows(treeData)

    if (!parentId) {
      form.value.code = buildNextCode(null, 1, flat)
      form.value.level = 1
      return
    }

    const parent = flat.find((r: any) => r.id === parentId)
    if (!parent) return

    const parentLevel = getAccountLevel(parent)
    if (parentLevel >= levelLimit()) {
      // 已到最末级，不能再建子科目
      form.value.code = ''
      form.value.level = parentLevel + 1
      return
    }

    const childLevel = parentLevel + 1
    form.value.code = buildNextCode(parent, childLevel, flat)
    form.value.direction = parent.direction
    form.value.level = childLevel

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
      is_foreign: 0,
      currency_code: null,
      is_quantity: 0,
      quantity_unit: null,
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
      is_foreign: row.is_foreign ? 1 : 0,
      currency_code: row.currency_code || null,
      is_quantity: row.is_quantity ? 1 : 0,
      quantity_unit: row.quantity_unit || null,
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
    buildNextCode,
    validateCode,
    getAccountLevel,
    getSegmentLength,
    getCumulativeCodeLength,
    getLevelByCodeLength,
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
