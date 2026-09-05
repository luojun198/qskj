import type { App, Component } from 'vue'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

const dynamicIcons: Record<string, Component> = ElementPlusIconsVue as Record<string, Component>

export function registerDynamicIcons(app: App) {
  for (const [name, component] of Object.entries(dynamicIcons)) {
    app.component(name, component)
  }
}

export function resolveDynamicIcon(name?: string) {
  return name ? dynamicIcons[name] : undefined
}

