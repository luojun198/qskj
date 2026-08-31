<template>
  <el-dialog
    v-model="visible"
    title="无法删除核算项目"
    width="760px"
    class="aux-item-delete-block-dialog"
    destroy-on-close
    @closed="emit('closed')"
  >
    <div class="block-dialog-body">
      <el-alert type="warning" :closable="false" show-icon class="block-dialog-alert">
        <template #title>
          <span class="block-dialog-alert-title">{{ detail?.message || '该项目无法删除' }}</span>
        </template>
        <p v-if="detail?.item" class="block-dialog-item-meta">
          项目：{{ detail.item.name }}（{{ detail.item.code }}）
        </p>
      </el-alert>

      <template v-if="detail?.reason === 'voucher' && voucherRows.length > 0">
        <div class="block-dialog-section-head">
          <span class="block-dialog-section-title">关联凭证</span>
          <span class="block-dialog-section-meta">
            共 {{ detail.voucherTotal ?? voucherRows.length }} 张
            <template v-if="(detail.voucherTotal ?? 0) > voucherRows.length">
              ，以下展示前 {{ voucherRows.length }} 张
            </template>
          </span>
        </div>
        <el-table :data="voucherRows" stripe border size="small" max-height="360" class="block-dialog-table">
          <el-table-column prop="voucher_no" label="凭证号" width="120" />
          <el-table-column prop="voucher_date" label="日期" width="110" />
          <el-table-column prop="voucher_type_name" label="凭证类型" width="100" show-overflow-tooltip />
          <el-table-column label="状态" width="88" align="center">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)" size="small">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="summary" label="摘要" min-width="160" show-overflow-tooltip />
          <el-table-column label="操作" width="88" align="center" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="emit('open-voucher', row)">
                {{ row.status === 'draft' ? '编辑' : '查看' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <div v-else-if="detail?.reason === 'init_balance'" class="block-dialog-init-balance">
        <p>
          该项目已在
          <strong>{{ detail.initBalanceCount ?? 0 }}</strong>
          条辅助期初明细中被引用，请先清理相关期初数据后再删除。
        </p>
        <el-button type="primary" plain @click="emit('go-init-balance-aux')">前往辅助期初</el-button>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" @click="visible = false">我知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface AuxItemDeleteBlockDetail {
  blocked?: boolean
  reason?: 'init_balance' | 'voucher'
  message?: string
  item?: { id: string; code: string; name: string }
  vouchers?: Array<{
    id: string
    voucher_no: string
    voucher_date: string
    status: 'draft' | 'audited' | 'posted'
    voucher_type_name?: string
    summary?: string
  }>
  voucherTotal?: number
  initBalanceCount?: number
}

const visible = defineModel<boolean>({ default: false })

const props = defineProps<{
  detail: AuxItemDeleteBlockDetail | null
}>()

const emit = defineEmits<{
  'open-voucher': [row: NonNullable<AuxItemDeleteBlockDetail['vouchers']>[number]]
  'go-init-balance-aux': []
  closed: []
}>()

const voucherRows = computed(() => props.detail?.vouchers ?? [])

function statusLabel(status: string) {
  return ({ draft: '草稿', audited: '已审核', posted: '已记账' } as Record<string, string>)[status] || status
}

function statusTagType(status: string): 'info' | 'warning' | 'success' {
  if (status === 'draft') return 'info'
  if (status === 'audited') return 'warning'
  return 'success'
}
</script>

<style scoped>
.block-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block-dialog-alert-title {
  font-size: 14px;
  line-height: 1.5;
}

.block-dialog-item-meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.block-dialog-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.block-dialog-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.block-dialog-section-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.block-dialog-init-balance {
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.block-dialog-init-balance p {
  margin: 0 0 12px;
}
</style>
