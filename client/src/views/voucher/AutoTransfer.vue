<template>
  <div class="page auto-transfer-page">
    <section class="transfer-hero">
      <div class="transfer-hero__title">
        <span class="eyebrow">凭证结转</span>
        <h3>结转工作台</h3>
      </div>
      <div class="hero-actions">
        <el-select v-model="form.year" placeholder="年度" class="period-select">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="form.period" placeholder="期间" class="period-select">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-button size="small" :loading="previewLoading" @click="refreshPreview">刷新预览</el-button>
        <el-button
          type="primary"
          size="small"
          :loading="running"
          :disabled="!canRunTransfer"
          @click="runTransfer"
        >
          生成已选 {{ selectedReadyCount }} 张
        </el-button>
      </div>
    </section>

    <div class="auto-transfer-page__scroll">
    <section v-if="generatedVouchers.length" class="generated-panel">
      <div class="revoke-callout">
        <div class="revoke-callout__info">
          <el-icon class="revoke-callout__icon"><WarningFilled /></el-icon>
          <div>
            <strong>{{ form.year }}年{{ form.period }}期 已生成 {{ generatedVouchers.length }} 张</strong>
            <span>重新生成前须先反结转删除全部凭证</span>
          </div>
        </div>
        <el-tooltip :disabled="canRevokeTransfer" :content="revokeDisabledTip" placement="top">
          <span class="revoke-callout-tooltip-wrap">
            <el-button
              class="revoke-callout__btn"
              type="danger"
              size="small"
              :loading="revoking"
              :disabled="!canRevokeTransfer"
              @click="revokeTransfer"
            >
              <el-icon><RefreshLeft /></el-icon>
              反结转全部（{{ generatedVouchers.length }}）
            </el-button>
          </span>
        </el-tooltip>
      </div>
      <el-table ref="genTableRef" :data="generatedVouchers" border size="small" class="compact-data-table generated-table" @header-dragend="genDrag">
        <el-table-column prop="transferTypeCode" label="类型代码" :width="genCw('transferTypeCode', 88)" />
        <el-table-column prop="transferTypeName" label="结转类型" min-width="160" :width="genWidths.transferTypeName" show-overflow-tooltip />
        <el-table-column prop="voucherType" label="凭证字" :width="genCw('voucherType', 80)" />
        <el-table-column prop="voucherNo" label="凭证号" :width="genCw('voucherNo', 120)" />
        <el-table-column prop="voucherDate" label="凭证日期" :width="genCw('voucherDate', 110)" />
        <el-table-column label="状态" column-key="status" :width="genCw('status', 88)" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="getVoucherStatusTagType(row.status)">
              {{ getVoucherStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" column-key="amount" :width="genCw('amount', 130)" align="right">
          <template #default="{ row }">{{ formatAmount(row.totalAmount) }}</template>
        </el-table-column>
      </el-table>
    </section>

    <section class="summary-grid">
      <div v-for="item in summaryCards" :key="item.label" class="summary-card">
        <span class="summary-card__label">{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <em>{{ item.hint }}</em>
      </div>
    </section>

    <el-alert
      v-if="topNotice"
      :title="topNotice"
      :type="previewResult?.blockedReason ? 'warning' : 'info'"
      :closable="false"
      show-icon
      class="section-alert section-alert--compact"
    />

    <section class="transfer-layout">
      <el-card class="transfer-list-card" shadow="never">
        <template #header>
          <div class="card-header-row">
            <div>
              <div class="card-kicker">结转类型</div>
              <strong>选择本次要结转的类型</strong>
            </div>
            <div class="list-actions">
              <el-button text type="primary" :disabled="!readyPreviews.length" @click="selectAllReady">全选可生成</el-button>
              <el-button text :disabled="!selectedCodes.length" @click="clearSelection">清空</el-button>
            </div>
          </div>
        </template>

        <div v-if="previewLoading" class="loading-state">正在生成结转预览...</div>
        <div v-else-if="!previews.length" class="empty-state">暂无结转类型，请先维护结转配置。</div>
        <div v-else class="transfer-type-list">
          <article
            v-for="preview in previews"
            :key="preview.transferTypeCode"
            class="transfer-type-card"
            :class="[`is-${preview.status}`, { 'is-selected': selectedCodes.includes(preview.transferTypeCode) }]"
          >
            <div class="type-main">
              <el-checkbox
                :model-value="selectedCodes.includes(preview.transferTypeCode)"
                :disabled="!preview.selectable"
                @change="checked => toggleType(preview, Boolean(checked))"
              />
              <div class="type-title">
                <div>
                  <strong>{{ preview.transferTypeName }}</strong>
                  <span>{{ preview.transferTypeCode }} · {{ preview.voucherType }}</span>
                </div>
                <el-tag :type="getStatusTagType(preview.status)" size="small" effect="plain">
                  {{ getStatusText(preview) }}
                </el-tag>
              </div>
            </div>

            <div class="type-metrics">
              <span>分录 {{ preview.entries.length }}</span>
              <span>借 {{ formatAmount(preview.totals.debitTotal) }}</span>
              <span>贷 {{ formatAmount(preview.totals.creditTotal) }}</span>
            </div>

            <p v-if="preview.disabledReason || preview.emptyReason" class="type-reason">
              {{ preview.disabledReason || preview.emptyReason }}
            </p>
            <p v-else-if="preview.alreadyGenerated" class="type-reason">
              已生成凭证号：{{ preview.existingRun?.voucher_no || '-' }}
            </p>
          </article>
        </div>
      </el-card>

      <el-card class="preview-detail-card" shadow="never">
        <template #header>
          <div class="card-header-row">
            <div>
              <div class="card-kicker">分录预览</div>
              <strong>查看可生成类型的明细</strong>
            </div>
            <el-tag type="info" effect="plain">未记账凭证不参与结转</el-tag>
          </div>
        </template>

        <div v-if="readyPreviews.length" class="preview-stack">
          <section v-for="preview in readyPreviews" :key="preview.transferTypeCode" class="preview-section">
            <div class="preview-section__head">
              <div>
                <h4>{{ preview.transferTypeName }}</h4>
                <span>{{ preview.entries.length }} 条分录，借贷差额 {{ formatAmount(Math.abs(preview.totals.debitTotal - preview.totals.creditTotal)) }}</span>
              </div>
              <el-tag :type="selectedCodes.includes(preview.transferTypeCode) ? 'success' : 'info'" effect="plain">
                {{ selectedCodes.includes(preview.transferTypeCode) ? '已选择' : '未选择' }}
              </el-tag>
            </div>
            <el-table ref="entTableRef" :data="preview.entries" border size="small" class="compact-data-table entry-table" @header-dragend="entDrag">
              <el-table-column prop="summary" label="摘要" min-width="150" :width="entWidths.summary" show-overflow-tooltip />
              <el-table-column prop="account_code" label="科目编码" :width="entCw('account_code', 110)" />
              <el-table-column prop="account_name" label="科目名称" min-width="150" :width="entWidths.account_name" show-overflow-tooltip />
              <el-table-column label="方向" column-key="direction" :width="entCw('direction', 70)" align="center">
                <template #default="{ row }">{{ row.direction === 'debit' ? '借' : '贷' }}</template>
              </el-table-column>
              <el-table-column label="金额" column-key="amount" :width="entCw('amount', 130)" align="right">
                <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
              </el-table-column>
            </el-table>
          </section>
        </div>
        <div v-else class="empty-state detail-empty">
          当前期间没有可生成的结转分录。请检查是否已有已记账的损益/收支类余额，或查看左侧各类型原因。
        </div>
      </el-card>
    </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import request from '@/api/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RefreshLeft, WarningFilled } from '@element-plus/icons-vue'
import { formatAmount } from '@/utils/format'
import { buildRevokeTransferConfirmHtml } from '@/utils/revokeTransferConfirm'
import { buildRunTransferConfirmHtml } from '@/utils/runTransferConfirm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef: genTableRef, colWidth: genCw, onDragEnd: genDrag, widths: genWidths } = useListColumnWidth('voucher_autotransfer_generated')
const { tableRef: entTableRef, colWidth: entCw, onDragEnd: entDrag, widths: entWidths } = useListColumnWidth('voucher_autotransfer_entries')

type TransferPreviewStatus = 'ready' | 'empty' | 'generated' | 'notYetDue' | 'unbalanced'

interface TransferPreview {
  transferTypeCode: string
  transferTypeName: string
  voucherType: string
  status: TransferPreviewStatus
  selectable: boolean
  disabledReason?: string | null
  emptyReason?: string | null
  alreadyGenerated: boolean
  notYetDue?: boolean
  notYetDueReason?: string
  existingRun: any
  entries: Array<{
    account_code: string
    account_name: string
    direction: 'debit' | 'credit'
    amount: number
    summary: string
  }>
  totals: {
    debitTotal: number
    creditTotal: number
  }
}

interface GeneratedTransferVoucher {
  transferTypeCode: string
  transferTypeName: string
  voucherType: string
  voucherId: string
  voucherNo: string
  voucherDate: string
  status: string
  totalAmount: number
}

interface PreviewResult {
  closed: boolean
  blockedReason: string | null
  generatedVouchers?: GeneratedTransferVoucher[]
  summary?: {
    totalTypes: number
    readyCount: number
    generatedCount: number
    emptyCount: number
    notYetDueCount: number
    unbalancedCount: number
  }
  previews: TransferPreview[]
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - i)

const form = ref({
  year: currentYear,
  period: new Date().getMonth() + 1,
})

const previewLoading = ref(false)
const running = ref(false)
const revoking = ref(false)
const previewResult = ref<PreviewResult | null>(null)
const selectedCodes = ref<string[]>([])

const previews = computed(() => previewResult.value?.previews || [])
const generatedVouchers = computed(() => previewResult.value?.generatedVouchers || [])
const readyPreviews = computed(() => previews.value.filter(p => p.status === 'ready'))
const generatedPreviews = computed(() => previews.value.filter(p => p.alreadyGenerated))
const selectedReadyCount = computed(() => selectedCodes.value.length)
const hasGeneratedVouchers = computed(() => generatedVouchers.value.length > 0)
const canRevokeTransfer = computed(() => hasGeneratedVouchers.value && !previewResult.value?.closed)

const revokeDisabledTip = computed(() => {
  if (!hasGeneratedVouchers.value) return '当前期间没有已生成的结转凭证'
  if (previewResult.value?.closed) return '该期间已结账，不能反结转'
  return ''
})

const summaryCards = computed(() => {
  const summary = previewResult.value?.summary
  return [
    { label: '结转类型', value: summary?.totalTypes || previews.value.length, hint: '当前账套配置' },
    { label: '可生成', value: summary?.readyCount || readyPreviews.value.length, hint: '默认可勾选' },
    { label: '已选择', value: selectedReadyCount.value, hint: '本次将生成' },
    { label: '已生成', value: summary?.generatedCount || generatedVouchers.value.length, hint: '需撤销后重做' },
  ]
})

const topNotice = computed(() => {
  if (!previewResult.value) return '请选择年度和期间后刷新预览。'
  if (hasGeneratedVouchers.value) {
    const voucherText = generatedVouchers.value.map(item => item.voucherNo || '-').join('、')
    if (readyPreviews.value.length === 0) {
      return `${form.value.year}年${form.value.period}期已生成 ${generatedVouchers.value.length} 张结转凭证（${voucherText}），如需重新生成请先反结转。`
    }
    return `本期已生成 ${generatedVouchers.value.length} 张结转凭证（${voucherText}），另有 ${readyPreviews.value.length} 个类型可继续生成。`
  }
  if (previewResult.value.blockedReason) return previewResult.value.blockedReason
  if (readyPreviews.value.length === 0) return '当前期间没有可生成的结转分录，左侧已列出每个结转类型的原因。'
  return `当前有 ${readyPreviews.value.length} 个结转类型可生成，请按需要勾选后执行。`
})

const canRunTransfer = computed(() => {
  return Boolean(previewResult.value && !previewResult.value.blockedReason && selectedCodes.value.length > 0)
})

watch(readyPreviews, list => {
  const readyCodes = new Set(list.map(item => item.transferTypeCode))
  selectedCodes.value = selectedCodes.value.filter(code => readyCodes.has(code))
  if (selectedCodes.value.length === 0 && list.length > 0) {
    selectedCodes.value = list.map(item => item.transferTypeCode)
  }
})

function selectAllReady() {
  selectedCodes.value = readyPreviews.value.map(item => item.transferTypeCode)
}

function clearSelection() {
  selectedCodes.value = []
}

function toggleType(preview: TransferPreview, checked: boolean) {
  if (!preview.selectable) return
  if (checked) {
    if (!selectedCodes.value.includes(preview.transferTypeCode)) {
      selectedCodes.value.push(preview.transferTypeCode)
    }
    return
  }
  selectedCodes.value = selectedCodes.value.filter(code => code !== preview.transferTypeCode)
}

function getStatusText(preview: TransferPreview) {
  if (preview.status === 'ready') return '可生成'
  if (preview.status === 'generated') return '已生成'
  if (preview.status === 'notYetDue') return '未到期'
  if (preview.status === 'unbalanced') return '借贷不平'
  return '无数据'
}

function getStatusTagType(status: TransferPreviewStatus): 'success' | 'warning' | 'info' | 'danger' {
  if (status === 'ready') return 'success'
  if (status === 'generated') return 'warning'
  if (status === 'unbalanced') return 'danger'
  return 'info'
}

function getVoucherStatusText(status: string) {
  if (status === 'draft') return '草稿'
  if (status === 'audited') return '已审核'
  if (status === 'posted') return '已记账'
  return status || '-'
}

function getVoucherStatusTagType(status: string): 'success' | 'warning' | 'info' | 'danger' {
  if (status === 'posted') return 'success'
  if (status === 'audited') return 'warning'
  if (status === 'draft') return 'info'
  return 'info'
}

function refreshPreview() {
  loadPreview(true)
}

async function loadPreview(showMessage = true) {
  previewLoading.value = true
  try {
    const res = await request.post<PreviewResult>('/voucher/auto-transfer/preview', {
      year: form.value.year,
      period: form.value.period,
    })
    previewResult.value = res.data
    if (showMessage) ElMessage.success('结转预览已刷新')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '预览失败')
  } finally {
    previewLoading.value = false
  }
}

async function runTransfer() {
  if (!previewResult.value || !selectedCodes.value.length) return
  const selected = readyPreviews.value.filter(item => selectedCodes.value.includes(item.transferTypeCode))
  const confirmHtml = buildRunTransferConfirmHtml(
    form.value.year,
    form.value.period,
    selected.map(item => ({
      transferTypeName: item.transferTypeName,
      transferTypeCode: item.transferTypeCode,
      voucherType: item.voucherType,
    }))
  )

  try {
    await ElMessageBox.confirm(confirmHtml, '确认生成已选结转凭证', {
      confirmButtonText: '确认生成',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
      customClass: 'auto-transfer-confirm-messagebox',
    })
  } catch {
    return
  }

  running.value = true
  try {
    const res = await request.post('/voucher/auto-transfer/run', {
      year: form.value.year,
      period: form.value.period,
      transferTypeCodes: selectedCodes.value,
    })
    ElMessage.success(res.message || '结转凭证生成成功')
    await loadPreview(false)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '生成结转凭证失败')
  } finally {
    running.value = false
  }
}

async function revokeTransfer() {
  if (!hasGeneratedVouchers.value) {
    ElMessage.info('当前期间没有已生成的结转凭证')
    return
  }
  if (previewResult.value?.closed) {
    ElMessage.warning('该期间已结账，不能反结转')
    return
  }
  const confirmHtml = buildRevokeTransferConfirmHtml(
    form.value.year,
    form.value.period,
    generatedVouchers.value.map(item => ({
      transferTypeName: item.transferTypeName,
      voucherNo: item.voucherNo || '-',
    }))
  )
  try {
    await ElMessageBox.confirm(confirmHtml, '确认反结转', {
      confirmButtonText: '确认反结转',
      cancelButtonText: '取消',
      type: 'warning',
      dangerouslyUseHTMLString: true,
      customClass: 'revoke-transfer-messagebox',
    })
  } catch {
    return
  }

  revoking.value = true
  try {
    const res = await request.post('/voucher/auto-transfer/revoke', {
      year: form.value.year,
      period: form.value.period,
    })
    ElMessage.success(res.message || '反结转成功')
    await loadPreview(false)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '反结转失败')
  } finally {
    revoking.value = false
  }
}

watch(form, () => loadPreview(false), { deep: true })

onMounted(() => {
  loadPreview(false)
})
</script>

<style scoped>
.auto-transfer-page {
  padding: 10px 12px;
  gap: 8px;
  color: #172033;
}

.auto-transfer-page__scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
  -webkit-overflow-scrolling: touch;
}

.transfer-hero {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: linear-gradient(135deg, #0f2747, #14526f 62%, #0f766e);
  color: #fff;
  box-shadow: 0 8px 20px rgba(15, 39, 71, 0.14);
}

.transfer-hero__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.eyebrow {
  color: #9ee7ff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.transfer-hero h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
}

.hero-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.revoke-callout-tooltip-wrap {
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
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: linear-gradient(180deg, #fff5f5 0%, #fff 28%);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.06);
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
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 2px;
}

.revoke-callout__info span {
  display: block;
  color: #b91c1c;
  font-size: 11px;
  line-height: 1.4;
}

.revoke-callout__btn {
  flex-shrink: 0;
  min-width: 148px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(245, 108, 108, 0.3);
}

.generated-table {
  width: 100%;
}

.section-alert {
  border-radius: 6px;
  flex-shrink: 0;
}

.section-alert--compact :deep(.el-alert__content) {
  padding: 0;
}

.section-alert--compact :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.45;
}

.transfer-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.4fr) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  flex-shrink: 0;
}

.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-header-row strong {
  color: #111827;
  font-size: 13px;
}

.transfer-list-card :deep(.el-card__header),
.preview-detail-card :deep(.el-card__header) {
  padding: 10px 12px;
}

.transfer-list-card :deep(.el-card__body),
.preview-detail-card :deep(.el-card__body) {
  padding: 10px 12px;
}

.list-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.transfer-list-card,
.preview-detail-card {
  border-radius: 8px;
}

.transfer-type-list,
.preview-stack {
  display: grid;
  gap: 6px;
}

.transfer-type-card {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid #e5eaf3;
  border-radius: 6px;
  background: #fff;
}

.transfer-type-card.is-selected {
  border-color: #60a5fa;
  background: #f8fbff;
}

.type-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.type-title {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.type-title strong {
  display: block;
  color: #0f172a;
  font-size: 13px;
}

.type-title span,
.type-metrics,
.type-reason,
.preview-section__head span {
  color: #64748b;
  font-size: 12px;
}

.type-metrics {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding-left: 28px;
}

.type-reason {
  margin: 0;
  padding-left: 28px;
  line-height: 1.4;
  font-size: 11px;
}

.preview-section {
  display: grid;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid #edf2f7;
}

.preview-section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.preview-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-section__head h4 {
  margin: 0 0 2px;
  color: #0f172a;
  font-size: 13px;
}

.entry-table {
  width: 100%;
}

.loading-state,
.empty-state {
  padding: 20px 10px;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
}

.detail-empty {
  min-height: 120px;
  display: grid;
  place-items: center;
  line-height: 1.5;
  font-size: 12px;
}

@media (max-width: 1180px) {
  .transfer-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .transfer-hero__title {
    flex-wrap: wrap;
  }

  .hero-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .transfer-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .period-select {
    width: 100%;
  }

  .hero-actions {
    width: 100%;
  }

  .revoke-callout {
    align-items: stretch;
    flex-direction: column;
  }

  .revoke-callout__btn {
    width: 100%;
    min-width: 0;
  }
}
</style>
