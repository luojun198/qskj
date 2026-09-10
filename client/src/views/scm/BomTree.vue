<template>
  <div class="page bom-tree-page">
    <!-- 顶部导航条 -->
    <div class="bom-tree-header">
      <div class="bom-tree-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="bom-tree-header__sep">/</span>
        <span class="bom-tree-header__title">BOM 多级展开</span>
        <span v-if="root" class="bom-tree-header__meta">
          {{ data?.bom_code }} · {{ root.item_code }} {{ root.item_name }}
          <span v-if="root.spec" class="bom-tree-header__spec">（{{ root.spec }}）</span>
        </span>
      </div>
      <div class="bom-tree-header__right">
        <span class="bom-tree-qty-label">计划数量</span>
        <el-input-number v-model="qty" :min="0.0001" :precision="2" :controls="false" size="small" style="width:110px" @change="load" />
        <el-button-group>
          <el-button size="small" @click="expandAll">一键展开</el-button>
          <el-button size="small" @click="collapseAll">一键收起</el-button>
        </el-button-group>
      </div>
    </div>

    <!-- 树形表格 -->
    <div class="bom-tree-body">
      <el-table
        ref="tableRef"
        :key="tableKey"
        :data="root ? [root] : []"
        v-loading="loading"
        row-key="key"
        :tree-props="{ children: 'children' }"
        default-expand-all
        border stripe size="small"
        height="100%"
        :row-style="{ height: '30px' }"
        class="bom-tree-table compact-data-table"
      >
        <el-table-column label="物料编号" prop="item_code" min-width="220">
          <template #default="{ row }">
            <span class="bom-code">{{ row.item_code }}</span>
            <el-tag v-if="row.cycle" type="danger" size="small" effect="plain" style="margin-left:6px">循环引用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="名称" prop="item_name" min-width="170" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" min-width="130" show-overflow-tooltip />
        <el-table-column label="性质" width="86" align="center">
          <template #default="{ row }">
            <el-tag :type="natureTag(row).type" size="small" effect="plain">{{ natureTag(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="单件用量" prop="per_qty" width="92" align="right">
          <template #default="{ row }">{{ fmtQty(row.per_qty) }}</template>
        </el-table-column>
        <el-table-column label="累计用量" prop="total_qty" width="100" align="right">
          <template #default="{ row }"><strong>{{ fmtQty(row.total_qty) }}</strong></template>
        </el-table-column>
        <el-table-column label="单位" prop="unit" width="64" align="center" />
        <el-table-column label="损耗%" prop="scrap_rate" width="72" align="right">
          <template #default="{ row }">{{ row.scrap_rate ? row.scrap_rate : '' }}</template>
        </el-table-column>
        <el-table-column label="单件成本" prop="unit_cost" width="100" align="right">
          <template #default="{ row }">{{ fmtMoney(row.unit_cost) }}</template>
        </el-table-column>
        <el-table-column label="金额" prop="amount" width="110" align="right">
          <template #default="{ row }"><span class="bom-amount">{{ fmtMoney(row.amount) }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 底部汇总 -->
    <div v-if="summary" class="bom-tree-summary">
      <span>层级深度 <b>{{ summary.max_level }}</b> 级</span>
      <span>底层物料 <b>{{ summary.leaf_kinds }}</b> 种</span>
      <span class="bom-tree-summary__sep"></span>
      <span>成品单位成本 <b class="money">{{ fmtMoney(summary.unit_cost) }}</b></span>
      <span>计划总成本（×{{ fmtQty(qty) }}） <b class="money money--strong">{{ fmtMoney(summary.total_cost) }}</b></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi, ITEM_TYPES } from '@/api/scm'

const route = useRoute()
const router = useRouter()
const bomId = computed(() => route.params.id as string)

const loading = ref(false)
const qty = ref(1)
const data = ref<any>(null)
const root = computed(() => data.value?.root || null)
const summary = computed(() => data.value?.summary || null)

const tableRef = ref()
// 改 tableKey 强制重建表格，确保 default-expand-all 在新数据上重新应用（用于「一键展开」与换数量重载）
const tableKey = ref(0)

// ── 展开/收起 ───────────────────────────────────────────────
// 收集所有有子节点的装配行（前序：父在前），用 toggleRowExpansion 可靠驱动
function assemblyNodes(): any[] {
  const out: any[] = []
  const walk = (n: any) => { if (n?.children?.length) { out.push(n); n.children.forEach(walk) } }
  if (root.value) walk(root.value)
  return out
}
function expandAll() {
  const t = tableRef.value
  if (!t) return
  for (const n of assemblyNodes()) t.toggleRowExpansion(n, true)
}
function collapseAll() {
  const t = tableRef.value
  if (!t) return
  // 收起除根以外的所有装配行（根保持展开，便于继续往下点）
  for (const n of assemblyNodes()) {
    if (root.value && n.key === root.value.key) continue
    t.toggleRowExpansion(n, false)
  }
}

// ── 加载 ────────────────────────────────────────────────────
async function load() {
  if (!bomId.value) return
  loading.value = true
  try {
    const r = await scmApi.getBomTree(bomId.value, qty.value || 1)
    if (r.code === 0) {
      data.value = r.data
      tableKey.value++   // 重建表格 → default-expand-all 在新数据上铺开
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '加载 BOM 失败')
  } finally {
    loading.value = false
  }
}

// ── 展示辅助 ────────────────────────────────────────────────
function natureTag(row: any): { label: string; type: '' | 'success' | 'info' | 'warning' } {
  if (!row.is_assembly) return { label: '采购件', type: 'info' }
  const t = (ITEM_TYPES as Record<string, string>)[row.item_type]
  if (row.item_type === '9') return { label: t || '成品', type: 'success' }
  return { label: t || '装配件', type: 'warning' }
}
function fmtQty(v: number) {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6)
}
function fmtMoney(v: number) {
  return (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function goBack() {
  router.push('/scm/boms')
}

onMounted(load)
</script>

<style scoped>
.bom-tree-page { display: flex; flex-direction: column; height: 100%; padding: 0; }

.bom-tree-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0; gap: 12px;
}
.bom-tree-header__left { display: flex; align-items: center; gap: 8px; font-size: var(--cw-text-base); min-width: 0; }
.bom-tree-header__sep { color: var(--el-text-color-placeholder); }
.bom-tree-header__title { font-weight: 600; color: var(--el-text-color-primary); white-space: nowrap; }
.bom-tree-header__meta { color: var(--el-text-color-secondary); font-size: var(--cw-text-base); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bom-tree-header__spec { color: var(--el-text-color-placeholder); }
.bom-tree-header__right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.bom-tree-qty-label { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }

.bom-tree-body { flex: 1; min-height: 0; padding: 12px 16px 0; overflow: hidden; }

.bom-code { font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; color: var(--el-color-primary); font-weight: 600; }
.bom-amount { font-weight: 600; }

.compact-data-table :deep(.el-table__cell) { padding: 2px 0; }
.compact-data-table :deep(.cell) { padding: 0 8px; line-height: 26px; }

.bom-tree-summary {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 10px 16px; border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0; font-size: var(--cw-text-base); color: var(--el-text-color-secondary);
}
.bom-tree-summary b { color: var(--el-text-color-primary); }
.bom-tree-summary__sep { flex: 1; }
.bom-tree-summary .money { color: var(--el-color-primary); font-size: var(--cw-text-lg); }
.bom-tree-summary .money--strong { color: var(--el-color-danger); font-size: 16px; }
</style>
