<template>
  <div class="page scm-rpt-page">
    <div class="rpt-bar">
      <span class="rpt-title">采购建议</span>
      <span class="rpt-sub">建议量 = 安全库存 − 现存 − 在途（不足起订量按起订量）</span>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      <SaveAsButton title="采购建议" />
      <span class="rpt-hint">共 {{ rows.length }} 项建议</span>
    </div>
    <div class="rpt-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="编号" prop="item_code" width="120" show-overflow-tooltip />
        <el-table-column label="名称" prop="item_name" min-width="160" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="110" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="64" align="center" />
        <el-table-column label="现存" width="90" align="right"><template #default="{ row }">{{ num(row.on_hand) }}</template></el-table-column>
        <el-table-column label="在途" width="90" align="right"><template #default="{ row }">{{ num(row.on_way) }}</template></el-table-column>
        <el-table-column label="安全库存" width="90" align="right"><template #default="{ row }">{{ num(row.safety_stock) }}</template></el-table-column>
        <el-table-column label="起订量" width="80" align="right"><template #default="{ row }">{{ num(row.min_order_qty) }}</template></el-table-column>
        <el-table-column label="建议采购" width="100" align="right"><template #default="{ row }"><b class="rpt-primary">{{ num(row.advice_qty) }}</b></template></el-table-column>
        <el-table-column label="建议供应商" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.supplier_name || row.supplier_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="采购周期(天)" prop="lead_time_days" width="100" align="right" />
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="createPO(row)">生成采购</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
const router = useRouter()
const rows = ref<any[]>([]); const loading = ref(false)
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
async function load() { loading.value = true; try { const r = await scmApi.getPurchaseAdvice(); if (r.code === 0) rows.value = r.data || [] } finally { loading.value = false } }
/** 生成采购：带上物料/建议量/默认供应商到采购订单新增页（§5.3，原来参数完全未使用） */
function createPO(row?: any) {
  const query: Record<string, string> = { doc_type: 'PO' }
  if (row?.item_code) { query.prefill_item = String(row.item_code); if (Number(row.advice_qty) > 0) query.prefill_qty = String(row.advice_qty); if (row.supplier_code) query.prefill_supplier = String(row.supplier_code) }
  router.push({ name: 'ScmDocNew', query })
}
// 从新建采购单返回时重算建议
useReloadOnActivated(() => { load() })
onMounted(load)
</script>

<style scoped>
.scm-rpt-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); }
.rpt-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.rpt-title { font-size: var(--cw-text-lg); font-weight: 600; }
.rpt-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.rpt-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.rpt-body { flex: 1; min-height: 0; }
.rpt-primary { color: var(--el-color-primary); }
</style>
