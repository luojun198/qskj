<template>
  <el-dialog v-model="visible" :title="dialogTitle" width="1200px" top="4vh" destroy-on-close @close="handleClose">
    <div v-if="detail" class="paper-voucher">
      <div class="voucher-paper-header">
        <div class="voucher-paper-title">记 账 凭 证</div>
        <div class="voucher-paper-meta">
          <div class="meta-item">
            <span class="meta-label">凭证类型</span>
            <span class="meta-text">{{ detail.voucher_type_name || '' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">凭证编号</span>
            <span class="meta-text">{{ detail.voucher_no || '' }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">日期</span>
            <span class="meta-text">{{ detail.voucher_date || '' }}</span>
          </div>
        </div>
      </div>

      <el-table :data="detail.entries" border size="small" class="paper-table">
        <el-table-column prop="summary" label="摘要" min-width="180" />
        <el-table-column label="会计科目" min-width="200">
          <template #default="{ row }">{{ row.account_code }} {{ row.account_name }}</template>
        </el-table-column>
        <el-table-column label="借方金额" width="140" align="right">
          <template #default="{ row }">
            <span v-if="row.direction === 'debit'">{{ formatMoney(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="贷方金额" width="140" align="right">
          <template #default="{ row }">
            <span v-if="row.direction === 'credit'">{{ formatMoney(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-for="col in auxColumns"
          :key="col.code"
          :label="col.name"
          width="100"
        >
          <template #default="{ row }">{{ getAuxValue(row, col.code) }}</template>
        </el-table-column>
      </el-table>

      <div class="voucher-paper-signatures">
        <div class="signature-item"><span>制单</span><em>{{ detail.maker_name || '' }}</em></div>
        <div class="signature-item"><span>审核</span><em>{{ detail.auditor_name || '' }}</em></div>
        <div class="signature-item"><span>记账</span><em>{{ detail.poster_name || '' }}</em></div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer-actions">
        <div class="footer-left">
          <el-button v-if="detail?.status === 'draft'" type="success" @click="handleAudit">审核</el-button>
          <el-button v-if="detail?.status === 'audited'" type="warning" @click="handleUnAudit">反审核</el-button>
          <el-button v-if="detail?.status === 'audited'" type="primary" @click="handlePost">记账</el-button>
          <el-button v-if="detail?.status === 'posted' && canUnpost" type="warning" @click="handleUnPost">反记账</el-button>
        </div>
        <div class="footer-right">
          <el-button v-if="detail?.status !== 'draft'" type="primary" @click="handleEdit">编辑</el-button>
          <el-button @click="handleClose">关闭</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { formatMoney } from '@/composables/useVoucherAuditData'
import request from '@/api/request'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'

interface Props {
  modelValue: boolean
  detail: any
  canUnpost?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  canUnpost: true,
})
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  audit: [row: any]
  unaudit: [row: any]
  post: [row: any]
  unpost: [row: any]
  edit: [row: any]
}>()

const visible = ref(props.modelValue)
const auxCategories = ref<any[]>([])

watch(() => props.modelValue, val => { visible.value = val })
watch(visible, val => { emit('update:modelValue', val) })

// 加载辅助核算类别
async function fetchAuxCategories() {
  try {
    const res = await request.get<any[]>('/base/aux-categories')
    auxCategories.value = filterAuxCategoriesForAccount(res.data || [])
  } catch { /* ignore */ }
}
fetchAuxCategories()

// 动态辅助列：从所有分录的 aux_data 中提取出现过的辅助类别
const auxColumns = computed(() => {
  if (!props.detail?.entries) return []
  const colMap = new Map<string, string>()
  for (const entry of props.detail.entries) {
    const auxData = parseAuxData(entry)
    for (const code of Object.keys(auxData)) {
      if (!colMap.has(code)) {
        const cat = auxCategories.value.find(c => c.code === code)
        colMap.set(code, cat?.name || code)
      }
    }
  }
  return Array.from(colMap.entries()).map(([code, name]) => ({ code, name }))
})

function parseAuxData(entry: any): Record<string, any> {
  if (!entry.aux_data) return {}
  try {
    return typeof entry.aux_data === 'string' ? JSON.parse(entry.aux_data) : entry.aux_data
  } catch { return {} }
}

function getAuxValue(row: any, code: string): string {
  const auxData = parseAuxData(row)
  return auxData[code]?.name || ''
}

const dialogTitle = computed(() => {
  if (!props.detail) return '凭证详情'
  const statusMap: Record<string, string> = { draft: '未审核', audited: '已审核', posted: '已记账' }
  return `凭证详情 - ${statusMap[props.detail.status] || ''}`
})

function handleClose() { visible.value = false }
function handleAudit() { emit('audit', props.detail) }
function handleUnAudit() { emit('unaudit', props.detail) }
function handlePost() { emit('post', props.detail) }
function handleUnPost() { emit('unpost', props.detail) }
function handleEdit() { emit('edit', props.detail) }
</script>

<style scoped>
.paper-voucher {
  border: 1px solid #dcdfe6;
  background: #fffdf7;
  padding: 20px;
}
.voucher-paper-header {
  border-bottom: 2px solid #303133;
  padding-bottom: 16px;
  margin-bottom: 16px;
}
.voucher-paper-title {
  font-size: 26px;
  letter-spacing: 8px;
  text-align: center;
  font-weight: 700;
  color: #303133;
  margin-bottom: 16px;
}
.voucher-paper-meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-label {
  white-space: nowrap;
  color: #606266;
  font-size: 13px;
}
.meta-text {
  color: #303133;
  font-size: 14px;
}
.voucher-paper-signatures {
  display: flex;
  justify-content: space-between;
  border-top: 1px dashed #c0c4cc;
  padding-top: 16px;
  margin-top: 16px;
}
.signature-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #606266;
}
.signature-item span {
  font-size: 13px;
  white-space: nowrap;
}
.signature-item em {
  font-style: normal;
  font-size: 14px;
  min-width: 80px;
  border-bottom: 1px solid #909399;
  padding: 0 4px 2px;
  text-align: center;
  display: inline-block;
  line-height: 20px;
  height: 20px;
}
.dialog-footer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.footer-left, .footer-right {
  display: flex;
  gap: 8px;
}
</style>
