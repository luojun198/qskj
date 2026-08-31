<template>
  <div class="page page-summary">
    
    <div v-if="rows.length" class="report-body">
      <h4 class="report-title">
        资金收支汇总表
        <span class="subtitle">（期间：{{ dateRange?.[0] || '起' }} 至 {{ dateRange?.[1] || '止' }}　单位：人民币元）</span>
      </h4>

      <el-table ref="tableRef" :data="rows" size="small" class="compact-data-table" border stripe show-summary :summary-method="summarize" @header-dragend="onDragEnd">
        <el-table-column :label="groupColumnLabel" prop="group_name" min-width="150" :width="widths.group_name">
          <template #default="{ row }">
            <span v-if="groupBy === 'month'">{{ row.group_code }}</span>
            <span v-else>{{ row.group_code === 'N/A' ? '未指定' : `${row.group_code} ${row.group_name}` }}</span>
          </template>
        </el-table-column>
        <el-table-column label="收入金额" prop="income" :width="cw('income', 160)" align="right">
          <template #default="{ row }"><span v-if="row.income" class="debit">{{ fmt(row.income) }}</span></template>
        </el-table-column>
        <el-table-column label="支出金额" prop="expense" :width="cw('expense', 160)" align="right">
          <template #default="{ row }"><span v-if="row.expense" class="credit">{{ fmt(row.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="收支净额" prop="net_amount" :width="cw('net_amount', 160)" align="right">
          <template #default="{ row }">
            <span :class="{ debit: row.income - row.expense >= 0, credit: row.income - row.expense < 0 }">
              {{ fmt(row.income - row.expense) }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <div class="summary-section">
        <div class="summary-card">
          <span class="s-label">总收入</span>
          <span class="s-value debit">¥{{ fmt(totalIncome) }}</span>
        </div>
        <div class="summary-card">
          <span class="s-label">总支出</span>
          <span class="s-value credit">¥{{ fmt(totalExpense) }}</span>
        </div>
        <div class="summary-card">
          <span class="s-label">总净额</span>
          <span class="s-value" :class="{ debit: netFlow >= 0, credit: netFlow < 0 }">
            ¥{{ fmt(netFlow) }}
          </span>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="暂无数据" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Printer, Download } from '@element-plus/icons-vue'
import { cashierApi } from '@/api/cashier'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('cashier_cashflow_summary')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const today = new Date().toISOString().slice(0, 10)
const dateRange = ref<[string, string]>([`${today.slice(0, 8)}01`, today])
const groupBy = ref<'counter_account' | 'settle_type' | 'month'>('month')
const rows = ref<any[]>([])
const loading = ref(false)

const groupColumnLabel = computed(() => {
  if (groupBy.value === 'month') return '月份'
  if (groupBy.value === 'settle_type') return '结算方式'
  if (groupBy.value === 'counter_account') return '对方科目'
  return '分组项目'
})

const totalIncome = computed(() => rows.value.reduce((sum, r) => sum + (r.income || 0), 0))
const totalExpense = computed(() => rows.value.reduce((sum, r) => sum + (r.expense || 0), 0))
const netFlow = computed(() => totalIncome.value - totalExpense.value)

const fmt = (v: number) =>
  (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function summarize({ columns }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (i === 0) sums[0] = '合计'
    else if (col.property === 'income') sums[i] = fmt(totalIncome.value)
    else if (col.property === 'expense') sums[i] = fmt(totalExpense.value)
    else if (col.property === 'net_amount') sums[i] = fmt(netFlow.value)
    else sums[i] = ''
  })
  return sums
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const res = await cashierApi.getCashFlowSummary({
      start_date: dateRange.value?.[0],
      end_date: dateRange.value?.[1],
      group_by: groupBy.value
    })
    if ((res as any).code === 0) {
      rows.value = (res as any).data
    }
  } finally {
    loading.value = false
  }
}

function handlePrint() { window.print() }

async function handleExport() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出')

  const columns: ExportColumnDef<any>[] = [
    { 
      label: groupColumnLabel.value, 
      width: 200, 
      value: r => groupBy.value === 'month' ? r.group_code : (r.group_code === 'N/A' ? '未指定' : `${r.group_code} ${r.group_name}`) 
    },
    { label: '收入金额', width: 140, align: 'right', type: 'amount', value: r => r.income || '' },
    { label: '支出金额', width: 140, align: 'right', type: 'amount', value: r => r.expense || '' },
    { label: '收支净额', width: 140, align: 'right', type: 'amount', value: r => (r.income || 0) - (r.expense || 0) },
  ]

  const summaryValues = ['合计', totalIncome.value, totalExpense.value, netFlow.value]
  
  await exportStyledTable({
    fileName: `资金收支汇总表_${dateRange.value?.[0]||''}至${dateRange.value?.[1]||''}.xlsx`,
    sheetName: '资金收支汇总表',
    title: '资金收支汇总表',
    subtitle: `期间：${dateRange.value?.[0]||'起'} 至 ${dateRange.value?.[1]||'止'}　（单位：人民币元）`,
    columns,
    rows: rows.value,
    summaryValues,
  })
}
</script>

<style scoped>
.page-summary { display: flex; flex-direction: column; height: 100%; }
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
