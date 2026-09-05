<template>
  <div class="page scm-doc-page">

    <div class="filter-row">
      <el-select v-if="!propType" v-model="filters.doc_type" placeholder="单据类型" style="width:130px" @change="reloadFromFirstPage" clearable size="small">
        <el-option v-for="t in types" :key="t.code" :label="t.name" :value="t.code" />
      </el-select>
      <el-input v-model="filters.keyword" placeholder="单据号/备注" clearable style="width:160px" size="small" @keyup.enter="reloadFromFirstPage" />
      <el-select v-if="showPartnerFilter" v-model="filters.partner_code" filterable clearable :loading="partnerOptLoading" placeholder="往来单位" style="width:200px" size="small">
        <el-option v-for="p in partnerOptions" :key="p.partner_code" :label="`${p.partner_code} ${p.partner_name || ''}`" :value="p.partner_code" />
      </el-select>
      <el-select v-model="filters.warehouse_code" placeholder="仓库" clearable style="width:120px" size="small">
        <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
      </el-select>
      <el-select v-if="showBizPersonFilter" v-model="filters.biz_person" filterable clearable :loading="bizPersonOptLoading" placeholder="业务员" style="width:120px" size="small">
        <el-option v-for="b in bizPersonOptions" :key="b.biz_person" :label="b.biz_person" :value="b.biz_person" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width:100px" size="small">
        <el-option label="草稿" value="draft" />
        <el-option label="已审核" value="audited" />
      </el-select>
      <el-date-picker v-model="filters.date_range" type="daterange" value-format="YYYY-MM-DD" range-separator="—" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" size="small" />
      <el-button type="primary" plain @click="reloadFromFirstPage" size="small"><el-icon><Search /></el-icon>查询</el-button>
      <el-button size="small" @click="resetFilters"><el-icon><RefreshLeft /></el-icon>重置</el-button>
      <el-button type="primary" size="small" :loading="creating" @mouseenter="preloadDocFormNow" @focus="preloadDocFormNow" @pointerdown="preloadDocFormNow" @click="handleCreate"><el-icon><Plus /></el-icon>{{ createBtnLabel }}</el-button>
      <el-button v-if="propType === 'SOa'" size="small" @click="openSalesOrderRelations"><el-icon><Connection /></el-icon>订单关联表</el-button>
      <template v-if="selection.length">
        <el-divider direction="vertical" />
        <span class="selection-hint">已选 {{ selection.length }} 张</span>
        <el-button size="small" :disabled="!actionState.view.enabled" :title="actionState.view.reason" @click="handleView(selection[0])">查看</el-button>
        <el-button size="small" :disabled="!actionState.edit.enabled" :title="actionState.edit.reason" @click="handleEdit">编辑</el-button>
        <el-button v-if="actionState.audit.enabled" size="small" type="success" plain @click="runBatchAction('audit')">审核</el-button>
        <el-button v-if="actionState.unaudit.enabled" size="small" type="warning" plain @click="runBatchAction('unaudit')">反审核</el-button>
        <el-button size="small" type="danger" plain :disabled="!actionState.delete.enabled" :title="actionState.delete.reason" @click="runBatchAction('delete')">删除</el-button>
        <el-button size="small" :disabled="!actionState.print.enabled" :title="actionState.print.reason" @click="handlePrint">打印</el-button>
        <el-button size="small" :disabled="!actionState.genVoucher.enabled" :title="actionState.genVoucher.reason" @click="runBatchAction('gen_voucher')">生成凭证</el-button>
        <el-button size="small" :disabled="!actionState.trace.enabled" :title="actionState.trace.reason" @click="openDownstream">上下游</el-button>
        <ScmPushMenu v-if="actionState.single && selectedRow?.id && selectedRow.doc_type === 'SOa' && selectedRow.status === 'audited'"
          source-kind="sales_order" :source-id="selectedRow.id" :auto-load="false" @changed="load" />
        <ScmPushMenu v-if="actionState.single && selectedRow?.id && selectedRow.doc_type === 'AS' && selectedRow.status === 'draft'"
          source-kind="assembly" :source-id="selectedRow.id" :auto-load="false" @changed="load" />
        <el-button v-if="canShowStandardPushAction(selectedRow?.doc_type || '')" size="small" type="primary" plain
          :disabled="!actionState.push.enabled" :title="actionState.push.reason" @click="handlePush">{{ selection.length > 1 && selectedRow?.doc_type === 'PO' ? '批量下推' : '下推' }}</el-button>
        <el-button v-if="selection.length > 1 && selection.every(row => row.doc_type === 'SOa')" size="small" type="primary"
          :disabled="!actionState.push.enabled" :title="actionState.push.reason" @click="handlePush">合并出库</el-button>
        <el-button v-if="selection.length > 1 && selection.every(row => row.doc_type === 'SOa')" size="small" type="success"
          :disabled="!actionState.mrp.enabled" :title="actionState.mrp.reason" @click="handleMrp">合并MRP</el-button>
        <el-button v-if="actionState.single && selectedRow?.doc_type === 'MR'" size="small" type="success"
          :disabled="!canGenerateDownstream(selectedRow.status, selectedRow.doc_type, selectedRow.push_progress)" @click="handleMrPush">下推</el-button>
      </template>
      <Teleport v-if="ptActive" defer to="#tabbar-actions">
        <el-button v-if="canColScheme" size="small" plain @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
      </Teleport>
    </div>

    <div v-if="!propType" class="doc-type-tabs">
      <el-radio-group v-model="filters.doc_type" size="small" @change="reloadFromFirstPage">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="g in tabGroups" :key="g.key" :value="g.key">{{ g.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="page-body">
      <el-table ref="tableRef" :data="tableData" v-loading="loading" border stripe size="small" class="compact-data-table" max-height="calc(100vh - 230px)" :row-class-name="rowClass" @row-dblclick="handleView" @header-dragend="onDragEnd" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="44" fixed="left" :selectable="isSelectableScmDoc" />
        <el-table-column v-for="column in orderedVisibleColumns" :key="column.key" :label="column.label" :column-key="column.key"
          :prop="docColumnProp(column.key)" :width="docColumnWidth(column.key)" :min-width="docColumnMinWidth(column.key)"
          :align="docColumnAlign(column.key)" show-overflow-tooltip :formatter="(row: any) => formatDocColumn(row, column.key)" />
      </el-table>
    </div>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev,pager,next,total" background @current-change="handlePageChange" />
    </div>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="availableColumnSettings" @update:columns="updateAvailableColumns" @reset="resetColumns" />

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onActivated, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Plus, Setting, Connection, RefreshLeft } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ScmDoc, type ScmDocType } from '@/api/scm'
import { hasPermission } from '@/utils/permission'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import ScmPushMenu from '@/components/scm/ScmPushMenu.vue'
import { canGenerateDownstream, canShowStandardPushAction, isPushProgressDoc } from '@/utils/scmDoc'
import { useStateRecovery } from '@/composables/useStateRecovery'
import { getDocBatchActionState, isSelectableScmDoc, MAX_SCM_BATCH_SELECTION } from '@/utils/scmBatchActions'
import { confirmAuditDefaultWarehouses } from '@/utils/scmAuditDefaultWarehouseConfirm'
import {
  scmDocumentRoute,
  scmDocNavContextToDetailQuery,
  scmDocNavContextToListQuery,
  type ScmDocNavContext,
} from '@/utils/scmDocNavigation'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, mergeColumnSettings, saveColumnSettings, serializeColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { ptActive } = usePageToolbarTeleport()

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_doc_list')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const route  = useRoute()
const router = useRouter()

const propType = computed(() => (route.query.doc_type as string) || '')
// 预收/预付款单：仅显示未关联任何应收/应付源单的收付款单（payment_mode=advance）
const propAdvance = computed(() => (route.query.payment_mode as string) === 'advance')

const list      = ref<ScmDoc[]>([])
const total     = ref(0)
const initialPage = Number(route.query.page)
const page      = ref(Number.isInteger(initialPage) && initialPage > 0 ? initialPage : 1)
const pageSize  = 30
const loading   = ref(false)
const creating  = ref(false)
const selection = ref<ScmDoc[]>([])
const selectedRow = computed(() => selection.value[0])
const actionState = computed(() => getDocBatchActionState(selection.value))
const { recoverStateError } = useStateRecovery()
const types     = ref<ScmDocType[]>([])
const warehouses = ref<any[]>([])
const filters   = reactive({
  doc_type: propType.value || String(route.query.filter_doc_type || ''),
  warehouse_code: String(route.query.warehouse_code || ''),
  partner_code: String(route.query.partner_code || ''),
  biz_person: String(route.query.biz_person || ''),
  status: String(route.query.status || ''),
  keyword: '',
  date_range: (String(route.query.start_date || '') && String(route.query.end_date || ''))
    ? [String(route.query.start_date), String(route.query.end_date)] as [string, string]
    : ([] as string[]),
})
// 派生：date_range → start_date / end_date（供 load 调用，不破坏下游结构）
const startDate = computed(() => filters.date_range?.[0] || '')
const endDate   = computed(() => filters.date_range?.[1] || '')
const appliedNavContext = ref<ScmDocNavContext>({
  from_list: true,
  list_doc_type: filters.doc_type,
  fixed_doc_type: !!propType.value,
  warehouse_code: filters.warehouse_code || undefined,
  partner_code: filters.partner_code || undefined,
  status: filters.status || undefined,
  start_date: startDate.value || undefined,
  end_date: endDate.value || undefined,
  payment_mode: propAdvance.value ? 'advance' : undefined,
  page: page.value,
})

const DOC_TITLE: Record<string, string> = {
  PI:'采购入库', PR:'采购退货', SO:'销售出库', SR:'销售退货',
  OI:'其他入库', OO:'其他出库', TR:'调拨单', CK:'盘点单',
  PL:'生产领用', PF:'完工入库', PS:'不良品入库', PB:'补料单', PJ:'退料单',
  WO:'委外发货', WI:'委外入库', AS:'组装单', DS:'拆卸单',
  PO:'采购订单', PQ:'采购询价', SQ:'销售报价', SOa:'销售订单',
  RP:'采购发票', RS:'销售发票', PAY:'付款单', RCV:'收款单', MR:'缺料单',
}

const tabGroups = computed(() => [
  { key: 'PI', label: '采购入库' }, { key: 'SO', label: '销售出库' },
  { key: 'OI', label: '其他入库' }, { key: 'OO', label: '其他出库' },
  { key: 'PL', label: '生产领用' }, { key: 'PF', label: '完工入库' },
  { key: 'PO', label: '采购订单' }, { key: 'SOa', label: '销售订单' },
  { key: 'PAY', label: '付款单' }, { key: 'RCV', label: '收款单' },
  { key: 'TR', label: '调拨' }, { key: 'CK', label: '盘点' },
])

const typeName = (c: string) => DOC_TITLE[c] || c
// 预收/预付款单：在 advance 模式下覆盖类型名
const ADVANCE_TITLE: Record<string, string> = { RCV: '预收款单', PAY: '预付款单' }
const typeNameDisplay = (c: string) => (propAdvance.value && ADVANCE_TITLE[c]) || typeName(c)
// 新增按钮文字：advance 模式下显示「新增预收/预付款单」
const createBtnLabel = computed(() => {
  if (propAdvance.value) {
    const t = filters.doc_type || propType.value
    return `新增${ADVANCE_TITLE[t] || '预收/预付款单'}`
  }
  return '新增单据'
})
const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PAYMENT_LABEL: Record<string, string> = { cash: '现金', transfer: '转账', credit: '挂账' }
const paymentLabel = (v?: string) => (v ? (PAYMENT_LABEL[v] || v) : '')

// 合计行：作为表体最后一行（水平滚动条落在合计行下方）。汇总当前页 数量/金额/价税合计。仅有数据时追加。
const summaryRow = computed<any>(() => {
  const sum = (k: string) => list.value.reduce((s, r) => s + (Number((r as any)[k]) || 0), 0)
  return { __summary: true, doc_no: '合计', total_qty: sum('total_qty') || null, total_amount: sum('total_amount') || null, total_tax: sum('total_tax') || null }
})
const tableData = computed(() => list.value.length ? [...list.value, summaryRow.value] : list.value)
const rowClass = ({ row }: { row: any }) => (row.__summary ? 'doc-line-summary' : '')

// ── 自定义显示列 ────────────────────────────────────────────
const STORAGE_KEY_COLS = 'scm_doc_list_columns_visible'
const allColumns: Array<ColumnSetting & { def: boolean }> = [
  { key: 'doc_no',         label: '单据号',   visible: true, required: true,  def: true },
  { key: 'doc_date',       label: '日期',     visible: true, def: true },
  { key: 'doc_type',       label: '类型',     visible: true, def: true },
  { key: 'partner',        label: '往来单位', visible: true, def: true },
  { key: 'warehouse',      label: '仓库',     visible: true, def: true },
  { key: 'biz_person',     label: '业务员',   visible: false, def: false },
  { key: 'dept_code',      label: '部门',     visible: false, def: false },
  { key: 'contract_no',    label: '合同号',   visible: false, def: false },
  { key: 'payment_type',   label: '付款方式', visible: false, def: false },
  { key: 'invoice_no',     label: '发票号',   visible: false, def: false },
  { key: 'total_qty',      label: '数量',     visible: true, def: true },
  { key: 'total_amount',   label: '金额',     visible: true, def: true },
  { key: 'total_with_tax', label: '价税合计', visible: true, def: true },
  { key: 'currency',       label: '币别',     visible: false, def: false },
  { key: 'maker',          label: '制单人',   visible: false, def: false },
  { key: 'auditor',        label: '审核人',   visible: false, def: false },
  { key: 'push',           label: '下推数量', visible: true, def: true },
  { key: 'status',         label: '状态',     visible: true, def: true },
  { key: 'remark',         label: '备注',     visible: false, def: false },
]

// ── 单据自定义字段（动态列，仅在选中单一单据类型时出现） ──
const docFieldDefs = ref<any[]>([])
const customCols = computed(() => docFieldDefs.value.map((f: any) => ({ key: 'cf:' + f.field_key, label: f.field_name, field_key: f.field_key })))
function cfVal(row: any, key: string): string {
  let fv: any = (row as any).field_values
  if (typeof fv === 'string') { try { fv = JSON.parse(fv) } catch { fv = {} } }
  const v = (fv || {})[key]
  return v == null ? '' : String(v)
}
async function loadDocFieldDefs() {
  if (!filters.doc_type) { docFieldDefs.value = []; return }
  try { const r = await scmApi.getDocFieldDefs(filters.doc_type); docFieldDefs.value = r.code === 0 ? r.data : [] } catch { docFieldDefs.value = [] }
}

// 扩展列对单据类型字段配置的依赖：仅当该类型 header_fields/line_fields 含对应项时才可用
const parseCfg = (s?: string): string[] => { try { return s ? JSON.parse(s) : [] } catch { return [] } }
const COL_HEADER_DEP: Record<string, string> = {
  partner: 'partner', warehouse: 'warehouse', biz_person: 'biz_person',
  dept_code: 'dept', contract_no: 'contract', payment_type: 'payment',
  invoice_no: 'invoice', currency: 'currency',
}
// 始终可用的通用列（与单据类型无关）
const ALWAYS_COLS = new Set(['doc_no', 'doc_date', 'total_qty', 'total_amount', 'status', 'maker', 'auditor', 'remark'])

// 当前筛选类型下「实际拥有」的列集合（驱动列设置面板与渲染）
const availableColKeys = computed<Set<string>>(() => {
  const dt = filters.doc_type
  // 「全部」视图：各类型字段并集，允许选任意列
  if (!dt) return new Set(allColumns.map(c => c.key))
  const t = types.value.find(x => x.code === dt)
  const header = parseCfg(t?.header_fields)
  const line = parseCfg(t?.line_fields)
  const s = new Set<string>(ALWAYS_COLS)
  for (const [colKey, dep] of Object.entries(COL_HEADER_DEP)) if (header.includes(dep)) s.add(colKey)
  if (line.includes('tax_amount') || line.includes('tax_rate')) s.add('total_with_tax')
  if (['PO', 'PQ', 'SOa', 'SQ', 'MR'].includes(dt)) s.add('push')  // 有下推目标的类型
  for (const c of customCols.value) s.add(c.key)  // 当前类型的自定义字段列
  return s
})
// 列设置面板仅展示当前类型可用的列（含自定义字段列）
const allColumnDefaults = computed<ColumnSetting[]>(() => [
  ...allColumns.map(column => ({ ...column })),
  ...customCols.value.map(column => ({ key: column.key, label: column.label, visible: true, group: '自定义字段' })),
])
const columnSettings = ref<ColumnSetting[]>(loadColumnSettings(STORAGE_KEY_COLS, allColumnDefaults.value))
watch(allColumnDefaults, defaults => {
  columnSettings.value = mergeColumnSettings(defaults, serializeColumnSettings(columnSettings.value))
}, { immediate: true })
const availableColumnSettings = computed(() => columnSettings.value.filter(column => availableColKeys.value.has(column.key)))
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => column.visible && availableColKeys.value.has(column.key) && (canColScheme.value || !listHidden.value.has(column.key))))
const columnDialogVisible = ref(false)

// ── 列方案：有 scm:colscheme 权限者可用「列设置」自行调列；无权限者按分配方案锁定 ──
const canColScheme = computed(() => hasPermission('scm:colscheme'))
/** 当前类型下方案要隐藏的列；仅对「无权限」用户硬生效（有权限者用本地列设置自由控制） */
const listHidden = ref<Set<string>>(new Set())
async function loadListColScheme() {
  const dt = filters.doc_type
  if (!dt) { listHidden.value = new Set(); return }  // 「全部」混合视图不套单类型方案
  try {
    const res = await scmApi.getMyColScheme({ target: 'list', doc_type: dt })
    listHidden.value = res.code === 0 ? new Set(res.data.hidden_cols || []) : new Set()
  } catch { listHidden.value = new Set() }
}

// 渲染 = 用户勾选 ∩ 当前类型可用列；无权限用户再叠加方案隐藏（锁定）
function updateAvailableColumns(columns: ColumnSetting[]) {
  const available = new Set(availableColKeys.value)
  columnSettings.value = [...columns, ...columnSettings.value.filter(column => !available.has(column.key))]
  saveColumnSettings(STORAGE_KEY_COLS, columnSettings.value)
}
function resetColumns() {
  columnSettings.value = allColumnDefaults.value.map(column => ({ ...column }))
  saveColumnSettings(STORAGE_KEY_COLS, columnSettings.value)
}

const DOC_COLUMN_WIDTHS: Record<string, number> = { doc_no: 160, doc_date: 100, doc_type: 90, partner: 170, warehouse: 120, biz_person: 90, dept_code: 90, contract_no: 130, payment_type: 90, invoice_no: 130, total_qty: 80, total_amount: 110, total_with_tax: 120, currency: 70, maker: 90, auditor: 90, push: 110, status: 80, remark: 160 }
function docColumnWidth(key: string) { return widths.value[key] || cw(key, DOC_COLUMN_WIDTHS[key] || 120) }
function docColumnMinWidth(key: string) { return key === 'partner' ? 150 : key === 'remark' ? 140 : key.startsWith('cf:') ? 120 : undefined }
function docColumnAlign(key: string) { return ['total_qty', 'total_amount', 'total_with_tax'].includes(key) ? 'right' : ['currency', 'push', 'status'].includes(key) ? 'center' : undefined }
function docColumnProp(key: string) { return ['doc_type', 'partner', 'warehouse', 'payment_type', 'total_with_tax', 'push', 'status'].includes(key) || key.startsWith('cf:') ? undefined : key }
function docColumnText(row: any, key: string) {
  if (key === 'doc_type') return row.__summary ? '' : typeNameDisplay(row.doc_type)
  if (key === 'partner') return row.partner_name || row.partner_code || ''
  if (key === 'warehouse') return row.warehouse_name || row.warehouse_code || ''
  if (key === 'payment_type') return paymentLabel(row.payment_type)
  if (key === 'total_amount') return fmt(row.total_amount)
  if (key === 'total_with_tax') return fmt((row.total_amount || 0) + (row.total_tax || 0))
  if (key.startsWith('cf:')) return cfVal(row, key.slice(3))
  return row[key] ?? ''
}
function formatDocColumn(row: any, key: string): string {
  if (key === 'push') {
    if (row.__summary) return ''
    return isPushProgressDoc(row.doc_type) ? `${row.pushed_qty || 0} / ${row.total_qty || 0}` : '—'
  }
  if (key === 'status') return row.__summary ? '' : (row.status === 'audited' ? '已审核' : '草稿')
  return String(docColumnText(row, key))
}

// 注意：这里不 watch(propType)/watch(propAdvance)。标签页机制下每个单据类型族（doc_type+payment_mode）
// 各自持有一个 keep-alive 缓存实例，切换类型/预收付模式必然是切到另一个族 = 另一个组件实例（见
// stores/tabs.ts + utils/viewKey.ts 的族分组逻辑），当前实例的 propType/propAdvance 在其存续期内不会
// 再变化。若在此 watch 全局单例的 route，会有时序漏洞：路由 query 变化时 watcher 是同步触发的，而
// keep-alive 真正切走（触发 onDeactivated）要等到下一次渲染，中间那个窗口里"即将被换下"的旧实例仍会
// 命中这个 watcher，把自己的 filters.doc_type 错误地改写成新路由的值并抢着把 URL 改回去——多个供应链单据
// 列表标签同时打开时（如同时开着「采购订单」和「采购入库」）就表现为路由被互相改来改去、界面反复刷新/跳动。
// 数据刷新完全交给 onMounted（首次挂载）与 onActivated（标签被重新激活时）即可，无需响应路由 query 变化。

function reloadFromFirstPage() {
  clearSelection()
  page.value = 1
  load()
}

function currentNavContext(): ScmDocNavContext {
  return {
    from_list: true,
    list_doc_type: filters.doc_type || '',
    fixed_doc_type: !!propType.value,
    warehouse_code: filters.warehouse_code || undefined,
    partner_code: filters.partner_code || undefined,
    status: filters.status || undefined,
    start_date: startDate.value || undefined,
    end_date: endDate.value || undefined,
    payment_mode: propAdvance.value ? 'advance' : undefined,
    page: page.value,
  }
}

function syncAppliedListRoute(context: ScmDocNavContext) {
  const query = scmDocNavContextToListQuery(context, '')
  void router.replace({ name: 'ScmDocList', query })
}

function handlePageChange() {
  clearSelection()
  load()
}

function clearSelection() {
  selection.value = []
  ;(tableRef.value as any)?.clearSelection?.()
}

function handleSelectionChange(rows: ScmDoc[]) {
  const valid = rows.filter(row => isSelectableScmDoc(row))
  if (valid.length > MAX_SCM_BATCH_SELECTION) {
    const overflow = valid.slice(MAX_SCM_BATCH_SELECTION)
    overflow.forEach(row => (tableRef.value as any)?.toggleRowSelection?.(row, false))
    selection.value = valid.slice(0, MAX_SCM_BATCH_SELECTION)
    ElMessage.warning(`当前页最多选择 ${MAX_SCM_BATCH_SELECTION} 张单据`)
    return
  }
  selection.value = valid
}

async function load() {
  clearSelection()
  loadListColScheme()  // 并行加载当前类型的列方案（不阻塞数据查询）
  loadDocFieldDefs()   // 并行加载当前类型的自定义字段列定义
  const requestedContext = currentNavContext()
  loading.value = true
  try {
    const res = await scmApi.getDocs({
      doc_type: filters.doc_type || undefined,
      warehouse_code: filters.warehouse_code || undefined,
      partner_code: filters.partner_code || undefined,
      biz_person: filters.biz_person || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword || undefined,
      start_date: startDate.value || undefined,
      end_date: endDate.value || undefined,
      payment_mode: propAdvance.value ? 'advance' : undefined,
      page: page.value, page_size: pageSize,
    })
    if (res.code === 0) {
      const maxPage = Math.max(1, Math.ceil(res.data.total / pageSize))
      if (res.data.list.length === 0 && res.data.total > 0 && page.value > maxPage) {
        page.value = maxPage
        await load()
        return
      }
      list.value = res.data.list
      total.value = res.data.total
      appliedNavContext.value = requestedContext
      // 页面已切到详情时，迟到的列表请求只能更新缓存数据，不能把路由抢回列表。
      if (route.name === 'ScmDocList') syncAppliedListRoute(requestedContext)
    }
  } finally { loading.value = false }
}

let skipInitialActivation = true
let docFormPreloadScheduled = false

function preloadDocFormNow() {
  docFormPreloadScheduled = true
  void import('@/views/scm/DocForm.vue')
}

function preloadDocFormWhenIdle() {
  if (docFormPreloadScheduled) return
  docFormPreloadScheduled = true
  const requestIdle = (window as any).requestIdleCallback as typeof window.requestIdleCallback | undefined
  if (typeof requestIdle === 'function') {
    requestIdle(preloadDocFormNow, { timeout: 3000 })
  } else {
    globalThis.setTimeout(preloadDocFormNow, 1200)
  }
}

onMounted(() => {
  // 列表正文与基础筛选资料并行；正文完成后再空闲预取大型编辑表单，避免争抢首屏解析资源。
  void Promise.all([scmApi.getDocTypes(), scmApi.getWarehouses()]).then(([ts, ws]) => {
    if (ts.code === 0) types.value = ts.data
    if (ws.code === 0) warehouses.value = ws.data
  })
  void load().finally(preloadDocFormWhenIdle)
  // 筛选下拉：往来单位 + 业务员（按单据实际发生过业务，限定当前账套）
  void loadPartnerOptions()
  void loadBizPersonOptions()
})

// ── 往来单位 / 业务员筛选下拉 ──
// 数据源是「按单据实际发生过业务的往来单位/业务员」（DISTINCT），而非全部档案。
const partnerOptions = ref<Array<{ partner_code: string; partner_name: string | null }>>([])
const bizPersonOptions = ref<Array<{ biz_person: string }>>([])
const partnerOptLoading = ref(false)
const bizPersonOptLoading = ref(false)

async function loadPartnerOptions() {
  partnerOptLoading.value = true
  try {
    const res = await scmApi.getDocPartnerOptions(filters.doc_type ? { doc_type: filters.doc_type } : undefined)
    if (res.code === 0) partnerOptions.value = res.data
  } catch { /* 忽略，下拉为空兜底 */ }
  finally { partnerOptLoading.value = false }
}
async function loadBizPersonOptions() {
  bizPersonOptLoading.value = true
  try {
    const res = await scmApi.getDocBizPersonOptions(filters.doc_type ? { doc_type: filters.doc_type } : undefined)
    if (res.code === 0) bizPersonOptions.value = res.data
  } catch { /* 忽略 */ }
  finally { bizPersonOptLoading.value = false }
}

// 筛选项按单据类型动态显示：根据当前类型在 SCM_DOC_TYPES 配置里的 header_fields 字段决定。
// 全部类型(空 doc_type)时显示所有筛选项；propType 锁定类型时按该类型配置决定。
// ScmDocType.header_fields 是逗号分隔字符串（如 'partner,warehouse,biz_person,dept'），解析后判断。
const docTypeHeaderFields = computed<Set<string>>(() => {
  if (!filters.doc_type) return new Set()
  const t = types.value.find(x => x.code === filters.doc_type)
  return new Set((t?.header_fields || '').split(',').map(s => s.trim()).filter(Boolean))
})
const showPartnerFilter = computed(() => {
  if (!filters.doc_type) return true
  // header_fields 含 partner，或类型属于采购/销售/收付款类（兜底）
  return docTypeHeaderFields.value.has('partner')
    || ['SQ','SOa','SO','SR','RS','PQ','PO','PI','PR','RP','PAY','RCV'].includes(filters.doc_type)
})
const showBizPersonFilter = computed(() => {
  if (!filters.doc_type) return true
  return docTypeHeaderFields.value.has('biz_person')
})

// 单据类型变化时：重新加载往来单位/业务员下拉（限定在该类型下出现过）
watch(() => filters.doc_type, () => {
  void loadPartnerOptions()
  void loadBizPersonOptions()
})

// 重置筛选：清空所有筛选条件（propType 锁定的单据类型保留），恢复全量
function resetFilters() {
  filters.doc_type = propType.value
  filters.warehouse_code = ''
  filters.partner_code = ''
  filters.biz_person = ''
  filters.status = ''
  filters.keyword = ''
  filters.date_range = []
  reloadFromFirstPage()
}

onActivated(() => {
  // KeepAlive 首次挂载也会触发 activated；跳过这一轮，避免和 onMounted 重复请求。
  if (skipInitialActivation) {
    skipInitialActivation = false
    return
  }
  void load()
})

// 路由跳转
async function handleCreate() {
  const dt = filters.doc_type || propType.value
  const query: Record<string, string> = {}
  if (dt) query.doc_type = dt
  // 预收/预付款单：进入表单时携带 payment_mode=advance，走预付录入 UI
  if (propAdvance.value) query.payment_mode = 'advance'
  creating.value = true
  await nextTick()
  try {
    await router.push({ name: 'ScmDocNew', query })
  } finally {
    creating.value = false
  }
}

function openSalesOrderRelations() {
  router.push({ name: 'ScmSalesOrderRelations' })
}
// 保留双击行查看；其它动作统一从表头工具栏触发。
function handleView(row: ScmDoc) {
  router.push(scmDocumentRoute(
    row.id!, row.doc_type, row.status,
    scmDocNavContextToDetailQuery(appliedNavContext.value),
  ))
}

function handleEdit() {
  const row = selectedRow.value
  if (!row?.id || !actionState.value.edit.enabled) return
  router.push(scmDocumentRoute(row.id, row.doc_type, 'draft', scmDocNavContextToDetailQuery(appliedNavContext.value)))
}

function handlePrint() {
  const ids = selection.value.map(row => row.id!).filter(Boolean)
  if (!ids.length) return
  if (ids.length === 1) router.push({ name: 'ScmDocPrint', params: { id: ids[0] } })
  else router.push({ name: 'ScmDocBatchPrint', query: { ids: ids.join(',') } })
}

function openDownstream() {
  if (selectedRow.value?.id) router.push({ name: 'ScmDocDownstream', params: { id: selectedRow.value.id } })
}

async function handlePush() {
  if (!actionState.value.push.enabled || !actionState.value.push.targetType) return
  const ids = selection.value.map(row => row.id!).filter(Boolean)
  // 销售订单（SOa）合并出库：先进库存对比预览页，按「订单剩余 × 可用库存」确认本次发货后再生成 SO 草稿。
  // 单订单下推和其他类型（PO/PQ/SQ）保持原直跳新建页逻辑。
  if (ids.length > 1 && actionState.value.push.targetType === 'SO') {
    router.push({ name: 'ScmDocBatchDispatch', query: { source_doc_ids: ids.join(',') } })
    return
  }
  if (ids.length > 1 && selectedRow.value?.doc_type === 'PO') {
    try {
      await ElMessageBox.confirm('将按各采购订单明细的最新剩余量生成采购入库草稿；不同供应商或币别自动拆分。', '批量下推采购入库', {
        type: 'info', confirmButtonText: '生成草稿', cancelButtonText: '取消',
      })
    } catch { return }
    try {
      const result = await scmApi.batchPushPurchase(ids)
      const docNos = result.data.docs.map(doc => doc.doc_no).join('、')
      ElMessage.success(`已生成 ${result.data.created} 张采购入库草稿：${docNos}`)
      clearSelection()
      await load()
      await router.push({ name: 'ScmDocList', query: { doc_type: 'PI' } })
    } catch (error) {
      if (await recoverStateError(error, { refresh: load })) return
    }
    return
  }
  router.push({
    name: 'ScmDocNew',
    query: ids.length === 1
      ? { doc_type: actionState.value.push.targetType, source_doc_id: ids[0] }
      : { doc_type: actionState.value.push.targetType, source_doc_ids: ids.join(',') },
  })
}

function handleMrp() {
  if (!actionState.value.mrp.enabled) return
  const ids = selection.value.map(row => row.id!).filter(Boolean)
  router.push({ name: 'ScmMrpNew', query: { source_kind: 'sales_order', source_ids: ids.join(',') } })
}

function handleMrPush() {
  if (selectedRow.value?.id) router.push({ name: 'ScmMrPushPreview', params: { id: selectedRow.value.id }, query: { from: 'list' } })
}

const ACTION_LABEL = { audit: '审核', unaudit: '反审核', delete: '删除', gen_voucher: '生成凭证' } as const
async function runBatchAction(action: keyof typeof ACTION_LABEL) {
  const ids = selection.value.map(row => row.id!).filter(Boolean)
  if (!ids.length) return
  const label = ACTION_LABEL[action]
  const nos = selection.value.map(row => row.doc_no).join('、')
  try {
    await ElMessageBox.confirm(`确认${label} ${ids.length} 张单据？\n${nos}`, `批量${label}`, {
      type: action === 'delete' || action === 'unaudit' ? 'warning' : 'info',
      confirmButtonText: label,
      cancelButtonText: '取消',
    })
  } catch { return }
  try {
    let result
    try {
      result = await scmApi.batchDocActions({ action, ids })
    } catch (error: any) {
      const data = error?.response?.data?.data
      if (action !== 'audit' || data?.error_code !== 'DEFAULT_WAREHOUSE_CONFIRMATION_REQUIRED') throw error
      await confirmAuditDefaultWarehouses(data)
      result = await scmApi.batchDocActions({ action, ids, apply_item_default_warehouses: true })
    }
    ElMessage.success(`已${label} ${result.data.processed} 张单据`)
    clearSelection()
    await load()
  } catch (error: any) {
    if (await recoverStateError(error, { refresh: async () => { clearSelection(); await load() } })) return
    ElMessage.error(error?.response?.data?.message || `批量${label}失败`)
  }
}
</script>

<style scoped>
.scm-doc-page { padding: 12px 16px; }
/* 合计行（表体最后一行）：加粗 + 浅底，水平滚动条落在其下方 */
.scm-doc-page :deep(.doc-line-summary) { font-weight: 600; }
.scm-doc-page :deep(.doc-line-summary td.el-table__cell) { background: var(--el-fill-color-light); }

.filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.total-hint { font-size: 13px; color: var(--el-text-color-secondary); margin-left: auto; }
.doc-type-tabs { margin-bottom: 8px; }
.selection-hint { font-size: 13px; color: var(--el-color-primary); white-space: nowrap; }
</style>
