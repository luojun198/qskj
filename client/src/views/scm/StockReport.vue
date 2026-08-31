<template>
  <div class="page scm-report-page">
        <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="calc(100vh - 200px)"
      :summary-method="summaryMethod" show-summary @header-dragend="onDragEnd">
      <el-table-column label="仓库" prop="warehouse_code" :width="cw('warehouse_code', 90)" />
      <el-table-column label="物料编号" prop="item_code" :width="cw('item_code', 110)" />
      <el-table-column label="名称" prop="item_name" min-width="130" :width="widths.item_name" show-overflow-tooltip />
      <el-table-column label="规格" prop="spec" :width="cw('spec', 100)" show-overflow-tooltip />
      <el-table-column label="单位" prop="unit" :width="cw('unit', 60)" />
      <el-table-column label="期初数量" prop="opening_qty" :width="cw('opening_qty', 90)" align="right" />
      <el-table-column label="期初金额" prop="opening_amt" :width="cw('opening_amt', 110)" align="right" />
      <el-table-column label="本期入库" prop="in_qty" :width="cw('in_qty', 90)" align="right" />
      <el-table-column label="入库金额" prop="in_amt" :width="cw('in_amt', 110)" align="right" />
      <el-table-column label="本期出库" prop="out_qty" :width="cw('out_qty', 90)" align="right" />
      <el-table-column label="出库金额" prop="out_amt" :width="cw('out_amt', 110)" align="right" />
      <el-table-column label="期末数量" prop="closing_qty" :width="cw('closing_qty', 90)" align="right">
        <template #default="{ row }"><b>{{ row.closing_qty }}</b></template>
      </el-table-column>
      <el-table-column label="期末金额" prop="closing_amt" :width="cw('closing_amt', 120)" align="right">
        <template #default="{ row }"><b>{{ fmt(row.closing_amt) }}</b></template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_stock_report')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<any[]>([]); const loading = ref(false)
const warehouses = ref<any[]>([])
const startDate = ref(''); const endDate = ref(''); const wh = ref('')
const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
      sums[i] = fmt(data.reduce((s: number, r: any) => s + (Number(r[col.property]) || 0), 0))
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
.scm-report-page { padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
</style>
