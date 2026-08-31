import { ref, onActivated, onDeactivated } from 'vue'

/**
 * 把页面级工具按钮（如「列设置」）投递到顶部多标签栏右侧 `#tabbar-actions`。
 *
 * 用法：页面用 `<Teleport v-if="ptActive" defer to="#tabbar-actions">…</Teleport>` 包住按钮。
 * keep-alive 下只有「当前活动页」的 ptActive=true 才渲染该 Teleport → 内容进标签栏；
 * 非活动页 ptActive=false → 整个 Teleport 卸载（用 v-if 而非 :disabled，避免多页投递到同一目标时
 * Teleport+KeepAlive 在「移动内联」过程中触发 emitsOptions 为 null 的内部报错）。
 * `defer` 让目标在本轮渲染后再解析（#tabbar-actions 由 TabsBar 渲染，需等它先就位）。
 */
export function usePageToolbarTeleport() {
  // 初始 true：页面挂载即为活动页（仅在被导航到时才挂载）
  const ptActive = ref(true)
  onActivated(() => { ptActive.value = true })
  onDeactivated(() => { ptActive.value = false })
  return { ptActive }
}
