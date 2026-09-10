<template>
  <button
    v-if="node.action"
    type="button"
    class="gl-tile"
    :class="tileClass"
    :disabled="!enabled"
    @click="emit('action', node)"
  >
    <span class="gl-tile__icon">
      <component :is="icon" :size="iconSize" :stroke-width="1.6" />
    </span>
    <span class="gl-tile__title">{{ node.title }}</span>
  </button>

  <span v-else-if="!enabled" class="gl-tile" :class="tileClass" aria-disabled="true" title="当前无权限访问">
    <span class="gl-tile__icon">
      <component :is="icon" :size="iconSize" :stroke-width="1.6" />
    </span>
    <span class="gl-tile__title">{{ node.title }}</span>
  </span>

  <router-link v-else class="gl-tile" :class="tileClass" :to="node.path || ''">
    <span class="gl-tile__icon">
      <component :is="icon" :size="iconSize" :stroke-width="1.6" />
    </span>
    <span class="gl-tile__title">{{ node.title }}</span>
  </router-link>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GlFlowNode } from '@/config/glWorkspace'
import { resolveNavIcon } from '@/config/navIcons'

const props = withDefaults(
  defineProps<{
    node: GlFlowNode
    /** 主干节点：图标更大 */
    main?: boolean
    /** 有权访问；主干节点无权限时灰显占位，非主干节点由父组件决定是否渲染 */
    enabled: boolean
  }>(),
  { main: false }
)

const emit = defineEmits<{ action: [node: GlFlowNode] }>()

const icon = computed(() => resolveNavIcon(props.node.icon))
const iconSize = computed(() => (props.main ? 22 : 18))
const tileClass = computed(() => [`is-${props.node.color}`, { 'gl-tile--main': props.main, 'is-disabled': !props.enabled }])
</script>

<style scoped>
.gl-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: var(--gl-node-w, 96px);
  padding: 6px 4px 4px;
  border: 1px solid transparent;
  border-radius: var(--wb-radius);
  background: transparent;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}

.gl-tile:hover:not(.is-disabled) {
  border-color: var(--wb-line);
  background: var(--wb-card);
  box-shadow: var(--wb-shadow-hover);
  transform: translateY(-2px);
}

.gl-tile:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.gl-tile.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(1);
}

.gl-tile__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.04), 0 1px 3px rgba(15, 35, 40, 0.06);
}

.gl-tile--main .gl-tile__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
}

.gl-tile__icon svg {
  fill: none;
  stroke: currentColor;
}

.gl-tile__title {
  font-size: var(--cw-text-sm);
  font-weight: 500;
  line-height: 1.3;
  color: var(--wb-text);
  text-align: center;
  white-space: nowrap;
}

.gl-tile--main .gl-tile__title {
  font-size: var(--cw-text-sm);
  font-weight: 600;
  letter-spacing: 0.3px;
}

.gl-tile.is-blue .gl-tile__icon { background: var(--blue-100); color: var(--blue-700); }
.gl-tile.is-mint .gl-tile__icon { background: var(--mint-100); color: var(--mint-700); }
.gl-tile.is-lilac .gl-tile__icon { background: #ede9ff; color: #6f5fd8; }
.gl-tile.is-amber .gl-tile__icon { background: var(--warning-soft); color: #b97a14; }
.gl-tile.is-rose .gl-tile__icon { background: var(--danger-soft); color: #d7434a; }
.gl-tile.is-foam .gl-tile__icon { background: #e3f6fb; color: #1e7f9a; }

@media (prefers-reduced-motion: reduce) {
  .gl-tile {
    transition: none;
  }

  .gl-tile:hover:not(.is-disabled) {
    transform: none;
  }
}
</style>
