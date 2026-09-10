import { describe, it, expect } from 'vitest'
import {
  AUX_NC_COLUMNS,
  NC_COLUMNS,
  buildAcdDateFromDay,
  buildAuxTypes,
  deriveAcdBusinessParams,
  extractAccountCodeLengthsFromXt,
  normalizeAcdDateInPeriod,
  parseAcdNcAmounts,
  parseAcdNcForeignAmounts,
  pickBaseCurrencyRows,
  resolveImportedAccountCurrencyCode,
} from '../scripts/importAcdToCurrentAccountSet.js'

/** 取自润衡 ACD（车子物流 2025.12.01 开账）nc.txt / dwnc.txt 的真实行 */
const NC_1601 = '1601\tBWB\t1960913.72\t0\t17588.35\t697140.09\t0\t0\t1\t0\t1960913.72\t0\t17588.35\t697140.09\t2025'.split('\t')
const NC_2221 = '2221\tBWB\t7135.52\t60861.4\t1468883.47\t1364266.18\t0\t0\t1\t0\t7135.52\t60861.4\t1468883.47\t1364266.18\t2025'.split('\t')
const NC_6551 = '6551\tBWB\t0\t0\t-307966.33\t-307966.33\t1\t0\t1\t0\t0\t0\t-307966.33\t-307966.33\t2025'.split('\t')
const DWNC_KH0001 = '1122\tKH0001\tBWB\t131103\t0\t284447.38\t411408.38\t1\t\t131103\t0\t284447.38\t411408.38\t2025'.split('\t')
/** 外币行：非 _b 列为本位币换算额，_b 列为原币；或非 _b 为 0 仅 _b 有值 */
const NC_USD_WITH_B =
  '1002\tUSD\t7000\t0\t0\t0\t0\t1\t1\t0\t1000\t0\t0\t0\t2025'.split('\t')
const NC_USD_B_ONLY =
  '1002\tUSD\t0\t0\t0\t0\t0\t1\t1\t0\t1000.5\t0\t200\t50\t2025'.split('\t')
const NC_USD_FALLBACK =
  '1002\tUSD\t1000\t0\t100\t0\t0\t1\t1\t0\t0\t0\t0\t0\t2025'.split('\t')

describe('parseAcdNcAmounts（nc / dwnc 年初表取数）', () => {
  it('nc.txt：年初借方落 opening_debit，建账前累计借/贷落 pre_book_*，年份取 nf 列', () => {
    const parsed = parseAcdNcAmounts(NC_1601, NC_COLUMNS, 2099)
    expect(parsed).toEqual({
      year: 2025,
      openingDebit: 1960913.72,
      openingCredit: 0,
      preBookDebit: 17588.35,
      preBookCredit: 697140.09,
    })
  })

  it('年初借贷两侧同时有值时净额化为单侧（系统约束：年初借贷不可同时填写）', () => {
    const parsed = parseAcdNcAmounts(NC_2221, NC_COLUMNS, 2099)
    expect(parsed.openingDebit).toBe(0)
    expect(parsed.openingCredit).toBeCloseTo(60861.4 - 7135.52, 2)
    // 累计发生额两侧都保留，不净额化
    expect(parsed.preBookDebit).toBe(1468883.47)
    expect(parsed.preBookCredit).toBe(1364266.18)
  })

  it('红字（负数）累计发生额原样保留', () => {
    const parsed = parseAcdNcAmounts(NC_6551, NC_COLUMNS, 2099)
    expect(parsed.preBookDebit).toBe(-307966.33)
    expect(parsed.preBookCredit).toBe(-307966.33)
  })

  it('dwnc 等辅助年初表多一列辅助编码，按 AUX_NC_COLUMNS 取数', () => {
    const parsed = parseAcdNcAmounts(DWNC_KH0001, AUX_NC_COLUMNS, 2099)
    expect(parsed).toEqual({
      year: 2025,
      openingDebit: 131103,
      openingCredit: 0,
      preBookDebit: 284447.38,
      preBookCredit: 411408.38,
    })
  })

  it('nf 缺失或无效时回退到 fallbackYear', () => {
    const row = [...NC_1601]
    row[NC_COLUMNS.nf] = ''
    expect(parseAcdNcAmounts(row, NC_COLUMNS, 2031).year).toBe(2031)
  })
})

describe('parseAcdNcForeignAmounts（外币原币取数）', () => {
  it('优先读取 *_b 列作为原币金额', () => {
    const parsed = parseAcdNcForeignAmounts(NC_USD_WITH_B, NC_COLUMNS, 2099)
    expect(parsed).toEqual({
      year: 2025,
      openingDebit: 1000,
      openingCredit: 0,
      preBookDebit: 0,
      preBookCredit: 0,
    })
  })

  it('*_b 有值时忽略非 _b 列（避免把本位币换算额当原币）', () => {
    const parsed = parseAcdNcForeignAmounts(NC_USD_B_ONLY, NC_COLUMNS, 2099)
    expect(parsed.openingDebit).toBe(1000.5)
    expect(parsed.preBookDebit).toBe(200)
    expect(parsed.preBookCredit).toBe(50)
  })

  it('*_b 全为 0 时回退到非 _b 列', () => {
    const parsed = parseAcdNcForeignAmounts(NC_USD_FALLBACK, NC_COLUMNS, 2099)
    expect(parsed).toEqual({
      year: 2025,
      openingDebit: 1000,
      openingCredit: 0,
      preBookDebit: 100,
      preBookCredit: 0,
    })
  })

  it('AUX_NC_COLUMNS 的 *_b 列位正确', () => {
    // dwnc: kmbm, aux, bz, nc_jf.., fbs, ys, nc_jf_b(9)...
    const row =
      '1122\tKH0001\tUSD\t0\t0\t0\t0\t1\t\t500\t0\t10\t0\t2025'.split('\t')
    const parsed = parseAcdNcForeignAmounts(row, AUX_NC_COLUMNS, 2099)
    expect(parsed.openingDebit).toBe(500)
    expect(parsed.preBookDebit).toBe(10)
  })
})

describe('pickBaseCurrencyRows（多币种行过滤）', () => {
  it('存在 BWB 本位币行时只保留 BWB 行，避免原币行重复累加', () => {
    const rows = [
      '6602001\t5\tRMB\t0\t0\t0\t0\t0\t0\t161.11\t0\t0\t0\t2026'.split('\t'),
      '6602001\t5\tBWB\t161.11\t0\t0\t0\t0\t0\t161.11\t0\t0\t0\t2026'.split('\t'),
    ]
    const picked = pickBaseCurrencyRows(rows, AUX_NC_COLUMNS.bz)
    expect(picked).toHaveLength(1)
    expect(picked[0][2]).toBe('BWB')
  })

  it('没有任何 BWB 行时原样返回（兼容不带币种标记的老版本）', () => {
    const rows = [['1001', '', '100', '0', '0', '0']]
    expect(pickBaseCurrencyRows(rows, 1)).toBe(rows)
  })

  it('BWB 过滤后外币行仍可单独用于 foreign 取数（不影响 pickBase）', () => {
    const rows = [NC_1601, NC_USD_WITH_B]
    const picked = pickBaseCurrencyRows(rows, NC_COLUMNS.bz)
    expect(picked).toHaveLength(1)
    expect(picked[0][NC_COLUMNS.bz]).toBe('BWB')
    // 原币行仍在完整 rows 里，可供 parseAcdNcForeignAmounts 使用
    expect(parseAcdNcForeignAmounts(NC_USD_WITH_B, NC_COLUMNS, 2099).openingDebit).toBe(1000)
  })
})

describe('resolveImportedAccountCurrencyCode', () => {
  it('fbs=1 且 bz=USD 时原样保留', () => {
    expect(resolveImportedAccountCurrencyCode(true, 'USD', 'RMB')).toBe('USD')
  })

  it('空值 / BWB / 本位币别名不写入', () => {
    expect(resolveImportedAccountCurrencyCode(true, '', 'RMB')).toBeNull()
    expect(resolveImportedAccountCurrencyCode(true, 'BWB', 'RMB')).toBeNull()
    expect(resolveImportedAccountCurrencyCode(true, 'RMB', 'RMB')).toBeNull()
    expect(resolveImportedAccountCurrencyCode(false, 'USD', 'RMB')).toBeNull()
  })
})

describe('extractAccountCodeLengthsFromXt', () => {
  it('润衡把未启用级次写成 xt_lenN=0，应视为到此结束而不是配置无效', () => {
    const xt = new Map<string, string>()
    ;['4', '3', '3', '2', '2', '2', '0', '0', '0', '0'].forEach((value, index) => {
      xt.set(`xt_len${index + 1}`, value)
    })
    expect(extractAccountCodeLengthsFromXt(xt)).toEqual([4, 3, 3, 2, 2, 2, 2, 2, 2, 2])
  })

  it('第 1 级缺失或为 0 时返回 null', () => {
    expect(extractAccountCodeLengthsFromXt(new Map())).toBeNull()
    expect(extractAccountCodeLengthsFromXt(new Map([['xt_len1', '0']]))).toBeNull()
  })

  it('负数或非数字视为配置无效', () => {
    expect(extractAccountCodeLengthsFromXt(new Map([['xt_len1', '4'], ['xt_len2', '-1']]))).toBeNull()
    expect(extractAccountCodeLengthsFromXt(new Map([['xt_len1', 'abc']]))).toBeNull()
  })
})

describe('凭证日期解析（pzdj_rq / pz.dd）', () => {
  it('normalizeAcdDateInPeriod 支持多种分隔符，且必须落在凭证所属年月内', () => {
    expect(normalizeAcdDateInPeriod('2025-12-23', 2025, 12)).toBe('2025-12-23')
    expect(normalizeAcdDateInPeriod('2025.12.05', 2025, 12)).toBe('2025-12-05')
    expect(normalizeAcdDateInPeriod('2025/12/5', 2025, 12)).toBe('2025-12-05')
    expect(normalizeAcdDateInPeriod('20251231', 2025, 12)).toBe('2025-12-31')
    // 串月 / 非法日 / 空值
    expect(normalizeAcdDateInPeriod('2026-01-08', 2025, 12)).toBeNull()
    expect(normalizeAcdDateInPeriod('2025-12-32', 2025, 12)).toBeNull()
    expect(normalizeAcdDateInPeriod('', 2025, 12)).toBeNull()
    // 不传期间时只校验日期本身（记账日期可以晚于凭证月）
    expect(normalizeAcdDateInPeriod('2026-01-08')).toBe('2026-01-08')
  })

  it('buildAcdDateFromDay 用 dd 列拼出当月日期，越界返回 null', () => {
    expect(buildAcdDateFromDay('23', 2025, 12)).toBe('2025-12-23')
    expect(buildAcdDateFromDay('31', 2025, 11)).toBeNull()
    expect(buildAcdDateFromDay('0', 2025, 12)).toBeNull()
    expect(buildAcdDateFromDay('', 2025, 12)).toBeNull()
  })
})

describe('deriveAcdBusinessParams', () => {
  it('xt_xjll_sz / xt_pzsh_sz 映射到 enable_cash_flow / require_audit', () => {
    expect(
      deriveAcdBusinessParams(new Map([['xt_xjll_sz', '1'], ['xt_pzsh_sz', '0']]))
    ).toEqual({ enable_cash_flow: 'true', require_audit: 'false' })
  })

  it('键不存在时不返回，交给默认值', () => {
    expect(deriveAcdBusinessParams(new Map())).toEqual({})
    expect(deriveAcdBusinessParams(new Map([['xt_pzsh_sz', '1']]))).toEqual({ require_audit: 'true' })
  })
})

describe('buildAuxTypes（accounts.aux_types 按系统口径生成）', () => {
  const categoryIdByCode = new Map([
    ['customer', 'cat-customer'],
    ['dept', 'cat-dept'],
    ['person', 'cat-person'],
    ['project', 'cat-project'],
  ])

  it('输出以类目 ID 为键的 JSON（值为默认项目 null），而不是 code 串', () => {
    const json = buildAuxTypes({ isCustomerAux: true }, categoryIdByCode)
    expect(JSON.parse(json!)).toEqual({ 'cat-customer': null })
  })

  it('往来（wls）与单位（dws）合并到 customer 类目；多个类目同时输出', () => {
    const json = buildAuxTypes(
      { isSupplierAux: true, isDeptAux: true, isPersonAux: true, isProjectAux: true },
      categoryIdByCode
    )
    expect(JSON.parse(json!)).toEqual({
      'cat-customer': null,
      'cat-dept': null,
      'cat-person': null,
      'cat-project': null,
    })
  })

  it('无辅助标志或类目不存在时返回 null', () => {
    expect(buildAuxTypes({}, categoryIdByCode)).toBeNull()
    expect(buildAuxTypes({ isDeptAux: true }, new Map())).toBeNull()
  })
})
