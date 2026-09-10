<template>
  <div class="page scm-rpt-page">
    <div class="rpt-bar">
      <span class="rpt-title">库存预警</span>
      <span class="rpt-sub">现存量低于安全库存的物料</span>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      <span class="rpt-hint">共 {{ rows.length }} 项预警</span>
    </div>
    <div class="rpt-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="120" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="70" align="center" />
        <el-table-column label="现存量" width="110" align="right">
          <template #default="{ row }"><span :class="{ 'rpt-danger': row.on_hand <= 0 }">{{ num(row.on_hand) }}</span></template>
        </el-table-column>
        <el-table-column label="安全库存" width="110" align="right"><template #default="{ row }">{{ num(row.safety_stock) }}</template></el-table-column>
        <el-table-column label="缺口" width="110" align="right"><template #default="{ row }"><b class="rpt-danger">{{ num(row.shortage) }}</b></template></el-table-column>
        <el-table-column label="建议供应商" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.supplier_name || row.supplier_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购周期(天)" prop="lead_time_days" width="110" align="right" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
const rows = ref<any[]>([]); const loading = ref(false)
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
async function load() { loading.value = true; try { const r = await scmApi.getStockAlert(); if (r.code === 0) rows.value = r.data || [] } finally { loading.value = false } }
onMounted(load)
</script>

<style scoped>
.scm-rpt-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.rpt-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.rpt-title { font-size: var(--cw-text-lg); font-weight: 600; }
.rpt-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.rpt-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.rpt-body { flex: 1; min-height: 0; }
.rpt-danger { color: var(--el-color-danger); }
</style>
