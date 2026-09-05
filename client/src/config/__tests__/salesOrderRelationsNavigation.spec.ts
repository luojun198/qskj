import { describe, expect, it } from 'vitest'
import { buildNavApps, flattenNavApps, getRoutePermissions } from '@/config/navigation'

describe('销售订单关联表导航', () => {
  it('仅 scm:sale 权限可见并允许访问路由', () => {
    expect(getRoutePermissions('/scm/sales-order-relations')).toEqual(['scm:sale'])

    const visibleApps = buildNavApps(['scm:sale'], false, [])
    const sales = visibleApps.find(app => app.key === 'sales')
    expect(sales?.sections.find(s => s.label === '销售业务')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/scm/sales-order-relations', title: '销售订单关联表' }),
    ]))

    const hiddenApps = buildNavApps([], false, [])
    expect(flattenNavApps(hiddenApps).some(item => item.path === '/scm/sales-order-relations')).toBe(false)
  })
})
