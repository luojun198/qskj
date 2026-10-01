<template>
  <div class="page kit-page">
    <div class="filter-row">
      <span class="title">齐套分析</span>
      <el-radio-group v-model="planType" size="small" @change="load">
        <el-radio-button value="">全部工单</el-radio-button>
        <el-radio-button value="self">自制</el-radio-button>
        <el-radio-button value="outsource">委外</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="mode" size="small" @change="load">
        <el-radio-button value="allocate">按优先级分配</el-radio-button>
        <el-radio-button value="independent">独立核算</el-radio-button>
      </el-radio-group>
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>刷新</el-button>
      <span class="hint">{{ mode === 'allocate' ? '按 优先级 → 计划号 顺序把现有库存依次分配给各工单，后序工单只看分配后余量（多张工单同缺一料时能看出谁真正缺）' : '各工单独立按全量现有库存核算齐套率（单工单可投产判断，不做跨工单库存竞争）' }}</span>
    </div>
    <el-empty v-if="!rows.length && !loading" description="暂无已审核工单" />
    <el-table v-else :data="rows" v-loading="loading" border stripe size="small" height="100%" row-key="plan_id"
      :expand-row-keys="expanded" @expand-change="onExpand">
      <el-table-column type="expand">
        <template #default="{ row }">
          <el-table :data="row.materials" size="small" border class="mat-table">
            <el-table-column label="物料" min-width="150"><template #default="{ row: m }">{{ m.item_code }} {{ m.item_name || '' }}</template></el-table-column>
            <el-table-column label="尚需" width="110" align="right"><template #default="{ row: m }">{{ fmt(m.need) }}</template></el-table-column>
            <el-table-column :label="mode === 'allocate' ? '可分配库存' : '现有库存'" width="110" align="right"><template #default="{ row: m }">{{ fmt(m.available) }}</template></el-table-column>
            <el-table-column label="缺口" width="110" align="right">
              <template #default="{ row: m }"><span :class="{ short: m.shortage > 0 }">{{ fmt(m.shortage) }}</span></template>
            </el-table-column>
            <el-table-column label="齐套率" width="90" align="right"><template #default="{ row: m }">{{ m.rate }}%</template></el-table-column>
          </el-table>
        </template>
      </el-table-column>
      <el-table-column label="工单" min-width="150"><template #default="{ row }">{{ row.plan_code }}</template></el-table-column>
      <el-table-column label="类型" width="80" align="center"><template #default="{ row }">{{ row.plan_type === 'outsource' ? '委外' : '自制' }}</template></el-table-column>
      <el-table-column label="成品" min-width="110" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }}</template></el-table-column>
      <el-table-column label="计划数" width="90" align="right"><template #default="{ row }">{{ fmt(row.plan_qty) }}</template></el-table-column>
      <el-table-column label="缺料种类" width="90" align="right"><template #default="{ row }"><span :class="{ short: row.shortage_kinds > 0 }">{{ row.shortage_kinds }}/{{ row.material_kinds }}</span></template></el-table-column>
      <el-table-column label="齐套率" width="160">
        <template #default="{ row }">
          <el-progress :percentage="row.kitting_rate" :status="row.is_kitted ? 'success' : 'warning'" :stroke-width="14" />
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }"><el-tag size="small" :type="row.is_kitted ? 'success' : 'danger'" effect="plain">{{ row.is_kitted ? '齐套' : '缺料' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="110" align="center">
        <template #default="{ row }">
          <el-button v-if="!row.is_kitted" link type="warning" size="small" @click="goShortage(row)">查看缺料</el-button>
          <el-button link type="primary" size="small" @click="goPlan(row)">工单</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const router = useRouter()
const planType = ref('')
const mode = ref<'independent' | 'allocate'>('allocate')
const rows = ref<any[]>([])
const loading = ref(false)
const expanded = ref<string[]>([])
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

async function load() {
  loading.value = true
  try { const r = await scmApi.getKitting({ plan_type: planType.value || undefined, mode: mode.value }); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function onExpand(_row: any, rowsExp: any[]) { expanded.value = rowsExp.map(r => r.plan_id) }
function goPlan(row: any) { router.push({ name: 'ScmProductionOrder', params: { id: row.plan_id } }) }
function goShortage(row: any) { router.push({ name: 'ScmProductionOrder', params: { id: row.plan_id } }) }
// 从生产工单页返回时刷新
useReloadOnActivated(() => { load() })
onMounted(load)
</script>

<style scoped>
.kit-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
.short { color: var(--el-color-danger); font-weight: 600; }
.mat-table { margin: 4px 12px; width: calc(100% - 24px); }
</style>
