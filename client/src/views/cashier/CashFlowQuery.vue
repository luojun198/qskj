<template>
  <div class="page page-flow-query">
    <div class="filter-row" style="padding:12px 16px 0">
      <el-select v-model="filters.account_code" filterable placeholder="选择科目" class="filter-ctl--md" @change="handleSearch">
        <el-option-group v-if="cashAccounts.length" label="现金科目">
          <el-option v-for="a in cashAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
        <el-option-group v-if="bankAccounts.length" label="银行存款科目">
          <el-option v-for="a in bankAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
      </el-select>
      <el-date-picker v-model="filters.start_date" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" class="filter-ctl--md" @change="handleSearch" />
      <span>至</span>
      <el-date-picker v-model="filters.end_date" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" class="filter-ctl--md" @change="handleSearch" />
      <el-select v-model="filters.currency" placeholder="币种" class="filter-ctl--xs" @change="handleSearch">
        <el-option v-for="c in currencies" :key="c" :label="c" :value="c" />
      </el-select>
      <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton @clear="handleClearFilters" />
      <el-button plain :disabled="!journalResult" @click="handleExport"><el-icon><Download /></el-icon>导出</el-button>
      <el-button plain :disabled="!journalResult" @click="handlePrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <!-- 余额摘要 -->
    <div v-if="journalResult" class="balance-summary">
      <span>期初余额：<b>{{ fmt(journalResult.opening) }}</b></span>
      <span>本期收入：<b class="debit">{{ fmt(journalResult.totalDebit) }}</b></span>
      <span>本期支出：<b class="credit">{{ fmt(journalResult.totalCredit) }}</b></span>
      <span>期末余额：<b>{{ fmt(journalResult.closing) }}</b></span>
    </div>

    <!-- 流水表格 -->
    <div ref="tableContainerRef" class="table-container">
      <el-table ref="tableRef" :data="rows" :height="tableHeight" border stripe size="small" class="compact-data-table" :row-class-name="rowClassName" @header-dragend="onDragEnd">
        <el-table-column label="日期" prop="biz_date" :width="cw('biz_date', 100)" />
        <el-table-column label="摘要" prop="summary" :width="cw('summary', 140)" show-overflow-tooltip />
        <el-table-column label="结算方式" prop="settle_type" :width="cw('settle_type', 90)" />
        <el-table-column label="票据号" prop="bill_no" :width="cw('bill_no', 110)" show-overflow-tooltip />
        <el-table-column label="对方单位" prop="counter_unit" :width="cw('counter_unit', 120)" show-overflow-tooltip />
        <el-table-column label="借方(收入)" prop="debit" :width="cw('debit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column label="贷方(支出)" prop="credit" :width="cw('credit', 120)" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
        <el-table-column label="余额" prop="balance" :width="cw('balance', 120)" align="right">
          <template #default="{ row }">{{ fmt(row.balance ?? 0) }}</template>
        </el-table-column>
        <el-table-column label="已对账" :width="cw('reconciled', 70)" align="center">
          <template #default="{ row }">
            <el-icon v-if="row.reconciled" color="#67c23a"><CircleCheck /></el-icon>
          </template>
        </el-table-column>
        <el-table-column label="关联凭证" :width="cw('voucher_no', 110)">
          <template #default="{ row }">
            <span v-if="row.voucher_no">
              {{ row.voucher_year }}-{{ String(row.voucher_month).padStart(2,'0') }} #{{ row.voucher_no }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- FIX-326：日记账接口强制分页；期初 / 合计 / 期末仍是整个区间的口径，逐行余额跨页连续 -->
    <div v-if="journalResult" class="table-footer">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[50, 100, 200, 500]"
        :total="journalResult.total ?? journalResult.rows.length"
        layout="total, sizes, prev, pager, next, jumper"
        small
        @size-change="handleQuery"
        @current-change="handleQuery"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Printer, Download, CircleCheck } from '@element-plus/icons-vue'
import { cashierApi, type JournalResult } from '@/api/cashier'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import { exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useRoute } from 'vue-router'

const route = useRoute()
const { tableRef: colWidthTableRef, colWidth, onDragEnd } = useListColumnWidth('cashier_flow_query')
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const tableRef = colWidthTableRef
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number }[]>([])
const cashAccounts = computed(() => accounts.value.filter(a => a.is_cash))
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))
const journalResult = ref<JournalResult | null>(null)
const page = ref(1)
const pageSize = ref(100)
const rows = computed(() => {
  const raw = journalResult.value?.rows ?? []
  if (raw.length === 0 && !journalResult.value) return []
  // 期初行只在第 1 页显示（后续页的逐行余额已含前页累计）
  if (page.value > 1) return raw
  const opening = journalResult.value?.opening ?? 0
  return [
    {
      id: '__opening__',
      account_code: filters.value.account_code,
      currency: 'RMB', biz_date: '', seq: -1,
      summary: '期初余额', debit: 0, credit: 0,
      settle_type: null, bill_no: null, counter_unit: null, counter_account: null,
      reconciled: 0, voucher_year: null, voucher_month: null, voucher_type: null, voucher_no: null,
      balance: opening,
      _is_opening: true,
    },
    ...raw,
  ]
})

const rowClassName = ({ row }: any) => row._is_opening ? 'opening-row' : ''

const now = new Date()
const currencies = ref<string[]>(['RMB'])
const filters = ref({ account_code: '', currency: 'RMB', start_date: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, end_date: '' })
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并查询全部（保留科目，清空起止日期） */
function handleClearFilters() {
  const currentAccount = filters.value.account_code || accounts.value[0]?.code || ''
  clearFilters()
  filters.value.account_code = currentAccount
  filters.value.currency = 'RMB'
  handleSearch()
}

const fmt = (v: number) => v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

onMounted(async () => {
  const res = await cashierApi.getAccounts()
  const curRes = await cashierApi.getCurrencies().catch(() => null)
  if (curRes && curRes.code === 0 && Array.isArray(curRes.data) && curRes.data.length) {
    currencies.value = curRes.data
    if (!currencies.value.includes(filters.value.currency)) filters.value.currency = currencies.value[0]
  }
  if (res.code === 0) {
    accounts.value = res.data
    
    if (route.query.start_date) filters.value.start_date = route.query.start_date as string
    if (route.query.end_date) filters.value.end_date = route.query.end_date as string
    if (route.query.currency) filters.value.currency = route.query.currency as string

    if (route.query.account_code) {
      filters.value.account_code = route.query.account_code as string
      handleQuery()
    } else if (accounts.value.length) {
      filters.value.account_code = accounts.value[0].code
      handleQuery()
    }
  }
})

/** 筛选条件变化：回到第 1 页 */
function handleSearch() {
  page.value = 1
  handleQuery()
}

async function handleQuery() {
  if (!filters.value.account_code) return
  const res = await cashierApi.getJournal({
    account_code: filters.value.account_code,
    currency: filters.value.currency || undefined,
    start_date: filters.value.start_date || undefined,
    end_date: filters.value.end_date || undefined,
    page: page.value,
    page_size: pageSize.value,
  })
  if (res.code === 0) journalResult.value = res.data
}

function handlePrint() { window.print() }

async function handleExport() {
  const jr = journalResult.value
  if (!jr) return ElMessage.warning('暂无数据可导出')
  const accName = accounts.value.find(a => a.code === filters.value.account_code)
  const acc = accName ? `${accName.code} ${accName.name}` : filters.value.account_code
  const range = [filters.value.start_date, filters.value.end_date].filter(Boolean).join(' 至 ')
  // FIX-326：页面已分页，导出由服务端按整个区间流式生成（期初在副标题，期末在合计行）
  const columns: ExportColumnDef<any>[] = [
    { key: 'biz_date', label: '日期', width: 100 },
    { key: 'summary', label: '摘要', width: 160 },
    { key: 'settle_type', label: '结算方式', width: 90 },
    { key: 'bill_no', label: '票据号', width: 110 },
    { key: 'counter_unit', label: '对方单位', width: 140 },
    { key: 'debit', label: '借方(收入)', width: 120, align: 'right', type: 'amount' },
    { key: 'credit', label: '贷方(支出)', width: 120, align: 'right', type: 'amount' },
    { key: 'balance', label: '余额', width: 120, align: 'right', type: 'amount' },
    { key: 'reconciled', label: '已对账', width: 70, align: 'center' },
    { key: 'voucher', label: '关联凭证', width: 120 },
  ]
  const summaryValues = ['', '', '', '', '', jr.totalDebit, jr.totalCredit, jr.closing, '', '']
  await exportStyledTableViaSource({
    fileName: `出纳流水账_${filters.value.account_code}_${range || '全部'}.xlsx`,
    sheetName: '出纳流水账',
    title: `出纳流水账　${acc}`,
    subtitle: `${range ? `日期：${range}　` : ''}期初：${fmt(jr.opening)}　期末：${fmt(jr.closing)}`,
    columns,
    source: {
      type: 'cashierJournal',
      params: {
        account_code: filters.value.account_code,
        currency: filters.value.currency || undefined,
        start_date: filters.value.start_date || undefined,
        end_date: filters.value.end_date || undefined,
      },
    },
    summaryValues,
  })
}
</script>

<style scoped>
.page-flow-query { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.balance-summary { display: flex; gap: 24px; padding: 6px 16px; background: var(--el-fill-color-lighter); font-size: var(--cw-text-base); }
.balance-summary b { font-weight: 600; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.table-container { flex: 1; overflow: hidden; padding: 0 16px 0; }
.table-footer { padding: 4px 16px; font-size: 12px; color: var(--el-text-color-secondary); border-top: 1px solid var(--el-border-color-lighter); }
:deep(.opening-row) { background: var(--el-fill-color-light); font-style: italic; }
:deep(.opening-row td) { color: var(--el-text-color-secondary); }
</style>
