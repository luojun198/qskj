<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>明细账</h3>
      <div class="filter-row">
        <DrillDownReturnButton />
        <el-select
          v-model="filters.account_id"
          filterable
          placeholder="选择科目"
          style="width: 260px"
          :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
          clearable
        >
          <el-option v-for="a in accounts" :key="a.id" :label="`${a.code} ${a.name}`" :value="a.id" />
        </el-select>
        <el-date-picker
          v-model="filters.start_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="开始日期"
          style="width: 150px"
        />
        <el-date-picker
          v-model="filters.end_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束日期"
          style="width: 150px"
        />
        <el-button type="primary" @click="handleQuery"><el-icon><Search /></el-icon>查询</el-button>
        <el-divider direction="vertical" />
        <el-button plain @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
      </div>
      <div v-if="showAdvancedFilter" class="filter-row" style="margin-top: 8px">
        <el-input v-model="filters.summary_keyword" placeholder="摘要关键词" clearable style="width: 160px" />
        <el-input v-model="filters.min_amount" placeholder="最小金额" type="number" clearable style="width: 120px" />
        <el-input v-model="filters.max_amount" placeholder="最大金额" type="number" clearable style="width: 120px" />
        <el-input v-model="filters.maker_name" placeholder="制单人" clearable style="width: 120px" />
        <el-input v-model="filters.auditor_name" placeholder="审核人" clearable style="width: 120px" />
      </div>
    </div>
    <AccountScopeAlert :accounts-count="accounts.length" />

    <div v-if="selectedAccount" class="account-info">
      <span class="label">科目:</span>
      <span class="value">{{ selectedAccount.code }} {{ selectedAccount.name }}</span>
    </div>


    <EmptyState
      v-if="isScopeBlocked && accountsLoaded"
      type="account"
      :description="scopeEmptyDescription"
    />

    <div v-else-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>

    <div v-else v-loading="loading" ref="tableContainerRef" class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow">
    <el-table
      ref="tableRef"
      :height="tableHeight"
      :data="list"
      :style="{ width: `${ledgerTableWidth}px` }"
      :fit="false"
      border
      size="small"
      class="compact-data-table"
      highlight-current-row
      show-summary
      :summary-method="getSummaries"
      :row-class-name="getRowClassName"
      @header-dragend="handleHeaderDragEnd"
      @row-dblclick="handleLedgerRowDblClick"
    >
      <el-table-column column-key="voucher_date" label="日期" :width="colWidth('voucher_date', 100)">
        <template #default="{ row }">
          {{ row.is_monthly_subtotal || row.is_yearly_subtotal ? '' : row.voucher_date }}
        </template>
      </el-table-column>
      <el-table-column column-key="voucher_no" prop="voucher_no" label="凭证号" :width="colWidth('voucher_no', 130)">
        <template #default="{ row }">{{ formatVoucherNo(row) }}</template>
      </el-table-column>
      <el-table-column column-key="summary" prop="summary" label="摘要" :width="colWidth('summary', 180)" />
      <el-table-column column-key="opposite_accounts" prop="opposite_accounts" label="对方科目" :width="colWidth('opposite_accounts', 200)" />
      <el-table-column column-key="借方" label="借方" :width="colWidth('借方', 140)" align="right">
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_debit) }}
          </template>
          <template v-else-if="row.is_yearly_subtotal">
            {{ formatAmount(row.yearly_debit) }}
          </template>
          <template v-else>
            {{ row.direction === 'debit' ? formatAmount(row.amount) : '' }}
          </template>
        </template>
      </el-table-column>
      <el-table-column column-key="贷方" label="贷方" :width="colWidth('贷方', 140)" align="right">
        <template #default="{ row }">
          <template v-if="row.is_monthly_subtotal">
            {{ formatAmount(row.monthly_credit) }}
          </template>
          <template v-else-if="row.is_yearly_subtotal">
            {{ formatAmount(row.yearly_credit) }}
          </template>
          <template v-else>
            {{ row.direction === 'credit' ? formatAmount(row.amount) : '' }}
          </template>
        </template>
      </el-table-column>
      <el-table-column column-key="方向" label="方向" :width="colWidth('方向', 60)" align="center">
        <template #default="{ row }">
          {{
            row.running_balance === 0
              ? '平'
              : row.running_balance > 0
                ? selectedAccount?.direction === 'debit'
                  ? '借'
                  : '贷'
                : selectedAccount?.direction === 'debit'
                  ? '贷'
                  : '借'
          }}
        </template>
      </el-table-column>
      <el-table-column column-key="余额" label="余额" :width="colWidth('余额', 140)" align="right">
        <template #default="{ row }">{{ formatAmount(Math.abs(row.running_balance)) }}</template>
      </el-table-column>
      <template #empty>
        <EmptyState type="data" description="暂无数据，请选择科目和期间后查询" />
      </template>
    </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100, 200, 500]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <VoucherEntryDialogHost ref="entryDialogHostRef" @saved="fetchData" />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:detail"
      title="明细账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onActivated, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import request from '@/api/request'
import { useUserStore } from '@/stores/user'
import type { TableColumnCtx } from 'element-plus'
import DrillDownReturnButton from '@/components/common/DrillDownReturnButton.vue'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useAccountScopeHint } from '@/composables/useAccountScopeHint'
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
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { formatSignedBalanceAmount } from '@/utils/exportLedgerHelpers'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'

const route = useRoute()
const { accountSetName } = storeToRefs(useUserStore())
const initBalance = ref(0)
const list = ref<any[]>([])
const loading = ref(false)
const initialLoaded = ref(false)
const accounts = ref<any[]>([])
const accountsLoaded = ref(false)
const showAdvancedFilter = ref(false)

const accountsCount = computed(() => accounts.value.length)
const { isBlocked: isScopeBlocked, emptyDescription: scopeEmptyDescription } = useAccountScopeHint({
  accountsCount,
})

const ledgerColumnDefs = computed(() => [
  { key: 'voucher_date', fallback: 100 },
  { key: 'voucher_no', fallback: 130 },
  { key: 'summary', fallback: 180 },
  { key: 'opposite_accounts', fallback: 200 },
  { key: '借方', fallback: 140 },
  { key: '贷方', fallback: 140 },
  { key: '方向', fallback: 60 },
  { key: '余额', fallback: 140 },
])

const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_detail', ledgerColumnDefs, { afterLayout: relayoutAfterData })

const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(50)

const selectedAccount = computed(() => {
  if (!filters.value.account_id) return null
  return accounts.value.find(a => a.id === filters.value.account_id)
})

const printDateLabel = computed(() => {
  const s = filters.value.start_date || ''
  const e = filters.value.end_date || ''
  if (s && e) return `日期：${s} 至 ${e}`
  return ''
})

function printPage() {
  // 经 HiprintDialog 预览打印：仅输出表头 + 表格，不含页面导航、筛选栏等无关内容
  if (loading.value || list.value.length === 0) return
  hiprintVisible.value = true
}

// 凭证类型简称映射
const typeAbbr: Record<string, string> = {
  记账凭证: '记',
  收款凭证: '收',
  付款凭证: '付',
  转账凭证: '转',
}

// 提取凭证号中的序号部分
function getVoucherSeq(voucherNo: string) {
  const idx = voucherNo.indexOf('-')
  const seq = idx >= 0 ? voucherNo.slice(idx + 1) : voucherNo
  return String(parseInt(seq, 10))
}

// 凭证类型简称
function getTypeAbbr(name: string) {
  return typeAbbr[name] || name.charAt(0) || '凭'
}

// 格式化凭证号显示
function formatVoucherNo(row: any) {
  if (!row.voucher_no || !row.voucher_type_name) return row.voucher_no || ''
  const seq = getVoucherSeq(row.voucher_no)
  const abbr = getTypeAbbr(row.voucher_type_name)
  return `${abbr}-${seq}`
}

// hiprint 套打
const hiprintVisible = ref(false)

function directionLabel(row: any): string {
  if (row.is_monthly_subtotal || row.is_yearly_subtotal) return ''
  if (row.running_balance === 0) return '平'
  const dir = selectedAccount.value?.direction === 'debit'
  return row.running_balance > 0 ? (dir ? '借' : '贷') : (dir ? '贷' : '借')
}

function buildPrintHtml(): string {
  const title = selectedAccount.value
    ? `明细账 —— ${selectedAccount.value.code} ${selectedAccount.value.name}`
    : '明细账'
  return buildTablePrintHtml<any>({
    title,
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`,
    rows: list.value,
    rowStyle: (r: any) =>
      r.is_monthly_subtotal || r.is_yearly_subtotal ? 'font-weight:600;background:#f7f7f7;' : '',
    columns: [
      { label: '日期', align: 'center', render: r => (r.is_monthly_subtotal || r.is_yearly_subtotal ? '' : r.voucher_date || '') },
      { label: '凭证号', align: 'center', render: r => formatVoucherNo(r) },
      { label: '摘要', align: 'left', render: r => r.summary || (r.is_monthly_subtotal ? '本月合计' : r.is_yearly_subtotal ? '本年累计' : '') },
      { label: '对方科目', align: 'left', render: r => r.opposite_accounts || '' },
      { label: '借方', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_debit) : r.is_yearly_subtotal ? formatAmount(r.yearly_debit) : r.direction === 'debit' ? formatAmount(r.amount) : '') },
      { label: '贷方', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_credit) : r.is_yearly_subtotal ? formatAmount(r.yearly_credit) : r.direction === 'credit' ? formatAmount(r.amount) : '') },
      { label: '方向', align: 'center', render: directionLabel },
      { label: '余额', align: 'right', render: r => formatAmount(Math.abs(r.running_balance)) },
    ],
  })
}

function getLedgerYear() {
  const date = filters.value.start_date || filters.value.end_date
  if (date) {
    const year = new Date(date).getFullYear()
    if (Number.isFinite(year)) return year
  }
  return new Date().getFullYear()
}

function isYearStartDate(date: string) {
  return /^\d{4}-01-01$/.test(date)
}

function getPreviousDate(date: string) {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - 1)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getOpeningBalanceLabel() {
  return '期初余额'
}

function buildCarryForwardRow(balance: number) {
  const startDate = filters.value.start_date || `${getLedgerYear()}-01-01`
  const balanceDate = isYearStartDate(startDate) ? startDate : getPreviousDate(startDate)
  return {
    id: '__carry_forward__',
    voucher_date: balanceDate || startDate,
    voucher_no: '',
    voucher_type_name: '',
    summary: getOpeningBalanceLabel(),
    opposite_accounts: '',
    direction: '',
    amount: 0,
    running_balance: balance,
    is_carry_forward: true,
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
    
    if (entryYear !== currentYear) {
      currentYear = entryYear
      yearlyDebit = 0
      yearlyCredit = 0
    }
    
    if (currentMonth && entryMonth !== currentMonth) {
      result.push({
        id: `__monthly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31',
        voucher_no: '',
        voucher_type_name: '',
        summary: '本月合计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_monthly_subtotal: true,
        monthly_debit: monthlyDebit,
        monthly_credit: monthlyCredit,
      })
      
      result.push({
        id: `__yearly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31',
        voucher_no: '',
        voucher_type_name: '',
        summary: '本年累计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_yearly_subtotal: true,
        yearly_debit: yearlyDebit,
        yearly_credit: yearlyCredit,
      })
      
      monthlyDebit = 0
      monthlyCredit = 0
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
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      voucher_type_name: '',
      summary: '本月合计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })
    
    result.push({
      id: `__yearly_subtotal_${currentMonth}__`,
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      voucher_type_name: '',
      summary: '本年累计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_yearly_subtotal: true,
      yearly_debit: yearlyDebit,
      yearly_credit: yearlyCredit,
    })
  }
  
  return result
}

const filters = ref<any>({
  account_id: '',
  start_date: '',
  end_date: '',
  summary_keyword: '',
  min_amount: '',
  max_amount: '',
  maker_name: '',
  auditor_name: '',
  include_unposted: true,
})

const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const { tryRestoreVoucherModal } = useVoucherModalRestore(entryDialogHostRef)

const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '明细账',
  getReturnQuery: () => ({
    account_id: filters.value.account_id || '',
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
  }),
  openVoucherModal: row => {
    // 忽略小计行和期初余额行
    if (row.is_monthly_subtotal || row.is_yearly_subtotal || row.is_carry_forward) {
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

/** 首次 onMounted 赋值科目后再允许 watch 触发查询，避免重复请求 */
const accountQueryReady = ref(false)

watch(
  () => filters.value.account_id,
  (newVal, oldVal) => {
    if (!accountQueryReady.value || !newVal || newVal === oldVal) return
    currentPage.value = 1
    fetchData()
  }
)

function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  if (row.is_yearly_subtotal) return 'yearly-subtotal-row'
  if (row.is_carry_forward) return 'carry-forward-row'
  return ''
}

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns, data } = param
  const sums: string[] = []

  // 过滤掉小计行和期初余额行
  const normalEntries = data.filter(
    row => !row.is_monthly_subtotal && !row.is_yearly_subtotal && !row.is_carry_forward
  )

  columns.forEach((_column, index) => {
    if (index === 0) {
      sums[index] = '合计'
      return
    }
    if (index === 1 || index === 2 || index === 3) {
      sums[index] = ''
      return
    }

    // 借方
    if (index === 4) {
      const total = normalEntries.reduce((sum, row) => sum + (row.direction === 'debit' ? row.amount : 0), 0)
      sums[index] = formatAmount(total)
    }
    // 贷方
    else if (index === 5) {
      const total = normalEntries.reduce(
        (sum, row) => sum + (row.direction === 'credit' ? row.amount : 0),
        0
      )
      sums[index] = formatAmount(total)
    }
    // 方向
    else if (index === 6) {
      const lastRow = normalEntries[normalEntries.length - 1]
      if (lastRow) {
        const balance = lastRow.running_balance
        sums[index] =
          balance === 0
            ? '平'
            : balance > 0
              ? selectedAccount.value?.direction === 'debit'
                ? '借'
                : '贷'
              : selectedAccount.value?.direction === 'debit'
                ? '贷'
                : '借'
      }
    }
    // 余额
    else if (index === 7) {
      const lastRow = normalEntries[normalEntries.length - 1]
      if (lastRow) {
        sums[index] = formatAmount(Math.abs(lastRow.running_balance))
      }
    }
  })

  return sums
}

async function fetchData() {
  if (isScopeBlocked.value) {
    list.value = []
    initialLoaded.value = true
    return
  }
  if (!filters.value.account_id) {
    list.value = []
    return
  }

  const account = selectedAccount.value
  if (!account) {
    list.value = []
    return
  }

  loading.value = true
  try {

  const params: any = {}

  // 判断是否有子科目：检查是否有其他科目的编码以当前科目编码开头且长度更长
  const hasChildren = accounts.value.some(
    (a: any) =>
      a.id !== account.id && a.code.startsWith(account.code) && a.code.length > account.code.length
  )
  if (hasChildren) {
    // 如果有子科目，使用科目编码范围查询
    params.account_code_start = account.code
    params.account_code_end = account.code + '9999'
  } else {
    params.account_id = filters.value.account_id
  }

  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.summary_keyword) params.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) params.min_amount = filters.value.min_amount
  if (filters.value.max_amount) params.max_amount = filters.value.max_amount
  if (filters.value.maker_name) params.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) params.auditor_name = filters.value.auditor_name
  if (filters.value.include_unposted) params.include_unposted = 'true'
  params.year = getLedgerYear()

  // 添加分页参数
  params.page = currentPage.value
  params.pageSize = pageSize.value

  const res = await request.get<any>('/ledger/detail', { params })
  initBalance.value = (res as any).initBalance || 0
  total.value = (res as any).total || 0
  const entries = res.data || []

  // 计算余额 - 根据科目方向
  let balance = initBalance.value
  for (const entry of entries) {
    if (account?.direction === 'debit') {
      // 借方科目: 借方增加，贷方减少
      if (entry.direction === 'debit') {
        balance += entry.amount
      } else {
        balance -= entry.amount
      }
    } else {
      // 贷方科目: 贷方增加，借方减少
      if (entry.direction === 'credit') {
        balance += entry.amount
      } else {
        balance -= entry.amount
      }
    }
    entry.running_balance = balance
  }
  
  const entriesWithSubtotals = insertMonthlySubtotals(entries, account)
  list.value = currentPage.value === 1 ? [buildCarryForwardRow(initBalance.value), ...entriesWithSubtotals] : entriesWithSubtotals
  initialLoaded.value = true
  await afterTableLayout()

  } finally {
    loading.value = false
  }
}

// 分页事件处理
function handleQuery() {
  currentPage.value = 1  // 查询时重置到第一页
  fetchData()
}

function handleSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1  // 切换每页数量时重置到第一页
  fetchData()
}

function handlePageChange(page: number) {
  currentPage.value = page
  fetchData()
}

async function fetchAccounts() {
  const res = await request.get<any[]>('/base/accounts', { params: { is_enabled: 1, all: 1 } })
  accounts.value = res.data || []
  accountsLoaded.value = true
}

async function exportData() {
  if (!filters.value.account_id) {
    return
  }

  // 获取选中的科目信息
  const account = selectedAccount.value
  if (!account) {
    return
  }

  // 导出全部数据
  const params: any = {
    page: 1,
    pageSize: 10000,
  }

  // 判断是否有子科目
  const hasChildren = accounts.value.some(
    (a: any) =>
      a.id !== account.id && a.code.startsWith(account.code) && a.code.length > account.code.length
  )

  if (hasChildren) {
    params.account_code_start = account.code
    params.account_code_end = account.code + '9999'
  } else {
    params.account_id = filters.value.account_id
  }

  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.summary_keyword) params.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) params.min_amount = filters.value.min_amount
  if (filters.value.max_amount) params.max_amount = filters.value.max_amount
  if (filters.value.maker_name) params.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) params.auditor_name = filters.value.auditor_name
  if (filters.value.include_unposted) params.include_unposted = 'true'
  params.year = getLedgerYear()

  const res = await request.get<any>('/ledger/detail', { params })
  const exportInitBalance = (res as any).initBalance || 0
  const entries = res.data || []

  // 计算余额
  let balance = exportInitBalance
  for (const entry of entries) {
    if (account?.direction === 'debit') {
      if (entry.direction === 'debit') {
        balance += entry.amount
      } else {
        balance -= entry.amount
      }
    } else {
      if (entry.direction === 'credit') {
        balance += entry.amount
      } else {
        balance -= entry.amount
      }
    }
    entry.running_balance = balance
  }
  
  // 插入小计行
  const entriesWithSubtotals = insertMonthlySubtotals(entries, account)
  const exportRows = [buildCarryForwardRow(exportInitBalance), ...entriesWithSubtotals]
  const accountName = account ? `${account.code}_${account.name}` : '明细账'
  const dateRange =
    filters.value.start_date && filters.value.end_date
      ? `${filters.value.start_date}_${filters.value.end_date}`
      : new Date().toISOString().split('T')[0]

  const subtitleParts = [
    account ? `${account.code} ${account.name}` : '',
    printDateLabel.value,
  ].filter(Boolean)

  const columns: ExportColumnDef[] = [
    {
      label: '日期',
      width: colWidth('voucher_date', 100),
      value: row => row.voucher_date,
    },
    {
      label: '凭证号',
      width: colWidth('voucher_no', 130),
      value: row => row.voucher_no,
    },
    {
      label: '摘要',
      width: colWidth('summary', 180),
      value: row => row.summary,
    },
    {
      label: '对方科目',
      width: colWidth('opposite_accounts', 200),
      value: row => row.opposite_accounts || '',
    },
    {
      label: '借方',
      width: colWidth('借方', 140),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_debit
        if (row.is_yearly_subtotal) return row.yearly_debit
        return row.direction === 'debit' && !row.is_carry_forward ? row.amount : ''
      },
    },
    {
      label: '贷方',
      width: colWidth('贷方', 140),
      align: 'right',
      type: 'amount',
      value: row => {
        if (row.is_monthly_subtotal) return row.monthly_credit
        if (row.is_yearly_subtotal) return row.yearly_credit
        return row.direction === 'credit' && !row.is_carry_forward ? row.amount : ''
      },
    },
    {
      label: '方向',
      width: colWidth('方向', 60),
      align: 'center',
      value: row => {
        if (row.running_balance === 0) return '平'
        if (row.running_balance > 0) {
          return account?.direction === 'debit' ? '借' : '贷'
        }
        return account?.direction === 'debit' ? '贷' : '借'
      },
    },
    {
      label: '余额',
      width: colWidth('余额', 140),
      align: 'right',
      type: 'amount',
      value: row => formatSignedBalanceAmount(row.running_balance, false),
    },
  ]

  await exportStyledTable({
    fileName: `${accountName}_${dateRange}.xlsx`,
    sheetName: '明细账',
    title: '明细账',
    subtitle: subtitleParts.join('  '),
    columns,
    rows: exportRows,
  })
}

/** 从路由 query 同步筛选并查询（keep-alive 下 query 变化不会触发 onMounted） */
async function syncFromRouteQuery() {
  const hasRouteAccount = route.query.account_id || route.query.account_code
  const hasRouteDates = route.query.start_date || route.query.end_date

  if (route.query.account_id) {
    filters.value.account_id = route.query.account_id as string
  } else if (route.query.account_code) {
    if (accounts.value.length === 0) await fetchAccounts()
    const code = route.query.account_code as string
    const account = accounts.value.find((a: any) => a.code === code)
    filters.value.account_id = account?.id || ''
  } else if (!hasRouteAccount && !accountQueryReady.value) {
    const defaultAccount = accounts.value.find((a: any) => a.code === '1001')
    if (defaultAccount) filters.value.account_id = defaultAccount.id
  }

  if (route.query.start_date) {
    filters.value.start_date = route.query.start_date as string
  }
  if (route.query.end_date) {
    filters.value.end_date = route.query.end_date as string
  }

  if (!filters.value.start_date || !filters.value.end_date) {
    const currentYear = new Date().getFullYear()
    filters.value.start_date = filters.value.start_date || `${currentYear}-01-01`
    filters.value.end_date = filters.value.end_date || `${currentYear}-12-31`
  }

  if (hasRouteAccount || hasRouteDates) {
    currentPage.value = 1
  }

  if (filters.value.account_id) {
    await fetchData()
  }
}

watch(
  () => route.fullPath,
  async (newPath, oldPath) => {
    if (!newPath.startsWith('/ledger/detail')) return
    if (!oldPath || oldPath === newPath) return
    if (!accountQueryReady.value) return
    await syncFromRouteQuery()
  }
)

onMounted(async () => {
  await fetchAccounts()
  await syncFromRouteQuery()
  accountQueryReady.value = true
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
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0 0 12px 0;
}
.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.account-info {
  padding: 8px 12px;
  background: #f5f7fa;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  margin-bottom: 12px;
  font-weight: 500;
}
.account-info .label {
  color: #606266;
  margin-right: 8px;
}
.account-info .value {
  color: #409eff;
  font-size: 16px;
}

.skeleton-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}
.skeleton-row {
  height: 36px;
  border-radius: 4px;
}
</style>
