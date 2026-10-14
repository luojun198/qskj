<template>
  <div class="page scm-rpt-page">
    <div class="rpt-bar">
      <span class="rpt-title">批次临期预警</span>
      <span class="rpt-sub">提前</span>
      <el-input-number v-model="days" :min="0" :precision="0" :controls="false" size="small" style="width:80px" @change="load" />
      <span class="rpt-sub">天内到期 / 已过期</span>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      <SaveAsButton title="批次效期预警" />
      <span class="rpt-hint">共 {{ rows.length }} 个批次（含已过期 {{ expiredCount }}）</span>
    </div>
    <div class="rpt-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="仓库" min-width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code }}</template>
        </el-table-column>
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="批次号" prop="batch_no" width="140" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="60" align="center" />
        <el-table-column label="现存" width="90" align="right"><template #default="{ row }">{{ num(row.qty) }}</template></el-table-column>
        <el-table-column label="生产日期" prop="produce_date" width="110" align="center" />
        <el-table-column label="到期日" prop="expire_date" width="110" align="center" />
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.expired" type="danger" size="small">已过期 {{ -row.days_to_expire }} 天</el-tag>
            <el-tag v-else type="warning" size="small" effect="plain">{{ row.days_to_expire }} 天后到期</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
const rows = ref<any[]>([]); const loading = ref(false); const days = ref(30)
const expiredCount = computed(() => rows.value.filter(r => r.expired).length)
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getBatchAlert({ days: days.value })
    if (r.code === 0) rows.value = r.data || []
  } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.scm-rpt-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); }
.rpt-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.rpt-title { font-size: var(--cw-text-lg); font-weight: 600; margin-right: 4px; }
.rpt-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.rpt-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.rpt-body { flex: 1; min-height: 0; }
</style>
