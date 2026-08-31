export type AcdKmbmRow = string[]

/**
 * ACD kmbm 表字段（见 rhsj/data_stru.txt Create table kmbm）
 * 0 kmbm, 1 km_mc, 2 kmjs, 3 kmsx, 4 zhlb, 5 fbs, 6 sls, 7 bz, 8 dw,
 * 9 xms, 10 dws, 11 bms, 12 grs, 13 wls, 14 yjd, 15 yefx, 16 kmqc, ...
 * 21 sybz, 22 xjs（现金类科目）, ...
 */
export type ParsedKmbmRow = {
  code: string
  name: string
  level: number
  direction: 'debit' | 'credit'
  isProjectAux: boolean
  isCustomerAux: boolean
  isDeptAux: boolean
  isPersonAux: boolean
  isSupplierAux: boolean
  /** xjs=1：现金类科目，凭证需指定现金流量项目 */
  isCashFlow: boolean
  isCash: boolean
  isBank: boolean
}

export function mapDirectionFromYefx(yefx: string | undefined, accountCode: string): 'debit' | 'credit' {
  const value = (yefx || '').trim()
  if (value === '0') return 'debit'
  if (value === '1') return 'credit'

  const code = accountCode.replace(/\./g, '')
  if (code.startsWith('2') || code.startsWith('3') || code.startsWith('4') || code.startsWith('6') || code.startsWith('8')) {
    return 'credit'
  }
  return 'debit'
}

/** 在 xjs=1 时按科目编码/名称区分库存现金与银行存款 */
export function resolveCashBankFlags(
  code: string,
  name: string,
  isCashClass: boolean
): { isCash: boolean; isBank: boolean } {
  if (!isCashClass) {
    return { isCash: false, isBank: false }
  }

  const normalized = code.replace(/\./g, '').trim()
  const label = name.trim()

  if (normalized.startsWith('1001') || label.includes('库存现金')) {
    return { isCash: true, isBank: false }
  }

  if (
    normalized.startsWith('1002') ||
    normalized.startsWith('1012') ||
    normalized.startsWith('1021') ||
    normalized.startsWith('1015') ||
    label.includes('银行存款') ||
    label.includes('其他货币资金')
  ) {
    return { isCash: false, isBank: true }
  }

  // xjs=1 但未识别为典型现金/银行编码时，不强行打标签
  return { isCash: false, isBank: false }
}

export function parseKmbmRow(row: AcdKmbmRow): ParsedKmbmRow | null {
  const code = (row[0] || '').trim()
  const name = (row[1] || row[16] || '').trim()
  const level = Number.parseInt((row[2] || '0').trim(), 10)

  if (!code || !name || level <= 0) {
    return null
  }

  const isCashClass = (row[22] || '0').trim() === '1'
  const { isCash, isBank } = resolveCashBankFlags(code, name, isCashClass)

  return {
    code,
    name,
    level,
    direction: mapDirectionFromYefx(row[15], code),
    isProjectAux: (row[9] || '0').trim() === '1',
    isCustomerAux: (row[10] || '0').trim() === '1',
    isDeptAux: (row[11] || '0').trim() === '1',
    isPersonAux: (row[12] || '0').trim() === '1',
    isSupplierAux: (row[13] || '0').trim() === '1',
    isCashFlow: isCashClass,
    isCash,
    isBank,
  }
}
