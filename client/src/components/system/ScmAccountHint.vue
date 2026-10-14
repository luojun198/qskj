<template>
  <div v-if="text" class="scm-acc-hint" :class="`is-${tone}`">{{ text }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * 供应链对方科目的「自动匹配」提示。
 *
 * 这批科目未配置时系统会按「默认编码 → 科目名称」自动匹配本账套科目，
 * 用户在参数页看到的只是个空输入框，不知道实际会记到哪个科目；
 * 尤其 ACD 导入的账套用润衡科目表（进项税是 2221001001 而不是默认的 22210101），
 * 以及行政事业科目表里 6401 被用作「经营预算收入」这类编码撞车的情况，必须让用户看得见。
 */
export interface ScmAccountResolveInfo {
  param_key: string
  label: string
  resolved_code: string
  resolved_name: string
  /** 自动匹配命中上级、已下探到末级时的原上级编码 */
  parent_code?: string
  /** param=已配置 code=命中默认编码 name=按名称匹配 code_mismatch=编码撞车需确认 空=找不到 */
  source: '' | 'param' | 'code' | 'name' | 'code_mismatch'
  candidates: Array<{ code: string; name: string }>
}

const props = defineProps<{
  info?: ScmAccountResolveInfo
  /** 用户是否已在本页填了值（填了就不用再提示自动匹配结果） */
  configured?: boolean
}>()

const tone = computed(() => {
  if (!props.info) return 'muted'
  if (!props.info.resolved_code) return 'danger'
  if (props.info.source === 'code_mismatch') return 'warning'
  return 'muted'
})

const text = computed(() => {
  const info = props.info
  if (!info || props.configured) return ''
  if (!info.resolved_code) {
    const tail = info.candidates.length
      ? `本账套候选：${info.candidates.map(c => `${c.code} ${c.name}`).join('、')}`
      : '本账套未找到同类科目，请先在会计科目中补建'
    return `⚠ 未配置且自动匹配失败，生成凭证会失败。${tail}`
  }
  const hit = `${info.resolved_code}${info.resolved_name ? ' ' + info.resolved_name : ''}`
  if (info.source === 'code_mismatch') {
    return `⚠ 自动匹配到 ${hit}，但名称与「${info.label}」不符，建议手工指定`
  }
  const from = info.parent_code ? `（由上级 ${info.parent_code} 下探到末级）` : ''
  return `未配置，当前自动匹配到 ${hit}${from}`
})
</script>

<style scoped>
.scm-acc-hint {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.scm-acc-hint.is-warning { color: var(--el-color-warning); }
.scm-acc-hint.is-danger { color: var(--el-color-danger); }
</style>
