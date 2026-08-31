<template>
  <div class="dialog-navigation">
    <el-button-group>
      <el-button
        size="small"
        :disabled="isFirst"
        @click="emit('navigate', 'first')"
        title="首项"
      >
        首项
      </el-button>
      <el-button
        size="small"
        :disabled="isFirst"
        @click="emit('navigate', 'previous')"
        title="上项"
      >
        上项
      </el-button>
      <el-button
        size="small"
        :disabled="isLast"
        @click="emit('navigate', 'next')"
        title="下项"
      >
        下项
      </el-button>
      <el-button
        size="small"
        :disabled="isLast"
        @click="emit('navigate', 'last')"
        title="尾项"
      >
        尾项
      </el-button>
    </el-button-group>
    <span class="navigation-info" v-if="total > 0">
      第 {{ current }} 项 / 共 {{ total }} 项
    </span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  current: number
  total: number
  isFirst: boolean
  isLast: boolean
}>()

const emit = defineEmits<{
  navigate: [direction: 'first' | 'previous' | 'next' | 'last']
}>()
</script>

<style scoped>
.dialog-navigation {
  display: flex;
  align-items: center;
  gap: 12px;
}
.navigation-info {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}
</style>
