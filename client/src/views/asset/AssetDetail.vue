<template>
  <div class="page page-asset-detail">
    
    <div v-loading="loading" class="detail-body">
      <template v-if="ledger">
        <!-- 资产基本信息卡片 -->
        <el-descriptions :column="4" border size="small" class="info-card">
          <el-descriptions-item label="资产编号">{{ ledger.asset_no }}</el-descriptions-item>
          <el-descriptions-item label="资产名称">{{ ledger.asset_name }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ ledger.category_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="使用部门">{{ ledger.dept_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="折旧方法">
            {{ DEPR_METHODS[ledger.depr_method ?? ''] || ledger.depr_method || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="使用月数">{{ ledger.use_months ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="购置日期">{{ ledger.acquire_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="起折日期">{{ ledger.start_depr_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="原值">¥{{ fmtAmt(ledger.original_value) }}</el-descriptions-item>
          <el-descriptions-item label="预计净残值">¥{{ fmtAmt(ledger.salvage_value) }}</el-descriptions-item>
          <el-descriptions-item label="已提月数">{{ ledger.depr_months_done }}</el-descriptions-item>
          <el-descriptions-item label="累计折旧">
            <span class="depr-amt">¥{{ fmtAmt(ledger.current_accum_depr) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="当前净值">
            <b>¥{{ fmtAmt(ledger.current_net_value) }}</b>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 生命周期明细表 -->
        <div class="ledger-section">
          <h4>生命周期明细</h4>
          <el-table :data="ledger.entries" size="small" border stripe max-height="400">
            <el-table-column label="日期" prop="date" width="105" />
            <el-table-column label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="entryTagType(row.type)" size="small">{{ entryTypeLabel(row.type) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="摘要" prop="summary" min-width="160" show-overflow-tooltip />
            <el-table-column label="原值变动" width="120" align="right">
              <template #default="{ row }">
                <span v-if="row.original_change !== 0" :class="row.original_change > 0 ? 'incr' : 'decr'">
                  {{ row.original_change > 0 ? '+' : '' }}{{ fmtAmt(row.original_change) }}
                </span>
                <span v-else class="zero">0.00</span>
              </template>
            </el-table-column>
            <el-table-column label="原值余额" prop="original_after" width="120" align="right">
              <template #default="{ row }">{{ fmtAmt(row.original_after) }}</template>
            </el-table-column>
            <el-table-column label="本期折旧" width="120" align="right">
              <template #default="{ row }">
                <span v-if="row.depr_amount > 0" class="depr-amt">{{ fmtAmt(row.depr_amount) }}</span>
                <span v-else class="zero">0.00</span>
              </template>
            </el-table-column>
            <el-table-column label="累计折旧余额" prop="accum_depr_after" width="130" align="right">
              <template #default="{ row }">{{ fmtAmt(row.accum_depr_after) }}</template>
            </el-table-column>
            <el-table-column label="净值余额" prop="net_value_after" width="120" align="right">
              <template #default="{ row }">{{ fmtAmt(row.net_value_after) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!ledger.entries.length" description="暂无明细记录" />
        </div>

        <!-- 折旧进度条 -->
        <div v-if="ledger.use_months && ledger.use_months > 0" class="progress-section">
          <h4>折旧进度</h4>
          <div class="progress-bar-wrap">
            <el-progress
              :percentage="Math.min(100, Math.round((ledger.depr_months_done / ledger.use_months) * 100))"
              :status="ledger.depr_months_done >= ledger.use_months ? 'success' : undefined"
              :stroke-width="18"
            >
              <span>{{ ledger.depr_months_done }} / {{ ledger.use_months }} 月</span>
            </el-progress>
          </div>
        </div>
      </template>
      <el-empty v-else-if="!loading" description="资产不存在" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { fixedAssetApi, type AssetLedgerResult, DEPR_METHODS } from '@/api/fixedAsset'

const route = useRoute()
const loading = ref(true)
const ledger = ref<AssetLedgerResult | null>(null)

const fmtAmt = (v: number) =>
  v == null || v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const entryTypeLabel = (type: string) => {
  const LabelMap: Record<string, string> = { acquire: '购入', depr: '折旧', change: '变动', disposal: '处置' }
  return LabelMap[type] || type
}

const entryTagType = (type: string) => {
  const TagMap: Record<string, string> = { acquire: 'success', depr: '', change: 'warning', disposal: 'danger' }
  return TagMap[type] || 'info'
}

onMounted(async () => {
  const id = route.params.id as string
  if (!id) return
  try {
    const res = await fixedAssetApi.getAssetLedger(id)
    if (res.code === 0) ledger.value = res.data
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.page-asset-detail { display: flex; flex-direction: column; height: 100%; overflow: auto; }
.detail-body { padding: 16px; flex: 1; overflow: auto; }
.info-card { margin-bottom: 16px; }
.ledger-section { margin-bottom: 16px; }
.ledger-section h4 { margin: 0 0 8px; font-size: 14px; }
.progress-section h4 { margin: 0 0 8px; font-size: 14px; }
.progress-bar-wrap { max-width: 500px; }
.depr-amt { color: #409eff; font-weight: 600; }
.incr { color: #67c23a; }
.decr { color: #f56c6c; }
.zero { color: var(--el-text-color-placeholder); }
</style>
