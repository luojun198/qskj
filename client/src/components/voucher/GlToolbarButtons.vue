<template>
  <!-- 单行工具按钮（图标在左、文字在右）；带 group 的按钮收进下拉，参照金蝶「审核 ▾ / 打印 ▾ / 更多 ▾」 -->
  <template v-for="item in renderItems" :key="item.key">
    <button
      v-if="item.type === 'btn'"
      type="button"
      class="gl-tool-btn"
      :class="btnClass(item.btn)"
      :disabled="item.btn.disabled"
      :title="item.btn.tooltip || item.btn.name"
      @click="item.btn.action"
    >
      <span class="gl-tool-btn__icon">
        <component :is="item.btn.icon" :size="15" :stroke-width="1.8" />
      </span>
      <span class="gl-tool-btn__label">{{ item.btn.name }}</span>
    </button>

    <span v-else class="gl-tool-group" :class="{ 'is-split': item.split }">
      <!-- 分体按钮：主体执行组内第一项，箭头展开其余 -->
      <button
        v-if="item.split"
        type="button"
        class="gl-tool-btn gl-tool-group__main"
        :class="btnClass(item.items[0])"
        :disabled="item.items[0].disabled"
        :title="item.items[0].tooltip || item.items[0].name"
        @click="item.items[0].action"
      >
        <span class="gl-tool-btn__icon">
          <component :is="item.icon || item.items[0].icon" :size="15" :stroke-width="1.8" />
        </span>
        <span class="gl-tool-btn__label">{{ item.label }}</span>
      </button>
      <el-dropdown trigger="click" placement="bottom-start" @command="runCommand">
        <button
          type="button"
          class="gl-tool-btn gl-tool-group__trigger"
          :class="{ 'is-caret-only': item.split }"
          :title="item.label"
        >
          <span v-if="!item.split" class="gl-tool-btn__icon">
            <component :is="item.icon || item.items[0].icon" :size="15" :stroke-width="1.8" />
          </span>
          <span v-if="!item.split" class="gl-tool-btn__label">{{ item.label }}</span>
          <ChevronDown class="gl-tool-group__caret" :size="12" :stroke-width="2" />
        </button>
        <template #dropdown>
          <el-dropdown-menu class="gl-tool-menu">
            <el-dropdown-item
              v-for="b in item.split ? item.items.slice(1) : item.items"
              :key="b.key"
              :command="b.key"
              :disabled="b.disabled"
              :title="b.tooltip || b.name"
              :class="b.tone ? `gl-tool-menu__item--${b.tone}` : ''"
            >
              <component :is="b.icon" :size="14" :stroke-width="1.8" class="gl-tool-menu__icon" />
              <span>{{ b.name }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </span>
  </template>
</template>

<script setup lang="ts">
// 凭证页共用全局样式：用脚本 import 而非 <style src>。
// 多个组件 <style src> 同一文件时，生产构建只编译一份且可能套用某个导入方的 scoped，导致其它页面样式丢失（FIX-344）
import '@/views/voucher/voucher.styles.css'
import { computed, type Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

export interface GlToolbarButton {
  key: string
  name: string
  icon: Component
  tooltip?: string
  disabled?: boolean
  tone?: 'forward' | 'reverse'
  action: () => unknown
  /** 所属下拉组；为空则直接平铺在工具栏上 */
  group?: string
}

export interface GlToolbarGroup {
  label: string
  icon?: Component
  /** 分体按钮：主体直接执行组内第一项 */
  split?: boolean
}

const props = defineProps<{
  buttons: GlToolbarButton[]
  groups?: Record<string, GlToolbarGroup>
}>()

type RenderItem =
  | { type: 'btn'; key: string; btn: GlToolbarButton }
  | { type: 'group'; key: string; label: string; icon?: Component; split: boolean; items: GlToolbarButton[] }

// 按首次出现的位置放置下拉组，组内顺序与 buttons 一致
const renderItems = computed<RenderItem[]>(() => {
  const out: RenderItem[] = []
  const seen = new Set<string>()
  for (const btn of props.buttons) {
    const g = btn.group ? props.groups?.[btn.group] : undefined
    if (!btn.group || !g) {
      out.push({ type: 'btn', key: btn.key, btn })
      continue
    }
    if (seen.has(btn.group)) continue
    seen.add(btn.group)
    const items = props.buttons.filter(b => b.group === btn.group)
    out.push({
      type: 'group',
      key: `group-${btn.group}`,
      label: g.label,
      icon: g.icon,
      split: !!g.split && items.length > 1,
      items,
    })
  }
  return out
})

function btnClass(btn: GlToolbarButton) {
  return { 'is-disabled': btn.disabled, [`gl-tool-btn--${btn.tone}`]: !!btn.tone }
}

function runCommand(key: string) {
  const btn = props.buttons.find(b => b.key === key)
  if (btn && !btn.disabled) btn.action()
}
</script>
