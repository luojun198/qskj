import { ref, reactive, computed, shallowRef } from 'vue'
import type { Ref } from 'vue'
import request from '@/api/request'
import { useSearchMemory } from '@/composables/useSearchMemory'
import { performanceMonitor } from '@/utils/performanceMonitor'
import { useBaseDataStore } from '@/stores/baseData'
import type { Voucher } from '@/types/voucher'
import {
  buildVoucherFlatRows,
  getVoucherSeq,
  getTypeAbbr,
  parseVoucherAuxData,
} from '@/utils/voucherFlatList'
import { VOUCHER_LIST_SOFT_CAP } from '@/utils/voucherListPerf'

export interface VoucherFilters {
  keyword: string
  status: string
  year: number | null
  period: number | null
  dateRange: string[]
  voucherTypeIds: string[]
  accountIds: number[]
  auxItems: Record<string, number[]>
  auxFields: Record<string, string>
  sortField: string
  sortOrder: 'asc' | 'desc'
  makerName?: string
  auditorName?: string
  posterName?: string
}

/** 深拷贝凭证筛选条件（用于查询方案保存） */
export function cloneVoucherFilters(filters: VoucherFilters): VoucherFilters {
  return {
    keyword: filters.keyword ?? '',
    status: filters.status ?? '',
    year: filters.year ?? null,
    period: filters.period ?? null,
    dateRange: [...(filters.dateRange || [])],
    voucherTypeIds: [...(filters.voucherTypeIds || [])],
    accountIds: [...(filters.accountIds || [])],
    auxItems: Object.fromEntries(
      Object.entries(filters.auxItems || {}).map(([k, v]) => [k, [...(v || [])]])
    ),
    auxFields: { ...(filters.auxFields || {}) },
    sortField: filters.sortField ?? 'voucher_date',
    sortOrder: filters.sortOrder ?? 'asc',
    makerName: filters.makerName ?? '',
    auditorName: filters.auditorName ?? '',
    posterName: filters.posterName ?? '',
  }
}

/** 将查询方案条件应用到当前筛选（覆盖嵌套字段） */
export function applyVoucherFilters(target: VoucherFilters, source: Partial<VoucherFilters>) {
  if (source.keyword !== undefined) target.keyword = source.keyword
  if (source.status !== undefined) target.status = source.status
  if (source.year !== undefined) target.year = source.year
  if (source.period !== undefined) target.period = source.period
  if (source.dateRange !== undefined) target.dateRange = [...source.dateRange]
  if (source.voucherTypeIds !== undefined) target.voucherTypeIds = [...source.voucherTypeIds]
  if (source.accountIds !== undefined) target.accountIds = [...source.accountIds]
  if (source.auxItems !== undefined) {
    target.auxItems = Object.fromEntries(
      Object.entries(source.auxItems).map(([k, v]) => [k, [...(v || [])]])
    )
  }
  if (source.auxFields !== undefined) target.auxFields = { ...source.auxFields }
  if (source.sortField !== undefined) target.sortField = source.sortField
  if (source.sortOrder !== undefined) target.sortOrder = source.sortOrder
  if (source.makerName !== undefined) target.makerName = source.makerName
  if (source.auditorName !== undefined) target.auditorName = source.auditorName
  if (source.posterName !== undefined) target.posterName = source.posterName
}

export interface UseVoucherQueryOptions {
  // 启用的筛选条件
  enableStatus?: boolean
  enableYearPeriod?: boolean
  enableVoucherType?: boolean
  enableAccount?: boolean
  enableAuxiliary?: boolean
  enableSort?: boolean
  enableSearchMemory?: boolean

  // 搜索记忆的 key（如果启用搜索记忆）
  searchMemoryKey?: string

  // 默认筛选条件
  defaultFilters?: Partial<VoucherFilters>
  /** 每次加载条数，默认 20 */
  defaultPageSize?: number
}

export function useVoucherQuery(options: UseVoucherQueryOptions = {}) {
  const {
    enableStatus = false,
    enableYearPeriod = false,
    enableVoucherType = false,
    enableAccount = false,
    enableAuxiliary = false,
    enableSort = false,
    enableSearchMemory = false,
    searchMemoryKey = 'voucher-query-filters',
    defaultFilters = {},
    defaultPageSize = 20,
  } = options

  // 获取当月日期范围
  function getCurrentMonthRange(): string[] {
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth()
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    return [startDate, endDate]
  }

  // 默认筛选条件
  const defaultFilterValues: VoucherFilters = {
    keyword: '',
    status: '',
    year: null,
    period: null,
    dateRange: getCurrentMonthRange(),
    voucherTypeIds: [],
    accountIds: [],
    auxItems: {},
    auxFields: {},
    sortField: 'voucher_date',
    sortOrder: 'asc',
    makerName: '',
    auditorName: '',
    posterName: '',
    ...defaultFilters,
  }

  // 筛选条件状态（支持搜索记忆）
  const filters: Ref<VoucherFilters> = enableSearchMemory
    ? useSearchMemory(searchMemoryKey, defaultFilterValues)
    : ref(defaultFilterValues)

  // 分页状态
  const pagination = reactive({ page: 1, pageSize: defaultPageSize, total: 0 })

  // 数据列表
  const list = ref<Voucher[]>([])
  const loading = ref(false)
  // 滚动追加加载中（与首次/重新加载的 loading 区分，避免整表 loading 遮罩闪烁）
  const loadingMore = ref(false)
  // 是否还有未加载的数据（pageSize 为 -1 表示「全部」，不参与滚动加载）
  const hasMore = computed(
    () => pagination.pageSize !== -1 && list.value.length < pagination.total
  )

  const baseDataStore = useBaseDataStore()

  // 辅助数据（凭证类型/科目/辅助类别从 store 读取，过滤器用辅助项目 Map 单独维护）
  const auxCategories = computed(() => baseDataStore.auxCategories)
  const voucherTypes = computed(() => baseDataStore.voucherTypes)
  const accounts = computed(() => baseDataStore.accounts)
  const auxItemsMap = ref<Record<string, any[]>>({})

  // 构建查询参数
  function buildQueryParams(): Record<string, any> {
    const params: any = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    }

    // 关键词搜索（始终启用）
    if (filters.value?.keyword) {
      params.keyword = filters.value.keyword
    }

    // 状态筛选
    if (enableStatus && filters.value?.status) {
      params.status = filters.value.status
    }

    // 年度/期间筛选
    if (enableYearPeriod) {
      if (filters.value?.year) params.year = filters.value.year
      if (filters.value?.period) params.period = filters.value.period
    }

    // 日期范围筛选（始终启用）
    if (filters.value?.dateRange?.length === 2) {
      params.start_date = filters.value.dateRange[0]
      params.end_date = filters.value.dateRange[1]
    }

    // 凭证类型筛选
    if (enableVoucherType && filters.value?.voucherTypeIds?.length > 0) {
      const typeIds = filters.value.voucherTypeIds.filter((id: string) => id !== '')
      if (typeIds.length > 0) {
        params.voucher_type_ids = typeIds.join(',')
      }
    }

    // 科目筛选
    if (enableAccount && filters.value?.accountIds?.length > 0) {
      // 后端支持科目多选，参数会在路由层处理
      // 这里暂时不处理，等待后端支持
    }

    // 辅助核算项目筛选
    if (enableAuxiliary && filters.value?.auxItems) {
      for (const [categoryId, itemIds] of Object.entries(filters.value.auxItems)) {
        if (itemIds && itemIds.length > 0) {
          params[`aux_${categoryId}`] = itemIds
        }
      }
      // 辅助核算自定义字段筛选
      if (filters.value?.auxFields) {
        for (const [key, value] of Object.entries(filters.value.auxFields)) {
          if (value) {
            params[`aux_field_${key}`] = value
          }
        }
      }
    }

    // 排序
    if (enableSort && filters.value) {
      params.sortField = filters.value.sortField
      params.sortOrder = filters.value.sortOrder
    }

    // 经办人筛选
    if (filters.value?.makerName) {
      params.maker_name = filters.value.makerName
    }
    if (filters.value?.auditorName) {
      params.auditor_name = filters.value.auditorName
    }
    if (filters.value?.posterName) {
      params.poster_name = filters.value.posterName
    }

    return params
  }

  // 查询方法（append 为 true 时把结果追加到列表末尾，用于滚动加载）
  async function fetchData(opts: { append?: boolean } = {}) {
    const append = opts.append === true
    if (loading.value || loadingMore.value) return
    if (append) {
      loadingMore.value = true
    } else {
      loading.value = true
    }
    try {
      await performanceMonitor.measure('voucherQuery', async () => {
        const params = buildQueryParams()
        const res = await request.get<Voucher[]>('/voucher/vouchers', { params })
        const nextList = res.data || []
        const nextTotal = res.total ?? 0

        if (append) {
          const prevCount = list.value.length
          list.value = list.value.concat(nextList)
          pagination.total = nextTotal
          // 传入偏移量，保证追加后斑马纹继续交替
          flatList.value = flatList.value.concat(buildFlatList(nextList, prevCount))
          return
        }

        const maxPage = Math.max(1, Math.ceil(nextTotal / Math.max(1, pagination.pageSize)))
        if (nextList.length === 0 && nextTotal > 0 && pagination.page > maxPage) {
          pagination.page = maxPage
          loading.value = false
          await fetchData()
          return
        }
        list.value = nextList
        pagination.total = nextTotal
        clearCache()
        flatList.value = buildFlatList(list.value)
      })
    } finally {
      if (append) {
        loadingMore.value = false
      } else {
        loading.value = false
      }
    }
  }

  /** 滚动到底部时加载下一页并追加 */
  async function loadMore() {
    if (!hasMore.value || loading.value || loadingMore.value) return
    pagination.page += 1
    await fetchData({ append: true })
  }

  /**
   * 一次性加载到指定页（用于从详情页返回时还原已加载的行）
   * 以 pageSize = page * pageSize 单次请求，避免逐页串行
   */
  async function loadUpTo(page: number, pageSize: number) {
    const targetPage = Math.max(1, page)
    const targetSize = pageSize === -1 ? -1 : Math.max(1, pageSize)
    if (targetPage === 1 || targetSize === -1) {
      pagination.page = targetPage
      pagination.pageSize = targetSize
      await fetchData()
      return
    }
    const originalPage = pagination.page
    const originalSize = pagination.pageSize
    pagination.page = 1
    pagination.pageSize = targetPage * targetSize
    try {
      await fetchData()
    } finally {
      // 复原分页游标，后续 loadMore 从 targetPage 继续
      pagination.page = targetPage
      pagination.pageSize = targetSize
      void originalPage
      void originalSize
    }
  }

  // 分页方法
  function onPageChange(page: number) {
    pagination.page = page
    fetchData()
  }

  function onPageSizeChange(size: number) {
    pagination.pageSize = size
    pagination.page = 1
    fetchData()
  }

  /**
   * 一次尽量加载剩余凭证。
   * 表格内加载上限为软上限，避免一次塞入过多 DOM。
   */
  async function loadRemaining() {
    if (!hasMore.value || loading.value || loadingMore.value) return
    const remaining = Math.max(0, pagination.total - list.value.length)
    if (remaining <= 0) return
    const originalSize = pagination.pageSize === -1 ? 50 : Math.max(1, pagination.pageSize)
    const targetSize = Math.min(VOUCHER_LIST_SOFT_CAP, pagination.total)
    if (list.value.length >= targetSize) return
    pagination.page = 1
    pagination.pageSize = targetSize
    try {
      await fetchData()
    } finally {
      pagination.pageSize = originalSize
      pagination.page = Math.max(1, Math.ceil(list.value.length / originalSize))
    }
  }

  // 排序方法
  function onSortChange(field: string, order: 'asc' | 'desc') {
    filters.value.sortField = field
    filters.value.sortOrder = order
    pagination.page = 1
    fetchData()
  }

  // 加载辅助数据（代理 baseDataStore，保持接口兼容）
  async function loadAuxCategories() {
    await baseDataStore.loadAuxCategories()
  }

  async function loadVoucherTypes() {
    await baseDataStore.loadVoucherTypes()
  }

  async function loadAccounts() {
    await baseDataStore.loadAccounts()
  }

  async function loadAuxItems(categoryId: string, keyword?: string) {
    try {
      const res = await request.get<any[]>('/base/aux-items', {
        params: {
          category_id: categoryId,
          limit: 80,
          status: 'active',
          ...(keyword?.trim() ? { keyword: keyword.trim() } : {}),
        },
      })
      auxItemsMap.value[categoryId] = res.data
    } catch (error) {
      console.error('加载辅助核算项目失败', error)
    }
  }

  async function searchAuxItems(categoryId: string, keyword: string) {
    await loadAuxItems(categoryId, keyword)
  }

  const auxDataCache = new Map<string, Record<string, string>>()

  // 扁平化列表（shallowRef 手动更新，避免 computed 在无关响应式变化时重新计算）
  const flatList = shallowRef<any[]>([])

  function buildFlatList(vouchers: any[], indexOffset = 0): any[] {
    return buildVoucherFlatRows(vouchers, {
      mode: 'query',
      indexOffset,
      auxDataCache,
    })
  }

  function clearCache() {
    auxDataCache.clear()
  }

  function parseAuxData(entry: any) {
    return parseVoucherAuxData(entry, auxDataCache)
  }

  return {
    // 状态
    filters,
    pagination,
    list,
    loading,
    loadingMore,
    hasMore,
    auxCategories,
    voucherTypes,
    accounts,
    auxItemsMap,
    flatList,

    // 方法
    fetchData,
    loadMore,
    loadUpTo,
    loadRemaining,
    buildQueryParams,
    onPageChange,
    onPageSizeChange,
    onSortChange,
    loadAuxCategories,
    loadVoucherTypes,
    loadAccounts,
    loadAuxItems,
    searchAuxItems,
    clearCache,

    // 工具方法
    getVoucherSeq,
    getTypeAbbr,
    parseAuxData,
  }
}
