<template>
  <div class="scm-paper">
    <!-- 抬头 -->
    <div class="doc-header">
      <div class="company">{{ companyName }}</div>
      <div class="doc-title">{{ title }}</div>
    </div>

    <!-- 表头信息 -->
    <div class="meta">
      <span><b>单据号：</b>{{ doc.doc_no }}</span>
      <span><b>日期：</b>{{ doc.doc_date }}</span>
      <span v-if="partnerLabel"><b>{{ partnerCaption }}：</b>{{ partnerLabel }}</span>
      <span v-if="doc.warehouse_name || doc.warehouse_code"><b>仓库：</b>{{ doc.warehouse_name || doc.warehouse_code }}</span>
      <span v-if="isTransfer && doc.dest_warehouse_name"><b>调入仓：</b>{{ doc.dest_warehouse_name }}</span>
      <span v-if="doc.biz_person"><b>业务员：</b>{{ doc.biz_person }}</span>
      <template v-for="f in headerCustomFields" :key="f.field_key">
        <span v-if="cfVal(f.field_key) !== ''"><b>{{ f.field_name }}：</b>{{ cfVal(f.field_key) }}</span>
      </template>
    </div>

    <!-- 明细表（组装单拆成 成品 / 子件 两张表）-->
    <template v-for="grp in lineGroups" :key="grp.key">
      <div v-if="grp.title" class="lines-group-title">{{ grp.title }}</div>
      <table class="lines">
        <thead>
          <tr>
            <th class="c-idx">#</th>
            <th class="c-code">物料编码</th>
            <th class="c-name">物料名称</th>
            <th class="c-spec">规格</th>
            <th class="c-unit">单位</th>
            <th class="c-num">数量</th>
            <template v-if="layout === 'standard'">
              <th class="c-num">单价</th>
              <th class="c-num">金额</th>
              <th v-if="hasTax" class="c-num">税率%</th>
              <th v-if="hasTax" class="c-num">税额</th>
            </template>
            <template v-else-if="layout === 'tax'">
              <th class="c-num">含税单价</th>
              <th v-if="hasTax" class="c-num">税率%</th>
              <th class="c-num">价税合计</th>
            </template>
            <th class="c-remark">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in grp.rows" :key="i">
            <td class="c-idx">{{ i + 1 }}</td>
            <td class="c-code">{{ l.item_code }}</td>
            <td class="c-name">{{ l.item_name || '' }}</td>
            <td class="c-spec">{{ l.spec || '' }}</td>
            <td class="c-unit">{{ l.unit || '' }}</td>
            <td class="c-num">{{ qtyP(l.qty) }}</td>
            <template v-if="layout === 'standard'">
              <td class="c-num">{{ priceP(l.price) }}</td>
              <td class="c-num">{{ money(l.amount) }}</td>
              <td v-if="hasTax" class="c-num">{{ num(l.tax_rate) }}</td>
              <td v-if="hasTax" class="c-num">{{ money(l.tax_amount) }}</td>
            </template>
            <template v-else-if="layout === 'tax'">
              <td class="c-num">{{ priceP(taxPrice(l)) }}</td>
              <td v-if="hasTax" class="c-num">{{ num(l.tax_rate) }}</td>
              <td class="c-num">{{ money(withTax(l)) }}</td>
            </template>
            <td class="c-remark">{{ l.remark || '' }}</td>
          </tr>
          <!-- 补空行至少 6 行，版面整齐（组装单不补）-->
          <tr v-for="n in blankCount(grp.rows)" :key="'b' + n" class="blank">
            <td class="c-idx">{{ grp.rows.length + n }}</td>
            <td v-for="c in colCount - 1" :key="c" />
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td :colspan="5" class="t-sum">合计</td>
            <td class="c-num">{{ qtyP(sumQty(grp.rows)) }}</td>
            <template v-if="layout === 'standard'">
              <td class="c-num" />
              <td class="c-num">{{ money(sumAmount(grp.rows)) }}</td>
              <td v-if="hasTax" class="c-num" />
              <td v-if="hasTax" class="c-num">{{ money(sumTax(grp.rows)) }}</td>
            </template>
            <template v-else-if="layout === 'tax'">
              <td class="c-num" />
              <td v-if="hasTax" class="c-num" />
              <td class="c-num">{{ money(sumAmount(grp.rows) + sumTax(grp.rows)) }}</td>
            </template>
            <td class="c-remark" />
          </tr>
        </tfoot>
      </table>
    </template>

    <div v-if="layout !== 'delivery'" class="amount-cn"><b>金额大写：</b>{{ rmbUpper(totalAmount + (hasTax ? totalTax : 0)) }}</div>

    <!-- 表尾自定义字段 -->
    <div v-if="footerCustomFields.length" class="footer-fields">
      <template v-for="f in footerCustomFields" :key="f.field_key">
        <span v-if="cfVal(f.field_key) !== ''"><b>{{ f.field_name }}：</b>{{ cfVal(f.field_key) }}</span>
      </template>
    </div>

    <!-- 签字 -->
    <div v-if="layout === 'delivery'" class="signs signs--delivery">
      <span>制单：{{ doc.maker || '' }}</span>
      <span>送货人：__________</span>
      <span>收货人签字：__________</span>
      <span>收货日期：____年__月__日</span>
    </div>
    <div v-else class="signs">
      <span>制单：{{ doc.maker || '' }}</span>
      <span>审核：{{ doc.auditor || '' }}</span>
      <span>状态：{{ doc.status === 'audited' ? '已审核' : '草稿' }}</span>
      <span>打印时间：{{ printedAt }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 进销存单据打印版面（单张打印、批量打印共用）。
 * 第五份反馈「单据打印有多种模版如何切换」：内置三种版式，打印页顶部下拉切换、按单据类型记默认。
 *   standard 标准（不含税单价 / 金额 / 税额）；tax 含税价（含税单价 / 价税合计）；delivery 送货单（不显示价格，带签收栏）
 */
import { computed } from 'vue'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { useUserStore } from '@/stores/user'
import { DOC_TITLE } from '@/utils/scmDoc'
import { rmbUpper } from '@/utils/rmbUpper'
import type { ScmPrintLayout } from '@/utils/scmPrintLayout'

const props = withDefaults(defineProps<{ doc: any; layout?: ScmPrintLayout; fieldDefs?: any[] }>(), {
  layout: 'standard',
  fieldDefs: () => [],
})

const user = useUserStore()
const printedAt = new Date().toLocaleString('zh-CN')

const headerCustomFields = computed(() => props.fieldDefs.filter((f: any) => f.position !== 'footer'))
const footerCustomFields = computed(() => props.fieldDefs.filter((f: any) => f.position === 'footer'))
function cfVal(key: string): string {
  let fv: any = props.doc?.field_values
  if (typeof fv === 'string') { try { fv = JSON.parse(fv) } catch { fv = {} } }
  const v = (fv || {})[key]
  return v == null ? '' : String(v)
}

const companyName = computed(() => user.accountSetName || 'CW 财务记账系统')
const title = computed(() => {
  const base = DOC_TITLE[props.doc?.doc_type] || '单据'
  const name = base.endsWith('单') ? base : base + '单'
  return props.layout === 'delivery' && ['SO', 'SOa'].includes(props.doc?.doc_type) ? '送货单' : name
})
const isTransfer = computed(() => props.doc?.doc_type === 'TR')
// 采购类显示「供应商」，销售类显示「客户」，其余「往来单位」
const partnerCaption = computed(() => {
  const t = props.doc?.doc_type
  if (['PQ', 'PO', 'PI', 'PR', 'RP', 'WO', 'WI'].includes(t)) return '供应商'
  if (['SQ', 'SOa', 'SO', 'SR', 'RS'].includes(t)) return '客户'
  return '往来单位'
})
const partnerLabel = computed(() => props.doc?.partner_name || props.doc?.partner_code || '')
const hasTax = computed(() => (props.doc?.lines || []).some((l: any) => Number(l.tax_rate) > 0 || Number(l.tax_amount) > 0))

// 组装单（AS）：成品 / 子件 分成两张表打印；其它单据一张表
const isAssembly = computed(() => props.doc?.doc_type === 'AS')
const lineGroups = computed(() => {
  const all: any[] = props.doc?.lines || []
  if (!isAssembly.value) return [{ key: 'all', title: '', rows: all }]
  const products = all.filter(l => l.line_role === 'product')
  const comps = all.filter(l => l.line_role !== 'product')
  const groups: any[] = [{ key: 'product', title: '成品（入库）', rows: products }]
  // 多成品且子件都带分组 → 子件按成品分列打印；否则一张子件表
  const grouped = comps.length > 0 && comps.every(c => c.product_group != null) && products.every(p => p.product_group != null)
  if (grouped && products.length > 1) {
    for (const p of products) {
      groups.push({
        key: 'c' + p.product_group,
        title: '子件 · ' + (p.item_name || p.item_code || '成品'),
        rows: comps.filter(c => c.product_group === p.product_group),
      })
    }
  } else {
    groups.push({ key: 'component', title: '子件（出库）', rows: comps })
  }
  return groups
})

/** 表格总列数（补空行用） */
const colCount = computed(() => {
  const base = 7 // # 编码 名称 规格 单位 数量 备注
  if (props.layout === 'standard') return base + 2 + (hasTax.value ? 2 : 0)
  if (props.layout === 'tax') return base + 2 + (hasTax.value ? 1 : 0)
  return base
})

const sumQty = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.qty) || 0), 0)
const sumAmount = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.amount) || 0), 0)
const sumTax = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.tax_amount) || 0), 0)
const withTax = (l: any) => (Number(l.amount) || 0) + (Number(l.tax_amount) || 0)
const taxPrice = (l: any) => {
  const qty = Number(l.qty) || 0
  if (l.price_with_tax != null && Number(l.price_with_tax) > 0) return Number(l.price_with_tax)
  return qty ? withTax(l) / qty : 0
}
// 组装单两张表不补空行；单表补至 6 行版面整齐
const blankCount = (rows: any[]) => (isAssembly.value ? 0 : Math.max(0, 6 - rows.length))

const totalAmount = computed(() => sumAmount(props.doc?.lines || []))
const totalTax = computed(() => sumTax(props.doc?.lines || []))

const num = (v: any) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
// 数量 / 单价 / 金额按小数位设置（系统参数 → 供应链 → 小数位设置，按单据类型）
const decStore = useScmDecimalsStore()
void decStore.load()
const money = (v: any) => decStore.amount(Number(v) || 0, props.doc?.doc_type)
const qtyP = (v: any) => decStore.qty(Number(v) || 0, props.doc?.doc_type)
const priceP = (v: any) => decStore.price(Number(v) || 0, props.doc?.doc_type)
</script>

<style scoped>
.scm-paper { font-size: 13px; color: #000; }
.doc-header { text-align: center; margin-bottom: 8px; }
.company { font-size: 18px; font-weight: 700; }
.doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 10px 0; }
.meta b { font-weight: 600; }

.lines-group-title { font-weight: 700; font-size: 14px; margin: 10px 0 4px; }
table.lines { width: 100%; border-collapse: collapse; }
table.lines + .lines-group-title { margin-top: 14px; }
table.lines th, table.lines td { border: 1px solid #000; padding: 3px 5px; line-height: 1.5; }
table.lines th { background: #f0f0f0; font-weight: 600; text-align: center; }
.c-idx { width: 28px; text-align: center; }
.c-unit { width: 44px; text-align: center; }
.c-num { width: 70px; text-align: right; }
.c-spec { width: 90px; }
.c-remark { width: 90px; }
.blank td { height: 22px; }
.t-sum { text-align: center; font-weight: 600; }
tfoot td { font-weight: 600; }

.amount-cn { margin: 8px 0; }
.footer-fields { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 8px 0; }
.footer-fields b { font-weight: 600; }
.signs { display: flex; gap: 32px; margin-top: 18px; flex-wrap: wrap; }
.signs--delivery { margin-top: 28px; }
</style>
