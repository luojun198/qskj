<template>
  <div class="page page-document-query">
    <CashierReportFilter
      ref="filterRef"
      v-model="filter"
      mode="detail"
      allow-all-currencies
      :loading="loading"
      @query="handleQuery"
      @clear="handleClear"
    />

    <div class="toolbar-row">
      <el-button plain :disabled="!rows.length" @click="handleExport"><el-icon><Download /></el-icon>导出全部</el-button>
      <el-button plain :disabled="!rows.length" @click="handlePrint"><el-icon><Printer /></el-icon>打印</el-button>
      <span class="tip">共 {{ total }} 条；合计按全部筛选结果计算，不受分页影响</span>
    </div>

    <!-- 流水表格 -->
    <div ref="tableContainerRef" class="table-container">
      <el-table
        ref="tableRef"
        :data="rows"
        :height="tableHeight"
        border stripe size="small" class="compact-data-table"
        v-loading="loading"
        show-summary
        :summary-method="summarize"
        @header-dragend="onDragEnd"
      >
        <el-table-column label="科目名称" prop="account_name" :width="cw('account_name', 150)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="科目名称" kind="options" :options="accountOptions"
              :model-value="filter.accountCodes" @update:model-value="(v: any) => setFilter({ accountCodes: v })" @change="handleQuery" />
          </template>
          <template #default="{ row }">{{ row.account_code }} {{ row.account_name }}</template>
        </el-table-column>
        <el-table-column v-if="showCurrency" label="币种" prop="currency" :width="cw('currency', 60)" align="center" />
        <el-table-column label="日期" prop="biz_date" :width="cw('biz_date', 100)" />
        <el-table-column label="摘要" prop="summary" min-width="160" :width="widths.summary" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="摘要" kind="text"
              :model-value="filter.summary" @update:model-value="(v: any) => setFilter({ summary: v })" @change="handleQuery" />
          </template>
        </el-table-column>
        <el-table-column label="结算方式" prop="settle_type" :width="cw('settle_type', 90)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="结算方式" kind="options" :options="settleOptions"
              :model-value="filter.settleTypes" @update:model-value="(v: any) => setFilter({ settleTypes: v })" @change="handleQuery" />
          </template>
          <template #default="{ row }">{{ row.settle_type_name || row.settle_type || '' }}</template>
        </el-table-column>
        <el-table-column label="票据号" prop="bill_no" :width="cw('bill_no', 110)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="票据号" kind="text"
              :model-value="filter.billNo" @update:model-value="(v: any) => setFilter({ billNo: v })" @change="handleQuery" />
          </template>
        </el-table-column>
        <el-table-column label="对方单位" prop="counter_unit" :width="cw('counter_unit', 140)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="对方单位" kind="text"
              :model-value="filter.counterUnit" @update:model-value="(v: any) => setFilter({ counterUnit: v })" @change="handleQuery" />
          </template>
        </el-table-column>
        <el-table-column label="对方科目" prop="counter_account" :width="cw('counter_account', 150)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="对方科目" kind="options" :options="counterOptions"
              :model-value="filter.counterAccounts" @update:model-value="(v: any) => setFilter({ counterAccounts: v })" @change="handleQuery" />
          </template>
          <template #default="{ row }">{{ row.counter_account ? `${row.counter_account} ${row.counter_account_name || ''}` : '' }}</template>
        </el-table-column>
        <!-- 辅助项目按类别动态拆列（部门一列、人员一列…）；列取自当前筛选结果里出现过的类别 -->
        <el-table-column
          v-for="col in auxColumns"
          :key="`aux_${col.id}`"
          :label="col.name"
          :column-key="`aux_${col.id}`"
          :width="cw(`aux_${col.id}`, 110)"
          show-overflow-tooltip
        >
          <template #header>
            <CashierHeaderFilter :label="col.name" kind="remote" :loader="(kw: string) => loadAuxItemOptions(col.id, kw)"
              :model-value="auxItemIdsOf(filter, col.id)" @update:model-value="(v: any) => setFilter(withAuxItemIds(filter, col.id, v))" @change="handleQuery" />
          </template>
          <template #default="{ row }">{{ row.aux_values?.[col.id] || '' }}</template>
        </el-table-column>
        <el-table-column label="借方(收入)" prop="debit" :width="cw('debit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column label="贷方(支出)" prop="credit" :width="cw('credit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
        <el-table-column v-if="showCurrency" label="借方(本位币)" prop="base_debit" :width="cw('base_debit', 120)" align="right">
          <template #default="{ row }">{{ row.base_debit ? fmt(row.base_debit) : '' }}</template>
        </el-table-column>
        <el-table-column v-if="showCurrency" label="贷方(本位币)" prop="base_credit" :width="cw('base_credit', 120)" align="right">
          <template #default="{ row }">{{ row.base_credit ? fmt(row.base_credit) : '' }}</template>
        </el-table-column>
        <el-table-column label="已对账" prop="reconciled" :width="cw('reconciled', 80)" align="center">
          <template #header>
            <CashierHeaderFilter label="已对账" kind="options" :multiple="false" :options="reconcileOptions"
              :model-value="filter.reconciled" @update:model-value="(v: any) => setFilter({ reconciled: v === undefined || v === '' ? undefined : Number(v) as 0 | 1 })" @change="handleQuery" />
          </template>
          <template #default="{ row }"><el-icon v-if="row.reconciled" color="#67c23a"><CircleCheck /></el-icon></template>
        </el-table-column>
        <el-table-column label="关联凭证" prop="voucher" :width="cw('voucher', 150)" show-overflow-tooltip>
          <template #header>
            <CashierHeaderFilter label="关联凭证" kind="options" :options="voucherOptions"
              :model-value="filter.voucherStatus" @update:model-value="(v: any) => setFilter({ voucherStatus: v })" @change="handleQuery" />
          </template>
          <template #default="{ row }">
            <template v-if="row.voucher_no">
              <span style="color:var(--el-color-primary)">{{ row.voucher_year }}-{{ String(row.voucher_month).padStart(2,'0') }} #{{ row.voucher_no }}</span>
              <el-tag v-if="row.voucher_status" size="small" :type="statusTag(row.voucher_status)" class="vs-tag">{{ statusLabel(row.voucher_status) }}</el-tag>
            </template>
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

    <HiprintDialog
      v-model="printVisible"
      template-type="ledger"
      template-key="cashier:document-query"
      title="出纳单据综合查询"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { CircleCheck, Download, Printer } from '@element-plus/icons-vue'
import { cashierApi, type AuxColumn, type CashierSearchRow } from '@/api/cashier'
import CashierReportFilter from '@/components/cashier/CashierReportFilter.vue'
import CashierHeaderFilter from '@/components/cashier/CashierHeaderFilter.vue'
import { loadAuxItemOptions } from '@/composables/useCashierHeaderFilters'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { formatDate } from '@/utils/format'
import {
  ALL_CURRENCIES,
  defaultCashierFilter,
  describeFilter,
  filterFromRouteQuery,
  toReportPayload,
  toSearchParams,
  auxItemIdsOf,
  withAuxItemIds,
  VOUCHER_STATUS_OPTIONS,
  type CashierReportFilterState,
} from '@/utils/cashierReportFilter'

const { tableRef, containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const { colWidth, onDragEnd, widths, bindTable } = useColumnWidthMemory('cashier_document_query')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }
bindTable(tableRef)

const router = useRouter()
const filterRef = ref<InstanceType<typeof CashierReportFilter>>()
// 从汇总表 / 余额表钻取进来时，路由 query.f 带着完整筛选条件
const filter = ref<CashierReportFilterState>(filterFromRouteQuery(router.currentRoute.value.query) || defaultCashierFilter())

const loading = ref(false)
const rows = ref<CashierSearchRow[]>([])
const page = ref(1)
const pageSize = ref(100)
const total = ref(0)
const totals = ref({ income: 0, expense: 0, count: 0 })
const mode = ref<'single' | 'all'>('single')
const printVisible = ref(false)
const printRows = ref<CashierSearchRow[]>([])
const auxColumns = ref<AuxColumn[]>([])

const showCurrency = computed(() => mode.value === 'all')

// ── 表头筛选：与上方筛选条共用同一份 filter，服务端筛选全部结果 ──
function setFilter(part: Partial<CashierReportFilterState>) {
  filter.value = { ...filter.value, ...part }
}
const accountOptions = computed(() => (filterRef.value?.accounts || []).map(a => ({ value: a.code, label: `${a.code} ${a.name}` })))
const settleOptions = computed(() => {
  const dict = filterRef.value?.settleTypes || []
  const known = new Set(dict.map(t => t.code))
  const extra = (filterRef.value?.meta.settle_types || []).filter(t => t.code && !known.has(t.code))
  return [...dict, ...extra].map(t => ({ value: t.code, label: t.name }))
})
const counterOptions = computed(() => (filterRef.value?.meta.counter_accounts || []).map(a => ({ value: a.code, label: `${a.code} ${a.name}` })))
const reconcileOptions = [{ value: 1, label: '已对账' }, { value: 0, label: '未对账' }]
const voucherOptions = VOUCHER_STATUS_OPTIONS.map(o => ({ value: o.value as string, label: o.label }))
const fmt = (v: number) => (v === 0 ? '0.00' : (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

const STATUS_LABEL: Record<string, string> = { draft: '草稿', audited: '已审核', posted: '已记账' }
const statusLabel = (s: string) => STATUS_LABEL[s] || s
const statusTag = (s: string) => (s === 'posted' ? 'success' : s === 'audited' ? 'warning' : 'info')

/** 不选币种 = 本位币（后端口径，与其它出纳报表一致）；要看全部请选「全部（折本位币）」 */
function effectiveFilter(): CashierReportFilterState {
  return filter.value
}

async function loadData() {
  loading.value = true
  try {
    const res = await cashierApi.searchJournals({ ...toSearchParams(effectiveFilter()), page: page.value, page_size: pageSize.value })
    if (res.code === 0) {
      rows.value = res.data.list
      total.value = res.data.total
      totals.value = res.data.totals
      mode.value = res.data.currency_mode
      auxColumns.value = res.data.aux_columns || []
    }
  } finally { loading.value = false }
}

async function handleQuery() { page.value = 1; await loadData() }
async function handleClear() { filter.value = defaultCashierFilter(); await handleQuery() }

function summarize({ columns }: any) {
  return columns.map((col: any, i: number) => {
    if (i === 0) return `合计（${totals.value.count} 笔）`
    if (col.property === 'debit') return fmt(mode.value === 'all' ? 0 : totals.value.income)
    if (col.property === 'credit') return fmt(mode.value === 'all' ? 0 : totals.value.expense)
    if (col.property === 'base_debit') return fmt(totals.value.income)
    if (col.property === 'base_credit') return fmt(totals.value.expense)
    return ''
  })
}

const accountNames = computed(() => Object.fromEntries((filterRef.value?.accounts || []).map(a => [a.code, `${a.code} ${a.name}`])))
const currencyLabel = computed(() => (filter.value.currency === ALL_CURRENCIES ? '全部（折本位币）' : filter.value.currency || filterRef.value?.baseCurrency || 'RMB'))
const subtitle = computed(() => describeFilter(filter.value, { accounts: accountNames.value, currencyLabel: currencyLabel.value }))

async function handlePrint() {
  // 打印最多取前 2000 条（一页的服务端上限）；超出时提示
  loading.value = true
  try {
    const res = await cashierApi.searchJournals({ ...toSearchParams(effectiveFilter()), page: 1, page_size: 2000 })
    if (res.code !== 0) return
    printRows.value = res.data.list
    if (res.data.total > 2000) ElMessage.warning(`共 ${res.data.total} 条，打印仅包含前 2000 条，请缩小筛选范围`)
    printVisible.value = true
  } finally { loading.value = false }
}

function buildPrintHtml() {
  const all = mode.value === 'all'
  const columns: any[] = [
    { label: '科目', render: (r: CashierSearchRow) => `${r.account_code} ${r.account_name || ''}` },
    ...(all ? [{ label: '币种', align: 'center', render: (r: CashierSearchRow) => r.currency }] : []),
    { label: '日期', render: (r: CashierSearchRow) => r.biz_date },
    { label: '摘要', render: (r: CashierSearchRow) => r.summary || '' },
    { label: '结算方式', render: (r: CashierSearchRow) => r.settle_type_name || r.settle_type || '' },
    { label: '对方科目', render: (r: CashierSearchRow) => (r.counter_account ? `${r.counter_account} ${r.counter_account_name || ''}` : '') },
    ...auxColumns.value.map(c => ({ label: c.name, render: (r: CashierSearchRow) => r.aux_values?.[c.id] || '' })),
    { label: '借方(收入)', align: 'right', render: (r: CashierSearchRow) => (r.debit ? fmt(r.debit) : '') },
    { label: '贷方(支出)', align: 'right', render: (r: CashierSearchRow) => (r.credit ? fmt(r.credit) : '') },
    ...(all ? [
      { label: '借方(本位币)', align: 'right', render: (r: CashierSearchRow) => (r.base_debit ? fmt(r.base_debit) : '') },
      { label: '贷方(本位币)', align: 'right', render: (r: CashierSearchRow) => (r.base_credit ? fmt(r.base_credit) : '') },
    ] : []),
    { label: '凭证', render: (r: CashierSearchRow) => (r.voucher_no ? `${r.voucher_year}-${String(r.voucher_month).padStart(2, '0')} #${r.voucher_no}` : '') },
  ]
  const footer = columns.map((c, i) => {
    if (i === 0) return `合计（${totals.value.count} 笔）`
    if (c.label === (all ? '借方(本位币)' : '借方(收入)')) return fmt(totals.value.income)
    if (c.label === (all ? '贷方(本位币)' : '贷方(支出)')) return fmt(totals.value.expense)
    return ''
  })
  return buildTablePrintHtml<CashierSearchRow>({
    title: '出纳单据综合查询',
    subtitle: `${subtitle.value}　单位：${all ? '本位币折算' : currencyLabel.value}`,
    rows: printRows.value,
    columns,
    monochrome: true,
    fitToPage: true,
    footer,
  })
}

async function handleExport() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出')
  const all = mode.value === 'all'
  const columns: ExportColumnDef<any>[] = [
    { key: 'account_code', label: '科目编码', width: 100 },
    { key: 'account_name', label: '科目名称', width: 150 },
    ...(all ? [{ key: 'currency', label: '币种', width: 60, align: 'center' }] as ExportColumnDef<any>[] : []),
    { key: 'biz_date', label: '日期', width: 100 },
    { key: 'summary', label: '摘要', width: 180 },
    { key: 'settle_type', label: '结算方式', width: 90 },
    { key: 'bill_no', label: '票据号', width: 110 },
    { key: 'counter_unit', label: '对方单位', width: 140 },
    { key: 'counter_account', label: '对方科目', width: 160 },
    ...auxColumns.value.map(c => ({ key: `aux:${c.id}`, label: c.name, width: 120 })) as ExportColumnDef<any>[],
    { key: 'debit', label: '借方(收入)', width: 120, align: 'right', type: 'amount' },
    { key: 'credit', label: '贷方(支出)', width: 120, align: 'right', type: 'amount' },
    ...(all ? [
      { key: 'base_debit', label: '借方(本位币)', width: 120, align: 'right', type: 'amount' },
      { key: 'base_credit', label: '贷方(本位币)', width: 120, align: 'right', type: 'amount' },
    ] as ExportColumnDef<any>[] : []),
    { key: 'reconciled', label: '已对账', width: 70, align: 'center' },
    { key: 'voucher', label: '关联凭证', width: 120 },
    { key: 'voucher_status', label: '凭证状态', width: 80 },
  ]
  // 汇总行：金额列放全量合计
  const summaryValues = columns.map((c, i) => {
    if (i === 0) return `合计（${totals.value.count} 笔）`
    if (c.key === (all ? 'base_debit' : 'debit')) return totals.value.income
    if (c.key === (all ? 'base_credit' : 'credit')) return totals.value.expense
    return ''
  })
  await exportStyledTableViaSource({
    fileName: `单据综合查询_${formatDate(new Date())}.xlsx`,
    sheetName: '单据查询',
    title: '出纳单据综合查询',
    subtitle: `${subtitle.value}　共 ${total.value} 条`,
    columns,
    source: { type: 'cashierSearch', params: toReportPayload(effectiveFilter()) },
    summaryValues,
  })
}

onMounted(async () => {
  // 等筛选组件拿到本位币后再查询（组件 onMounted 已发起请求，这里只需下一拍）
  await Promise.resolve()
  await loadData()
})
</script>

<style scoped>
.page-document-query { display: flex; flex-direction: column; height: 100%; }
.toolbar-row { display: flex; align-items: center; gap: 12px; padding: 0; }
.tip { font-size: 12px; color: var(--el-text-color-placeholder); }
.table-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: var(--block-gap) 0 0; }
.pagination-wrapper { margin-top: 12px; display: flex; justify-content: flex-end; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.vs-tag { margin-left: 6px; }
</style>
