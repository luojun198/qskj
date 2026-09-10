<template>
  <div class="page voucher-summary-page">
    <div class="page-header">
      <div class="page-title">
        <h3>凭证汇总表</h3>
        <span v-if="resultMeta" class="page-subtitle">
          凭证年月：{{ resultMeta.periodLabel }}　凭证类型：{{ resultMeta.voucherTypeLabel }}　凭证号：从
          {{ resultMeta.minVoucherNo }} 到 {{ resultMeta.maxVoucherNo }}
        </span>
      </div>
      <div class="page-actions">
        <el-button size="small" @click="optionsVisible = true">
          <el-icon><Setting /></el-icon>汇总条件
        </el-button>
        <el-button size="small" plain :disabled="!list.length" @click="exportData">
          <el-icon><Download /></el-icon>另存
        </el-button>
        <el-button size="small" plain :disabled="!list.length" @click="printVisible = true">
          <el-icon><Printer /></el-icon>打印
        </el-button>
      </div>
    </div>

    <div ref="tableContainerRef" class="table-summary-scroll table-summary-scroll--flow">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="list"
        :height="tableHeight"
        stripe
        border
        size="small"
        class="compact-data-table"
        show-summary
        :summary-method="getSummaries"
        @header-dragend="handleHeaderDragEnd"
      >
        <el-table-column
          prop="account_code"
          label="科目编码"
          :width="colWidth('account_code', 120)"
        />
        <el-table-column
          prop="account_name"
          label="科目名称"
          :min-width="colWidth('account_name', 220)"
          show-overflow-tooltip
        />
        <el-table-column
          prop="debit_amount"
          label="借方金额"
          :width="colWidth('debit_amount', 160)"
          align="right"
        >
          <template #default="{ row }">{{ formatMoney(row.debit_amount) }}</template>
        </el-table-column>
        <el-table-column
          prop="credit_amount"
          label="贷方金额"
          :width="colWidth('credit_amount', 160)"
          align="right"
        >
          <template #default="{ row }">{{ formatMoney(row.credit_amount) }}</template>
        </el-table-column>
        <template #empty>
          <EmptyState type="data" description="暂无数据，请设置汇总条件后汇总" />
        </template>
      </el-table>
    </div>

    <!-- 汇总条件：对应经典总账「凭证汇总」选项窗口 -->
    <el-dialog
      v-model="optionsVisible"
      title="凭证汇总"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px" class="summary-form">
        <div class="form-fieldset">
          <div class="form-fieldset__legend">选项</div>
          <div class="form-grid">
            <el-form-item label="凭证年月">
              <div class="period-picker">
                <el-input-number
                  v-model="form.year"
                  :min="1900"
                  :max="2100"
                  :controls="false"
                  class="period-picker__year"
                />
                <span class="period-picker__dot">.</span>
                <el-input-number v-model="form.period" :min="1" :max="12" controls-position="right" class="period-picker__month" />
              </div>
            </el-form-item>
            <el-form-item label="凭证类型">
              <el-select v-model="form.voucherTypeId" placeholder="全部类型">
                <el-option label="全部类型" value="" />
                <el-option v-for="t in voucherTypes" :key="t.id" :label="t.name" :value="t.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="凭证号">
              <div class="no-range">
                <el-input-number v-model="form.voucherNoStart" :min="1" controls-position="right" />
                <span class="no-range__to">至</span>
                <el-input-number v-model="form.voucherNoEnd" :min="1" controls-position="right" />
              </div>
            </el-form-item>
          </div>
        </div>

        <div class="fieldset-row">
          <div class="form-fieldset">
            <div class="form-fieldset__legend">汇总</div>
            <el-radio-group v-model="form.level" class="stacked-radios">
              <el-radio value="top">一级科目</el-radio>
              <el-radio value="detail">明细科目</el-radio>
            </el-radio-group>
          </div>
          <div class="form-fieldset">
            <div class="form-fieldset__legend">范围</div>
            <el-radio-group v-model="form.scope" class="stacked-radios">
              <el-radio value="all">全部凭证</el-radio>
              <el-radio value="posted">已过账凭证</el-radio>
              <el-radio value="unposted">未过账凭证</el-radio>
            </el-radio-group>
          </div>
        </div>

        <div class="form-fieldset">
          <div class="form-grid">
            <el-form-item label="会计主管">
              <el-select v-model="form.accountantName" placeholder="请选择">
                <el-option v-for="u in users" :key="u.username" :label="u.nickname || u.username" :value="u.nickname || u.username" />
              </el-select>
            </el-form-item>
            <el-form-item label="审核人">
              <el-select v-model="form.auditorName" placeholder="请选择">
                <el-option v-for="u in users" :key="u.username" :label="u.nickname || u.username" :value="u.nickname || u.username" />
              </el-select>
            </el-form-item>
          </div>
        </div>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" :loading="loading" @click="handleSummarize">汇总</el-button>
          <el-button @click="optionsVisible = false">退出</el-button>
        </div>
      </template>
    </el-dialog>

    <HiprintDialog
      v-model="printVisible"
      template-type="ledger"
      template-key="ledger:voucher-summary"
      title="凭证汇总表"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="portrait"
      :use-templates="false"
      :show-font-size="true"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Download, Printer, Setting } from '@element-plus/icons-vue'
import type { TableColumnCtx } from 'element-plus'
import request from '@/api/request'
import { getUsersByAccountSet, type UserItem } from '@/api/auth'
import { formatAmount } from '@/utils/format'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useBaseDataStore } from '@/stores/baseData'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useUserStore } from '@/stores/user'

interface SummaryRow {
  account_code: string
  account_name: string
  debit_amount: number
  credit_amount: number
}

const baseDataStore = useBaseDataStore()
const systemParamsStore = useSystemParamsStore()
const userStore = useUserStore()
const { voucherTypes } = storeToRefs(baseDataStore)
const { accountSetName } = storeToRefs(userStore)

const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })

// 列宽拖拽后写入 localStorage，下次进页面沿用
const { tableRef, colWidth, onDragEnd, relayoutTable } = useListColumnWidth('ledger_voucher_summary')

async function handleHeaderDragEnd(newWidth: number, oldWidth: number, column: any) {
  onDragEnd(newWidth, oldWidth, column)
  await relayoutTable()
}

const list = ref<SummaryRow[]>([])
const users = ref<UserItem[]>([])
const loading = ref(false)
// 首屏先弹条件窗，与经典总账「点菜单 → 先问条件」的操作顺序一致
const optionsVisible = ref(true)
const printVisible = ref(false)

const form = ref({
  year: new Date().getFullYear(),
  period: new Date().getMonth() + 1,
  voucherTypeId: '',
  voucherNoStart: 1,
  voucherNoEnd: 1,
  level: 'top' as 'top' | 'detail',
  scope: 'all' as 'all' | 'posted' | 'unposted',
  accountantName: '',
  auditorName: '',
})

/** 结果区表头只反映「上次汇总」用的条件，改了条件但没点汇总时不应跟着变 */
const resultMeta = ref<{
  periodLabel: string
  voucherTypeLabel: string
  minVoucherNo: number
  maxVoucherNo: number
} | null>(null)

/**
 * 凭证号默认取该年月/类型下实际存在的号段（原版行为）。
 * 写死 1~1 会让首次汇总只统计第 1 号凭证，金额与真实账目差一个数量级。
 */
let lastRangeKey = ''
async function syncVoucherNoRange() {
  const key = [form.value.year, form.value.period, form.value.voucherTypeId, form.value.scope].join('|')
  if (key === lastRangeKey) return
  lastRangeKey = key
  try {
    const res = await request.get<{ min_voucher_no: number; max_voucher_no: number }>(
      '/ledger/voucher-summary/no-range',
      {
        params: {
          year: form.value.year,
          period: form.value.period,
          voucher_type_id: form.value.voucherTypeId || undefined,
          scope: form.value.scope,
        },
      }
    )
    const min = Number(res.data?.min_voucher_no) || 0
    const max = Number(res.data?.max_voucher_no) || 0
    form.value.voucherNoStart = min || 1
    form.value.voucherNoEnd = max || 1
  } catch {
    // 号段取不到时保持当前值，用户仍可手工填写；允许下次重试
    lastRangeKey = ''
  }
}

function formatMoney(v: number | null | undefined) {
  const n = Number(v) || 0
  if (Math.abs(n) < 0.005) return ''
  return formatAmount(n)
}

function totalOf(field: 'debit_amount' | 'credit_amount') {
  return list.value.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
}

function getSummaries(param: { columns: TableColumnCtx<SummaryRow>[] }) {
  return param.columns.map((column, index) => {
    if (index === 0) return '合 计'
    if (column.property === 'debit_amount') return formatAmount(totalOf('debit_amount'))
    if (column.property === 'credit_amount') return formatAmount(totalOf('credit_amount'))
    return ''
  })
}

function currentVoucherTypeLabel() {
  if (!form.value.voucherTypeId) return '全部类型'
  return voucherTypes.value.find(t => t.id === form.value.voucherTypeId)?.name || '全部类型'
}

async function handleSummarize() {
  loading.value = true
  try {
    const res = await request.get<SummaryRow[]>('/ledger/voucher-summary', {
      params: {
        year: form.value.year,
        period: form.value.period,
        voucher_type_id: form.value.voucherTypeId || undefined,
        voucher_no_start: form.value.voucherNoStart || undefined,
        voucher_no_end: form.value.voucherNoEnd || undefined,
        level: form.value.level === 'detail' ? 'detail' : 'top',
        scope: form.value.scope,
      },
    })
    list.value = res.data || []
    const meta = (res as any).meta || {}
    resultMeta.value = {
      periodLabel: `${form.value.year}.${String(form.value.period).padStart(2, '0')}`,
      voucherTypeLabel: currentVoucherTypeLabel(),
      minVoucherNo: Number(meta.min_voucher_no) || 0,
      maxVoucherNo: Number(meta.max_voucher_no) || 0,
    }
    optionsVisible.value = false
    await relayoutAfterData()
  } finally {
    loading.value = false
  }
}

function printSubtitle() {
  if (!resultMeta.value) return ''
  return `凭证年月：${resultMeta.value.periodLabel}　凭证类型：${resultMeta.value.voucherTypeLabel}　凭证号：从 ${resultMeta.value.minVoucherNo} 到 ${resultMeta.value.maxVoucherNo}`
}

function buildPrintHtml(ctx?: { fontSize?: number }): string {
  return buildTablePrintHtml<SummaryRow>({
    title: '凭证汇总表',
    subtitle: [
      `账套：${accountSetName.value || '未命名账套'}`,
      printSubtitle(),
      `会计主管：${form.value.accountantName || ''}　审核人：${form.value.auditorName || ''}`,
    ].filter(Boolean),
    rows: list.value,
    monochrome: true,
    fitToPage: true,
    fontSize: ctx?.fontSize ?? 12,
    columns: [
      { label: '科目编码', width: '18%', align: 'left', render: r => r.account_code },
      { label: '科目名称', width: '42%', align: 'left', render: r => r.account_name },
      { label: '借方金额', width: '20%', align: 'right', render: r => formatMoney(r.debit_amount) },
      { label: '贷方金额', width: '20%', align: 'right', render: r => formatMoney(r.credit_amount) },
    ],
    footer: [
      '合 计',
      '',
      formatAmount(totalOf('debit_amount')),
      formatAmount(totalOf('credit_amount')),
    ],
  })
}

async function exportData() {
  const period = resultMeta.value?.periodLabel || `${form.value.year}.${form.value.period}`
  await exportStyledTable<SummaryRow>({
    fileName: `凭证汇总表_${period}.xlsx`,
    sheetName: '凭证汇总表',
    title: '凭证汇总表',
    subtitle: printSubtitle(),
    columns: [
      { label: '科目编码', width: 120, value: row => row.account_code },
      { label: '科目名称', width: 240, value: row => row.account_name },
      { label: '借方金额', width: 160, align: 'right', type: 'amount', value: row => row.debit_amount || 0 },
      { label: '贷方金额', width: 160, align: 'right', type: 'amount', value: row => row.credit_amount || 0 },
    ],
    rows: list.value,
    summaryValues: ['合 计', '', totalOf('debit_amount'), totalOf('credit_amount')],
  })
}

onMounted(async () => {
  await systemParamsStore.load()
  form.value.year = systemParamsStore.currentYear || form.value.year
  form.value.period = systemParamsStore.currentPeriod || form.value.period

  try {
    await baseDataStore.loadVoucherTypes()
  } catch {
    // 凭证类型加载失败时仍可按「全部类型」汇总
  }

  try {
    const res = await getUsersByAccountSet(userStore.accountSetId, { silent: true })
    users.value = res.data || []
  } catch {
    users.value = []
  }

  await syncVoucherNoRange()
})

// 换年月/类型/范围都会改变可用号段，跟着重填，避免沿用上一期的区间把凭证滤空
watch(
  () => [form.value.year, form.value.period, form.value.voucherTypeId, form.value.scope],
  () => {
    void syncVoucherNoRange()
  }
)
</script>

<style scoped>
.voucher-summary-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.page-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}
.page-title h3 {
  margin: 0;
  font-size: 16px;
}
.page-subtitle {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.summary-form :deep(.el-form-item) {
  margin-bottom: 12px;
}
.form-fieldset {
  position: relative;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 16px 12px 4px;
  margin-bottom: 14px;
  flex: 1;
}
.form-fieldset__legend {
  position: absolute;
  top: -9px;
  left: 12px;
  padding: 0 6px;
  background: var(--el-bg-color-overlay, #fff);
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.fieldset-row {
  display: flex;
  gap: 12px;
}
.form-grid :deep(.el-select),
.form-grid :deep(.el-input-number) {
  width: 100%;
}
.period-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.period-picker__year {
  width: 90px;
}
.period-picker__month {
  width: 90px;
}
.period-picker__dot {
  color: var(--el-text-color-secondary);
}
.no-range {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.no-range :deep(.el-input-number) {
  width: 110px;
}
.no-range__to {
  color: var(--el-text-color-regular);
}
.stacked-radios {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.dialog-footer {
  display: flex;
  justify-content: center;
  gap: 40px;
}
</style>
