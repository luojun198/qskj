<template>
  <div class="period-close-page">
    <div class="toolbar">
      <span class="toolbar-title">期间结账</span>
      <el-select
        v-model="selectedYear"
        size="small"
        class="year-select"
        @change="loadOverview(true)"
      >
        <el-option v-for="year in years" :key="year" :label="`${year}年`" :value="year" />
      </el-select>
      <div class="year-quick-nav">
        <el-button
          size="small"
          :disabled="!openingYear || selectedYear === openingYear"
          @click="jumpYear(openingYear)"
        >
          开账{{ openingYear || '' }}
        </el-button>
        <el-button size="small" :disabled="!canGoPrev" @click="jumpYear(selectedYear - 1)">
          上一年
        </el-button>
        <el-button size="small" :disabled="!canGoNext" @click="jumpYear(selectedYear + 1)">
          下一年
        </el-button>
        <el-button
          size="small"
          :disabled="!lastVoucherYear || selectedYear === lastVoucherYear"
          @click="jumpYear(lastVoucherYear)"
        >
          账末{{ lastVoucherYear || '' }}
        </el-button>
      </div>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="loadOverview(true)">
        刷新
      </el-button>
      <el-button
        v-if="canClosePeriod"
        size="small"
        type="primary"
        :loading="batchAction === 'close-all'"
        :disabled="openCount === 0"
        @click="confirmCloseAll"
      >
        全年结账
      </el-button>
      <el-button
        v-if="canUnclosePeriod"
        size="small"
        type="danger"
        plain
        :loading="batchAction === 'open-all'"
        :disabled="closedCount === 0"
        @click="confirmOpenAll"
      >
        全年反结账
      </el-button>
      <span class="toolbar-divider" />
      <span class="stat">已结<strong>{{ closedCount }}</strong></span>
      <span class="stat">未结<strong>{{ openCount }}</strong></span>
      <span class="stat">年结<strong>{{ yearClosed ? '完成' : '未完成' }}</strong></span>
      <span class="stat">下年期初<strong>{{ openingBalanceText }}</strong></span>
    </div>

    <div v-if="pendingOpeningAlert" class="hint hint--warn">{{ pendingOpeningAlert }}</div>
    <div class="hint hint--info">
      须先记账；12月年结生成下年期初；反年结撤销下年期初（凭证保留，余额待重结恢复），反结后进先出。支持全年结账/全年反结账。
    </div>

    <el-table
      v-loading="loading"
      :data="months"
      size="small"
      border
      stripe
      class="period-table compact-data-table"
      :row-class-name="getRowClassName"
    >
      <el-table-column label="期间" width="72" align="center">
        <template #default="{ row }">
          <span :class="{ 'is-year-end': row.period === 12 }">
            {{ row.period === 12 ? '12月·年结' : `${row.period}月` }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="64" align="center">
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="row.status === 'closed' ? 'success' : 'info'"
            effect="plain"
          >
            {{ row.status === 'closed' ? '已结' : '未结' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="说明" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ getPeriodMeta(row) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="88" align="center" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'closed'"
            type="primary"
            link
            size="small"
            :loading="actionKey === getActionKey(row.period, 'close')"
            @click="confirmClose(row.period)"
          >
            {{ row.period === 12 ? '年结' : '结账' }}
          </el-button>
          <el-button
            v-else
            type="danger"
            link
            size="small"
            :loading="actionKey === getActionKey(row.period, 'open')"
            @click="confirmOpen(row.period)"
          >
            {{ row.period === 12 ? '反年结' : '反结' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import request from '@/api/request'
import { formatDate } from '@/utils/format'
import { hasPermission } from '@/utils/permission'

type PeriodStatus = 'open' | 'closed'
type PeriodAction = 'close' | 'open'
type BatchAction = 'close-all' | 'open-all' | ''

interface PeriodMonth {
  period: number
  status: PeriodStatus
  closedAt?: string | null
}

interface PeriodOverview {
  year: number
  months: PeriodMonth[]
  yearEnd?: {
    nextYear: number
    openingBalanceRowCount: number
    voucherCount: number
  }
  nextYearPendingOpening?: {
    nextYear: number
    voucherCount: number
  }
  openingPending?: {
    year: number
    voucherCount: number
  }
}

interface PeriodYearBounds {
  openingYear: number
  lastVoucherYear: number | null
  minYear: number
  maxYear: number
}

const currentYear = new Date().getFullYear()
const selectedYear = ref(currentYear)
const yearBounds = ref<PeriodYearBounds | null>(null)
const loading = ref(false)
const actionKey = ref('')
const batchAction = ref<BatchAction>('')
const overview = ref<PeriodOverview | null>(null)

const canClosePeriod = computed(() => hasPermission('period:close'))
const canUnclosePeriod = computed(() => hasPermission('period:unclose'))

const years = computed(() => {
  const bounds = yearBounds.value
  if (!bounds) {
    return Array.from({ length: 12 }, (_, index) => currentYear + 1 - index)
  }
  const list: number[] = []
  for (let year = bounds.maxYear; year >= bounds.minYear; year -= 1) {
    list.push(year)
  }
  return list
})

const openingYear = computed(() => yearBounds.value?.openingYear ?? null)
const lastVoucherYear = computed(() => yearBounds.value?.lastVoucherYear ?? null)
const canGoPrev = computed(() =>
  yearBounds.value ? selectedYear.value > yearBounds.value.minYear : selectedYear.value > currentYear - 10
)
const canGoNext = computed(() =>
  yearBounds.value ? selectedYear.value < yearBounds.value.maxYear : selectedYear.value < currentYear + 1
)

const months = computed<PeriodMonth[]>(() => {
  if (overview.value?.months?.length) return overview.value.months
  return Array.from({ length: 12 }, (_, index) => ({
    period: index + 1,
    status: 'open' as PeriodStatus,
  }))
})

const closedCount = computed(() => months.value.filter(month => month.status === 'closed').length)
const openCount = computed(() => months.value.length - closedCount.value)
const yearClosed = computed(() => months.value[11]?.status === 'closed')
const openingBalanceText = computed(() => {
  if (overview.value?.nextYearPendingOpening) {
    return `待恢复(${overview.value.nextYearPendingOpening.voucherCount})`
  }
  if (overview.value?.openingPending) {
    return `待恢复(${overview.value.openingPending.voucherCount})`
  }
  if (!overview.value?.yearEnd) return '未生成'
  return `${overview.value.yearEnd.openingBalanceRowCount}条`
})

const pendingOpeningAlert = computed(() => {
  const pending = overview.value?.openingPending
  if (pending) {
    return `${pending.year}年已有${pending.voucherCount}张凭证但缺第1期期初，发生额可查，余额待重新年结后恢复。`
  }
  const nextPending = overview.value?.nextYearPendingOpening
  if (nextPending) {
    return `${nextPending.nextYear}年已有${nextPending.voucherCount}张凭证但缺期初，请修改后重新执行${selectedYear.value}年度结账。`
  }
  return ''
})

function getActionKey(period: number, action: PeriodAction) {
  return `${action}:${period}`
}

function getRowClassName({ row }: { row: PeriodMonth }) {
  if (row.period === 12) return 'row-year-end'
  if (row.status === 'closed') return 'row-closed'
  return ''
}

function formatDateTime(value?: string | null) {
  if (!value) return ''
  return formatDate(value, 'MM-DD HH:mm')
}

function getPeriodMeta(month: PeriodMonth) {
  if (month.closedAt) {
    return `结账 ${formatDateTime(month.closedAt)}`
  }
  if (month.period === 12 && overview.value?.yearEnd) {
    const ye = overview.value.yearEnd
    const voucherHint = ye.voucherCount > 0 ? `，下年${ye.voucherCount}张凭证` : ''
    return `已生成${ye.nextYear}年期初${ye.openingBalanceRowCount}条${voucherHint}`
  }
  if (month.period === 12) {
    return `将生成${selectedYear.value + 1}年期初`
  }
  return '—'
}

function jumpYear(year: number | null) {
  if (!year || year === selectedYear.value) return
  selectedYear.value = year
  loadOverview(false)
}

async function loadYearBounds() {
  try {
    const res = await request.get<PeriodYearBounds>('/voucher/periods/year-bounds')
    yearBounds.value = res.data
  } catch {
    yearBounds.value = null
  }
}

async function loadOverview(showMessage = false) {
  loading.value = true
  try {
    const res = await request.get<PeriodOverview>(`/voucher/periods/${selectedYear.value}/overview`)
    overview.value = res.data
    if (showMessage) {
      ElMessage.success('期间状态已刷新')
    }
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '加载期间状态失败')
  } finally {
    loading.value = false
  }
}

async function confirmClose(period: number) {
  const isYearEnd = period === 12
  const nextPending = overview.value?.nextYearPendingOpening
  const message = isYearEnd
    ? nextPending
      ? `${selectedYear.value}年第12期将重新年结，覆盖${nextPending.nextYear}年期初（下年已有${nextPending.voucherCount}张凭证）。确认继续吗？`
      : `${selectedYear.value}年第12期将执行年结，生成${selectedYear.value + 1}年期初。确认继续吗？`
    : `确认对${selectedYear.value}年第${period}期执行结账吗？`

  try {
    await ElMessageBox.confirm(message, isYearEnd ? '确认年度结账' : '确认结账', {
      confirmButtonText: isYearEnd ? '年度结账' : '结账',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  await runPeriodAction(period, 'close')
}

async function confirmOpen(period: number) {
  const isYearEnd = period === 12
  const nextYear = selectedYear.value + 1
  const yearEnd = overview.value?.yearEnd
  const nextPending = overview.value?.nextYearPendingOpening
  const nextYearHasVouchers = (yearEnd?.voucherCount || nextPending?.voucherCount || 0) > 0
  const message = isYearEnd
    ? nextYearHasVouchers
      ? `${selectedYear.value}年度反结账将撤销${nextYear}年期初；${nextYear}年凭证保留，余额待重新年结后恢复。确认继续吗？`
      : `${selectedYear.value}年度反结账将撤销${nextYear}年期初。确认继续吗？`
    : `确认对${selectedYear.value}年第${period}期执行反结账吗？后续已结期间须先反结。`

  try {
    await ElMessageBox.confirm(message, isYearEnd ? '确认年度反结账' : '确认反结账', {
      confirmButtonText: isYearEnd ? '年度反结账' : '反结账',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  await runPeriodAction(period, 'open')
}

async function confirmCloseAll() {
  const nextPending = overview.value?.nextYearPendingOpening
  const message = nextPending
    ? `${selectedYear.value}年将依次结账全部未结期间并执行年结，覆盖${nextPending.nextYear}年期初（下年已有${nextPending.voucherCount}张凭证）。确认继续吗？`
    : `${selectedYear.value}年将依次结账全部未结期间（含12月年结并生成${selectedYear.value + 1}年期初）。确认继续吗？`

  try {
    await ElMessageBox.confirm(message, '确认全年结账', {
      confirmButtonText: '全年结账',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  batchAction.value = 'close-all'
  try {
    const res = await request.post(`/voucher/periods/${selectedYear.value}/close-all`)
    ElMessage.success(res.message || '全年结账成功')
    await loadOverview(false)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '全年结账失败')
  } finally {
    batchAction.value = ''
  }
}

async function confirmOpenAll() {
  const nextYear = selectedYear.value + 1
  const yearEnd = overview.value?.yearEnd
  const nextPending = overview.value?.nextYearPendingOpening
  const nextYearHasVouchers = (yearEnd?.voucherCount || nextPending?.voucherCount || 0) > 0
  const message = nextYearHasVouchers
    ? `${selectedYear.value}年将按后进先出反结全部已结期间；${nextYear}年凭证保留，余额待重新年结后恢复。确认继续吗？`
    : `${selectedYear.value}年将按后进先出反结全部已结期间。确认继续吗？`

  try {
    await ElMessageBox.confirm(message, '确认全年反结账', {
      confirmButtonText: '全年反结账',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  batchAction.value = 'open-all'
  try {
    const res = await request.post(`/voucher/periods/${selectedYear.value}/open-all`)
    ElMessage.success(res.message || '全年反结账成功')
    await loadOverview(false)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '全年反结账失败')
  } finally {
    batchAction.value = ''
  }
}

async function runPeriodAction(period: number, action: PeriodAction) {
  actionKey.value = getActionKey(period, action)
  try {
    const res = await request.post(`/voucher/periods/${selectedYear.value}/${period}/${action}`)
    ElMessage.success(res.message || (action === 'close' ? '结账成功' : '反结账成功'))
    await loadOverview(false)
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || (action === 'close' ? '结账失败' : '反结账失败'))
  } finally {
    actionKey.value = ''
  }
}

onMounted(() => {
  loadYearBounds()
  loadOverview(false)
})
</script>

<style scoped>
.period-close-page {
  box-sizing: border-box;
  width: 100%;
  margin: -10px -12px 0;
  padding: 0 4px 4px;
  align-self: flex-start;
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-bottom: 4px;
  padding: 6px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #fff;
}

.toolbar-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

.year-select {
  width: 96px;
}

.year-quick-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.year-quick-nav :deep(.el-button) {
  padding: 5px 8px;
  margin: 0;
}

.toolbar-divider {
  width: 1px;
  height: 14px;
  background: #e2e8f0;
}

.stat {
  color: #64748b;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.stat strong {
  margin-left: 3px;
  color: #0f172a;
  font-weight: 600;
}

.hint {
  margin-bottom: 4px;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.35;
}

.hint--warn {
  color: #9a6700;
  background: #fff8e6;
  border: 1px solid #f0dba8;
}

.hint--info {
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e8edf3;
}

.period-table {
  width: 100%;
}

.period-table :deep(.el-table__cell) {
  padding: 4px 0;
}

.period-table :deep(.cell) {
  padding: 0 6px;
  line-height: 1.3;
}

.period-table :deep(.el-button.is-link) {
  padding: 0 4px;
  height: auto;
  font-size: 12px;
}

.is-year-end {
  color: #9a6700;
  font-weight: 600;
}

.period-table :deep(.row-year-end) {
  background: #fffdf5 !important;
}

.period-table :deep(.row-closed) {
  background: #f8fffa !important;
}

@media (max-width: 720px) {
  .period-close-page {
    margin: -6px -8px 0;
    padding: 0 2px 2px;
  }

  .toolbar-divider {
    display: none;
  }
}
</style>
