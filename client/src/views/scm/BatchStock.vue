<template>
  <div class="page scm-rpt-page">
    <div class="rpt-bar">
      <span class="rpt-title">批次库存</span>
      <el-input v-model="kw" placeholder="物料编码/名称" size="small" clearable style="width:180px" @keyup.enter="load" />
      <el-input v-model="batchNo" placeholder="批次号" size="small" clearable style="width:140px" @keyup.enter="load" />
      <el-button type="primary" plain size="small" :loading="loading" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <span class="rpt-hint">共 {{ rows.length }} 个批次</span>
    </div>
    <div class="rpt-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="仓库" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code }}</template>
        </el-table-column>
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="批次号" prop="batch_no" width="140" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="60" align="center" />
        <el-table-column label="现存" width="90" align="right"><template #default="{ row }">{{ num(row.qty) }}</template></el-table-column>
        <el-table-column label="生产日期" prop="produce_date" width="110" align="center" />
        <el-table-column label="到期日" prop="expire_date" width="110" align="center" />
        <el-table-column label="剩余天数" width="90" align="right">
          <template #default="{ row }">
            <span v-if="row.expire_date" :class="tagClass(row.days_to_expire)">{{ row.days_to_expire }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
const rows = ref<any[]>([]); const loading = ref(false)
const kw = ref(''); const batchNo = ref('')
const { clearFilters } = useFilterClear([kw, batchNo])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  load()
}
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
const tagClass = (d: number) => Number(d) < 0 ? 'rpt-danger' : Number(d) <= 30 ? 'rpt-warn' : ''
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getBatchStock({ keyword: kw.value || undefined, batch_no: batchNo.value || undefined })
    if (r.code === 0) rows.value = r.data || []
  } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.scm-rpt-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); }
.rpt-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.rpt-title { font-size: var(--cw-text-lg); font-weight: 600; margin-right: 4px; }
.rpt-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.rpt-body { flex: 1; min-height: 0; }
.rpt-danger { color: var(--el-color-danger); font-weight: 600; }
.rpt-warn { color: var(--el-color-warning); font-weight: 600; }
</style>
