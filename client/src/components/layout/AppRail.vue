<template>
  <nav class="app-rail" aria-label="应用导航">
    <button class="app-rail__logo" type="button" title="回到工作台" @click="emit('home')">
      <img :src="logoSrc" :alt="brandTitle" class="app-rail__logo-img" />
    </button>

    <div class="app-rail__list" role="tablist">
      <button
        type="button"
        class="app-rail__item app-rail__item--workbench"
        :class="{ 'is-active': activeAppKey === WORKBENCH_APP_KEY, 'is-home': isHomePath('/dashboard') }"
        :title="isHomePath('/dashboard') ? '工作台（默认主页）' : '工作台'"
        role="tab"
        :aria-selected="activeAppKey === WORKBENCH_APP_KEY"
        @click="emit('home')"
        @contextmenu.prevent="emit('context', { app: null, event: $event })"
      >
        <span class="app-rail__icon">
          <component :is="resolveNavIcon('LayoutDashboard')" :size="20" :stroke-width="1.8" />
          <i v-if="isHomePath('/dashboard')" class="app-rail__home-dot" aria-hidden="true"></i>
        </span>
        <span class="app-rail__label">工作台</span>
      </button>

      <button
        v-for="app in apps"
        :key="app.key"
        type="button"
        class="app-rail__item"
        :class="{ 'is-active': activeAppKey === app.key, 'is-home': isHomeApp(app) }"
        :title="appTitle(app)"
        role="tab"
        :aria-selected="activeAppKey === app.key"
        @click="emit('select', app)"
        @contextmenu.prevent="emit('context', { app, event: $event })"
        @mouseenter="emit('preload', app)"
        @focus="emit('preload', app)"
      >
        <span class="app-rail__icon">
          <component :is="resolveNavIcon(app.icon)" :size="20" :stroke-width="1.8" />
          <i v-if="isHomeApp(app)" class="app-rail__home-dot" aria-hidden="true"></i>
        </span>
        <span class="app-rail__label">{{ shortLabel(app.title) }}</span>
      </button>
    </div>

    <div class="app-rail__footer">
      <span v-if="version" class="app-rail__version" :title="`版本 ${version}`">v{{ version }}</span>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { WORKBENCH_APP_KEY, type NavApp } from '@/config/navigation'
import { resolveNavIcon } from '@/config/navIcons'
import { getGroupNavigationPath } from '@/utils/groupNavigation'

const props = defineProps<{
  apps: NavApp[]
  /** 当前高亮的应用键（按路由归属推导） */
  activeAppKey: string
  logoSrc: string
  brandTitle: string
  version?: string
  /** 用户设置的默认主页路径，'' 表示未自定义 */
  homePath?: string
}>()

const emit = defineEmits<{
  (e: 'select', app: NavApp): void
  (e: 'preload', app: NavApp): void
  (e: 'home'): void
  (e: 'context', payload: { app: NavApp | null; event: MouseEvent }): void
}>()

function isHomePath(path: string): boolean {
  return !!props.homePath && props.homePath === path
}

function isHomeApp(app: NavApp): boolean {
  return isHomePath(getGroupNavigationPath(app.title))
}

function appTitle(app: NavApp): string {
  const base = app.description ? `${app.title} · ${app.description}` : app.title
  return isHomeApp(app) ? `${base}（默认主页）` : base
}

/** 应用栏标签最多四字，超长时去掉「管理」后缀 */
function shortLabel(title: string): string {
  if (title.length <= 4) return title
  const trimmed = title.replace(/管理$/, '')
  return trimmed.length <= 4 ? trimmed : trimmed.slice(0, 4)
}
</script>

<style scoped>
.app-rail {
  width: var(--app-rail-width, 64px);
  flex: 0 0 var(--app-rail-width, 64px);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: linear-gradient(180deg, #0f3d3a 0%, #0b2f2d 100%);
  color: rgba(255, 255, 255, 0.72);
  user-select: none;
  position: relative;
  z-index: 2;
}

.app-rail__logo {
  /* 与顶栏同高，保持左上角对齐 */
  height: var(--layout-header-h, 40px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  padding: 0;
}

.app-rail__logo-img {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: transparent;
  object-fit: contain;
  object-position: center;
  padding: 0;
  display: block;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

.app-rail__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: none;
}

.app-rail__list::-webkit-scrollbar {
  display: none;
}

.app-rail__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 56px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  transition: background 0.18s ease, color 0.18s ease;
}

.app-rail__item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.app-rail__item.is-active {
  background: rgba(18, 199, 174, 0.22);
  color: #fff;
}

.app-rail__item.is-active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #12c7ae;
}

.app-rail__item:focus-visible {
  outline: 2px solid #12c7ae;
  outline-offset: -2px;
}

.app-rail__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}

.app-rail__home-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffc53d;
  box-shadow: 0 0 0 1.5px rgba(11, 47, 45, 0.9);
}

.app-rail__item.is-home .app-rail__label {
  color: #fff;
}

.app-rail__label {
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

.app-rail__footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.app-rail__version {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.2px;
}
</style>
