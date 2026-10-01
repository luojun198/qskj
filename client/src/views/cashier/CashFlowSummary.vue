<template>
  <div class="page page-summary">
    <CashierReportFilter
      ref="filterRef"
      v-model="filter"
      mode="detail"
      allow-all-currencies
      :loading="loading"
      @query="load"
      @clear="handleClear"
    />

    <!-- 汇总维度：任意有序组合（点选顺序 = 分组层级顺序），最多 4 个 -->
    <div class="dim-row">
      <span class="dim-label">汇总维度</span>
      <el-select
        v-model="groupBy"
        multiple collapse-tags collapse-tags-tooltip
        :multiple-limit="4"
        placeholder="选择汇总维度（按选择顺序分层）"
        class="dim-select"
        @change="load"
      >
        <el-option-group label="基础维度">
          <el-option v-for="d in baseDims" :key="d.value" :label="d.label" :value="d.value" />
        </el-option-group>
        <el-option-group v-if="auxDims.length" label="辅助项目（对方科目的辅助核算）">
          <el-option v-for="d in auxDims" :key="d.value" :label="d.label" :value="d.value" />
        </el-option-group>
      </el-select>
      <el-button-group>
        <el-button v-for="p in presets" :key="p.label" size="small" @click="applyPreset(p.dims)">{{ p.label }}</el-button>
        <el-button v-if="auxDims.length" size="small" @click="applyPreset(auxDims.slice(0, 4).map(d => d.value))">按全部辅助类别</el-button>
        <el-button v-if="auxDims.length" size="small" @click="applyPreset(['account', ...auxDims.slice(0, 3).map(d => d.value)])">科目 → 辅助类别</el-button>
      </el-button-group>
    </div>

    <CashierSummaryResult
      :report="report"
      title="资金收支汇总表"
      :subtitle="subtitle"
      :unit-label="unitLabel"
      :dim-label="dimLabel"
      :export-params="toReportPayload(filter)"
      :export-file-name="`资金收支汇总表_${filter.dateRange?.[0] || ''}_${filter.dateRange?.[1] || ''}.xlsx`"
      :filter-api="filterApi"
      @drill="drill"
      @filter-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { cashierApi, type CashierSummaryNode, type CashierSummaryReport } from '@/api/cashier'
import CashierReportFilter from '@/components/cashier/CashierReportFilter.vue'
import CashierSummaryResult from '@/components/cashier/CashierSummaryResult.vue'
import { useCashierSummaryFilters } from '@/composables/useCashierSummaryFilters'
import {
  ALL_CURRENCIES,
  applyDrillPath,
  defaultCashierFilter,
  describeFilter,
  filterFromRouteQuery,
  filterToRouteQuery,
  toReportPayload,
  type CashierReportFilterState,
} from '@/utils/cashierReportFilter'

const DIM_LABELS: Record<string, string> = {
  account: '科目', currency: '币种', year: '年度', month: '月份', day: '日期', settle_type: '结算方式', counter_account: '对方科目',
}
const baseDims = Object.entries(DIM_LABELS).map(([value, label]) => ({ value, label }))
const presets: Array<{ label: string; dims: string[] }> = [
  { label: '按月份', dims: ['month'] },
  { label: '按科目', dims: ['account'] },
  { label: '科目 → 月份', dims: ['account', 'month'] },
  { label: '对方科目', dims: ['counter_account'] },
  { label: '结算方式', dims: ['settle_type'] },
  { label: '按日（日报）', dims: ['day'] },
]

const router = useRouter()
const filterRef = ref<InstanceType<typeof CashierReportFilter>>()
const filter = ref<CashierReportFilterState>(filterFromRouteQuery(router.currentRoute.value.query) || defaultCashierFilter())
// 平铺视图下维度列的表头筛选：映射到上方统一筛选状态，改动后重新汇总
const filterApi = useCashierSummaryFilters(filter, () => filterRef.value as any)
const groupBy = ref<string[]>(['month'])
const report = ref<CashierSummaryReport | null>(null)
const loading = ref(false)

const auxDims = computed(() =>
  (filterRef.value?.meta.aux_categories || []).map(c => ({ value: `aux:${c.id}`, label: `辅助·${c.name}` }))
)
function dimLabel(dim: string): string {
  if (dim.startsWith('aux:')) {
    const cat = filterRef.value?.meta.aux_categories.find(c => c.id === dim.slice(4))
    return `辅助·${cat?.name || dim.slice(4)}`
  }
  return DIM_LABELS[dim] || dim
}

const accountNames = computed(() => Object.fromEntries((filterRef.value?.accounts || []).map(a => [a.code, `${a.code} ${a.name}`])))
const currencyLabel = computed(() => (filter.value.currency === ALL_CURRENCIES ? '全部（折本位币）' : filter.value.currency || filterRef.value?.baseCurrency || 'RMB'))
const subtitle = computed(() => describeFilter(filter.value, { accounts: accountNames.value, currencyLabel: currencyLabel.value }))
const unitLabel = computed(() => {
  const base = report.value?.base_currency || filterRef.value?.baseCurrency || 'RMB'
  return filter.value.currency === ALL_CURRENCIES ? `${base}（本位币折算）` : (filter.value.currency || base)
})

function applyPreset(dims: string[]) {
  groupBy.value = [...dims]
  load()
}

async function load() {
  if (!groupBy.value.length) return ElMessage.warning('请至少选择一个汇总维度')
  loading.value = true
  try {
    const res = await cashierApi.reportSummary({ ...toReportPayload(filter.value), group_by: groupBy.value })
    if (res.code === 0) report.value = res.data
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '汇总失败')
  } finally { loading.value = false }
}

function handleClear() {
  filter.value = defaultCashierFilter()
  groupBy.value = ['month']
  load()
}

/** 钻取：把分组路径叠加到当前筛选条件，进入单据综合查询 */
function drill(node: CashierSummaryNode) {
  router.push({ path: '/cashier/document-query', query: filterToRouteQuery(applyDrillPath(filter.value, node.path)) })
}

onMounted(load)
</script>

<style scoped>
.page-summary { display: flex; flex-direction: column; height: 100%; }
.dim-row { display: flex; align-items: center; gap: 8px; padding: 0; flex-wrap: wrap; }
.dim-label { font-size: 12px; color: var(--el-text-color-secondary); }
.dim-select { width: 360px; max-width: 100%; }
</style>
