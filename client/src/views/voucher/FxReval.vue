<template>
  <div class="page fx-reval-page">
    <section class="fx-hero">
      <div class="fx-hero__title">
        <span class="eyebrow">期末调汇</span>
        <h3>外币科目期末重估</h3>
      </div>
      <div class="hero-actions">
        <el-select v-model="form.year" placeholder="年度" class="period-select">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="form.period" placeholder="期间" class="period-select">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-button size="small" :loading="loading" @click="loadPreview">刷新预览</el-button>
        <el-tooltip :disabled="canRun" :content="runDisabledTip" placement="bottom">
          <span class="tooltip-wrap">
            <el-button type="primary" size="small" :loading="running" :disabled="!canRun" @click="handleRun">
              生成调汇凭证
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </section>

    <div class="fx-reval-page__scroll">
      <section v-if="preview?.existingRun" class="generated-panel">
        <div class="revoke-callout">
          <div class="revoke-callout__info">
            <el-icon class="revoke-callout__icon"><WarningFilled /></el-icon>
            <div>
              <strong>
                {{ form.year }}年{{ form.period }}期已生成调汇凭证 {{ preview.existingRun.voucher_no || '-' }}
                （{{ formatAmount(preview.existingRun.total_amount) }}，{{ statusText(preview.existingRun.status) }}）
              </strong>
              <span>汇率或余额变动后需先反调汇删除该凭证，再重新生成</span>
            </div>
          </div>
          <el-tooltip :disabled="canRevoke" :content="revokeDisabledTip" placement="top">
            <span class="tooltip-wrap">
              <el-button type="danger" size="small" :loading="revoking" :disabled="!canRevoke" @click="handleRevoke">
                <el-icon><RefreshLeft /></el-icon>
                反调汇
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </section>

      <el-alert
        v-if="preview?.blockedReason && !preview.existingRun"
        :title="preview.blockedReason"
        type="warning"
        :closable="false"
        show-icon
        class="section-alert"
      >
        <template #default>
          <router-link v-if="needsGainAccount" to="/base/currency">
            去「外币类型」设置汇兑损益科目
          </router-link>
          <router-link v-else-if="hasUnposted" to="/voucher/audit?status=audited">
            去「凭证过账」把本期凭证记完账
          </router-link>
        </template>
      </el-alert>

      <!-- 期间汇率优先级高于外币类型页的期末汇率，改了不生效的最常见原因 -->
      <el-alert
        v-if="hasPeriodRateOverride"
        title="本期在「汇率明细」里维护了期间汇率，它会覆盖「外币类型」页填写的期末汇率"
        type="info"
        :closable="false"
        show-icon
        class="section-alert"
      >
        <template #default>
          <router-link to="/base/currency">去「外币类型」查看该期间的汇率明细</router-link>
        </template>
      </el-alert>

      <section class="summary-grid">
        <div v-for="item in summaryCards" :key="item.label" class="summary-card">
          <span class="summary-card__label">{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <em>{{ item.hint }}</em>
        </div>
      </section>

      <section class="preview-panel">
        <div class="panel-head">
          <span class="card-kicker">调汇明细</span>
          <span v-if="preview?.gainAccount" class="gain-account">
            汇兑损益科目：{{ preview.gainAccount.code }} {{ preview.gainAccount.name }}
          </span>
        </div>
        <el-table
          :data="rows"
          border
          stripe
          size="small"
          class="compact-data-table"
          :row-class-name="rowClass"
          empty-text="本期没有外币科目余额"
        >
          <el-table-column label="科目" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.account_code }} {{ row.account_name }}</template>
          </el-table-column>
          <el-table-column prop="currency_code" label="币种" width="70" align="center" />
          <el-table-column label="原币期末" width="130" align="right">
            <template #default="{ row }">{{ formatAmount(row.foreign_end_balance) }}</template>
          </el-table-column>
          <el-table-column label="账面本位币" width="130" align="right">
            <template #default="{ row }">{{ formatAmount(row.book_base_balance) }}</template>
          </el-table-column>
          <el-table-column label="期末汇率" width="120" align="right">
            <template #default="{ row }">
              <div class="rate-cell">
                <span>{{ row.closing_rate }}</span>
                <em class="rate-cell__source">{{ rateSourceLabel(row.closing_rate_source) }}</em>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="重估本位币" width="130" align="right">
            <template #default="{ row }">{{ formatAmount(row.revalued_base_balance) }}</template>
          </el-table-column>
          <el-table-column label="调汇差额" width="130" align="right">
            <template #default="{ row }">
              <span :class="{ 'amount-pos': row.adjustment > 0, 'amount-neg': row.adjustment < 0 }">
                {{ formatAmount(row.adjustment) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="分录" min-width="150">
            <template #default="{ row }">
              <el-tooltip v-if="row.skip_reason" :content="row.skip_reason" placement="top">
                <span class="skip-tag">跳过：原币数据不完整</span>
              </el-tooltip>
              <span v-else-if="!row.entry_direction" class="muted">无需调汇</span>
              <span v-else>{{ row.entry_direction === 'debit' ? '借' : '贷' }}科目 / {{ row.entry_direction === 'debit' ? '贷' : '借' }}损益</span>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="entries.length" class="preview-panel">
        <div class="panel-head"><span class="card-kicker">凭证预览</span></div>
        <el-table :data="entries" border size="small" class="compact-data-table">
          <el-table-column prop="summary" label="摘要" min-width="200" show-overflow-tooltip />
          <el-table-column label="科目" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.account_code }} {{ row.account_name }}</template>
          </el-table-column>
          <el-table-column label="借方" width="130" align="right">
            <template #default="{ row }">{{ row.direction === 'debit' ? formatAmount(row.amount) : '' }}</template>
          </el-table-column>
          <el-table-column label="贷方" width="130" align="right">
            <template #default="{ row }">{{ row.direction === 'credit' ? formatAmount(row.amount) : '' }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshLeft, WarningFilled } from '@element-plus/icons-vue'
import { formatAmount } from '@/utils/format'
import {
  previewFxRevaluation,
  revokeFxRevaluation,
  runFxRevaluation,
  type FxRevaluationPreview,
  type FxRateSource,
} from '@/api/fxReval'

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - i)
const form = ref({ year: currentYear, period: new Date().getMonth() + 1 })

const loading = ref(false)
const running = ref(false)
const revoking = ref(false)
const preview = ref<FxRevaluationPreview | null>(null)

const rows = computed(() => preview.value?.rows || [])
const entries = computed(() => preview.value?.entries || [])
const adjustableCount = computed(() => rows.value.filter(r => r.entry_direction).length)
const needsGainAccount = computed(() => Boolean(preview.value?.blockedReason?.includes('汇兑损益科目')))
const hasUnposted = computed(() => (preview.value?.unpostedVoucherCount || 0) > 0)

const RATE_SOURCE_LABELS: Record<FxRateSource, string> = {
  base: '本位币',
  'period-closing': '期间期末汇率',
  'period-rate': '期间汇率',
  'currency-end': '外币类型期末汇率',
  'nearest-period': '最近一期汇率',
  default: '默认汇率',
}

function rateSourceLabel(source: FxRateSource | undefined) {
  return source ? RATE_SOURCE_LABELS[source] || '' : ''
}

/** 有任一科目的汇率取自期间汇率表，说明外币类型页填的期末汇率被盖住了 */
const hasPeriodRateOverride = computed(() =>
  rows.value.some(r => r.closing_rate_source === 'period-rate' || r.closing_rate_source === 'period-closing')
)

const canRun = computed(
  () =>
    Boolean(preview.value) &&
    !preview.value!.closed &&
    !preview.value!.alreadyGenerated &&
    !preview.value!.blockedReason &&
    entries.value.length > 0
)
const runDisabledTip = computed(() => {
  if (!preview.value) return '请先刷新预览'
  if (preview.value.closed) return '该期间已结账'
  if (preview.value.alreadyGenerated) return '本期已生成调汇凭证，需先反调汇'
  if (preview.value.blockedReason) return preview.value.blockedReason
  if (!entries.value.length) return '账面余额与期末汇率折算一致，无需调汇'
  return ''
})
const canRevoke = computed(() => Boolean(preview.value?.existingRun) && !preview.value?.closed)
const revokeDisabledTip = computed(() => (preview.value?.closed ? '该期间已结账，不能反调汇' : ''))

const summaryCards = computed(() => [
  { label: '外币科目', value: rows.value.length, hint: '有余额的末级科目' },
  { label: '需调汇', value: adjustableCount.value, hint: '差额 ≥ 0.01' },
  { label: '汇兑收益', value: formatAmount(preview.value?.totalGain || 0), hint: '贷记汇兑损益' },
  { label: '汇兑损失', value: formatAmount(preview.value?.totalLoss || 0), hint: '借记汇兑损益' },
])

function rowClass({ row }: { row: { entry_direction: string | null; skip_reason: string | null } }) {
  if (row.skip_reason) return ''
  return row.entry_direction ? '' : 'row-muted'
}

function statusText(status: string | null) {
  if (status === 'posted') return '已记账'
  if (status === 'audited') return '已审核'
  if (status === 'draft') return '未审核'
  return status || '-'
}

async function loadPreview() {
  loading.value = true
  try {
    const res = await previewFxRevaluation(form.value.year, form.value.period)
    preview.value = res.data
  } catch {
    preview.value = null
  } finally {
    loading.value = false
  }
}

async function handleRun() {
  if (!canRun.value) return
  try {
    await ElMessageBox.confirm(
      `将按期末汇率为 ${form.value.year}年${form.value.period}期 ${adjustableCount.value} 个外币科目生成调汇凭证，并自动审核记账。是否继续？`,
      '生成调汇凭证',
      { type: 'warning', confirmButtonText: '生成', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  running.value = true
  try {
    const res = await runFxRevaluation(form.value.year, form.value.period)
    ElMessage.success(res.message || '调汇凭证已生成')
    await loadPreview()
  } finally {
    running.value = false
  }
}

async function handleRevoke() {
  if (!canRevoke.value) return
  try {
    await ElMessageBox.confirm(
      `将删除 ${form.value.year}年${form.value.period}期 的调汇凭证 ${preview.value?.existingRun?.voucher_no || ''}（自动反记账）。是否继续？`,
      '反调汇',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  revoking.value = true
  try {
    const res = await revokeFxRevaluation(form.value.year, form.value.period)
    ElMessage.success(res.message || '已反调汇')
    await loadPreview()
  } finally {
    revoking.value = false
  }
}

watch(() => [form.value.year, form.value.period], loadPreview)
onMounted(loadPreview)
</script>

<style scoped>
.fx-reval-page {
  padding: 10px 12px;
  gap: 8px;
  color: #172033;
}

.fx-reval-page__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fx-hero {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, #0f2747, #14526f 62%, #0f766e);
  color: #fff;
}

.fx-hero__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.eyebrow {
  color: #9ee7ff;
  font-size: 11px;
  font-weight: 700;
}

.fx-hero h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
}

.hero-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.tooltip-wrap {
  display: inline-flex;
}

.period-select {
  width: 100px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  flex-shrink: 0;
}

.summary-card {
  display: grid;
  gap: 2px;
  min-height: 56px;
  padding: 8px 10px;
  border: 1px solid #e5eaf3;
  border-radius: 6px;
  background: #fff;
}

.summary-card__label,
.summary-card em,
.card-kicker {
  color: #64748b;
  font-size: 12px;
  font-style: normal;
}

.summary-card strong {
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.generated-panel {
  flex-shrink: 0;
}

.revoke-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  background: #fef2f2;
}

.revoke-callout__info {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.revoke-callout__icon {
  flex-shrink: 0;
  font-size: 18px;
  color: #ef4444;
}

.revoke-callout__info strong {
  display: block;
  color: #991b1b;
  font-weight: 700;
  margin-bottom: 2px;
}

.revoke-callout__info span {
  display: block;
  color: #b91c1c;
  font-size: 11px;
}

.section-alert {
  border-radius: 6px;
  flex-shrink: 0;
}

.preview-panel {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #e5eaf3;
  border-radius: 6px;
  background: #fff;
  flex-shrink: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.gain-account {
  font-size: 12px;
  color: #475569;
}

.amount-pos {
  color: #c45656;
}

.amount-neg {
  color: #2f855a;
}

.muted {
  color: #a0a8b5;
}

.rate-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.25;
}

.rate-cell__source {
  font-style: normal;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.skip-tag {
  color: #b45309;
  cursor: help;
}

:deep(.row-muted) {
  color: #a0a8b5;
}
</style>
