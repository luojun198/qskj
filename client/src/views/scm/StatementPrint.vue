<template>
  <div class="print-wrap">
    <div class="toolbar no-print">
      <el-button @click="goBack"><el-icon><Back /></el-icon>返回</el-button>
      <span class="t-title">对账单打印预览</span>
      <el-button type="primary" :disabled="loading || !stmt" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-loading="loading" class="paper">
      <template v-if="stmt">
        <div class="doc-header">
          <div class="company">{{ companyName }}</div>
          <div class="doc-title">{{ stmt.direction === 'ar' ? '销售对账单' : '采购对账单' }}</div>
        </div>
        <div class="meta-block">
          <div class="meta-row">
            <span class="meta-left"><b>{{ stmt.direction === 'ar' ? '客户名称' : '供应商名称' }}：</b>{{ stmt.partner_code }} {{ stmt.partner_name || '' }}</span>
            <span class="meta-right"><b>对账单号：</b>{{ stmt.stmt_no }}　<b>对账日期：</b>{{ stmt.stmt_date }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-left"><b>对账期间：</b>{{ stmt.start_date || '期初' }} ~ {{ stmt.end_date }}</span>
            <span class="meta-right"><b>状态：</b>{{ stmt.status === 'audited' ? '已审核' : '草稿' }}</span>
          </div>
        </div>
        <table class="lines">
          <thead>
            <tr>
              <th class="c-cat">类别</th><th class="c-no">单据号</th><th class="c-date">日期</th>
              <th class="c-item">物料编码</th><th class="c-name">物料名称</th><th class="c-spec">规格</th><th class="c-unit">单位</th>
              <th class="c-num">数量</th><th class="c-num">含税单价</th><th class="c-num">价税合计</th><th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in stmt.lines" :key="r.id" class="doc-row">
              <td>{{ statementCatLabel(r.src_doc_type) }}</td>
              <td>{{ r.src_doc_no }}</td>
              <td class="c-date">{{ (r.src_doc_date || '').slice(2) }}</td>
              <td>{{ r.item_code || '' }}</td>
              <td>{{ r.item_name || '' }}</td>
              <td>{{ r.spec || '' }}</td>
              <td class="c-unit">{{ r.unit || '' }}</td>
              <td class="c-num">{{ r.qty == null ? '' : fmtQty(r.qty * r.sign) }}</td>
              <td class="c-num">{{ r.qty ? (r.amount_with_tax / r.qty).toFixed(4).replace(/\.?0+$/, '') : '' }}</td>
              <td class="c-num">{{ fmtAmount(r.amount_with_tax * r.sign) }}</td>
              <td>{{ r.remark || '' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="9" class="t-sum">业务金额 {{ fmtAmount(stmt.doc_amount) }}　－　{{ stmt.direction === 'ar' ? '收款' : '付款' }} {{ fmtAmount(stmt.payment_amount) }}　＝　本次对账金额</td>
              <td class="c-num">{{ fmtAmount(stmt.net_amount) }}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div class="amount-cn"><b>本次对账金额（大写）：</b>{{ rmbUpper(stmt.net_amount) }}（¥{{ fmtAmount(stmt.net_amount) }}）</div>
        <div v-if="stmt.remark" class="amount-cn"><b>备注：</b>{{ stmt.remark }}</div>
        <div class="signs">
          <span>制单：{{ stmt.maker || '' }}</span>
          <span>审核：{{ stmt.auditor || '____________' }}</span>
          <span>本单位（盖章）：____________</span>
          <span>对方单位（盖章）：____________</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { scmApi, type ScmStatement, type ScmStatementLine } from '@/api/scm'
import { useUserStore } from '@/stores/user'
import { rmbUpper } from '@/utils/rmbUpper'
import { statementCatLabel, fmtAmount, fmtQty } from '@/utils/statementDoc'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const loading = ref(false)
const stmt = ref<(ScmStatement & { lines: ScmStatementLine[] }) | null>(null)
const companyName = computed(() => user.accountSetName || 'CW 财务记账系统')

function doPrint() { window.print() }
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: 'ScmStatementForm', params: { id: String(route.params.id) } })
}
onMounted(async () => {
  loading.value = true
  try {
    const r = await scmApi.getStatement(String(route.params.id))
    stmt.value = r.data
  } catch { /* 拦截器已提示 */ } finally { loading.value = false }
})
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; position: sticky; top: 0; z-index: 2; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.t-title { font-weight: 600; }
.toolbar > .el-button:last-child { margin-left: auto; }
.paper { width: 297mm; min-height: 180mm; margin: 16px auto; padding: 12mm 10mm; background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 12px; }
.doc-header { text-align: center; margin-bottom: 6px; }
.company { font-size: 18px; font-weight: 700; }
.doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }
.meta-block { margin: 8px 0 6px; }
.meta-row { display: flex; justify-content: space-between; align-items: center; padding: 1px 0; }
.meta-left, .meta-right { flex: 1; }
.meta-right { text-align: right; }
table.lines { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.lines th, table.lines td { border: 1px solid #000; padding: 2px 4px; line-height: 1.4; word-break: break-all; }
table.lines th { background: #f0f0f0; font-weight: 600; text-align: center; }
.doc-row td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-num { width: 84px; text-align: right; white-space: nowrap; }
.c-date, .c-unit { text-align: center; }
.c-cat { width: 78px; }
.c-no { width: 110px; }
.c-date { width: 64px; }
.c-item { width: 100px; }
.c-name { width: 150px; }
.c-spec { width: 84px; }
.c-unit { width: 40px; }
.t-sum { text-align: right; font-weight: 600; }
tfoot td { font-weight: 600; }
.amount-cn { margin: 8px 0; }
.signs { display: flex; gap: 28px; margin-top: 22px; flex-wrap: wrap; }
@media print {
  .no-print { display: none !important; }
  .print-wrap { background: #fff; }
  .paper { width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; font-size: 11px; }
  table.lines { table-layout: auto; }
  table.lines thead { display: table-header-group; }
  table.lines tfoot { display: table-footer-group; }
  table.lines tr { break-inside: avoid; page-break-inside: avoid; }
  @page { size: A4 landscape; margin: 10mm; }
}
</style>
