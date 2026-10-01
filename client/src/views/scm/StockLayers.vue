<template>
  <div class="page layers-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>库存成本层</b></div>
      <span class="report-header__note">
        当前计价方式：{{ methodLabel }}。
        <template v-if="isLayerMethod">{{ costingMethod === 'specified' ? '出库行指定批次即耗该批次的层（个别计价），未指定批次按先进先出' : `出库按${costingMethod === 'fifo' ? '最早' : '最新'}入库层逐层扣减` }}；期初层为切换计价方式前的存量结存。</template>
        <template v-else>移动加权平均不产生成本层，切换为先进先出 / 后进先出后此处显示各入库层的剩余数量与单价。</template>
      </span>
    </div>
    <div class="toolbar">
      <el-select v-model="filters.warehouse_code" clearable filterable placeholder="仓库" style="width:160px">
        <el-option v-for="row in warehouses" :key="row.code" :label="row.name || row.code" :value="row.code" />
      </el-select>
      <el-input v-model="filters.item_code" clearable placeholder="物料编码" style="width:150px" @keyup.enter="load" />
      <el-checkbox v-model="showExhausted">含已耗尽层</el-checkbox>
      <el-button type="primary" :loading="loading" @click="load">查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
    </div>
    <div class="summary-grid">
      <div><span>层数</span><b>{{ rows.length }}</b></div>
      <div><span>剩余数量合计</span><b>{{ num(totalQty) }}</b></div>
      <div><span>剩余金额合计</span><b>{{ money(totalAmount) }}</b></div>
    </div>
    <div class="layers-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column prop="warehouse_name" label="仓库" width="130"><template #default="{ row }">{{ row.warehouse_name || row.warehouse_code }}</template></el-table-column>
        <el-table-column prop="item_code" label="物料编码" width="120" />
        <el-table-column prop="item_name" label="物料名称" min-width="150" show-overflow-tooltip />
        <el-table-column label="入库日期" width="110"><template #default="{ row }">{{ row.doc_type === 'INIT' ? '期初层' : row.layer_date }}</template></el-table-column>
        <el-table-column label="来源单据" min-width="170"><template #default="{ row }">{{ row.doc_type === 'INIT' ? '切换计价方式前结存' : `${docTitle(row.doc_type)} ${row.doc_no || ''}` }}</template></el-table-column>
        <el-table-column prop="batch_no" label="批次" width="120" show-overflow-tooltip />
        <el-table-column label="入库数量" width="110" align="right"><template #default="{ row }">{{ num(row.qty_in) }}</template></el-table-column>
        <el-table-column label="剩余数量" width="110" align="right"><template #default="{ row }"><span :class="{ exhausted: !Number(row.qty_left) }">{{ num(row.qty_left) }}</span></template></el-table-column>
        <el-table-column label="层单价" width="110" align="right"><template #default="{ row }">{{ price(row.unit_cost) }}</template></el-table-column>
        <el-table-column label="剩余金额" width="120" align="right"><template #default="{ row }">{{ money(row.amount_left) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { DOC_TITLE } from '@/utils/scmDoc'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const router = useRouter()
const loading = ref(false)
const rows = ref<any[]>([])
const warehouses = ref<any[]>([])
const filters = ref({ warehouse_code: '', item_code: '' })
const showExhausted = ref(false)
const costingMethod = ref('moving_avg')
const LABELS: Record<string, string> = { moving_avg: '移动加权平均', month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }
const methodLabel = computed(() => LABELS[costingMethod.value] || costingMethod.value)
const isLayerMethod = computed(() => ['fifo', 'lifo', 'specified'].includes(costingMethod.value))
const totalQty = computed(() => rows.value.reduce((s, r) => s + (Number(r.qty_left) || 0), 0))
const totalAmount = computed(() => rows.value.reduce((s, r) => s + (Number(r.amount_left) || 0), 0))
const { clearFilters } = useFilterClear([filters])
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const price = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const docTitle = (t: string) => (DOC_TITLE as Record<string, string>)[t] || t || ''

function handleClearFilters() { clearFilters(); showExhausted.value = false; load() }
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getStockLayers({ ...filters.value, only_left: showExhausted.value ? '0' : '1' })
    if (r.code === 0) { rows.value = r.data || []; costingMethod.value = (r as any).costing_method || 'moving_avg' }
  } finally { loading.value = false }
}
onMounted(async () => { const w = await scmApi.getWarehouses(); warehouses.value = w.data || []; load() })
</script>

<style scoped>
.layers-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:8px}.report-header__left{display:flex;align-items:center;gap:8px}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.layers-table{flex:1;min-height:220px}.exhausted{color:var(--el-text-color-placeholder)}
</style>
