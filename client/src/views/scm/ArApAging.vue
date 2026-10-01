<template>
  <div class="page scm-aging-page">
    <div class="filter-row">
      <span class="lbl">截止日期</span>
      <el-date-picker v-model="asOfDate" type="date" value-format="YYYY-MM-DD" placeholder="截止日期" style="width:150px" size="small" />
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <span class="total-hint">共 {{ rows.length }} 个往来单位</span>
    </div>

    <div class="page-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" show-summary :summary-method="summary"
        @row-click="goLedger">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column label="往来单位" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.partner_type === 'customer' ? 'success' : 'warning'">
              {{ partnerTypeLabel(row.partner_type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="130" align="right">
          <template #default="{ row }"><b>{{ fmt(row.balance) }}</b></template>
        </el-table-column>
        <el-table-column label="未到期" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.not_due) }}</template>
        </el-table-column>
        <el-table-column label="逾期≤30天" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.current) }}</template>
        </el-table-column>
        <el-table-column label="31-60天" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.d30) }}</template>
        </el-table-column>
        <el-table-column label="61-90天" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.d60) }}</template>
        </el-table-column>
        <el-table-column label="90天以上" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.over90) }}</template>
        </el-table-column>
        <el-table-column label="" min-width="60" align="center">
          <template #default><el-link type="primary" :underline="false">对账</el-link></template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const router = useRouter()
const asOfDate = ref('')
const loading = ref(false)
const rows = ref<any[]>([])
const { clearFilters } = useFilterClear([asOfDate])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  load()
}

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function partnerTypeLabel(t: string) { return t === 'customer' ? '客户' : t === 'supplier' ? '供应商' : (t || '-') }

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getArApAging({ as_of_date: asOfDate.value || undefined })
    if (r.code === 0) rows.value = r.data || []
  } finally {
    loading.value = false
  }
}

function goLedger(row: any) {
  router.push({ name: 'ScmPartnerLedger', query: { partner_code: row.partner_code } })
}

function summary({ columns }: { columns: any[] }) {
  const out: string[] = []
  const keys = [null, null, null, 'balance', 'not_due', 'current', 'd30', 'd60', 'over90', null]
  columns.forEach((_c, i) => {
    if (i === 0) { out[i] = '合计'; return }
    const key = keys[i]
    if (!key) { out[i] = ''; return }
    const sum = rows.value.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    out[i] = fmt(sum)
  })
  return out
}

onMounted(load)
</script>

<style scoped>
.scm-aging-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.filter-row .lbl { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.total-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.page-body { flex: 1; min-height: 0; }
.page-body :deep(.el-table__row) { cursor: pointer; }
</style>
