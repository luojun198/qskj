<template>
  <div class="page page-daily">
    
    <div v-if="rows.length" class="report-body">
      <h4 class="report-title">
        账户资金余额表
        <span class="subtitle">（期间：{{ dateRange?.[0] }} 至 {{ dateRange?.[1] }}　单位：人民币元）</span>
      </h4>

      <el-table ref="tableRef" :data="displayRows" size="small" class="compact-data-table" border stripe show-summary :summary-method="summarize" @row-dblclick="handleRowDblClick" style="cursor: pointer;" @header-dragend="onDragEnd">
        <el-table-column label="科目编码" prop="account_code" :width="cw('account_code', 120)" />
        <el-table-column label="科目名称" prop="account_name" min-width="150" :width="widths.account_name" />
        <el-table-column label="期初余额" prop="opening" :width="cw('opening', 130)" align="right">
          <template #default="{ row }">{{ fmt(row.opening) }}</template>
        </el-table-column>
        <el-table-column label="本期收入" prop="income" :width="cw('income', 130)" align="right">
          <template #default="{ row }"><span v-if="row.income" class="debit">{{ fmt(row.income) }}</span></template>
        </el-table-column>
        <el-table-column label="本期支出" prop="expense" :width="cw('expense', 130)" align="right">
          <template #default="{ row }"><span v-if="row.expense" class="credit">{{ fmt(row.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="期末余额" prop="closing" :width="cw('closing', 130)" align="right">
          <template #default="{ row }">{{ fmt(row.closing) }}</template>
        </el-table-column>
      </el-table>

      <div class="summary-section">
        <div class="summary-card">
          <span class="s-label">本期收入合计</span>
          <span class="s-value debit">¥{{ fmt(data?.total_income ?? 0) }}</span>
        </div>
        <div class="summary-card">
          <span class="s-label">本期支出合计</span>
          <span class="s-value credit">¥{{ fmt(data?.total_expense ?? 0) }}</span>
        </div>
        <div class="summary-card">
          <span class="s-label">净收支</span>
          <span class="s-value" :class="{ debit: netFlow >= 0, credit: netFlow < 0 }">
            ¥{{ fmt(netFlow) }}
          </span>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="请选择日期后查询" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Printer, Download } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useRouter } from 'vue-router'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('cashier_daily_report')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const router = useRouter()
const today = new Date().toISOString().slice(0, 10)
const dateRange = ref<[string, string]>([`${today.slice(0, 8)}01`, today])
const rows = ref<any[]>([])
const data = ref<{ total_income: number; total_expense: number } | null>(null)
const loading = ref(false)
const showZero = ref(false)

const displayRows = computed(() => showZero.value ? rows.value : rows.value.filter(r => r.income || r.expense))
const netFlow = computed(() => (data.value?.total_income ?? 0) - (data.value?.total_expense ?? 0))

const fmt = (v: number) =>
  (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function summarize({ columns, data: tableData }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (i === 0) sums[0] = '合计'
    else if (i === 1) sums[1] = ''
    else if (col.property === 'opening' || col.property === 'closing') sums[i] = ''
    else if (col.property === 'income') sums[i] = fmt(data.value?.total_income ?? 0)
    else if (col.property === 'expense') sums[i] = fmt(data.value?.total_expense ?? 0)
    else sums[i] = ''
  })
  return sums
}

onMounted(load)
async function load() {
  if (!dateRange.value || !dateRange.value[0] || !dateRange.value[1]) return
  loading.value = true
  try {
    const res = await cashierApi.getDailyReport(dateRange.value[0], dateRange.value[1])
    if (res.code === 0) {
      rows.value = res.data.rows
      data.value = { total_income: res.data.total_income, total_expense: res.data.total_expense }
    }
  } finally { loading.value = false }
}

function handleRowDblClick(row: any) {
  router.push({
    path: '/cashier/flow-query',
    query: {
      account_code: row.account_code,
      start_date: dateRange.value?.[0],
      end_date: dateRange.value?.[1]
    }
  })
}

function handlePrint() { window.print() }

async function handleExport() {
  if (!displayRows.value.length) return ElMessage.warning('暂无数据可导出')
  const columns: ExportColumnDef<any>[] = [
    { label: '科目编码', width: 120, value: r => r.account_code },
    { label: '科目名称', width: 180, value: r => r.account_name },
    { label: '期初余额', width: 130, align: 'right', type: 'amount', value: r => r.opening ?? 0 },
    { label: '本期收入', width: 130, align: 'right', type: 'amount', value: r => r.income || '' },
    { label: '本期支出', width: 130, align: 'right', type: 'amount', value: r => r.expense || '' },
    { label: '期末余额', width: 130, align: 'right', type: 'amount', value: r => r.closing ?? 0 },
  ]
  const summaryValues = ['', '', '', data.value?.total_income ?? 0, data.value?.total_expense ?? 0, '']
  await exportStyledTable({
    fileName: `账户资金余额表_${dateRange.value[0]}_${dateRange.value[1]}.xlsx`,
    sheetName: '账户资金余额表',
    title: '账户资金余额表',
    subtitle: `期间：${dateRange.value[0]} 至 ${dateRange.value[1]}　（单位：人民币元）`,
    columns,
    rows: displayRows.value,
    summaryValues,
  })
}
</script>

<style scoped>
.page-daily { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.report-body { flex: 1; overflow: auto; padding: 16px; }
.report-title { margin: 0 0 12px; font-size: 16px; text-align: center; }
.subtitle { font-size: 12px; color: var(--el-text-color-secondary); }
.summary-section { display: flex; gap: 16px; margin-top: 12px; justify-content: flex-end; }
.summary-card { text-align: center; padding: 8px 20px; border-radius: 6px; background: var(--el-fill-color-lighter); }
.s-label { display: block; font-size: 12px; color: var(--el-text-color-secondary); }
.s-value { font-size: 18px; font-weight: 700; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
</style>
