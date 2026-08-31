import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapAcdEntryAmount } from '../scripts/importAcdToCurrentAccountSet.js'

describe('mapAcdEntryAmount - ACD 凭证借贷方向与红字金额', () => {
  it('正常借方分录', () => {
    expect(mapAcdEntryAmount(150, 0)).toEqual({ direction: 'debit', amount: 150 })
  })

  it('正常贷方分录', () => {
    expect(mapAcdEntryAmount(0, 150)).toEqual({ direction: 'credit', amount: 150 })
  })

  it('红字借方保留负号且方向仍为借', () => {
    // 5602009 冲销代发工资被退回
    expect(mapAcdEntryAmount(-97892.86, 0)).toEqual({ direction: 'debit', amount: -97892.86 })
  })

  it('红字贷方保留负号且方向仍为贷', () => {
    // 3104015 本年利润转未分配利润
    expect(mapAcdEntryAmount(0, -2549650.03)).toEqual({
      direction: 'credit',
      amount: -2549650.03,
    })
  })

  it('借贷均为 0 的行跳过', () => {
    expect(mapAcdEntryAmount(0, 0)).toBeNull()
  })

  it('浮点噪声按 2 位小数规整', () => {
    // ACD 中 3103 实际存的是 -48.58999999999992
    expect(mapAcdEntryAmount(-48.58999999999992, 0)).toEqual({
      direction: 'debit',
      amount: -48.59,
    })
  })

  it('红字分录聚合后与原软件发生额一致', () => {
    // 5603 财务费用 2022 年：借方 4 笔红字利息收入，合计应为 -11355.14
    const rows: Array<[number, number]> = [
      [704.35, 0],
      [-3880, 0],
      [-3978.87, 0],
      [-2965.13, 0],
      [-1235.49, 0],
    ]
    const debit = rows.reduce((sum, [jf, df]) => {
      const m = mapAcdEntryAmount(jf, df)
      return m && m.direction === 'debit' ? sum + m.amount : sum
    }, 0)
    expect(Math.round(debit * 100) / 100).toBe(-11355.14)
  })
})

describe('导入按原始数据落库，不套手工录入的金额校验', () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  it('ACD 导入脚本不引用 validateVoucherEntryAmounts', () => {
    const source = fs.readFileSync(
      path.join(srcDir, 'scripts', 'importAcdToCurrentAccountSet.ts'),
      'utf8'
    )
    // 该校验禁止负数金额，一旦套到导入路径上，源账套的红字凭证会被整批拒掉。
    // 注释里提到函数名是允许的，这里只禁止真正的 import 语句。
    expect(source).not.toMatch(/^\s*import[\s\S]{0,200}?validateVoucherEntryAmounts/m)
  })

  it('金额校验只挂在手工录入/修改端点上', () => {
    const routes = fs.readFileSync(path.join(srcDir, 'routes', 'voucher.ts'), 'utf8')
    const callCount = (routes.match(/validateVoucherEntryAmounts\(/g) || []).length
    // 4 处：POST /vouchers、POST /vouchers/insert、PUT /vouchers/:id、PUT /vouchers/:id/edit-audited
    expect(callCount).toBe(4)
  })
})
