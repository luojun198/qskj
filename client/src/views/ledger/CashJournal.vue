<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>日记账</h3>
      <div class="quick-filter-btns">
        <el-button type="primary" plain @click="quickFilterCash">现金日记账</el-button>
        <el-button type="success" plain @click="quickFilterBank">银行日记账</el-button>
      </div>
      <div class="filter-row">
        <el-select
          v-model="filters.account_id"
          filterable
          placeholder="选择具体科目"
          class="filter-ctl--lg"
          :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
          clearable
          @visible-change="onAccountSelectOpen"
        >
          <el-option v-for="a in cashBankAccounts" :key="a.id" :label="`${a.code} ${a.name}`" :value="a.id">
            <span class="account-select-option__row" :style="{ paddingLeft: `${a.level * 16}px` }">
              {{ a.code }} {{ a.name }}
            </span>
          </el-option>
        </el-select>
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
        <el-select v-model="filters.direction" placeholder="收支类型" clearable class="filter-ctl--sm">
          <el-option label="收入(借方)" value="debit" />
          <el-option label="支出(贷方)" value="credit" />
        </el-select>
        <el-checkbox v-model="filters.include_unposted" style="margin-left: 12px" @change="fetchData">统计未记账凭证</el-checkbox>
        <el-button type="primary" @click="fetchData"><el-icon><Search /></el-icon>查询</el-button>
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
      </div>
    </div>
    <AccountScopeAlert :accounts-count="cashBankAccounts.length" />

    <div v-if="queried" ref="tableContainerRef" class="table-summary-scroll table-summary-scroll--wide">
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
      <el-table-column prop="summary" label="摘要" :width="colWidth('summary', 160)" />
      <el-table-column
        prop="opposite_accounts"
        label="对方科目"
        :width="colWidth('opposite_accounts', 180)"
      />
      <el-table-column
        column-key="借方金额"
        label="借方金额"
        :width="colWidth('借方金额', 140)"
        align="right"
      >
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_debit) }}
          </template>
          <template v-else-if="row.is_yearly_subtotal">
            {{ formatAmount(row.yearly_debit) }}
          </template>
          <template v-else>
            {{
              !row.is_opening_balance && row.direction === 'debit'
                ? formatAmount(row.amount)
                : ''
            }}
          </template>
        </template>
      </el-table-column>
      <el-table-column
        column-key="贷方金额"
        label="贷方金额"
        :width="colWidth('贷方金额', 140)"
        align="right"
      >
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_credit) }}
          </template>
          <template v-else-if="row.is_yearly_subtotal">
            {{ formatAmount(row.yearly_credit) }}
          </template>
          <template v-else>
            {{
              !row.is_opening_balance && row.direction === 'credit'
                ? formatAmount(row.amount)
                : ''
            }}
          </template>
        </template>
      </el-table-column>
      <el-table-column column-key="余额" label="余额" :width="colWidth('余额', 140)" align="right">
        <template #default="{ row }">{{ formatAmount(row.running_balance) }}</template>
      </el-table-column>
      <el-table-column prop="maker_name" label="制单人" :width="colWidth('maker_name', 80)" />
      <el-table-column prop="auditor_name" label="审核人" :width="colWidth('auditor_name', 80)" />
      <template #empty>
        <EmptyState type="data" description="当前条件下暂无流水" />
      </template>
    </el-table>
    </div>

    <div v-else-if="isScopeBlocked" class="journal-empty-wrap">
      <EmptyState type="account" :description="scopeEmptyDescription" />
    </div>
    <div v-else class="journal-empty-wrap">
      <EmptyState
        type="data"
        description="请选择具体科目，或点击「现金日记账」「银行日记账」后再查询"
      />
    </div>

    <div v-if="queried" class="pagination">
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
      template-key="ledger:cash-journal"
      title="日记账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
    />
  </div>
</template>

<script setup lang="ts">
import { monthEndDate } from '@/utils/monthEnd'
import { ref, computed, nextTick, onMounted, onActivated, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import request from '@/api/request'
import EmptyState from '@/components/EmptyState.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import { useAccountScopeHint } from '@/composables/useAccountScopeHint'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import {
  useLedgerVoucherNavigate,
  resolveLedgerVoucherId,
} from '@/composables/useLedgerVoucherNavigate'
import { useVoucherModalRestore } from '@/composables/useVoucherModalRestore'
import { showWarning } from '@/composables/useMessage'
import { formatAmount } from '@/utils/format'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { useUserStore } from '@/stores/user'
import { useRacedQuery } from '@/composables/useRacedQuery'
import { fetchAllPages } from '@/utils/ledgerFetchAll'

const route = useRoute()
const { accountSetName } = storeToRefs(useUserStore())
const list = ref<any[]>([])
const total = ref(0)
const queried = ref(false)
const currentPage = ref(1)
const pageSize = ref(100)
const cashBankAccounts = ref<any[]>([])
const cashBankAccountsCount = computed(() => cashBankAccounts.value.length)
const { isBlocked: isScopeBlocked, emptyDescription: scopeEmptyDescription } = useAccountScopeHint({
  accountsCount: cashBankAccountsCount,
})
const filters = ref<any>({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  start_date: '',
  end_date: '',
  account_type: '',
  account_id: '',
  direction: '',
  account_code_start: '',
  account_code_end: '',
  include_unposted: true,
})
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  fetchData()
}

const years = Array.from({ length: new Date().getFullYear() - 2000 + 1 }, (_, i) => new Date().getFullYear() - i)

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)

const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '日记账',
  getReturnQuery: () => ({
    account_id: filters.value.account_id || '',
    year: filters.value.year ? String(filters.value.year) : '',
    period: filters.value.period ? String(filters.value.period) : '',
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
    account_type: filters.value.account_type || '',
  }),
  openVoucherModal: row => {
    // 忽略小计行和期初余额行
    if (row.is_monthly_subtotal || row.is_yearly_subtotal || row.is_opening_balance) {
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

/** 已选择具体科目，或现金/银行快捷范围 */
const hasAccountScope = computed(
  () => Boolean(filters.value.account_id || filters.value.account_type)
)

const printDateLabel = computed(() => {
  if (!queried.value) return '请先选择科目后查询'
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
const printData = ref<any[]>([])

async function printPage() {
  // 经 HiprintDialog 预览打印：仅输出表头 + 表格，不含页面导航、筛选栏等无关内容。
  // 与导出一致，重新请求全部数据（含期初行、月小计/年累计），避免只打印当前分页。
  if (!hasAccountScope.value) {
    showWarning('请先选择科目后再打印')
    return
  }
  // FIX-158：分页循环拉全量，不再 1 万条截断
  const all = await fetchAllPages<any, any>((page, size) =>
    request.get<any>('/ledger/cash-journal', { params: buildQueryParams(page, size) })
  )
  const entriesWithSubtotals = insertMonthlySubtotals(all.rows, null)
  printData.value = [buildOpeningBalanceRow(all.first?.initBalance || 0), ...entriesWithSubtotals]
  hiprintVisible.value = true
}

/** 构造日记账打印 HTML（与导出列、小计/期初口径一致） */
function buildPrintHtml(): string {
  return buildTablePrintHtml<any>({
    title: '日记账',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`,
    rows: printData.value,
    monochrome: true,
    fitToPage: true,
    rowStyle: (r: any) =>
      r.is_monthly_subtotal || r.is_yearly_subtotal ? 'font-weight:600;' : '',
    columns: [
      { label: '日期', align: 'center', render: r => (r.is_monthly_subtotal || r.is_yearly_subtotal ? '' : r.voucher_date || '') },
      { label: '凭证号', align: 'center', render: r => r.voucher_no || '' },
      { label: '科目编码', align: 'left', render: r => r.account_code || '' },
      { label: '科目名称', align: 'left', render: r => r.account_name || '' },
      { label: '摘要', align: 'left', render: r => r.summary || (r.is_monthly_subtotal ? '本月合计' : r.is_yearly_subtotal ? '本年累计' : r.is_opening_balance ? '期初余额' : '') },
      { label: '对方科目', align: 'left', render: r => r.opposite_accounts || '' },
      {
        label: '借方金额',
        align: 'right',
        render: r => {
          if (r.is_monthly_subtotal) return formatAmount(r.monthly_debit)
          if (r.is_yearly_subtotal) return formatAmount(r.yearly_debit)
          return !r.is_opening_balance && r.direction === 'debit' ? formatAmount(r.amount) : ''
        },
      },
      {
        label: '贷方金额',
        align: 'right',
        render: r => {
          if (r.is_monthly_subtotal) return formatAmount(r.monthly_credit)
          if (r.is_yearly_subtotal) return formatAmount(r.yearly_credit)
          return !r.is_opening_balance && r.direction === 'credit' ? formatAmount(r.amount) : ''
        },
      },
      { label: '余额', align: 'right', render: r => formatAmount(r.running_balance) },
      { label: '制单人', align: 'center', render: r => r.maker_name || '' },
      { label: '审核人', align: 'center', render: r => r.auditor_name || '' },
    ],
  })
}

const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 100 },
  { key: 'voucher_no', fallback: 130 },
  { key: 'account_code', fallback: 100 },
  { key: 'account_name', fallback: 140 },
  { key: 'summary', fallback: 160 },
  { key: 'opposite_accounts', fallback: 180 },
  { key: '借方金额', fallback: 140 },
  { key: '贷方金额', fallback: 140 },
  { key: '余额', fallback: 140 },
  { key: 'maker_name', fallback: 80 },
  { key: 'auditor_name', fallback: 80 },
])

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_cash_journal', ledgerColumnDefs)
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
  if (filters.value.account_type) params.account_type = filters.value.account_type
  if (filters.value.account_id) params.account_id = filters.value.account_id
  if (filters.value.direction) params.direction = filters.value.direction
  if (filters.value.account_code_start) params.account_code_start = filters.value.account_code_start
  if (filters.value.account_code_end) params.account_code_end = filters.value.account_code_end
  if (filters.value.include_unposted) params.include_unposted = 'true'
  return params
}

function getOpeningBalanceDate() {
  if (filters.value.start_date) {
    const d = new Date(`${filters.value.start_date}T00:00:00`)
    if (!Number.isNaN(d.getTime()) && !/^\d{4}-01-01$/.test(filters.value.start_date)) {
      d.setDate(d.getDate() - 1)
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    return filters.value.start_date
  }

  const year = filters.value.year || new Date().getFullYear()
  const period = filters.value.period || new Date().getMonth() + 1
  return `${year}-${String(period).padStart(2, '0')}-01`
}

function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  if (row.is_yearly_subtotal) return 'yearly-subtotal-row'
  if (row.is_opening_balance) return 'carry-forward-row'
  return ''
}

function buildOpeningBalanceRow(balance: number) {
  return {
    id: '__opening_balance__',
    voucher_date: getOpeningBalanceDate(),
    voucher_no: '',
    account_code: '',
    account_name: '',
    summary: '期初余额',
    opposite_accounts: '',
    direction: '',
    amount: 0,
    running_balance: balance,
    maker_name: '',
    auditor_name: '',
    is_opening_balance: true,
  }
}

function insertMonthlySubtotals(entries: any[], account: any): any[] {
  if (entries.length === 0) return entries
  
  const result: any[] = []
  let currentMonth = ''
  let monthlyDebit = 0
  let monthlyCredit = 0
  let yearlyDebit = 0
  let yearlyCredit = 0
  let currentYear = ''
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const entryMonth = entry.voucher_date.substring(0, 7)
    const entryYear = entry.voucher_date.substring(0, 4)
    
    // 跨年重置累计延后到小计推送之后，避免上一年 12 月“本年累计”被清零
    const yearChanged = entryYear !== currentYear

    if (currentMonth && entryMonth !== currentMonth) {
      result.push({
        id: `__monthly_subtotal_${currentMonth}__`,
        voucher_date: monthEndDate(currentMonth),
        voucher_no: '',
        account_code: '',
        account_name: '',
        summary: '本月合计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        maker_name: '',
        auditor_name: '',
        is_monthly_subtotal: true,
        monthly_debit: monthlyDebit,
        monthly_credit: monthlyCredit,
      })
      
      result.push({
        id: `__yearly_subtotal_${currentMonth}__`,
        voucher_date: monthEndDate(currentMonth),
        voucher_no: '',
        account_code: '',
        account_name: '',
        summary: '本年累计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        maker_name: '',
        auditor_name: '',
        is_yearly_subtotal: true,
        yearly_debit: yearlyDebit,
        yearly_credit: yearlyCredit,
      })
      
      monthlyDebit = 0
      monthlyCredit = 0
    }

    if (yearChanged) {
      currentYear = entryYear
      yearlyDebit = 0
      yearlyCredit = 0
    }
    
    if (entry.direction === 'debit') {
      monthlyDebit += entry.amount
      yearlyDebit += entry.amount
    } else if (entry.direction === 'credit') {
      monthlyCredit += entry.amount
      yearlyCredit += entry.amount
    }
    
    currentMonth = entryMonth
    result.push(entry)
  }
  
  if (currentMonth && entries.length > 0) {
    result.push({
      id: `__monthly_subtotal_${currentMonth}__`,
      voucher_date: monthEndDate(currentMonth),
      voucher_no: '',
      account_code: '',
      account_name: '',
      summary: '本月合计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      maker_name: '',
      auditor_name: '',
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })
    
    result.push({
      id: `__yearly_subtotal_${currentMonth}__`,
      voucher_date: monthEndDate(currentMonth),
      voucher_no: '',
      account_code: '',
      account_name: '',
      summary: '本年累计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      maker_name: '',
      auditor_name: '',
      is_yearly_subtotal: true,
      yearly_debit: yearlyDebit,
      yearly_credit: yearlyCredit,
    })
  }
  
  return result
}

// FIX-157：请求序号防竞态
const raced = useRacedQuery()
const loading = raced.loading

async function fetchData() {
  if (isScopeBlocked.value) {
    queried.value = false
    list.value = []
    total.value = 0
    return
  }
  if (!hasAccountScope.value) {
    queried.value = false
    list.value = []
    total.value = 0
    showWarning('请先选择具体科目，或点击「现金日记账」「银行日记账」')
    return
  }
  const params = buildQueryParams(currentPage.value, pageSize.value)
  const res = await raced.run(() => request.get<any>('/ledger/cash-journal', { params }))
  if (!res) return
  queried.value = true
  const entries = res.data || []
  const entriesWithSubtotals = insertMonthlySubtotals(entries, null)
  const openingRow = buildOpeningBalanceRow((res as any).initBalance || 0)
  list.value = currentPage.value === 1 ? [openingRow, ...entriesWithSubtotals] : entriesWithSubtotals
  total.value = res.total || 0
  await afterTableLayout()
}

async function fetchCashBankAccounts() {
  const res = await request.get<any[]>('/base/accounts', {
    params: { is_enabled: 1, all: 1 },
  })
  // 筛选现金和银行科目（包括父科目和明细科目），并按编码排序
  const filtered = res.data.filter((a: any) => {
    // 如果是现金或银行科目本身
    if (a.is_cash || a.is_bank) return true
    // 如果是现金或银行科目的子科目（编码以1001或1002开头）
    if (a.code.startsWith('1001') || a.code.startsWith('1002')) return true
    return false
  })
  // 按编码排序
  filtered.sort((a: any, b: any) => a.code.localeCompare(b.code))
  cashBankAccounts.value = filtered
}

// 下拉框打开时刷新科目列表
function onAccountSelectOpen(visible: boolean) {
  if (visible) {
    fetchCashBankAccounts()
  }
}

/** 默认/快捷：现金日记账（1001 及其子科目；无 1001 时按 is_cash 范围） */
// FIX-156：程序设值时跳过 account_type watcher，否则 watcher 会把刚设好的 account_id 清空
let suppressTypeWatch = false
async function applyQuickScope(code: '1001' | '1002', fallbackType: 'cash' | 'bank') {
  suppressTypeWatch = true
  try {
    filters.value.account_type = ''
    const account = cashBankAccounts.value.find(a => a.code === code)
    if (account) {
      filters.value.account_id = account.id
    } else {
      filters.value.account_id = ''
      filters.value.account_type = fallbackType
    }
    await nextTick()
  } finally {
    suppressTypeWatch = false
  }
  currentPage.value = 1
  await fetchData()
}

async function applyCashScope() {
  await applyQuickScope('1001', 'cash')
}

async function quickFilterCash() {
  await fetchCashBankAccounts()
  await applyCashScope()
}

// 快捷筛选：银行日记账 (1002及其所有子科目)
// FIX-156：先拉科目列表再 find（原实现顺序相反，首次点击列表为空找不到 1002）
async function quickFilterBank() {
  await fetchCashBankAccounts()
  await applyQuickScope('1002', 'bank')
}

async function exportData() {
  if (!hasAccountScope.value) {
    showWarning('请先选择科目后再导出')
    return
  }
  // 导出全部数据
  const all = await fetchAllPages<any, any>((page, size) =>
    request.get<any>('/ledger/cash-journal', { params: buildQueryParams(page, size) })
  )
  const entriesWithSubtotals = insertMonthlySubtotals(all.rows, null)
  const allData = [buildOpeningBalanceRow(all.first?.initBalance || 0), ...entriesWithSubtotals]
  const dateRange = isDateFilterActive()
    ? `${filters.value.start_date || '不限'}_${filters.value.end_date || '不限'}`
    : `${filters.value.year || new Date().getFullYear()}_${filters.value.period || new Date().getMonth() + 1}`

  const columns: ExportColumnDef[] = [
    { label: '日期', width: colWidth('voucher_date', 100), value: row => row.voucher_date },
    { label: '凭证号', width: colWidth('voucher_no', 130), value: row => row.voucher_no },
    { label: '科目编码', width: colWidth('account_code', 100), value: row => row.account_code || '' },
    { label: '科目名称', width: colWidth('account_name', 140), value: row => row.account_name || '' },
    { label: '摘要', width: colWidth('summary', 160), value: row => row.summary },
    {
      label: '对方科目',
      width: colWidth('opposite_accounts', 180),
      value: row => row.opposite_accounts || '',
    },
    {
      label: '借方金额',
      width: colWidth('借方金额', 140),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_debit
        if (row.is_yearly_subtotal) return row.yearly_debit
        return !row.is_opening_balance && row.direction === 'debit' ? row.amount : ''
      },
    },
    {
      label: '贷方金额',
      width: colWidth('贷方金额', 140),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_credit
        if (row.is_yearly_subtotal) return row.yearly_credit
        return !row.is_opening_balance && row.direction === 'credit' ? row.amount : ''
      },
    },
    {
      label: '余额',
      width: colWidth('余额', 140),
      align: 'right',
      type: 'amount',
      value: row => row.running_balance,
    },
    { label: '制单人', width: colWidth('maker_name', 80), value: row => row.maker_name || '' },
    { label: '审核人', width: colWidth('auditor_name', 80), value: row => row.auditor_name || '' },
  ]

  await exportStyledTable({
    fileName: `日记账_${dateRange}.xlsx`,
    sheetName: '日记账',
    title: '日记账',
    subtitle: printDateLabel.value,
    columns,
    rows: allData,
  })
}

// 当账户类型改变时,清空具体科目选择
watch(
  () => filters.value.account_type,
  () => {
    if (suppressTypeWatch) return
    filters.value.account_id = ''
    // 刷新科目列表
    fetchCashBankAccounts()
  }
)

/** 已应用的 ?scope 查询串（cash / bank），页签复用时据此判断是否需要切换范围 */
let appliedScope = ''

onMounted(async () => {
  appliedScope = String(route.query.scope || '')
  await fetchCashBankAccounts()
  if (route.query.account_id) {
    filters.value.account_id = String(route.query.account_id)
    if (route.query.start_date) filters.value.start_date = String(route.query.start_date)
    if (route.query.end_date) filters.value.end_date = String(route.query.end_date)
    currentPage.value = 1
    await fetchData()
  } else if (route.query.scope === 'bank') {
    // 财务总账工作页面「银行日记账」入口
    await quickFilterBank()
  } else {
    await applyCashScope()
  }
})

/** 页签被复用时（已打开现金日记账，再从工作页面点银行日记账），按新查询串切换范围 */
onActivated(() => {
  const scope = String(route.query.scope || '')
  if (scope !== appliedScope) {
    appliedScope = scope
    if (scope === 'bank') void quickFilterBank()
    else if (scope === 'cash') void quickFilterCash()
  }
  void tryRestoreVoucherModal()
})
</script>

<style scoped>
:deep(.monthly-subtotal-row) {
  background-color: #e0f2fe !important;
  font-weight: 600;
}

:deep(.yearly-subtotal-row) {
  background-color: #fef9c3 !important;
  font-weight: 600;
}

:deep(.carry-forward-row) {
  background-color: #f3f4f6 !important;
  font-weight: 500;
}

.page {
  padding: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-header h2 {
  margin: 0;
}
.quick-filter-btns {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
}

.pagination {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
}

.journal-empty-wrap {
  min-height: calc(100vh - 220px);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
