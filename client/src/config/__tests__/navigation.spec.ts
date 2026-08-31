import { describe, it, expect } from 'vitest'
import {
  buildMenuGroups,
  canAccessRoute,
  getDefaultLandingPath,
  getRoutePermissions,
  isNavItemVisible,
  matchPermissions,
} from '@/config/navigation'

const ADMIN_PERMISSIONS = ['*']

const READONLY_PERMISSIONS = [
  'system:dashboard',
  'voucher:query',
  'ledger:general',
  'ledger:detail',
  'ledger:balance',
  'report:view',
]

const ACCOUNTANT_PERMISSIONS = [
  'voucher:entry',
  'voucher:query',
  'ledger:balance',
  'ledger:detail',
  'report:view',
  'base:account',
  'period:init',
]

describe('navigation permissions', () => {
  describe('matchPermissions', () => {
    it('超级权限 * 通过所有校验', () => {
      expect(matchPermissions(ADMIN_PERMISSIONS, 'system:user')).toBe(true)
      expect(matchPermissions(ADMIN_PERMISSIONS, ['system:user', 'system:role'])).toBe(true)
    })

    it('任一权限满足即可', () => {
      expect(matchPermissions(['voucher:audit'], ['voucher:audit', 'voucher:post'])).toBe(true)
      expect(matchPermissions(['voucher:query'], ['voucher:audit', 'voucher:post'])).toBe(false)
    })
  })

  describe('isNavItemVisible', () => {
    it('无 permission 字段时登录即可见', () => {
      expect(isNavItemVisible({ path: '/dashboard', title: '工作台' }, [], true)).toBe(true)
    })

    it('requiresCashFlow 关闭时隐藏现金流量项', () => {
      expect(
        isNavItemVisible(
          { path: '/base/cash-flow-items', title: '现金流量项目', permission: 'base:cashitem', requiresCashFlow: true },
          ADMIN_PERMISSIONS,
          false
        )
      ).toBe(false)
    })
  })

  describe('buildMenuGroups', () => {
    it('往来管理保留预收预付列表入口（位于账龄后）并合并核销导航', () => {
      const groups = buildMenuGroups(['scm:arap'], false, [])
      const arapGroup = groups.find(g => g.title === '往来管理')
      const children = arapGroup?.children || []
      // 预收/预付款单为列表入口（不再是直接打开表单的新增入口）
      expect(children).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '/scm/docs?doc_type=RCV&payment_mode=advance', title: '预收款单' }),
        expect.objectContaining({ path: '/scm/docs?doc_type=PAY&payment_mode=advance', title: '预付款单' }),
        expect.objectContaining({ path: '/scm/arap-verify', title: '往来核销' }),
      ]))
      expect(children.filter(item => item.path.startsWith('/scm/arap-verify'))).toHaveLength(1)
      // 预收款单、预付款单均位于「应收应付账龄」之后
      const agingIdx = children.findIndex(i => i.path === '/scm/arap-aging')
      const rcvAdvIdx = children.findIndex(i => i.path === '/scm/docs?doc_type=RCV&payment_mode=advance')
      const payAdvIdx = children.findIndex(i => i.path === '/scm/docs?doc_type=PAY&payment_mode=advance')
      expect(agingIdx).toBeGreaterThanOrEqual(0)
      expect(rcvAdvIdx).toBeGreaterThan(agingIdx)
      expect(payAdvIdx).toBeGreaterThan(agingIdx)
    })

    it('销售固定报表位于销售管理的销售报表子分组', () => {
      const groups = buildMenuGroups(['scm:sale', 'scm:report'], false, [])
      const salesGroup = groups.find(group => group.title === '销售管理')
      expect(salesGroup?.subGroups?.find(group => group.label === '销售报表')?.items.map(item => item.title)).toEqual([
        '销售汇总表', '销售明细表', '销售排行榜', '销售毛利分析', '销售趋势分析', '自定义查询',
      ])
      expect(salesGroup?.children.some(item => item.path.includes('/scm/report/'))).toBe(false)
      expect(groups.find(group => group.title === '销售报表')).toBeUndefined()
    })

    it('采购固定报表位于采购管理的采购报表子分组', () => {
      const groups = buildMenuGroups(['scm:purchase', 'scm:report'], false, [])
      const purchaseGroup = groups.find(group => group.title === '采购管理')
      expect(purchaseGroup?.subGroups?.find(group => group.label === '采购报表')?.items.map(item => item.title)).toEqual([
        '采购汇总表', '采购明细表', '采购订单执行表', '采购排行榜', '采购成本分析', '采购趋势分析', '自定义查询', '采购建议',
      ])
      expect(purchaseGroup?.children.some(item => item.path.includes('/scm/report/'))).toBe(false)
      expect(groups.find(group => group.title === '采购报表')).toBeUndefined()
    })

    it('admin 可见全部静态分组', () => {
      const groups = buildMenuGroups(ADMIN_PERMISSIONS, true, [
        { path: '/report/dynamic/1?view=1', title: '资产负债表', permission: 'report:view' },
      ])
      const titles = groups.map(g => g.title)
      expect(titles).toContain('基础设置')
      expect(titles).toContain('凭证管理')
      expect(titles).toContain('账簿管理')
      expect(titles).toContain('系统管理')
      expect(titles).toContain('报表管理')
    })

    it('readonly 角色仅见账簿/凭证查询/报表相关项', () => {
      const groups = buildMenuGroups(READONLY_PERMISSIONS, false, [
        { path: '/report/dynamic/1?view=1', title: '资产负债表', permission: 'report:view' },
      ])
      const titles = groups.map(g => g.title)
      expect(titles).not.toContain('基础设置')
      expect(titles).not.toContain('系统管理')
      expect(titles).toContain('账簿管理')
      expect(titles).toContain('报表管理')
      expect(titles).toContain('凭证管理')

      const voucherGroup = groups.find(g => g.title === '凭证管理')
      expect(voucherGroup?.children).toHaveLength(1)
      expect(voucherGroup?.children[0]?.path).toBe('/voucher/query')
      expect(voucherGroup?.children.some(c => c.path === '/voucher/entry')).toBe(false)

      const ledgerGroup = groups.find(g => g.title === '账簿管理')
      expect(ledgerGroup?.children.some(c => c.path === '/ledger/detail')).toBe(true)
      expect(ledgerGroup?.children.some(c => c.path === '/ledger/cash-journal')).toBe(false)
    })

    it('无 voucher:entry 时凭证录入菜单隐藏', () => {
      const groups = buildMenuGroups(READONLY_PERMISSIONS, true, [])
      const voucherGroup = groups.find(g => g.title === '凭证管理')
      expect(voucherGroup?.children.some(c => c.path === '/voucher/entry')).toBe(false)
      expect(voucherGroup?.children.some(c => c.path === '/voucher/query')).toBe(true)
    })

    it('分组内子项全被过滤时分组也隐藏', () => {
      const groups = buildMenuGroups(['system:backup'], false, [])
      const securityGroup = groups.find(g => g.title === '数据安全')
      expect(securityGroup?.children).toHaveLength(1)

      const groupsNoPerm = buildMenuGroups(['voucher:query'], false, [])
      expect(groupsNoPerm.find(g => g.title === '数据安全')).toBeUndefined()
      expect(groupsNoPerm.find(g => g.title === '辅助核算')).toBeUndefined()
    })

    it('enableCashFlow=false 时现金流量相关项隐藏', () => {
      const groups = buildMenuGroups(ACCOUNTANT_PERMISSIONS, false, [])
      const baseGroup = groups.find(g => g.title === '基础设置')
      expect(baseGroup?.children.some(c => c.path === '/base/cash-flow-items')).toBe(false)

      const ledgerGroup = groups.find(g => g.title === '账簿管理')
      expect(ledgerGroup?.children.some(c => c.path === '/ledger/cash-flow-trial-balance')).toBe(false)
    })
  })

  describe('getRoutePermissions / canAccessRoute', () => {
    it('白名单路由无需权限', () => {
      expect(getRoutePermissions('/forbidden')).toBeUndefined()
      expect(canAccessRoute('/forbidden', [])).toBe(true)
    })

    it('主页需要 system:dashboard 权限', () => {
      expect(getRoutePermissions('/dashboard')).toEqual(['system:dashboard'])
      expect(canAccessRoute('/dashboard', ['voucher:query'])).toBe(false)
      expect(canAccessRoute('/dashboard', ['system:dashboard'])).toBe(true)
      expect(canAccessRoute('/dashboard', ADMIN_PERMISSIONS)).toBe(true)
    })

    it('getDefaultLandingPath 无主页权限时落到首个可访问菜单', () => {
      expect(getDefaultLandingPath(['system:dashboard', 'voucher:query'], false)).toBe('/dashboard')
      expect(getDefaultLandingPath(['voucher:query'], false)).toBe('/voucher/query')
      expect(getDefaultLandingPath([], false)).toBe('/forbidden')
    })

    it('精确路径映射', () => {
      expect(getRoutePermissions('/voucher/entry')).toEqual(['voucher:entry'])
      expect(canAccessRoute('/voucher/entry', READONLY_PERMISSIONS)).toBe(false)
      expect(canAccessRoute('/voucher/entry', ['voucher:entry'])).toBe(true)
      expect(getRoutePermissions('/scm/report/sales/summary')).toEqual(['scm:report'])
      expect(getRoutePermissions('/scm/report/purchase/summary')).toEqual(['scm:report'])
      expect(getRoutePermissions('/scm/report/purchase/order-tracking')).toEqual(['scm:report'])
      expect(getRoutePermissions('/scm/report/stock-ledger')).toEqual(['scm:report'])
      expect(getRoutePermissions('/scm/report/outsource/execution')).toEqual(['scm:report'])
      expect(getRoutePermissions('/base/project/category/new')).toEqual(['base:project'])
      expect(getRoutePermissions('/base/project/category/cat-001/edit')).toEqual(['base:project'])
    })

    it('动态报表 /report/run/:code 匹配 report:view', () => {
      expect(getRoutePermissions('/report/run/2')).toEqual(['report:view'])
      expect(canAccessRoute('/report/run/2', READONLY_PERMISSIONS)).toBe(true)
      expect(canAccessRoute('/report/run/2', ['voucher:query'])).toBe(false)
    })

    it('动态报表 /report/dynamic/:code 匹配 report:view', () => {
      expect(getRoutePermissions('/report/dynamic/balance-sheet')).toEqual(['report:view'])
    })

    it('无 system:user 时无法访问用户管理', () => {
      expect(canAccessRoute('/system/user', READONLY_PERMISSIONS)).toBe(false)
      expect(canAccessRoute('/system/user', ADMIN_PERMISSIONS)).toBe(true)
    })
  })
})
