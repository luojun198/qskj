/**
 * 应交税金(增值税)明细账的固定栏目定义。
 *
 * 借方 4 栏 + 贷方 4 栏，与传统多栏式增值税明细账一致。每栏对应一个「应交增值税」下的末级科目，
 * 科目编码因科目表不同而异（企业准则 22210101、润衡 2221001001、行政事业 2101.01.01），
 * 所以这里只给探测用的候选编码与名称，真正落到哪个科目由 vatLedgerQuery.resolveVatColumns 决定。
 */
export type VatColumnSide = 'debit' | 'credit'

export interface VatColumnSpec {
  key: string
  /** 项目名称（设置弹窗第一列） */
  label: string
  side: VatColumnSide
  /** 默认打印中文名 */
  printName: string
  /** 默认打印英文名 */
  printNameEn: string
  /** 按优先级尝试的候选编码 */
  codes: string[]
  /** 编码落空时按名称探测：先整名相等，再包含匹配 */
  names: string[]
  /** 包含匹配时排除的名称片段 */
  excludes?: string[]
}

export const VAT_LEDGER_PARAM_KEY = 'ledger:vat_column_map'

export const VAT_COLUMN_SPECS: VatColumnSpec[] = [
  {
    key: 'input_tax',
    label: '进项税额',
    side: 'debit',
    printName: '进项税额',
    printNameEn: 'INPUT TAXES',
    codes: ['22210101', '2221001001', '2101.01.01', '22210001'],
    names: ['进项税额'],
    excludes: ['转出', '待认证', '待抵扣'],
  },
  {
    key: 'tax_paid',
    label: '已交税金',
    side: 'debit',
    printName: '已交税金',
    printNameEn: 'TAXES-PAID',
    codes: ['22210102', '2221001002', '2101.01.02', '22210002'],
    names: ['已交税金', '已交增值税', '已交税费'],
  },
  {
    key: 'unpaid_transfer',
    label: '转出未交增值税',
    side: 'debit',
    printName: '转出未交增值税',
    printNameEn: 'TRANSMIT. VAT PAYABLE',
    codes: ['22210103', '2221001003', '2101.01.03', '22210003'],
    names: ['转出未交增值税'],
  },
  {
    key: 'exemption',
    label: '减免税款',
    side: 'debit',
    printName: '减免税款',
    printNameEn: 'REDUCTION AND EXEMPTION TAXES',
    codes: ['22210104', '2221001004', '2101.01.04', '22210004'],
    names: ['减免税款', '减免税额'],
  },
  {
    key: 'output_tax',
    label: '销项税额',
    side: 'credit',
    printName: '销项税额',
    printNameEn: 'OUTPUT TAXES',
    codes: ['22210105', '2221001005', '2101.01.05', '22210005'],
    names: ['销项税额'],
    excludes: ['转出', '待转'],
  },
  {
    key: 'export_refund',
    label: '出口退税',
    side: 'credit',
    printName: '出口退税',
    printNameEn: 'TAX REFUND OF EXPORT',
    codes: ['22210106', '2221001006', '2101.01.06', '22210006'],
    names: ['出口退税'],
  },
  {
    key: 'input_transfer',
    label: '进项税额转出',
    side: 'credit',
    printName: '进项税额转出',
    printNameEn: 'INPUT TAX TRANSMIT',
    codes: ['22210107', '2221001007', '2101.01.07', '22210007'],
    names: ['进项税额转出', '进项税转出'],
  },
  {
    key: 'overpaid_transfer',
    label: '转出多交增值税',
    side: 'credit',
    printName: '转出多交增值税',
    printNameEn: 'TRANSMIT. VAT OVERPAID',
    codes: ['22210109', '2221001009', '22210108', '2221001008', '2101.01.08', '22210008'],
    names: ['转出多交增值税'],
  },
]

/** 「应交增值税」父科目候选，用于科目全称展示与余额兜底 */
export const VAT_PARENT_CODES = ['222101', '2221001', '2101.01', '2221']
export const VAT_PARENT_NAMES = ['应交增值税']
