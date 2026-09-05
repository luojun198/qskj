/**
 * 供应链对方科目解析单元测试
 *
 * 背景：默认编码取自《企业会计准则》科目表，而 ACD 导入的账套用润衡科目表
 * （进项税是 2221001001 不是 22210101），行政事业科目表更是把 6401 用作「经营预算收入」。
 * 只认编码会导致「带税单据出不了凭证」或「静默记错科目」两种后果。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  buildMissingAccountMessage,
  resolveScmAccount,
  resolveScmAccounts,
  SCM_ACCOUNT_SPECS,
  specByDefaultCode,
  suggestScmAccounts,
} from '../services/scmAccountResolver.js'

const AID = 'AS-ACC'
let db: Database.Database

function createDb() {
  const d = new Database(':memory:')
  d.exec(`
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
  `)
  return d
}

function acc(...pairs: Array<[string, string]>) {
  for (const [code, name] of pairs) {
    db.prepare('INSERT INTO accounts (id,account_set_id,code,name) VALUES (?,?,?,?)')
      .run(code, AID, code, name)
  }
}
function param(key: string, value: string) {
  db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)')
    .run(key, AID, key, value)
}
const resolve = (key: string) => resolveScmAccount(db, AID, key)

/** 企业会计准则科目表（默认编码全部命中且名称相符） */
function seedEnterpriseChart() {
  acc(
    ['2202', '应付账款'], ['1122', '应收账款'], ['6001', '主营业务收入'], ['6401', '主营业务成本'],
    ['1901', '待处理财产损溢'], ['5001', '生产成本'], ['2211', '应付职工薪酬'], ['5101', '制造费用'],
    ['2221', '应交税费'], ['22210101', '进项税额'], ['22210105', '销项税额'],
  )
}

/** 润衡科目表（ACD 导入）：税科目编码不同 */
function seedRunhengChart() {
  acc(
    ['2202', '应付账款'], ['1122', '应收账款'], ['6001', '主营业务收入'], ['6401', '主营业务成本'],
    ['1901', '待处理财产损溢'], ['5001', '生产成本'], ['2211', '应付职工薪酬'], ['5101', '制造费用'],
    ['2221', '应交税费'], ['2221001', '应交增值税'],
    ['2221001001', '进项税额'], ['2221001005', '销项税额'],
    ['2221001007', '进项税额转出'], ['2221001010', '待认证进项税额'], ['2221001011', '待抵扣进项税额'],
  )
}

/** 行政事业科目表：同一段编码含义完全不同 */
function seedGovChart() {
  acc(
    ['2302', '应付账款'], ['1212', '应收账款'], ['6001', '财政拨款预算收入'], ['6401', '经营预算收入'],
    ['1901', '长期待摊费用'], ['1902', '待处理财产损溢'], ['5001', '业务活动费用'],
    ['2201', '应付职工薪酬'], ['5101', '单位管理费用'],
    ['21010101', '进项税额'], ['21010105', '销项税额'],
  )
}

describe('企业会计准则科目表：全部按默认编码命中', () => {
  beforeEach(() => { db = createDb(); seedEnterpriseChart() })

  it('十个对方科目全部解析为默认编码', () => {
    const all = resolveScmAccounts(db, AID)
    expect(Object.values(all).every(v => v?.source === 'code')).toBe(true)
    expect(all['scm:acc_tax_input']).toMatchObject({ code: '22210101', name: '进项税额' })
    expect(all['scm:acc_tax_output']).toMatchObject({ code: '22210105', name: '销项税额' })
    expect(all['scm:acc_cost']).toMatchObject({ code: '6401', name: '主营业务成本' })
  })
})

describe('润衡科目表（ACD 导入）：税科目按第二默认编码命中', () => {
  beforeEach(() => { db = createDb(); seedRunhengChart() })

  it('进项税/销项税解析到 2221001001 / 2221001005，不再落空', () => {
    expect(resolve('scm:acc_tax_input')).toMatchObject({ code: '2221001001', name: '进项税额', source: 'code' })
    expect(resolve('scm:acc_tax_output')).toMatchObject({ code: '2221001005', name: '销项税额', source: 'code' })
  })

  it('不会误命中「进项税额转出 / 待认证 / 待抵扣」', () => {
    // 去掉正主，只留干扰项
    db.prepare("DELETE FROM accounts WHERE account_set_id=? AND code='2221001001'").run(AID)
    expect(resolve('scm:acc_tax_input')).toBeNull()
  })

  it('其余科目与企业准则一致', () => {
    expect(resolve('scm:acc_ap')).toMatchObject({ code: '2202', source: 'code' })
    expect(resolve('scm:acc_production')).toMatchObject({ code: '5001', source: 'code' })
  })
})

describe('行政事业科目表：编码撞车时按名称纠正', () => {
  beforeEach(() => { db = createDb(); seedGovChart() })

  it('默认编码不存在的按名称找到正确科目', () => {
    expect(resolve('scm:acc_ap')).toMatchObject({ code: '2302', name: '应付账款', source: 'name' })
    expect(resolve('scm:acc_ar')).toMatchObject({ code: '1212', name: '应收账款', source: 'name' })
    expect(resolve('scm:acc_labor')).toMatchObject({ code: '2201', name: '应付职工薪酬', source: 'name' })
    expect(resolve('scm:acc_tax_input')).toMatchObject({ code: '21010101', name: '进项税额', source: 'name' })
    expect(resolve('scm:acc_tax_output')).toMatchObject({ code: '21010105', name: '销项税额', source: 'name' })
  })

  it('1901 在本表是「长期待摊费用」，应改用名称匹配到的 1902 待处理财产损溢', () => {
    expect(resolve('scm:acc_other')).toMatchObject({ code: '1902', name: '待处理财产损溢', source: 'name' })
  })

  it('编码存在但名称对不上且找不到同名科目时，沿用旧值并标记 code_mismatch', () => {
    // 6401 在本表叫「经营预算收入」，账套里没有「主营业务成本」——保持旧行为但要提醒
    expect(resolve('scm:acc_cost')).toMatchObject({ code: '6401', name: '经营预算收入', source: 'code_mismatch' })
    expect(resolve('scm:acc_revenue')).toMatchObject({ code: '6001', source: 'code_mismatch' })
    expect(resolve('scm:acc_production')).toMatchObject({ code: '5001', source: 'code_mismatch' })
    expect(resolve('scm:acc_overhead')).toMatchObject({ code: '5101', source: 'code_mismatch' })
  })
})

describe('系统参数优先级与边界', () => {
  beforeEach(() => { db = createDb(); seedRunhengChart() })

  it('用户显式配置永远优先于自动匹配', () => {
    param('scm:acc_tax_input', '2221001011')
    expect(resolve('scm:acc_tax_input')).toMatchObject({ code: '2221001011', source: 'param' })
  })

  it('配了不存在的科目也照用，好让报错指向用户配的那个', () => {
    param('scm:acc_ap', '9999')
    expect(resolve('scm:acc_ap')).toMatchObject({ code: '9999', name: '', source: 'param' })
  })

  it('空字符串参数视为未配置，继续自动匹配', () => {
    param('scm:acc_ap', '   ')
    expect(resolve('scm:acc_ap')).toMatchObject({ code: '2202', source: 'code' })
  })

  it('空账套解析不出任何科目', () => {
    db = createDb()
    expect(resolve('scm:acc_ap')).toBeNull()
    expect(resolve('scm:acc_tax_input')).toBeNull()
  })

  it('未知参数键返回 null', () => {
    expect(resolve('scm:acc_not_exist')).toBeNull()
  })
})

describe('末级科目优先', () => {
  beforeEach(() => {
    db = createDb()
    // 同名父子科目：应付账款 2202 下挂 2202001 应付账款-货款
    acc(['2202x', '应付账款'], ['2202x01', '应付账款'])
  })

  it('同名多科目时优先挑末级、编码短的', () => {
    const hit = resolve('scm:acc_ap')
    expect(hit?.code).toBe('2202x01')
    expect(hit?.source).toBe('name')
  })
})

describe('报错提示带候选科目', () => {
  beforeEach(() => { db = createDb(); seedRunhengChart() })

  it('说清楚缺的是哪个业务科目、本账套有哪些候选、去哪配', () => {
    const msg = buildMissingAccountMessage(db, AID, ['22210101'])
    expect(msg).toContain('22210101')
    expect(msg).toContain('应交税费—进项税额')
    expect(msg).toContain('2221001001 进项税额')
    expect(msg).toContain('系统参数 → 供应链')
    // 干扰项不应出现在候选里
    expect(msg).not.toContain('进项税额转出')
  })

  it('账套里确实没有同类科目时如实说明', () => {
    db = createDb()
    acc(['1001', '库存现金'])
    const msg = buildMissingAccountMessage(db, AID, ['22210101'])
    expect(msg).toContain('本账套未找到同类科目')
  })

  it('非供应链默认科目的编码原样列出', () => {
    expect(buildMissingAccountMessage(db, AID, ['1405'])).toContain('1405')
  })
})

describe('候选科目查询', () => {
  beforeEach(() => { db = createDb(); seedRunhengChart() })

  it('suggestScmAccounts 返回可选科目且排除干扰项', () => {
    const list = suggestScmAccounts(db, AID, 'scm:acc_tax_input')
    expect(list.map(x => x.code)).toContain('2221001001')
    expect(list.map(x => x.name)).not.toContain('进项税额转出')
  })

  it('specByDefaultCode 能由默认编码反查参数', () => {
    expect(specByDefaultCode('22210101')?.key).toBe('scm:acc_tax_input')
    expect(specByDefaultCode('2221001005')?.key).toBe('scm:acc_tax_output')
    expect(specByDefaultCode('1405')).toBeUndefined()
  })

  it('规格表覆盖 gen-voucher 用到的全部对方科目', () => {
    expect(SCM_ACCOUNT_SPECS.map(s => s.key).sort()).toEqual([
      'scm:acc_ap', 'scm:acc_ar', 'scm:acc_cost', 'scm:acc_labor', 'scm:acc_other',
      'scm:acc_overhead', 'scm:acc_production', 'scm:acc_revenue',
      'scm:acc_tax_input', 'scm:acc_tax_output',
    ])
  })
})
