import { describe, expect, it } from 'vitest'
import { buildMenuGroups, getRoutePermissions } from '@/config/navigation'

describe('销售订单关联表导航', () => {
  it('仅 scm:sale 权限可见并允许访问路由', () => {
    expect(getRoutePermissions('/scm/sales-order-relations')).toEqual(['scm:sale'])

    const visibleGroups = buildMenuGroups(['scm:sale'], false, [])
    const salesGroup = visibleGroups.find(group => group.title === '销售管理')
    expect(salesGroup?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/scm/sales-order-relations', title: '销售订单关联表' }),
    ]))

    const hiddenGroups = buildMenuGroups([], false, [])
    expect(hiddenGroups.flatMap(group => group.children).some(item => item.path === '/scm/sales-order-relations')).toBe(false)
  })
})
