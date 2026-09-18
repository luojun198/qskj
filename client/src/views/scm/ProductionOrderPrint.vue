<template>
  <div class="print-wrap">
    <div class="toolbar no-print">
      <el-button @click="router.back()"><el-icon><Back /></el-icon>返回</el-button>
      <span class="t-title">派工单打印预览</span>
      <el-checkbox v-model="withProcess" size="small">含工序</el-checkbox>
      <el-checkbox v-model="withMaterial" size="small">含用料</el-checkbox>
      <el-button type="primary" :disabled="loading" @click="doPrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>
    <div v-loading="loading" class="paper">
      <template v-if="plan">
        <div class="doc-header">
          <div class="company">{{ companyName }}</div>
          <div class="doc-title">{{ isOut ? '委外工单' : '生产派工单' }}</div>
        </div>
        <div class="meta">
          <span><b>工单号：</b>{{ plan.code }}</span>
          <span><b>状态：</b>{{ STATUS[plan.status] || plan.status }}</span>
          <span><b>计划开工：</b>{{ plan.start_date || '-' }}</span>
          <span><b>计划完工：</b>{{ plan.end_date || '-' }}</span>
          <span v-if="plan.priority"><b>优先级：</b>{{ plan.priority }}</span>
          <span v-if="plan.dept_code"><b>部门：</b>{{ plan.dept_code }}</span>
          <span v-if="isOut"><b>委外厂：</b>{{ plan.supplier_name || plan.supplier_code }}</span>
          <span v-else><b>原料仓：</b>{{ plan.yl_warehouse_name || plan.yl_warehouse || '-' }}</span>
          <span><b>成品仓：</b>{{ plan.fp_warehouse_name || plan.fp_warehouse || '-' }}</span>
          <span v-if="plan.remark"><b>备注：</b>{{ plan.remark }}</span>
        </div>

        <div class="lines-group-title">成品</div>
        <table class="lines">
          <thead><tr><th class="c-idx">#</th><th class="c-code">成品编码</th><th class="c-name">成品名称</th><th class="c-spec">规格</th><th class="c-unit">单位</th><th class="c-num">计划数</th><th class="c-num">已完工</th><th class="c-num">已报废</th><th class="c-code">成品仓</th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in products" :key="p.id">
              <td class="c-idx">{{ i + 1 }}</td><td>{{ p.item_code }}</td><td>{{ p.item_name }}</td><td>{{ p.spec || '' }}</td><td class="c-unit">{{ p.item_unit || '' }}</td>
              <td class="c-num">{{ num(p.plan_qty) }}</td><td class="c-num">{{ num(p.finished_qty) }}</td><td class="c-num">{{ Number(p.scrap_qty) ? num(p.scrap_qty) : '' }}</td><td>{{ p.fp_warehouse_name || p.fp_warehouse || '' }}</td>
            </tr>
          </tbody>
        </table>

        <template v-if="withMaterial">
          <div class="lines-group-title">用料（全部成品汇总）</div>
          <table class="lines">
            <thead><tr><th class="c-idx">#</th><th class="c-code">物料编码</th><th class="c-name">物料名称</th><th class="c-unit">单位</th><th class="c-num">单位用量</th><th class="c-num">损耗%</th><th class="c-num">总需求</th><th class="c-num">已领用</th><th class="c-num">待领</th><th class="c-code">领料仓</th></tr></thead>
            <tbody>
              <tr v-for="(m, i) in materials" :key="m.item_code">
                <td class="c-idx">{{ i + 1 }}</td><td>{{ m.item_code }}</td><td>{{ m.item_name }}</td><td class="c-unit">{{ m.unit || '' }}</td>
                <td class="c-num">{{ num(m.bom_qty) }}</td><td class="c-num">{{ Number(m.scrap_rate) ? num(m.scrap_rate) : '' }}</td><td class="c-num">{{ num(m.need) }}</td><td class="c-num">{{ num(m.issued) }}</td><td class="c-num">{{ num(m.suggest) }}</td><td>{{ m.warehouse_code || '' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <template v-if="withProcess && processes.length">
          <div class="lines-group-title">工序</div>
          <table class="lines">
            <thead><tr><th class="c-idx">#</th><th class="c-code">成品</th><th class="c-name">工序</th><th class="c-code">工作中心</th><th class="c-num">标准工时/件</th><th class="c-num">计划</th><th class="c-num">完成</th><th class="c-num">不良</th><th class="c-sign">操作者</th><th class="c-sign">日期</th></tr></thead>
            <tbody>
              <tr v-for="(x, i) in processes" :key="x.id">
                <td class="c-idx">{{ i + 1 }}</td><td>{{ productCode(x.product_id) }}</td><td>{{ x.process_name }}{{ x.is_outsource ? '（委外）' : '' }}</td><td>{{ x.work_center_name || x.work_center_code || '' }}</td>
                <td class="c-num">{{ num(x.std_hours) }}</td><td class="c-num">{{ num(x.plan_qty) }}</td><td class="c-num">{{ num(x.done_qty) }}</td><td class="c-num">{{ Number(x.scrap_qty) ? num(x.scrap_qty) : '' }}</td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </template>

        <div class="signs">
          <span>计划员：__________</span><span>车间主管：__________</span><span>领料人：__________</span><span>质检：__________</span>
          <span style="margin-left:auto">打印时间：{{ printedAt }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Back, Printer } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useUserStore } from '@/stores/user'

const route = useRoute(); const router = useRouter(); const user = useUserStore()
const loading = ref(false)
const plan = ref<any>(null); const products = ref<any[]>([]); const materials = ref<any[]>([]); const processes = ref<any[]>([])
const withProcess = ref(true); const withMaterial = ref(true)
const STATUS: Record<string, string> = { draft: '草稿', released: '已审核', closed: '已关闭' }
const companyName = computed(() => user.accountSetName || 'CW 财务记账系统')
const isOut = computed(() => plan.value?.plan_type === 'outsource')
const printedAt = new Date().toLocaleString('zh-CN', { hour12: false })
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '') }
const productCode = (pid: string) => products.value.find(p => p.id === pid)?.item_code || ''
function doPrint() { window.print() }
onMounted(async () => {
  loading.value = true
  try {
    const id = String(route.params.id)
    const [d, s] = await Promise.all([scmApi.getProductionPlan(id), scmApi.getIssueSuggestion(id)])
    if (d.code === 0) { plan.value = d.data.plan; products.value = d.data.products || []; processes.value = (d.data as any).processes || [] }
    if (s.code === 0) materials.value = (s.data as any).lines || []
  } finally { loading.value = false }
})
</script>

<style scoped>
.print-wrap { background: var(--el-bg-color-page, #f5f5f5); min-height: 100%; }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; position: sticky; top: 0; z-index: 2; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-light); }
.t-title { font-weight: 600; }
.toolbar > .el-button:last-child { margin-left: auto; }
.paper { width: 210mm; min-height: 140mm; margin: 16px auto; padding: 14mm 12mm; background: #fff; color: #000; box-shadow: 0 2px 12px rgba(0,0,0,.12); font-size: 13px; }
.doc-header { text-align: center; margin-bottom: 8px; }
.company { font-size: 18px; font-weight: 700; }
.doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 24px; margin: 10px 0; }
.meta b { font-weight: 600; }
.lines-group-title { font-weight: 700; font-size: 14px; margin: 12px 0 4px; }
table.lines { width: 100%; border-collapse: collapse; }
table.lines th, table.lines td { border: 1px solid #000; padding: 3px 5px; line-height: 1.5; }
table.lines th { background: #f0f0f0; font-weight: 600; text-align: center; }
.c-idx { width: 28px; text-align: center; }
.c-unit { width: 44px; text-align: center; }
.c-num { width: 66px; text-align: right; }
.c-spec { width: 80px; }
.c-code { width: 96px; }
.c-sign { width: 70px; }
.signs { display: flex; gap: 32px; margin-top: 22px; flex-wrap: wrap; }
@media print {
  .no-print { display: none !important; }
  .print-wrap { background: #fff; }
  .paper { width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; }
  @page { size: A4; margin: 12mm; }
}
</style>
