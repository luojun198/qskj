<template>
  <div class="account-display-switch">
    <span v-if="showLabel" class="account-display-switch__label">科目显示</span>
    <el-radio-group
      :model-value="accountDisplayMode"
      :size="size"
      @update:model-value="onChange"
    >
      <el-radio-button label="leaf" value="leaf" title="只显示末级科目名称">
        末级科目
      </el-radio-button>
      <el-radio-button label="full" value="full" title="显示完整路径，如 5602004 管理费用/办公费">
        完整路径
      </el-radio-button>
    </el-radio-group>
  </div>
</template>

<script setup lang="ts">
/** 「科目显示」末级/完整路径切换；偏好按用户 + 账套存本地，凭证各列表与录入窗口共用 */
import { onMounted } from 'vue'
import { accountDisplayMode, setAccountDisplayMode } from '@/utils/accountDisplayPreference'
import { getActivePinia } from 'pinia'
import { useBaseDataStore } from '@/stores/baseData'

/** 拼全路径要靠完整科目表，而列表页的科目是懒加载的，这里按需补一次 */
function ensureAccounts() {
  if (accountDisplayMode.value !== 'full') return
  if (!getActivePinia()) return
  void useBaseDataStore().loadAccounts()
}

onMounted(ensureAccounts)

withDefaults(
  defineProps<{
    /** 是否显示「科目显示」文字标签 */
    showLabel?: boolean
    size?: 'small' | 'default' | 'large'
  }>(),
  { showLabel: true, size: 'small' }
)

function onChange(mode: string | number | boolean | undefined) {
  setAccountDisplayMode(mode === 'full' ? 'full' : 'leaf')
  ensureAccounts()
}
</script>

<style scoped>
.account-display-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.account-display-switch__label {
  color: var(--el-text-color-regular);
  font-size: 12px;
}
</style>
