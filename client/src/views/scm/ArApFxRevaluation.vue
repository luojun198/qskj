<template>
  <div class="page fx-reval-page">
    <div class="fx-header">
      <div class="fx-header__left">
        <el-button link size="small" @click="router.push('/scm/arap')"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="fx-header__sep">/</span>
        <span class="fx-header__title">往来汇率重估</span>
        <span class="fx-header__meta">把外币应收/应付的未核销部分按期末汇率折算本位币，与总账「期末调汇」配合使用（本页不生成凭证）</span>
      </div>
      <div class="fx-header__right">
        <el-date-picker v-model="periodValue" type="month" value-format="YYYY-MM" placeholder="选择期间" size="small" style="width:140px" @change="loadPreview" />
        <el-button size="small" :loading="loading" @click="loadPreview"><el-icon><Refresh /></el-icon>预览</el-button>
        <el-button type="primary" size="small" :disabled="!canRun" :loading="running" @click="run">执行重估</el-button>
      </div>
    </div>

    <div class="fx-body">
      <el-alert v-if="preview?.existing" type="warning" :closable="false" show-icon class="fx-alert">
        {{ preview.year }} 年 {{ preview.period }} 期已于 {{ preview.existing.created_at }} 做过重估（调整 {{ fmt(preview.existing.total_adjustment) }}）。如需重做请先撤销。
      </el-alert>

      <div v-if="preview" class="fx-rates">
        <span class="fx-rates__label">期末汇率（本位币 {{ preview.base_currency }}）：</span>
        <template v-if="preview.rates.length">
          <span v-for="r in preview.rates" :key="r.currency" class="fx-rate">
            {{ r.currency }}
            <el-input-number v-model="rateOverrides[r.currency]" :min="0.000001" :precision="6" :controls="false" size="small" style="width:120px" :placeholder="String(r.rate)" @change="loadPreview" />
            <span class="fx-rate__src">{{ sourceLabel(r.source) }}</span>
          </span>
        </template>
        <span v-else class="text-muted">本期无外币未清往来</span>
      </div>

      <el-table :data="preview?.rows || []" v-loading="loading" border stripe size="small" height="calc(100% - 96px)" show-summary :summary-method="summary">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column label="往来单位" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
        </el-table-column>
        <el-table-column label="单据" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.doc_type }} {{ row.doc_no }}</template>
        </el-table-column>
        <el-table-column label="日期" prop="doc_date" width="104" />
        <el-table-column label="方向" width="70" align="center">
          <template #default="{ row }"><el-tag size="small" effect="plain" :type="row.direction === 'in' ? 'success' : 'info'">{{ row.direction === 'in' ? '应收/付' : '收/付款' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="币别" prop="currency" width="64" align="center" />
        <el-table-column label="未核销原币" width="120" align="right"><template #default="{ row }">{{ fmt(row.open_fc) }}</template></el-table-column>
        <el-table-column label="原汇率" width="90" align="right"><template #default="{ row }">{{ row.old_rate }}</template></el-table-column>
        <el-table-column label="账面本位币" width="120" align="right"><template #default="{ row }">{{ fmt(row.old_open_base) }}</template></el-table-column>
        <el-table-column label="期末汇率" width="90" align="right"><template #default="{ row }">{{ row.new_rate }}</template></el-table-column>
        <el-table-column label="重估本位币" width="120" align="right"><template #default="{ row }">{{ fmt(row.new_open_base) }}</template></el-table-column>
        <el-table-column label="调整额" width="110" align="right">
          <template #default="{ row }"><span :class="row.adjustment > 0 ? 'adj-up' : row.adjustment < 0 ? 'adj-down' : ''">{{ fmt(row.adjustment) }}</span></template>
        </el-table-column>
      </el-table>

      <div class="fx-history">
        <div class="fx-history__hd">重估记录</div>
        <el-table :data="history" size="small" border max-height="180">
          <el-table-column label="期间" width="100"><template #default="{ row }">{{ row.year }}-{{ String(row.period).padStart(2, '0') }}</template></el-table-column>
          <el-table-column label="汇率" min-width="200" show-overflow-tooltip><template #default="{ row }">{{ ratesText(row.rates_json) }}</template></el-table-column>
          <el-table-column label="调整合计" width="120" align="right"><template #default="{ row }">{{ fmt(row.total_adjustment) }}</template></el-table-column>
          <el-table-column label="操作人" prop="created_by" width="100" />
          <el-table-column label="时间" prop="created_at" width="160" />
          <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.revoked_at ? 'info' : 'success'" effect="plain">{{ row.revoked_at ? '已撤销' : '有效' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90" align="center">
            <template #default="{ row }"><el-button v-if="!row.revoked_at" link type="danger" size="small" @click="revoke(row)">撤销</el-button></template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const router = useRouter()
const now = new Date()
const periodValue = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const preview = ref<any>(null)
const history = ref<any[]>([])
const loading = ref(false)
const running = ref(false)
const rateOverrides = ref<Record<string, number | undefined>>({})

const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const yp = computed(() => { const [y, m] = periodValue.value.split('-'); return { year: Number(y), period: Number(m) } })
const canRun = computed(() => !!preview.value && preview.value.rows.length > 0 && !preview.value.existing)
const SOURCE_LABELS: Record<string, string> = { base: '本位币', 'period-closing': '本期期末汇率', 'period-rate': '本期汇率', 'currency-end': '币种期末汇率', 'nearest-period': '最近期汇率', default: '默认/手填' }
const sourceLabel = (s: string) => SOURCE_LABELS[s] || s
function ratesText(json: string) { try { return (JSON.parse(json) as any[]).map(r => `${r.currency} ${r.rate}`).join('，') } catch { return '' } }
function cleanOverrides() {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(rateOverrides.value)) if (Number(v) > 0) out[k] = Number(v)
  return out
}

async function loadPreview() {
  loading.value = true
  try {
    const r = await scmApi.previewFxRevaluation({ ...yp.value, rates: cleanOverrides() })
    if (r.code === 0) preview.value = r.data
  } finally { loading.value = false }
}
async function loadHistory() {
  const r = await scmApi.listFxRevaluations()
  if (r.code === 0) history.value = r.data || []
}
async function run() {
  if (!preview.value) return
  try {
    await ElMessageBox.confirm(`将按期末汇率重估 ${preview.value.rows.length} 笔外币未清往来，调整合计 ${fmt(preview.value.total_adjustment)}。本操作不生成凭证，请同步执行总账「期末调汇」。继续？`, '执行重估', { type: 'warning' })
  } catch { return }
  running.value = true
  try {
    const r = await scmApi.runFxRevaluation({ ...yp.value, rates: cleanOverrides() })
    if (r.code === 0) { ElMessage.success(`已重估 ${r.data.count} 笔`); await Promise.all([loadPreview(), loadHistory()]) }
  } finally { running.value = false }
}
async function revoke(row: any) {
  try { await ElMessageBox.confirm(`撤销 ${row.year}-${row.period} 期的重估，恢复重估前的本位币金额与汇率？`, '撤销重估', { type: 'warning' }) } catch { return }
  const r = await scmApi.revokeFxRevaluation(row.id)
  if (r.code === 0) { ElMessage.success('已撤销'); await Promise.all([loadPreview(), loadHistory()]) }
}
function summary({ columns }: { columns: any[] }) {
  const rows = preview.value?.rows || []
  return columns.map((c, i) => {
    if (i === 0) return '合计'
    if (c.label === '调整额') return fmt(rows.reduce((s: number, r: any) => s + (Number(r.adjustment) || 0), 0))
    return ''
  })
}

onMounted(async () => { await Promise.all([loadPreview(), loadHistory()]) })
</script>

<style scoped>
.fx-reval-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.fx-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-bg-color); flex-shrink: 0; }
.fx-header__left { display: flex; align-items: center; gap: 8px; font-size: var(--cw-text-base); min-width: 0; }
.fx-header__sep { color: var(--el-text-color-placeholder); }
.fx-header__title { font-weight: 600; white-space: nowrap; }
.fx-header__meta { color: var(--el-text-color-secondary); }
.fx-header__right { display: flex; align-items: center; gap: 8px; }
.fx-body { flex: 1; min-height: 0; padding: 8px 16px 12px; display: flex; flex-direction: column; gap: 8px; }
.fx-alert { flex-shrink: 0; }
.fx-rates { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: var(--cw-text-base); }
.fx-rates__label { color: var(--el-text-color-secondary); }
.fx-rate { display: inline-flex; align-items: center; gap: 6px; }
.fx-rate__src { font-size: 12px; color: var(--el-text-color-placeholder); }
.adj-up { color: var(--el-color-danger); }
.adj-down { color: var(--el-color-success); }
.fx-history { flex-shrink: 0; }
.fx-history__hd { font-weight: 600; margin: 4px 0; font-size: var(--cw-text-base); }
</style>
