import { shallowRef, reactive } from 'vue'
import request from '@/api/request'

export interface AuxItemsPageParams {
  type?: string
  category_id?: string
  page?: number
  pageSize?: number
  keyword?: string
  status?: string
  ids?: string[]
}

const AUX_ITEMS_FETCH_PAGE_SIZE = 500

export async function fetchAuxItemsPage(params: AuxItemsPageParams) {
  const query: Record<string, string | number> = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 50,
  }
  if (params.type) query.type = params.type
  if (params.category_id) query.category_id = params.category_id
  if (params.keyword?.trim()) query.keyword = params.keyword.trim()
  if (params.status) query.status = params.status
  if (params.ids?.length) {
    delete query.page
    delete query.pageSize
    query.ids = params.ids.join(',')
  }
  const res = (await request.get<any[]>('/base/aux-items', { params: query })) as {
    data: any[]
    total?: number
  }
  return { items: res.data || [], total: res.total ?? (res.data?.length ?? 0) }
}

async function fetchAllAuxItemsPaged(
  scope: { type?: string; category_id?: string },
  options?: { status?: string; onProgress?: (loaded: number, total: number) => void }
) {
  let page = 1
  let total = 0
  const all: any[] = []
  do {
    const { items, total: t } = await fetchAuxItemsPage({
      ...scope,
      page,
      pageSize: AUX_ITEMS_FETCH_PAGE_SIZE,
      status: options?.status,
    })
    if (page === 1) total = t
    all.push(...items)
    options?.onProgress?.(all.length, total)
    if (items.length === 0 || all.length >= total) break
    page++
  } while (all.length < total)
  return all
}

/** 分页拉取某类别下全部项目（导出等场景，每页最多 500） */
export async function fetchAllAuxItemsByType(
  type: string,
  options?: { status?: string; onProgress?: (loaded: number, total: number) => void }
) {
  return fetchAllAuxItemsPaged({ type }, options)
}

/** 按辅助类别 ID 分页拉取全部项目 */
export async function fetchAllAuxItemsByCategory(
  categoryId: string,
  options?: { status?: string; onProgress?: (loaded: number, total: number) => void }
) {
  return fetchAllAuxItemsPaged({ category_id: categoryId }, options)
}

export function useAuxItemsPage(defaultPageSize = 50) {
  const pageItems = shallowRef<any[]>([])
  const pagination = reactive({ page: 1, pageSize: defaultPageSize, total: 0 })
  const loading = shallowRef(false)

  async function load(params: Omit<AuxItemsPageParams, 'page' | 'pageSize'>) {
    if (!params.type) {
      pageItems.value = []
      pagination.total = 0
      return
    }
    loading.value = true
    try {
      const { items, total } = await fetchAuxItemsPage({
        ...params,
        page: pagination.page,
        pageSize: pagination.pageSize,
      })
      pageItems.value = items
      pagination.total = total
    } finally {
      loading.value = false
    }
  }

  return { pageItems, pagination, loading, load }
}
