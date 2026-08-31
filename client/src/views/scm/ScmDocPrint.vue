<template>
  <div class="print-wrap">
    <!-- 操作条（打印时隐藏） -->
    <div class="toolbar no-print">
      <el-button @click="goBack"><el-icon><Back /></el-icon>返回</el-button>
      <span class="t-title">单据打印预览</span>
      <el-button type="primary" :disabled="loading" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="paper">
      <template v-if="doc">
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
          <span v-if="doc.warehouse_name"><b>仓库：</b>{{ doc.warehouse_name }}</span>
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
                <th class="c-num">单价</th>
                <th class="c-num">金额</th>
                <th v-if="hasTax" class="c-num">税率%</th>
                <th v-if="hasTax" class="c-num">税额</th>
                <th class="c-remark">备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in grp.rows" :key="i">
                <td class="c-idx">{{ i + 1 }}</td>
                <td class="c-code">{{ l.item_code }}</td>
                <td class="c-name">{{ (l as any).item_name || '' }}</td>
                <td class="c-spec">{{ (l as any).spec || '' }}</td>
                <td class="c-unit">{{ (l as any).unit || '' }}</td>
                <td class="c-num">{{ num(l.qty) }}</td>
                <td class="c-num">{{ money(l.price) }}</td>
                <td class="c-num">{{ money(l.amount) }}</td>
                <td v-if="hasTax" class="c-num">{{ num(l.tax_rate) }}</td>
                <td v-if="hasTax" class="c-num">{{ money(l.tax_amount) }}</td>
                <td class="c-remark">{{ l.remark || '' }}</td>
              </tr>
              <!-- 补空行至少 6 行，版面整齐（组装单不补）-->
              <tr v-for="n in blankCount(grp.rows)" :key="'b' + n" class="blank">
                <td class="c-idx">{{ grp.rows.length + n }}</td>
                <td class="c-code" /><td class="c-name" /><td class="c-spec" /><td class="c-unit" />
                <td class="c-num" /><td class="c-num" /><td class="c-num" />
                <td v-if="hasTax" class="c-num" /><td v-if="hasTax" class="c-num" /><td class="c-remark" />
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td :colspan="5" class="t-sum">合计</td>
                <td class="c-num">{{ num(sumQty(grp.rows)) }}</td>
                <td class="c-num" />
                <td class="c-num">{{ money(sumAmount(grp.rows)) }}</td>
                <td v-if="hasTax" class="c-num" />
                <td v-if="hasTax" class="c-num">{{ money(sumTax(grp.rows)) }}</td>
                <td class="c-remark" />
              </tr>
            </tfoot>
          </table>
        </template>

        <div class="amount-cn"><b>金额大写：</b>{{ rmbUpper(totalAmount + (hasTax ? totalTax : 0)) }}</div>

        <!-- 表尾自定义字段 -->
        <div v-if="footerCustomFields.length" class="footer-fields">
          <template v-for="f in footerCustomFields" :key="f.field_key">
            <span v-if="cfVal(f.field_key) !== ''"><b>{{ f.field_name }}：</b>{{ cfVal(f.field_key) }}</span>
          </template>
        </div>

        <!-- 签字 -->
        <div class="signs">
          <span>制单：{{ doc.maker || '' }}</span>
          <span>审核：{{ doc.auditor || '' }}</span>
          <span>状态：{{ statusText }}</span>
          <span>打印时间：{{ printedAt }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'
import { useUserStore } from '@/stores/user'
import { DOC_TITLE } from '@/utils/scmDoc'
import { rmbUpper } from '@/utils/rmbUpper'

const route = useRoute()
const router = useRouter()
const user = useUserStore()

const loading = ref(false)
const doc = ref<any>(null)
const printedAt = new Date().toLocaleString('zh-CN')

// 表头/表尾自定义字段（定义取自配置，值取自 doc.field_values）
const docFieldDefs = ref<any[]>([])
const headerCustomFields = computed(() => docFieldDefs.value.filter((f: any) => f.position !== 'footer'))
const footerCustomFields = computed(() => docFieldDefs.value.filter((f: any) => f.position === 'footer'))
function cfVal(key: string): string { const v = (doc.value?.field_values || {})[key]; return v == null ? '' : String(v) }

const companyName = computed(() => user.accountSetName || 'CW 财务记账系统')
const title = computed(() => {
  const base = DOC_TITLE[doc.value?.doc_type] || '单据'
  return base.endsWith('单') ? base : base + '单'
})
const isTransfer = computed(() => doc.value?.doc_type === 'TR')
// 采购类显示「供应商」，销售类显示「客户」，其余「往来单位」
const partnerCaption = computed(() => {
  const t = doc.value?.doc_type
  if (['PQ', 'PO', 'PI', 'PR', 'RP', 'WO', 'WI'].includes(t)) return '供应商'
  if (['SQ', 'SOa', 'SO', 'SR', 'RS'].includes(t)) return '客户'
  return '往来单位'
})
const partnerLabel = computed(() => doc.value?.partner_name || doc.value?.partner_code || '')
const hasTax = computed(() => (doc.value?.lines || []).some((l: any) => Number(l.tax_rate) > 0 || Number(l.tax_amount) > 0))
const statusText = computed(() => doc.value?.status === 'audited' ? '已审核' : '草稿')

// 组装单（AS）：成品 / 子件 分成两张表打印；其它单据一张表
const isAssembly = computed(() => doc.value?.doc_type === 'AS')
const lineGroups = computed(() => {
  const all: any[] = doc.value?.lines || []
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
        title: '子件 · ' + ((p as any).item_name || p.item_code || '成品'),
        rows: comps.filter(c => c.product_group === p.product_group),
      })
    }
  } else {
    groups.push({ key: 'component', title: '子件（出库）', rows: comps })
  }
  return groups
})
const sumQty = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.qty) || 0), 0)
const sumAmount = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.amount) || 0), 0)
const sumTax = (rows: any[]) => rows.reduce((s, l) => s + (Number(l.tax_amount) || 0), 0)
// 组装单两张表不补空行；单表补至 6 行版面整齐
const blankCount = (rows: any[]) => isAssembly.value ? 0 : Math.max(0, 6 - rows.length)

const totalAmount = computed(() => sumAmount(doc.value?.lines || []))
const totalTax = computed(() => sumTax(doc.value?.lines || []))

const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getDoc(route.params.id as string)
    if (r.code === 0) {
      doc.value = r.data
      try { const fr = await scmApi.getDocFieldDefs((r.data as any).doc_type); if (fr.code === 0) docFieldDefs.value = fr.data } catch { /* 无自定义字段 */ }
    } else ElMessage.error(r.message || '加载失败')
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

.paper {
  width: 210mm; min-height: 140mm; margin: 16px auto; padding: 14mm 12mm;
  background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12);
  font-size: 13px;
}
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

@media print {
  .no-print { display: none !important; }
  .print-wrap { background: #fff; }
  .paper { width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; }
  @page { size: A4; margin: 12mm; }
}
</style>
