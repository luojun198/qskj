<template>
  <div class="page scm-report-page">
    <!-- P2-11：筛选行（原来 startDate/endDate/wh 声明后从未绑定 UI） -->
    <div class="filter-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" size="small" style="width:140px" />
      <span>至</span>
      <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" size="small" style="width:140px" />
      <el-select v-model="wh" clearable filterable placeholder="全部仓库" size="small" style="width:160px">
        <el-option v-for="w in warehouses" :key="w.code" :label="`${w.code} ${w.name}`" :value="w.code" />
      </el-select>
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <SaveAsButton title="存货报表" />
      <span style="margin-left:auto;font-size:var(--cw-text-base);color:var(--el-text-color-secondary)">共 {{ list.length }} 行</span>
    </div>
        <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="calc(100vh - 200px)"
      :summary-method="summaryMethod" show-summary @header-dragend="onDragEnd">
      <el-table-column label="仓库" prop="warehouse_code" :width="cw('warehouse_code', 90)" />
      <el-table-column label="物料编号" prop="item_code" :width="cw('item_code', 110)" />
      <el-table-column label="名称" prop="item_name" min-width="130" :width="widths.item_name" show-overflow-tooltip />
      <el-table-column label="规格" prop="spec" :width="cw('spec', 100)" show-overflow-tooltip />
      <el-table-column label="单位" prop="unit" :width="cw('unit', 60)" />
      <el-table-column label="期初数量" prop="opening_qty" :width="cw('opening_qty', 90)" align="right" :formatter="(r: any) => q(r.opening_qty)" />
      <el-table-column label="期初金额" prop="opening_amt" :width="cw('opening_amt', 110)" align="right" :formatter="(r: any) => a(r.opening_amt)" />
      <el-table-column label="本期入库" prop="in_qty" :width="cw('in_qty', 90)" align="right" :formatter="(r: any) => q(r.in_qty)" />
      <el-table-column label="入库金额" prop="in_amt" :width="cw('in_amt', 110)" align="right" :formatter="(r: any) => a(r.in_amt)" />
      <el-table-column label="本期出库" prop="out_qty" :width="cw('out_qty', 90)" align="right" :formatter="(r: any) => q(r.out_qty)" />
      <el-table-column label="出库金额" prop="out_amt" :width="cw('out_amt', 110)" align="right" :formatter="(r: any) => a(r.out_amt)" />
      <el-table-column label="期末数量" prop="closing_qty" :width="cw('closing_qty', 90)" align="right">
        <template #default="{ row }"><b>{{ q(row.closing_qty) }}</b></template>
      </el-table-column>
      <el-table-column label="期末金额" prop="closing_amt" :width="cw('closing_amt', 120)" align="right">
        <template #default="{ row }"><b>{{ a(row.closing_amt) }}</b></template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_stock_report')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<any[]>([]); const loading = ref(false)
const warehouses = ref<any[]>([])
const startDate = ref(''); const endDate = ref(''); const wh = ref('')
// 小数位：系统参数 → 供应链 → 小数位设置 →「汇总统计表」
const decStore = useScmDecimalsStore()
void decStore.load()
const q = (v: any) => decStore.qty(Number(v) || 0, 'stock_report')
const a = (v: any) => decStore.amount(Number(v) || 0, 'stock_report')

async function load() {
  loading.value = true
  try {
    const res = await scmApi.getStockSummary({ start_date: startDate.value || undefined, end_date: endDate.value || undefined, warehouse_code: wh.value || undefined })
    if (res.code === 0) list.value = res.data.summary || []
  } finally { loading.value = false }
}

function summaryMethod({ columns, data }: any) {
  const sums: string[] = []
  columns.forEach((col: any, i: number) => {
    if (['opening_qty','opening_amt','in_qty','in_amt','out_qty','out_amt','closing_qty','closing_amt'].includes(col.property)) {
      const total = data.reduce((s: number, r: any) => s + (Number(r[col.property]) || 0), 0)
      sums[i] = String(col.property).endsWith('_amt') ? a(total) : q(total)
    } else { sums[i] = i === 0 ? '合计' : '' }
  })
  return sums
}

onMounted(async () => {
  const w = await scmApi.getWarehouses(); if (w.code === 0) warehouses.value = w.data
  load()
})
</script>

<style scoped>
.scm-report-page { padding: var(--page-pad); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
</style>
