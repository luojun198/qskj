<template>
  <div class="page page-flow-query">
    
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

    <div v-if="rows.length" class="table-footer">
      <span>共 {{ journalResult ? journalResult.rows.length : 0 }} 条记录</span>
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
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
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
const rows = computed(() => {
  const raw = journalResult.value?.rows ?? []
  if (raw.length === 0 && !journalResult.value) return []
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
const filters = ref({ account_code: '', start_date: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, end_date: '' })

const fmt = (v: number) => v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

onMounted(async () => {
  const res = await cashierApi.getAccounts()
  if (res.code === 0) {
    accounts.value = res.data
    
    if (route.query.start_date) filters.value.start_date = route.query.start_date as string
    if (route.query.end_date) filters.value.end_date = route.query.end_date as string

    if (route.query.account_code) {
      filters.value.account_code = route.query.account_code as string
      handleQuery()
    } else if (accounts.value.length) {
      filters.value.account_code = accounts.value[0].code
      handleQuery()
    }
  }
})

async function handleQuery() {
  if (!filters.value.account_code) return
  const res = await cashierApi.getJournal({
    account_code: filters.value.account_code,
    start_date: filters.value.start_date || undefined,
    end_date: filters.value.end_date || undefined,
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
  const columns: ExportColumnDef<any>[] = [
    { label: '日期', width: 100, value: r => r.biz_date },
    { label: '摘要', width: 160, value: r => r.summary || '' },
    { label: '结算方式', width: 90, value: r => r.settle_type || '' },
    { label: '票据号', width: 110, value: r => r.bill_no || '' },
    { label: '对方单位', width: 140, value: r => r.counter_unit || '' },
    { label: '借方(收入)', width: 120, align: 'right', type: 'amount', value: r => r.debit || '' },
    { label: '贷方(支出)', width: 120, align: 'right', type: 'amount', value: r => r.credit || '' },
    { label: '余额', width: 120, align: 'right', type: 'amount', value: r => r.balance ?? 0 },
    { label: '已对账', width: 70, align: 'center', value: r => (r.reconciled ? '是' : '') },
    { label: '关联凭证', width: 120, value: r => (r.voucher_no ? `${r.voucher_year}-${String(r.voucher_month).padStart(2, '0')} ${r.voucher_no}` : '') },
  ]
  const summaryValues = ['', '', '', '', '', jr.totalDebit, jr.totalCredit, jr.closing, '', '']
  await exportStyledTable({
    fileName: `出纳流水账_${filters.value.account_code}_${range || '全部'}.xlsx`,
    sheetName: '出纳流水账',
    title: `出纳流水账　${acc}`,
    subtitle: range ? `日期：${range}　期初：${fmt(jr.opening)}　期末：${fmt(jr.closing)}` : undefined,
    columns,
    rows: rows.value,
    summaryValues,
  })
}
</script>

<style scoped>
.page-flow-query { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.balance-summary { display: flex; gap: 24px; padding: 6px 16px; background: var(--el-fill-color-lighter); font-size: 13px; }
.balance-summary b { font-weight: 600; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.table-container { flex: 1; overflow: hidden; padding: 0 16px 0; }
.table-footer { padding: 4px 16px; font-size: 12px; color: var(--el-text-color-secondary); border-top: 1px solid var(--el-border-color-lighter); }
:deep(.opening-row) { background: var(--el-fill-color-light); font-style: italic; }
:deep(.opening-row td) { color: var(--el-text-color-secondary); }
</style>
