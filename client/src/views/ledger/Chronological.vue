<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>序时账</h3>
      <div class="filter-row">
        <el-select v-model="filters.year" placeholder="年份" clearable class="filter-ctl--xs" @change="onYearPeriodChange">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filters.period" placeholder="月份" clearable class="filter-ctl--xs" @change="onYearPeriodChange">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-date-picker
          v-model="filters.start_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="开始日期"
          class="filter-ctl--md"
          clearable
          @change="onDateRangeChange"
        />
        <el-date-picker
          v-model="filters.end_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束日期"
          class="filter-ctl--md"
          clearable
          @change="onDateRangeChange"
        />
        <el-checkbox v-model="filters.include_unposted" style="margin-left: 12px" @change="fetchData">统计未记账凭证</el-checkbox>
        <el-button type="primary" @click="fetchData"><el-icon><Search /></el-icon>查询</el-button>
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
        <el-button plain @click="showAdvancedFilter = !showAdvancedFilter">
          {{ showAdvancedFilter ? '收起筛选' : '高级筛选' }}
        </el-button>
      </div>
      <div v-if="showAdvancedFilter" class="filter-row filter-row--advanced">
        <el-input v-model="filters.summary_keyword" placeholder="摘要关键词" clearable class="filter-ctl--md" />
        <el-input v-model="filters.min_amount" placeholder="最小金额" type="number" clearable class="filter-ctl--sm" />
        <el-input v-model="filters.max_amount" placeholder="最大金额" type="number" clearable class="filter-ctl--sm" />
        <el-input v-model="filters.maker_name" placeholder="制单人" clearable class="filter-ctl--sm" />
        <el-input v-model="filters.auditor_name" placeholder="审核人" clearable class="filter-ctl--sm" />
      </div>
    </div>
    <AccountScopeAlert />

    <div ref="tableContainerRef" class="table-summary-scroll table-summary-scroll--wide">
    <el-table
      ref="tableRef"
      v-loading="loading"
      :height="tableHeight"
      :data="list"
      :style="{ width: `${ledgerTableWidth}px` }"
      :fit="false"
      border
      size="small"
      class="compact-data-table"
      highlight-current-row
      :row-class-name="getRowClassName"
      @header-dragend="handleHeaderDragEnd"
      @row-dblclick="handleLedgerRowDblClick"
    >
      <el-table-column prop="voucher_date" label="日期" :width="colWidth('voucher_date', 100)" />
      <el-table-column
        prop="voucher_type_name"
        label="凭证类型"
        :width="colWidth('voucher_type_name', 100)"
      />
      <el-table-column prop="voucher_no" label="凭证号" :width="colWidth('voucher_no', 130)" />
      <el-table-column
        prop="account_code"
        label="科目编码"
        :width="colWidth('account_code', 100)"
      />
      <el-table-column
        prop="account_name"
        label="科目名称"
        :width="colWidth('account_name', 140)"
      />
      <el-table-column prop="summary" label="摘要" :width="colWidth('summary', 180)" />
      <el-table-column column-key="借方金额" label="借方金额" :width="colWidth('借方金额', 140)" align="right">
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_debit) }}
          </template>
          <template v-else>
            {{ row.direction === 'debit' ? formatAmount(row.amount) : '' }}
          </template>
        </template>
      </el-table-column>
      <el-table-column column-key="贷方金额" label="贷方金额" :width="colWidth('贷方金额', 140)" align="right">
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_credit) }}
          </template>
          <template v-else>
            {{ row.direction === 'credit' ? formatAmount(row.amount) : '' }}
          </template>
        </template>
      </el-table-column>
      <el-table-column prop="maker_name" label="制单人" :width="colWidth('maker_name', 80)" />
    </el-table>
    </div>

    <div class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[50, 100, 200, 500]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="fetchData"
        @current-change="fetchData"
      />
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:chronological"
      title="序时账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
    />
  </div>
</template>

<script setup lang="ts">
import { monthEndDate } from '@/utils/monthEnd'
import { ref, computed, onMounted, onActivated } from 'vue'
import { storeToRefs } from 'pinia'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import request from '@/api/request'
import { useUserStore } from '@/stores/user'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import {
  useLedgerVoucherNavigate,
  resolveLedgerVoucherId,
} from '@/composables/useLedgerVoucherNavigate'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { formatAmount } from '@/utils/format'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import { useRacedQuery } from '@/composables/useRacedQuery'

const list = ref<any[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(100)
const showAdvancedFilter = ref(false)
const { accountSetName } = storeToRefs(useUserStore())
const filters = ref<any>({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  start_date: '',
  end_date: '',
  include_unposted: true,
  summary_keyword: '',
  min_amount: '',
  max_amount: '',
  maker_name: '',
  auditor_name: '',
})
const { clearFilters } = useFilterClear([filters], { page: currentPage })

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  fetchData()
}
const years = Array.from({ length: new Date().getFullYear() - 2000 + 1 }, (_, i) => new Date().getFullYear() - i)

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)

const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '序时账',
  getReturnQuery: () => ({
    year: filters.value.year ? String(filters.value.year) : '',
    period: filters.value.period ? String(filters.value.period) : '',
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
  }),
  openVoucherModal: row => {
    // 忽略小计行
    if (row.is_monthly_subtotal) {
      return
    }
    
    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({
      _voucherId: voucherId,
      id: voucherId,
      status: row.voucher_status,
    })
  },
})

const printDateLabel = computed(() => {
  if (filters.value.start_date || filters.value.end_date) {
    const start = filters.value.start_date || '不限'
    const end = filters.value.end_date || '不限'
    return `日期：${start} 至 ${end}`
  }
  if (!filters.value.year && !filters.value.period) {
    return '日期：当前期间'
  }
  return `日期：${filters.value.year}年 ${filters.value.period}月`
})

// hiprint 套打
const hiprintVisible = ref(false)
function buildPrintHtml(): string {
  return buildTablePrintHtml<any>({
    title: '序时账',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`,
    rows: list.value,
    rowStyle: (r: any) => (r.is_monthly_subtotal ? 'font-weight:600;background:#f7f7f7;' : ''),
    columns: [
      { label: '日期', align: 'center', render: r => (r.is_monthly_subtotal ? '' : r.voucher_date || '') },
      { label: '凭证类型', align: 'center', render: r => r.voucher_type_name || '' },
      { label: '凭证号', align: 'center', render: r => r.voucher_no || '' },
      { label: '科目编码', align: 'left', render: r => r.account_code || '' },
      { label: '科目名称', align: 'left', render: r => r.account_name || '' },
      { label: '摘要', align: 'left', render: r => r.summary || (r.is_monthly_subtotal ? '本月合计' : '') },
      { label: '借方金额', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_debit) : r.direction === 'debit' ? formatAmount(r.amount) : '') },
      { label: '贷方金额', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_credit) : r.direction === 'credit' ? formatAmount(r.amount) : '') },
      { label: '制单人', align: 'center', render: r => r.maker_name || '' },
    ],
  })
}

function printPage() {
  // 经 HiprintDialog 预览打印：仅输出表头 + 表格，不含页面导航、筛选栏等无关内容
  if (list.value.length === 0) return
  hiprintVisible.value = true
}

const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 100 },
  { key: 'voucher_type_name', fallback: 100 },
  { key: 'voucher_no', fallback: 130 },
  { key: 'account_code', fallback: 100 },
  { key: 'account_name', fallback: 140 },
  { key: 'summary', fallback: 180 },
  { key: '借方金额', fallback: 140 },
  { key: '贷方金额', fallback: 140 },
  { key: 'maker_name', fallback: 80 },
])

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_chronological', ledgerColumnDefs)
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()

function isDateFilterActive() {
  return Boolean(filters.value.start_date || filters.value.end_date)
}

function onYearPeriodChange() {
  if (filters.value.year || filters.value.period) {
    filters.value.start_date = ''
    filters.value.end_date = ''
  }
}

function onDateRangeChange() {
  if (isDateFilterActive()) {
    filters.value.year = null
    filters.value.period = null
  }
}

function insertMonthlySubtotals(entries: any[]): any[] {
  if (entries.length === 0) return entries
  
  const result: any[] = []
  let currentMonth = ''
  let monthlyDebit = 0
  let monthlyCredit = 0
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const entryMonth = entry.voucher_date.substring(0, 7)
    
    if (currentMonth && entryMonth !== currentMonth) {
      result.push({
        id: `__monthly_subtotal_${currentMonth}__`,
        voucher_date: monthEndDate(currentMonth),
        voucher_type_name: '',
        voucher_no: '',
        account_code: '',
        account_name: '',
        summary: '本月合计',
        amount: 0,
        maker_name: '',
        is_monthly_subtotal: true,
        monthly_debit: monthlyDebit,
        monthly_credit: monthlyCredit,
      })
      
      monthlyDebit = 0
      monthlyCredit = 0
    }
    
    if (entry.direction === 'debit') {
      monthlyDebit += entry.amount
    } else if (entry.direction === 'credit') {
      monthlyCredit += entry.amount
    }
    
    currentMonth = entryMonth
    result.push(entry)
  }
  
  if (currentMonth && entries.length > 0) {
    result.push({
      id: `__monthly_subtotal_${currentMonth}__`,
      voucher_date: monthEndDate(currentMonth),
      voucher_type_name: '',
      voucher_no: '',
      account_code: '',
      account_name: '',
      summary: '本月合计',
      amount: 0,
      maker_name: '',
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })
  }
  
  return result
}

function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  return ''
}

function buildQueryParams(page: number, size: number) {
  const params: any = {
    page,
    pageSize: size,
  }
  if (!isDateFilterActive()) {
    if (filters.value.year) params.year = filters.value.year
    if (filters.value.period) params.period = filters.value.period
  }
  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.include_unposted) params.include_unposted = 'true'
  if (filters.value.summary_keyword) params.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) params.min_amount = filters.value.min_amount
  if (filters.value.max_amount) params.max_amount = filters.value.max_amount
  if (filters.value.maker_name) params.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) params.auditor_name = filters.value.auditor_name
  return params
}

// FIX-157：请求序号防竞态（改页大小时 size-change + current-change 连发两个请求）
const raced = useRacedQuery()
const loading = raced.loading

async function fetchData() {
  const params = buildQueryParams(currentPage.value, pageSize.value)
  const res = await raced.run(() => request.get<any>('/ledger/chronological', { params }))
  if (!res) return
  const entries = res.data || []
  const entriesWithSubtotals = insertMonthlySubtotals(entries)
  list.value = entriesWithSubtotals
  total.value = res.total || 0
  await afterTableLayout()
}

async function exportData() {
  // FIX-254：参数模式导出——只提交筛选参数与列定义，服务端一次查询 + 月合计 + 流式生成 xlsx。
  // 旧链路（FIX-158 分页循环拉全量再在浏览器生成）十万级要 45s 且 JS 堆 3GB。
  const dateRange = isDateFilterActive()
    ? `${filters.value.start_date || '不限'}_${filters.value.end_date || '不限'}`
    : `${filters.value.year || new Date().getFullYear()}_${filters.value.period || new Date().getMonth() + 1}`

  // 列 key 与 server/src/services/exportSources.ts 的 chronological 数据源一一对应
  const columns: ExportColumnDef[] = [
    { key: 'voucher_date', label: '日期', width: colWidth('voucher_date', 100) },
    { key: 'voucher_type_name', label: '凭证类型', width: colWidth('voucher_type_name', 100) },
    { key: 'voucher_no', label: '凭证号', width: colWidth('voucher_no', 130) },
    { key: 'account_code', label: '科目编码', width: colWidth('account_code', 100) },
    { key: 'account_name', label: '科目名称', width: colWidth('account_name', 140) },
    { key: 'summary', label: '摘要', width: colWidth('summary', 180) },
    { key: 'debit', label: '借方金额', width: colWidth('借方金额', 140), align: 'right', type: 'amount' },
    { key: 'credit', label: '贷方金额', width: colWidth('贷方金额', 140), align: 'right', type: 'amount' },
    { key: 'maker_name', label: '制单人', width: colWidth('maker_name', 80) },
  ]

  const { page: _page, pageSize: _pageSize, ...params } = buildQueryParams(1, 1)
  await exportStyledTableViaSource({
    fileName: `序时账_${dateRange}.xlsx`,
    sheetName: '序时账',
    title: '序时账',
    subtitle: printDateLabel.value,
    columns,
    source: { type: 'chronological', params },
  })
}

onMounted(async () => {
  await fetchData()
})

onActivated(() => {
  void tryRestoreVoucherModal()
})
</script>

<style scoped>
:deep(.monthly-subtotal-row) {
  background-color: #e0f2fe !important;
  font-weight: 600;
}

.page {
  padding: var(--page-pad);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--block-gap);
}

.page-header h2 {
  margin: 0;
}
.filter-row--advanced {
  margin-top: 8px;
}
.pagination {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
}
</style>
