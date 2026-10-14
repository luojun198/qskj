import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseAcdTables } from '../scripts/importAcdToCurrentAccountSet.js'
import { mapAcdCashFlowJd } from '../utils/acdCashFlow.js'
import { createCashFlowTestDb } from './helpers/cashFlowTestDb.js'
import {
  detectCashFlowStandardKey,
  getEffectiveCashFlowMapping,
  initCashFlowForAccountSet,
  listCashFlowMapRows,
  loadCashFlowItemsLite,
} from '../services/cashFlowAccountMap.js'
import { computeCashFlowByMapping, getMainItemAmount } from '../services/cashFlowAutoEngine.js'

const TEMPLATE_DIR = resolve(__dirname, '../../../标准模版')

/** 用真实标准模板的科目表（kmbm）与现金流量项目（xjll_xm）建内存账套，再走建账初始化 */
function setupFromTemplate(acdRelPath: string, standard?: 'enterprise' | 'small_business' | 'government') {
  const tables = parseAcdTables(readFileSync(resolve(TEMPLATE_DIR, acdRelPath)))
  const accounts = tables.accounts
    .map(r => [String(r[0] || '').trim(), String(r[1] || '').trim()] as const)
    .filter(([code, name]) => /^\d+$/.test(code) && name)
    .map(([code, name]) => [code, name, 'debit'] as [string, string, 'debit'])
  const t = createCashFlowTestDb({ accounts, standard: standard || 'enterprise' })
  if (!standard) t.db.prepare(`DELETE FROM system_params WHERE param_key = 'accounting_standard'`).run()
  const insert = t.db.prepare(
    `INSERT INTO cash_flow_items (id, account_set_id, code, name, direction, level, is_leaf, sort_order, is_active, kind)
     VALUES (?, ?, ?, ?, ?, 1, 1, 0, 1, 'main')`
  )
  for (const r of tables.auxCashFlows) {
    const code = String(r[0] || '').trim()
    if (!code) continue
    insert.run(`cf-${code}`, t.setId, code, String(r[1] || '').trim(), mapAcdCashFlowJd(r[2], code))
  }
  const init = initCashFlowForAccountSet(t.db, t.setId)
  const codes = getEffectiveCashFlowMapping(t.db, t.setId).codes
  const map = (code: string) => codes.get(t.accountId(code))
  const items = loadCashFlowItemsLite(t.db, t.setId)
  return { ...t, init, map, items }
}

describe('各准则建账初始化（真实标准模板）', () => {
  it('企业会计准则：保留模板编码，补附表 F01~F18，利息与分配利润分列', () => {
    const t = setupFromTemplate('新企业会计准则/新企业会计准则.acd', 'enterprise')
    expect(t.init.standard).toBe('enterprise')
    expect(t.init.written).toBeGreaterThan(100)
    expect(t.items.filter(i => i.kind === 'supplement').map(i => i.code)).toEqual(
      expect.arrayContaining(['F01', 'F02', 'F16', 'F17', 'F18'])
    )
    expect(t.map('1122')).toMatchObject({ main_credit_code: '1101', supp_credit_code: 'F14' })
    expect(t.map('6603')).toMatchObject({ main_debit_code: '3203', supp_debit_code: 'F09' }) // 财务费用 → 偿付利息
    expect(t.map('1231')).toMatchObject({ main_debit_code: '1204', supp_credit_code: 'F14' }) // 本模板 1231 为其他应收款
    expect(t.map('1607')?.supp_credit_code).toBe('F02') // 在建工程减值准备 → 资产减值准备
    expect(t.items.find(i => i.code === '1000')?.direction).toBe('neutral')
  })

  it('小企业会计准则：没有补充资料，投资 / 借款 / 利息 / 分配利润按会小企03表', () => {
    const t = setupFromTemplate('小企业会计准则/小企业会计准则.acd', 'small_business')
    expect(t.init.standard).toBe('small_business')
    expect(t.items.some(i => i.kind === 'supplement')).toBe(false)
    expect(t.map('1122')).toMatchObject({ main_credit_code: '1101', supp_credit_code: null })
    expect(t.map('2001')).toMatchObject({ main_credit_code: '3101', main_debit_code: '3201' }) // 借款收现 / 偿还本金
    expect(t.map('5603')?.main_debit_code).toBe('3202') // 财务费用 → 偿还借款利息
    expect(t.map('3104')?.main_debit_code).toBe('3203') // 利润分配 → 分配利润
    expect(t.map('3001')?.main_credit_code).toBe('3102') // 实收资本 → 吸收投资者投资
    expect(t.map('1511')?.main_debit_code).toBe('2201') // 长期股权投资 → 投资支付
    expect(t.map('1601')?.main_debit_code).toBe('2202') // 固定资产 → 购建
    expect(t.map('2211')?.main_debit_code).toBe('1202')
    expect(t.map('2221')?.main_debit_code).toBe('1203')
  })

  it('政府会计制度：日常活动 + 财政拨款项目，补上模板缺的 1204 支付的各项税费', () => {
    const t = setupFromTemplate('行政事业单位/行政事业单位.acd', 'government')
    expect(t.init.standard).toBe('government')
    expect(t.items.some(i => i.kind === 'supplement')).toBe(false)
    expect(t.items.find(i => i.code === '1204')?.name).toBe('支付的各项税费')
    expect(t.map('4101')?.main_credit_code).toBe('1103') // 事业收入 → 事业活动收到的现金
    expect(t.map('5001')?.main_debit_code).toBe('1201') // 业务活动费用 → 购买商品、接受劳务
    expect(t.map('2201')?.main_debit_code).toBe('1202') // 应付职工薪酬
    expect(t.map('2102')?.main_debit_code).toBe('1204') // 其他应交税费 → 支付的各项税费
    expect(t.map('1601')).toMatchObject({ main_credit_code: '2103', main_debit_code: '2201' })
    expect(t.map('2001')).toMatchObject({ main_credit_code: '3102', main_debit_code: '3201' })
    expect(t.map('2304')?.main_debit_code).toBe('3202') // 应付利息 → 偿还利息
    expect(t.map('3001')).toMatchObject({ main_credit_code: '1104', main_debit_code: '1203' }) // 累计盈余不当吸收投资
    expect(t.map('1201')?.main_credit_code).toBe('1101') // 财政应返还额度 → 财政基本支出拨款
    // 预算会计科目不参与
    expect(listCashFlowMapRows(t.db, t.setId, 'pl').some(r => r.code.startsWith('6'))).toBe(false)
  })

  it('政府会计：财政拨款收入下级按基本支出 / 项目 / 资本性项目区分', () => {
    const t = createCashFlowTestDb({
      standard: 'government',
      accounts: [
        ['1002', '银行存款', 'debit', 0, 1],
        ['1011', '零余额账户用款额度', 'debit'],
        ['4001', '财政拨款收入', 'credit'],
        ['400101', '基本支出拨款', 'credit'],
        ['400102', '项目支出拨款', 'credit'],
        ['400103', '资本性项目拨款', 'credit'],
        ['5001', '业务活动费用', 'debit'],
      ],
    })
    initCashFlowForAccountSet(t.db, t.setId)
    const m = getEffectiveCashFlowMapping(t.db, t.setId).codes
    expect(m.has(t.accountId('1011'))).toBe(false) // 零余额账户用款额度是现金
    expect(m.get(t.accountId('400101'))?.main_credit_code).toBe('1101')
    expect(m.get(t.accountId('400102'))?.main_credit_code).toBe('1102')
    expect(m.get(t.accountId('400103'))?.main_credit_code).toBe('3101')
    t.voucher([['1011', 'debit', 500], ['400102', 'credit', 500]])
    t.voucher([['5001', 'debit', 200], ['1011', 'credit', 200]])
    const r = computeCashFlowByMapping(t.db, t.setId, 2026, 5, 5)
    expect(getMainItemAmount(r, '1102')).toBe(500)
    expect(getMainItemAmount(r, '1201')).toBe(200)
    expect(r.activities.operating).toBe(300)
    expect(r.supplement.size).toBe(0)
  })

  it('民间非营利组织：按准则自动识别，捐赠 / 会费 / 服务 / 政府补助各归其项', () => {
    const t = setupFromTemplate('准则库/54-民间非营利组织会计准则(2026).acd')
    expect(t.init.standard).toBe('npo')
    expect(t.items.some(i => i.kind === 'supplement')).toBe(false)
    expect(t.map('4101')?.main_credit_code).toBe('1101') // 捐赠收入
    expect(t.map('4201')?.main_credit_code).toBe('1102') // 会费收入
    expect(t.map('4301')?.main_credit_code).toBe('1103') // 提供服务收入
    expect(t.map('4501')?.main_credit_code).toBe('1104') // 商品销售收入
    expect(t.map('4401')?.main_credit_code).toBe('1105') // 政府补助收入
    expect(t.map('5101')?.main_debit_code).toBe('1203') // 业务活动成本 → 购买商品、接受服务
    expect(t.map('5401')?.main_debit_code).toBe('3202') // 筹资费用 → 偿付利息
    expect(t.map('2101')).toMatchObject({ main_credit_code: '3101', main_debit_code: '3201' })
    expect(t.map('2206')?.main_debit_code).toBe('1205') // 应交税费
    expect(t.map('3101')).toMatchObject({ main_credit_code: '1106', main_debit_code: '1204' }) // 非限定性净资产
  })
})

describe('准则识别与通用兜底', () => {
  it('参数为 auto 时按科目探测，认不出的不再当成政府', () => {
    const acc = (code: string, name: string) => ({ code, name, parent_id: null })
    expect(detectCashFlowStandardKey([acc('6001', '主营业务收入')])).toBe('enterprise')
    expect(detectCashFlowStandardKey([acc('5001', '主营业务收入'), acc('3103', '本年利润')])).toBe('small_business')
    expect(detectCashFlowStandardKey([acc('3001', '累计盈余'), acc('5001', '业务活动费用')])).toBe('government')
    expect(detectCashFlowStandardKey([acc('4101', '捐赠收入'), acc('3101', '非限定性净资产')])).toBe('npo')
    expect(detectCashFlowStandardKey([acc('3001', '股金'), acc('5001', '经营收入')])).toBe('generic')
  })

  it('通用规则：合作社科目按名称分大类并对应项目', () => {
    const t = createCashFlowTestDb({
      accounts: [
        ['1001', '库存现金', 'debit', 1, 0],
        ['2001', '短期借款', 'credit'],
        ['3001', '股金', 'credit'],
        ['5001', '经营收入', 'credit'],
        ['5101', '经营支出', 'debit'],
        ['5201', '管理费用', 'debit'],
      ],
    })
    t.db.prepare(`DELETE FROM system_params WHERE param_key = 'accounting_standard'`).run()
    const init = initCashFlowForAccountSet(t.db, t.setId)
    expect(init.standard).toBe('generic')
    const rows = [...listCashFlowMapRows(t.db, t.setId, 'equity'), ...listCashFlowMapRows(t.db, t.setId, 'pl')]
    expect(rows.find(r => r.code === '3001')).toMatchObject({ category_label: '权益', main_credit_code: '3101' })
    expect(rows.find(r => r.code === '5001')).toMatchObject({ category_label: '收支损益', main_credit_code: '1101' })
    expect(rows.find(r => r.code === '5101')?.main_debit_code).toBe('1201')
  })

  it('预设之后新增的一级科目自动按默认规则补齐', () => {
    const t = setupFromTemplate('小企业会计准则/小企业会计准则.acd', 'small_business')
    t.db
      .prepare(`INSERT INTO accounts (id, account_set_id, code, name, direction, level) VALUES ('new-1', ?, '2232', '应付利润', 'credit', 1)`)
      .run(t.setId)
    const m = getEffectiveCashFlowMapping(t.db, t.setId).codes
    expect(m.get('new-1')?.main_debit_code).toBe('3203')
  })
})
