<template>
  <div class="print-wrap">
    <!-- 操作条（打印时隐藏） -->
    <div class="toolbar no-print">
      <el-button @click="goBack"><el-icon><Back /></el-icon>返回</el-button>
      <span class="t-title">对账单打印预览</span>
      <el-radio-group v-model="detailMode" size="small">
        <el-radio-button value="flat">逐笔明细（润衡）</el-radio-button>
        <el-radio-button value="summary">仅汇总</el-radio-button>
      </el-radio-group>
      <el-button type="primary" :disabled="loading" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="paper">
      <!-- 抬头 -->
      <div class="doc-header">
        <div class="company">{{ companyName }}</div>
        <div class="doc-title">{{ docTitle }}</div>
      </div>

      <!-- 表头信息（两行布局：客户名/对账日期 ｜ 期间/期初） -->
      <div class="meta-block">
        <div class="meta-row">
          <span class="meta-left"><b>{{ partnerLabelName }}：</b>{{ partnerLabel }}</span>
          <span class="meta-right"><b>对账日期：</b>{{ shortDate(today) }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-left"><b>对账期间：</b>{{ periodText }}</span>
          <span class="meta-right"><b>期初余额：</b>{{ money(opening) }}</span>
        </div>
      </div>

      <!-- 主表：润衡 15 列 -->
      <table class="lines">
        <thead>
          <tr>
            <th v-for="c in visibleColumns" :key="c.key" :class="thClass(c.key)">{{ thLabel(c.key) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" class="doc-row">
            <td v-for="c in visibleColumns" :key="c.key" :class="tdClass(c.key)">{{ tdValue(r, c.key) }}</td>
          </tr>
          <tr v-if="!rows.length" class="empty-row">
            <td :colspan="visibleCount">本期间无往来记录</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td :colspan="totalRowLeadSpan" class="t-sum">本期合计</td>
            <td v-if="col('qty')" class="c-num">{{ num(totalQty) }}</td>
            <td v-if="col('price')" class="c-num" />
            <td v-if="col('amount')" class="c-num">{{ money(totalAmountWithTax) }}</td>
            <!-- 极端情况：qty/price/amount 都被隐藏时，补一个占位 td 保证 colspan 之和正确 -->
            <td v-if="!col('qty') && !col('price') && !col('amount')" class="c-num" />
          </tr>
        </tfoot>
      </table>

      <div class="amount-cn"><b>期末余额（大写）：</b>{{ rmbUpper(closing) }}（¥{{ money(closing) }}）</div>

      <!-- 签字 -->
      <div class="signs">
        <span>制单：{{ maker }}</span>
        <span>复核：____________</span>
        <span>本单位（盖章）：____________</span>
        <span>对方单位（盖章）：____________</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi, type ScmPartner } from '@/api/scm'
import { useUserStore } from '@/stores/user'
import { rmbUpper } from '@/utils/rmbUpper'
import { useStatementColumns } from '@/composables/useStatementColumns'
import { statementRowSign } from '@/utils/statementRowSign'

// 打印页只读列设置（不在打印页修改，设置在查询页进行；两页共享 localStorage）
const { visibleColumns, col } = useStatementColumns()
const visibleCount = computed(() => visibleColumns.value.length)

/** 表头标签：单号列随方向变（出库单号/入库单号） */
function thLabel(key: string): string {
  if (key === 'docNo') return docNoLabel.value
  const found = visibleColumns.value.find(c => c.key === key)
  return found?.label ?? key
}
/** 表头/单元格 class：与原固定模板保持视觉一致 */
function thClass(key: string): string {
  const m: Record<string, string> = {
    cat: 'c-cat', docNo: 'c-no', docDate: 'c-date', invoiceType: 'c-inv',
    taxRate: 'c-rate', orderNo: 'c-order', extOrderNo: 'c-order',
    itemCode: 'c-item', itemName: 'c-name', spec: 'c-spec', unit: 'c-unit',
    refNo: 'c-ref', qty: 'c-num', price: 'c-num', amount: 'c-num',
  }
  return m[key] || ''
}
function tdClass(key: string): string {
  return thClass(key)
}
/** 单元格值 */
function tdValue(r: Row, key: string): string {
  switch (key) {
    case 'cat':         return r.catLabel
    case 'docNo':       return r.docNo
    case 'docDate':     return shortDate(r.docDate)
    case 'invoiceType': return r.invoiceType
    case 'taxRate':     return r.taxRate
    case 'orderNo':     return r.orderNo
    case 'extOrderNo':  return r.extOrderNo
    case 'itemCode':    return r.itemCode
    case 'itemName':    return r.itemName
    case 'spec':        return r.spec
    case 'unit':        return r.unit
    case 'refNo':       return r.refNo
    case 'qty':         return r.qtyText
    case 'price':       return r.priceText
    case 'amount':      return r.amountText
    default:            return ''
  }
}
/** 合计行前导 colspan = 可见列数 - (qty/price/amount 中可见的数量)；至少 1 */
const totalRowLeadSpan = computed(() => {
  const tail = (col('qty') ? 1 : 0) + (col('price') ? 1 : 0) + (col('amount') ? 1 : 0)
  const lead = visibleCount.value - tail
  return Math.max(1, lead)
})

const route = useRoute()
const router = useRouter()
const user = useUserStore()

const loading = ref(false)
// 打印模式：flat = 每条物料行展开（润衡原样）；summary = 仅汇总（一单一行）
const detailMode = ref<'flat' | 'summary'>('flat')
const opening = ref(0)
const closing = ref(0)
const detail = ref<any[]>([])
const partners = ref<ScmPartner[]>([])
const today = new Date().toISOString().slice(0, 10)

const partnerCode = computed(() => (route.query.partner_code as string) || '')
const startDate = computed(() => (route.query.start_date as string) || '')
const endDate = computed(() => (route.query.end_date as string) || '')
const arapQuery = computed(() => (route.query.arap_type as string) || '')

const companyName = computed(() => user.accountSetName || 'CW 财务记账系统')
const maker = computed(() => user.userInfo?.nickname || user.userInfo?.username || '')
const partner = computed(() => partners.value.find(x => x.code === partnerCode.value))
const partnerLabel = computed(() => {
  const p = partner.value
  return p ? `${p.code} ${p.name || ''}`.trim() : partnerCode.value
})

// 方向推断：route.query.arap_type 优先，其次按往来单位 partner_type 推断，再不济默认 ar
const direction = computed<'ar' | 'ap'>(() => {
  if (arapQuery.value === 'ar' || arapQuery.value === 'ap') return arapQuery.value
  const t = partner.value?.partner_type
  if (t === 'customer') return 'ar'
  if (t === 'supplier') return 'ap'
  // 按 detail 单据类型推断（看哪种方向的业务多）
  const types = detail.value.map((r: any) => r.doc_type)
  const arHit = types.filter(t => ['SO', 'SR', 'RS', 'RCV'].includes(t)).length
  const apHit = types.filter(t => ['PI', 'PR', 'RP', 'PAY', 'WI'].includes(t)).length
  if (arHit >= apHit && arHit > 0) return 'ar'
  if (apHit > 0) return 'ap'
  return 'ar'
})

const isAr = computed(() => direction.value === 'ar')
const docTitle = computed(() => (isAr.value ? '销售对账单' : '采购对账单'))
const docNoLabel = computed(() => (isAr.value ? '出库单号' : '入库单号'))
const partnerLabelName = computed(() => (isAr.value ? '客户名称' : '供应商名称'))

const CAT_LABELS_AR: Record<string, string> = {
  SO: '销售出库', SR: '销售退货', RS: '销售发票', RCV: '客户收款',
}
const CAT_LABELS_AP: Record<string, string> = {
  PI: '采购入库', PR: '采购退货', RP: '采购发票', PAY: '供应商付款', WI: '委外入库',
}

function catLabel(t: string) {
  return (isAr.value ? CAT_LABELS_AR : CAT_LABELS_AP)[t] || t
}

const periodText = computed(() => {
  if (startDate.value || endDate.value) return `${startDate.value || '起始'} ~ ${endDate.value || '至今'}`
  return '全部'
})

const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

/** 安全解析 field_values（后端可能给字符串或对象） */
function parseFieldValues(v: any): Record<string, any> {
  if (!v) return {}
  if (typeof v === 'string') { try { return JSON.parse(v) || {} } catch { return {} } }
  if (typeof v === 'object') return v
  return {}
}

interface Row {
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
  // 内部累计用
  _qty: number
  _amountWithTax: number
}

/** 把 detail 展平为润衡 15 列行：每条物料行=一行；无明细的单据占一行 */
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
      docNo: r.doc_no || '',
      docDate: r.doc_date || '',
      orderNo,
      extOrderNo,
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
          amountText: money(amountWithTax),
          ...base,
          _qty: qty * sign,
          _amountWithTax: amountWithTax,
        } as Row)
      }
    } else {
      // 无明细：收付款/退货/调整等单据占一行，金额用 doc 级金额
      const amountWithTax = Number(r.increase_amount) || Number(r.settlement_amount) || Number(r.adjustment_amount) || 0
      const signed = amountWithTax * statementRowSign(r)
      out.push({
        catLabel: catLabel(r.doc_type),
        invoiceType: docInvoice,
        taxRate: docTaxRate ? num(docTaxRate) : '',
        itemCode: '', itemName: '', spec: '', unit: '', refNo: '',
        qtyText: '',
        priceText: '',
        amountText: amountWithTax ? money(signed) : '',
        ...base,
        _qty: 0,
        _amountWithTax: signed,
      } as Row)
    }
  }
  return out
})

/** 汇总模式：一单一行（金额=该单 increase + adjustment - settlement，按方向取值） */
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
      amountText: money(net),
      _qty: 0,
      _amountWithTax: net,
    } as Row)
  }
  return out
})

const rows = computed<Row[]>(() => (detailMode.value === 'flat' ? flatRows.value : summaryRows.value))
const totalQty = computed(() => rows.value.reduce((s, r) => s + (Number(r._qty) || 0), 0))
const totalAmountWithTax = computed(() => rows.value.reduce((s, r) => s + (Number(r._amountWithTax) || 0), 0))

async function load() {
  if (!partnerCode.value) { ElMessage.warning('缺少往来单位参数'); return }
  loading.value = true
  try {
    const [pr, lr] = await Promise.all([
      scmApi.getPartners({}),
      scmApi.getPartnerLedger(partnerCode.value, {
        start_date: startDate.value || undefined,
        end_date: endDate.value || undefined,
        arap_type: (arapQuery.value || undefined) as 'ar' | 'ap' | undefined,
        with_lines: 1,
      }),
    ])
    if (pr.code === 0) partners.value = pr.data as ScmPartner[]
    if (lr.code === 0) {
      opening.value = lr.data.opening || 0
      closing.value = lr.data.closing || 0
      detail.value = lr.data.detail || []
    } else ElMessage.error(lr.message || '加载失败')
  } finally { loading.value = false }
}
function doPrint() { window.print() }
function goBack() { router.back() }
onMounted(load)
</script>

<style scoped>
.print-wrap { background: var(--el-bg-color-page, #f5f5f5); min-height: 100%; }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; position: sticky; top: 0; z-index: 2; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.t-title { font-weight: 600; }
.toolbar > .el-button:last-child { margin-left: auto; }

/* 横向 A4：润衡 15 列在 A4 纵向会过窄，使用横向更接近样例观感 */
.paper {
  width: 297mm; min-height: 180mm; margin: 16px auto; padding: 12mm 10mm;
  background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12);
  font-size: 12px;
}
.doc-header { text-align: center; margin-bottom: 6px; }
.company { font-size: 18px; font-weight: 700; }
.doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }

/* meta：两行，左/右两段 */
.meta-block { margin: 8px 0 6px; }
.meta-row { display: flex; justify-content: space-between; align-items: center; padding: 1px 0; }
.meta-left, .meta-right { flex: 1; }
.meta-right { text-align: right; }
.meta-block b { font-weight: 600; }

table.lines { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.lines th, table.lines td { border: 1px solid #000; padding: 2px 4px; line-height: 1.4; word-break: break-all; }
table.lines th { background: #f0f0f0; font-weight: 600; text-align: center; }
.doc-row td { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-row .c-num { text-align: right; white-space: nowrap; }
.doc-row .c-date, .doc-row .c-rate, .doc-row .c-unit { text-align: center; white-space: nowrap; }
.c-cat { width: 56px; }
.c-date { width: 60px; }
.c-inv { width: 64px; }
.c-rate { width: 42px; }
.c-order { width: 86px; }
.c-item { width: 110px; }
.c-name { width: 150px; }
.c-spec { width: 84px; }
.c-unit { width: 36px; }
.c-ref { width: 86px; }
.c-num { width: 78px; }
.c-no { width: 96px; }
.t-sum { text-align: center; font-weight: 600; }
tfoot td { font-weight: 600; }
.empty-row td { text-align: center; color: #666; }

.amount-cn { margin: 8px 0; }
.signs { display: flex; gap: 28px; margin-top: 22px; flex-wrap: wrap; }

@media print {
  .no-print { display: none !important; }
  .print-wrap { background: #fff; }
  .paper { width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; font-size: 11px; }
  /* 跨页表头重复：润衡多列长表打印时每页顶部自动重绘表头 */
  table.lines { table-layout: auto; }
  table.lines thead { display: table-header-group; }
  table.lines tfoot { display: table-footer-group; }
  table.lines tr { break-inside: avoid; page-break-inside: avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}
</style>
