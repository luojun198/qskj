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
        <el-button plain @click="openBatchDialog('print')">连续打印</el-button>
        <el-button plain @click="openBatchDialog('export')">批量另存</el-button>
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
      <el-table-column
        v-if="showForeignColumns"
        column-key="exchange_rate"
        prop="exchange_rate"
        label="汇率"
        :width="colWidth('exchange_rate', 90)"
        align="right"
      />
      <el-table-column
        v-if="showForeignColumns"
        column-key="原币借方"
        label="原币借方"
        :width="colWidth('原币借方', 110)"
        align="right"
      >
        <template #default="{ row }">
          {{
            row.is_monthly_subtotal || row.is_yearly_subtotal
              ? ''
              : row.direction === 'debit'
                ? formatAmount(row.foreign_amount)
                : ''
          }}
        </template>
      </el-table-column>
      <el-table-column
        v-if="showForeignColumns"
        column-key="原币贷方"
        label="原币贷方"
        :width="colWidth('原币贷方', 110)"
        align="right"
      >
        <template #default="{ row }">
          {{
            row.is_monthly_subtotal || row.is_yearly_subtotal
              ? ''
              : row.direction === 'credit'
                ? formatAmount(row.foreign_amount)
                : ''
          }}
        </template>
      </el-table-column>
      <el-table-column
        v-if="showQuantityColumns"
        column-key="单价"
        label="单价"
        :width="colWidth('单价', 100)"
        align="right"
      >
        <template #default="{ row }">
          {{
            row.is_monthly_subtotal || row.is_yearly_subtotal
              ? ''
              : formatUnitPriceCell(row.unit_price)
          }}
        </template>
      </el-table-column>
      <el-table-column
        v-if="showQuantityColumns"
        column-key="数量借方"
        label="数量借方"
        :width="colWidth('数量借方', 110)"
        align="right"
      >
        <template #default="{ row }">
          {{
            row.is_monthly_subtotal || row.is_yearly_subtotal
              ? ''
              : row.direction === 'debit'
                ? formatQuantityCell(row.quantity)
                : ''
          }}
        </template>
      </el-table-column>
      <el-table-column
        v-if="showQuantityColumns"
        column-key="数量贷方"
        label="数量贷方"
        :width="colWidth('数量贷方', 110)"
        align="right"
      >
        <template #default="{ row }">
          {{
            row.is_monthly_subtotal || row.is_yearly_subtotal
              ? ''
              : row.direction === 'credit'
                ? formatQuantityCell(row.quantity)
                : ''
          }}
        </template>
      </el-table-column>
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

    <!-- 明细账不分页：一次性展示全部分录 -->
    <div class="pagination">
      <span class="total-tip">共 {{ total }} 条记录</span>
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

    <DetailBatchAccountsDialog
      v-model="batchDialogVisible"
      :mode="batchMode"
      :accounts="accounts"
      :running="batchRunning"
      :progress-done="batchProgressDone"
      :progress-total="batchProgressTotal"
      :progress-text="batchProgressText"
      @confirm="handleBatchConfirm"
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
import DetailBatchAccountsDialog, {
  type DetailBatchMode,
} from '@/components/ledger/DetailBatchAccountsDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable, exportStyledWorkbook, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { formatSignedBalanceAmount } from '@/utils/exportLedgerHelpers'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'
import { ElMessage } from 'element-plus'

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

const selectedAccount = computed(() => {
  if (!filters.value.account_id) return null
  return accounts.value.find(a => a.id === filters.value.account_id)
})

const showForeignColumns = computed(
  () => Number(selectedAccount.value?.is_foreign) === 1 || list.value.some((r: any) => r.foreign_amount)
)

const showQuantityColumns = computed(
  () =>
    Number((selectedAccount.value as any)?.is_quantity) === 1 ||
    list.value.some((r: any) => r.quantity)
)

/** 数量：6 位小数；0 或小计行留空 */
function formatQuantityCell(value: number | null | undefined): string {
  const n = Number(value) || 0
  return n ? Math.abs(n).toFixed(6) : ''
}

/** 单价：4 位小数 */
function formatUnitPriceCell(value: number | null | undefined): string {
  const n = Number(value) || 0
  return n ? n.toFixed(4) : ''
}

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
const continuousPrintHtml = ref('')

function directionLabel(row: any, account?: any): string {
  if (row.is_monthly_subtotal || row.is_yearly_subtotal) return ''
  if (row.running_balance === 0) return '平'
  const dir = (account || selectedAccount.value)?.direction === 'debit'
  return row.running_balance > 0 ? (dir ? '借' : '贷') : (dir ? '贷' : '借')
}

function buildDetailPrintHtmlFor(account: any, rows: any[]): string {
  const title = account
    ? `明细账 —— ${account.code} ${account.name}`
    : '明细账'
  return buildTablePrintHtml<any>({
    title,
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`,
    rows,
    monochrome: true,
    rowStyle: (r: any) =>
      r.is_monthly_subtotal || r.is_yearly_subtotal ? 'font-weight:600;' : '',
    columns: [
      { label: '日期', align: 'center', render: r => (r.is_monthly_subtotal || r.is_yearly_subtotal ? '' : r.voucher_date || '') },
      { label: '凭证号', align: 'center', render: r => formatVoucherNo(r) },
      { label: '摘要', align: 'left', render: r => r.summary || (r.is_monthly_subtotal ? '本月合计' : r.is_yearly_subtotal ? '本年累计' : '') },
      { label: '对方科目', align: 'left', render: r => r.opposite_accounts || '' },
      { label: '借方', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_debit) : r.is_yearly_subtotal ? formatAmount(r.yearly_debit) : r.direction === 'debit' ? formatAmount(r.amount) : '') },
      { label: '贷方', align: 'right', render: r => (r.is_monthly_subtotal ? formatAmount(r.monthly_credit) : r.is_yearly_subtotal ? formatAmount(r.yearly_credit) : r.direction === 'credit' ? formatAmount(r.amount) : '') },
      { label: '方向', align: 'center', render: r => directionLabel(r, account) },
      { label: '余额', align: 'right', render: r => formatAmount(Math.abs(r.running_balance)) },
    ],
  })
}

function buildPrintHtml(): string {
  if (continuousPrintHtml.value) return continuousPrintHtml.value
  return buildDetailPrintHtmlFor(selectedAccount.value, list.value)
}

const batchDialogVisible = ref(false)
const batchMode = ref<DetailBatchMode>('print')
const batchRunning = ref(false)
const batchProgressDone = ref(0)
const batchProgressTotal = ref(0)
const batchProgressText = ref('')

function openBatchDialog(mode: DetailBatchMode) {
  if (!filters.value.start_date || !filters.value.end_date) {
    ElMessage.warning('请先选择起止日期')
    return
  }
  if (accounts.value.length === 0) {
    ElMessage.warning('暂无可用科目')
    return
  }
  batchMode.value = mode
  batchDialogVisible.value = true
}

/** 从明细账响应里取账前发生额（中途启用账套专用，年初启用时恒为 0） */
function readPreBook(res: any): { debit: number; credit: number } {
  return {
    debit: Number(res?.preBookDebit) || 0,
    credit: Number(res?.preBookCredit) || 0,
  }
}

/**
 * 明细账取数的唯一实现：参数拼装 + 子科目判定 + running_balance 累计。
 * 原先 fetchData / fetchAccountDetailRows / exportData 各写一遍，改一处必漏两处。
 * 差异仅 pageSize（页面 100000、导出 10000）由调用方传入，其余口径必须完全一致。
 */
async function fetchDetailPayload(account: any, pageSize: number) {
  const params: any = { page: 1, pageSize, year: getLedgerYear() }

  // 有子科目时按编码区间取数（含下级发生额），否则按科目 id 精确取
  const hasChildren = accounts.value.some(
    (a: any) =>
      a.id !== account.id && a.code.startsWith(account.code) && a.code.length > account.code.length
  )
  if (hasChildren) {
    params.account_code_start = account.code
    params.account_code_end = account.code + '9999'
  } else {
    params.account_id = account.id
  }

  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.summary_keyword) params.summary_keyword = filters.value.summary_keyword
  if (filters.value.min_amount) params.min_amount = filters.value.min_amount
  if (filters.value.max_amount) params.max_amount = filters.value.max_amount
  if (filters.value.maker_name) params.maker_name = filters.value.maker_name
  if (filters.value.auditor_name) params.auditor_name = filters.value.auditor_name
  if (filters.value.include_unposted) params.include_unposted = 'true'

  const res = await request.get<any>('/ledger/detail', { params })
  const openingBalance = (res as any).initBalance || 0
  const entries = res.data || []

  // 余额按科目方向累计：借方科目「借增贷减」，贷方科目「贷增借减」
  let balance = openingBalance
  for (const entry of entries) {
    const isIncrease =
      account?.direction === 'debit' ? entry.direction === 'debit' : entry.direction === 'credit'
    balance += isIncrease ? entry.amount : -entry.amount
    entry.running_balance = balance
  }

  const entriesWithSubtotals = insertMonthlySubtotals(entries, account, readPreBook(res))
  return {
    initBalance: openingBalance,
    total: (res as any).total || 0,
    rows: [buildCarryForwardRow(openingBalance), ...entriesWithSubtotals],
  }
}

async function fetchAccountDetailRows(account: any) {
  return fetchDetailPayload(account, 10000)
}

function buildExportColumns(account: any): ExportColumnDef[] {
  return [
    { label: '日期', width: colWidth('voucher_date', 100), value: row => row.voucher_date },
    { label: '凭证号', width: colWidth('voucher_no', 130), value: row => row.voucher_no },
    { label: '摘要', width: colWidth('summary', 180), value: row => row.summary },
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
      value: row => directionLabel(row, account),
    },
    {
      label: '余额',
      width: colWidth('余额', 140),
      align: 'right',
      type: 'amount',
      value: row => formatSignedBalanceAmount(row.running_balance, false),
    },
  ]
}

// Excel 工作表名不允许 : \ / ? * [ ]，且长度上限 31
function buildSheetName(account: any, index: number, usedNames: Set<string>) {
  const raw = [account?.code, account?.name].filter(Boolean).join(' ') || `科目${index + 1}`
  const base = raw.replace(/[:\\/?*[\]]/g, '_').trim().slice(0, 31) || `科目${index + 1}`
  if (!usedNames.has(base)) return base
  const suffix = `_${index + 1}`
  return `${base.slice(0, 31 - suffix.length)}${suffix}`
}

async function handleBatchConfirm(accountIds: string[]) {
  if (accountIds.length === 0) return
  const selected = accounts.value.filter(a => accountIds.includes(a.id))
  batchRunning.value = true
  batchProgressDone.value = 0
  batchProgressTotal.value = selected.length
  batchProgressText.value = '准备中…'
  try {
    if (batchMode.value === 'print') {
      const parts: string[] = []
      for (let i = 0; i < selected.length; i++) {
        const account = selected[i]
        batchProgressText.value = `正在加载 ${account.code} ${account.name}`
        const { rows } = await fetchAccountDetailRows(account)
        const html = buildDetailPrintHtmlFor(account, rows)
        const breakStyle =
          i < selected.length - 1
            ? 'page-break-after:always;break-after:page;margin-bottom:12px;'
            : ''
        parts.push(`<div style="${breakStyle}">${html}</div>`)
        batchProgressDone.value = i + 1
      }
      continuousPrintHtml.value = parts.join('')
      batchDialogVisible.value = false
      hiprintVisible.value = true
    } else {
      const sheets: any[] = []
      const usedNames = new Set<string>()
      for (let i = 0; i < selected.length; i++) {
        const account = selected[i]
        batchProgressText.value = `正在导出 ${account.code} ${account.name}`
        const { rows } = await fetchAccountDetailRows(account)
        const sheetName = buildSheetName(account, i, usedNames)
        usedNames.add(sheetName)
        sheets.push({
          sheetName,
          title: '明细账',
          subtitle: [`${account.code} ${account.name}`, printDateLabel.value].filter(Boolean).join('  '),
          columns: buildExportColumns(account),
          rows,
        })
        batchProgressDone.value = i + 1
      }
      const dateRange =
        filters.value.start_date && filters.value.end_date
          ? `${filters.value.start_date}_${filters.value.end_date}`
          : new Date().toISOString().split('T')[0]
      await exportStyledWorkbook(`明细账批量_${dateRange}.xlsx`, sheets)
      ElMessage.success(`已导出 ${sheets.length} 个科目`)
      batchDialogVisible.value = false
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '批量处理失败')
  } finally {
    batchRunning.value = false
    batchProgressText.value = ''
  }
}

watch(hiprintVisible, v => {
  if (!v) continuousPrintHtml.value = ''
})

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

/**
 * 插入「本月合计 / 本年累计」行。
 *
 * preBook 是中途启用账套在启用前的累计发生额（启用前由旧系统记账，本系统没有凭证明细）。
 * 「本年累计」必须以它为起点，否则年中建账的账套只会累计到启用后的零头；
 * 「本月合计」不含它——它不属于任何一个有明细的月份。
 */
function insertMonthlySubtotals(
  entries: any[],
  account: any,
  preBook?: { debit: number; credit: number }
): any[] {
  if (entries.length === 0) return entries

  const preBookDebit = preBook?.debit || 0
  const preBookCredit = preBook?.credit || 0

  const result: any[] = []
  let currentMonth = ''
  let monthlyDebit = 0
  let monthlyCredit = 0
  let yearlyDebit = preBookDebit
  let yearlyCredit = preBookCredit
  let currentYear = ''
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const entryMonth = entry.voucher_date.substring(0, 7)
    const entryYear = entry.voucher_date.substring(0, 4)
    
    if (entryYear !== currentYear) {
      // 跨年时重置累计；首个年度沿用账前发生额作为起点
      const isFirstYear = currentYear === ''
      currentYear = entryYear
      yearlyDebit = isFirstYear ? preBookDebit : 0
      yearlyCredit = isFirstYear ? preBookCredit : 0
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
    fetchData()
  }
)

function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  if (row.is_yearly_subtotal) return 'yearly-subtotal-row'
  if (row.is_carry_forward) return 'carry-forward-row'
  return ''
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

  const payload = await fetchDetailPayload(account, 100000)
  initBalance.value = payload.initBalance
  total.value = payload.total
  list.value = payload.rows
  initialLoaded.value = true
  await afterTableLayout()

  } finally {
    loading.value = false
  }
}

function handleQuery() {
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

  const { rows: exportRows } = await fetchDetailPayload(account, 10000)
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
.total-tip {
  color: var(--el-text-color-secondary);
  font-size: var(--cw-text-base);
}

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
