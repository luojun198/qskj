/**
 * FIX-259：对账单导入工具函数 —— 表头关键词匹配、表头行识别、列号、金额 / 日期、已保存映射按表头名回填
 */
import { describe, it, expect } from 'vitest'
import {
  matchStatementField, autoMapByHeader, guessHeaderRow, colLabel, parseAmount, normExcelDate,
  applyProfile, convertRow, inferAmountMode, smartMapByHeader, similarity, schemeFitScore,
} from '../bankStatementImport'

describe('bankStatementImport utils', () => {
  it('matchStatementField：银行视角借贷反转，常见列名', () => {
    expect(matchStatementField('交易日期')).toBe('biz_date')
    expect(matchStatementField('贷方发生额')).toBe('debit')
    expect(matchStatementField('借方发生额')).toBe('credit')
    expect(matchStatementField('收入金额')).toBe('debit')
    expect(matchStatementField('支出金额')).toBe('credit')
    expect(matchStatementField('交易金额')).toBe('amount')
    expect(matchStatementField('借贷标志')).toBe('direction')
    expect(matchStatementField('收付标志')).toBe('direction')
    expect(matchStatementField('对方户名')).toBe('counter_name')
    expect(matchStatementField('收付款人')).toBe('counter_name')
    expect(matchStatementField('对方账号')).toBe('counter_account')
    expect(matchStatementField('账户余额')).toBe('balance')
    expect(matchStatementField('摘要')).toBe('summary')
    expect(matchStatementField('用途')).toBe('summary')
    expect(matchStatementField('流水号')).toBe('bill_no')
    expect(matchStatementField('交易类型')).toBe('settle_type')
    expect(matchStatementField('')).toBeNull()
    expect(matchStatementField('序号')).toBeNull()
  })

  it('guessHeaderRow / autoMapByHeader：跳过标题行找到表头', () => {
    const rows = [
      ['某银行明细'], ['账号：1'],
      ['交易日期', '摘要', '借方发生额', '贷方发生额', '余额'],
      ['2026-09-01', 'x', '', '100', '100'],
    ]
    expect(guessHeaderRow(rows)).toBe(2)
    const m = autoMapByHeader(rows[2])
    expect(m).toEqual({ biz_date: 0, summary: 1, credit: 2, debit: 3, balance: 4 })
    expect(inferAmountMode(m)).toBe('dc')
    expect(inferAmountMode({ biz_date: 0, amount: 1 })).toBe('single')
    expect(guessHeaderRow([['a', 'b'], ['1', '2']])).toBe(-1)
  })

  it('smartMapByHeader：完全同名为 exact，关键词 / 字面相近为 smart', () => {
    const r = smartMapByHeader(['记帐日', '交易额', '收支标志', '对方户名称', '摘要', '账户余额', '序号'])
    expect(r.mapping).toEqual({ biz_date: 0, amount: 1, direction: 2, counter_name: 3, summary: 4, balance: 5 })
    expect(r.sources).toEqual({
      biz_date: 'smart', amount: 'smart', direction: 'exact', counter_name: 'smart', summary: 'exact', balance: 'exact',
    })
    // 借 / 贷发生额涉及银行视角反转，只作关键词推测，需人工确认
    const dc = smartMapByHeader(['交易日期', '借方发生额', '贷方发生额'])
    expect(dc.mapping).toEqual({ biz_date: 0, credit: 1, debit: 2 })
    expect(dc.sources).toEqual({ biz_date: 'exact', credit: 'smart', debit: 'smart' })
  })

  it('smartMapByHeader：一字段一列、无关表头不匹配', () => {
    const r = smartMapByHeader(['日期', '交易日期', '备注', '客户经理'])
    // 两列都像日期：精确同名同分时取靠前的列；另一列不被别的字段占用
    expect(r.mapping).toEqual({ biz_date: 0, summary: 2 })
    expect(Object.values(r.mapping)).not.toContain(3)
    expect(similarity('交易额', '交易金额')).toBeGreaterThan(0.8)
    expect(similarity('序号', '票据号')).toBeLessThan(0.6)
  })

  it('schemeFitScore：已映射字段全部按名对上才算吻合', () => {
    const scheme = { mapping: { biz_date: 0, debit: 3, summary: 1 }, header_labels: ['交易日期', '摘要', '借方', '贷方发生额'] }
    expect(schemeFitScore(scheme, ['序号', '交易日期', '贷方发生额', '摘要'])).toBe(3)
    expect(schemeFitScore(scheme, ['交易日期', '摘要', '金额'])).toBe(0)
    expect(schemeFitScore({ mapping: { biz_date: 0 } }, ['交易日期'])).toBe(0)
    expect(schemeFitScore(scheme, null)).toBe(0)
  })

  it('colLabel：超过 26 列', () => {
    expect(colLabel(0)).toBe('A')
    expect(colLabel(25)).toBe('Z')
    expect(colLabel(26)).toBe('AA')
    expect(colLabel(27)).toBe('AB')
  })

  it('parseAmount / normExcelDate', () => {
    expect(parseAmount('1,234.5')).toBe(1234.5)
    expect(parseAmount('￥ 3,000')).toBe(3000)
    expect(normExcelDate('2026/9/3')).toBe('2026-09-03')
    expect(normExcelDate('20260903')).toBe('2026-09-03')
    expect(normExcelDate(46086)).toBe('2026-03-05')
    expect(normExcelDate('2026年9月3日')).toBe('2026-09-03')
  })

  it('applyProfile：优先按表头名回填，缺失时退回索引', () => {
    const profile = {
      mapping: { biz_date: 0, debit: 3, summary: 1, balance: 9 },
      header_labels: ['交易日期', '摘要', '对方户名', '贷方发生额'],
    }
    // 新文件列序不同：摘要挪到最后，日期在第 2 列；同名找不到的字段不按索引乱填
    const header = ['序号', '交易日期', '贷方发生额', '摘要']
    expect(applyProfile(profile, header, 4)).toEqual({ biz_date: 1, debit: 2, summary: 3 })
    // 完全不同格式的文件：表头都对不上 → 全部留空，交给自动识别
    expect(applyProfile(profile, ['日期', '金额', '收付标志'], 3)).toEqual({})
    // 无表头：退回索引（越界的 balance 丢弃）
    expect(applyProfile(profile, null, 4)).toEqual({ biz_date: 0, debit: 3, summary: 1 })
    // 旧配置没有表头文字：也退回索引
    expect(applyProfile({ mapping: { biz_date: 2 } }, ['a', 'b', 'c'], 3)).toEqual({ biz_date: 2 })
  })

  it('convertRow：dc / single 两种模式', () => {
    const dc = convertRow(['2026-09-01', '货款', '', '1,000', '5,000'], { biz_date: 0, summary: 1, credit: 2, debit: 3, balance: 4 }, 'dc', [])
    expect(dc).toMatchObject({ biz_date: '2026-09-01', summary: '货款', debit: 1000, credit: 0, balance: 5000 })
    const single = convertRow(['2026-09-01', '200', '付'], { biz_date: 0, amount: 1, direction: 2 }, 'single', ['收'])
    expect(single).toMatchObject({ debit: 0, credit: 200, balance: null })
    const sign = convertRow(['2026-09-01', '-200'], { biz_date: 0, amount: 1 }, 'single', [])
    expect(sign).toMatchObject({ debit: 0, credit: 200 })
  })
})
