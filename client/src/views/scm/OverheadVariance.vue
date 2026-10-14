<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>制费 / 人工吸收差异结转</b></div>
      <span class="report-header__note">完工入库按报工把人工 / 制费吸收进成品（贷 应付职工薪酬 / 制造费用），总账另按实际发生额借记；月末科目本期「借方发生 − 贷方发生」即差异：正 = 吸收不足，负 = 超额吸收。可转主营业务成本（一张凭证），或按本期完工数分摊到成品（生成结案结转单调整库存并制证）。</span>
    </div>
    <div class="toolbar">
      <el-date-picker v-model="period" type="month" value-format="YYYY-MM" placeholder="期间" size="small" style="width:130px" :clearable="false" @change="load" />
      <el-radio-group v-model="kind" size="small" @change="load">
        <el-radio-button value="overhead">制造费用</el-radio-button>
        <el-radio-button value="labor">人工（应付职工薪酬）</el-radio-button>
      </el-radio-group>
      <el-input v-model="accountCode" size="small" style="width:150px" placeholder="科目编码（默认参数）" @change="load" />
      <el-button type="primary" size="small" :loading="loading" @click="load">试算</el-button>
      <SaveAsButton title="制费人工吸收差异" />
    </div>
    <template v-if="pv">
      <div class="summary-grid">
        <div><span>SCM 本期吸收（完工 / 结案）</span><b>{{ money(pv.absorbed) }}</b></div>
        <div><span>总账 {{ pv.account_code }} {{ pv.account_name }} 借方发生</span><b>{{ money(pv.gl_debit) }}</b></div>
        <div><span>贷方发生</span><b>{{ money(pv.gl_credit) }}</b><i v-if="pv.gl_draft_count">含 {{ pv.gl_draft_count }} 张草稿凭证</i></div>
        <div><span>差异（借 − 贷）</span><b :class="{ pos: pv.variance > 0, neg: pv.variance < 0 }">{{ money(pv.variance) }}</b><i>{{ pv.variance > 0 ? '吸收不足' : pv.variance < 0 ? '超额吸收' : '已平' }}</i></div>
      </div>
      <el-alert v-if="Math.abs(pv.absorbed - pv.gl_credit) > 0.01" type="warning" :closable="false" show-icon
        :title="`SCM 吸收额 ${money(pv.absorbed)} 与总账贷方 ${money(pv.gl_credit)} 不一致：可能有完工单未生成凭证、或总账另有该科目贷方分录，请先核对再结转`" />
      <div class="method">
        <el-radio-group v-model="method" size="small">
          <el-radio value="cogs">转主营业务成本（凭证：{{ pv.variance >= 0 ? '借 主营业务成本 / 贷 ' : '借 ' }}{{ pv.account_name }}{{ pv.variance >= 0 ? '' : ' / 贷 主营业务成本' }}）</el-radio>
          <el-radio value="allocate" :disabled="!pv.finished.length">分摊到本期完工成品（{{ pv.finished.length }} 项，生成结案结转单调整库存 + 凭证 借存货 / 贷{{ pv.account_name }}）</el-radio>
        </el-radio-group>
        <el-input v-if="method === 'cogs'" v-model="targetAccount" size="small" style="width:160px" placeholder="目标科目（默认主营业务成本）" />
        <el-button type="success" size="small" :loading="saving" :disabled="Math.abs(pv.variance) < 0.005" @click="transfer">结转</el-button>
      </div>
      <div v-if="method === 'allocate' && pv.finished.length" class="rpt-table">
        <el-table :data="pv.finished" size="small" border height="100%">
          <el-table-column label="成品" min-width="180"><template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template></el-table-column>
          <el-table-column label="成品仓" prop="warehouse_code" width="110" />
          <el-table-column label="本期完工数" width="110" align="right"><template #default="{ row }">{{ row.qty }}</template></el-table-column>
          <el-table-column label="权重%" width="90" align="right"><template #default="{ row }">{{ row.share }}</template></el-table-column>
          <el-table-column label="分摊差异" width="120" align="right"><template #default="{ row }">{{ money(pv.variance * row.share / 100) }}</template></el-table-column>
        </el-table>
      </div>
      <div v-else class="rpt-table"><el-empty description="选择「分摊到本期完工成品」时在此预览分摊明细" :image-size="60" /></div>
    </template>
    <div class="runs">
      <b>结转记录</b>
      <el-table :data="runs" size="small" border max-height="240">
        <el-table-column label="期间" prop="period" width="90" />
        <el-table-column label="类别" width="90"><template #default="{ row }">{{ row.kind === 'labor' ? '人工' : '制造费用' }}</template></el-table-column>
        <el-table-column label="科目" prop="account_code" width="90" />
        <el-table-column label="吸收" width="110" align="right"><template #default="{ row }">{{ money(row.absorbed) }}</template></el-table-column>
        <el-table-column label="总账借 / 贷" width="200" align="right"><template #default="{ row }">{{ money(row.gl_debit) }} / {{ money(row.gl_credit) }}</template></el-table-column>
        <el-table-column label="差异" width="110" align="right"><template #default="{ row }"><span :class="{ pos: row.variance > 0, neg: row.variance < 0 }">{{ money(row.variance) }}</span></template></el-table-column>
        <el-table-column label="方式" width="130"><template #default="{ row }">{{ row.method === 'allocate' ? '分摊到成品' : `转 ${row.target_account || '主营成本'}` }}</template></el-table-column>
        <el-table-column label="凭证 / 结转单" min-width="160"><template #default="{ row }">{{ row.voucher_no ? '凭证 ' + row.voucher_no : '' }}{{ row.doc_no ? '　结转单 ' + row.doc_no : '' }}</template></el-table-column>
        <el-table-column label="时间 / 操作人" min-width="180"><template #default="{ row }">{{ row.run_at }} {{ row.run_by || '' }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const router = useRouter()
const now = new Date()
const period = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const kind = ref<'overhead' | 'labor'>('overhead')
const accountCode = ref(''); const targetAccount = ref('')
const method = ref<'cogs' | 'allocate'>('cogs')
const pv = ref<any>(null); const runs = ref<any[]>([])
const loading = ref(false); const saving = ref(false)
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
async function load() {
  loading.value = true
  try {
    const r = await scmApi.previewOverheadVariance({ period: period.value, kind: kind.value, account_code: accountCode.value || undefined })
    if (r.code === 0) pv.value = r.data; else ElMessage.error(r.message || '试算失败')
    const h = await scmApi.getOverheadVarianceRuns(); if (h.code === 0) runs.value = h.data
  } finally { loading.value = false }
}
async function transfer() {
  const force = pv.value.runs?.length > 0
  try { await ElMessageBox.confirm(`${force ? '该期间已结转过，再次结转会再生成一张凭证。' : ''}将把 ${period.value} ${kind.value === 'labor' ? '人工' : '制造费用'} 差异 ${money(pv.value.variance)} ${method.value === 'allocate' ? '分摊到本期完工成品并制证' : '转入主营业务成本'}，继续？`, '结转', { type: 'warning' }) } catch { return }
  saving.value = true
  try {
    const r: any = await scmApi.transferOverheadVariance({ period: period.value, kind: kind.value, account_code: accountCode.value || undefined, method: method.value, target_account: targetAccount.value || undefined, force })
    if (r.code === 0) { ElMessage.success(`已结转，凭证 ${r.data.voucher_no}${r.data.doc_no ? '，结转单 ' + r.data.doc_no : ''}`); await load() } else ElMessage.error(r.message || '结转失败')
  } finally { saving.value = false }
}
onMounted(load)
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.summary-grid i{font-style:normal;font-size:12px;color:var(--el-color-warning)}.method{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.rpt-table{flex:1;min-height:160px}.runs{display:flex;flex-direction:column;gap:6px;font-size:13px}.pos{color:var(--el-color-danger)}.neg{color:var(--el-color-success)}
</style>
