import { describe, expect, it } from 'vitest'
import { DEFAULT_NAV_ICON, NAV_ICONS, isNavIconKey, resolveNavIcon } from '@/config/navIcons'
import { buildNavApps } from '@/config/navigation'
import { groupFlowMap } from '@/config/flowConfig'

describe('navIcons', () => {
  it('每个注册的图标键都能解析出组件', () => {
    for (const key of Object.keys(NAV_ICONS)) {
      expect(isNavIconKey(key), key).toBe(true)
      expect(resolveNavIcon(key)).toBe(NAV_ICONS[key as keyof typeof NAV_ICONS])
    }
  })

  it('未知键与空值回退到默认图标', () => {
    expect(resolveNavIcon('NoSuchIcon')).toBe(NAV_ICONS[DEFAULT_NAV_ICON])
    expect(resolveNavIcon(undefined)).toBe(NAV_ICONS[DEFAULT_NAV_ICON])
    expect(resolveNavIcon(null)).toBe(NAV_ICONS[DEFAULT_NAV_ICON])
    expect(isNavIconKey('')).toBe(false)
  })

  it('导航树里所有应用与页面图标都已注册（含现金流量开关打开时的项）', () => {
    const apps = buildNavApps(['*'], true, [])
    const missing: string[] = []
    for (const app of apps) {
      if (!isNavIconKey(app.icon)) missing.push(`${app.title}:${app.icon}`)
      for (const section of app.sections) {
        for (const item of section.items) {
          if (!isNavIconKey(item.icon)) missing.push(`${item.title}:${item.icon}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('模块首页流程图的显式图标键都已注册，且流程键对应真实应用标题', () => {
    const apps = buildNavApps(['*'], true, [])
    const titles = new Set(apps.map(app => app.title))
    for (const [title, config] of Object.entries(groupFlowMap)) {
      expect(titles.has(title), `flowConfig 键 ${title} 不是应用标题`).toBe(true)
      const nodes = [...(config.mainNodes || []), ...(config.auxNodes || [])]
      for (const node of nodes) {
        if (node.icon) expect(isNavIconKey(node.icon), `${title}/${node.id}:${node.icon}`).toBe(true)
        for (const branch of node.branches || []) {
          if (branch.icon) expect(isNavIconKey(branch.icon), `${title}/${branch.id}:${branch.icon}`).toBe(true)
        }
      }
    }
  })
})
