import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseKmbmRow, resolveCashBankFlags } from '../utils/acdKmbmParse.js'

function splitRow(line: string): string[] {
  return line.split('\t')
}

describe('acdKmbmParse', () => {
  it('yjd=1 不应标记为现金，xjs=1 才为现金类科目', () => {
    const receivable = parseKmbmRow(
      splitRow(
        '1121\t应收票据\t1\t0\t0\t0\t0\t\t\t0\t0\t0\t0\t0\t1\t0\t应收票据\t\t\t\t\t0\t0'
      )
    )
    expect(receivable?.isCash).toBe(false)
    expect(receivable?.isBank).toBe(false)
    expect(receivable?.isCashFlow).toBe(false)

    const cash = parseKmbmRow(
      splitRow(
        '1001\t库存现金\t1\t0\t0\t0\t0\t\t\t0\t0\t0\t0\t0\t1\t0\t库存现金\t\t\t\t\t0\t1'
      )
    )
    expect(cash?.isCash).toBe(true)
    expect(cash?.isBank).toBe(false)
    expect(cash?.isCashFlow).toBe(true)
  })

  it('银行存款应标记为银行而非现金', () => {
    const bank = parseKmbmRow(
      splitRow(
        '1002\t银行存款\t1\t0\t0\t0\t0\t\t\t0\t0\t0\t0\t0\t1\t0\t银行存款\t\t\t\t\t0\t1'
      )
    )
    expect(bank?.isCash).toBe(false)
    expect(bank?.isBank).toBe(true)
  })

  it('余额方向应读取 yefx 列', () => {
    const equity = parseKmbmRow(
      splitRow(
        '3103\t本年利润\t1\t0\t0\t0\t0\t\t\t0\t0\t0\t0\t0\t0\t1\t本年利润\t\t\t\t\t0\t0'
      )
    )
    expect(equity?.direction).toBe('credit')
  })

  it('辅助核算标志应对齐 xms/dws/bms/grs/wls 列', () => {
    const row = parseKmbmRow(
      splitRow(
        '5001\t生产成本\t1\t0\t0\t0\t0\t\t\t1\t0\t1\t0\t0\t0\t0\t生产成本\t\t\t\t\t0\t0'
      )
    )
    expect(row?.isProjectAux).toBe(true)
    expect(row?.isDeptAux).toBe(true)
    expect(row?.isCustomerAux).toBe(false)
  })

  it('应对真实 kmbm 样本文件保持低现金科目比例', () => {
    const filePath = join(process.cwd(), '..', '模版', '新企业会计准则', 'extracted', 'rhsj', 'kmbm_utf8.txt')
    const content = readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    let cashCount = 0
    let total = 0
    for (const line of lines) {
      const parsed = parseKmbmRow(splitRow(line))
      if (!parsed) continue
      total++
      if (parsed.isCash || parsed.isBank) cashCount++
    }
    expect(total).toBeGreaterThan(100)
    expect(cashCount).toBeLessThan(20)
    expect(cashCount).toBeGreaterThan(0)
  })

  it('resolveCashBankFlags 在无 xjs 时返回 false', () => {
    expect(resolveCashBankFlags('1121', '应收票据', false)).toEqual({
      isCash: false,
      isBank: false,
    })
  })
})
