<template>
  <span :class="['apple-amount', colorClass, sizeClass]">{{ formattedAmount }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatAmount } from '@/utils/format'

interface Props {
  value: number | string | null | undefined
  showColor?: boolean
  showSign?: boolean
  size?: 'sm' | 'base' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  showColor: true,
  showSign: false,
  size: 'base',
})

const numValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return 0
  return typeof props.value === 'string' ? parseFloat(props.value) : props.value
})

const formattedAmount = computed(() => {
  const formatted = formatAmount(numValue.value)
  if (props.showSign && numValue.value > 0) {
    return '+' + formatted
  }
  return formatted
})

const colorClass = computed(() => {
  if (!props.showColor) return ''
  if (numValue.value < 0) return 'apple-amount--negative'
  if (numValue.value > 0) return 'apple-amount--positive'
  return 'apple-amount--zero'
})

const sizeClass = computed(() => {
  return props.size !== 'base' ? `apple-amount--${props.size}` : ''
})
</script>

<style scoped>
@import './AmountDisplay.styles.css';
</style>
