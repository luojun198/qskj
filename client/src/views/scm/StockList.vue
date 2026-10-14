<template>
  <div class="page scm-stock-page">
    <Teleport v-if="ptActive" defer to="#tabbar-actions">
      <MultiSortPanel :options="sortOptions" :model-value="effectiveSortKeys" :default-keys="[]" @change="onSortChanged" />
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
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <span class="filter-dim">
        <span class="filter-dim__label">分仓</span>
        <el-switch v-model="splitWarehouse" size="small" @change="onSplitWarehouseChange" />
      </span>
      <span class="filter-dim">
        <span class="filter-dim__label">分批号</span>
        <el-switch v-model="splitBatch" size="small" @change="onSplitBatchChange" />
      </span>
      <!-- 第六份反馈：库存为零时不显示 -->
      <span class="filter-dim">
        <el-checkbox v-model="hideZero" size="small" @change="saveDimensions">隐藏零库存</el-checkbox>
      </span>
      <span class="filter-spacer" />
      <el-button size="small" :disabled="!list.length" :loading="exporting" @click="exportExcel"><el-icon><Download /></el-icon>另存</el-button>
      <el-button size="small" :disabled="!list.length" @click="printList"><el-icon><Printer /></el-icon>打印</el-button>
    </div>
    <div class="page-table-fill">
      <el-table ref="tableRef" :data="tableData" v-loading="loading" border stripe size="small" class="compact-data-table" height="100%"
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
            <span :class="{ 'negative-number': isNegative(row.qty) }">{{ qtyF(row.qty) }}</span>
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
              {{ qtyF(row.unshipped_sales_qty) }}
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
              {{ qtyF(row.unreceived_purchase_qty) }}
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
              {{ qtyF(row.unissued_plan_qty) }}
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
              {{ qtyF(row.unfinished_plan_qty) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'amount'" label="金额" prop="amount" :width="cw('amount', 120)" align="right">
          <template #default="{ row }">
            <span :class="{ 'negative-number': isNegative(row.amount) }">{{ amtF(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'avg_cost'" label="平均成本" prop="avg_cost" :width="cw('avg_cost', 110)" align="right">
          <template #default="{ row }">{{ row.__summary ? '' : priceF(row.avg_cost) }}</template>
        </el-table-column>
        </template>
      </el-table>
    </div>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettings" @update:columns="updateColumns" @reset="resetColumns" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRouter } from 'vue-router'
import { Search, InfoFilled, Setting, Download, Printer } from '@element-plus/icons-vue'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { printSimpleTable } from '@/utils/printSimpleTable'
import { scmApi } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import MultiSortPanel from '@/components/common/MultiSortPanel.vue'
import { loadSortKeys, normalizeSortKeys, saveSortKeys, sortRows, type SortKey } from '@/utils/multiSort'
import { useFilterClear } from '@/composables/useFilterClear'
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
// 当前「分仓 / 分批」维度下该列是否存在
const columnAvailable = (key: string) => {
  if (key === 'warehouse') return splitWarehouse.value
  if (['batch_no', 'produce_date', 'expire_date'].includes(key)) return splitBatch.value
  if (['unshipped_sales_qty', 'unreceived_purchase_qty', 'unissued_plan_qty', 'unfinished_plan_qty', 'avg_cost'].includes(key)) return !splitBatch.value
  return true
}
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => column.visible && columnAvailable(column.key)))

// ── 多级排序（第一排序 / 第二排序 / …）：库存数据一次取全量并在前端聚合，所以在前端排序；合计行始终在末尾 ──
const SORT_STORAGE_KEY = 'scm_stock_sort'
const sortOptions = computed(() => columnSettings.value.filter(c => columnAvailable(c.key)).map(c => ({ key: c.key, label: c.label })))
const sortKeysState = ref<SortKey[] | null>(null)
// 分仓 / 分批切换后，当前维度不存在的列自动跳过（不丢设置）
const effectiveSortKeys = computed<SortKey[]>(() => normalizeSortKeys(sortKeysState.value ?? loadSortKeys(SORT_STORAGE_KEY) ?? [], sortOptions.value.map(o => o.key)))
function onSortChanged(keys: SortKey[]) {
  sortKeysState.value = keys
  saveSortKeys(SORT_STORAGE_KEY, keys)
}
function stockSortAccessor(key: string): (row: any) => unknown {
  if (key === 'warehouse') return row => row.warehouse_code
  return row => row[key]
}
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
const { clearFilters } = useFilterClear([keyword, warehouse])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  load()
}

// ── 查询维度：是否分仓 / 是否分批号（默认 分仓、不分批 = 原行为；状态记忆 localStorage）──
const STORAGE_KEY_DIM = 'scm_stock_dimensions'
const splitWarehouse = ref(true)
const splitBatch = ref(false)
const hideZero = ref(false)
;(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_DIM) || '{}')
    if (typeof saved.splitWarehouse === 'boolean') splitWarehouse.value = saved.splitWarehouse
    if (typeof saved.splitBatch === 'boolean') splitBatch.value = saved.splitBatch
    if (typeof saved.hideZero === 'boolean') hideZero.value = saved.hideZero
  } catch { /* 用默认 */ }
})()
function saveDimensions() {
  try {
    localStorage.setItem(STORAGE_KEY_DIM, JSON.stringify({ splitWarehouse: splitWarehouse.value, splitBatch: splitBatch.value, hideZero: hideZero.value }))
  } catch { /* 隐私模式等写不进去时只影响记忆 */ }
}
function onSplitWarehouseChange() {
  if (!splitWarehouse.value) warehouse.value = ''  // 不分仓时清掉仓库筛选（跨仓汇总）
  saveDimensions(); load()
}
function onSplitBatchChange() { saveDimensions(); load() }

const fmt = (v: number, p = 2) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: p, maximumFractionDigits: p })
// 小数位：系统参数 → 供应链 → 小数位设置 →「当前库存」
const decStore = useScmDecimalsStore()
void decStore.load()
const qtyF = (v: any) => decStore.qty(Number(v) || 0, 'stock')
const amtF = (v: any) => decStore.amount(Number(v) || 0, 'stock')
const priceF = (v: any) => decStore.price(Number(v) || 0, 'stock')
const numF = (key: string, v: any) => (key === 'amount' ? amtF(v) : key === 'avg_cost' ? priceF(v) : qtyF(v))
const isNegative = (v: number) => Number(v || 0) < 0
const r6 = (v: number) => Math.round((Number(v) || 0) * 1e6) / 1e6

// 隐藏零库存：数量、金额都为 0 的行不显示（合计、另存、打印同口径）
const visibleList = computed(() => hideZero.value
  ? list.value.filter(r => Math.abs(Number(r.qty) || 0) > 1e-9 || Math.abs(Number(r.amount) || 0) >= 0.005)
  : list.value)

// 合计行：作为表体最后一行（水平滚动条落在合计行下方）。仅有数据时追加。
const summaryRow = computed<any>(() => {
  const sum = (k: string) => visibleList.value.reduce((s, r) => s + (Number(r[k]) || 0), 0)
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
const sortedList = computed(() => sortRows(visibleList.value, effectiveSortKeys.value, stockSortAccessor))
const tableData = computed(() => visibleList.value.length ? [...sortedList.value, summaryRow.value] : visibleList.value)
const rowClass = ({ row }: { row: any }) => (row.__summary ? 'doc-line-summary' : 'stock-ledger-row')

// ── 导出 / 打印：按当前显示列、排序和筛选输出（客户反馈：库存查询无另存、无打印）──
const NUMERIC_COLS: Record<string, number> = {
  qty: 2, unshipped_sales_qty: 2, unreceived_purchase_qty: 2, unissued_plan_qty: 2, unfinished_plan_qty: 2, amount: 2, avg_cost: 4,
}
function stockCellValue(row: any, key: string): string | number {
  if (key === 'warehouse') return row.__summary ? row.warehouse_code : `${row.warehouse_code || ''} ${row.warehouse_name || ''}`.trim()
  if (key === 'avg_cost' && row.__summary) return ''
  const v = row[key]
  return v === null || v === undefined ? '' : v
}
const outputColumns = computed(() => orderedVisibleColumns.value.map(c => ({ key: c.key, label: c.label, numeric: c.key in NUMERIC_COLS })))
const outputSubtitle = computed(() => {
  const wh = warehouse.value ? (warehouses.value.find(w => w.code === warehouse.value)?.name || warehouse.value) : '全部仓库'
  return [splitWarehouse.value ? wh : '不分仓', splitBatch.value ? '分批号' : '', hideZero.value ? '不含零库存' : '', keyword.value ? `关键字：${keyword.value}` : '']
    .filter(Boolean).join('　')
})
const exporting = ref(false)
async function exportExcel() {
  exporting.value = true
  try {
    const columns: ExportColumnDef[] = outputColumns.value.map(c => ({
      label: c.label,
      width: c.key === 'item_name' ? 24 : c.numeric ? 13 : 14,
      type: c.numeric ? (c.key === 'amount' ? 'amount' : 'number') : 'text',
      align: c.numeric ? 'right' : 'left',
      value: (row: any) => stockCellValue(row, c.key),
    }))
    const summary = summaryRow.value
    await exportStyledTable({
      fileName: '库存查询',
      title: '库存查询',
      subtitle: outputSubtitle.value,
      columns,
      rows: sortedList.value,
      summaryValues: outputColumns.value.map((c, i) => (i === 0 ? '合计' : c.numeric && c.key !== 'avg_cost' ? summary[c.key] : '')),
    })
  } finally { exporting.value = false }
}
function printList() {
  const summary = summaryRow.value
  printSimpleTable({
    title: '库存查询',
    subtitle: outputSubtitle.value,
    columns: outputColumns.value.map(c => ({
      label: c.label,
      align: c.numeric ? 'right' as const : 'left' as const,
      value: (row: any) => {
        const v = stockCellValue(row, c.key)
        return c.numeric && v !== '' ? numF(c.key, v) : v
      },
    })),
    rows: sortedList.value,
    summary: outputColumns.value.map((c, i) => (i === 0 ? '合计' : c.numeric && c.key !== 'avg_cost' ? numF(c.key, Number(summary[c.key]) || 0) : '')),
  })
}

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

// 从库存台账 / 单据页返回时刷新
useReloadOnActivated(() => { load() })
onMounted(async () => {
  const w = await scmApi.getWarehouses()
  if (w.code === 0) warehouses.value = w.data
  load()
})
</script>

<style scoped>
.filter-spacer { flex: 1; }
.scm-stock-page { padding: var(--page-pad); height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.filter-dim { display: inline-flex; align-items: center; gap: 4px; margin-left: 8px; }
.filter-dim__label { font-size: var(--cw-text-base); color: var(--el-text-color-regular); }
.negative-number {
  color: var(--el-color-danger);
  font-weight: 600;
}
/* 合计行（表体最后一行）：加粗 + 浅底，水平滚动条落在其下方 */
.scm-stock-page :deep(.stock-ledger-row) { cursor: pointer; }
</style>
