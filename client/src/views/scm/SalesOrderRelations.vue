<template>
  <div class="page sales-order-relations-page">
    <div class="page-header">
      <div>
        <h2>销售订单关联表</h2>
        <p>以销售订单为主线，集中查看采购、生产、出入库、质检及结算链路。</p>
      </div>
      <el-button :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
    </div>

    <div class="filter-row">
      <el-input v-model="filters.keyword" clearable placeholder="订单号 / 客户" style="width: 220px" @keyup.enter="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-date-picker v-model="filters.dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 250px" />
      <el-select v-model="filters.status" clearable placeholder="订单状态" style="width: 130px">
        <el-option label="草稿" value="draft" />
        <el-option label="已审核" value="audited" />
        <el-option label="已关闭" value="closed" />
      </el-select>
      <el-select v-model="filters.types" multiple collapse-tags collapse-tags-tooltip clearable placeholder="筛选单据类型" style="width: 240px">
        <el-option v-for="item in availableTypes" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
      <el-divider direction="vertical" />
      <el-button @click="setExpanded(true)">全部展开</el-button>
      <el-button @click="setExpanded(false)">全部收起</el-button>
    </div>

    <div class="content-split" :class="{ 'has-detail': !!selected }">
      <div class="table-panel">
        <el-table
          ref="tableRef"
          v-loading="loading"
          :data="displayRoots"
          row-key="tree_row_id"
          :tree-props="{ children: 'children' }"
          border
          size="small"
          :height="selected ? 'calc(100vh - 510px)' : 'calc(100vh - 245px)'"
          highlight-current-row
          :row-class-name="rowClassName"
          @row-click="selectNode"
          @row-dblclick="openNode"
          @header-dragend="onDragEnd"
        >
          <el-table-column column-key="doc_no" prop="doc_no" label="单号" :width="cw('doc_no', 165)" show-overflow-tooltip />
          <el-table-column column-key="relation" label="关系 / 类型" :width="cw('relation', 190)" show-overflow-tooltip>
            <template #default="{ row }">
              <div class="type-cell">
                <el-tag size="small" :type="kindTagType(row)">{{ row.type_name }}</el-tag>
                <span v-if="row.relation_type !== 'root'" class="relation-text">{{ relationLabel(row.relation_type) }}</span>
                <template v-else>
                  <el-badge v-if="row.descendant_count" :value="row.descendant_count" :max="999" class="relation-count" />
                  <span v-else class="no-relations">暂无关联</span>
                </template>
              </div>
            </template>
          </el-table-column>
          <el-table-column column-key="parent" prop="parent_display" label="直接上游" :width="cw('parent', 155)" show-overflow-tooltip>
            <template #default="{ row }">{{ row.parent_display || '—' }}</template>
          </el-table-column>
          <el-table-column column-key="doc_date" prop="doc_date" label="日期" :width="cw('doc_date', 105)" />
          <el-table-column column-key="partner" label="往来单位" :width="cw('partner', 160)" show-overflow-tooltip>
            <template #default="{ row }">{{ row.partner_name || row.partner_code || '—' }}</template>
          </el-table-column>
          <el-table-column column-key="item" prop="item_summary" label="物料摘要" :width="cw('item', 190)" show-overflow-tooltip />
          <el-table-column column-key="qty" prop="total_qty" label="数量" :width="cw('qty', 95)" align="right">
            <template #default="{ row }">{{ formatNumber(row.total_qty) }}</template>
          </el-table-column>
          <el-table-column column-key="amount" prop="total_amount" label="金额" :width="cw('amount', 115)" align="right">
            <template #default="{ row }">{{ formatAmount(row.total_amount) }}</template>
          </el-table-column>
          <el-table-column column-key="status" label="状态" :width="cw('status', 90)" align="center">
            <template #default="{ row }"><el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column column-key="progress" prop="progress_text" label="执行进度" :width="cw('progress', 115)" align="center">
            <template #default="{ row }">{{ row.progress_text || '—' }}</template>
          </el-table-column>
          <el-table-column column-key="shared" label="共用标记" :width="cw('shared', 105)" align="center">
            <template #default="{ row }"><el-tag v-if="row.shared" size="small" type="warning">{{ row.shared_order_count }}单共用</el-tag><span v-else>—</span></template>
          </el-table-column>
          <el-table-column column-key="operation" label="操作" :width="cw('operation', 80)" fixed="right" align="center">
            <template #default="{ row }"><el-button link type="primary" @click.stop="openNode(row)">查看</el-button></template>
          </el-table-column>
          <template #empty><el-empty description="没有符合条件的销售订单" :image-size="80" /></template>
        </el-table>

        <div class="pagination-bar">
          <el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="prev, pager, next, total" background @current-change="load" />
        </div>
      </div>

      <section v-if="selected" v-loading="detailLoading" class="detail-panel">
        <div class="detail-header">
          <div>
            <span class="detail-kicker">{{ selected.type_name }}</span>
            <h3>{{ selected.doc_no || '未编号' }}</h3>
          </div>
          <el-button circle text @click="selected = null"><el-icon><Close /></el-icon></el-button>
        </div>
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="日期">{{ selected.doc_date || '—' }}</el-descriptions-item>
          <el-descriptions-item label="直接上游">{{ selected.parent_display || '—' }}</el-descriptions-item>
          <el-descriptions-item label="往来单位">{{ selected.partner_name || selected.partner_code || '—' }}</el-descriptions-item>
          <el-descriptions-item label="物料摘要">{{ selected.item_summary || '—' }}</el-descriptions-item>
          <el-descriptions-item label="数量">{{ formatNumber(selected.total_qty) }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ formatAmount(selected.total_amount) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusLabel(selected.status) }}</el-descriptions-item>
          <el-descriptions-item label="执行进度">{{ selected.progress_text || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="selected.shared" label="共用范围">{{ selected.shared_order_count }} 张销售订单共用</el-descriptions-item>
        </el-descriptions>

        <template v-if="detailLines.length">
          <h4>明细</h4>
          <el-table :data="detailLines" size="small" border max-height="260">
            <el-table-column prop="item_code" label="物料" min-width="110" show-overflow-tooltip />
            <el-table-column prop="item_name" label="名称" min-width="120" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="80" align="right" />
          </el-table>
        </template>

        <div class="detail-actions">
          <el-button type="primary" @click="openNode(selected)">进入原单</el-button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Close, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi, type SalesOrderRelationNode } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { scmDownstreamDocRoute, scmDownstreamMrpRoute, scmDownstreamProductionPlanRoute } from '@/utils/scmDocNavigation'

interface UiNode extends SalesOrderRelationNode {
  tree_row_id: string
  parent_display: string
  children: UiNode[]
}

const router = useRouter()
const { tableRef, colWidth, onDragEnd } = useListColumnWidth('scm_sales_order_relations')
const cw = (key: string, fallback: number) => colWidth(key, fallback)
const loading = ref(false)
const detailLoading = ref(false)
const roots = ref<SalesOrderRelationNode[]>([])
const availableTypes = ref<Array<{ value: string; label: string }>>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const selected = ref<UiNode | null>(null)
const detail = ref<any>(null)
const filters = reactive<{ keyword: string; status: string; dates: string[]; types: string[] }>({ keyword: '', status: '', dates: [], types: [] })

const relationNames: Record<string, string> = {
  root: '销售订单', mrp_source: 'MRP来源', source_doc: '表头来源', source_line: '行来源',
  production_plan: '生成计划', plan_doc: '计划执行', work_report: '生产报工', qc: '来源质检', arap_payment: '应收结算',
}

function relationLabel(value: string) { return relationNames[value] || value || '关联' }
function statusLabel(value: string) {
  return ({ draft: '草稿', audited: '已审核', closed: '已关闭', completed: '已完成', approved: '已审批', pending: '待处理', passed: '合格', failed: '不合格' } as Record<string, string>)[value] || value || '—'
}
function statusTagType(value: string) {
  if (['audited', 'completed', 'approved', 'passed'].includes(value)) return 'success'
  if (['failed', 'cancelled'].includes(value)) return 'danger'
  if (['pending', 'processing'].includes(value)) return 'warning'
  return 'info'
}
function kindTagType(row: UiNode) {
  if (row.doc_type === 'SOa') return 'primary'
  if (row.node_kind === 'production_plan') return 'warning'
  if (row.node_kind === 'qc') return 'success'
  return 'info'
}
function formatNumber(value: number) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 }) }
function formatAmount(value: number) { return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function toUiTree(node: SalesOrderRelationNode, rootId: string, path: string, parentDisplay = ''): UiNode {
  const currentPath = `${path}/${node.node_id}`
  const ui = { ...node, tree_row_id: `${rootId}:${currentPath}`, parent_display: parentDisplay, children: [] as UiNode[] }
  ui.children = node.children.map(child => toUiTree(child, rootId, currentPath, node.doc_no || node.type_name))
  return ui
}

const uiRoots = computed(() => roots.value.map(root => toUiTree(root, root.node_id, 'root')))
function filterNode(node: UiNode, selectedTypes: Set<string>): UiNode | null {
  const children = node.children.map(child => filterNode(child, selectedTypes)).filter((child): child is UiNode => !!child)
  if (node.relation_type === 'root' || selectedTypes.has(node.doc_type) || children.length) return { ...node, children }
  return null
}
const displayRoots = computed(() => {
  if (!filters.types.length) return uiRoots.value
  const selectedTypes = new Set(filters.types)
  return uiRoots.value.map(root => filterNode(root, selectedTypes)).filter((node): node is UiNode => !!node)
})
const detailLines = computed<any[]>(() => detail.value?.lines || detail.value?.products || detail.value?.plan?.products || [])

async function load() {
  loading.value = true
  selected.value = null
  detail.value = null
  try {
    const result = await scmApi.getSalesOrderRelations({
      keyword: filters.keyword || undefined,
      status: filters.status || undefined,
      start_date: filters.dates?.[0] || undefined,
      end_date: filters.dates?.[1] || undefined,
      page: page.value,
      page_size: pageSize,
    })
    if (result.code === 0) {
      roots.value = result.data.roots
      total.value = result.data.total
      availableTypes.value = result.data.available_types
      if (result.data.truncated) {
        ElMessage.warning('关联范围过大，已截断显示前 2000 个节点，请缩小查询条件（如按订单号/日期/状态过滤）')
      }
    } else {
      ElMessage.error(result.message || '销售订单关联数据加载失败')
    }
  } catch (err: any) {
    // 透传后端 try/catch 返回的具体错误信息，并打到控制台便于排查
    console.error('[SalesOrderRelations] 加载失败:', err)
    const msg = err?.response?.data?.message || err?.message || '销售订单关联数据加载失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function search() { page.value = 1; void load() }
function resetFilters() {
  filters.keyword = ''
  filters.status = ''
  filters.dates = []
  filters.types = []
  search()
}
function visit(nodes: UiNode[], action: (node: UiNode) => void) { nodes.forEach(node => { action(node); visit(node.children, action) }) }
async function setExpanded(expanded: boolean) {
  await nextTick()
  visit(displayRoots.value, node => (tableRef.value as any)?.toggleRowExpansion?.(node, expanded))
}
function rowClassName({ row }: { row: UiNode }) { return row.relation_type === 'root' ? 'sales-order-root-row' : '' }

async function selectNode(row: UiNode) {
  selected.value = row
  detail.value = null
  detailLoading.value = true
  try {
    if (row.node_kind === 'doc') {
      const result = await scmApi.getDoc(row.entity_id)
      if (result.code === 0) detail.value = result.data
    } else if (row.node_kind === 'production_plan') {
      const result = await scmApi.getProductionPlan(row.entity_id)
      if (result.code === 0) detail.value = result.data
    } else if (row.node_kind === 'qc') {
      const result = await scmApi.getQcDoc(row.entity_id)
      if (result.code === 0) detail.value = result.data
    }
  } catch (err) {
    // 错误打到控制台便于排查；详情面板保持空白
    console.error('[SalesOrderRelations] 加载详情失败:', err)
    detail.value = null
  } finally {
    detailLoading.value = false
  }
}

function openNode(row: UiNode) {
  if (row.node_kind === 'doc') {
    router.push(row.doc_type === 'MRP'
      ? scmDownstreamMrpRoute(row.entity_id, row.status)
      : scmDownstreamDocRoute(row.entity_id, row.status))
  } else if (row.node_kind === 'production_plan') {
    router.push(scmDownstreamProductionPlanRoute(row.entity_id, row.status))
  } else if (row.node_kind === 'work_report') {
    router.push({ name: 'ScmWorkReport' })
  } else if (row.node_kind === 'qc') {
    router.push({ name: 'ScmQc' })
  }
}

onMounted(load)
</script>

<style scoped>
.sales-order-relations-page { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.page-header h2 { margin: 0; font-size: 20px; color: var(--el-text-color-primary); }
.page-header p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.filter-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.content-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-height: 0; }
.table-panel { min-width: 0; }
.type-cell { display: flex; align-items: center; gap: 7px; min-width: 0; }
.relation-text { color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; }
.relation-count { margin-left: 4px; }
.no-relations { color: var(--el-text-color-placeholder); font-size: 12px; font-weight: 400; }
.pagination-bar { display: flex; justify-content: flex-end; padding-top: 10px; }
.detail-panel { min-width: 0; max-height: 300px; overflow: auto; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-bg-color); padding: 14px; box-sizing: border-box; }
.detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.detail-header h3 { margin: 3px 0 0; font-size: 17px; }
.detail-kicker { color: var(--el-color-primary); font-size: 12px; }
.detail-panel h4 { margin: 18px 0 8px; }
.detail-actions { display: flex; justify-content: flex-end; padding-top: 16px; }
:deep(.sales-order-root-row > td.el-table__cell) { background: var(--el-color-primary-light-9) !important; font-weight: 600; }
@media (max-width: 900px) { .detail-panel :deep(.el-descriptions__table) { min-width: 720px; } }
</style>
