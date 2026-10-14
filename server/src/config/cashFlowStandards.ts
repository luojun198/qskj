/**
 * 现金流量表准则档案：不同会计准则的报表项目、活动名称、科目大类划分与科目对应规则
 *
 * 依据：
 *  - 企业会计准则：《企业会计准则第31号——现金流量表》及一般企业财务报表格式（含补充资料）
 *  - 小企业会计准则：会小企03表（只有直接法主表，无补充资料）
 *  - 政府会计制度：会政财04表（日常 / 投资 / 筹资活动，直接法，无补充资料）
 *  - 民间非营利组织会计制度：现金流量表（业务 / 投资 / 筹资活动，直接法）
 *  - 其他（合作社、村集体、工会等）：generic，按科目名称通用规则兜底
 *
 * 项目编码布局与对应准则 ACD 模板的 xjll_xm 一致（报表模板里的 @xj_je 引用的就是这些编码），
 * 只是账套里缺项或空白建账时用来补建；已有项目按名称语义匹配，不改编码。
 */
import {
  ACCOUNT_CASH_FLOW_RULES,
  CATEGORY_FALLBACK_RULES,
  type AccountCashFlowRule,
  type MainSlot,
} from './cashFlowAccountDefaults.js'

export type CashFlowStandardKey = 'enterprise' | 'small_business' | 'government' | 'npo' | 'generic'
export type AccountTab = 'asset' | 'liability' | 'common' | 'equity' | 'cost' | 'pl'
export type FallbackKey = keyof typeof CATEGORY_FALLBACK_RULES

export interface AccountClass {
  tab: AccountTab | null
  /** 界面显示的科目类别：流动资产 / 非流动资产 / 流动负债 … */
  label: string
  fallbackKey: FallbackKey | null
  /** 损益类（收入 / 费用）：附表符号相反（借方加回），并计入净利润 */
  isProfitLoss: boolean
}

export interface ProfileItem {
  code: string
  name: string
  direction: 'inflow' | 'outflow' | 'neutral'
  /** 对应的语义槽位；null = 现金内部流转 / 汇率影响等中性项目 */
  slot: MainSlot | null
}

export interface CashFlowStandardProfile {
  key: CashFlowStandardKey
  name: string
  activityLabels: { operating: string; investing: string; financing: string }
  /** 是否编制补充资料（间接法） */
  hasSupplement: boolean
  /** 本准则的科目大类页签 */
  tabs: Array<{ key: AccountTab; label: string }>
  items: ProfileItem[]
  /** 准则专用规则（优先于通用规则） */
  rules: AccountCashFlowRule[]
  /** code = 科目编码，topName = 一级科目名称 */
  classify: (code: string, topName: string) => AccountClass
}

const R = (
  keywords: string[],
  mc: MainSlot | null,
  md: MainSlot | null,
  extra: Partial<AccountCashFlowRule> = {}
): AccountCashFlowRule => ({ keywords, mc, md, sc: null, sd: null, ...extra })

const I = (code: string, name: string, slot: MainSlot | null, direction?: ProfileItem['direction']): ProfileItem => ({
  code,
  name,
  slot,
  direction: direction || (slot === null ? 'neutral' : /^\d[1]/.test(code) ? 'inflow' : 'outflow'),
})

const NONE: AccountClass = { tab: null, label: '', fallbackKey: null, isProfitLoss: false }

function digits(code: string) {
  return String(code || '').replace(/\D/g, '')
}

/** 1 资产、2 负债：按前两位切流动 / 非流动 */
function classifyAssetLiability(code: string, liabilityCurrentBelow: number): AccountClass | null {
  const c = digits(code)
  const head = c.charAt(0)
  const two = Number(c.slice(0, 2)) || 0
  if (head === '1') {
    const current = two < 15
    return { tab: 'asset', label: current ? '流动资产' : '非流动资产', fallbackKey: current ? 'current_asset' : 'non_current_asset', isProfitLoss: false }
  }
  if (head === '2') {
    const current = two < liabilityCurrentBelow
    return { tab: 'liability', label: current ? '流动负债' : '非流动负债', fallbackKey: current ? 'current_liability' : 'non_current_liability', isProfitLoss: false }
  }
  return null
}

const equity = (label: string): AccountClass => ({ tab: 'equity', label, fallbackKey: 'equity', isProfitLoss: false })
const cost: AccountClass = { tab: 'cost', label: '成本', fallbackKey: 'cost', isProfitLoss: false }
const pl = (label: string): AccountClass => ({ tab: 'pl', label, fallbackKey: 'pl', isProfitLoss: true })

// ───────────────────────── 企业会计准则 ─────────────────────────
const ENTERPRISE: CashFlowStandardProfile = {
  key: 'enterprise',
  name: '企业会计准则',
  activityLabels: { operating: '经营活动', investing: '投资活动', financing: '筹资活动' },
  hasSupplement: true,
  tabs: [
    { key: 'asset', label: '资产' },
    { key: 'liability', label: '负债' },
    { key: 'common', label: '共同' },
    { key: 'equity', label: '权益' },
    { key: 'cost', label: '成本' },
    { key: 'pl', label: '损益' },
  ],
  // 润衡新企业会计准则模板编码（3202 分配利润、3203 偿付利息在报表上合并为一行）
  items: [
    I('1000', '现金科目内部流转', null),
    I('1101', '销售商品、提供劳务收到的现金', 'op_in_sales'),
    I('1102', '收到的税费返还', 'op_in_tax_refund'),
    I('1103', '收到其他与经营活动有关的现金', 'op_in_other'),
    I('1201', '购买商品、接受劳务支付的现金', 'op_out_purchase'),
    I('1202', '支付给职工以及为职工支付的现金', 'op_out_staff'),
    I('1203', '支付的各项税费', 'op_out_tax'),
    I('1204', '支付其他与经营活动有关的现金', 'op_out_other'),
    I('2101', '收回投资收到的现金', 'inv_in_recover'),
    I('2102', '取得投资收益收到的现金', 'inv_in_income'),
    I('2103', '处置固定资产、无形资产和其他长期资产收回的现金净额', 'inv_in_dispose'),
    I('2104', '收到其他与投资活动有关的现金', 'inv_in_other'),
    I('2105', '处置子公司及其他营业单位收到的现金净额', null, 'inflow'),
    I('2201', '购建固定资产、无形资产和其他长期资产支付的现金', 'inv_out_build'),
    I('2202', '投资支付的现金', 'inv_out_invest'),
    I('2203', '支付其他与投资活动有关的现金', 'inv_out_other'),
    I('2204', '取得子公司及其他营业单位支付的现金净额', null, 'outflow'),
    I('3101', '吸收投资收到的现金', 'fin_in_invest'),
    I('3102', '取得借款收到的现金', 'fin_in_borrow'),
    I('3103', '收到其他与筹资活动有关的现金', 'fin_in_other'),
    I('3201', '偿还债务支付的现金', 'fin_out_repay'),
    I('3202', '分配股利、利润支付的现金', 'fin_out_dividend'),
    I('3203', '偿付利息支付的现金', 'fin_out_interest'),
    I('3204', '支付其他与筹资活动有关的现金', 'fin_out_other'),
    I('4101', '汇率变动对现金及现金等价物的影响', null),
  ],
  rules: [],
  classify(code) {
    const al = classifyAssetLiability(code, 24)
    if (al) return al
    const head = digits(code).charAt(0)
    if (head === '3') return { tab: 'common', label: '共同', fallbackKey: 'common', isProfitLoss: false }
    if (head === '4') return equity('所有者权益')
    if (head === '5') return cost
    if (head === '6') return pl('损益')
    return NONE
  },
}

// ───────────────────────── 小企业会计准则（会小企03表） ─────────────────────────
const SMALL_BUSINESS: CashFlowStandardProfile = {
  key: 'small_business',
  name: '小企业会计准则',
  activityLabels: { operating: '经营活动', investing: '投资活动', financing: '筹资活动' },
  hasSupplement: false,
  tabs: [
    { key: 'asset', label: '资产' },
    { key: 'liability', label: '负债' },
    { key: 'equity', label: '所有者权益' },
    { key: 'cost', label: '成本' },
    { key: 'pl', label: '损益' },
  ],
  // 润衡小企业会计准则模板编码（注意 2201 投资付现 / 2202 购建、3101 借款 / 3102 吸收投资）
  items: [
    I('1000', '现金科目内部流转', null),
    I('1101', '销售产成品、商品、提供劳务收到的现金', 'op_in_sales'),
    I('1102', '收到其他与经营活动有关的现金', 'op_in_other'),
    I('1201', '购买原材料、商品、接受劳务支付的现金', 'op_out_purchase'),
    I('1202', '支付的职工薪酬', 'op_out_staff'),
    I('1203', '支付的税费', 'op_out_tax'),
    I('1204', '支付其他与经营活动有关的现金', 'op_out_other'),
    I('2101', '收回短期投资、长期债券投资和长期股权投资收到的现金', 'inv_in_recover'),
    I('2102', '取得投资收益收到的现金', 'inv_in_income'),
    I('2103', '处置固定资产、无形资产和其他非流动资产收回的现金净额', 'inv_in_dispose'),
    I('2201', '短期投资、长期债券投资和长期股权投资支付的现金', 'inv_out_invest'),
    I('2202', '购建固定资产、无形资产和其他非流动资产支付的现金', 'inv_out_build'),
    I('3101', '取得借款收到的现金', 'fin_in_borrow'),
    I('3102', '吸收投资者投资收到的现金', 'fin_in_invest'),
    I('3201', '偿还借款本金支付的现金', 'fin_out_repay'),
    I('3202', '偿还借款利息支付的现金', 'fin_out_interest'),
    I('3203', '分配利润支付的现金', 'fin_out_dividend'),
  ],
  rules: [
    // 小企业报表没有「其他投资 / 筹资活动」行：长期应收款、待处理财产损溢等落到处置 / 购建
    R(['未实现融资收益'], 'inv_in_dispose', 'inv_out_build'),
    R(['递延收益'], 'op_in_other', 'op_out_other'),
  ],
  classify(code) {
    const al = classifyAssetLiability(code, 24)
    if (al) return al
    const head = digits(code).charAt(0)
    if (head === '3') return equity('所有者权益')
    if (head === '4') return cost
    if (head === '5') return pl('损益')
    return NONE
  },
}

// ───────────────────────── 政府会计制度（会政财04表） ─────────────────────────
const GOVERNMENT: CashFlowStandardProfile = {
  key: 'government',
  name: '政府会计制度',
  activityLabels: { operating: '日常活动', investing: '投资活动', financing: '筹资活动' },
  hasSupplement: false,
  tabs: [
    { key: 'asset', label: '资产' },
    { key: 'liability', label: '负债' },
    { key: 'equity', label: '净资产' },
    { key: 'pl', label: '收入费用' },
  ],
  // 润衡行政事业单位模板编码；模板缺 1204，报表却引用了它，这里补上「支付的各项税费」
  items: [
    I('1000', '现金科目内部流转', null),
    I('1101', '财政基本支出拨款收到的现金', 'gov_in_basic'),
    I('1102', '财政非资本性项目拨款收到的现金', 'gov_in_project'),
    I('1103', '事业活动收到的除财政拨款以外的现金', 'gov_in_business'),
    I('1104', '收到的其他与日常活动有关的现金', 'op_in_other'),
    I('1201', '购买商品、接受劳务支付的现金', 'op_out_purchase'),
    I('1202', '支付给职工以及为职工支付的现金', 'op_out_staff'),
    I('1203', '支付的其他与日常活动有关的现金', 'op_out_other'),
    I('1204', '支付的各项税费', 'op_out_tax'),
    I('2101', '收回投资收到的现金', 'inv_in_recover'),
    I('2102', '取得投资收益收到的现金', 'inv_in_income'),
    I('2103', '处置固定资产、无形资产、公共基础设施等收回的现金净额', 'inv_in_dispose'),
    I('2104', '收到的其他与投资活动有关的现金', 'inv_in_other'),
    I('2201', '购建固定资产、无形资产、公共基础设施等支付的现金', 'inv_out_build'),
    I('2202', '对外投资支付的现金', 'inv_out_invest'),
    I('2203', '上缴处置固定资产、无形资产、公共基础设施等净收入支付的现金', 'gov_inv_out_remit'),
    I('2204', '支付的其他与投资活动有关的现金', 'inv_out_other'),
    I('3101', '财政资本性项目拨款收到的现金', 'gov_fin_in_capital'),
    I('3102', '取得借款收到的现金', 'fin_in_borrow'),
    I('3103', '收到的其他与筹资活动有关的现金', 'fin_in_other'),
    I('3201', '偿还借款支付的现金', 'fin_out_repay'),
    I('3202', '偿还利息支付的现金', 'fin_out_interest'),
    I('3203', '支付的其他与筹资活动有关的现金', 'fin_out_other'),
    I('4101', '汇率变动对现金的影响额', null),
  ],
  rules: [
    // 财政拨款收入的下级：资本性项目 → 筹资；其他项目 → 非资本性项目拨款
    R(['资本性'], 'gov_fin_in_capital', 'gov_fin_in_capital', { anyLevel: true, underTop: ['财政拨款收入'], exclude: ['非资本性'] }),
    R(['项目'], 'gov_in_project', 'gov_in_project', { anyLevel: true, underTop: ['财政拨款收入'] }),
    R(['财政拨款收入', '财政应返还额度'], 'gov_in_basic', 'gov_in_basic', { exclude: ['非同级'] }),
    R(['事业收入', '经营收入', '应收账款', '应收票据', '预收账款'], 'gov_in_business', 'gov_in_business'),
    R(['上级补助收入', '附属单位上缴收入', '非同级财政拨款收入', '捐赠收入', '利息收入', '租金收入', '其他收入'], 'op_in_other', 'op_out_other'),
    R(['业务活动费用', '单位管理费用', '经营费用', '库存物品', '加工物品', '在途物品', '预付账款', '应付账款', '应付票据', '应付政府补贴款'], 'op_out_purchase', 'op_out_purchase'),
    R(['上缴上级费用', '对附属单位补助费用', '资产处置费用', '其他费用', '应缴财政款'], 'op_in_other', 'op_out_other'),
    R(['所得税费用', '应交增值税', '其他应交税费'], 'op_out_tax', 'op_out_tax'),
    R(['利息费用'], 'fin_out_interest', 'fin_out_interest'),
    R(['受托代理资产', '受托代理负债', '预计负债'], 'op_in_other', 'op_out_other'),
    // 净资产类不归「吸收投资」，记其他日常活动
    R(['累计盈余', '专用基金', '权益法调整', '本期盈余', '本年盈余分配', '无偿调拨净资产', '以前年度盈余调整'], 'op_in_other', 'op_out_other'),
  ],
  classify(code) {
    const al = classifyAssetLiability(code, 25)
    if (al) return al
    const head = digits(code).charAt(0)
    if (head === '3') return equity('净资产')
    if (head === '4') return pl('收入')
    if (head === '5') return pl('费用')
    return NONE // 6~8 预算会计（平行记账）不参与现金流量
  },
}

// ───────────────────────── 民间非营利组织会计制度 ─────────────────────────
const NPO: CashFlowStandardProfile = {
  key: 'npo',
  name: '民间非营利组织会计制度',
  activityLabels: { operating: '业务活动', investing: '投资活动', financing: '筹资活动' },
  hasSupplement: false,
  tabs: [
    { key: 'asset', label: '资产' },
    { key: 'liability', label: '负债' },
    { key: 'equity', label: '净资产' },
    { key: 'pl', label: '收入费用' },
  ],
  // 润衡民间非营利组织会计准则(2026)模板编码
  items: [
    I('1000', '现金科目内部流转', null),
    I('1101', '接受捐赠收到的现金', 'npo_in_donation'),
    I('1102', '收取会费收到的现金', 'npo_in_dues'),
    I('1103', '提供服务收到的现金', 'npo_in_service'),
    I('1104', '销售商品收到的现金', 'op_in_sales'),
    I('1105', '政府补助收到的现金', 'npo_in_grant'),
    I('1106', '收到的其他与业务活动有关的现金', 'op_in_other'),
    I('1201', '提供捐赠或者资助支付的现金', 'npo_out_donation'),
    I('1202', '支付给员工以及为员工支付的现金', 'op_out_staff'),
    I('1203', '购买商品、接受服务支付的现金', 'op_out_purchase'),
    I('1204', '支付的其他与业务活动有关的现金', 'op_out_other'),
    I('1205', '支付的各项税费', 'op_out_tax'),
    I('2101', '收回投资所收到的现金', 'inv_in_recover'),
    I('2102', '取得投资收益所收到的现金', 'inv_in_income'),
    I('2103', '处置固定资产和无形资产所收回的现金', 'inv_in_dispose'),
    I('2104', '收到的其他与投资活动有关的现金', 'inv_in_other'),
    I('2201', '购建固定资产和无形资产所支付的现金', 'inv_out_build'),
    I('2202', '对外投资所支付的现金', 'inv_out_invest'),
    I('2203', '支付的其他与投资活动有关的现金', 'inv_out_other'),
    I('3101', '借款所收到的现金', 'fin_in_borrow'),
    I('3102', '收到的其他与筹资活动有关的现金', 'fin_in_other'),
    I('3201', '偿还借款所支付的现金', 'fin_out_repay'),
    I('3202', '偿付利息所支付的现金', 'fin_out_interest'),
    I('3203', '支付的其他与筹资活动有关的现金', 'fin_out_other'),
    I('4101', '汇率变动对现金的影响额', null),
  ],
  rules: [
    // 业务活动成本下的捐赠 / 资助明细 → 提供捐赠或者资助
    R(['捐赠', '资助'], 'op_in_other', 'npo_out_donation', { anyLevel: true, underTop: ['业务活动成本'] }),
    R(['捐赠收入'], 'npo_in_donation', 'npo_in_donation'),
    R(['会费收入'], 'npo_in_dues', 'npo_in_dues'),
    R(['提供服务收入'], 'npo_in_service', 'npo_in_service'),
    R(['商品销售收入'], 'op_in_sales', 'op_in_sales'),
    R(['政府补助收入'], 'npo_in_grant', 'npo_in_grant'),
    R(['业务活动成本', '存货'], 'op_in_other', 'op_out_purchase'),
    R(['筹资费用'], 'fin_out_interest', 'fin_out_interest'),
    R(['管理费用', '其他费用', '其他收入', '受托代理资产', '受托代理负债', '非限定性净资产', '限定性净资产'], 'op_in_other', 'op_out_other'),
  ],
  classify(code) {
    const al = classifyAssetLiability(code, 25)
    if (al) return al
    const head = digits(code).charAt(0)
    if (head === '3') return equity('净资产')
    if (head === '4') return pl('收入')
    if (head === '5') return pl('费用')
    return NONE
  },
}

// ───────────────────────── 通用（合作社、村集体、工会、个体户等） ─────────────────────────
const EQUITY_WORDS = /实收资本|股本|股金|资本公积|盈余公积|公积公益金|本年利润|本年收益|本年盈余|收益分配|利润分配|盈余分配|净资产|基金|累计盈余|所有者权益|权益/
const COST_WORDS = /生产成本|制造费用|劳务成本|研发支出|工程施工|机械作业|生产（劳务）成本/
const PL_WORDS = /收入|收益|支出|费用|成本|损失|损益|所得税|补助/

const GENERIC: CashFlowStandardProfile = {
  key: 'generic',
  name: '其他会计制度（通用规则）',
  activityLabels: { operating: '经营活动', investing: '投资活动', financing: '筹资活动' },
  hasSupplement: false,
  tabs: [
    { key: 'asset', label: '资产' },
    { key: 'liability', label: '负债' },
    { key: 'equity', label: '权益' },
    { key: 'cost', label: '成本' },
    { key: 'pl', label: '收支损益' },
  ],
  items: ENTERPRISE.items,
  rules: [
    R([], 'op_in_sales', 'op_in_sales', { exact: ['应收款'] }),
    R([], 'op_out_purchase', 'op_out_purchase', { exact: ['应付款'] }),
    R(['产品物资', '应付劳务费'], 'op_out_purchase', 'op_out_purchase'),
    R(['应付税费', '税金'], 'op_out_tax', 'op_out_tax'),
    R(['股金'], 'fin_in_invest', 'fin_in_invest'),
    R(['盈余返还', '剩余盈余', '应付盈余', '应付利润', '应付股利', '收益分配', '盈余分配'], 'fin_out_dividend', 'fin_out_dividend'),
    R(['经营收入', '业务收入', '发包及上交收入', '销售收入'], 'op_in_sales', 'op_in_sales'),
    R(['经营支出', '经营成本', '业务支出', '事业支出', '销售成本'], 'op_out_purchase', 'op_out_purchase'),
    R(['补助收入', '其他收入', '其他支出', '公益支出', '管理费用', '会费收入', '拨缴经费'], 'op_in_other', 'op_out_other'),
    R(['公积公益金', '本年收益', '本年盈余', '基金'], 'fin_in_invest', 'fin_in_invest'),
  ],
  classify(code, topName) {
    const al = classifyAssetLiability(code, 24)
    if (al) return al
    const name = String(topName || '')
    if (COST_WORDS.test(name)) return cost
    if (EQUITY_WORDS.test(name)) return equity('权益')
    if (PL_WORDS.test(name)) return pl('收支损益')
    const head = digits(code).charAt(0)
    if (head === '3') return equity('权益')
    if (head === '4' || head === '5' || head === '6') return pl('收支损益')
    return NONE
  },
}

export const CASH_FLOW_PROFILES: Record<CashFlowStandardKey, CashFlowStandardProfile> = {
  enterprise: ENTERPRISE,
  small_business: SMALL_BUSINESS,
  government: GOVERNMENT,
  npo: NPO,
  generic: GENERIC,
}

/** 准则专用规则在前，通用规则在后 */
export function profileRules(profile: CashFlowStandardProfile): AccountCashFlowRule[] {
  return [...profile.rules, ...ACCOUNT_CASH_FLOW_RULES]
}
