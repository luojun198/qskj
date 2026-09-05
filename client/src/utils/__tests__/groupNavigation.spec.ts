import { describe, expect, it } from 'vitest'
import { getGroupNavigationPath, resolveNavAppTitle } from '../groupNavigation'

describe('getGroupNavigationPath', () => {
  it('为分组标题生成可路由且已编码的导航地址', () => {
    expect(getGroupNavigationPath('销售管理')).toBe('/group/%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86')
  })

  it('旧模块名解析为当前标题，并生成新地址', () => {
    expect(resolveNavAppTitle('财务会计')).toBe('财务总账')
    expect(resolveNavAppTitle('资金管理')).toBe('出纳管理')
    expect(resolveNavAppTitle('资产管理')).toBe('固定资产')
    expect(resolveNavAppTitle('财务总账')).toBe('财务总账')
    expect(getGroupNavigationPath('财务会计')).toBe(getGroupNavigationPath('财务总账'))
  })
})
