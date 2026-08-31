import { describe, expect, it } from 'vitest'
import { getGroupNavigationPath } from '../groupNavigation'

describe('getGroupNavigationPath', () => {
  it('为分组标题生成可路由且已编码的导航地址', () => {
    expect(getGroupNavigationPath('销售管理')).toBe('/group/%E9%94%80%E5%94%AE%E7%AE%A1%E7%90%86')
  })
})
