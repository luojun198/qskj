import type { Request, Response, NextFunction } from 'express'
import {
  assertLicenseValid,
  assertModuleLicensed,
  isLicenseCheckSkipped,
} from '../services/licenseService.js'
import {
  docTypeToModules,
  planTypeToModules,
  PRODUCTION_OR_OUTSOURCE_MODULES,
  SHARED_SCM_MODULES,
  type LicenseModuleKey,
} from '../services/licenseModules.js'
import { log } from '../utils/logger.js'

/** 登录页 / 激活前必须可用的公开 API（不要求已激活） */
const PRE_LOGIN_AUTH_PATHS = [
  '/api/auth/login',
  '/api/auth/captcha',
  '/api/auth/account-sets',
  '/api/auth/standard-account-set-templates',
  '/api/auth/backup-import',
  '/api/auth/acd-import',
]

const LICENSE_WHITELIST: Array<{ method?: string; test: (path: string) => boolean }> = [
  { test: path => path === '/api/health' },
  { test: path => path.startsWith('/api/license') },
  { test: path => path === '/api/system/branding' },
  { test: path => PRE_LOGIN_AUTH_PATHS.includes(path) },
  { test: path => path.startsWith('/api/auth/account-sets/') },
  { test: path => path.startsWith('/api/auth/users-by-account-set/') },
]

function isWhitelisted(req: Request): boolean {
  const path = req.path
  return LICENSE_WHITELIST.some(item => {
    if (item.method && item.method !== req.method) return false
    return item.test(path)
  })
}

/** 生产 / 委外共用的供应链子路径（任一模块授权即可） */
const PRODUCTION_OR_OUTSOURCE_PREFIXES = [
  '/api/scm/boms',
  '/api/scm/mrp',
  '/api/scm/mrp-docs',
  '/api/scm/work-centers',
  '/api/scm/routings',
  '/api/scm/work-reports',
  '/api/scm/qc-docs',
  '/api/scm/report/cost-variance',
  '/api/scm/report/production',
]

/**
 * 供应链「共享基础层」子路径：物料 / 分类 / 单位 / 仓库 / 货位 / 库存与流水 / 批次 / 序列号 /
 * 供应链参数 / 列方案 / 单据字段 / 下推选项 / 库存与批次预警。
 * 进销存、生产、委外都要靠这些档案与库存台账开工，任一模块授权即可访问。
 */
const SHARED_SCM_PREFIXES = [
  '/api/scm/items',
  '/api/scm/item-fields',
  '/api/scm/categories',
  '/api/scm/units',
  '/api/scm/warehouses',
  '/api/scm/bins',
  '/api/scm/stock',
  '/api/scm/batch-stock',
  '/api/scm/serials',
  '/api/scm/params',
  '/api/scm/col-schemes',
  '/api/scm/doc-fields',
  '/api/scm/push-options',
  '/api/scm/report/stock-alert',
  '/api/scm/report/batch-alert',
]

/** 进销存 / 委外共用：委外要选委外厂（供应商），往来单位档案不能只归进销存 */
const SCM_OR_OUTSOURCE_PREFIXES = ['/api/scm/partners']

const GL_PREFIXES = ['/api/voucher', '/api/voucher-templates', '/api/ledger', '/api/report']

function startsWithSegment(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)
}

function readParam(req: Request, key: string): string | undefined {
  const fromQuery = (req.query as Record<string, unknown> | undefined)?.[key]
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  const body = req.body as Record<string, unknown> | undefined
  const fromBody = body?.[key]
  return typeof fromBody === 'string' && fromBody ? fromBody : undefined
}

/**
 * 按请求解析所需模块（任一满足即可）；返回空数组表示不受模块授权限制。
 * 供应链 /scm/docs/:id 一类按单据 id 的接口在 scmDoc 路由内按 doc_type 二次校验。
 */
export function resolveRequiredModules(req: Request): LicenseModuleKey[] {
  const path = req.path

  if (startsWithSegment(path, '/api/cashier')) return ['cashier']
  if (startsWithSegment(path, '/api/asset')) return ['asset']

  if (GL_PREFIXES.some(prefix => startsWithSegment(path, prefix))) return ['gl']

  if (startsWithSegment(path, '/api/scm')) {
    if (startsWithSegment(path, '/api/scm/report/outsource')) return ['outsource']
    if (startsWithSegment(path, '/api/scm/production-plans')) {
      return planTypeToModules(readParam(req, 'plan_type'))
    }
    if (PRODUCTION_OR_OUTSOURCE_PREFIXES.some(prefix => startsWithSegment(path, prefix))) {
      return [...PRODUCTION_OR_OUTSOURCE_MODULES]
    }
    if (SHARED_SCM_PREFIXES.some(prefix => startsWithSegment(path, prefix))) {
      return [...SHARED_SCM_MODULES]
    }
    if (SCM_OR_OUTSOURCE_PREFIXES.some(prefix => startsWithSegment(path, prefix))) {
      return ['scm', 'outsource']
    }
    if (path === '/api/scm/docs') {
      const byDocType = docTypeToModules(readParam(req, 'doc_type'))
      return byDocType.length > 0 ? byDocType : ['scm']
    }
    if (startsWithSegment(path, '/api/scm/docs')) {
      // 按 id 的单据接口：这里拿不到 doc_type，放宽到三者任一，由 scmDoc 路由按单据类型精确校验
      return [...SHARED_SCM_MODULES]
    }
    return ['scm']
  }

  return []
}

export function licenseMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) {
    return next()
  }
  if (isLicenseCheckSkipped() || isWhitelisted(req)) {
    return next()
  }

  try {
    const error = assertLicenseValid()
    if (error) {
      return res.status(402).json({
        code: error.code,
        message: error.message,
      })
    }
    const required = resolveRequiredModules(req)
    if (required.length > 0) {
      const moduleError = assertModuleLicensed(required)
      if (moduleError) {
        return res.status(402).json({
          code: moduleError.code,
          message: moduleError.message,
        })
      }
    }
    return next()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error('license check failed with unexpected error', {
      path: req.path,
      error: detail,
      stack: err instanceof Error ? err.stack : undefined,
    })
    // 授权校验异常时不应阻断服务，降级为通过（允许继续处理请求）
    // 这是缓解首次启动或特殊环境下 getMachineId() 等调用偶发失败的措施
    log.warn('license check degraded: allowing request due to unexpected error', { path: req.path })
    return next()
  }
}
