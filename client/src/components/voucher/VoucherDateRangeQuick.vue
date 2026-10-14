<template>
  <div class="vdr-quick" @keydown.enter.capture="normalizeTyped" @change.capture="normalizeTyped">
    <span class="vdr-quick__label">日期</span>
    <el-date-picker
      v-model="start"
      type="date"
      size="small"
      class="vdr-quick__picker"
      style="width: 96px"
      placeholder="开始日期"
      format="YYYY-MM-DD"
      value-format="YYYY-MM-DD"
      :clearable="false"
      @change="commit"
    />
    <span class="vdr-quick__sep">至</span>
    <el-date-picker
      v-model="end"
      type="date"
      size="small"
      class="vdr-quick__picker"
      style="width: 96px"
      placeholder="结束日期"
      format="YYYY-MM-DD"
      value-format="YYYY-MM-DD"
      :clearable="false"
      @change="commit"
    />
    <el-dropdown trigger="click" @command="handleQuick">
      <el-button size="small" class="vdr-quick__more" title="快捷日期">
        <el-icon><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="today">今天</el-dropdown-item>
          <el-dropdown-item command="week">本周</el-dropdown-item>
          <el-dropdown-item command="month">本月</el-dropdown-item>
          <el-dropdown-item command="lastMonth">上月</el-dropdown-item>
          <el-dropdown-item command="quarter">本季</el-dropdown-item>
          <el-dropdown-item command="year">本年</el-dropdown-item>
          <el-dropdown-item command="clear" divided>不限日期</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
/**
 * 凭证列表表头的日期起止快捷输入（常驻，不折叠）。
 * - 起止两个日期框可直接键入，支持 20261001、10-1、1001、15 等简写（见 utils/looseDate）
 * - 两端都填或都清空时才提交，避免半开区间让批量操作的 BETWEEN 失效
 * - 右侧下拉：今天 / 本周 / 本月 / 上月 / 本季 / 本年 / 不限日期
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { parseLooseDate, quickDateRange, type QuickDateKey } from '@/utils/looseDate'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  change: [value: string[]]
}>()

const start = ref('')
const end = ref('')

watch(
  () => props.modelValue,
  v => {
    start.value = v?.[0] || ''
    end.value = v?.[1] || ''
  },
  { immediate: true, deep: true }
)

/**
 * 日期框按 YYYY-MM-DD 解析，简写会被当成非法值丢弃。
 * 在捕获阶段（早于日期框自己的回车 / change 处理）把简写改写成标准格式，
 * 再派发 input 事件同步给日期框。
 */
function normalizeTyped(e: Event) {
  const input = e.target as HTMLInputElement | null
  if (!input || input.tagName !== 'INPUT') return
  const raw = input.value.trim()
  if (!raw) return
  const parsed = parseLooseDate(raw)
  if (parsed === null) {
    ElMessage.warning(`无法识别的日期：${raw}`)
    return
  }
  if (parsed && parsed !== raw) {
    input.value = parsed
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function commit() {
  let s = start.value || ''
  let t = end.value || ''
  if (!!s !== !!t) return
  if (s && t && s > t) {
    ;[s, t] = [t, s]
    start.value = s
    end.value = t
  }
  const next = s ? [s, t] : []
  const prev = props.modelValue || []
  if (next.join('|') === prev.join('|')) return
  emit('update:modelValue', next)
  emit('change', next)
}

function handleQuick(cmd: QuickDateKey | 'clear') {
  if (cmd === 'clear') {
    start.value = ''
    end.value = ''
  } else {
    ;[start.value, end.value] = quickDateRange(cmd)
  }
  commit()
}
</script>

<style scoped>
.vdr-quick {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.vdr-quick__label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}
.vdr-quick__sep {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
/* 去掉日期框左侧日历图标，省出宽度给日期文本；点输入框仍会弹出日历 */
.vdr-quick :deep(.el-input__prefix) {
  display: none;
}
.vdr-quick__more {
  padding: 5px 6px;
}
</style>
