<template>
  <div class="page scm-pp-page">

    <div class="filter-row" style="margin-bottom: 8px;">
      <el-button type="primary" size="small" :loading="openingNew" @click="openAdd"><el-icon><Plus /></el-icon>新增{{ pageLabel }}</el-button>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <el-button size="small" @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
      <template v-if="selection.length">
        <el-divider direction="vertical" />
        <span class="selection-hint">已选 {{ selection.length }} 张</span>
        <el-button size="small" :disabled="!actionState.order.enabled" :title="actionState.order.reason" @click="openOrder(selectedRow)">工单</el-button>
        <el-button size="small" :disabled="!actionState.edit.enabled" :title="actionState.edit.reason" @click="openEdit(selectedRow)">编辑</el-button>
        <el-button size="small" type="danger" plain :disabled="!actionState.delete.enabled" :title="actionState.delete.reason" @click="runBatchAction('delete')">删除草稿</el-button>
        <el-button size="small" type="warning" plain :disabled="!actionState.unrelease.enabled" :title="actionState.unrelease.reason" @click="runBatchAction('unrelease')">反审核</el-button>
        <el-button size="small" type="warning" :disabled="!actionState.reopen.enabled" :title="actionState.reopen.reason" @click="runBatchAction('reopen')">重开</el-button>
        <el-button size="small" :disabled="!actionState.trace.enabled" :title="actionState.trace.reason" @click="openTrace">上下游</el-button>
        <ScmPushMenu v-if="actionState.push.enabled && selectedRow?.id" :source-kind="selectedRow.plan_type === 'outsource' ? 'outsource_plan' : 'production_plan'"
          :source-id="selectedRow.id" :auto-load="false" @changed="load" />
      </template>
      <span style="margin-left:auto;font-size: var(--cw-text-base);color:var(--el-text-color-secondary)">共 {{ total }} 条<template v-if="overdueCount">，<span class="overdue-text">逾期 {{ overdueCount }}</span></template></span>
    </div>
    <div class="filter-row filter-row--query" style="margin-bottom: 8px;">
      <el-input v-model="filters.keyword" clearable placeholder="计划号 / 成品编码 / 名称 / 备注" size="small" style="width:220px" @keyup.enter="query" @clear="query" />
      <el-select v-model="filters.status" multiple collapse-tags clearable placeholder="状态" size="small" style="width:170px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="released" /><el-option label="已关闭" value="closed" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开工从" end-placeholder="开工至" size="small" style="width:230px" @change="query" />
      <el-select v-if="planTypeFilter === 'outsource'" v-model="filters.supplier_code" clearable filterable placeholder="委外厂" size="small" style="width:160px" @change="query">
        <el-option v-for="p in suppliers" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-checkbox v-model="filters.overdue" size="small" @change="query">仅看逾期</el-checkbox>
      <FilterClearButton size="small" @clear="clearFilters" />
    </div>

    <div class="page-body">
      <el-table ref="tableRef" :data="displayList" v-loading="loading" border stripe size="small" height="100%" @header-dragend="onDragEnd" @row-dblclick="openOrder" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="44" fixed="left" />
        <template v-for="column in orderedVisibleColumns" :key="column.key">
        <el-table-column v-if="column.key === 'code'" label="计划号" prop="code" :width="cw('code', 160)" />
        <el-table-column v-else-if="column.key === 'plan_type'" label="类型" column-key="plan_type" :width="cw('plan_type', 80)" align="center">
          <template #default="{ row }">
            <el-tag :type="row.plan_type === 'outsource' ? 'warning' : 'success'" size="small" effect="plain">
              {{ row.plan_type === 'outsource' ? '委外' : '自制' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'item_code'" label="成品编号" column-key="item_code" :width="cw('item_code', 130)">
          <template #default="{ row }">
            {{ row.first_product_code || row.item_code }}
            <el-tag v-if="(row.product_count || 1) > 1" size="small" type="warning" effect="plain" style="margin-left:4px">等{{ row.product_count }}项</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'item_name'" label="成品名称" column-key="item_name" :width="cw('item_name', 170)" show-overflow-tooltip>
          <template #default="{ row }">{{ row.first_product_name || row.item_name }}{{ (row.product_count || 1) > 1 ? ' 等' : '' }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'plan_qty'" label="计划数" prop="plan_qty" :width="cw('plan_qty', 80)" align="right" />
        <el-table-column v-else-if="column.key === 'progress'" label="进度" :width="cw('progress', 130)" align="center">
          <template #default="{ row }">
            <el-progress :percentage="progressPct(row)" :stroke-width="10" :status="progressPct(row) >= 100 ? 'success' : undefined" :format="() => `${num(row.finished_qty)} / ${num(row.plan_qty)}`" />
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'dates'" label="计划 / 实际" :width="cw('dates', 190)">
          <template #default="{ row }">
            <div class="dates-cell">
              <span>{{ row.start_date || '-' }} ~ <b :class="{ 'overdue-text': row.is_overdue }">{{ row.end_date || '-' }}</b><el-tag v-if="row.is_overdue" size="small" type="danger" effect="plain" style="margin-left:4px">逾期</el-tag></span>
              <span v-if="row.actual_start_date || row.actual_end_date" class="text-muted">实际 {{ row.actual_start_date || '-' }} ~ {{ row.actual_end_date || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'supplier_code'" label="供应商" :width="cw('supplier_code', 120)" show-overflow-tooltip>
          <template #default="{ row }">{{ row.supplier_name || row.supplier_code || '' }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'status'" label="状态" :width="cw('status', 90)" align="center">
          <template #default="{ row }">
            <el-tag :type="STATUS_TYPE[row.status] || 'info'" size="small" effect="plain">{{ STATUS_LABEL[row.status] || row.status || '草稿' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'mrp_status'" label="MRP" :width="cw('mrp_status', 110)" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.mrp_status" :type="row.mrp_status === 'audited' ? 'success' : 'warning'" size="small" effect="plain" :title="row.mrp_doc_no">{{ row.mrp_status === 'audited' ? '已进入MRP' : '草稿MRP' }}</el-tag>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'doc_count'" label="下游单据" :width="cw('doc_count', 90)" align="right">
          <template #default="{ row }">{{ Number(row.doc_count) || 0 }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'remark'" label="备注" prop="remark" min-width="120" :width="widths.remark" show-overflow-tooltip />
        </template>
      </el-table>
    </div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" small style="padding:0 16px 8px" @change="load" />
    <ColumnSettingsDialog
      v-model="columnDialogVisible"
      :columns="columnSettings"
      @update:columns="updateColumns"
      @reset="resetColumns"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Setting } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'
import ScmPushMenu from '@/components/scm/ScmPushMenu.vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { getProductionPlanBatchActionState, MAX_SCM_BATCH_SELECTION } from '@/utils/scmBatchActions'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'
import FilterClearButton from '@/components/common/FilterClearButton.vue'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_production_plan')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const route = useRoute()
const router = useRouter()
const STATUS_LABEL: Record<string, string> = { draft: '草稿', released: '已审核', closed: '已关闭' }
const STATUS_TYPE: Record<string, 'success' | 'info' | 'warning'> = { draft: 'info', released: 'warning', closed: 'success' }
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }

// 来源类型过滤：?plan_type=outsource 委外计划 / self 生产计划 / 空=全部
const planTypeFilter = computed(() => (route.query.plan_type as string) || '')
const pageLabel = computed(() => planTypeFilter.value === 'outsource' ? '委外计划' : '生产计划')

const list = ref<any[]>([]); const loading = ref(false)
const openingNew = ref(false)
const selection = ref<any[]>([])
const selectedRow = computed(() => selection.value[0])
const actionState = computed(() => getProductionPlanBatchActionState(selection.value))
const planColumns: ColumnSetting[] = [
  { key: 'code', label: '计划号', visible: true, required: true },
  { key: 'plan_type', label: '类型', visible: true },
  { key: 'item_code', label: '成品编号', visible: true },
  { key: 'item_name', label: '成品名称', visible: true },
  { key: 'plan_qty', label: '计划数', visible: true },
  { key: 'progress', label: '进度', visible: true },
  { key: 'dates', label: '计划 / 实际日期', visible: true },
  { key: 'supplier_code', label: '供应商', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'mrp_status', label: 'MRP', visible: true },
  { key: 'doc_count', label: '下游单据', visible: false },
  { key: 'remark', label: '备注', visible: true },
]
const columnStorageKey = 'scm_production_plan_visible_columns'
const columnDialogVisible = ref(false)
const columnSettings = ref<ColumnSetting[]>(loadColumnSettings(columnStorageKey, planColumns))
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => column.visible))
function updateColumns(columns: ColumnSetting[]) {
  columnSettings.value = columns
  saveColumnSettings(columnStorageKey, columns)
}
function resetColumns() {
  updateColumns(planColumns.map(column => ({ ...column })))
}
// 生产评审 P1-6：服务端筛选 + 分页（plan_type 由地址栏决定）
const filters = ref({ keyword: '', status: [] as string[], supplier_code: '', overdue: false })
const dateRange = ref<string[] | null>(null)
const page = ref(1); const pageSize = ref(50); const total = ref(0)
const suppliers = ref<any[]>([])
const overdueCount = computed(() => list.value.filter((p: any) => p.is_overdue).length)
const displayList = computed(() => list.value)
const progressPct = (row: any) => { const p = Number(row.plan_qty) || 0; return p > 0 ? Math.min(100, Math.round((Number(row.finished_qty) || 0) / p * 100)) : 0 }
function clearFilters() { filters.value = { keyword: '', status: [], supplier_code: '', overdue: false }; dateRange.value = null; query() }
function query() { page.value = 1; load() }

async function load() {
  clearSelection()
  loading.value = true
  try {
    const r = await scmApi.getProductionPlansPaged({
      plan_type: planTypeFilter.value || undefined, keyword: filters.value.keyword || undefined,
      status: filters.value.status.length ? filters.value.status.join(',') : undefined,
      supplier_code: filters.value.supplier_code || undefined, overdue: filters.value.overdue ? '1' : undefined,
      start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: page.value, page_size: pageSize.value,
    })
    if (r.code === 0) { list.value = r.data.list; total.value = r.data.total }
  } finally { loading.value = false }
}

function clearSelection() {
  selection.value = []
  ;(tableRef.value as any)?.clearSelection?.()
}

function handleSelectionChange(rows: any[]) {
  if (rows.length > MAX_SCM_BATCH_SELECTION) {
    rows.slice(MAX_SCM_BATCH_SELECTION).forEach(row => (tableRef.value as any)?.toggleRowSelection?.(row, false))
    selection.value = rows.slice(0, MAX_SCM_BATCH_SELECTION)
    ElMessage.warning(`当前页最多选择 ${MAX_SCM_BATCH_SELECTION} 张计划`)
    return
  }
  selection.value = rows
}

function openOrder(row: any) {
  router.push(scmProductionPlanOrderRoute(row.id, row.plan_type === 'outsource' ? 'outsource' : 'self'))
}
function openTrace() {
  if (selectedRow.value?.id) router.push({ name: 'ScmProductionPlanDownstream', params: { id: selectedRow.value.id } })
}
// 新增/编辑改为独立全页面（含可编辑用料明细表）
async function openAdd() {
  openingNew.value = true
  await nextTick()
  try {
    await router.push({ name: 'ScmProductionPlanNew', query: { plan_type: planTypeFilter.value || 'self' } })
  } finally {
    openingNew.value = false
  }
}
function openEdit(row: any) { router.push({ name: 'ScmProductionPlanEdit', params: { id: row.id } }) }

const ACTION_LABEL = { delete: '删除', unrelease: '反审核', reopen: '重开' } as const
async function runBatchAction(action: keyof typeof ACTION_LABEL) {
  const ids = selection.value.map(row => row.id).filter(Boolean)
  if (!ids.length) return
  const label = ACTION_LABEL[action]
  const codes = selection.value.map(row => row.code).join('、')
  try {
    await ElMessageBox.confirm(`确认${label} ${ids.length} 张计划？\n${codes}`, `批量${label}`, {
      type: 'warning', confirmButtonText: label, cancelButtonText: '取消',
    })
  } catch { return }
  try {
    const result = await scmApi.batchProductionPlanActions({ action, ids })
    ElMessage.success(`已${label} ${result.data.processed} 张计划`)
    clearSelection()
    await load()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || `批量${label}失败`)
  }
}

watch(planTypeFilter, () => { clearSelection(); filters.value.supplier_code = ''; query() })

onMounted(async () => {
  void import('@/views/scm/ProductionPlanForm.vue')
  load()
  try { const p = await scmApi.getPartners({}); suppliers.value = ((p.data || []) as any[]).filter((x: any) => x.is_outsource === 1 || x.partner_type === 'supplier') } catch { /* 忽略 */ }
})
</script>

<style scoped>
.scm-pp-page { display: flex; flex-direction: column; height: 100%; }
.page-body { flex: 1; overflow: hidden; padding: 12px 16px; }
.selection-hint { font-size: var(--cw-text-base); color: var(--el-color-primary); white-space: nowrap; }
.filter-row--query { padding: 0 16px; }
.overdue-text { color: var(--el-color-danger); }
.dates-cell { display: flex; flex-direction: column; line-height: 1.4; font-size: 12px; }
.text-muted { color: var(--el-text-color-secondary); }
</style>
