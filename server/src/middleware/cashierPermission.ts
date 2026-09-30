import type { NextFunction, Response } from 'express'
import type { AuthRequest } from './index.js'

/**
 * 出纳模块权限守卫：按路径映射所需权限（admin '*' 自动放行）。
 *
 * 2026-09-17 综合评审 P2-13：此前规则表写在 routes/cashierJournal.ts 内部，
 * routes/cashierImport.ts 自身只挂 authMiddleware，其权限校验完全依赖 index.ts 里
 * cashierRoutes 先于 cashierImportRoutes 挂载这一顺序。抽成独立 middleware 后两个路由文件各自显式挂载。
 *
 * 规则按顺序匹配，命中第一条即生效。
 */
export const CASHIER_PERMISSION_RULES: Array<{ re: RegExp; perm: string; alsoPerms?: string[] }> = [
  { re: /^\/cashier\/params/,            perm: 'cashier:param' },
  // 出纳结账 / 反结账：ACD 4AC / 4A3 映射为 cashier:param；状态读取放开给日记账岗位
  // P1-8：任何形如 periods/x/y/close|reopen 的写请求都必须有 cashier:param（此前 `2026.5` 这类畸形年份
  // 不匹配 \d+ 规则，落到下一条 alsoPerms 放行，仅日记账权限即可结账）
  { re: /^\/cashier\/periods\/[^/]+\/[^/]+\/(close|reopen)$/, perm: 'cashier:param' },
  { re: /^\/cashier\/periods/,           perm: 'cashier:param', alsoPerms: ['cashier:journal'] },
  // 结算方式：菜单权限为 cashier:dict；兼容历史 cashier:param 授权
  { re: /^\/cashier\/settle-type(\/|$)/, perm: 'cashier:dict', alsoPerms: ['cashier:param'] },
  // 结算方式字典读取：出纳各页面与供应链单据都会读取
  { re: /^\/cashier\/settle-types(\/|$)/, perm: 'cashier:dict', alsoPerms: ['cashier:param', 'cashier:journal'] },
  { re: /^\/cashier\/init-balance/,      perm: 'cashier:initbal' },
  // P1-3：出纳初始化清空全部出纳数据，与菜单一致要求 cashier:initbal（此前落入兜底规则，日记账岗位即可清空）
  { re: /^\/cashier\/reset(\/|$)/,       perm: 'cashier:initbal' }, // FIX-264：含 /cashier/reset/preview
  // FIX-262：对账单导入改为生成出纳日记账，需要日记账权限（兼容原导入权限 cashier:import）
  { re: /^\/cashier\/bank-statement\/import/, perm: 'cashier:journal', alsoPerms: ['cashier:import'] },
  { re: /^\/cashier\/bank-statement/,    perm: 'cashier:reconcile' },
  // FIX-262：出纳 ↔ 总账对账
  { re: /^\/cashier\/gl-reconcile/,      perm: 'cashier:reconcile' },
  { re: /^\/cashier\/reconcil/,          perm: 'cashier:reconcile' }, // reconcile/* 与 reconciliation
  { re: /^\/cashier\/delete-vouchers/,   perm: 'cashier:voucher' },
  { re: /^\/cashier\/generate-voucher/,  perm: 'cashier:voucher' },
  // P2-12：账户余额表 / 资金收支汇总表菜单挂在 cashier:journal 下，ACD 4AD 映射 cashier:report，两码都放行
  { re: /^\/cashier\/daily-report/,      perm: 'cashier:report', alsoPerms: ['cashier:journal'] },
  { re: /^\/cashier\/summary-report/,    perm: 'cashier:report', alsoPerms: ['cashier:journal'] },
  // 出纳报表改造：统一报表接口（余额表 / 多维汇总 / 辅助项目收支 / 筛选元数据）
  { re: /^\/cashier\/report(\/|$)/,      perm: 'cashier:report', alsoPerms: ['cashier:journal'] },
  // 其余（journal、accounts、attachments）默认需出纳日记账权限
  { re: /^\/cashier\//,                  perm: 'cashier:journal' },
]

/** 返回 null 表示放行，否则为 403 原因 */
export function cashierPermissionReason(req: Pick<AuthRequest, 'path' | 'method' | 'permissions'>): string | null {
  if (!req.path.startsWith('/cashier/')) return null
  if (req.permissions?.includes('*')) return null
  // 收付款单只需读取现金/银行末级科目；允许往来岗位读取账户，不扩大日记账增删改权限。
  if (req.method === 'GET' && req.path === '/cashier/accounts' && req.permissions?.includes('scm:arap')) return null
  // 供应链单据读取结算方式字典
  if (req.method === 'GET' && req.path === '/cashier/settle-types' && req.permissions?.some(p => p.startsWith('scm:'))) return null
  const rule = CASHIER_PERMISSION_RULES.find(r => r.re.test(req.path))
  if (!rule) return null
  const allowed =
    req.permissions?.includes(rule.perm) || (rule.alsoPerms?.some(p => req.permissions?.includes(p)) ?? false)
  return allowed ? null : '无此操作权限'
}

export function cashierPermissionGuard(req: AuthRequest, res: Response, next: NextFunction) {
  const reason = cashierPermissionReason(req)
  if (reason) return res.status(403).json({ code: 403, message: reason })
  next()
}
