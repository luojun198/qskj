<template>
  <span :class="['apple-status-tag', tagClass]">{{ statusText }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  status: 'draft' | 'audited' | 'posted' | string
  size?: 'large' | 'default' | 'small'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'default',
})

const statusMap: Record<string, { text: string; type: string }> = {
  draft: { text: '草稿', type: 'draft' },
  audited: { text: '已审核', type: 'audited' },
  posted: { text: '已记账', type: 'posted' },
}

const statusText = computed(() => {
  return statusMap[props.status]?.text || props.status
})

const tagClass = computed(() => {
  const type = statusMap[props.status]?.type || 'default'
  return `apple-status-tag--${type}`
})
</script>

<style scoped>
@import './StatusTag.styles.css';
</style>
