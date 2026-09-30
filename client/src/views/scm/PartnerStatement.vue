<template>
  <div class="page scm-statement-page">
    <!-- 列设置按钮投递到顶部多标签栏右侧 -->
    <Teleport v-if="ptActive" defer to="#tabbar-actions">
      <el-button size="small" plain @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
    </Teleport>

    <div class="filter-row">
      <el-radio-group v-model="arapType" size="small" @change="load">
        <el-radio-button value="">全部往来</el-radio-button>
        <el-radio-button value="ar">应收</el-radio-button>
        <el-radio-button value="ap">应付</el-radio-button>
      </el-radio-group>
      <el-select v-model="partnerCode" filterable clearable placeholder="全部往来单位" style="width:220px" size="small" @change="load">
        <el-option v-for="p in partners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width:140px" size="small" />
      <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width:140px" size="small" />
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
      <el-button size="small" :disabled="isAll" @click="toggleDetailMode">
        {{ detailMode === 'flat' ? '当前：逐笔明细（润衡）' : '当前：仅汇总' }} · 切换
      </el-button>
      <el-button type="success" plain size="small" :disabled="isAll" @click="printStatement">
        <el-icon><Printer /></el-icon>打印对账单
      </el-button>
      <el-button type="success" plain size="small" :disabled="!rows.length" @click="exportStatement">导出Excel</el-button>
      <span class="total-hint" v-if="isAll">共 {{ detail.length }} 笔</span>
      <span class="total-hint" v-else>期初 {{ fmt(opening) }}　期末 {{ fmt(closing) }}　<span v-if="detailMode==='flat'">数量合计 {{ num(totalQty) }}　含税金额合计 {{ fmt(totalAmountWithTax) }}</span></span>
    </div>

    <div class="page-body">
      <el-empty v-if="isAll && !detail.length"
        description="请先选择往来单位再查询（对账单默认按单个往来单位出具）" />
      <el-table v-else ref="tableRef" :data="rows" v-loading="loading" border stripe size="small" height="100%" show-summary
        :span-method="tableSpanMethod as any"
        :cell-class-name="statementCellClassName"
        :summary-method="(summaryMethod as any)" @header-dragend="onDragEnd">
        <el-table-column type="index" label="序号" width="54" fixed align="center" />
        <el-table-column v-if="isAll" label="往来单位" column-key="partner" min-width="160" show-overflow-tooltip fixed class-name="doc-header-cell">
          <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
        </el-table-column>
        <el-table-column v-for="column in visibleColumns" :key="column.key" :label="statementColumnLabel(column.key, column.label)"
          :column-key="column.key" :width="cw(column.key, statementColumnWidth(column.key))"
          :min-width="column.key === 'itemName' ? 160 : undefined" :align="statementColumnAlign(column.key)" show-overflow-tooltip>
          <template #default="{ row }"><span :class="{ amt: column.key === 'amount' }">{{ statementCellText(row, column.key) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right" align="center" class-name="action-col">
          <template #default="{ row }">
            <ScmDocActions v-if="row.doc" :row="row.doc" @changed="load" />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettings" @update:columns="setColumns" @reset="resetColumns" />
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Printer, Setting } from '@element-plus/icons-vue'
import { scmApi, type ScmPartner } from '@/api/scm'
import ScmDocActions from '@/components/scm/ScmDocActions.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { useStatementColumns } from '@/composables/useStatementColumns'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { getStatementRowSpan } from '@/utils/statementRowSpan'
import { statementRowSign } from '@/utils/statementRowSign'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'

const { ptActive } = usePageToolbarTeleport()
const { columnSettings, visibleColumns, setColumns, reset } = useStatementColumns()
const columnDialogVisible = ref(false)

// 列宽拖动记忆（与 DocList 一致：tableRef + @header-dragend + :width=cw(key, fallback)）
const { tableRef, colWidth, onDragEnd } = useListColumnWidth('scm_arap_stmt')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

function resetColumns() { reset() }
const STATEMENT_COLUMN_WIDTHS: Record<string, number> = { cat: 80, docNo: 120, docDate: 78, invoiceType: 90, taxRate: 56, orderNo: 110, extOrderNo: 110, itemCode: 120, itemName: 200, spec: 100, unit: 50, refNo: 100, qty: 80, price: 90, amount: 110 }
function statementColumnWidth(key: string) { return STATEMENT_COLUMN_WIDTHS[key] || 100 }
function statementColumnAlign(key: string) { return ['taxRate', 'qty', 'price', 'amount'].includes(key) ? 'right' : key === 'unit' ? 'center' : undefined }
function statementColumnLabel(key: string, label: string) { return key === 'docNo' ? docNoLabel.value : label }
function statementCellText(row: any, key: string) {
  if (key === 'cat') return row.catLabel
  if (key === 'docDate') return shortDate(row.docDate)
  if (key === 'qty') return row.qtyText
  if (key === 'price') return row.priceText
  if (key === 'amount') return row.amountText
  return row[key] ?? ''
}

const route = useRoute()
const router = useRouter()
const partners = ref<ScmPartner[]>([])
const partnerCode = ref<string>((route.query.partner_code as string) || '')
const arapType = ref<'' | 'ar' | 'ap'>('')
const startDate = ref('')
const endDate = ref('')
const loading = ref(false)
const { clearFilters } = useFilterClear([partnerCode, arapType, startDate, endDate])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  load()
}
const opening = ref(0)
const closing = ref(0)
const totalIn = ref(0)
const totalOut = ref(0)
const detail = ref<any[]>([])
// 展示模式：flat=逐笔明细（润衡原样，默认）；summary=一单一行汇总
const detailMode = ref<'flat' | 'summary'>('flat')
const isAll = computed(() => !partnerCode.value)

const partner = computed(() => partners.value.find(p => p.code === partnerCode.value))

// 方向推断（用于标题/列名/类别标签）
const direction = computed<'ar' | 'ap'>(() => {
  if (arapType.value === 'ar' || arapType.value === 'ap') return arapType.value
  const t = partner.value?.partner_type
  if (t === 'customer') return 'ar'
  if (t === 'supplier') return 'ap'
  const types = detail.value.map((r: any) => r.doc_type)
  const arHit = types.filter(t => ['SO', 'SR', 'RS', 'RCV'].includes(t)).length
  const apHit = types.filter(t => ['PI', 'PR', 'RP', 'PAY', 'WI'].includes(t)).length
  if (arHit >= apHit && arHit > 0) return 'ar'
  if (apHit > 0) return 'ap'
  return 'ar'
})
const isAr = computed(() => direction.value === 'ar')
const docNoLabel = computed(() => (isAr.value ? '出库单号' : '入库单号'))
const mergedHeaderLabels = computed(() => new Set([
  '往来单位', '类别', docNoLabel.value, '日期', '发票种类', '税率%', '订单编号', '对方订单号',
]))

function statementCellClassName({ column, row }: { column: { label?: string }; row: Row }) {
  if (row.__summary || !mergedHeaderLabels.value.has(String(column.label || ''))) return ''
  return 'doc-header-cell'
}

const CAT_LABELS_AR: Record<string, string> = {
  SO: '销售出库', SR: '销售退货', RS: '销售发票', RCV: '客户收款',
}
const CAT_LABELS_AP: Record<string, string> = {
  PI: '采购入库', PR: '采购退货', RP: '采购发票', PAY: '供应商付款', WI: '委外入库',
}
function catLabel(t: string) {
  return (isAr.value ? CAT_LABELS_AR : CAT_LABELS_AP)[t] || t
}

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }

/** 含税单价：保留 4 位小数并去尾 0（润衡样例 0.11 / 0.125 / 0.09） */
function priceText(amount: number, tax: number, qty: number): string {
  const total = (Number(amount) || 0) + (Number(tax) || 0)
  if (!qty) return ''
  const p = total / qty
  if (!isFinite(p)) return ''
  return p.toFixed(4).replace(/\.?0+$/, '')
}

/** YY.M.D 短日期（润衡样例 26.6.15） */
function shortDate(d?: string): string {
  if (!d) return ''
  const m = String(d).match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return d
  const yy = m[1].length === 4 ? m[1].slice(2) : m[1]
  return `${yy}.${Number(m[2])}.${Number(m[3])}`
}

function parseFieldValues(v: any): Record<string, any> {
  if (!v) return {}
  if (typeof v === 'string') { try { return JSON.parse(v) || {} } catch { return {} } }
  if (typeof v === 'object') return v
  return {}
}

interface Row {
  __summary?: boolean
  docKey: string
  catLabel: string
  docNo: string
  docDate: string
  invoiceType: string
  taxRate: string
  orderNo: string
  extOrderNo: string
  itemCode: string
  itemName: string
  spec: string
  unit: string
  refNo: string
  qtyText: string
  priceText: string
  amountText: string
  partner_code?: string
  partner_name?: string
  doc?: any
  _qty: number
  _amountWithTax: number
}

/** 逐笔明细：每条物料行单独成行（润衡原样） */
const flatRows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const r of detail.value as any[]) {
    const doc = r.doc || {}
    const fv = parseFieldValues(doc.field_values)
    const orderNo = doc.order_no || doc.sales_order_no || fv.order_no || fv.cust_order_no || fv.orderNo || ''
    const extOrderNo = fv.external_order_no || doc.external_order_no || doc.contract_no || ''
    const docTaxRate = Number(doc.tax_rate) || 0
    const docInvoice = doc.invoice_type || ''
    const base = {
      docKey: doc.id || `${r.doc_type || ''}:${r.doc_no || ''}:${r.doc_date || ''}:${r.partner_code || ''}`,
      docNo: r.doc_no || '',
      docDate: r.doc_date || '',
      orderNo,
      extOrderNo,
      partner_code: r.partner_code,
      partner_name: r.partner_name,
      doc,
    }
    const lines = doc.lines as any[] | undefined
    if (lines && lines.length) {
      for (const l of lines) {
        const qty = Number(l.qty) || 0
        const amt = Number(l.amount) || 0
        const tax = Number(l.tax_amount) || 0
        const lineRate = l.tax_rate != null ? Number(l.tax_rate) : docTaxRate
        const sign = statementRowSign(r)
        const amountWithTax = (amt + tax) * sign
        out.push({
          catLabel: catLabel(r.doc_type),
          invoiceType: docInvoice,
          taxRate: num(lineRate),
          itemCode: l.item_code || '',
          itemName: l.item_name || '',
          spec: l.spec || '',
          unit: l.unit || '',
          refNo: l.ref_no || '',
          qtyText: num(qty * sign),
          priceText: priceText(amt, tax, qty),
          amountText: amountWithTax ? fmt(amountWithTax) : '',
          ...base,
          _qty: qty * sign,
          _amountWithTax: amountWithTax,
        } as Row)
      }
    } else {
      const amountWithTax = Number(r.increase_amount) || Number(r.settlement_amount) || Number(r.adjustment_amount) || 0
      const signed = amountWithTax * statementRowSign(r)
      out.push({
        catLabel: catLabel(r.doc_type),
        invoiceType: docInvoice,
        taxRate: docTaxRate ? num(docTaxRate) : '',
        itemCode: '', itemName: '', spec: '', unit: '', refNo: '',
        qtyText: '',
        priceText: '',
        amountText: amountWithTax ? fmt(signed) : '',
        ...base,
        _qty: 0,
        _amountWithTax: signed,
      } as Row)
    }
  }
  return out
})

/** 汇总模式：一单一行（金额 = increase − adjustment − settlement） */
const summaryRows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const r of detail.value as any[]) {
    const doc = r.doc || {}
    const fv = parseFieldValues(doc.field_values)
    const orderNo = doc.order_no || doc.sales_order_no || fv.order_no || fv.cust_order_no || fv.orderNo || ''
    const docTaxRate = Number(doc.tax_rate) || 0
    const increase = Number(r.increase_amount) || 0
    const settlement = Number(r.settlement_amount) || 0
    const adjustment = Number(r.adjustment_amount) || 0
    const net = increase - adjustment - settlement  // 调整项（退货）与结算项都是减少（FIX-214）
    out.push({
      docKey: doc.id || `${r.doc_type || ''}:${r.doc_no || ''}:${r.doc_date || ''}:${r.partner_code || ''}`,
      catLabel: catLabel(r.doc_type),
      docNo: r.doc_no || '',
      docDate: r.doc_date || '',
      invoiceType: doc.invoice_type || '',
      taxRate: docTaxRate ? num(docTaxRate) : '',
      orderNo,
      extOrderNo: fv.external_order_no || doc.external_order_no || doc.contract_no || '',
      itemCode: '', itemName: '', spec: '', unit: '', refNo: '',
      qtyText: '',
      priceText: '',
      amountText: fmt(net),
      partner_code: r.partner_code,
      partner_name: r.partner_name,
      doc,
      _qty: 0,
      _amountWithTax: net,
    } as Row)
  }
  return out
})

const rows = computed<Row[]>(() => (detailMode.value === 'flat' ? flatRows.value : summaryRows.value))
const totalQty = computed(() => rows.value.reduce((s, r) => s + (Number(r._qty) || 0), 0))
const totalAmountWithTax = computed(() => rows.value.reduce((s, r) => s + (Number(r._amountWithTax) || 0), 0))

function tableSpanMethod({ rowIndex, column }: { rowIndex: number; column: { columnKey?: string } }) {
  if (detailMode.value !== 'flat') return [1, 1]
  return getStatementRowSpan(rows.value, rowIndex, column.columnKey)
}

/** el-table 合计行 */
const summaryMethod = ({ columns, data }: { columns: any[]; data: any[] }) => {
  const sums: (string | number)[] = []
  columns.forEach((col, idx) => {
    if (idx === 0) { sums[idx] = '合计'; return }
    // 找到「数量」「金额」列：通过列 prop 不存在，用 label 匹配
    const label = col.label
    if (label === '数量') {
      sums[idx] = num((data as Row[]).reduce((s, r) => s + (Number(r._qty) || 0), 0))
    } else if (label === '金额') {
      sums[idx] = fmt((data as Row[]).reduce((s, r) => s + (Number(r._amountWithTax) || 0), 0))
    } else {
      sums[idx] = ''
    }
  })
  return sums
}

function toggleDetailMode() {
  detailMode.value = detailMode.value === 'flat' ? 'summary' : 'flat'
}

async function loadPartners() {
  const r = await scmApi.getPartners({})
  if (r.code === 0) partners.value = r.data as ScmPartner[]
}

async function load() {
  loading.value = true
  try {
    const params = { start_date: startDate.value || undefined, end_date: endDate.value || undefined, arap_type: arapType.value || undefined, with_lines: 1 as const }
    if (partnerCode.value) {
      const r = await scmApi.getPartnerLedger(partnerCode.value, params)
      if (r.code === 0) {
        opening.value = r.data.opening || 0
        closing.value = r.data.closing || 0
        detail.value = r.data.detail || []
      }
    } else {
      // 不选往来单位 → 查全部往来（仅屏幕浏览，不支持打印）
      const r = await scmApi.getAllPartnerLedger(params)
      if (r.code === 0) {
        totalIn.value = r.data.total_in || 0
        totalOut.value = r.data.total_out || 0
        detail.value = r.data.detail || []
      }
    }
  } finally {
    loading.value = false
  }
}

// 打印对账单：须先选定往来单位，跳转独立打印页
function printStatement() {
  if (!partnerCode.value) return
  router.push({
    name: 'ScmPartnerStatementPrint',
    query: {
      partner_code: partnerCode.value,
      start_date: startDate.value || undefined,
      end_date: endDate.value || undefined,
      arap_type: arapType.value || undefined,
    },
  })
}

async function exportStatement() {
  const partner = partners.value.find(row => row.code === partnerCode.value)
  const titlePrefix = isAr.value ? '销售对账单' : '采购对账单'
  const partnerLabelName = isAr.value ? '客户名称' : '供应商名称'
  const exportRows = rows.value
  // 按可见列动态生成 columns 与 summaryValues（与屏幕表格一致）
  const labelMap: Record<string, string> = { docNo: docNoLabel.value }
  const widthMap: Record<string, number> = {
    cat: 80, docNo: 120, docDate: 80, invoiceType: 90, taxRate: 56,
    orderNo: 110, extOrderNo: 110, itemCode: 120, itemName: 160,
    spec: 100, unit: 50, refNo: 100, qty: 80, price: 90, amount: 110,
  }
  const valueMap: Record<string, (r: Row) => string | number | null | undefined> = {
    cat: r => r.catLabel || '',
    docNo: r => r.docNo || '',
    docDate: r => shortDate(r.docDate),
    invoiceType: r => r.invoiceType || '',
    taxRate: r => r.taxRate || '',
    orderNo: r => r.orderNo || '',
    extOrderNo: r => r.extOrderNo || '',
    itemCode: r => r.itemCode || '',
    itemName: r => r.itemName || '',
    spec: r => r.spec || '',
    unit: r => r.unit || '',
    refNo: r => r.refNo || '',
    qty: r => Number(r._qty) || 0,
    price: r => r.priceText || '',
    amount: r => Number(r._amountWithTax) || 0,
  }
  const alignMap: Record<string, 'left' | 'center' | 'right'> = {
    taxRate: 'right', unit: 'center', qty: 'right', price: 'right', amount: 'right',
  }
  const typeMap: Record<string, 'text' | 'amount' | 'number' | 'integer'> = {
    qty: 'number', amount: 'amount',
  }
  const columns = visibleColumns.value.map(c => ({
    label: labelMap[c.key] ?? c.label,
    width: widthMap[c.key],
    align: alignMap[c.key],
    type: typeMap[c.key],
    value: valueMap[c.key],
  }))
  // summaryValues：与可见列对齐；数量列填数量合计，金额列填金额合计，其余空
  const summaryValues: (string | number | null)[] = visibleColumns.value.map(c => {
    if (c.key === 'qty') return num(totalQty.value)
    if (c.key === 'amount') return Number(totalAmountWithTax.value.toFixed(2))
    return ''
  })
  await exportStyledTable({
    fileName: `${titlePrefix}_${partnerCode.value || '全部'}_${todayStr()}.xlsx`,
    sheetName: titlePrefix,
    title: titlePrefix,
    subtitle: `${partnerLabelName}：${partner ? `${partner.code} ${partner.name}` : '全部往来单位'}    对账期间：${startDate.value || '起始'} ~ ${endDate.value || '至今'}    期初余额：${fmt(opening.value)}`,
    rows: exportRows,
    stripe: true,
    summaryValues,
    columns,
  })
}

onMounted(async () => {
  await loadPartners()
  // 对账单默认按单个往来单位出具，未选单位不自动查全部（含明细数据量大）
  if (partnerCode.value) load()
})
</script>

<style scoped>
.scm-statement-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.total-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.page-body { flex: 1; min-height: 0; }
.amt { font-weight: 600; }
/* 合并表头字段固定在首条明细行，避免浏览器对 rowspan 单元格做整块垂直居中。 */
:deep(.el-table td.doc-header-cell.el-table__cell) { position: relative; vertical-align: top !important; }
:deep(.el-table td.doc-header-cell.el-table__cell > .cell) {
  position: absolute;
  inset: 0 0 auto;
  height: 40px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}
</style>
