<template>
  <div :class="['page', embedded ? 'page-list-embedded' : 'page-list']">
    <header v-if="title || $slots.header || $slots.actions" class="page-header">
      <div class="page-header__left">
        <h3 v-if="title">{{ title }}</h3>
        <slot name="header" />
      </div>
      <div v-if="$slots.actions" class="page-header__right">
        <slot name="actions" />
      </div>
    </header>
    
    <div v-if="$slots.filters" class="filter-row">
      <slot name="filters" />
    </div>

    <div :class="['page-body', embedded ? 'page-list-embedded__body' : 'page-list__body']">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="pagination-bar">
      <slot name="footer" />
    </footer>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  /** 嵌入已有 .page 容器时使用，不再重复包裹 .page */
  embedded?: boolean
}>()
</script>

<style scoped>
.page-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 14px 18px;
  background: var(--surface-canvas, #f3faf9);
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  flex-shrink: 0;
}

.page-header__left { display: flex; align-items: center; gap: 12px; }
.page-header h3 { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); }
.page-header__right { display: flex; gap: 8px; }

.filter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--surface-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-xs);
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.page-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-list-embedded {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.page-list-embedded__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.pagination-bar {
  margin-top: 8px;
  flex-shrink: 0;
}
</style>