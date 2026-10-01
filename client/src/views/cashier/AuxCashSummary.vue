<template>
  <div class="page page-aux-summary">
    <CashierReportFilter
      ref="filterRef"
      v-model="filter"
      mode="detail"
      allow-all-currencies
      :loading="loading"
      @query="load"
      @clear="handleClear"
    />

    <div class="dim-row">
      <span class="dim-label">辅助类别</span>
      <el-select
        v-model="categoryIds"
        multiple collapse-tags collapse-tags-tooltip
        :multiple-limit="4"
        placeholder="选择要汇总的辅助类别，可多选，每个类别一列（流水对方科目的辅助核算）"
        class="dim-select"
        :disabled="!categories.length"
        @change="load"
      >
        <el-option v-for="c in categories" :key="c.id" :label="`${c.name}（${c.item_count} 项 / ${c.journal_count} 笔）`" :value="c.id" />
      </el-select>
      <el-checkbox v-model="expandByAccount" @change="load">按出纳科目展开</el-checkbox>
      <span v-if="!categories.length" class="tip">流水中暂无辅助项目数据，录入日记账时给对方科目选择核算项目后即可统计</span>
    </div>

    <CashierSummaryResult
      :report="report"
      :title="`辅助项目收支表（${categoryName}）`"
      :subtitle="subtitle"
      :unit-label="unitLabel"
      :dim-label="dimLabel"
      :export-params="toReportPayload(filter)"
      :export-file-name="`辅助项目收支表_${categoryName}_${filter.dateRange?.[0] || ''}_${filter.dateRange?.[1] || ''}.xlsx`"
      :filter-api="filterApi"
      @drill="drill"
      @filter-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const router = useRouter()
const filterRef = ref<InstanceType<typeof CashierReportFilter>>()
const filter = ref<CashierReportFilterState>(filterFromRouteQuery(router.currentRoute.value.query) || defaultCashierFilter())
// 平铺视图下维度列的表头筛选：映射到上方统一筛选状态，改动后重新汇总
const filterApi = useCashierSummaryFilters(filter, () => filterRef.value as any)
const categoryIds = ref<string[]>([])
const expandByAccount = ref(false)
const report = ref<CashierSummaryReport | null>(null)
const loading = ref(false)

const categories = computed(() => filterRef.value?.meta.aux_categories || [])
const categoryName = computed(() => categoryIds.value.map(id => categories.value.find(c => c.id === id)?.name || id).join('、'))

// 元数据加载完成后默认选第一个类别并查询
watch(categories, list => {
  if (list.length && !categoryIds.value.length) {
    categoryIds.value = [list[0].id]
    load()
  }
}, { immediate: true })

function dimLabel(dim: string) {
  if (dim.startsWith('aux:')) return categories.value.find(c => c.id === dim.slice(4))?.name || '辅助项目'
  return dim === 'account' ? '科目' : dim
}

const accountNames = computed(() => Object.fromEntries((filterRef.value?.accounts || []).map(a => [a.code, `${a.code} ${a.name}`])))
const currencyLabel = computed(() => (filter.value.currency === ALL_CURRENCIES ? '全部（折本位币）' : filter.value.currency || filterRef.value?.baseCurrency || 'RMB'))
const subtitle = computed(() => describeFilter(filter.value, { accounts: accountNames.value, currencyLabel: currencyLabel.value }))
const unitLabel = computed(() => {
  const base = report.value?.base_currency || filterRef.value?.baseCurrency || 'RMB'
  return filter.value.currency === ALL_CURRENCIES ? `${base}（本位币折算）` : (filter.value.currency || base)
})

async function load() {
  if (!categoryIds.value.length) return
  loading.value = true
  try {
    // 每个选中的辅助类别作为一个汇总维度（平铺视图下一类别一列），可再按出纳科目展开
    const groupBy = [...categoryIds.value.map(id => `aux:${id}`), ...(expandByAccount.value ? ['account'] : [])]
    const res = await cashierApi.reportSummary({ ...toReportPayload(filter.value), group_by: groupBy })
    if (res.code === 0) report.value = res.data
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '汇总失败')
  } finally { loading.value = false }
}

function handleClear() {
  filter.value = defaultCashierFilter()
  expandByAccount.value = false
  load()
}

function drill(node: CashierSummaryNode) {
  router.push({ path: '/cashier/document-query', query: filterToRouteQuery(applyDrillPath(filter.value, node.path)) })
}
</script>

<style scoped>
.page-aux-summary { display: flex; flex-direction: column; height: 100%; }
.dim-row { display: flex; align-items: center; gap: 12px; padding: 0; flex-wrap: wrap; }
.dim-label { font-size: 12px; color: var(--el-text-color-secondary); }
.dim-select { width: 380px; max-width: 100%; }
.tip { font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
