<template>
  <div class="page dr-page">
    <!-- 顶部导航 -->
    <div class="dr-header">
      <div class="dr-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="dr-header__sep">/</span>
        <span class="dr-header__title">折旧计提 / 取消折旧</span>
        <el-tag v-if="latest" size="small" style="margin-left:8px">最近计提期间 {{ latest.period }}</el-tag>
        <el-tag v-else-if="!loading" type="info" size="small" effect="plain" style="margin-left:8px">暂无折旧记录</el-tag>
      </div>
      <div class="dr-header__right">
        <el-button plain @click="router.push('/asset/depreciation')">
          <el-icon><TrendCharts /></el-icon>去计提折旧
        </el-button>
        <el-tooltip :content="latestBlockReason || ''" :disabled="!latestBlockReason" placement="bottom">
          <span>
            <el-button
              v-if="latest"
              v-permission="'asset:depr'"
              type="danger"
              :disabled="!!latestBlockReason"
              :loading="acting === latest.period"
              @click="handleReverse(latest)"
            >
              <el-icon><RefreshLeft /></el-icon>反折旧 {{ latest.period }}
            </el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <div class="dr-body">
      <el-alert type="info" :closable="false" show-icon class="dr-rules">
        <template #title>反折旧规则</template>
        只能从<b>最近一期</b>倒序撤销，撤销后删除该期折旧记录、回退资产累计折旧与净值，并删除该期折旧凭证；
        折旧凭证<b>已记账</b>须先取消记账；<b>已结账</b>期间不可反折旧；该期涉及<b>已处置</b>资产须先撤销处置。
      </el-alert>

      <div class="dr-section-title">已计提期间</div>
      <el-table
        v-loading="loading"
        :data="groups"
        size="small"
        border
        stripe
        highlight-current-row
        max-height="320"
        empty-text="暂无折旧记录"
        @current-change="onPeriodSelect"
      >
        <el-table-column label="期间" prop="period" width="100" />
        <el-table-column label="资产数" prop="count" width="80" align="right" />
        <el-table-column label="折旧合计" width="140" align="right">
          <template #default="{ row }">¥{{ fmtAmt(row.total) }}</template>
        </el-table-column>
        <el-table-column label="折旧凭证" min-width="200">
          <template #default="{ row }">
            <template v-if="row.voucherNo">
              <el-tag size="small" effect="plain" :type="row.voucherStatus === 'posted' ? 'warning' : 'success'">
                {{ row.voucherNo }} · {{ VOUCHER_STATUS_LABELS[row.voucherStatus] || row.voucherStatus || '草稿' }}
              </el-tag>
            </template>
            <el-tag v-else type="info" size="small" effect="plain">未生成</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="200">
          <template #default="{ row }">
            <span v-if="blockReason(row)" class="dr-blocked">{{ blockReason(row) }}</span>
            <span v-else class="dr-ok">可反折旧</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip :content="blockReason(row) || ''" :disabled="!blockReason(row)" placement="top">
              <span>
                <el-button
                  v-permission="'asset:depr'"
                  link
                  type="danger"
                  size="small"
                  :disabled="!!blockReason(row)"
                  :loading="acting === row.period"
                  @click.stop="handleReverse(row)"
                >反折旧</el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <div class="dr-section-title">
        {{ selected ? `${selected.period} 折旧明细` : '折旧明细' }}
        <span v-if="selectedRows.length" class="dr-section-sub">共 {{ selectedRows.length }} 条</span>
      </div>
      <el-table :data="selectedRows" size="small" border stripe class="dr-detail" empty-text="点击上方期间行查看该期各资产折旧明细">
        <el-table-column label="资产编号" prop="asset_no" width="110" />
        <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
        <el-table-column label="折旧方法" width="110">
          <template #default="{ row }">{{ DEPR_METHODS[row.depr_method] || row.depr_method }}</template>
        </el-table-column>
        <el-table-column label="使用部门" prop="dept_name" width="110" />
        <el-table-column label="折旧费用科目" prop="expense_account" width="130" />
        <el-table-column label="本月折旧" width="120" align="right">
          <template #default="{ row }">{{ fmtAmt(row.month_depr) }}</template>
        </el-table-column>
        <el-table-column label="累计折旧" width="120" align="right">
          <template #default="{ row }">{{ fmtAmt(row.accum_depr) }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, RefreshLeft, TrendCharts } from '@element-plus/icons-vue'
import { fixedAssetApi, DEPR_METHODS } from '@/api/fixedAsset'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'
import {
  groupDeprHistoryByPeriod,
  reverseBlockReason,
  VOUCHER_STATUS_LABELS,
  type DeprHistoryRow,
  type DeprPeriodGroup,
} from './deprHistory'

const router = useRouter()

const loading = ref(false)
const rows = ref<DeprHistoryRow[]>([])
const selected = ref<DeprPeriodGroup | null>(null)
const acting = ref('')

const groups = computed(() => groupDeprHistoryByPeriod(rows.value))
const latest = computed(() => groups.value[0] || null)
const latestBlockReason = computed(() => (latest.value ? reverseBlockReason(latest.value, groups.value) : null))
const selectedRows = computed(() =>
  selected.value
    ? rows.value.filter(r => r.year === selected.value!.year && r.month === selected.value!.month)
    : []
)

const fmtAmt = (v: number) =>
  (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function blockReason(row: DeprPeriodGroup) {
  return reverseBlockReason(row, groups.value)
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/asset/depreciation')
}

function onPeriodSelect(row: DeprPeriodGroup | null) {
  selected.value = row
}

async function load() {
  loading.value = true
  try {
    const res = await fixedAssetApi.getDeprHistory({})
    if (res.code === 0) {
      rows.value = res.data as DeprHistoryRow[]
      // 默认选中最新期，便于反折旧前核对明细
      const keep = selected.value && groups.value.find(g => g.period === selected.value!.period)
      selected.value = keep || groups.value[0] || null
    }
  } finally {
    loading.value = false
  }
}

async function handleReverse(row: DeprPeriodGroup) {
  const reason = blockReason(row)
  if (reason) return ElMessage.warning(reason)
  await ElMessageBox.confirm(
    `确认反折旧 ${row.period}？将删除该期 ${row.count} 条折旧记录、回退资产累计折旧与净值${row.voucherNo ? `、并删除该期折旧凭证「${row.voucherNo}」` : ''}。此操作不可恢复。`,
    '反折旧确认',
    { type: 'warning', confirmButtonText: '确认反折旧', confirmButtonClass: 'el-button--danger' }
  )
  acting.value = row.period
  try {
    const res = await fixedAssetApi.reverseDepr({ year: row.year, month: row.month })
    if (res.code === 0) {
      const nos = res.data.deletedVoucherNos || []
      ElMessage.success(`已反折旧 ${row.period}，回退 ${res.data.assetCount} 项资产${nos.length ? `，删除凭证 ${nos.join('、')}` : ''}`)
      selected.value = null
      await load()
      // 删除折旧凭证可能造成断号，提示是否重新排号
      await confirmRenumberAfterDelete(res.data.affectedGroups, nos.length)
    }
  } finally {
    acting.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.dr-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.dr-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.dr-header__left { display: flex; align-items: center; }
.dr-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.dr-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.dr-header__right { display: flex; align-items: center; gap: 8px; }
.dr-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; padding: 12px 16px 16px; }
.dr-rules { margin-bottom: 12px; line-height: 1.6; }
.dr-section-title {
  font-size: var(--cw-text-base); font-weight: 600; color: var(--el-text-color-primary);
  margin: 4px 0 6px;
}
.dr-section-title + .el-table { margin-bottom: 14px; }
.dr-section-sub { margin-left: 8px; font-weight: 400; color: var(--el-text-color-secondary); }
.dr-blocked { color: var(--el-color-warning); }
.dr-ok { color: var(--el-color-success); }
.dr-detail { flex-shrink: 0; }
</style>
