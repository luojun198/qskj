import { ref, shallowRef, computed, watch } from 'vue'
import request from '@/api/request'
import { useDebounce } from '@/composables/useDebounceThrottle'
import { showSuccess, showError, showOperationError } from '@/composables/useMessage'
import { normalizeOpeningDebitCredit } from '@/utils/initBalanceOpening'
import { buildSingleCategoryAuxItemId } from '@/utils/auxItemId'
import {
  filterAuxGridRows,
  buildItemSearchCache,
  type AuxGridItem,
  type AuxGridRow,
  type AuxCategoryFieldMeta,
} from '@/utils/initBalanceAuxGrid'
import {
  buildTabGridRows,
  lineHasAmount,
  isLineSelectionComplete,
  syncLineToCombinationStore,
  countCategoryFilled,
  sumCategoryTotals,
  categoryInitBalance,
} from '@/utils/initBalanceAuxTabRows'
import { checkAuxCategoryAmountConsistency } from '@/utils/initBalanceAuxCategoryConsistency'
import { yieldToMain } from '@/utils/asyncChunk'
import { isAuxLineItemValid, buildAuxItemIdSetByCategory } from '@/utils/initBalanceAuxItems'
import {
  categoryCodeColumn,
  categoryNameColumn,
  parseAuxImportRows,
  type MissingAuxItemDraft,
} from '@/utils/initBalanceAuxImport'
import { mergeAuxItemsByCategory } from '@/utils/initBalanceAuxImportLookup'

export interface AuxCategoryMeta {
  id: string
  code: string
  name: string
}

export interface AuxItemOption extends AuxGridItem {}

export type InitBalanceAuxLine = AuxGridRow

export type { AuxImportPreviewRowLike as AuxImportPreviewRow } from '@/utils/initBalanceAuxImport'

let lineKeySeq = 0

function newLineKey() {
  return `line-${++lineKeySeq}`
}

export {
  normalizeOpeningDebitCredit,
  applyOpeningDebitChange,
  applyOpeningCreditChange,
} from '@/utils/initBalanceOpening'

export { lineHasAmount, isLineSelectionComplete } from '@/utils/initBalanceAuxTabRows'

/** 超过此行数改用异步任务保存，避免超大 JSON 与长时间同步请求 */
const AUX_SAVE_ASYNC_THRESHOLD = 300
const AUX_SAVE_PAYLOAD_CHUNK = 500
const AUX_LARGE_GRID_THRESHOLD = 3000

export function createEmptyAuxLine(categoryIds: string[]): InitBalanceAuxLine {
  const selection: Record<string, string> = {}
  for (const id of categoryIds) {
    selection[id] = ''
  }
  return {
    key: newLineKey(),
    selection,
    opening_debit: 0,
    opening_credit: 0,
    pre_book_debit: 0,
    pre_book_credit: 0,
  }
}

export function useInitBalanceAux() {
  const loading = ref(false)
  const saving = ref(false)
  const locked = ref(false)
  const lockReason = ref('')
  const currentAccount = ref<{
    id: string
    code: string
    name: string
    direction: string
  } | null>(null)
  const categories = shallowRef<AuxCategoryMeta[]>([])
  const itemsByCategory = shallowRef<Record<string, AuxItemOption[]>>({})
  const categoryFields = shallowRef<Record<string, AuxCategoryFieldMeta[]>>({})
  const codeByCategoryId = shallowRef<Record<string, string>>({})
  const itemSearchCache = ref<Map<string, string> | undefined>(undefined)
  const combinationStore = shallowRef(new Map<string, AuxGridRow>())
  const gridRows = shallowRef<AuxGridRow[]>([])
  const activeCategoryId = ref('')
  const combinationCount = ref(0)
  const keyword = ref('')
  const showZeroValue = ref(true)
  /** 搜索防抖：避免 Win10 下每键全表 filter 导致输入卡顿 */
  const debouncedKeyword = useDebounce(keyword, 300)
  const page = ref(1)
  const pageSize = ref(50)
  const sortField = ref<string>('code')
  const sortOrder = ref<'ascending' | 'descending'>('ascending')
  const lines = gridRows

  const isMidYear = ref(false)
  const selectedYear = ref(new Date().getFullYear())
  const loadProgress = ref({ loaded: 0, total: 0 })
  const categoryStatsFromServer = shallowRef<Record<string, {
    filled: number
    total: number
    opening_debit?: number
    opening_credit?: number
    pre_book_debit?: number
    pre_book_credit?: number
    init_balance?: number
  }>>({})
  const serverPaging = ref(false)
  const serverTotal = ref(0)
  const serverSummary = shallowRef<any>(null)
  const useRowIndex = ref(false)
  const activeCategoryRowKeys = shallowRef<string[]>([])
  let loadRequestSeq = 0
  let pageRequestSeq = 0

  const useCategoryTabs = computed(() => categories.value.length > 1)

  const savedByKey = computed(() => {
    const map = new Map<string, AuxGridRow>()
    for (const row of combinationStore.value.values()) {
      map.set(row.key, row)
    }
    return map
  })

  const filteredRowsAll = computed(() => {
    if (useRowIndex.value) return [] as AuxGridRow[]
    const kw = debouncedKeyword.value.trim().toLowerCase()
    let rows = gridRows.value
    if (kw) {
      rows = filterAuxGridRows({
        rows: gridRows.value,
        keyword: debouncedKeyword.value,
        categoryIds: categories.value.map(c => c.id),
        itemsByCategory: itemsByCategory.value,
        categoryFields: categoryFields.value,
        codeByCategoryId: codeByCategoryId.value,
        combinationCount: gridRows.value.length,
        truncated: false,
        savedByKey: savedByKey.value,
        itemSearchCache: itemSearchCache.value,
      })
    } else if (!showZeroValue.value) {
      rows = rows.filter(lineHasAmount)
    }

    if (rows.length === 0) return rows

    const field = sortField.value
    const asc = sortOrder.value === 'ascending' ? 1 : -1
    const activeId = activeCategoryId.value
    const items = itemsByCategory.value[activeId] || []
    const codeMap = new Map(items.map(i => [i.id, i.code || '']))

    const mapped = rows.map(row => {
      let val: string | number = 0
      if (field === 'code') {
        const itemId = activeId ? row.selection[activeId] : ''
        val =
          (itemId ? codeMap.get(itemId) : '') ||
          row.display_code ||
          ''
      } else if (field === 'balance') {
        val = (row.opening_debit || 0) + (row.pre_book_debit || 0) - (row.opening_credit || 0) - (row.pre_book_credit || 0)
      } else {
        val = Number((row as any)[field]) || 0
      }
      return { row, val }
    })

    if (field === 'code') {
      mapped.sort((a, b) => asc * String(a.val).localeCompare(String(b.val), undefined, { numeric: true }))
    } else {
      mapped.sort((a, b) => asc * ((a.val as number) - (b.val as number)))
    }

    return mapped.map(m => m.row)
  })

  function rowMatchesKeyword(row: AuxGridRow, kw: string, activeId: string) {
    const itemId = row.selection[activeId]
    const parts = [row.display_code, row.display_name]
    if (itemId && itemSearchCache.value) {
      parts.push(itemSearchCache.value.get(itemId))
    }
    return parts.filter(Boolean).join(' ').toLowerCase().includes(kw)
  }

  const filteredRowKeys = computed(() => {
    if (!useRowIndex.value) return [] as string[]
    const activeId = activeCategoryId.value
    if (!activeId) return []
    let keys = activeCategoryRowKeys.value
    const kw = debouncedKeyword.value.trim().toLowerCase()
    if (kw) {
      keys = keys.filter(key => {
        const row = combinationStore.value.get(key)
        if (!row?.selection[activeId]) return false
        return rowMatchesKeyword(row, kw, activeId)
      })
    }
    if (!showZeroValue.value) {
      keys = keys.filter(key => {
        const row = combinationStore.value.get(key)
        return row ? lineHasAmount(row) : false
      })
    }

    if (keys.length === 0) return keys

    const field = sortField.value
    const asc = sortOrder.value === 'ascending' ? 1 : -1
    const items = itemsByCategory.value[activeId] || []
    const codeMap = new Map(items.map(i => [i.id, i.code || '']))

    const mapped = keys.map(key => {
      const row = combinationStore.value.get(key)!
      let val: string | number = 0
      if (field === 'code') {
        val = codeMap.get(row.selection[activeId]) || row.display_code || ''
      } else if (field === 'balance') {
        val = (row.opening_debit || 0) + (row.pre_book_debit || 0) - (row.opening_credit || 0) - (row.pre_book_credit || 0)
      } else {
        val = (row as any)[field] || 0
      }
      return { key, val }
    })

    if (field === 'code') {
      mapped.sort((a, b) => asc * String(a.val).localeCompare(String(b.val), undefined, { numeric: true }))
    } else {
      mapped.sort((a, b) => asc * ((a.val as number) - (b.val as number)))
    }

    return mapped.map(m => m.key)
  })

  const displayTotal = computed(() =>
    serverPaging.value
      ? serverTotal.value
      : useRowIndex.value
        ? filteredRowKeys.value.length
        : filteredRowsAll.value.length
  )

  const displayRows = computed(() => {
    if (serverPaging.value) return gridRows.value
    const start = (page.value - 1) * pageSize.value
    if (useRowIndex.value) {
      const activeId = activeCategoryId.value
      return filteredRowKeys.value.slice(start, start + pageSize.value).map(key => {
        const row = combinationStore.value.get(key)!
        return {
          ...row,
          selection: { [activeId]: row.selection[activeId] },
        }
      })
    }
    return filteredRowsAll.value.slice(start, start + pageSize.value)
  })

  function syncActiveCategoryTab() {
    if (categories.value.length === 0) {
      activeCategoryId.value = ''
      return
    }
    if (!categories.value.some(c => c.id === activeCategoryId.value)) {
      activeCategoryId.value = categories.value[0].id
    }
  }

  function rebuildGridForActiveCategory() {
    syncActiveCategoryTab()
    const activeId = activeCategoryId.value
    if (!activeId || categories.value.length === 0) {
      gridRows.value = []
      activeCategoryRowKeys.value = []
      useRowIndex.value = false
      combinationCount.value = combinationStore.value.size
      return
    }

    let activeCount = 0
    for (const line of combinationStore.value.values()) {
      if (line.selection[activeId]) activeCount++
    }

    if (activeCount > AUX_LARGE_GRID_THRESHOLD) {
      useRowIndex.value = true
      const keys: string[] = []
      for (const line of combinationStore.value.values()) {
        if (line.selection[activeId]) keys.push(line.key)
      }
      activeCategoryRowKeys.value = keys
      gridRows.value = []
    } else {
      useRowIndex.value = false
      activeCategoryRowKeys.value = []
      gridRows.value = buildTabGridRows({
        activeCategoryId: activeId,
        itemsByCategory: itemsByCategory.value,
        combinationStore: combinationStore.value,
      })
    }
    combinationCount.value = combinationStore.value.size
  }

  async function loadServerPage() {
    if (!serverPaging.value || !currentAccount.value || !activeCategoryId.value) return
    const requestSeq = ++pageRequestSeq
    const accountId = currentAccount.value.id
    loading.value = true
    try {
      const res = await request.get<any>('/base/init-balances/aux-details', {
        params: {
          year: selectedYear.value,
          account_id: accountId,
          lines: 'page',
          category_id: activeCategoryId.value,
          offset: (page.value - 1) * pageSize.value,
          limit: pageSize.value,
          keyword: debouncedKeyword.value.trim() || undefined,
          sort: sortField.value === 'balance' ? 'init_balance' : sortField.value,
          order: sortOrder.value === 'descending' ? 'desc' : 'asc',
          nonzero_only: showZeroValue.value ? undefined : 1,
        },
      })
      if (requestSeq !== pageRequestSeq || currentAccount.value?.id !== accountId) return

      const store = new Map<string, AuxGridRow>()
      mergeSavedLinesIntoStore(res.data.lines || [], store)
      combinationStore.value = store
      gridRows.value = [...store.values()]
      activeCategoryRowKeys.value = []
      useRowIndex.value = false
      combinationCount.value = Number(res.data.db_row_count || 0)
      serverTotal.value = Number(res.data.total || 0)
      serverSummary.value = res.data.summary || null
      categoryStatsFromServer.value = res.data.category_stats || {}
    } catch (error) {
      if (requestSeq !== pageRequestSeq) return
      showOperationError('加载辅助期初分页', error)
    } finally {
      if (requestSeq === pageRequestSeq) loading.value = false
    }
  }

  watch(activeCategoryId, () => {
    if (!serverPaging.value) {
      rebuildGridForActiveCategory()
      page.value = 1
      return
    }
    if (page.value !== 1) page.value = 1
    else void loadServerPage()
  })

  watch([sortField, sortOrder, showZeroValue, debouncedKeyword, pageSize], () => {
    if (page.value !== 1) page.value = 1
    else if (serverPaging.value) void loadServerPage()
  })

  watch(page, () => {
    if (serverPaging.value) void loadServerPage()
  })

  function mergeSavedLinesIntoStore(
    savedLines: Array<{
      selection: Record<string, string>
      opening_debit?: number
      opening_credit?: number
      pre_book_debit?: number
      pre_book_credit?: number
      display_code?: string
      display_name?: string
    }>,
    targetStore: Map<string, AuxGridRow>
  ) {
    const catIds = categories.value.map(c => c.id)
    for (const row of savedLines || []) {
      const opening = normalizeOpeningDebitCredit(
        row.opening_debit || 0,
        row.opening_credit || 0
      )
      const filled = catIds.filter(id => row.selection[id])
      for (const catId of filled) {
        const itemId = row.selection[catId]
        if (!itemId) continue
        const key =
          buildSingleCategoryAuxItemId(codeByCategoryId.value, catId, itemId) || newLineKey()
        if (targetStore.has(key)) continue
        targetStore.set(key, {
          key,
          selection: { [catId]: itemId },
          ...opening,
          pre_book_debit: row.pre_book_debit || 0,
          pre_book_credit: row.pre_book_credit || 0,
          display_code: row.display_code,
          display_name: row.display_name,
        })
      }
    }
  }

  function addLine() {
    showError('已列出全部项目，请直接在对应行录入金额')
  }

  function removeLineByKey(key: string) {
    const newStore = new Map(combinationStore.value)
    newStore.delete(key)
    combinationStore.value = newStore
    rebuildGridForActiveCategory()
  }

  function countIncompleteLines() {
    return 0
  }

  function categoryTabStats(catId: string) {
    return countCategoryFilled(catId, itemsByCategory.value, combinationStore.value)
  }

  /** 标签页标题：优先用服务端统计，避免大数据量下反复扫描 combinationStore */
  const categoryTabLabels = computed(() => {
    const labels: Record<string, string> = {}
    for (const cat of categories.value) {
      const serverStats = categoryStatsFromServer.value[cat.id]
      const { filled, total } = serverStats ?? categoryTabStats(cat.id)
      labels[cat.id] = `${cat.name}（${filled}/${total}）`
    }
    return labels
  })

  function categoryHasAnyAmount(catId: string) {
    if (serverPaging.value) return (categoryStatsFromServer.value[catId]?.filled || 0) > 0
    return [...combinationStore.value.values()].some(
      line => line.selection[catId] && lineHasAmount(line)
    )
  }

  function categoryTotalsList() {
    const direction = currentAccount.value?.direction || 'debit'
    return categories.value.map(cat => {
      const stats = serverPaging.value ? categoryStatsFromServer.value[cat.id] : undefined
      const t = stats
        ? {
            opening_debit: Number(stats.opening_debit || 0),
            opening_credit: Number(stats.opening_credit || 0),
            pre_book_debit: Number(stats.pre_book_debit || 0),
            pre_book_credit: Number(stats.pre_book_credit || 0),
          }
        : sumCategoryTotals(cat.id, combinationStore.value, true)
      const initBalance = stats?.init_balance ?? categoryInitBalance(direction, t)
      return {
        id: cat.id,
        name: cat.name,
        ...t,
        debit: t.opening_debit + t.pre_book_debit,
        credit: t.opening_credit + t.pre_book_credit,
        initBalance,
      }
    })
  }

  function validateCategoryTotalsMatch(strict = false): string | null {
    if (categories.value.length <= 1) return null

    if (strict) {
      const missing = categories.value.filter(c => !categoryHasAnyAmount(c.id))
      if (missing.length > 0) {
        return `请先在「${missing.map(c => c.name).join('、')}」标签页录入期初金额`
      }
    } else {
      const withAmount = categories.value.filter(c => categoryHasAnyAmount(c.id))
      if (withAmount.length <= 1) return null
      if (withAmount.length < categories.value.length) return null
    }

    const totalsByCategoryId = new Map(categories.value.map(cat => {
      const stats = serverPaging.value ? categoryStatsFromServer.value[cat.id] : undefined
      return [
        cat.id,
        stats
          ? {
              opening_debit: Number(stats.opening_debit || 0),
              opening_credit: Number(stats.opening_credit || 0),
              pre_book_debit: Number(stats.pre_book_debit || 0),
              pre_book_credit: Number(stats.pre_book_credit || 0),
            }
          : sumCategoryTotals(cat.id, combinationStore.value, false),
      ] as const
    }))
    const result = checkAuxCategoryAmountConsistency(categories.value, totalsByCategoryId)
    return result?.message || null
  }

  async function checkCanEdit(year: number) {
    try {
      const res = (await request.get('/base/init-balances/aux-can-edit', {
        params: { year },
      })) as any
      locked.value = !res.canEdit
      lockReason.value = res.reason || ''
    } catch {
      locked.value = false
      lockReason.value = ''
    }
  }

  function applyAuxDetailsMeta(data: any, accountId: string) {
    if (data.account?.id !== accountId) {
      throw new Error('科目数据不匹配，请刷新后重试')
    }
    currentAccount.value = data.account
    categories.value = data.categories || []
    const items: Record<string, AuxItemOption[]> = {}
    for (const [catId, list] of Object.entries(data.items || {})) {
      items[catId] = (list as AuxItemOption[]).map(item => ({
        ...item,
        field_values:
          typeof item.field_values === 'string'
            ? (() => {
                try {
                  return JSON.parse(item.field_values as string)
                } catch {
                  return {}
                }
              })()
            : item.field_values || {},
      }))
    }
    itemsByCategory.value = items
    categoryFields.value = data.category_fields || {}
    codeByCategoryId.value = data.code_by_category_id || {}
    categoryStatsFromServer.value = data.category_stats || {}
    if (data.items_omitted) {
      itemSearchCache.value = new Map()
    } else {
      itemSearchCache.value = buildItemSearchCache(itemsByCategory.value, categoryFields.value)
    }
    isMidYear.value = !!data.isMidYear
  }

  async function loadDetails(accountId: string, year: number) {
    const requestSeq = ++loadRequestSeq
    loading.value = true
    loadProgress.value = { loaded: 0, total: 0 }
    selectedYear.value = year
    currentAccount.value = null
    categories.value = []
    itemsByCategory.value = {}
    categoryFields.value = {}
    codeByCategoryId.value = {}
    itemSearchCache.value = undefined
    categoryStatsFromServer.value = {}
    serverPaging.value = false
    serverTotal.value = 0
    serverSummary.value = null
    pageRequestSeq++
    activeCategoryId.value = ''
    combinationStore.value = new Map()
    gridRows.value = []
    activeCategoryRowKeys.value = []
    useRowIndex.value = false
    keyword.value = ''
    page.value = 1
    try {
      await checkCanEdit(year)
      if (requestSeq !== loadRequestSeq) return

      const metaRes = await request.get<any>('/base/init-balances/aux-details', {
        params: { year, account_id: accountId, lines: 'none' },
      })
      if (requestSeq !== loadRequestSeq) return

      applyAuxDetailsMeta(metaRes.data, accountId)

      serverPaging.value = !!metaRes.data.lines_paginated
      if (serverPaging.value) {
        syncActiveCategoryTab()
        await loadServerPage()
        return
      }

      const totalRows = metaRes.data.db_row_count ?? metaRes.data.line_count ?? 0
      loadProgress.value = { loaded: 0, total: totalRows }

      if (totalRows === 0) {
        syncActiveCategoryTab()
        rebuildGridForActiveCategory()
        return
      }

      const store = new Map<string, AuxGridRow>()
      const fullRes = await request.get<any>('/base/init-balances/aux-details', {
        params: { year, account_id: accountId, lines: 'all' },
      })
      if (requestSeq !== loadRequestSeq) return
      mergeSavedLinesIntoStore(fullRes.data.lines || [], store)
      loadProgress.value = { loaded: totalRows, total: totalRows }

      combinationStore.value = store
      syncActiveCategoryTab()
      rebuildGridForActiveCategory()
    } catch (error) {
      if (requestSeq !== loadRequestSeq) return
      showOperationError('加载辅助期初', error)
      throw error
    } finally {
      if (requestSeq === loadRequestSeq) {
        loading.value = false
        loadProgress.value = { loaded: 0, total: 0 }
      }
    }
  }

  const activeCategoryTotals = computed(() => {
    const catId = activeCategoryId.value
    if (!catId) {
      return {
        opening_debit: 0,
        opening_credit: 0,
        pre_book_debit: 0,
        pre_book_credit: 0,
      }
    }
    const stats = serverPaging.value ? categoryStatsFromServer.value[catId] : undefined
    if (stats) {
      return {
        opening_debit: Number(stats.opening_debit || 0),
        opening_credit: Number(stats.opening_credit || 0),
        pre_book_debit: Number(stats.pre_book_debit || 0),
        pre_book_credit: Number(stats.pre_book_credit || 0),
      }
    }
    return sumCategoryTotals(catId, combinationStore.value, true)
  })

  function lineTotals() {
    const catId = activeCategoryId.value
    if (!catId) return { debit: 0, credit: 0 }
    const t = serverPaging.value
      ? activeCategoryTotals.value
      : sumCategoryTotals(catId, combinationStore.value)
    return {
      debit: t.opening_debit + t.pre_book_debit,
      credit: t.opening_credit + t.pre_book_credit,
    }
  }

  function allSavableLines(): AuxGridRow[] {
    const validIds = buildAuxItemIdSetByCategory(itemsByCategory.value)
    return [...combinationStore.value.values()].filter(line => {
      if (!lineHasAmount(line)) return false
      return isAuxLineItemValid(line, itemsByCategory.value, validIds)
    })
  }

  async function buildSavePayloadLines(lines: AuxGridRow[]) {
    const payloadLines: Array<{
      active_category_id: string
      selection: Record<string, string>
      opening_debit: number
      opening_credit: number
      pre_book_debit: number
      pre_book_credit: number
    }> = []

    for (let start = 0; start < lines.length; start += AUX_SAVE_PAYLOAD_CHUNK) {
      const end = Math.min(start + AUX_SAVE_PAYLOAD_CHUNK, lines.length)
      for (let i = start; i < end; i++) {
        const line = lines[i]
        const catId = Object.keys(line.selection).find(id => line.selection[id])!
        const opening = normalizeOpeningDebitCredit(line.opening_debit || 0, line.opening_credit || 0)
        payloadLines.push({
          active_category_id: catId,
          selection: { [catId]: line.selection[catId] },
          ...opening,
          pre_book_debit: line.pre_book_debit || 0,
          pre_book_credit: line.pre_book_credit || 0,
        })
      }
      await yieldToMain()
    }
    return payloadLines
  }

  /** @returns null 未选齐维度跳过；true 成功；false 失败 */
  async function saveLine(line: AuxGridRow): Promise<boolean | null> {
    if (!currentAccount.value || locked.value) return false
    const activeId = activeCategoryId.value
    if (!activeId || !isLineSelectionComplete(line, activeId)) return null

    const itemId = line.selection[activeId]
    const stableKey = buildSingleCategoryAuxItemId(
      codeByCategoryId.value,
      activeId,
      itemId
    )
    if (!stableKey) return false

    syncLineToCombinationStore(
      line,
      combinationStore.value,
      activeId,
      codeByCategoryId.value
    )

    if (!lineHasAmount(line)) {
      if (line.key.startsWith('draft:')) return true
    }

    try {
      const opening = normalizeOpeningDebitCredit(
        line.opening_debit || 0,
        line.opening_credit || 0
      )
      line.opening_debit = opening.opening_debit
      line.opening_credit = opening.opening_credit
      await request.post('/base/init-balances/aux-details/line', {
        year: selectedYear.value,
        account_id: currentAccount.value.id,
        line: {
          active_category_id: activeId,
          selection: { [activeId]: itemId },
          ...opening,
          pre_book_debit: line.pre_book_debit || 0,
          pre_book_credit: line.pre_book_credit || 0,
        },
      })

      if (serverPaging.value) await loadServerPage()
      // Trigger shallowRef update for gridRows since a row was modified inline
      gridRows.value = [...gridRows.value]
      return true
    } catch (error) {
      showOperationError('保存辅助期初', error)
      return false
    }
  }

  async function save(): Promise<{ summary?: any; taskId?: string } | null> {
    if (!currentAccount.value) return null
    const mismatch = validateCategoryTotalsMatch(true)
    if (mismatch) {
      showError(mismatch)
      return null
    }
    if (serverPaging.value) {
      showSuccess('当前分页修改已逐行保存')
      return { summary: serverSummary.value }
    }
    const lines = allSavableLines()
    if (lines.length === 0) {
      showError('没有可保存的有效辅助期初数据')
      return null
    }
    saving.value = true
    try {
      const payloadLines = await buildSavePayloadLines(lines)
      const payload = {
        year: selectedYear.value,
        account_id: currentAccount.value.id,
        lines: payloadLines,
      }

      if (payloadLines.length >= AUX_SAVE_ASYNC_THRESHOLD) {
        const res = await request.post<any>('/base/init-balances/aux-details/batch-save-async', payload)
        const taskId = res.data?.taskId
        if (!taskId) {
          throw new Error('未获取到保存任务 ID')
        }
        return { taskId }
      }

      const res = await request.post<any>('/base/init-balances/aux-details', payload)
      showSuccess('辅助期初保存成功')
      return { summary: res.data?.summary || res.data }
    } catch (error) {
      showOperationError('保存辅助期初', error)
      return null
    } finally {
      saving.value = false
    }
  }

  function buildTemplateRows(): Record<string, string | number>[] {
    const sampleLine = createEmptyAuxLine(categories.value.map(c => c.id))
    for (const cat of categories.value) {
      const first = itemsByCategory.value[cat.id]?.[0]
      if (first) sampleLine.selection[cat.id] = first.id
    }

    const toRow = (line: InitBalanceAuxLine) => {
      const row: Record<string, string | number> = {}
      for (const cat of categories.value) {
        const item = itemsByCategory.value[cat.id]?.find(i => i.id === line.selection[cat.id])
        row[categoryCodeColumn(cat)] = item?.code || ''
        row[categoryNameColumn(cat)] = item?.name || ''
      }
      row['年初借方'] = line.opening_debit || 0
      row['年初贷方'] = line.opening_credit || 0
      if (isMidYear.value) {
        row['帐前借方'] = line.pre_book_debit || 0
        row['帐前贷方'] = line.pre_book_credit || 0
      }
      return row
    }

    const rows = [toRow(sampleLine)]
    if (itemsByCategory.value[categories.value[0]?.id]?.length > 1) {
      const second = createEmptyAuxLine(categories.value.map(c => c.id))
      for (const cat of categories.value) {
        const items = itemsByCategory.value[cat.id] || []
        const pick = items[1] || items[0]
        if (pick) second.selection[cat.id] = pick.id
      }
      second.opening_debit = 0
      second.opening_credit = 0
      rows.push(toRow(second))
    }
    return rows
  }

  async function downloadTemplate() {
    if (!currentAccount.value) return
    const { utils, writeFile } = await import('xlsx')
    const rows = buildTemplateRows()
    const ws = utils.json_to_sheet(rows)
    const colWidths = categories.value.flatMap(() => [{ wch: 14 }, { wch: 18 }])
    colWidths.push({ wch: 14 }, { wch: 14 })
    if (isMidYear.value) colWidths.push({ wch: 14 }, { wch: 14 })
    ws['!cols'] = colWidths
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, '辅助期初模板')
    const acc = currentAccount.value
    writeFile(wb, `辅助期初模板_${acc.code}_${selectedYear.value}年.xlsx`)
  }

  function linesToExportRows(): Record<string, string | number>[] {
    return allSavableLines().map(line => {
      const row: Record<string, string | number> = {}
      for (const cat of categories.value) {
        const item = itemsByCategory.value[cat.id]?.find(i => i.id === line.selection[cat.id])
        row[categoryCodeColumn(cat)] = item?.code || ''
        row[categoryNameColumn(cat)] = item?.name || ''
      }
      row['年初借方'] = line.opening_debit || 0
      row['年初贷方'] = line.opening_credit || 0
      if (isMidYear.value) {
        row['帐前借方'] = line.pre_book_debit || 0
        row['帐前贷方'] = line.pre_book_credit || 0
      }
      return row
    })
  }

  async function exportData() {
    if (!currentAccount.value) return
    if (serverPaging.value) {
      const res = await request.post<any>('/base/init-balances/aux-details/export-async', {
        year: selectedYear.value,
        account_id: currentAccount.value.id,
      })
      const taskId = res.data?.taskId
      if (!taskId) throw new Error('未获取到导出任务 ID')
      showSuccess('导出任务已提交，可继续操作当前页面')
      return taskId
    }
    if (allSavableLines().length === 0) {
      showError('没有可导出的数据')
      return
    }
    const [{ exportStyledTable }, { buildInitBalanceAuxExportColumns }] = await Promise.all([
      import('@/utils/exportStyledExcel'),
      import('@/utils/ledgerExportBuilders'),
    ])
    const rows = linesToExportRows()
    const acc = currentAccount.value
    await exportStyledTable({
      fileName: `辅助期初_${acc.code}_${selectedYear.value}年.xlsx`,
      sheetName: '辅助期初',
      title: '辅助期初余额',
      subtitle: `${acc.code} ${acc.name} · ${selectedYear.value}年`,
      columns: buildInitBalanceAuxExportColumns(categories.value, isMidYear.value),
      rows,
    })
    showSuccess(`已导出 ${rows.length} 条辅助期初`)
  }

  function parseImportRows(
    rawData: any[],
    options?: { allowPendingCreate?: boolean }
  ): {
    rows: import('@/utils/initBalanceAuxImport').AuxImportPreviewRowLike[]
    blankSkipped: number
  } {
    return parseAuxImportRows(rawData, categories.value, itemsByCategory.value, options)
  }

  async function createMissingAuxItemsFromDrafts(drafts: MissingAuxItemDraft[]) {
    if (drafts.length === 0) return
    const byCategory = new Map<string, MissingAuxItemDraft[]>()
    for (const draft of drafts) {
      const list = byCategory.get(draft.categoryId) || []
      list.push(draft)
      byCategory.set(draft.categoryId, list)
    }

    for (const [categoryId, items] of byCategory) {
      const res = (await request.post('/base/aux-items/batch-import', {
        type: categoryId,
        items: items.map(({ categoryId: _c, ...rest }) => rest),
      })) as any
      const failCount = res.data?.failCount ?? 0
      if (failCount > 0) {
        const firstErr = res.data?.errors?.[0]?.reason || '部分项目创建失败'
        throw new Error(firstErr)
      }
      const fresh = await request.post<AuxItemOption[]>('/base/aux-items/import-match-index', {
        type: categoryId,
        codes: items.map(item => item.code).filter(Boolean),
        names: items.map(item => item.name).filter(Boolean),
      })
      const newItems = { ...itemsByCategory.value }
      newItems[categoryId] = (fresh.data || []).map((item: AuxItemOption) => ({
        ...item,
        field_values:
          typeof item.field_values === 'string'
            ? (() => {
                try {
                  return JSON.parse(item.field_values as string)
                } catch {
                  return {}
                }
              })()
            : item.field_values || {},
      }))
      itemsByCategory.value = newItems
    }
    itemSearchCache.value = buildItemSearchCache(itemsByCategory.value, categoryFields.value)
  }

  function applyImportPreview(
    preview: import('@/utils/initBalanceAuxImport').AuxImportPreviewRowLike[],
    extraItemsByCategory?: Record<string, AuxItemOption[]>
  ) {
    if (extraItemsByCategory && Object.keys(extraItemsByCategory).length > 0) {
      itemsByCategory.value = mergeAuxItemsByCategory(
        itemsByCategory.value,
        extraItemsByCategory
      ) as Record<string, AuxItemOption[]>
      itemSearchCache.value = buildItemSearchCache(itemsByCategory.value, categoryFields.value)
    }
    const matched = preview.filter(r => r.matched)
    const skipped = preview.filter(r => !r.matched).length
    if (matched.length === 0) {
      showError(
        skipped > 0
          ? '没有可导入的有效行，请先查看异常说明并修正模板'
          : '没有可导入的有效数据'
      )
      return { imported: 0, skipped }
    }
    const store = new Map(combinationStore.value)
    for (const row of matched) {
      const catId = Object.keys(row.selection).find(id => row.selection[id])
      if (!catId) continue
      const opening = normalizeOpeningDebitCredit(row.opening_debit, row.opening_credit)
      const key =
        buildSingleCategoryAuxItemId(codeByCategoryId.value, catId, row.selection[catId]) ||
        newLineKey()
      store.set(key, {
        key,
        selection: { [catId]: row.selection[catId] },
        ...opening,
        pre_book_debit: row.pre_book_debit,
        pre_book_credit: row.pre_book_credit,
      })
    }
    combinationStore.value = store
    rebuildGridForActiveCategory()
    page.value = 1
    return { imported: matched.length, skipped }
  }

  async function previewBatchClear(scope: 'account' | 'category', categoryId?: string) {
    if (!currentAccount.value) return 0
    const res = (await request.get('/base/init-balances/aux-details/clear-preview', {
      params: {
        year: selectedYear.value,
        account_id: currentAccount.value.id,
        scope,
        category_id: scope === 'category' ? categoryId || activeCategoryId.value : undefined,
      },
    })) as any
    return res.data?.count || 0
  }

  async function batchClearAsync(
    scope: 'account' | 'category',
    categoryId?: string
  ): Promise<string | null> {
    if (!currentAccount.value || locked.value) return null
    try {
      const res = (await request.post('/base/init-balances/aux-details/batch-clear-async', {
        year: selectedYear.value,
        account_id: currentAccount.value.id,
        scope,
        category_id: scope === 'category' ? categoryId || activeCategoryId.value : undefined,
      })) as any
      return res.data?.taskId || null
    } catch (error) {
      showOperationError('批量清理辅助期初', error)
      return null
    }
  }

  return {
    loading,
    loadProgress,
    saving,
    locked,
    lockReason,
    currentAccount,
    categories,
    itemsByCategory,
    categoryFields,
    codeByCategoryId,
    gridRows,
    displayRows,
    displayTotal,
    keyword,
    showZeroValue,
    page,
    pageSize,
    sortField,
    sortOrder,
    combinationCount,
    combinationStore,
    useCategoryTabs,
    activeCategoryId,
    lines,
    isMidYear,
    selectedYear,
    loadDetails,
    checkCanEdit,
    addLine,
    removeLineByKey,
    countIncompleteLines,
    categoryTabStats,
    categoryTabLabels,
    categoryTotalsList,
    validateCategoryTotalsMatch,
    saveLine,
    save,
    lineTotals,
    activeCategoryTotals,
    downloadTemplate,
    exportData,
    parseImportRows,
    applyImportPreview,
    createMissingAuxItemsFromDrafts,
    previewBatchClear,
    batchClearAsync,
  }
}

export { categoryCodeColumn, categoryNameColumn } from '@/utils/initBalanceAuxImport'
