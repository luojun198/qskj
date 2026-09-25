import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/index.js', () => ({ getDb: () => ({}) }))

import router from '../routes/ledger.js'

/**
 * 评审 P2 收尾：账簿读接口必须挂权限码（此前只校验登录）。
 * 逐个接口用「无任何权限」的请求调其权限中间件，应返回 403；带对应权限码放行。
 */
type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> }
}

const EXPECTED: Array<[string, 'get' | 'post', string]> = [
  ['/general', 'get', 'ledger:balance'],
  ['/detail', 'get', 'ledger:detail'],
  ['/voucher-summary', 'get', 'ledger:vsummary'],
  ['/voucher-summary/no-range', 'get', 'ledger:vsummary'],
  ['/foreign-balance', 'get', 'ledger:foreign'],
  ['/subject-analysis', 'get', 'ledger:balance'],
  ['/general-ledger', 'get', 'ledger:general'],
  ['/cash-journal', 'get', 'ledger:bank'],
  ['/chronological', 'get', 'ledger:detail'],
  ['/aux-balance', 'post', 'ledger:aux'],
  ['/aux-detail', 'post', 'ledger:aux'],
  ['/cash-flow-trial-balance', 'get', 'ledger:cashflow'],
  ['/cash-flow-voucher-check', 'get', 'ledger:cashflow'],
]

function guardOf(path: string, method: 'get' | 'post') {
  const layer = (router as unknown as { stack: Layer[] }).stack.find(
    l => l.route?.path === path && l.route.methods[method]
  )
  if (!layer?.route) throw new Error(`route ${method} ${path} not found`)
  expect(layer.route.stack.length).toBeGreaterThan(1)
  return layer.route.stack[0].handle
}

function run(guard: Function, permissions: string[]) {
  let status = 200
  let passed = false
  const res = { status(c: number) { status = c; return res }, json() { return res } }
  guard({ permissions }, res, () => { passed = true })
  return { status, passed }
}

describe('账簿读接口权限码', () => {
  it.each(EXPECTED)('%s（%s）需要 %s', (path, method, perm) => {
    const guard = guardOf(path, method)
    expect(run(guard, []).status).toBe(403)
    expect(run(guard, [perm]).passed).toBe(true)
    expect(run(guard, ['*']).passed).toBe(true)
  })
})
