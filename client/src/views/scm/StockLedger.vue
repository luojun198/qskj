<template>
  <div class="page ledger-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>物料收发明细账</b></div>
      <span class="report-header__note">{{ isFullHistoryView ? '单据直达 · 全历史库存流水' : '按已审核库存移动计算期初、本期收发与逐笔结存' }}</span>
    </div>
    <div class="ledger-toolbar toolbar">
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" />
      <el-input v-model="filters.item_code" clearable placeholder="物料编码" style="width:140px" />
      <el-select v-model="filters.category_code" clearable filterable placeholder="物料分类" style="width:150px">
        <el-option v-for="row in categories" :key="row.code" :label="row.name || row.code" :value="row.code" />
      </el-select>
      <el-select v-model="filters.warehouse_code" clearable filterable placeholder="仓库" style="width:150px">
        <el-option v-for="row in warehouses" :key="row.code" :label="row.name || row.code" :value="row.code" />
      </el-select>
      <el-select v-model="filters.doc_type" clearable filterable placeholder="单据类型" style="width:150px">
        <el-option v-for="row in docTypes" :key="row.code" :label="row.name || row.code" :value="row.code" />
      </el-select>
      <el-select v-model="filters.partner_code" clearable filterable placeholder="往来单位" style="width:180px">
        <el-option v-for="row in partners" :key="row.code" :label="`${row.code} ${row.name}`" :value="row.code" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="query">查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <el-button type="success" plain :loading="exporting" @click="exportExcel">另存</el-button>
    </div>
    <div class="summary-grid">
      <div><span>期初数量</span><b>{{ num(summary.opening_qty) }}</b></div><div><span>期初金额</span><b>{{ money(summary.opening_amount) }}</b></div>
      <div><span>收入数量</span><b>{{ num(summary.in_qty) }}</b></div><div><span>发出数量</span><b>{{ num(summary.out_qty) }}</b></div>
      <div><span>期末数量</span><b>{{ num(summary.closing_qty) }}</b></div><div><span>期末金额</span><b>{{ money(summary.closing_amount) }}</b></div>
    </div>
    <div class="ledger-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%" @sort-change="onSortChange">
        <el-table-column prop="move_date" label="日期" width="110" sortable="custom" />
        <el-table-column prop="doc_type_name" label="业务类型" width="120" />
        <el-table-column label="单据号" min-width="160"><template #default="{ row }"><el-link type="primary" @click="openDoc(row)">{{ row.doc_no }}</el-link></template></el-table-column>
        <el-table-column prop="item_code" label="物料编码" width="120" />
        <el-table-column prop="item_name" label="物料名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" width="110" show-overflow-tooltip />
        <el-table-column prop="warehouse_name" label="仓库" width="130" />
        <el-table-column prop="partner_name" label="往来单位" min-width="140" show-overflow-tooltip />
        <el-table-column label="收入数量" width="100" align="right"><template #default="{ row }">{{ cell(row.in_qty) }}</template></el-table-column>
        <el-table-column label="收入金额" width="110" align="right"><template #default="{ row }">{{ cellMoney(row.in_amount) }}</template></el-table-column>
        <el-table-column label="发出数量" width="100" align="right"><template #default="{ row }">{{ cell(row.out_qty) }}</template></el-table-column>
        <el-table-column label="发出金额" width="110" align="right"><template #default="{ row }">{{ cellMoney(row.out_amount) }}</template></el-table-column>
        <el-table-column label="单位成本" width="100" align="right"><template #default="{ row }">{{ unitPrice(row.unit_cost) }}</template></el-table-column>
        <el-table-column label="结存数量" width="105" align="right"><template #default="{ row }">{{ num(row.running_qty) }}</template></el-table-column>
        <el-table-column label="结存金额" width="115" align="right"><template #default="{ row }">{{ money(row.running_amount) }}</template></el-table-column>
      </el-table>
    </div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" @change="load" />
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { computed, onMounted, ref, watch } from 'vue'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRoute, useRouter } from 'vue-router'
import { scmApi } from '@/api/scm'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const route = useRoute()
const router = useRouter()
const loading = ref(false); const exporting = ref(false); const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const warehouses = ref<any[]>([]); const categories = ref<any[]>([]); const partners = ref<any[]>([]); const docTypes = ref<any[]>([])
const summary = ref<Record<string, number>>({})
const queryValue = (value: unknown) => typeof value === 'string' ? value : ''
const routeFilters = () => ({
  item_code: queryValue(route.query.item_code),
  category_code: queryValue(route.query.category_code),
  warehouse_code: queryValue(route.query.warehouse_code),
  doc_type: queryValue(route.query.doc_type),
  partner_code: queryValue(route.query.partner_code),
})
const filters = ref(routeFilters())
const now = new Date(); const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; const today = todayStr()
const isDirectFullHistory = computed(() => queryValue(route.query.full_history) === '1')
const dateRange = ref<string[] | null>(isDirectFullHistory.value ? [] : [first, today]); const sortOrder = ref<'asc' | 'desc'>('asc')
const hasDateRange = computed(() => Array.isArray(dateRange.value) && dateRange.value.length === 2)
const isFullHistoryView = computed(() => isDirectFullHistory.value && !hasDateRange.value)
const { clearFilters } = useFilterClear([filters, dateRange])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  page.value = 1
  load()
}
const params = () => ({ ...filters.value, ...(hasDateRange.value ? { start_date: dateRange.value![0], end_date: dateRange.value![1] } : {}), page: page.value, page_size: pageSize.value, sort_order: sortOrder.value })
// 小数位：系统参数 → 供应链 → 小数位设置 →「收发台账」
const decStore = useScmDecimalsStore()
void decStore.load()
const num = (v: any) => decStore.qty(Number(v) || 0, 'stock_ledger'); const money = (v: any) => decStore.amount(Number(v) || 0, 'stock_ledger')
const unitPrice = (v: any) => decStore.price(Number(v) || 0, 'stock_ledger')
const cell = (v: any) => Number(v) ? num(v) : ''; const cellMoney = (v: any) => Number(v) ? money(v) : ''
let loadSequence = 0
async function load() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const r = await scmApi.getStockLedger(params())
    if (sequence === loadSequence && r.code === 0) {
      rows.value = r.data.rows
      total.value = r.data.total
      summary.value = r.data.summary
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function query() { page.value = 1; load() }
function onSortChange(e: any) { sortOrder.value = e.order === 'descending' ? 'desc' : 'asc'; load() }
function openDoc(row: any) { if (row.doc_id) router.push(scmDownstreamDocRoute(row.doc_id, row.status, undefined, row.doc_type)) }
async function exportExcel() { exporting.value = true; try { const blob = await scmApi.exportStockLedger(params()); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '物料收发明细账.xlsx'; a.click(); URL.revokeObjectURL(url) } finally { exporting.value = false } }
watch(
  () => route.fullPath,
  () => {
    if (route.name !== 'ScmStockLedger') return
    filters.value = routeFilters()
    dateRange.value = isDirectFullHistory.value ? [] : [first, today]
    page.value = 1
    load()
  },
)
// 从单据页返回时刷新
useReloadOnActivated(() => { load() })
onMounted(async () => { const [w, c, p, d] = await Promise.all([scmApi.getWarehouses(), scmApi.getCategories(), scmApi.getPartners({}), scmApi.getDocTypes()]); warehouses.value = w.data || []; categories.value = c.data || []; partners.value = p.data || []; docTypes.value = d.data || []; load() })
</script>

<style scoped>
.ledger-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:8px}.report-header__left{display:flex;align-items:center;gap:8px}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.ledger-toolbar{display:flex;gap:8px;flex-wrap:wrap}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.ledger-table{flex:1;min-height:220px}
</style>
