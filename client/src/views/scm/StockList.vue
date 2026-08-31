<template>
  <div class="page scm-stock-page">
    <Teleport v-if="ptActive" defer to="#tabbar-actions">
      <el-button size="small" plain @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
    </Teleport>
    <!-- 筛选行：关键字 / 仓库 + 查询维度（是否分仓 / 是否分批号） -->
    <div class="filter-row">
      <el-input v-model="keyword" placeholder="物料编号/名称" clearable size="small" style="width: 220px" @keyup.enter="load" @clear="load">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-select v-model="warehouse" placeholder="全部仓库" clearable filterable size="small" style="width: 180px" :disabled="!splitWarehouse" @change="load">
        <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-button type="primary" size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <span class="filter-dim">
        <span class="filter-dim__label">分仓</span>
        <el-switch v-model="splitWarehouse" size="small" @change="onSplitWarehouseChange" />
      </span>
      <span class="filter-dim">
        <span class="filter-dim__label">分批号</span>
        <el-switch v-model="splitBatch" size="small" @change="onSplitBatchChange" />
      </span>
    </div>
    <el-table ref="tableRef" :data="tableData" v-loading="loading" border stripe size="small" max-height="calc(100vh - 240px)"
      :row-class-name="rowClass" empty-text="暂无库存（可通过采购入库/期初库存产生）"
      @row-dblclick="openStockLedger" @header-dragend="onDragEnd">
      <template v-for="column in orderedVisibleColumns" :key="column.key">
      <el-table-column v-if="column.key === 'warehouse'" label="仓库" column-key="warehouse" :width="cw('warehouse', 130)">
        <template #default="{ row }">{{ row.warehouse_code }} {{ row.warehouse_name || '' }}</template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'item_code'" label="物料编号" prop="item_code" :width="cw('item_code', 120)" />
      <el-table-column v-else-if="column.key === 'item_name'" label="名称" prop="item_name" min-width="140" :width="widths.item_name" show-overflow-tooltip />
      <el-table-column v-else-if="column.key === 'spec'" label="规格" prop="spec" :width="cw('spec', 120)" show-overflow-tooltip />
      <el-table-column v-else-if="column.key === 'unit'" label="单位" prop="unit" :width="cw('unit', 70)" />
      <el-table-column v-else-if="column.key === 'batch_no'" label="批号" prop="batch_no" :width="cw('batch_no', 130)" show-overflow-tooltip />
      <el-table-column v-else-if="column.key === 'produce_date'" label="生产日期" prop="produce_date" :width="cw('produce_date', 110)" />
      <el-table-column v-else-if="column.key === 'expire_date'" label="到期日" prop="expire_date" :width="cw('expire_date', 130)">
        <template #default="{ row }">
          <span v-if="row.expire_date">
            {{ row.expire_date }}
            <el-tag v-if="row.days_to_expire != null" :type="row.days_to_expire < 0 ? 'danger' : (row.days_to_expire <= 30 ? 'warning' : 'info')" size="small" effect="plain" style="margin-left:4px">
              {{ row.days_to_expire < 0 ? '已过期' : row.days_to_expire + '天' }}
            </el-tag>
          </span>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'qty'" label="数量" prop="qty" :width="cw('qty', 110)" align="right">
        <template #default="{ row }">
          <span :class="{ 'negative-number': isNegative(row.qty) }">{{ fmt(row.qty) }}</span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'unshipped_sales_qty'" label="销售未出货" prop="unshipped_sales_qty" :width="cw('unshipped_sales_qty', 120)" align="right">
        <template #header>
          销售未出货
          <el-tooltip content="已审核销售订单中尚未下推发货的数量" placement="top">
            <el-icon style="margin-left: 4px; cursor: help"><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span :style="{ color: row.unshipped_sales_qty > 0 ? '#e6a23c' : 'inherit' }">
            {{ fmt(row.unshipped_sales_qty) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'unreceived_purchase_qty'" label="采购未入库" prop="unreceived_purchase_qty" :width="cw('unreceived_purchase_qty', 120)" align="right">
        <template #header>
          采购未入库
          <el-tooltip content="已审核采购订单中尚未下推入库的数量" placement="top">
            <el-icon style="margin-left: 4px; cursor: help"><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span :style="{ color: row.unreceived_purchase_qty > 0 ? '#e6a23c' : 'inherit' }">
            {{ fmt(row.unreceived_purchase_qty) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'unissued_plan_qty'" label="计划未领用" prop="unissued_plan_qty" :width="cw('unissued_plan_qty', 120)" align="right">
        <template #header>
          计划未领用
          <el-tooltip content="已审核生产/委外计划按BOM应领材料 − 已领材料" placement="top">
            <el-icon style="margin-left: 4px; cursor: help"><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span :style="{ color: row.unissued_plan_qty > 0 ? '#e6a23c' : 'inherit' }">
            {{ fmt(row.unissued_plan_qty) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'unfinished_plan_qty'" label="计划未入库" prop="unfinished_plan_qty" :width="cw('unfinished_plan_qty', 120)" align="right">
        <template #header>
          计划未入库
          <el-tooltip content="已审核生产/委外计划的计划数 − 已完工入库数" placement="top">
            <el-icon style="margin-left: 4px; cursor: help"><InfoFilled /></el-icon>
          </el-tooltip>
        </template>
        <template #default="{ row }">
          <span :style="{ color: row.unfinished_plan_qty > 0 ? '#e6a23c' : 'inherit' }">
            {{ fmt(row.unfinished_plan_qty) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'amount'" label="金额" prop="amount" :width="cw('amount', 120)" align="right">
        <template #default="{ row }">
          <span :class="{ 'negative-number': isNegative(row.amount) }">{{ fmt(row.amount) }}</span>
        </template>
      </el-table-column>
      <el-table-column v-else-if="column.key === 'avg_cost'" label="平均成本" prop="avg_cost" :width="cw('avg_cost', 110)" align="right">
        <template #default="{ row }">{{ row.__summary ? '' : fmt(row.avg_cost, 4) }}</template>
      </el-table-column>
      </template>
    </el-table>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettings" @update:columns="updateColumns" @reset="resetColumns" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, InfoFilled, Setting } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { ptActive } = usePageToolbarTeleport()
const router = useRouter()
const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_stock')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

// ── 自定义显示列（勾选状态记忆到 localStorage）──
const allColumns: ColumnSetting[] = [
  { key: 'warehouse', label: '仓库', visible: true },
  { key: 'item_code', label: '物料编号', visible: true, required: true },
  { key: 'item_name', label: '名称', visible: true, required: true },
  { key: 'spec', label: '规格', visible: true },
  { key: 'unit', label: '单位', visible: true },
  { key: 'batch_no', label: '批号', visible: true, group: '批次视图' },
  { key: 'produce_date', label: '生产日期', visible: true, group: '批次视图' },
  { key: 'expire_date', label: '到期日', visible: true, group: '批次视图' },
  { key: 'qty', label: '数量', visible: true },
  { key: 'unshipped_sales_qty', label: '销售未出货', visible: true },
  { key: 'unreceived_purchase_qty', label: '采购未入库', visible: true },
  { key: 'unissued_plan_qty', label: '计划未领用', visible: true },
  { key: 'unfinished_plan_qty', label: '计划未入库', visible: true },
  { key: 'amount', label: '金额', visible: true },
  { key: 'avg_cost', label: '平均成本', visible: true },
]
const STORAGE_KEY_COLS = 'scm_stock_columns_visible'
const columnDialogVisible = ref(false)
const columnSettings = ref<ColumnSetting[]>(loadColumnSettings(STORAGE_KEY_COLS, allColumns))
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => {
  if (!column.visible) return false
  if (column.key === 'warehouse') return splitWarehouse.value
  if (['batch_no', 'produce_date', 'expire_date'].includes(column.key)) return splitBatch.value
  if (['unshipped_sales_qty', 'unreceived_purchase_qty', 'unissued_plan_qty', 'unfinished_plan_qty', 'avg_cost'].includes(column.key)) return !splitBatch.value
  return true
}))
function updateColumns(columns: ColumnSetting[]) {
  columnSettings.value = columns
  saveColumnSettings(STORAGE_KEY_COLS, columns)
}
function resetColumns() {
  updateColumns(allColumns.map(column => ({ ...column })))
}

const list = ref<any[]>([])
const warehouses = ref<any[]>([])
const loading = ref(false)
const keyword = ref('')
const warehouse = ref('')

// ── 查询维度：是否分仓 / 是否分批号（默认 分仓、不分批 = 原行为；状态记忆 localStorage）──
const STORAGE_KEY_DIM = 'scm_stock_dimensions'
const splitWarehouse = ref(true)
const splitBatch = ref(false)
;(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_DIM) || '{}')
    if (typeof saved.splitWarehouse === 'boolean') splitWarehouse.value = saved.splitWarehouse
    if (typeof saved.splitBatch === 'boolean') splitBatch.value = saved.splitBatch
  } catch { /* 用默认 */ }
})()
function saveDimensions() {
  localStorage.setItem(STORAGE_KEY_DIM, JSON.stringify({ splitWarehouse: splitWarehouse.value, splitBatch: splitBatch.value }))
}
function onSplitWarehouseChange() {
  if (!splitWarehouse.value) warehouse.value = ''  // 不分仓时清掉仓库筛选（跨仓汇总）
  saveDimensions(); load()
}
function onSplitBatchChange() { saveDimensions(); load() }

const fmt = (v: number, p = 2) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: p, maximumFractionDigits: p })
const isNegative = (v: number) => Number(v || 0) < 0
const r6 = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6

// 合计行：作为表体最后一行（水平滚动条落在合计行下方）。仅有数据时追加。
const summaryRow = computed<any>(() => {
  const sum = (k: string) => list.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  return {
    __summary: true,
    warehouse_code: splitWarehouse.value ? '合计' : '', warehouse_name: '',
    item_code: splitWarehouse.value ? '' : '合计', item_name: '', spec: '', unit: '',
    batch_no: '', produce_date: '', expire_date: '', days_to_expire: null, avg_cost: null,
    qty: sum('qty'), amount: sum('amount'),
    unshipped_sales_qty: sum('unshipped_sales_qty'), unreceived_purchase_qty: sum('unreceived_purchase_qty'),
    unissued_plan_qty: sum('unissued_plan_qty'), unfinished_plan_qty: sum('unfinished_plan_qty'),
  }
})
const tableData = computed(() => list.value.length ? [...list.value, summaryRow.value] : list.value)
const rowClass = ({ row }: { row: any }) => (row.__summary ? 'doc-line-summary' : 'stock-ledger-row')

function openStockLedger(row: any) {
  if (!row?.item_code || row.__summary) return
  const query: Record<string, string> = { item_code: String(row.item_code), full_history: '1' }
  if (splitWarehouse.value && row.warehouse_code) query.warehouse_code = String(row.warehouse_code)
  router.push({ name: 'ScmStockLedger', query })
}

/** 不分仓：库存行（scm_stock）按物料跨仓汇总，四项指标一并求和，平均成本按金额/数量重算 */
function aggregateByItem(rows: any[]): any[] {
  const map = new Map<string, any>()
  for (const r of rows) {
    const k = r.item_code
    let g = map.get(k)
    if (!g) {
      g = { item_code: r.item_code, item_name: r.item_name, spec: r.spec, unit: r.unit, warehouse_code: '', warehouse_name: '',
        qty: 0, amount: 0, avg_cost: 0, unshipped_sales_qty: 0, unreceived_purchase_qty: 0, unissued_plan_qty: 0, unfinished_plan_qty: 0 }
      map.set(k, g)
    }
    g.qty = r6(g.qty + (Number(r.qty) || 0))
    g.amount = r6(g.amount + (Number(r.amount) || 0))
    g.unshipped_sales_qty = r6(g.unshipped_sales_qty + (Number(r.unshipped_sales_qty) || 0))
    g.unreceived_purchase_qty = r6(g.unreceived_purchase_qty + (Number(r.unreceived_purchase_qty) || 0))
    g.unissued_plan_qty = r6(g.unissued_plan_qty + (Number(r.unissued_plan_qty) || 0))
    g.unfinished_plan_qty = r6(g.unfinished_plan_qty + (Number(r.unfinished_plan_qty) || 0))
  }
  for (const g of map.values()) g.avg_cost = g.qty ? r6(g.amount / g.qty) : 0
  return [...map.values()]
}

/** 不分仓：批次行（scm_stock_batch）按物料+批号跨仓汇总；日期取代表值，到期天数重算 */
function aggregateByItemBatch(rows: any[]): any[] {
  const map = new Map<string, any>()
  for (const r of rows) {
    const k = `${r.item_code}|${r.batch_no || ''}`
    let g = map.get(k)
    if (!g) {
      g = { item_code: r.item_code, item_name: r.item_name, spec: r.spec, unit: r.unit, warehouse_code: '', warehouse_name: '',
        batch_no: r.batch_no, produce_date: r.produce_date || '', expire_date: r.expire_date || '', days_to_expire: r.days_to_expire,
        qty: 0, amount: 0 }
      map.set(k, g)
    }
    g.qty = r6(g.qty + (Number(r.qty) || 0))
    g.amount = r6(g.amount + (Number(r.amount) || 0))
    if (!g.produce_date && r.produce_date) g.produce_date = r.produce_date
    // 到期日取最早（更保守）
    if (r.expire_date && (!g.expire_date || r.expire_date < g.expire_date)) {
      g.expire_date = r.expire_date; g.days_to_expire = r.days_to_expire
    }
  }
  return [...map.values()]
}

async function load() {
  loading.value = true
  try {
    const wh = splitWarehouse.value ? (warehouse.value || undefined) : undefined
    if (splitBatch.value) {
      const res = await scmApi.getBatchStock({ keyword: keyword.value || undefined, warehouse_code: wh })
      if (res.code === 0) list.value = splitWarehouse.value ? res.data : aggregateByItemBatch(res.data)
    } else {
      const res = await scmApi.getStock({ keyword: keyword.value || undefined, warehouse_code: wh })
      if (res.code === 0) list.value = splitWarehouse.value ? res.data : aggregateByItem(res.data)
    }
  } finally { loading.value = false }
}

onMounted(async () => {
  const w = await scmApi.getWarehouses()
  if (w.code === 0) warehouses.value = w.data
  load()
})
</script>

<style scoped>
.scm-stock-page { padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.filter-dim { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; }
.filter-dim__label { font-size: 13px; color: var(--el-text-color-regular); }
.negative-number {
  color: var(--el-color-danger);
  font-weight: 600;
}
/* 合计行（表体最后一行）：加粗 + 浅底，水平滚动条落在其下方 */
.scm-stock-page :deep(.doc-line-summary) { font-weight: 600; }
.scm-stock-page :deep(.doc-line-summary td.el-table__cell) { background: var(--el-fill-color-light); }
.scm-stock-page :deep(.stock-ledger-row) { cursor: pointer; }
</style>
