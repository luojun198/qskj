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

        <!-- 领用归还历史 -->
        <div class="ledger-section">
          <h4>领用归还记录</h4>
          <el-table v-if="requisitions.length" :data="requisitions" size="small" border stripe>
            <el-table-column label="日期" prop="action_date" width="110" />
            <el-table-column label="类型" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="row.action === 'out' ? 'warning' : 'success'" size="small">
                  {{ row.action === 'out' ? '领用' : '归还' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="领用人" prop="user_name" width="100" />
            <el-table-column label="使用部门" prop="dept_name" width="120" />
            <el-table-column label="存放地点" prop="install_place" min-width="130" show-overflow-tooltip />
            <el-table-column label="预计归还" prop="expect_return_date" width="110" align="center" />
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.action === 'out' && row.outstanding" type="warning" size="small">未归还</el-tag>
                <span v-else class="zero">-</span>
              </template>
            </el-table-column>
            <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
          </el-table>
          <el-empty v-else description="暂无领用记录" :image-size="60" />
        </div>

        <!-- 卡片附件（发票、合同、照片等） -->
        <div class="ledger-section">
          <h4>
            资产附件
            <el-upload
              class="attach-upload"
              :show-file-list="false"
              :multiple="true"
              :auto-upload="false"
              :on-change="onAttachmentPicked"
              accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx"
            >
              <el-button size="small" :icon="Upload" :loading="uploading">上传附件</el-button>
            </el-upload>
          </h4>
          <el-table v-if="attachments.length" :data="attachments" size="small" border stripe>
            <el-table-column label="文件名" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">
                <el-link type="primary" :href="row.file_path" target="_blank">
                  {{ row.original_name }}
                </el-link>
              </template>
            </el-table-column>
            <el-table-column label="大小" width="110" align="right">
              <template #default="{ row }">{{ fmtSize(row.file_size) }}</template>
            </el-table-column>
            <el-table-column label="上传时间" prop="created_at" width="170" />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button link type="danger" size="small" @click="removeAttachment(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无附件" :image-size="60" />
        </div>
      </template>
      <el-empty v-else-if="!loading" description="资产不存在" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fixedAssetApi,
  type AssetLedgerResult,
  type RequisitionRow,
  type AssetAttachment,
  DEPR_METHODS,
} from '@/api/fixedAsset'

const route = useRoute()
const loading = ref(true)
const ledger = ref<AssetLedgerResult | null>(null)
const requisitions = ref<RequisitionRow[]>([])
const attachments = ref<AssetAttachment[]>([])
const uploading = ref(false)

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

const fmtSize = (bytes: number) => {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const assetId = () => route.params.id as string

async function loadAttachments() {
  const res = await fixedAssetApi.getAttachments(assetId())
  attachments.value = res.data
}

/** el-upload 关闭了自动上传，这里收到文件后手动提交 */
async function onAttachmentPicked(file: any) {
  if (!file?.raw) return
  uploading.value = true
  try {
    await fixedAssetApi.uploadAttachments(assetId(), [file.raw])
    ElMessage.success('上传成功')
    await loadAttachments()
  } finally {
    uploading.value = false
  }
}

async function removeAttachment(row: AssetAttachment) {
  await ElMessageBox.confirm(`确定删除附件「${row.original_name}」吗？`, '删除附件', {
    type: 'warning',
  })
  await fixedAssetApi.deleteAttachment(assetId(), row.id)
  ElMessage.success('已删除')
  await loadAttachments()
}

onMounted(async () => {
  const id = assetId()
  if (!id) return
  try {
    const [ledgerRes, reqRes, attachRes] = await Promise.all([
      fixedAssetApi.getAssetLedger(id),
      fixedAssetApi.getAssetRequisitions(id),
      fixedAssetApi.getAttachments(id),
    ])
    if (ledgerRes.code === 0) ledger.value = ledgerRes.data
    requisitions.value = reqRes.data
    attachments.value = attachRes.data
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
.ledger-section h4 { margin: 0 0 8px; font-size: var(--cw-text-base); display: flex; align-items: center; gap: 12px; }
.attach-upload { display: inline-block; }
.progress-section h4 { margin: 0 0 8px; font-size: var(--cw-text-base); }
.progress-bar-wrap { max-width: 500px; }
.depr-amt { color: #409eff; font-weight: 600; }
.incr { color: #67c23a; }
.decr { color: #f56c6c; }
.zero { color: var(--el-text-color-placeholder); }
</style>
