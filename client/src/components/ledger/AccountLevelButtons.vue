<template>
  <el-button-group class="level-actions">
    <el-button size="small" :disabled="atTop" title="只看一级科目 (Ctrl+\)" @click="emit('top')">
      顶层
    </el-button>
    <el-button size="small" :disabled="atTop" title="收起一级 (Ctrl+↑)" @click="emit('up')">
      上级
    </el-button>
    <el-button size="small" :disabled="atBottom" title="展开一级 (Ctrl+↓)" @click="emit('down')">
      下级
    </el-button>
    <el-button size="small" :disabled="atBottom" title="展开到最末级 (Ctrl+Shift+\)" @click="emit('bottom')">
      底层
    </el-button>
  </el-button-group>
</template>

<script setup lang="ts">
/**
 * 科目维护同款的四个级次按钮（顶层 / 上级 / 下级 / 底层），供账册页替代「展开到 N 级」下拉。
 * 只负责外观与点击事件，级次状态由 useAccountLevelFilter 维护。
 */
defineProps<{
  atTop: boolean
  atBottom: boolean
}>()

const emit = defineEmits<{
  top: []
  up: []
  down: []
  bottom: []
}>()
</script>

<style scoped>
.level-actions {
  flex-shrink: 0;
}
</style>
