import { describe, it, expect } from 'vitest'
import {
  buildMenuGroups,
  buildNavApps,
  canAccessRoute,
  flattenNavApps,
  getDefaultLandingPath,
  getRouteModules,
  isValidHomePath,
  getRoutePermissions,
  isNavItemVisible,
  locateNavItem,
  matchPermissions,
} from '@/config/navigation'
import { isNavIconKey } from '@/config/navIcons'

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

  describe('buildNavApps（应用 › 分组 › 页面）', () => {
    const ALL_APP_KEYS = [
      'finance', 'cashier', 'asset', 'purchase', 'sales', 'inventory', 'arap',
      'production', 'outsource', 'basedata', 'system',
    ]

    it('admin 可见全部 11 个应用，顺序固定', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [])
      expect(apps.map(a => a.key)).toEqual(ALL_APP_KEYS)
    })

    it('每个应用有图标、每个分组至少一项、每个页面配有可解析的 Lucide 图标键', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [])
      for (const app of apps) {
        expect(isNavIconKey(app.icon), `${app.title} 应用图标 ${app.icon}`).toBe(true)
        expect(app.sections.length).toBeGreaterThan(0)
        for (const section of app.sections) {
          expect(section.items.length, `${app.title} › ${section.label}`).toBeGreaterThan(0)
          for (const item of section.items) {
            expect(isNavIconKey(item.icon), `${item.title} 图标 ${item.icon}`).toBe(true)
          }
        }
      }
    })

    it('同一路径只出现在一个应用里（收款单/付款单只在应收应付）', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [])
      const seen = new Map<string, string>()
      for (const app of apps) {
        for (const item of flattenNavApps([app])) {
          // 出纳档案/资产档案在「基础资料」与各自应用里刻意双挂，其余路径必须唯一
          const allowDuplicate = ['/cashier/settle-type', '/cashier/init-balance', '/asset/dict'].includes(item.path)
          if (seen.has(item.path) && !allowDuplicate) {
            throw new Error(`${item.path} 同时出现在 ${seen.get(item.path)} 与 ${app.title}`)
          }
          seen.set(item.path, app.title)
        }
      }
      const rcvOwner = apps.filter(app => flattenNavApps([app]).some(i => i.path === '/scm/docs?doc_type=RCV'))
      expect(rcvOwner.map(a => a.key)).toEqual(['arap'])
      const payOwner = apps.filter(app => flattenNavApps([app]).some(i => i.path === '/scm/docs?doc_type=PAY'))
      expect(payOwner.map(a => a.key)).toEqual(['arap'])
    })

    it('财务会计包含凭证处理/账簿查询/辅助核算/财务报表四个分组，动态报表并入财务报表', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [
        { path: '/report/dynamic/1?view=1', title: '资产负债表', permission: 'report:view' },
      ])
      const finance = apps.find(a => a.key === 'finance')
      expect(finance?.sections.map(s => s.label)).toEqual(['凭证处理', '账簿查询', '辅助核算', '财务报表'])
      const reports = finance?.sections.find(s => s.label === '财务报表')
      expect(reports?.items.map(i => i.title)).toEqual([
        '标准报表',
        '财务分析',
        '现金流量表(估算)',
        '资产负债表',
      ])
      expect(reports?.items.find(i => i.title === '资产负债表')?.icon).toBe('FileBarChart2')
    })

    it('销售/采购报表位于各自应用的报表分组', () => {
      const apps = buildNavApps(['scm:sale', 'scm:purchase', 'scm:report'], false, [])
      const sales = apps.find(a => a.key === 'sales')
      expect(sales?.sections.find(s => s.label === '销售报表')?.items.map(i => i.title)).toEqual([
        '销售汇总表', '销售明细表', '销售排行榜', '销售毛利分析', '销售趋势分析', '自定义查询',
      ])
      const purchase = apps.find(a => a.key === 'purchase')
      expect(purchase?.sections.find(s => s.label === '采购报表')?.items.map(i => i.title)).toEqual([
        '采购汇总表', '采购明细表', '采购订单执行表', '采购排行榜', '采购成本分析', '采购趋势分析', '自定义查询',
      ])
      expect(purchase?.sections.find(s => s.label === '缺料与建议')?.items.map(i => i.title)).toEqual(['缺料单', '采购建议'])
    })

    it('应收应付：收付款 / 核销对账 / 往来查询三组，预收预付为列表入口', () => {
      const apps = buildNavApps(['scm:arap'], false, [])
      const arap = apps.find(a => a.key === 'arap')
      expect(arap?.sections.map(s => s.label)).toEqual(['收付款', '核销对账', '往来查询'])
      expect(arap?.sections[0].items.map(i => i.path)).toEqual([
        '/scm/docs?doc_type=RCV',
        '/scm/docs?doc_type=PAY',
        '/scm/docs?doc_type=RCV&payment_mode=advance',
        '/scm/docs?doc_type=PAY&payment_mode=advance',
      ])
      expect(flattenNavApps([arap!]).filter(i => i.path.startsWith('/scm/arap-verify'))).toHaveLength(1)
    })

    it('readonly 角色仅见财务会计中的查询项', () => {
      const apps = buildNavApps(READONLY_PERMISSIONS, false, [
        { path: '/report/dynamic/1?view=1', title: '资产负债表', permission: 'report:view' },
      ])
      expect(apps.map(a => a.key)).toEqual(['finance'])
      const finance = apps[0]
      const voucher = finance.sections.find(s => s.label === '凭证处理')
      expect(voucher?.items.map(i => i.path)).toEqual(['/voucher/query'])
      const ledger = finance.sections.find(s => s.label === '账簿查询')
      expect(ledger?.items.some(i => i.path === '/ledger/detail')).toBe(true)
      expect(ledger?.items.some(i => i.path === '/ledger/multi-column')).toBe(false)
      expect(ledger?.items.some(i => i.path === '/ledger/cash-journal')).toBe(false)
      // 财务分析与科目余额表同权（ledger:balance），只读角色可见
      expect(finance.sections.find(s => s.label === '财务报表')?.items.map(i => i.title)).toEqual(['标准报表', '财务分析', '资产负债表'])
    })

    it('多栏账路径使用独立权限', () => {
      expect(getRoutePermissions('/ledger/multi-column')).toEqual(['ledger:multirow'])
      expect(buildNavApps(['ledger:multirow'], false, []).flatMap(app => app.sections.flatMap(section => section.items)).some(item => item.path === '/ledger/multi-column')).toBe(true)
      expect(buildNavApps(['ledger:detail'], false, []).flatMap(app => app.sections.flatMap(section => section.items)).some(item => item.path === '/ledger/multi-column')).toBe(false)
    })
    it('分组内子项全被过滤时分组隐藏，应用内分组全空时应用隐藏', () => {
      const apps = buildNavApps(['system:backup'], false, [])
      expect(apps.map(a => a.key)).toEqual(['system'])
      expect(apps[0].sections.map(s => s.label)).toEqual(['运维'])
      expect(apps[0].sections[0].items.map(i => i.path)).toEqual(['/security/backup'])

      expect(buildNavApps(['voucher:query'], false, []).some(a => a.key === 'system')).toBe(false)
    })

    it('enableCashFlow=false 时现金流量相关项隐藏', () => {
      const apps = buildNavApps(ACCOUNTANT_PERMISSIONS, false, [])
      const all = flattenNavApps(apps)
      expect(all.some(i => i.path === '/ledger/cash-flow-trial-balance')).toBe(false)
      expect(all.some(i => i.path === '/report/cash-flow')).toBe(false)
    })

    it('基础资料：财务档案直挂总账项，出纳/资产/供应链档案按模块分组', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [])
      const basedata = apps.find(a => a.key === 'basedata')
      expect(basedata?.sections.map(s => s.label)).toEqual(['财务档案', '出纳档案', '资产档案', '供应链档案', '报表与打印'])
      expect(basedata?.sections[0].items.map(i => i.title)).toEqual(['会计科目', '套账信息', '期初余额', '凭证类型', '凭证模版', '结转维护'])
    })

    it('buildMenuGroups 兼容层：每个应用摊平为一个 NavGroup，children 为全部页面、subGroups 对应分组', () => {
      const groups = buildMenuGroups(ADMIN_PERMISSIONS, true, [])
      const finance = groups.find(g => g.key === 'finance')
      expect(finance?.title).toBe('财务总账')
      expect(finance?.subGroups?.map(sg => sg.label)).toEqual(['凭证处理', '账簿查询', '辅助核算', '财务报表'])
      expect(finance?.children.length).toBe(finance?.subGroups?.reduce((n, sg) => n + sg.items.length, 0))
      expect(finance?.children[0]?.path).toBe('/voucher/entry')
    })

    it('locateNavItem 精确匹配查询串、子路由按前缀归属', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [])
      expect(locateNavItem(apps, '/scm/docs?doc_type=PO')?.app.key).toBe('purchase')
      expect(locateNavItem(apps, '/scm/docs?doc_type=RCV&payment_mode=advance')?.item.title).toBe('预收款单')
      expect(locateNavItem(apps, '/scm/docs?doc_type=RCV')?.item.title).toBe('收款单')
      expect(locateNavItem(apps, '/scm/production-plans?plan_type=outsource')?.app.key).toBe('outsource')
      expect(locateNavItem(apps, '/base/project/category/new')?.item.path).toBe('/base/project')
      expect(locateNavItem(apps, '/scm/docs/abc-123')?.app.key).toBe('purchase')
      expect(locateNavItem(apps, '/voucher/entry')?.section.label).toBe('凭证处理')
      expect(locateNavItem(apps, '/report/dynamic/xyz?view=1')?.app.key).toBe('basedata')
      expect(locateNavItem(apps, '/nowhere')).toBeNull()
    })
  })

  describe('注册模块过滤', () => {
    const GL_ONLY = ['gl']

    it('只授权总账时，仅财务会计/基础资料/系统管理可见，基础资料只剩财务档案与报表打印', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [], GL_ONLY)
      expect(apps.map(a => a.key)).toEqual(['finance', 'basedata', 'system'])
      const basedata = apps.find(a => a.key === 'basedata')
      expect(basedata?.sections.map(s => s.label)).toEqual(['财务档案', '报表与打印'])
    })

    it('授权进销存+生产但无委外时，委外应用隐藏、生产应用可见', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [], ['gl', 'scm', 'production'])
      const keys = apps.map(a => a.key)
      expect(keys).toContain('production')
      expect(keys).toContain('sales')
      expect(keys).not.toContain('outsource')
    })

    it('只授权进销存时，财务应用隐藏，系统管理仍可见，基础资料只剩供应链档案', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [
        { path: '/report/dynamic/1?view=1', title: '资产负债表', permission: 'report:view' },
      ], ['scm'])
      const keys = apps.map(a => a.key)
      expect(keys).not.toContain('finance')
      expect(keys).not.toContain('cashier')
      expect(keys).toEqual(expect.arrayContaining(['purchase', 'sales', 'inventory', 'arap', 'basedata', 'system']))
      const basedata = apps.find(a => a.key === 'basedata')
      expect(basedata?.sections.map(s => s.label)).toEqual(['供应链档案'])
    })

    it('getRouteModules 按 doc_type / plan_type 细分供应链单据', () => {
      expect(getRouteModules('/scm/docs?doc_type=PO')).toEqual(['scm'])
      // 期初入库是建立库存的唯一入口，进销存/生产/委外任一授权即可
      expect(getRouteModules('/scm/docs?doc_type=IS')).toEqual(['scm', 'production', 'outsource'])
      expect(getRouteModules('/scm/docs?doc_type=PL')).toEqual(['production'])
      expect(getRouteModules('/scm/docs?doc_type=WO')).toEqual(['outsource'])
      expect(getRouteModules('/scm/docs/abc-123')).toEqual(['scm', 'production', 'outsource'])
      expect(getRouteModules('/scm/production-plans?plan_type=outsource')).toEqual(['outsource'])
      expect(getRouteModules('/scm/production-plans?plan_type=self')).toEqual(['production'])
      expect(getRouteModules('/scm/boms')).toEqual(['production', 'outsource'])
      expect(getRouteModules('/scm/report/outsource/execution')).toEqual(['outsource'])
      expect(getRouteModules('/cashier/journal')).toEqual(['cashier'])
      expect(getRouteModules('/asset/detail/1')).toEqual(['asset'])
      expect(getRouteModules('/voucher/entry')).toEqual(['gl'])
      expect(getRouteModules('/system/user')).toEqual([])
      expect(getRouteModules('/dashboard')).toEqual([])
      expect(getRouteModules('/activate')).toEqual([])
    })

    it('只授权生产管理时，生产开工所需的基础档案与库存页面可见', () => {
      const apps = buildNavApps(ADMIN_PERMISSIONS, true, [], ['production'])
      const keys = apps.map(a => a.key)
      expect(keys).toContain('production')
      expect(keys).toContain('inventory')
      expect(keys).toContain('basedata')
      // 进销存专属应用不出现
      expect(keys).not.toContain('purchase')
      expect(keys).not.toContain('sales')
      expect(keys).not.toContain('arap')
      expect(keys).not.toContain('outsource')

      // 基础资料保留供应链档案（物料/仓库等），但往来单位归进销存/委外
      const basedata = apps.find(a => a.key === 'basedata')
      const scmDocs = basedata?.sections.find(s => s.label === '供应链档案')
      expect(scmDocs?.items.map(i => i.path)).toEqual([
        '/scm/items', '/scm/categories', '/scm/item-types', '/scm/units',
        '/scm/warehouses', '/scm/bins',
      ])

      // 库存管理只剩期初入库 + 查询 + 报表，其他出入库/调拨/盘点属进销存
      const inventory = apps.find(a => a.key === 'inventory')
      expect(inventory?.sections.flatMap(s => s.items.map(i => i.path))).toEqual([
        '/scm/docs?doc_type=IS',
        '/scm/stock', '/scm/batch-stock', '/scm/serials',
        '/scm/report', '/scm/report/stock-ledger',
        '/scm/report/stock-alert', '/scm/report/batch-alert',
      ])
    })

    it('canAccessRoute 同时校验权限与模块', () => {
      expect(canAccessRoute('/scm/docs?doc_type=WO', ADMIN_PERMISSIONS, ['gl', 'production'])).toBe(false)
      expect(canAccessRoute('/scm/docs?doc_type=PL', ADMIN_PERMISSIONS, ['gl', 'production'])).toBe(true)
      expect(canAccessRoute('/voucher/entry', ADMIN_PERMISSIONS, ['scm'])).toBe(false)
      expect(canAccessRoute('/system/user', ADMIN_PERMISSIONS, ['scm'])).toBe(true)
      expect(canAccessRoute('/cashier/summary-report', ADMIN_PERMISSIONS, ['gl'])).toBe(false)
      // 默认参数（不传模块）保持旧行为：全部模块可用
      expect(canAccessRoute('/scm/docs?doc_type=WO', ADMIN_PERMISSIONS)).toBe(true)
    })

    it('辅助项目多栏明细账受 ledger:aux 控制', () => {
      expect(getRoutePermissions('/ledger/aux-multi-column')).toEqual(['ledger:aux'])
      expect(canAccessRoute('/ledger/aux-multi-column', ['ledger:aux'])).toBe(true)
      expect(canAccessRoute('/ledger/aux-multi-column', ['ledger:detail'])).toBe(false)
      const items = flattenNavApps(buildNavApps(['ledger:aux'], true, []))
      expect(items.some(item => item.path === '/ledger/aux-multi-column')).toBe(true)
    })

    it('isValidHomePath 校验自定义默认主页', () => {
      // 模块主页：按标题在可见导航树中查找（支持 URL 编码与旧标题别名）
      expect(isValidHomePath('/group/出纳管理', ADMIN_PERMISSIONS)).toBe(true)
      expect(isValidHomePath(`/group/${encodeURIComponent('出纳管理')}`, ADMIN_PERMISSIONS)).toBe(true)
      expect(isValidHomePath('/group/资金管理', ADMIN_PERMISSIONS)).toBe(true)
      expect(isValidHomePath('/group/出纳管理', ['voucher:query'])).toBe(false)
      expect(isValidHomePath('/group/不存在的模块', ADMIN_PERMISSIONS)).toBe(false)
      // 普通页面：走 canAccessRoute
      expect(isValidHomePath('/voucher/query', ['voucher:query'])).toBe(true)
      expect(isValidHomePath('/voucher/entry', ['voucher:query'])).toBe(false)
      expect(isValidHomePath('', ADMIN_PERMISSIONS)).toBe(false)
    })

    it('getDefaultLandingPath 优先使用有效的自定义主页，无效时回退', () => {
      expect(getDefaultLandingPath(ADMIN_PERMISSIONS, false, undefined, '/group/出纳管理')).toBe(
        '/group/出纳管理'
      )
      // 无权限的自定义主页回退到 /dashboard
      expect(getDefaultLandingPath(ADMIN_PERMISSIONS, false, undefined, '/group/不存在的模块')).toBe(
        '/dashboard'
      )
      // 未设置时行为不变
      expect(getDefaultLandingPath(ADMIN_PERMISSIONS, false, undefined, '')).toBe('/dashboard')
    })

    it('getDefaultLandingPath 无总账授权且无主页权限时落到首个可用模块页面', () => {
      expect(getDefaultLandingPath(['voucher:query', 'scm:sale'], false, ['scm'])).toBe('/scm/docs')
      expect(getDefaultLandingPath(['voucher:query'], false, ['scm'])).toBe('/forbidden')
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
      expect(getRoutePermissions('/base/print-template')).toEqual(['system:print'])
      expect(getRoutePermissions('/base/print-template/design')).toEqual(['system:print'])
      expect(getRoutePermissions('/base/print-template/design/abc')).toEqual(['system:print'])
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
