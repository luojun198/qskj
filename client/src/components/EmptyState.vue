<template>
  <div class="apple-empty-state">
    <div class="apple-empty-state__icon">
      <el-icon :size="80"><component :is="icon" /></el-icon>
    </div>
    <div class="apple-empty-state__text">{{ description }}</div>
    <div v-if="showAction" class="apple-empty-state__action">
      <el-button type="primary" @click="handleAction">{{ actionText }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Document, FolderOpened, Coin } from '@element-plus/icons-vue'

interface Props {
  type?: 'voucher' | 'account' | 'data' | 'custom'
  description?: string
  showAction?: boolean
  actionText?: string
  icon?: any
}

const props = withDefaults(defineProps<Props>(), {
  type: 'data',
  showAction: false,
  actionText: '新增',
})

const emit = defineEmits<{
  action: []
}>()

const defaultDescriptions = {
  voucher: '暂无凭证数据，点击下方按钮开始录入',
  account: '暂无科目数据，请先设置会计科目',
  data: '暂无数据',
  custom: '',
}

const defaultIcons = {
  voucher: Document,
  account: FolderOpened,
  data: Coin,
  custom: Document,
}

const description = props.description || defaultDescriptions[props.type]
const icon = props.icon || defaultIcons[props.type]

const handleAction = () => {
  emit('action')
}
</script>

<style scoped>
@import './EmptyState.styles.css';
</style>
