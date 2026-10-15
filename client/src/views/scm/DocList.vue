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
      <FilterClearButton size="small" @clear="resetFilters" />
      <el-button type="primary" size="small" :loading="creating" @mouseenter="preloadDocFormNow" @focus="preloadDocFormNow" @pointerdown="preloadDocFormNow" @click="handleCreate"><el-icon><Plus /></el-icon>{{ createBtnLabel }}</el-button>
      <el-button v-if="canImportDocs" size="small" @click="router.push({ path: '/scm/docs/import', query: { doc_type: propType } })">批量导入</el-button>
      <SaveAsButton :handler="exportAllDocs" />
      <el-radio-group v-if="propType === 'AS'" v-model="viewMode" size="small" @change="onViewModeChange">
        <el-radio-button value="summary">单据汇总</el-radio-button>
        <el-radio-button value="product">成品明细</el-radio-button>
      </el-radio-group>
      <el-button v-if="propType === 'SOa'" size="small" @click="openSalesOrderRelations"><el-icon><Connection /></el-icon>订单关联表</el-button>
      <!-- 审核 / 反审核常驻工具条（客户反馈：参照金蝶，序时簿列表就能审核与反审核），未勾选时置灰 -->
      <template v-if="propType !== 'MRP'">
        <el-divider direction="vertical" />
        <el-button size="small" type="success" plain :disabled="!actionState.audit.enabled" :title="selection.length ? actionState.audit.reason : '请先勾选草稿单据'" @click="runBatchAction('audit')">审核</el-button>
        <el-button size="small" type="warning" plain :disabled="!actionState.unaudit.enabled" :title="selection.length ? actionState.unaudit.reason : '请先勾选已审核单据'" @click="runBatchAction('unaudit')">反审核</el-button>
      </template>
      <template v-if="selection.length">
        <el-divider direction="vertical" />
        <span class="selection-hint">已选 {{ selection.length }} 张</span>
        <el-button size="small" :disabled="!actionState.view.enabled" :title="actionState.view.reason" @click="handleView(selection[0])">查看</el-button>
        <el-button size="small" :disabled="!actionState.edit.enabled" :title="actionState.edit.reason" @click="handleEdit">编辑</el-button>
        <el-button size="small" type="danger" plain :disabled="!actionState.delete.enabled" :title="actionState.delete.reason" @click="runBatchAction('delete')">删除</el-button>
        <el-button size="small" :disabled="!actionState.print.enabled" :title="actionState.print.reason" @click="handlePrint">打印</el-button>
        <el-button v-if="!propType || docGeneratesVoucher(propType)" size="small" :disabled="!actionState.genVoucher.enabled" :title="actionState.genVoucher.reason" @click="runBatchAction('gen_voucher')">生成凭证</el-button>
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
        <MultiSortPanel :options="sortOptions" :model-value="effectiveSortKeys" :default-keys="DEFAULT_SORT_KEYS" @change="onSortChanged" />
        <el-button v-if="canColScheme" size="small" plain @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
      </Teleport>
    </div>

    <div v-if="!propType" class="doc-type-tabs">
      <el-radio-group v-model="filters.doc_type" size="small" @change="reloadFromFirstPage">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button v-for="g in tabGroups" :key="g.key" :value="g.key">{{ g.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <div class="page-body page-table-fill">
      <el-table ref="tableRef" :data="tableData" v-loading="loading" border stripe size="small" class="compact-data-table" height="100%" :row-class-name="rowClass" @row-dblclick="handleView" @header-dragend="onDragEnd" @selection-change="handleSelectionChange" :span-method="spanMethod">
        <el-table-column type="selection" width="44" fixed="left" :selectable="isSelectableScmDoc" />
        <el-table-column v-for="column in shownHeaderColumns" :key="column.key" :label="docColumnLabel(column.key, column.label)" :column-key="column.key"
          :prop="docColumnProp(column.key)" :width="docColumnWidth(column.key)" :min-width="docColumnMinWidth(column.key)"
          :align="docColumnAlign(column.key)" :show-overflow-tooltip="!LINKED_COLS.includes(column.key)" :formatter="(row: any) => formatDocColumn(row, column.key)" />
        <template v-if="productMode">
          <el-table-column v-for="pc in shownProductColumns" :key="pc.key" :label="pc.label" :column-key="pc.key" :width="widths[pc.key] || cw(pc.key, PL_WIDTHS[pc.key] || 100)"
            :align="PL_RIGHT.includes(pc.key) ? 'right' : undefined" show-overflow-tooltip :formatter="(row: any) => productCell(row, pc.key)" />
        </template>
      </el-table>
    </div>

    <div class="pagination-bar">
      <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev,pager,next,total" background @current-change="handlePageChange" />
    </div>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="availableColumnSettings" @update:columns="updateAvailableColumns" @reset="resetColumns" />

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onActivated, watch, nextTick, h, type VNode } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Plus, Setting, Connection, RefreshLeft } from '@element-plus/icons-vue'
import { ElLink, ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ScmDoc, type ScmDocType } from '@/api/scm'
import { hasPermission } from '@/utils/permission'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import ScmPushMenu from '@/components/scm/ScmPushMenu.vue'
import { canGenerateDownstream, docGeneratesVoucher, canShowStandardPushAction, isPushProgressDoc } from '@/utils/scmDoc'
import { useStateRecovery } from '@/composables/useStateRecovery'
import { getDocBatchActionState, isSelectableScmDoc, MAX_SCM_BATCH_SELECTION } from '@/utils/scmBatchActions'
import { confirmAuditDefaultWarehouses } from '@/utils/scmAuditDefaultWarehouseConfirm'
import { handleScmAuxUnmatched, SCM_VOUCHER_TYPE_STORAGE_KEY } from '@/utils/scmVoucherAux'
import { pickVoucherType } from '@/utils/voucherTypePick'
import {
  scmDocumentRoute,
  scmDownstreamDocRoute,
  scmDocNavContextToDetailQuery,
  scmDocNavContextToListQuery,
  type ScmDocNavContext,
} from '@/utils/scmDocNavigation'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import MultiSortPanel from '@/components/common/MultiSortPanel.vue'
import { loadSortKeys, normalizeSortKeys, saveSortKeys, serializeSortKeys, type SortKey } from '@/utils/multiSort'
import { LIST_ALL_COLS, LIST_CUSTOM_COL_PREFIX, LIST_PRODUCT_COL_PREFIX, listColsForType } from '@/config/scmColumns'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { exportDateStamp } from '@/utils/exportElTable'
import { loadColumnSettings, mergeColumnSettings, saveColumnSettings, serializeColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { ptActive } = usePageToolbarTeleport()

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_doc_list')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const route  = useRoute()
const router = useRouter()

const propType = computed(() => (route.query.doc_type as string) || '')
const canImportDocs = computed(() => ['IS', 'OI', 'OO', 'PI', 'PR', 'PO', 'PQ', 'SO', 'SR', 'SOa', 'SQ'].includes(propType.value) && hasPermission('scm:import'))
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
  sort: undefined,
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
const decStore = useScmDecimalsStore()
void decStore.load()
const PAYMENT_LABEL: Record<string, string> = { cash: '现金', transfer: '转账', credit: '挂账' }
const paymentLabel = (v?: string) => (v ? (PAYMENT_LABEL[v] || v) : '')

// 合计行：作为表体最后一行（水平滚动条落在合计行下方）。仅有数据时追加。
// 数量 / 金额 / 税额取后端按全部筛选结果汇总的值（不只当前页，翻页时合计不变）；核销金额仍按当前页。
// 样式与冻结（sticky 贴底）由 common.css 的 .doc-line-summary 全局规则统一处理。
const listSummary = ref<{ total_qty: number; total_amount: number; total_tax: number; pushed_qty?: number; pushed_amount?: number; unpushed_amount?: number } | null>(null)
const summaryRow = computed<any>(() => {
  const sum = (k: string) => list.value.reduce((s, r) => s + (Number((r as any)[k]) || 0), 0)
  const all = listSummary.value
  const multiPage = total.value > list.value.length
  return {
    __summary: true, doc_no: all && multiPage ? `合计（全部 ${total.value} 张）` : '合计',
    total_qty: (all ? all.total_qty : sum('total_qty')) || null,
    // 下推数量合计：后端有全量值（单一可下推类型）时取全量，否则按当前页累加
    pushed_qty: all?.pushed_qty != null ? all.pushed_qty : list.value.reduce((t, r: any) => t + (Number(r.push_shown_qty ?? r.pushed_qty) || 0), 0),
    pushed_amount: all?.pushed_amount != null ? all.pushed_amount : sum('pushed_amount'),
    unpushed_amount: all?.unpushed_amount != null ? all.unpushed_amount : sum('unpushed_amount'),
    total_amount: (all ? all.total_amount : sum('total_amount')) || null,
    total_tax: (all ? all.total_tax : sum('total_tax')) || null,
    verified_amount: sum('verified_amount') || null, unverified_amount: sum('unverified_amount') || null,
  }
})
// 组装单两种视图：单据汇总 / 成品明细（每个成品一行，表头项目仅首行显示）
const VIEW_MODE_KEY = 'scm_doc_list_as_view'
function loadViewMode(): 'summary' | 'product' {
  try { return localStorage.getItem(VIEW_MODE_KEY) === 'product' ? 'product' : 'summary' } catch { return 'summary' }
}
const viewMode = ref<'summary' | 'product'>(loadViewMode())
const productMode = computed(() => propType.value === 'AS' && viewMode.value === 'product')
function onViewModeChange() {
  try { localStorage.setItem(VIEW_MODE_KEY, viewMode.value) } catch { /* 忽略 */ }
  reloadFromFirstPage()
}
const PRODUCT_HIDDEN_COLS = ['total_qty', 'total_amount', 'total_tax', 'total_with_tax', 'push', 'pushed_amount', 'unpushed_amount']
const flatRows = computed<any[]>(() => {
  const out: any[] = []
  for (const d of list.value) {
    const pls = d.product_lines?.length ? d.product_lines : [null]
    pls.forEach((pl, i) => out.push({ ...d, __pl: pl, __first: i === 0, __span: pls.length }))
  }
  return out
})
const productSummary = computed<any>(() => {
  const rows = flatRows.value
  return { __summary: true, doc_no: '合计',
    __pl: { qty: rows.reduce((s, r) => s + (Number(r.__pl?.qty) || 0), 0), process_amount: rows.reduce((s, r) => s + (Number(r.__pl?.process_amount) || 0), 0) } }
})
const tableData = computed(() => {
  if (productMode.value) return list.value.length ? [...flatRows.value, productSummary.value] : []
  return list.value.length ? [...list.value, summaryRow.value] : list.value
})
// 成品明细列（pl_ 前缀）与表头列同属 columnSettings：列设置 / 列方案 / 权限锁定完全共用
const isPlCol = (key: string) => key.startsWith(LIST_PRODUCT_COL_PREFIX)
const PL_WIDTHS: Record<string, number> = { pl_item_code: 120, pl_item_name: 160, pl_spec: 120, pl_unit: 60, pl_qty: 100, pl_fee: 100, pl_amount: 110, pl_remark: 140, pl_item_remark: 140 }
const PL_RIGHT = ['pl_qty', 'pl_fee', 'pl_amount', 'pl_purchase_price', 'pl_sale_price', 'pl_ref_cost']
const ITEM_TYPE_LABEL: Record<string, string> = { '0': '原料', '6': '半成品', '9': '成品' }
function productCell(row: any, key: string): string {
  const pl = row.__pl
  if (!pl) return ''
  if (row.__summary) {
    if (key === 'pl_qty') return fmt(pl.qty)
    return key === 'pl_amount' ? fmt(pl.process_amount) : ''
  }
  switch (key) {
    case 'pl_item_code': return pl.item_code ?? ''
    case 'pl_item_name': return pl.item_name ?? ''
    case 'pl_qty': return String(pl.qty ?? '')
    case 'pl_fee': case 'pl_amount':
      if (row.process_mode !== 'entrust' && row.process_mode !== 'contract') return '-'
      return fmt(key === 'pl_fee' ? pl.process_fee : pl.process_amount)
    case 'pl_item_type': return ITEM_TYPE_LABEL[String(pl.item_type)] ?? (pl.item_type ?? '')
    case 'pl_purchase_price': case 'pl_sale_price': case 'pl_ref_cost': return fmt(pl[key.slice(3)])
    default: return pl[key.slice(3)] ?? ''
  }
}
const shownHeaderColumns = computed(() => orderedVisibleColumns.value.filter(c => !isPlCol(c.key) && !(productMode.value && PRODUCT_HIDDEN_COLS.includes(c.key))))
const shownProductColumns = computed(() => productMode.value ? orderedVisibleColumns.value.filter(c => isPlCol(c.key)) : [])
function spanMethod({ row, columnIndex }: { row: any; columnIndex: number }) {
  if (!productMode.value || row.__summary) return
  if (columnIndex > shownHeaderColumns.value.length) return  // 成品列不合并（含选择列 0 与表头列）
  return row.__first ? { rowspan: row.__span, colspan: 1 } : { rowspan: 0, colspan: 0 }
}
const rowClass = ({ row }: { row: any }) => (row.__summary ? 'doc-line-summary' : '')

// ── 自定义显示列 ────────────────────────────────────────────
// 列定义统一来自 config/scmColumns.ts 的 LIST_ALL_COLS（与列方案管理同源）；
// 可用列由 listColsForType 决定：类型未配置 header/line 字段 → 全部列可用，已配置 → 按配置。
// 列设置按单据类型分别保存；某类型首次打开时以旧的「全类型共用」设置作初始值，不丢用户已有勾选。
const LEGACY_STORAGE_KEY_COLS = 'scm_doc_list_columns_visible'
const colsStorageKey = (dt: string) => `${LEGACY_STORAGE_KEY_COLS}:${dt || 'ALL'}`

// ── 单据自定义字段（动态列，仅在选中单一单据类型时出现） ──
const docFieldDefs = ref<any[]>([])
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

// 当前筛选类型下「实际拥有」的列（驱动列设置面板与渲染）：标准列 + 表头/表尾自定义字段列
const availableCols = computed(() => listColsForType(filters.doc_type, types.value.find(x => x.code === filters.doc_type), docFieldDefs.value))
const availableColKeys = computed<Set<string>>(() => new Set(availableCols.value.map(c => c.key)))
// 全量默认（含当前类型暂不可用的标准列，保留其勾选状态；自定义列只含当前类型的）
const allColumnDefaults = computed<ColumnSetting[]>(() => [
  ...LIST_ALL_COLS.map(({ key, label, visible, required }) => ({ key, label, visible, required })),
  ...availableCols.value.filter(c => c.key.startsWith(LIST_CUSTOM_COL_PREFIX)).map(({ key, label, visible, group }) => ({ key, label, visible, group })),
])
function loadColumnsFor(dt: string): ColumnSetting[] {
  let hasOwn = false
  try { hasOwn = localStorage.getItem(colsStorageKey(dt)) != null } catch { /* 忽略 */ }
  return loadColumnSettings(hasOwn ? colsStorageKey(dt) : LEGACY_STORAGE_KEY_COLS, allColumnDefaults.value)
}
const columnSettings = ref<ColumnSetting[]>(loadColumnsFor(filters.doc_type))
watch(allColumnDefaults, defaults => {
  columnSettings.value = mergeColumnSettings(defaults, serializeColumnSettings(columnSettings.value))
}, { immediate: true })
// 「全部」视图下切换单据类型：换成该类型自己的列设置
watch(() => filters.doc_type, dt => { columnSettings.value = loadColumnsFor(dt) })
// 列设置面板仅展示当前类型可用的列（含自定义字段列）
// 成品明细列仅在「成品明细」视图出现在列设置面板
const availableColumnSettings = computed(() => columnSettings.value.filter(column => availableColKeys.value.has(column.key) && (productMode.value || !isPlCol(column.key))))
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => column.visible && availableColKeys.value.has(column.key) && (canColScheme.value || !listHidden.value.has(column.key))))
const columnDialogVisible = ref(false)

// ── 多级排序（第一排序 / 第二排序 / …）：服务端排序，按单据类型分别记忆 ──
const DEFAULT_SORT_KEYS: SortKey[] = [{ key: 'doc_date', order: 'desc' }, { key: 'doc_no', order: 'desc' }]
const sortStorageKey = (dt: string) => `scm_doc_list_sort:${dt || 'ALL'}`
const sortByType = reactive<Record<string, SortKey[]>>({})
// 可排序的列 = 当前类型可用列（含自定义字段列），去掉后端无法排序的「下推数量」
// 后端无法排序的列：下推数量 + 收付款核销信息（均为批量富化出来的非库字段）
const NON_SORTABLE_COLS = [...LIST_ALL_COLS.map(c => c.key).filter(k => k.startsWith(LIST_PRODUCT_COL_PREFIX)), 'push', 'pushed_amount', 'unpushed_amount', 'verified_amount', 'unverified_amount', 'verify_nos', 'pay_linked_docs']
const sortOptions = computed(() => availableCols.value.filter(c => !NON_SORTABLE_COLS.includes(c.key)).map(c => ({ key: c.key, label: c.label })))
const sortOptionKeys = computed(() => new Set(sortOptions.value.map(o => o.key)))
const storedSortKeys = computed<SortKey[]>(() => sortByType[filters.doc_type || 'ALL'] ?? loadSortKeys(sortStorageKey(filters.doc_type)) ?? [])
const effectiveSortKeys = computed<SortKey[]>(() => {
  // 自定义字段列要等字段定义加载后才可用，所以这里只收敛「当前已知不可用的标准列」，cf: 列放行
  const kept = storedSortKeys.value.filter(k => k.key.startsWith(LIST_CUSTOM_COL_PREFIX) || sortOptionKeys.value.has(k.key))
  const normalized = normalizeSortKeys(kept, new Set(kept.map(k => k.key)))
  return normalized.length ? normalized : DEFAULT_SORT_KEYS
})
const sortParam = computed(() => serializeSortKeys(effectiveSortKeys.value))
function onSortChanged(keys: SortKey[]) {
  const dt = filters.doc_type || 'ALL'
  sortByType[dt] = keys
  saveSortKeys(sortStorageKey(filters.doc_type), keys)
  reloadFromFirstPage()
}

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
  const passed = new Set(columns.map(c => c.key))
  columnSettings.value = [...columns, ...columnSettings.value.filter(column => !passed.has(column.key))]
  saveColumnSettings(colsStorageKey(filters.doc_type), columnSettings.value)
}
function resetColumns() {
  columnSettings.value = allColumnDefaults.value.map(column => ({ ...column }))
  saveColumnSettings(colsStorageKey(filters.doc_type), columnSettings.value)
}

const DOC_COLUMN_WIDTHS: Record<string, number> = {
  doc_no: 160, doc_date: 100, doc_type: 90, partner: 170, warehouse: 120, dest_warehouse: 120, biz_person: 90, dept_code: 90, contract_no: 130,
  payment_type: 90, settle_account: 110, io_category: 90, transport_method: 90, expect_date: 100, credit_days: 70, due_date: 100,
  invoice_type: 100, invoice_no: 130, invoice_date: 100, currency: 70, exchange_rate: 80, discount_rate: 80, tax_rate: 70,
  total_qty: 80, total_amount: 110, total_tax: 100, total_with_tax: 120, push: 110, pushed_amount: 110, unpushed_amount: 110, operator: 90, maker: 90, created_at: 140,
  auditor: 90, audited_at: 140, updated_at: 140, linked_docs: 150, linked_payments: 150, verified_amount: 110, unverified_amount: 110, verify_nos: 140, pay_linked_docs: 150, source_doc_no: 150, voucher_no: 130, print_count: 80, status: 80, remark: 160,
}
const LINKED_COLS = ['linked_docs', 'linked_payments', 'pay_linked_docs', 'verify_nos']
// 关联单号列按当前单据类型显示具体名称（「全部」视图沿用通用名）
function docColumnLabel(key: string, fallback: string) {
  if (!LINKED_COLS.includes(key)) return fallback
  const t = propType.value || filters.doc_type
  if (key === 'pay_linked_docs') return t === 'RCV' ? '关联应收单' : t === 'PAY' ? '关联应付单' : fallback
  if (t === 'PO') return key === 'linked_docs' ? '关联入库单号' : '关联付款单号'
  if (t === 'SOa') return key === 'linked_docs' ? '关联出库单号' : '关联收款单号'
  return fallback
}
// 关联单号单元格：多张逐行显示、可点击打开。用 formatter 返回 VNode（不用默认插槽，见 DocListTableRender.spec）
// 核销单号单元格：逐行显示，点击进入核销单详情
function verifyNosCell(row: any): VNode | string {
  const nos: string[] = row.verify_nos || []
  if (row.__summary || !nos.length) return ''
  return h('div', { class: 'linked-docs' }, nos.map(no => h(ElLink, {
    key: no, type: 'primary', underline: false,
    onClick: (e: MouseEvent) => { e.stopPropagation(); router.push({ name: 'ScmArApVerifyRecord', params: { verifyNo: no } }) },
  }, () => no)))
}
function linkedDocsCell(row: any, key: string): VNode | string {
  const docs: Array<{ id: string; doc_no: string; doc_type: string; status: string }> = row[key] || []
  if (row.__summary || !docs.length) return ''
  return h('div', { class: 'linked-docs' }, docs.map(d => h(ElLink, {
    key: d.id, type: 'primary', underline: false,
    onClick: (e: MouseEvent) => { e.stopPropagation(); router.push(scmDownstreamDocRoute(d.id, d.status, undefined, d.doc_type)) },
  }, () => d.doc_no)))
}
const RIGHT_COLS = ['pushed_amount', 'unpushed_amount', 'verified_amount', 'unverified_amount', 'total_qty', 'total_amount', 'total_tax', 'total_with_tax', 'discount_rate', 'credit_days', 'tax_rate', 'exchange_rate', 'print_count']
// 需要 formatter 自行取值的列（不绑定 prop）
const COMPUTED_COLS = ['doc_type', 'partner', 'warehouse', 'dest_warehouse', 'payment_type', 'total_amount', 'total_tax', 'total_with_tax', 'push', 'pushed_amount', 'unpushed_amount', 'status', 'created_at', 'audited_at', 'updated_at']
const DATETIME_COLS = ['created_at', 'audited_at', 'updated_at']
function docColumnWidth(key: string) { return widths.value[key] || cw(key, DOC_COLUMN_WIDTHS[key] || 120) }
function docColumnMinWidth(key: string) { return key === 'partner' ? 150 : key === 'remark' ? 140 : key.startsWith('cf:') ? 120 : undefined }
function docColumnAlign(key: string) { return RIGHT_COLS.includes(key) ? 'right' : ['currency', 'push', 'status'].includes(key) ? 'center' : undefined }
function docColumnProp(key: string) { return COMPUTED_COLS.includes(key) || key.startsWith('cf:') ? undefined : key }
// 库内时间为 UTC（datetime('now')），列表按本机时区显示到分钟
function fmtDateTime(v?: string | null): string {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v))
  if (!m) return String(v)
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function docColumnText(row: any, key: string) {
  if (key === 'doc_type') return row.__summary ? '' : typeNameDisplay(row.doc_type)
  if (key === 'partner') return row.partner_name || row.partner_code || ''
  if (key === 'warehouse') return row.warehouse_name || row.warehouse_code || ''
  if (key === 'dest_warehouse') return row.dest_warehouse_name || row.dest_warehouse_code || ''
  if (key === 'payment_type') return paymentLabel(row.payment_type)
  // 小数位按单据类型（系统参数 → 供应链 → 小数位设置）
  const scope = row.doc_type || propType.value
  if (key === 'total_qty') return row.total_qty == null ? '' : decStore.qty(row.total_qty, scope)
  if (key === 'total_amount') return decStore.amount(row.total_amount || 0, scope)
  if (key === 'verified_amount' || key === 'unverified_amount') return row[key] == null ? '' : decStore.amount(row[key], scope)
  if (key === 'total_tax') return decStore.amount(row.total_tax || 0, scope)
  if (key === 'total_with_tax') return decStore.amount((row.total_amount || 0) + (row.total_tax || 0), scope)
  if (key === 'pushed_amount' || key === 'unpushed_amount') {
    if (!row.__summary && !isPushProgressDoc(row.doc_type)) return '—'
    return decStore.amount(Number(row[key]) || 0, scope)
  }
  if (DATETIME_COLS.includes(key)) return fmtDateTime(row[key])
  if (key.startsWith('cf:')) return cfVal(row, key.slice(3))
  return row[key] ?? ''
}
function formatDocColumn(row: any, key: string): string | VNode {
  if (key === 'verify_nos') return verifyNosCell(row)
  if (LINKED_COLS.includes(key)) return linkedDocsCell(row, key)
  if (key === 'push') {
    if (row.__summary) {
      const r6 = (v: any) => Math.round((Number(v) || 0) * 1e6) / 1e6
      return `${r6(row.pushed_qty)} / ${r6(row.total_qty)}`
    }
    // 展示口径：实物下游与生产计划取大者、缺料单含全部下游（后端 push_shown_qty）；旧后端无该字段时回退 pushed_qty
    return isPushProgressDoc(row.doc_type) ? `${row.push_shown_qty ?? row.pushed_qty ?? 0} / ${row.total_qty || 0}` : '—'
  }
  if (key === 'status') return row.__summary ? '' : (row.status === 'audited' ? '已审核' : '草稿')
  // 润衡等原系统导入的历史单据：原系统已制证，本系统不再生成凭证
  if (key === 'voucher_no' && !row.__summary && !row.voucher_no && Number(row.external_voucher)) return '原系统已制证'
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

// 「另存」：按当前筛选 / 排序取全部页（不只当前 30 条），列按当前列设置；组装单成品明细视图逐成品一行
const EXPORT_PAGE_SIZE = 500
const EXPORT_NUMERIC_COLS = new Set(['pushed_amount', 'unpushed_amount', 'total_qty', 'total_amount', 'total_tax', 'total_with_tax', 'verified_amount', 'unverified_amount', 'discount_rate', 'credit_days', 'tax_rate', 'exchange_rate', 'print_count'])
function docExportText(row: any, key: string): string | number {
  if (key === 'verify_nos') return (row.verify_nos || []).join('、')
  if (LINKED_COLS.includes(key)) return (row[key] || []).map((d: any) => d.doc_no).join('、')
  if (EXPORT_NUMERIC_COLS.has(key)) {
    if (key === 'total_with_tax') return Number(row.total_amount || 0) + Number(row.total_tax || 0)
    const v = row[key]
    return v == null || v === '' ? '' : Number(v)
  }
  const v = formatDocColumn(row, key)
  return typeof v === 'string' ? v : ''
}
async function exportAllDocs() {
  const all: any[] = []
  for (let p = 1; p <= 200; p++) {
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
      sort: sortParam.value,
      expand: productMode.value ? 'product' : undefined,
      page: p, page_size: EXPORT_PAGE_SIZE,
    })
    if (res.code !== 0) throw new Error(res.message || '取数失败')
    all.push(...res.data.list)
    if (all.length >= res.data.total || res.data.list.length < EXPORT_PAGE_SIZE) break
  }
  if (!all.length) { ElMessage.warning('当前没有可另存的单据'); return }
  const title = typeNameDisplay(filters.doc_type || propType.value) || '单据列表'
  const headerCols: ExportColumnDef[] = shownHeaderColumns.value.map(c => ({
    label: String(docColumnLabel(c.key, c.label)),
    align: docColumnAlign(c.key) === 'right' ? 'right' : 'left',
    type: EXPORT_NUMERIC_COLS.has(c.key) ? (['credit_days', 'print_count'].includes(c.key) ? 'integer' : 'amount') : 'text',
    value: (row: any) => (row.__first === false ? '' : docExportText(row, c.key)),
  }))
  const productCols: ExportColumnDef[] = shownProductColumns.value.map(pc => ({
    label: pc.label,
    align: PL_RIGHT.includes(pc.key) ? 'right' : 'left',
    type: PL_RIGHT.includes(pc.key) ? 'number' : 'text',
    value: (row: any) => {
      const t = productCell(row, pc.key)
      if (!PL_RIGHT.includes(pc.key) || t === '' || t === '-') return t
      const n = Number(String(t).replace(/,/g, ''))
      return Number.isFinite(n) ? n : t
    },
  }))
  const rows = productMode.value
    ? all.flatMap(d => (d.product_lines?.length ? d.product_lines : [null]).map((pl: any, i: number) => ({ ...d, __pl: pl, __first: i === 0 })))
    : all
  const sumOf = (k: string) => all.reduce((s, r) => s + (Number(k === 'total_with_tax' ? Number(r.total_amount || 0) + Number(r.total_tax || 0) : r[k]) || 0), 0)
  await exportStyledTable({
    fileName: `${title}_${exportDateStamp()}.xlsx`,
    sheetName: title.slice(0, 30),
    title,
    subtitle: [startDate.value && `${startDate.value} 至 ${endDate.value || ''}`, `共 ${all.length} 张`].filter(Boolean).join('  '),
    columns: [...headerCols, ...productCols],
    rows,
    summaryValues: productMode.value ? undefined : headerCols.map((c, i) => {
      if (i === 0) return '合计'
      const key = shownHeaderColumns.value[i].key
      if (key === 'push') return formatDocColumn({ __summary: true, pushed_qty: all.reduce((t, r: any) => t + (Number(r.push_shown_qty ?? r.pushed_qty) || 0), 0), total_qty: sumOf('total_qty') }, 'push') as string
      return EXPORT_NUMERIC_COLS.has(key) && !['discount_rate', 'credit_days', 'tax_rate', 'exchange_rate', 'print_count'].includes(key) ? sumOf(key) : ''
    }),
  })
  ElMessage.success(`已另存 ${all.length} 张单据`)
}

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
    sort: sortParam.value,
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
  // 并行加载当前类型的自定义字段列定义；若已设置按自定义字段排序，列定义用于列设置展示，排序本身不依赖它
  loadDocFieldDefs()
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
      sort: sortParam.value,
      expand: productMode.value ? 'product' : undefined,
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
      listSummary.value = res.data.summary ?? null
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
const parseCfg = (s?: string): string[] => { try { return s ? JSON.parse(s) : [] } catch { return [] } }
const docTypeHeaderFields = computed<Set<string>>(() => {
  if (!filters.doc_type) return new Set()
  const t = types.value.find(x => x.code === filters.doc_type)
  // header_fields 实际存的是 JSON 数组字符串；兼容历史逗号分隔写法
  const raw = t?.header_fields || ''
  const arr = raw.trim().startsWith('[') ? parseCfg(raw) : raw.split(',').map(x => x.trim()).filter(Boolean)
  return new Set(arr)
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
  // 批量生成凭证：先选凭证类型（替代确认框）
  let voucherTypeId = ''
  if (action === 'gen_voucher') {
    const picked = await pickVoucherType({
      storageKey: SCM_VOUCHER_TYPE_STORAGE_KEY, title: '批量生成凭证',
      message: `为 ${ids.length} 张单据各生成一张凭证：${nos}`, defaultLabel: '按进销存凭证设置默认',
    })
    if (picked === null) return
    voucherTypeId = picked
  } else {
    try {
      await ElMessageBox.confirm(`确认${label} ${ids.length} 张单据？\n${nos}`, `批量${label}`, {
        type: action === 'delete' || action === 'unaudit' ? 'warning' : 'info',
        confirmButtonText: label,
        cancelButtonText: '取消',
      })
    } catch { return }
  }
  try {
    let result
    try {
      result = await scmApi.batchDocActions({ action, ids, ...(voucherTypeId ? { voucher_type_id: voucherTypeId } : {}) })
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
    // 批量生成凭证被辅助核算拦截：自动新建后整批重试
    if (action === 'gen_voucher' && await handleScmAuxUnmatched(error, async () => {
      const retried = await scmApi.batchDocActions({ action, ids, ...(voucherTypeId ? { voucher_type_id: voucherTypeId } : {}) })
      ElMessage.success(`已${label} ${retried.data.processed} 张单据`)
      clearSelection()
      await load()
    })) return
    ElMessage.error(error?.response?.data?.message || `批量${label}失败`)
  }
}
</script>

<style scoped>
.linked-docs { display: flex; flex-direction: column; line-height: 1.6; }
.scm-doc-page { padding: var(--page-pad); height: 100%; }

.filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.total-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-left: auto; }
.doc-type-tabs { margin-bottom: var(--block-gap); }
.selection-hint { font-size: var(--cw-text-base); color: var(--el-color-primary); white-space: nowrap; }
</style>
