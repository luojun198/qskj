<template>
  <div class="page ma-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>全月平均成本计算</b></div>
      <span class="report-header__note">
        当前计价方式：{{ methodLabel }}。期内出库按当前均价暂估，月末在此按「(期初金额 + 本期入库金额) ÷ (期初数量 + 本期入库数量)」统一重算本期出库成本；期内再有出入库审核 / 反审核后期间会标为「需重算」。
      </span>
    </div>
    <div class="toolbar">
      <el-date-picker v-model="period" type="month" value-format="YYYY-MM" placeholder="计算期间" style="width:150px" :clearable="false" />
      <el-button :loading="loading" @click="preview">试算</el-button>
      <el-button type="primary" :loading="saving" :disabled="!isMonthAvg" @click="calc">计算并写入</el-button>
      <span v-if="!isMonthAvg" class="hint">仅计价方式为「全月平均」的账套可写入，当前可试算查看差异</span>
    </div>
    <div v-if="result" class="summary-grid">
      <div><span>物料数</span><b>{{ result.item_count }}</b></div>
      <div><span>出库成本调整合计</span><b :class="{ neg: result.out_delta < 0, pos: result.out_delta > 0 }">{{ money(result.out_delta) }}</b></div>
      <div><span>需重生成凭证的单据</span><b>{{ result.voucher_docs.length }}</b></div>
    </div>
    <div class="ma-table">
      <el-table v-loading="loading || saving" :data="result?.rows || []" border stripe height="100%">
        <el-table-column label="仓库" width="120"><template #default="{ row }">{{ row.warehouse_name || row.warehouse_code }}</template></el-table-column>
        <el-table-column prop="item_code" label="物料编码" width="110" />
        <el-table-column prop="item_name" label="物料名称" min-width="130" show-overflow-tooltip />
        <el-table-column label="期初数量" width="95" align="right"><template #default="{ row }">{{ num(row.opening_qty) }}</template></el-table-column>
        <el-table-column label="期初金额" width="105" align="right"><template #default="{ row }">{{ money(row.opening_amount) }}</template></el-table-column>
        <el-table-column label="本期入库量" width="100" align="right"><template #default="{ row }">{{ num(row.in_qty) }}</template></el-table-column>
        <el-table-column label="本期入库额" width="105" align="right"><template #default="{ row }">{{ money(row.in_amount) }}</template></el-table-column>
        <el-table-column label="成本调整" width="95" align="right"><template #default="{ row }">{{ Number(row.adjust_amount) ? money(row.adjust_amount) : '' }}</template></el-table-column>
        <el-table-column label="全月平均单价" width="110" align="right"><template #default="{ row }"><b>{{ price(row.avg_cost) }}</b></template></el-table-column>
        <el-table-column label="本期出库量" width="100" align="right"><template #default="{ row }">{{ num(row.out_qty) }}</template></el-table-column>
        <el-table-column label="暂估出库额" width="105" align="right"><template #default="{ row }">{{ money(row.old_out_amount) }}</template></el-table-column>
        <el-table-column label="重算出库额" width="105" align="right"><template #default="{ row }">{{ money(row.new_out_amount) }}</template></el-table-column>
        <el-table-column label="调整额" width="100" align="right"><template #default="{ row }"><span :class="{ neg: row.delta < 0, pos: row.delta > 0 }">{{ Number(row.delta) ? money(row.delta) : '' }}</span></template></el-table-column>
        <el-table-column label="期末数量" width="95" align="right"><template #default="{ row }">{{ num(row.closing_qty) }}</template></el-table-column>
        <el-table-column label="期末金额" width="105" align="right"><template #default="{ row }">{{ money(row.closing_amount) }}</template></el-table-column>
      </el-table>
    </div>
    <div v-if="result?.voucher_docs.length" class="voucher-docs">
      <b>以下出库单据已生成凭证，成本变化后请重新生成凭证：</b>
      <el-tag v-for="d in result.voucher_docs" :key="d.doc_id" size="small" type="warning" class="doc-tag" @click="openDoc(d)">{{ d.doc_no }}（{{ money(d.delta) }}）</el-tag>
    </div>
    <div class="periods">
      <b>已计算期间</b>
      <el-table :data="periods" border size="small" max-height="220">
        <el-table-column prop="period" label="期间" width="100" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="row.status === 'stale' ? 'danger' : 'success'">{{ row.status === 'stale' ? '需重算' : '已计算' }}</el-tag></template></el-table-column>
        <el-table-column prop="item_count" label="物料数" width="80" align="right" />
        <el-table-column label="出库成本调整" width="130" align="right"><template #default="{ row }">{{ money(row.out_delta) }}</template></el-table-column>
        <el-table-column prop="calculated_at" label="计算时间" min-width="160" />
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="period = row.period; preview()">查看</el-button></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'

const router = useRouter()
const now = new Date()
const period = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const loading = ref(false); const saving = ref(false)
const result = ref<any>(null)
const periods = ref<any[]>([])
const costingMethod = ref('moving_avg')
const LABELS: Record<string, string> = { moving_avg: '移动加权平均', month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }
const methodLabel = computed(() => LABELS[costingMethod.value] || costingMethod.value)
const isMonthAvg = computed(() => costingMethod.value === 'month_avg')
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const price = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

async function loadPeriods() {
  const r = await scmApi.getCostingPeriods()
  if (r.code === 0) { periods.value = r.data || []; costingMethod.value = (r as any).costing_method || 'moving_avg' }
}
async function preview() {
  loading.value = true
  try { const r = await scmApi.previewMonthAvg(period.value); if (r.code === 0) result.value = r.data } finally { loading.value = false }
}
async function calc() {
  try {
    await ElMessageBox.confirm(`将按全月平均单价重算 ${period.value} 全部出库流水成本并调整库存结存金额，是否继续？`, '计算并写入', { type: 'warning' })
  } catch { return }
  saving.value = true
  try {
    const r = await scmApi.calcMonthAvg(period.value)
    if (r.code === 0) { result.value = r.data; ElMessage.success(`已计算 ${r.data.item_count} 个物料，出库成本调整 ${money(r.data.out_delta)}`); await loadPeriods() }
    else ElMessage.error(r.message || '计算失败')
  } finally { saving.value = false }
}
function openDoc(d: any) { router.push(scmDownstreamDocRoute(d.doc_id, 'audited', undefined, d.doc_type)) }
// 从凭证/单据页返回时重新试算
useReloadOnActivated(() => { preview() })
onMounted(async () => { await loadPeriods(); preview() })
</script>

<style scoped>
.ma-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hint{font-size:12px;color:var(--el-color-warning)}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.ma-table{flex:1;min-height:200px}.voucher-docs{font-size:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.doc-tag{cursor:pointer}.periods{display:flex;flex-direction:column;gap:6px;font-size:13px}.neg{color:var(--el-color-success)}.pos{color:var(--el-color-danger)}
</style>
