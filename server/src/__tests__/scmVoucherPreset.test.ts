/**
 * 进销存凭证设置「一键自动预设」+ 自动匹配下探到最底层末级
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { resolveInventoryAccount, resolveScmAccount } from '../services/scmAccountResolver.js'
import { buildScmPreset } from '../services/scmVoucherPreset.js'

const AID = 'AS-PRESET'
let db: Database.Database

function acc(code: string, name: string, parent?: string, enabled = 1) {
  db.prepare('INSERT INTO accounts (id,account_set_id,code,name,parent_id,is_enabled) VALUES (?,?,?,?,?,?)')
    .run(`a-${code}`, AID, code, name, parent ? `a-${parent}` : null, enabled)
}
function param(key: string, value: string) {
  db.prepare('INSERT INTO system_params (id,account_set_id,param_key,param_value) VALUES (?,?,?,?)').run(`p-${key}`, AID, key, value)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (id TEXT, account_set_id TEXT, code TEXT, name TEXT, parent_id TEXT, is_enabled INTEGER DEFAULT 1);
    CREATE TABLE system_params (id TEXT, account_set_id TEXT, param_key TEXT, param_value TEXT);
    CREATE TABLE aux_categories (id TEXT, account_set_id TEXT, code TEXT, name TEXT);
    CREATE TABLE scm_item (account_set_id TEXT, code TEXT, name TEXT, item_type TEXT, inv_account TEXT, enabled INTEGER DEFAULT 1);
    CREATE TABLE scm_partner (account_set_id TEXT, code TEXT, name TEXT, partner_type TEXT, ar_account TEXT, ap_account TEXT, enabled INTEGER DEFAULT 1);
  `)
  acc('1122', '应收账款'); acc('2202', '应付账款')
  acc('1403', '原材料'); acc('140301', '主要材料', '1403'); acc('140302', '辅助材料', '1403')
  acc('1405', '库存商品'); acc('140501', '甲类商品', '1405')
  acc('6001', '主营业务收入'); acc('600101', '劳务收入', '6001'); acc('600102', '销售商品收入', '6001')
  acc('6401', '主营业务成本'); acc('640101', '旧成本', '6401', 0); acc('640102', '商品成本', '6401')
  acc('2221', '应交税费'); acc('222101', '应交增值税', '2221'); acc('22210101', '进项税额', '222101'); acc('22210105', '销项税额', '222101')
  db.prepare("INSERT INTO aux_categories VALUES ('c1', ?, 'customer', '往来单位'), ('c2', ?, 'dept', '部门')").run(AID, AID)
})

describe('自动匹配下探到最底层末级', () => {
  it('默认编码命中上级时下探，按提示词优先（销售商品收入优先于劳务收入）', () => {
    const r = resolveScmAccount(db, AID, 'scm:acc_revenue')
    expect(r).toMatchObject({ code: '600102', name: '销售商品收入', parent_code: '6001' })
  })

  it('停用的末级不选', () => {
    expect(resolveScmAccount(db, AID, 'scm:acc_cost')?.code).toBe('640102')
  })

  it('已是末级的不变、不带 parent_code', () => {
    const r = resolveScmAccount(db, AID, 'scm:acc_ar')
    expect(r?.code).toBe('1122')
    expect(r?.parent_code).toBeUndefined()
  })

  it('用户显式配置保持原样（是否末级由保存校验 / 预设负责）', () => {
    param('scm:acc_revenue', '6001')
    expect(resolveScmAccount(db, AID, 'scm:acc_revenue')?.code).toBe('6001')
    expect(resolveScmAccount(db, AID, 'scm:acc_revenue', { ignoreParam: true })?.code).toBe('600102')
  })

  it('存货科目按物料类型取末级：原辅材料→原材料下、成品→库存商品下', () => {
    expect(resolveInventoryAccount(db, AID, '0')?.code).toBe('140301')
    expect(resolveInventoryAccount(db, AID, '9')?.code).toBe('140501')
    expect(resolveInventoryAccount(db, AID, '6')?.code).toBe('140501')   // 无半成品科目退库存商品
  })
})

describe('一键预设', () => {
  it('已配置末级不动；配成上级从该上级下探；未配置按自动匹配取末级', () => {
    param('scm:acc_ar', '1122')
    param('scm:acc_cost', '6401')
    const preset = buildScmPreset(db, AID)
    const byKey = Object.fromEntries(preset.accounts.map(a => [a.param_key, a]))
    expect(byKey['scm:acc_ar']).toBeUndefined()
    expect(byKey['scm:acc_cost']).toMatchObject({ current: '6401', proposed: '640102', reason: '非末级' })
    expect(byKey['scm:acc_revenue']).toMatchObject({ current: '', proposed: '600102', reason: '未配置' })
    expect(byKey['scm:acc_tax_input']).toMatchObject({ proposed: '22210101' })
  })

  it('配置的科目不存在 → 重新匹配；本账套找不到 → 建议为空并说明', () => {
    param('scm:acc_revenue', '9999')
    const byKey = Object.fromEntries(buildScmPreset(db, AID).accounts.map(a => [a.param_key, a]))
    expect(byKey['scm:acc_revenue']).toMatchObject({ reason: '科目不存在', proposed: '600102' })
    expect(byKey['scm:acc_labor']).toMatchObject({ reason: '本账套找不到同类科目', proposed: '' })
  })

  it('所有建议都是末级科目', () => {
    const leafOf = db.prepare('SELECT 1 FROM accounts WHERE account_set_id=? AND parent_id=?')
    const preset = buildScmPreset(db, AID)
    for (const p of [...preset.accounts, ...preset.items, ...preset.partners]) {
      if (!p.proposed) continue
      expect(leafOf.get(AID, `a-${p.proposed}`), `${p.proposed} 应为末级`).toBeUndefined()
    }
  })

  it('辅助来源恢复自动识别，匹配规则恢复名称完全一致', () => {
    const preset = buildScmPreset(db, AID)
    expect(preset.match_mode).toBe('name')
    expect(preset.source_map).toEqual({ c1: 'partner', c2: 'dept' })
  })

  it('物料存货科目：空的按类型、上级的下探、末级的不动', () => {
    db.prepare("INSERT INTO scm_item (account_set_id,code,name,item_type,inv_account) VALUES (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)")
      .run(AID, 'M1', '螺丝', '0', null, AID, 'M2', '整机', '9', '1405', AID, 'M3', '已配好', '9', '140501')
    const items = Object.fromEntries(buildScmPreset(db, AID).items.map(i => [i.code, i]))
    expect(items.M1).toMatchObject({ proposed: '140301', reason: '未配置' })
    expect(items.M2).toMatchObject({ proposed: '140501', reason: '非末级' })
    expect(items.M3).toBeUndefined()
  })

  it('往来单位：客户只补应收、供应商只补应付，空的取预设后的全局科目', () => {
    acc('2203', '预收账款'); acc('220301', '预收甲', '2203')
    db.prepare("INSERT INTO scm_partner (account_set_id,code,name,partner_type,ar_account,ap_account) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)")
      .run(AID, 'C1', '客户', 'customer', null, null, AID, 'S1', '供应商', 'supplier', null, '2203')
    const rows = buildScmPreset(db, AID).partners
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'C1', field: 'ar_account', proposed: '1122' }),
      expect.objectContaining({ code: 'S1', field: 'ap_account', proposed: '220301', reason: '非末级' }),
    ]))
    expect(rows.some(r => r.code === 'C1' && r.field === 'ap_account')).toBe(false)
  })
})
