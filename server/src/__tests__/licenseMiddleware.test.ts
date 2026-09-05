import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasLicensedModule, getLicenseModuleName } from '../services/licenseModules.js'

/** 可变的「当前已授权模块」，由各用例设置；null 表示未激活 */
let licensedModules: string[] | null = ['gl', 'cashier', 'asset', 'scm', 'production', 'outsource']

vi.mock('../services/licenseService.js', () => ({
  isLicenseCheckSkipped: () => process.env.LICENSE_SKIP === 'true',
  assertLicenseValid: () =>
    licensedModules ? null : { code: 40201, message: '软件未激活，请输入注册码' },
  assertModuleLicensed: (required: string | string[]) => {
    if (process.env.LICENSE_SKIP === 'true') return null
    const list = Array.isArray(required) ? required : [required]
    if (hasLicensedModule(licensedModules || [], list as any)) return null
    return {
      code: 40206,
      message: `当前授权未包含「${list.map(getLicenseModuleName).join(' / ')}」模块`,
    }
  },
}))

import { licenseMiddleware, resolveRequiredModules } from '../middleware/licenseMiddleware.js'

function mockReq(path: string, method = 'POST', extra: Record<string, unknown> = {}) {
  return { path, method, query: {}, body: {}, ...extra } as any
}

function mockRes() {
  const res: any = {}
  res.statusCode = 200
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

function run(req: any) {
  const res = mockRes()
  let nextCalled = false
  licenseMiddleware(req, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

describe('licenseMiddleware', () => {
  let prevSkip: string | undefined

  beforeEach(() => {
    prevSkip = process.env.LICENSE_SKIP
    delete process.env.LICENSE_SKIP
    licensedModules = ['gl', 'cashier', 'asset', 'scm', 'production', 'outsource']
  })

  afterEach(() => {
    if (prevSkip === undefined) {
      delete process.env.LICENSE_SKIP
    } else {
      process.env.LICENSE_SKIP = prevSkip
    }
  })

  it('登录页新建账套接口在未激活时应放行', () => {
    licensedModules = null
    const paths = [
      '/api/auth/account-sets/create',
      '/api/auth/account-sets/create-from-standard-template',
      '/api/auth/account-sets',
      '/api/auth/standard-account-set-templates',
    ]
    for (const path of paths) {
      const { res, nextCalled } = run(mockReq(path))
      expect(nextCalled, path).toBe(true)
      expect(res.statusCode).toBe(200)
    }
  })

  it('未激活时业务接口应返回 402', () => {
    licensedModules = null
    const { res, nextCalled } = run(mockReq('/api/voucher/list', 'GET'))
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(402)
    expect(res.body.code).toBe(40201)
  })

  describe('模块拦截', () => {
    it('只授权总账时，供应链单据接口返回 402/40206', () => {
      licensedModules = ['gl']
      const { res, nextCalled } = run(
        mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'PO' } })
      )
      expect(nextCalled).toBe(false)
      expect(res.statusCode).toBe(402)
      expect(res.body.code).toBe(40206)
      expect(res.body.message).toContain('进销存')
    })

    it('只授权总账时，凭证与系统管理接口放行', () => {
      licensedModules = ['gl']
      expect(run(mockReq('/api/voucher/list', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/ledger/balance', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/system/users', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/base/accounts', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/dashboard/stats', 'GET')).nextCalled).toBe(true)
    })

    it('只授权进销存时，凭证接口拦截、出纳接口拦截', () => {
      licensedModules = ['scm']
      expect(run(mockReq('/api/voucher/list', 'GET')).res.body?.code).toBe(40206)
      expect(run(mockReq('/api/cashier/journal', 'GET')).res.body?.code).toBe(40206)
      expect(run(mockReq('/api/scm/items', 'GET')).nextCalled).toBe(true)
    })

    it('生产单据按 doc_type 区分：PL 需生产模块，WO 需委外模块', () => {
      licensedModules = ['scm', 'production']
      expect(run(mockReq('/api/scm/docs', 'POST', { body: { doc_type: 'PL' } })).nextCalled).toBe(true)
      const wo = run(mockReq('/api/scm/docs', 'POST', { body: { doc_type: 'WO' } }))
      expect(wo.nextCalled).toBe(false)
      expect(wo.res.body.code).toBe(40206)
      expect(wo.res.body.message).toContain('委外管理')
    })

    it('BOM / MRP 等生产委外共用接口任一模块授权即可', () => {
      licensedModules = ['scm', 'outsource']
      expect(run(mockReq('/api/scm/boms', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/scm/mrp-docs', 'GET')).nextCalled).toBe(true)
      licensedModules = ['scm']
      expect(run(mockReq('/api/scm/boms', 'GET')).res.body?.code).toBe(40206)
    })

    it('生产计划按 plan_type 细分模块', () => {
      licensedModules = ['scm', 'production']
      expect(
        run(mockReq('/api/scm/production-plans', 'GET', { query: { plan_type: 'self' } })).nextCalled
      ).toBe(true)
      expect(
        run(mockReq('/api/scm/production-plans', 'GET', { query: { plan_type: 'outsource' } })).res.body
          ?.code
      ).toBe(40206)
      expect(run(mockReq('/api/scm/production-plans', 'GET')).nextCalled).toBe(true)
    })

    it('委外执行报表仅委外模块可用', () => {
      licensedModules = ['scm', 'production']
      expect(run(mockReq('/api/scm/report/outsource/execution', 'GET')).res.body?.code).toBe(40206)
      licensedModules = ['outsource']
      expect(run(mockReq('/api/scm/report/outsource/execution', 'GET')).nextCalled).toBe(true)
    })

    it('只授权生产管理时，生产开工所需的共享基础层全部放行', () => {
      // 物料 / 仓库 / 库存 / 供应链参数 / 期初入库——缺任何一项生产模块都一步走不动
      licensedModules = ['production']
      for (const path of ['/api/scm/items', '/api/scm/item-fields', '/api/scm/categories',
        '/api/scm/units', '/api/scm/warehouses', '/api/scm/bins', '/api/scm/stock',
        '/api/scm/stock/ledger', '/api/scm/stock/summary', '/api/scm/batch-stock',
        '/api/scm/serials', '/api/scm/params', '/api/scm/col-schemes', '/api/scm/doc-fields',
        '/api/scm/report/stock-alert', '/api/scm/report/batch-alert']) {
        expect(run(mockReq(path, 'GET')).nextCalled, path).toBe(true)
      }
      expect(run(mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'IS' } })).nextCalled).toBe(true)
      expect(run(mockReq('/api/scm/docs', 'POST', { body: { doc_type: 'IS' } })).nextCalled).toBe(true)
    })

    it('只授权生产管理时，进销存专属业务仍被拦截', () => {
      licensedModules = ['production']
      for (const q of ['PO', 'PI', 'SOa', 'SO', 'RCV', 'PAY', 'OI', 'OO', 'TR', 'CK']) {
        const r = run(mockReq('/api/scm/docs', 'GET', { query: { doc_type: q } }))
        expect(r.nextCalled, q).toBe(false)
        expect(r.res.body.code, q).toBe(40206)
      }
      expect(run(mockReq('/api/scm/arap/balance', 'GET')).res.body?.code).toBe(40206)
      expect(run(mockReq('/api/scm/report/sales/fixed-query', 'GET')).res.body?.code).toBe(40206)
      expect(run(mockReq('/api/scm/partners', 'GET')).res.body?.code).toBe(40206)
    })

    it('只授权委外管理时，共享基础层与往来单位放行', () => {
      licensedModules = ['outsource']
      expect(run(mockReq('/api/scm/items', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/scm/warehouses', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/scm/partners', 'GET')).nextCalled).toBe(true)
      expect(run(mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'IS' } })).nextCalled).toBe(true)
    })

    it('LICENSE_SKIP 时不做模块拦截', () => {
      process.env.LICENSE_SKIP = 'true'
      licensedModules = ['gl']
      expect(run(mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'PO' } })).nextCalled).toBe(true)
    })
  })

  describe('resolveRequiredModules', () => {
    it('按路径前缀解析模块', () => {
      expect(resolveRequiredModules(mockReq('/api/cashier/journal'))).toEqual(['cashier'])
      expect(resolveRequiredModules(mockReq('/api/asset/list'))).toEqual(['asset'])
      expect(resolveRequiredModules(mockReq('/api/voucher-templates'))).toEqual(['gl'])
      expect(resolveRequiredModules(mockReq('/api/report/templates'))).toEqual(['gl'])
      expect(resolveRequiredModules(mockReq('/api/scm/partners'))).toEqual(['scm', 'outsource'])
      expect(resolveRequiredModules(mockReq('/api/scm/items'))).toEqual(['scm', 'production', 'outsource'])
      expect(resolveRequiredModules(mockReq('/api/scm/stock/ledger'))).toEqual(['scm', 'production', 'outsource'])
      expect(resolveRequiredModules(mockReq('/api/scm/docs/abc-123'))).toEqual(['scm', 'production', 'outsource'])
      expect(resolveRequiredModules(mockReq('/api/scm/work-centers'))).toEqual(['production', 'outsource'])
      expect(resolveRequiredModules(mockReq('/api/auth/login'))).toEqual([])
      expect(resolveRequiredModules(mockReq('/api/security/backup'))).toEqual([])
    })

    it('/scm/docs 未指定 doc_type 时归进销存', () => {
      expect(resolveRequiredModules(mockReq('/api/scm/docs', 'GET'))).toEqual(['scm'])
      expect(resolveRequiredModules(mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'WI' } }))).toEqual([
        'outsource',
      ])
      // 期初入库是三模块共享的建库存入口
      expect(resolveRequiredModules(mockReq('/api/scm/docs', 'GET', { query: { doc_type: 'IS' } }))).toEqual([
        'scm', 'production', 'outsource',
      ])
    })
  })
})
