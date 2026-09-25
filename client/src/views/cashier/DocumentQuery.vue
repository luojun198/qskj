<template>
  <div class="page page-document-query">
    <div class="filter-row" style="padding:0 16px 8px">
      <el-select
        v-model="filters.account_codes"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        filterable
        placeholder="科目（可多选）"
        class="filter-ctl--lg"
      >
        <el-option v-for="a in accounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
      </el-select>
      <el-select v-model="filters.currency" clearable placeholder="币种" class="filter-ctl--xs">
        <el-option v-for="c in currencies" :key="c" :label="c" :value="c" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        class="filter-ctl--lg"
      />
      <el-input v-model="filters.summary" placeholder="摘要" clearable class="filter-ctl--sm" @keyup.enter="handleQuery" />
      <el-input v-model="filters.counter_unit" placeholder="对方单位" clearable class="filter-ctl--sm" @keyup.enter="handleQuery" />
      <el-select v-model="filters.reconciled" clearable placeholder="对账状态" class="filter-ctl--sm">
        <el-option label="已对账" :value="1" />
        <el-option label="未对账" :value="0" />
      </el-select>
      <el-select v-model="filters.has_voucher" clearable placeholder="关联凭证" class="filter-ctl--sm">
        <el-option label="已生成" :value="1" />
        <el-option label="未生成" :value="0" />
      </el-select>
      <el-button type="primary" @click="handleQuery"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton @clear="handleClearFilters" />
      <el-divider direction="vertical" />
      <el-button plain :disabled="!rows.length" @click="handleExport"><el-icon><Download /></el-icon>导出</el-button>
      <el-button plain :disabled="!rows.length" @click="handlePrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <!-- 流水表格 -->
    <div ref="tableContainerRef" class="table-container">
      <el-table ref="tableRef" :data="rows" :height="tableHeight" border stripe size="small" class="compact-data-table" v-loading="loading" @header-dragend="onDragEnd">
        <el-table-column label="科目名称" column-key="account_name" :width="cw('account_name', 140)" show-overflow-tooltip>
          <template #default="{ row }">{{ getAccountName(row.account_code) }}</template>
        </el-table-column>
        <el-table-column label="日期" prop="biz_date" :width="cw('biz_date', 100)" />
        <el-table-column label="摘要" prop="summary" min-width="160" :width="widths.summary" show-overflow-tooltip />
        <el-table-column label="结算方式" prop="settle_type" :width="cw('settle_type', 90)" show-overflow-tooltip>
          <template #default="{ row }">{{ getSettleTypeName(row.settle_type) }}</template>
        </el-table-column>
        <el-table-column label="票据号" prop="bill_no" :width="cw('bill_no', 110)" show-overflow-tooltip />
        <el-table-column label="对方单位" prop="counter_unit" :width="cw('counter_unit', 140)" show-overflow-tooltip />
        <el-table-column label="借方(收入)" prop="debit" :width="cw('debit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column label="贷方(支出)" prop="credit" :width="cw('credit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
        <el-table-column label="已对账" column-key="reconciled" :width="cw('reconciled', 70)" align="center">
          <template #default="{ row }">
            <el-icon v-if="row.reconciled" color="#67c23a"><CircleCheck /></el-icon>
          </template>
        </el-table-column>
        <el-table-column label="关联凭证" column-key="voucher" :width="cw('voucher', 120)" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.voucher_no" style="color:var(--el-color-primary)">
              {{ row.voucher_year }}-{{ String(row.voucher_month).padStart(2,'0') }} #{{ row.voucher_no }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrapper" v-if="total > 0">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[50, 100, 500, 2000]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="handleQuery"
          @current-change="loadData"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// P2-7：默认日期用本地时间（此前 toISOString 取 UTC，东八区 0~8 点会落到前一天）
import { formatDate } from '@/utils/format'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Printer, Download, ArrowUp, ArrowDown, CircleCheck } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'

const { tableRef, containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const { colWidth, onDragEnd, widths, bindTable } = useColumnWidthMemory('cashier_document_query')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }
bindTable(tableRef)

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number }[]>([])
const cashAccounts = computed(() => accounts.value.filter(a => a.is_cash))
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))
  const settleTypes = ref<{ code: string; name: string }[]>([])
  const currencies = ref<string[]>(['RMB'])

function getCurrentMonthRange(): [string, string] {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  return [`${year}-${month}-01`, `${year}-${month}-${date}`]
}

const dateRange = ref<[string, string] | null>(getCurrentMonthRange())
const showAdvanced = ref(false)
const loading = ref(false)
const rows = ref<any[]>([])
const page = ref(1)
const pageSize = ref(100)
const total = ref(0)

const filters = ref({
  account_codes: [] as string[],
  currency: '',
  summary: '',
  settle_types: [] as string[],
  bill_no: '',
  counter_unit: '',
  counter_account: '',
  amount_direction: 'all',
  min_amount: undefined as number | undefined,
  max_amount: undefined as number | undefined,
  reconciled: undefined as number | undefined,
  has_voucher: undefined as number | undefined,
})

const activeFilterCount = computed(() => {
  let count = 0
  if (filters.value.account_codes?.length > 0) count++
  if (filters.value.currency) count++
  if (dateRange.value?.length) count++
  if (filters.value.settle_types?.length > 0) count++
  if (filters.value.bill_no) count++
  if (filters.value.counter_unit) count++
  if (filters.value.counter_account) count++
  if (filters.value.min_amount !== undefined || filters.value.max_amount !== undefined) count++
  if (filters.value.reconciled !== undefined) count++
  if (filters.value.has_voucher !== undefined) count++
  return count
})

const getAccountName = (code: string) => {
  const acc = accounts.value.find(a => a.code === code)
  return acc ? `${code} ${acc.name}` : code
}

const getSettleTypeName = (code: string) => {
  const t = settleTypes.value.find(x => x.code === code)
  return t ? t.name : code
}

const fmt = (v: number) => v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

onMounted(async () => {
  const [accRes, stRes, curRes] = await Promise.all([
    cashierApi.getAccounts(),
    cashierApi.getSettleTypes(),
    cashierApi.getCurrencies().catch(() => null),
  ])
  if (accRes.code === 0) accounts.value = accRes.data
  if (stRes.code === 0) settleTypes.value = stRes.data
  if (curRes && curRes.code === 0 && Array.isArray(curRes.data) && curRes.data.length) currencies.value = curRes.data
  await loadData()
})

function resetFilters() {
  dateRange.value = null
  filters.value = {
    account_codes: [],
    currency: '',
    summary: '',
    settle_types: [],
    bill_no: '',
    counter_unit: '',
    counter_account: '',
    amount_direction: 'all',
    min_amount: undefined,
    max_amount: undefined,
    reconciled: undefined,
    has_voucher: undefined,
  }
}

async function handleClearFilters() {
  resetFilters()
  await handleQuery()
}

async function handleQuery() {
  page.value = 1
  await loadData()
}

async function loadData() {
  loading.value = true
  try {
    const res = await cashierApi.searchJournals({
      ...filters.value,
      account_codes: filters.value.account_codes?.length ? filters.value.account_codes.join(',') : undefined,
      settle_types: filters.value.settle_types?.length ? filters.value.settle_types.join(',') : undefined,
      start_date: dateRange.value?.[0] || undefined,
      end_date: dateRange.value?.[1] || undefined,
      page: page.value,
      page_size: pageSize.value,
    })
    if ((res as any).code === 0) {
      rows.value = (res as any).data.list
      total.value = (res as any).data.total
    }
  } finally {
    loading.value = false
  }
}

function handlePrint() { window.print() }

async function handleExport() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出')
  
  const columns: ExportColumnDef<any>[] = [
    { label: '科目名称', width: 160, value: r => getAccountName(r.account_code) },
    { label: '日期', width: 100, value: r => r.biz_date },
    { label: '摘要', width: 160, value: r => r.summary || '' },
    { label: '结算方式', width: 90, value: r => getSettleTypeName(r.settle_type) || '' },
    { label: '票据号', width: 110, value: r => r.bill_no || '' },
    { label: '对方单位', width: 140, value: r => r.counter_unit || '' },
    { label: '借方(收入)', width: 120, align: 'right', type: 'amount', value: r => r.debit || '' },
    { label: '贷方(支出)', width: 120, align: 'right', type: 'amount', value: r => r.credit || '' },
    { label: '已对账', width: 70, align: 'center', value: r => (r.reconciled ? '是' : '') },
    { label: '关联凭证', width: 120, value: r => (r.voucher_no ? `${r.voucher_year}-${String(r.voucher_month).padStart(2, '0')} ${r.voucher_no}` : '') },
  ]
  
  // 评审 P2：未限定币种时结果可能混有外币，原币直接相加没有意义——多币种时改按本位币金额合计并标明
  const mixed = new Set(rows.value.map(r => (r as any).currency || '')).size > 1
  const pick = (r: any, f: 'debit' | 'credit') =>
    mixed ? Number(r[f === 'debit' ? 'base_debit' : 'base_credit'] ?? r[f]) || 0 : Number(r[f]) || 0
  const totalDebit = rows.value.reduce((sum, r) => sum + pick(r, 'debit'), 0)
  const totalCredit = rows.value.reduce((sum, r) => sum + pick(r, 'credit'), 0)
  const summaryValues = [mixed ? '合计（本位币）' : '合计', '', '', '', '', '', totalDebit, totalCredit, '', '']

  await exportStyledTable({
    fileName: `单据综合查询_${formatDate(new Date())}.xlsx`,
    sheetName: '单据查询',
    title: `出纳单据综合查询`,
    columns,
    rows: rows.value,
    summaryValues,
  })
}
</script>

<style scoped>
.page-document-query { display: flex; flex-direction: column; height: 100%; }

.filter-panel-wrap { width: 100%; margin-bottom: 8px; }
.filter-bar-compact { display: flex; align-items: center; gap: 6px; min-height: 28px; }
.filter-toggle-btn { flex-shrink: 0; padding: 0 4px !important; height: 26px !important; font-size: 12px !important; color: #48484a !important; font-weight: 600; }
.filter-toggle-btn .el-icon { margin-right: 2px; }
.filter-active-badge { margin-left: 4px; }
.filter-active-badge :deep(.el-badge__content) { height: 16px; line-height: 16px; padding: 0 5px; font-size: 11px; }
.filter-keyword-inline { flex: 1; min-width: 140px; max-width: 360px; }
.filter-keyword-inline :deep(.el-input__wrapper) { min-height: 26px !important; }
.filter-bar-actions { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; }
.filter-bar-actions :deep(.el-button) { height: 26px; padding: 0 10px; font-size: 12px; }
.filter-panel-expanded { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(0, 0, 0, 0.06); }
.filter-group-row { display: flex; align-items: flex-start; gap: 6px; padding: 3px 0; }
.filter-group-label { flex-shrink: 0; width: 44px; font-size: 11px; font-weight: 600; color: #6e6e73; line-height: 26px; text-align: right; }
.filter-group-body { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; flex: 1; min-width: 0; }
.filter-control--xs { width: 96px; }
.filter-control--sm { width: 112px; }
.filter-control--md { width: 140px; }
.filter-control--lg { width: 220px; max-width: 100%; }
.separator { margin: 0 4px; }

.toolbar { display: flex; align-items: center; gap: 12px; padding-top: 4px; border-top: 1px dashed var(--el-border-color-lighter); margin-top: 4px; }
.result-count { font-size: 12px; color: var(--el-text-color-secondary); margin-left: auto; }

.table-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 12px 16px; }
.pagination-wrapper { margin-top: 12px; display: flex; justify-content: flex-end; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
</style>
