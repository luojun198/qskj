<template>
  <div class="summary-result">
    <div class="result-toolbar">
      <el-radio-group v-model="viewMode" size="default">
        <el-radio-button value="flat">平铺（每个维度一列）</el-radio-button>
        <el-radio-button value="tree">树形</el-radio-button>
      </el-radio-group>
      <el-checkbox v-if="viewMode === 'flat' && dimCount > 1" v-model="showSubtotals">显示小计</el-checkbox>
      <el-button v-if="viewMode === 'tree'" plain :disabled="!hasData" @click="toggleExpand">
        {{ expandAll ? '全部收起' : '全部展开' }}
      </el-button>
      <el-button plain :disabled="!hasData" @click="handleExport"><el-icon><Download /></el-icon>导出</el-button>
      <el-button plain :disabled="!hasData" @click="printVisible = true"><el-icon><Printer /></el-icon>打印</el-button>
      <span class="tip">点击「明细」或双击分组行，可查看该分组的单据明细；平铺视图下可在维度列表头筛选</span>
    </div>

    <template v-if="report">
      <h4 class="report-title">
        {{ title }}
        <span class="subtitle">（{{ subtitle }}　单位：{{ unitLabel }}）</span>
      </h4>
      <el-alert v-if="report.truncated" type="warning" :closable="false" show-icon class="alert"
        title="分组数量过多，仅显示了部分分组，请缩小日期范围或增加筛选条件" />

      <!-- 平铺：每个汇总维度（含每个辅助类别）独立一列 -->
      <el-table
        v-if="hasData && viewMode === 'flat'"
        :data="flat"
        size="small" class="compact-data-table" border stripe
        show-summary :summary-method="summarize"
        :row-class-name="({ row }: any) => (row.kind === 'sub' ? 'sub-row' : '')"
        @row-dblclick="(row: any) => emit('drill', row.node)"
      >
        <el-table-column
          v-for="(dim, i) in report.group_by"
          :key="dim"
          :prop="`dim_${i}`"
          :min-width="i === 0 ? 170 : 140"
        >
          <template #header>
            <CashierHeaderFilter
              v-if="filterApi && filterApi.kindOf(dim)"
              :label="dimLabel(dim)"
              :kind="filterApi.kindOf(dim)!"
              :options="filterApi.kindOf(dim) === 'options' ? filterApi.optionsOf(dim) : undefined"
              :loader="filterApi.kindOf(dim) === 'remote' ? filterApi.loaderOf(dim) : undefined"
              :model-value="filterApi.valuesOf(dim)"
              @update:model-value="(v: any) => filterApi!.setValues(dim, v)"
              @change="emit('filter-change')"
            />
            <span v-else>{{ dimLabel(dim) }}</span>
          </template>
          <template #default="{ row }">
            <span :class="{ 'is-sub': row.kind === 'sub' }">{{ row.cells[i] }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="currencyMode === 'all' ? '收入（本位币）' : '收入'" prop="income" width="150" align="right">
          <template #default="{ row }"><span v-if="row.node.income" class="debit">{{ fmt(row.node.income) }}</span></template>
        </el-table-column>
        <el-table-column :label="currencyMode === 'all' ? '支出（本位币）' : '支出'" prop="expense" width="150" align="right">
          <template #default="{ row }"><span v-if="row.node.expense" class="credit">{{ fmt(row.node.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="净额" prop="net" width="150" align="right">
          <template #default="{ row }"><span :class="{ debit: row.node.net >= 0, credit: row.node.net < 0 }">{{ fmt(row.node.net) }}</span></template>
        </el-table-column>
        <el-table-column label="笔数" prop="count" width="80" align="right">
          <template #default="{ row }">{{ row.node.count }}</template>
        </el-table-column>
        <el-table-column label="收入占比" width="100" align="right">
          <template #default="{ row }">{{ pct(row.node.income_ratio) }}</template>
        </el-table-column>
        <el-table-column label="支出占比" width="100" align="right">
          <template #default="{ row }">{{ pct(row.node.expense_ratio) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }"><el-button link type="primary" size="small" @click="emit('drill', row.node)">明细</el-button></template>
        </el-table-column>
      </el-table>

      <!-- 树形：逐级展开 -->
      <el-table
        v-else-if="hasData"
        :key="tableKey"
        :data="rows"
        row-key="rowKey"
        :tree-props="{ children: 'children' }"
        :default-expand-all="expandAll"
        size="small" class="compact-data-table" border stripe
        show-summary :summary-method="summarize"
        @row-dblclick="(row: any) => emit('drill', row.node)"
      >
        <el-table-column :label="groupColumnLabel" min-width="260">
          <template #default="{ row }">
            <span :class="{ 'is-sub': row.children?.length }">{{ row.node.name }}</span>
            <el-tag v-if="row.children?.length" size="small" type="info" class="lvl-tag">{{ dimLabel(row.node.dimension) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="currencyMode === 'all' ? '收入（本位币）' : '收入'" prop="income" width="150" align="right">
          <template #default="{ row }"><span v-if="row.node.income" class="debit">{{ fmt(row.node.income) }}</span></template>
        </el-table-column>
        <el-table-column :label="currencyMode === 'all' ? '支出（本位币）' : '支出'" prop="expense" width="150" align="right">
          <template #default="{ row }"><span v-if="row.node.expense" class="credit">{{ fmt(row.node.expense) }}</span></template>
        </el-table-column>
        <el-table-column label="净额" prop="net" width="150" align="right">
          <template #default="{ row }"><span :class="{ debit: row.node.net >= 0, credit: row.node.net < 0 }">{{ fmt(row.node.net) }}</span></template>
        </el-table-column>
        <el-table-column label="笔数" prop="count" width="80" align="right">
          <template #default="{ row }">{{ row.node.count }}</template>
        </el-table-column>
        <el-table-column label="收入占比" width="100" align="right">
          <template #default="{ row }">{{ pct(row.node.income_ratio) }}</template>
        </el-table-column>
        <el-table-column label="支出占比" width="100" align="right">
          <template #default="{ row }">{{ pct(row.node.expense_ratio) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }"><el-button link type="primary" size="small" @click="emit('drill', row.node)">明细</el-button></template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="所选条件下没有数据" />
    </template>

    <HiprintDialog
      v-model="printVisible"
      template-type="ledger"
      :template-key="`cashier:summary:${title}`"
      :title="title"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Printer } from '@element-plus/icons-vue'
import type { CashierSummaryNode, CashierSummaryReport } from '@/api/cashier'
import CashierHeaderFilter from '@/components/cashier/CashierHeaderFilter.vue'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { flattenSummary } from '@/utils/cashierSummaryFlat'

interface FilterApi {
  kindOf: (dim: string) => 'options' | 'remote' | null
  valuesOf: (dim: string) => string[]
  setValues: (dim: string, values: string[]) => void
  optionsOf: (dim: string) => Array<{ value: string; label: string }>
  loaderOf: (dim: string) => (keyword: string) => Promise<Array<{ value: string; label: string }>>
}

const props = defineProps<{
  report: CashierSummaryReport | null
  title: string
  /** 筛选条件摘要（期间 / 科目 / 币种…） */
  subtitle: string
  unitLabel: string
  /** 维度标识 → 显示名（含辅助类别） */
  dimLabel: (dimension: string) => string
  /** 导出：请求体（与查询时完全一致） */
  exportParams: Record<string, unknown>
  exportFileName: string
  /** 维度列表头筛选（平铺视图）；不传则表头无筛选 */
  filterApi?: FilterApi
}>()
const emit = defineEmits<{ drill: [node: CashierSummaryNode]; 'filter-change': [] }>()

interface Row { rowKey: string; node: CashierSummaryNode; children?: Row[] }
interface FlatRow { kind: 'leaf' | 'sub'; node: CashierSummaryNode; cells: string[]; [k: string]: any }

const VIEW_KEY = 'cashier_summary_view_mode'
function loadViewMode(): 'flat' | 'tree' {
  try { return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'flat' } catch { return 'flat' }
}
const viewModeRef = ref<'flat' | 'tree'>(loadViewMode())
const viewMode = computed({
  get: () => viewModeRef.value,
  set: v => {
    viewModeRef.value = v
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* 存储不可用时忽略 */ }
  },
})
const showSubtotals = ref(true)
const expandAll = ref(true)
const printVisible = ref(false)
const tableKey = ref(0)

const currencyMode = computed(() => props.report?.currency_mode || 'single')
const hasData = computed(() => !!props.report && (props.report.root.children?.length ?? 0) > 0)
const dimCount = computed(() => props.report?.group_by.length ?? 0)
const groupColumnLabel = computed(() => (props.report?.group_by || []).map(d => props.dimLabel(d)).join(' / ') || '分组')

function toRows(nodes: CashierSummaryNode[] | undefined, prefix: string): Row[] | undefined {
  if (!nodes?.length) return undefined
  return nodes.map(n => {
    const rowKey = `${prefix}/${n.key}`
    return { rowKey, node: n, children: toRows(n.children, rowKey) }
  })
}
const rows = computed<Row[]>(() => toRows(props.report?.root.children, '') || [])

const buildFlat = (showSub: boolean): FlatRow[] =>
  props.report ? (flattenSummary(props.report.root, props.report.group_by.length, showSub) as FlatRow[]) : []
const flat = computed<FlatRow[]>(() => buildFlat(showSubtotals.value))

const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (r: number) => (r ? `${(r * 100).toFixed(1)}%` : '')

function toggleExpand() {
  expandAll.value = !expandAll.value
  tableKey.value++ // 树表的默认展开只在创建时生效，换 key 重建
}

/** 合计行：按列 prop 取值，平铺 / 树形共用 */
function summarize({ columns }: any) {
  const t = props.report?.root
  return columns.map((col: any, i: number) => {
    if (i === 0) return '合计'
    if (!t) return ''
    switch (col.property) {
      case 'income': return fmt(t.income)
      case 'expense': return fmt(t.expense)
      case 'net': return fmt(t.net)
      case 'count': return String(t.count)
      default: return ''
    }
  })
}

function buildPrintHtml() {
  const r = props.report
  if (!r) return ''
  const list = buildFlat(showSubtotals.value || r.group_by.length === 1)
  const dash = (n: number) => (n ? fmt(n) : '')
  const t = r.root
  const columns: any[] = [
    ...r.group_by.map((d, i) => ({ label: props.dimLabel(d), render: (x: FlatRow) => x.cells[i] })),
    { label: '收入', align: 'right', render: (x: FlatRow) => dash(x.node.income) },
    { label: '支出', align: 'right', render: (x: FlatRow) => dash(x.node.expense) },
    { label: '净额', align: 'right', render: (x: FlatRow) => fmt(x.node.net) },
    { label: '笔数', align: 'right', render: (x: FlatRow) => String(x.node.count) },
    { label: '收入占比', align: 'right', render: (x: FlatRow) => pct(x.node.income_ratio) },
    { label: '支出占比', align: 'right', render: (x: FlatRow) => pct(x.node.expense_ratio) },
  ]
  return buildTablePrintHtml<FlatRow>({
    title: props.title,
    subtitle: `${props.subtitle}　单位：${props.unitLabel}`,
    rows: list,
    monochrome: true,
    fitToPage: true,
    rowStyle: x => (x.kind === 'sub' ? 'font-weight:600;' : ''),
    columns,
    footer: ['合计', ...Array(r.group_by.length - 1).fill(''), fmt(t.income), fmt(t.expense), fmt(t.net), String(t.count), '', ''],
  })
}

async function handleExport() {
  const r = props.report
  if (!r || !hasData.value) return ElMessage.warning('暂无数据可导出')
  const dims = r.group_by
  const columns: ExportColumnDef<any>[] = [
    ...dims.map((d, i) => ({ key: `dim_${i}`, label: props.dimLabel(d), width: i === 0 ? 180 : 150 })) as ExportColumnDef<any>[],
    { key: 'income', label: '收入', width: 130, align: 'right', type: 'amount' },
    { key: 'expense', label: '支出', width: 130, align: 'right', type: 'amount' },
    { key: 'net', label: '净额', width: 130, align: 'right', type: 'amount' },
    { key: 'count', label: '笔数', width: 70, align: 'right' },
    { key: 'income_ratio', label: '收入占比(%)', width: 100, align: 'right' },
    { key: 'expense_ratio', label: '支出占比(%)', width: 100, align: 'right' },
  ]
  await exportStyledTableViaSource({
    fileName: props.exportFileName,
    sheetName: props.title,
    title: props.title,
    subtitle: `${props.subtitle}　（单位：${props.unitLabel}）`,
    columns,
    source: { type: 'cashierSummary', params: { ...props.exportParams, group_by: dims } },
  })
}
</script>

<style scoped>
.summary-result { padding: 4px 16px 16px; flex: 1; overflow: auto; }
.result-toolbar { display: flex; align-items: center; gap: 10px; margin: 4px 0 8px; flex-wrap: wrap; }
.tip { font-size: 12px; color: var(--el-text-color-placeholder); }
.report-title { margin: 0 0 10px; font-size: var(--cw-text-xl); text-align: center; }
.subtitle { font-size: 12px; color: var(--el-text-color-secondary); font-weight: 400; }
.alert { margin-bottom: 8px; }
.is-sub { font-weight: 600; }
.lvl-tag { margin-left: 6px; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
:deep(.sub-row td) { background: var(--el-fill-color-light) !important; font-weight: 600; }
</style>
