<template>
  <div class="page cpc-page">
    <!-- 顶部导航 -->
    <div class="cpc-header">
      <div class="cpc-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="cpc-header__sep">/</span>
        <span class="cpc-header__title">出纳结账</span>
        <el-select v-model="year" size="small" class="cpc-year" @change="load">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-tag v-if="latestClosed" size="small" effect="plain">已结至 {{ latestClosed.year }}-{{ pad(latestClosed.month) }}</el-tag>
        <el-tag v-else-if="!loading" type="info" size="small" effect="plain">本年尚未结账</el-tag>
      </div>
      <div class="cpc-header__right">
        <el-button size="small" :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-tooltip :content="nextCloseable?.blockReason || ''" :disabled="!nextCloseable || !nextCloseable.blockReason" placement="bottom">
          <span>
            <el-button
              v-if="nextCloseable"
              v-permission="'cashier:param'"
              type="primary"
              size="small"
              :disabled="!nextCloseable.canClose"
              :loading="acting === key(nextCloseable, 'close')"
              @click="handleClose(nextCloseable)"
            >
              结账 {{ nextCloseable.month }} 月
            </el-button>
          </span>
        </el-tooltip>
        <el-button
          v-if="latestClosed"
          v-permission="'cashier:param'"
          type="danger"
          size="small"
          plain
          :loading="acting === key(latestClosed, 'reopen')"
          @click="handleReopen(latestClosed)"
        >
          反结账 {{ latestClosed.month }} 月
        </el-button>
      </div>
    </div>

    <div class="cpc-body">
      <el-alert type="info" :closable="false" show-icon class="cpc-rules">
        <template #title>出纳结账规则</template>
        结账后该月出纳日记账<b>不能新增、修改、删除、导入，也不能生成或删除出纳凭证</b>；须按月<b>顺序结账</b>（更早的有数据月份先结），
        反结账只能从<b>最近一个已结月份</b>倒序撤销。出纳结账与总账「期末结账」相互独立，总账状态仅作提示。
      </el-alert>

      <el-table v-loading="loading" :data="months" size="small" border stripe class="cpc-table" :row-class-name="rowClass">
        <el-table-column label="月份" width="80" align="center">
          <template #default="{ row }">{{ row.month }} 月</template>
        </el-table-column>
        <el-table-column label="出纳结账" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.status === 'closed' ? 'success' : 'info'">
              {{ row.status === 'closed' ? '已结' : '未结' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="总账结账" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.glClosed ? 'success' : 'info'">{{ row.glClosed ? '已结' : '未结' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="日记账笔数" prop="journalCount" width="100" align="right" />
        <el-table-column label="未生成凭证" width="100" align="right">
          <template #default="{ row }">
            <span :class="{ 'cpc-warn': row.unvoucheredCount > 0 }">{{ row.unvoucheredCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结账人 / 时间" min-width="180">
          <template #default="{ row }">
            <span v-if="row.status === 'closed'">{{ row.closed_by_name || row.closed_by || '-' }} · {{ row.closed_at || '' }}</span>
            <span v-else class="cpc-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.blockReason" class="cpc-muted">{{ row.blockReason }}</span>
            <span v-else-if="row.status === 'open' && row.unvoucheredCount > 0" class="cpc-warn">仍有 {{ row.unvoucheredCount }} 笔未生成凭证，结账后将无法再生成</span>
            <span v-else-if="row.status === 'open'" class="cpc-ok">可结账</span>
            <span v-else class="cpc-ok">可反结账</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-tooltip :content="row.blockReason || ''" :disabled="!row.blockReason" placement="top">
              <span>
                <el-button
                  v-if="row.status !== 'closed'"
                  v-permission="'cashier:param'"
                  type="primary"
                  link
                  size="small"
                  :disabled="!row.canClose"
                  :loading="acting === key(row, 'close')"
                  @click="handleClose(row)"
                >结账</el-button>
                <el-button
                  v-else
                  v-permission="'cashier:param'"
                  type="danger"
                  link
                  size="small"
                  :disabled="!row.canReopen"
                  :loading="acting === key(row, 'reopen')"
                  @click="handleReopen(row)"
                >反结账</el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { cashierApi, type CashierPeriodMonth } from '@/api/cashier'

const router = useRouter()
const currentYear = new Date().getFullYear()
const year = ref(currentYear)
const years = computed(() => Array.from({ length: 8 }, (_, i) => currentYear + 1 - i))
const loading = ref(false)
const acting = ref('')
const months = ref<CashierPeriodMonth[]>([])

const pad = (n: number) => String(n).padStart(2, '0')
const key = (row: CashierPeriodMonth, action: string) => `${row.year}-${row.month}-${action}`

/** 本年最近一个已结月份 */
const latestClosed = computed(() => {
  const closed = months.value.filter(m => m.status === 'closed')
  return closed.length ? closed[closed.length - 1] : null
})
/** 下一个待结月份：最近已结之后的第一个未结月份 */
const nextCloseable = computed(() => {
  const start = latestClosed.value ? latestClosed.value.month + 1 : 1
  return months.value.find(m => m.month >= start && m.status === 'open') || null
})

function rowClass({ row }: { row: CashierPeriodMonth }) {
  return row.status === 'closed' ? 'cpc-row--closed' : ''
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/group/出纳管理')
}

async function load() {
  loading.value = true
  try {
    const res = await cashierApi.getPeriods(year.value)
    if (res.code === 0) months.value = res.data.months
  } finally {
    loading.value = false
  }
}

async function handleClose(row: CashierPeriodMonth) {
  if (row.blockReason) return ElMessage.warning(row.blockReason)
  const extra = row.unvoucheredCount > 0 ? `该月仍有 ${row.unvoucheredCount} 笔日记账未生成凭证，结账后将无法再生成。` : ''
  await ElMessageBox.confirm(
    `确认对 ${row.year}年${row.month}月 出纳结账？结账后该月日记账不能再增删改。${extra}`,
    '出纳结账',
    { type: 'warning', confirmButtonText: '确认结账' }
  )
  acting.value = key(row, 'close')
  try {
    const res = await cashierApi.closePeriod(row.year, row.month)
    if (res.code === 0) {
      ElMessage.success(`${row.year}年${row.month}月出纳已结账`)
      await load()
    }
  } finally {
    acting.value = ''
  }
}

async function handleReopen(row: CashierPeriodMonth) {
  if (row.blockReason) return ElMessage.warning(row.blockReason)
  await ElMessageBox.confirm(
    `确认对 ${row.year}年${row.month}月 出纳反结账？反结后该月日记账恢复可编辑。`,
    '出纳反结账',
    { type: 'warning', confirmButtonText: '确认反结账', confirmButtonClass: 'el-button--danger' }
  )
  acting.value = key(row, 'reopen')
  try {
    const res = await cashierApi.reopenPeriod(row.year, row.month)
    if (res.code === 0) {
      ElMessage.success(`${row.year}年${row.month}月出纳已反结账`)
      await load()
    }
  } finally {
    acting.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.cpc-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.cpc-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.cpc-header__left { display: flex; align-items: center; gap: 8px; }
.cpc-header__sep { color: var(--el-text-color-placeholder); }
.cpc-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.cpc-header__right { display: flex; align-items: center; gap: 8px; }
.cpc-year { width: 96px; }
.cpc-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; padding: var(--block-gap) 0 0; }
.cpc-rules { margin-bottom: 12px; line-height: 1.6; }
.cpc-table { width: 100%; }
.cpc-table :deep(.cpc-row--closed) { color: var(--el-text-color-secondary); }
.cpc-warn { color: var(--el-color-warning); }
.cpc-ok { color: var(--el-color-success); }
.cpc-muted { color: var(--el-text-color-secondary); }
</style>
