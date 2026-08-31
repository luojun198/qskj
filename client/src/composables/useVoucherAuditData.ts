import { ref, computed } from 'vue'
import type { ComputedRef } from 'vue'
import request from '@/api/request'
import { performanceMonitor } from '@/utils/performanceMonitor'
import { formatAmount } from '@/utils/format'

export function formatMoney(val: number) {
  return '¥' + formatAmount(val || 0)
}

export function getVoucherSeq(voucherNo: string) {
  const idx = voucherNo.indexOf('-')
  const seq = idx >= 0 ? voucherNo.slice(idx + 1) : voucherNo
  return String(parseInt(seq, 10))
}

const typeAbbr: Record<string, string> = {
  记账凭证: '记',
  收款凭证: '收',
  付款凭证: '付',
  转账凭证: '转',
}

export function getTypeAbbr(name: string) {
  return typeAbbr[name] || name.charAt(0) || '凭'
}

export const statusType: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
  draft: 'info',
  audited: 'success',
  posted: 'warning',
}

export const statusText: Record<string, string> = {
  draft: '草稿',
  audited: '已审核',
  posted: '已记账',
}

export function useVoucherAuditData() {
  const list = ref<any[]>([])
  const selected = ref<any[]>([])
  const dateRange = ref<any[]>([])
  const voucherTypes = ref<any[]>([])
  const allowDirectPost = ref(false)
  const requireAudit = ref(true)
  const directPrint = ref(false)
  const sortField = ref<string>('voucher_date')
  const sortOrder = ref<'asc' | 'desc'>('asc')

  // 分页
  const pagination = ref({ page: 1, pageSize: 20, total: 0 })

  // 搜索关键词
  const searchKeyword = ref('')

  // 全选所有页标记
  const selectAllMode = ref(false)

  async function fetchData() {
    return performanceMonitor.measure('voucherAudit fetchData', async () => {
      const params: any = {
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
        sortField: sortField.value,
        sortOrder: sortOrder.value,
      }
      if (dateRange.value?.length) {
        params.start_date = dateRange.value[0]
        params.end_date = dateRange.value[1]
      }
      if (searchKeyword.value.trim()) {
        params.keyword = searchKeyword.value.trim()
      }
      const res = await request.get<any[]>('/voucher/vouchers', { params })
      list.value = res.data
      pagination.value.total = res.total ?? 0
    })
  }

  function onSortChange(field: string, order: string) {
    sortField.value = field
    sortOrder.value = order as 'asc' | 'desc'
    pagination.value.page = 1
    fetchData()
  }

  function onPageChange(page: number) {
    pagination.value.page = page
    fetchData()
  }

  function onPageSizeChange(size: number) {
    pagination.value.pageSize = size
    pagination.value.page = 1
    fetchData()
  }

  function onSearch() {
    pagination.value.page = 1
    fetchData()
  }

  function clearSearch() {
    searchKeyword.value = ''
    pagination.value.page = 1
    fetchData()
  }

  function isVoucherSelected(row: any) {
    const voucherId = row._voucherId || row.id
    return selected.value.some(item => item.id === voucherId)
  }

  function isSelectableRow(row: any) {
    return row._isFirstEntryRow === true
  }

  function getRowClass({ row }: { row: any }) {
    const classes = [row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd']
    if (isVoucherSelected(row)) {
      classes.push('voucher-selected')
    }
    return classes.join(' ')
  }

  function onSelect(rows: any[]) {
    const voucherStatusMap = new Map(list.value.map(v => [v.id, v.status]))
    const map = new Map<string, any>()
    for (const row of rows) {
      const voucherId = row._voucherId || row.id
      if (!map.has(voucherId)) {
        map.set(voucherId, {
          ...row,
          id: voucherId,
          status: voucherStatusMap.get(voucherId) ?? row.status,
        })
      }
    }
    selected.value = Array.from(map.values())

    // 判断是否全选了当前页
    const selectableRows = flatList.value.filter(row => row._isFirstEntryRow === true)
    const isCurrentPageFullSelected = rows.length > 0 && rows.length === selectableRows.length

    // 如果全选了当前页，且有多页数据，则标记为"全选所有"
    if (isCurrentPageFullSelected && pagination.value.total > pagination.value.pageSize) {
      selectAllMode.value = true
    } else if (rows.length === 0) {
      // 取消全选
      selectAllMode.value = false
    }
  }

  const flatList: ComputedRef<any[]> = computed(() => {
    const rows: any[] = []
    for (const [index, v] of list.value.entries()) {
      const seq = getVoucherSeq(v.voucher_no)
      const abbr = getTypeAbbr(v.voucher_type_name || '记')
      const voucherLabel = `${abbr}-${seq}`
      const entries = v.entries?.length ? v.entries : [null]
      const entryCount = entries.length
      for (const [entryIndex, e] of entries.entries()) {
        const auxFields: Record<string, string> = {}
        if (e?.aux_data) {
          try {
            const auxData = typeof e.aux_data === 'string' ? JSON.parse(e.aux_data) : e.aux_data
            for (const [code, val] of Object.entries(auxData)) {
              if (val && typeof val === 'object' && (val as any).name) {
                auxFields[`_aux_${code}`] = (val as any).name
              }
            }
          } catch {
            /* ignore */
          }
        }
        rows.push({
          ...v,
          ...(e || {}),
          ...auxFields,
          voucher_no: voucherLabel,
          summary: e ? e.summary || v.remark || '' : v.remark || '',
          _voucherId: v.id,
          _stripeGroup: index % 2,
          _isFirstEntryRow: entryIndex === 0,
          _voucherRowIndex: entryIndex,
          _voucherEntryCount: entryCount,
        })
      }
    }
    return rows
  })

  async function fetchVoucherTypes() {
    const res = await request.get<any[]>('/base/voucher-types')
    voucherTypes.value = res.data
  }

  async function fetchSystemParams() {
    const res = await request.get<any[]>('/system/params')
    for (const p of res.data || []) {
      if (p.param_key === 'allow_direct_post') allowDirectPost.value = p.param_value === 'true'
      if (p.param_key === 'require_audit') requireAudit.value = p.param_value === 'true'
      if (p.param_key === 'direct_print') directPrint.value = p.param_value === 'true'
    }
  }

  return {
    list,
    selected,
    dateRange,
    voucherTypes,
    allowDirectPost,
    requireAudit,
    directPrint,
    sortField,
    sortOrder,
    pagination,
    flatList,
    searchKeyword,
    selectAllMode,
    clearSearch,
    isVoucherSelected,
    isSelectableRow,
    getRowClass,
    onSelect,
    onSortChange,
    onPageChange,
    onPageSizeChange,
    onSearch,
    fetchData,
    fetchVoucherTypes,
    fetchSystemParams,
  }
}
