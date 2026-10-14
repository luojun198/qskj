/**
 * 科目现金流量项目：默认映射规则
 *
 * 每个科目设 4 个项目——
 *  - 主表 贷方（现金流入）：凭证里现金类科目收钱、本科目在贷方时，收入的钱记到哪个主表项目
 *  - 主表 借方（现金流出）：现金类科目付钱、本科目在借方时，付出的钱记到哪个主表项目
 *  - 附表 贷方 / 借方：补充资料（间接法）里，本科目贷方 / 借方发生额调节到哪一行
 *
 * 各账套的主表项目名称五花八门（ACD 模板：「销售劳务收现」「购货劳务付现」…；
 * 标准名称：「销售商品、提供劳务收到的现金」…），所以规则里写的是「语义槽位」，
 * 落库时由 resolveMainSlot 按 活动类别 + 流向 + 关键字 匹配到本账套具体项目编码。
 */

/** 主表语义槽位 */
export type MainSlot =
  | 'op_in_sales' // 销售商品、提供劳务收到的现金
  | 'op_in_tax_refund' // 收到的税费返还
  | 'op_in_other' // 收到其他与经营活动有关的现金
  | 'op_out_purchase' // 购买商品、接受劳务支付的现金
  | 'op_out_staff' // 支付给职工以及为职工支付的现金
  | 'op_out_tax' // 支付的各项税费
  | 'op_out_other' // 支付其他与经营活动有关的现金
  | 'inv_in_recover' // 收回投资收到的现金
  | 'inv_in_income' // 取得投资收益收到的现金
  | 'inv_in_dispose' // 处置固定资产、无形资产和其他长期资产收回的现金净额
  | 'inv_in_other' // 收到其他与投资活动有关的现金
  | 'inv_out_build' // 购建固定资产、无形资产和其他长期资产支付的现金
  | 'inv_out_invest' // 投资支付的现金
  | 'inv_out_other' // 支付其他与投资活动有关的现金
  | 'fin_in_invest' // 吸收投资收到的现金
  | 'fin_in_borrow' // 取得借款收到的现金
  | 'fin_in_other' // 收到其他与筹资活动有关的现金
  | 'fin_out_repay' // 偿还债务支付的现金
  | 'fin_out_dividend' // 分配股利、利润或偿付利息支付的现金
  | 'fin_out_interest' // 偿付利息支付的现金（小企业「偿还借款利息」、政府「偿还利息」、润衡模板 3203）
  // ── 政府会计制度（会政财04表）──
  | 'gov_in_basic' // 财政基本支出拨款收到的现金
  | 'gov_in_project' // 财政非资本性项目拨款收到的现金
  | 'gov_in_business' // 事业活动收到的除财政拨款以外的现金
  | 'gov_fin_in_capital' // 财政资本性项目拨款收到的现金（筹资）
  | 'gov_inv_out_remit' // 上缴处置固定资产、无形资产、公共基础设施等净收入支付的现金
  // ── 民间非营利组织（业务活动）──
  | 'npo_in_donation' // 接受捐赠收到的现金
  | 'npo_in_dues' // 收取会费收到的现金
  | 'npo_in_service' // 提供服务收到的现金
  | 'npo_in_grant' // 政府补助收到的现金
  | 'npo_out_donation' // 提供捐赠或者资助支付的现金
  | 'fin_out_other' // 支付其他与筹资活动有关的现金

export type CashFlowActivity = 'operating' | 'investing' | 'financing'
export type CashFlowFlow = 'in' | 'out'

export interface MainSlotDef {
  activity: CashFlowActivity
  flow: CashFlowFlow
  /** 标准名称（本账套没有可匹配项目时补建用） */
  name: string
  /** 名称关键字：任一命中即算（按顺序优先） */
  keywords: string[]
  /** 名称里出现即排除（避免「偿还借款利息」被当成偿还本金） */
  exclude?: string[]
  /** 找不到时依次尝试的备选槽位 */
  fallback?: MainSlot[]
}

export const MAIN_SLOTS: Record<MainSlot, MainSlotDef> = {
  op_in_sales: { activity: 'operating', flow: 'in', name: '销售商品、提供劳务收到的现金', keywords: ['销售', '劳务'], fallback: ['op_in_other'] },
  op_in_tax_refund: { activity: 'operating', flow: 'in', name: '收到的税费返还', keywords: ['税费返还', '返还'], fallback: ['op_in_other'] },
  op_in_other: { activity: 'operating', flow: 'in', name: '收到其他与经营活动有关的现金', keywords: ['其他'] },
  op_out_purchase: { activity: 'operating', flow: 'out', name: '购买商品、接受劳务支付的现金', keywords: ['购买商品', '购货', '购买', '商品'], fallback: ['op_out_other'] },
  op_out_staff: { activity: 'operating', flow: 'out', name: '支付给职工以及为职工支付的现金', keywords: ['职工', '员工', '工资'], fallback: ['op_out_other'] },
  op_out_tax: { activity: 'operating', flow: 'out', name: '支付的各项税费', keywords: ['税费', '税'], fallback: ['op_out_other'] },
  op_out_other: { activity: 'operating', flow: 'out', name: '支付其他与经营活动有关的现金', keywords: ['其他'] },
  inv_in_recover: { activity: 'investing', flow: 'in', name: '收回投资收到的现金', keywords: ['收回投资', '收回'], fallback: ['inv_in_other'] },
  inv_in_income: { activity: 'investing', flow: 'in', name: '取得投资收益收到的现金', keywords: ['投资收益', '收益'], fallback: ['inv_in_other'] },
  inv_in_dispose: { activity: 'investing', flow: 'in', name: '处置固定资产、无形资产和其他长期资产收回的现金净额', keywords: ['处置固定资产', '处置资产', '处置'], exclude: ['子公司', '上缴'], fallback: ['inv_in_other'] },
  inv_in_other: { activity: 'investing', flow: 'in', name: '收到其他与投资活动有关的现金', keywords: ['其他'] },
  inv_out_build: { activity: 'investing', flow: 'out', name: '购建固定资产、无形资产和其他长期资产支付的现金', keywords: ['购建', '购置'], fallback: ['inv_out_other'] },
  inv_out_invest: { activity: 'investing', flow: 'out', name: '投资支付的现金', keywords: ['投资支付', '投资付现', '对外投资', '投资'], exclude: ['子公司'], fallback: ['inv_out_other'] },
  inv_out_other: { activity: 'investing', flow: 'out', name: '支付其他与投资活动有关的现金', keywords: ['其他'] },
  fin_in_invest: { activity: 'financing', flow: 'in', name: '吸收投资收到的现金', keywords: ['吸收投资', '投资'], fallback: ['fin_in_other'] },
  fin_in_borrow: { activity: 'financing', flow: 'in', name: '取得借款收到的现金', keywords: ['借款'], fallback: ['fin_in_other'] },
  fin_in_other: { activity: 'financing', flow: 'in', name: '收到其他与筹资活动有关的现金', keywords: ['其他'] },
  fin_out_repay: { activity: 'financing', flow: 'out', name: '偿还债务支付的现金', keywords: ['偿还债务', '偿还借款本金', '偿还借款', '偿还'], exclude: ['利息'], fallback: ['fin_out_other'] },
  fin_out_dividend: { activity: 'financing', flow: 'out', name: '分配股利、利润或偿付利息支付的现金', keywords: ['分配', '股利', '利润'], fallback: ['fin_out_other'] },
  fin_out_interest: { activity: 'financing', flow: 'out', name: '偿付利息支付的现金', keywords: ['偿付利息', '偿还利息', '借款利息', '利息'], fallback: ['fin_out_dividend'] },
  gov_in_basic: { activity: 'operating', flow: 'in', name: '财政基本支出拨款收到的现金', keywords: ['基本支出拨款', '基本支出'], fallback: ['op_in_other'] },
  gov_in_project: { activity: 'operating', flow: 'in', name: '财政非资本性项目拨款收到的现金', keywords: ['非资本性项目', '项目拨款'], fallback: ['gov_in_basic'] },
  gov_in_business: { activity: 'operating', flow: 'in', name: '事业活动收到的除财政拨款以外的现金', keywords: ['事业活动'], fallback: ['op_in_sales'] },
  gov_fin_in_capital: { activity: 'financing', flow: 'in', name: '财政资本性项目拨款收到的现金', keywords: ['资本性项目拨款', '资本性'], fallback: ['fin_in_other'] },
  gov_inv_out_remit: { activity: 'investing', flow: 'out', name: '上缴处置固定资产、无形资产、公共基础设施等净收入支付的现金', keywords: ['上缴'], fallback: ['inv_out_other'] },
  npo_in_donation: { activity: 'operating', flow: 'in', name: '接受捐赠收到的现金', keywords: ['接受捐赠', '捐赠'], fallback: ['op_in_other'] },
  npo_in_dues: { activity: 'operating', flow: 'in', name: '收取会费收到的现金', keywords: ['会费'], fallback: ['op_in_other'] },
  npo_in_service: { activity: 'operating', flow: 'in', name: '提供服务收到的现金', keywords: ['提供服务', '服务'], fallback: ['op_in_sales'] },
  npo_in_grant: { activity: 'operating', flow: 'in', name: '政府补助收到的现金', keywords: ['政府补助', '补助'], fallback: ['op_in_other'] },
  npo_out_donation: { activity: 'operating', flow: 'out', name: '提供捐赠或者资助支付的现金', keywords: ['捐赠或', '资助', '捐赠'], fallback: ['op_out_other'] },
  fin_out_other: { activity: 'financing', flow: 'out', name: '支付其他与筹资活动有关的现金', keywords: ['其他'] },
}

/**
 * 附表（补充资料·间接法）项目：编码 F01~F18，与主表编码空间隔开。
 * 只有企业会计准则有补充资料（小企业 / 政府 / 民非只编直接法主表）。
 * 数组顺序即报表行序，按《企业会计准则第31号》及最新一般企业报表格式；编码只追加不改。
 */
export const SUPPLEMENT_ITEMS: Array<{ code: string; name: string; computed?: boolean }> = [
  { code: 'F01', name: '净利润', computed: true },
  { code: 'F02', name: '加：资产减值准备' },
  { code: 'F17', name: '信用减值损失' },
  { code: 'F03', name: '固定资产折旧、油气资产折耗、生产性生物资产折旧' },
  { code: 'F18', name: '使用权资产折旧' },
  { code: 'F04', name: '无形资产摊销' },
  { code: 'F05', name: '长期待摊费用摊销' },
  { code: 'F06', name: '处置固定资产、无形资产和其他长期资产的损失（收益以“－”号填列）' },
  { code: 'F07', name: '固定资产报废损失（收益以“－”号填列）' },
  { code: 'F08', name: '公允价值变动损失（收益以“－”号填列）' },
  { code: 'F09', name: '财务费用（收益以“－”号填列）' },
  { code: 'F10', name: '投资损失（收益以“－”号填列）' },
  { code: 'F11', name: '递延所得税资产减少（增加以“－”号填列）' },
  { code: 'F12', name: '递延所得税负债增加（减少以“－”号填列）' },
  { code: 'F13', name: '存货的减少（增加以“－”号填列）' },
  { code: 'F14', name: '经营性应收项目的减少（增加以“－”号填列）' },
  { code: 'F15', name: '经营性应付项目的增加（减少以“－”号填列）' },
  { code: 'F16', name: '其他' },
]

/** 净利润行：由系统计算，不能被科目映射选中 */
export const SUPPLEMENT_NET_PROFIT_CODE = 'F01'

export const SUPP = {
  impairment: 'F02',
  depreciation: 'F03',
  intangibleAmort: 'F04',
  longTermAmort: 'F05',
  disposalLoss: 'F06',
  scrapLoss: 'F07',
  fairValueLoss: 'F08',
  financeExpense: 'F09',
  investLoss: 'F10',
  deferredTaxAsset: 'F11',
  deferredTaxLiability: 'F12',
  inventory: 'F13',
  operatingReceivable: 'F14',
  operatingPayable: 'F15',
  other: 'F16',
  creditImpairment: 'F17',
  rightOfUseDepreciation: 'F18',
} as const

/** 一条默认规则：主表贷/借 + 附表贷/借；附表留空 = 不参与间接法调节 */
export interface AccountCashFlowRule {
  /** 名称关键字（科目名称包含任一即命中） */
  keywords: string[]
  /** 名称完全相等才命中（优先于 keywords） */
  exact?: string[]
  /** 名称中出现即不命中 */
  exclude?: string[]
  /** true = 下级科目也可按自己的名称命中；默认只匹配一级科目，下级继承 */
  anyLevel?: boolean
  /** anyLevel 规则只在一级科目名称含其中之一时生效（如「财政拨款收入」下的「项目支出」） */
  underTop?: string[]
  mc: MainSlot | null
  md: MainSlot | null
  sc: string | null
  sd: string | null
}

const R = (
  keywords: string[],
  mc: MainSlot | null,
  md: MainSlot | null,
  sc: string | null,
  sd: string | null,
  extra: Partial<AccountCashFlowRule> = {}
): AccountCashFlowRule => ({ keywords, mc, md, sc, sd, ...extra })

/**
 * 规则按顺序匹配，先命中先用。下级科目规则（anyLevel）放前面。
 *
 * 附表口径（与截图参考软件的差别，均为保证间接法与主表经营活动净额一致）：
 *  - 投资 / 筹资 / 权益类科目附表留空（参考软件填「其他」，会把买卖资产、借还款计入经营活动调节）
 *  - 累计折旧 / 累计摊销 / 长期待摊费用只设贷方（借方是处置转销或新增支出，不是折旧摊销）
 *  - 财务费用主表记「分配股利、利润或偿付利息」、附表加回，二者口径对应
 */
export const ACCOUNT_CASH_FLOW_RULES: AccountCashFlowRule[] = [
  // ── 下级科目专用 ──
  R(['应交个人所得税', '个人所得税'], 'op_out_staff', 'op_out_staff', SUPP.operatingPayable, SUPP.operatingPayable, { anyLevel: true }),
  R(['进项税额转出'], 'op_out_purchase', 'op_out_purchase', SUPP.operatingPayable, SUPP.operatingPayable, { anyLevel: true }),
  R(['待转销项税额', '简易计税', '转让金融商品应交增值税'], 'op_in_sales', 'op_in_sales', SUPP.operatingPayable, SUPP.operatingPayable, { anyLevel: true }),
  R(['资本化支出'], 'inv_out_build', 'inv_out_build', null, null, { anyLevel: true }),
  R(['其他应收款坏账准备'], 'op_out_other', 'op_out_other', SUPP.creditImpairment, SUPP.creditImpairment, { anyLevel: true }),
  R(['使用权资产累计折旧'], 'inv_out_build', 'inv_in_dispose', SUPP.rightOfUseDepreciation, null),
  R(['应付退货款', '贷款承诺', '财务担保'], 'op_in_other', 'op_out_other', SUPP.operatingPayable, SUPP.operatingPayable, { anyLevel: true }),

  // ── 资产 ──
  R(['交易性金融资产', '短期投资'], 'inv_in_recover', 'inv_out_invest', null, null),
  R(['应收票据', '应收账款', '应收款项融资', '合同资产', '应收退货成本'], 'op_in_sales', 'op_in_sales', SUPP.operatingReceivable, SUPP.operatingReceivable, { exclude: ['减值', '坏账'] }),
  R(['预付账款', '预付款项'], 'op_out_purchase', 'op_out_purchase', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['应收股利', '应收利息'], 'inv_in_income', 'inv_in_income', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['其他应收款'], 'op_in_other', 'op_out_other', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['坏账准备'], 'op_in_sales', 'op_in_sales', SUPP.creditImpairment, SUPP.creditImpairment),
  R(['合同资产减值准备'], 'op_in_sales', 'op_in_sales', SUPP.impairment, SUPP.impairment),
  R(['存货跌价准备', '消耗性生物资产跌价准备'], 'op_out_purchase', 'op_out_purchase', SUPP.impairment, SUPP.impairment),
  R(['合同取得成本减值准备', '合同履约成本减值准备'], 'op_out_purchase', 'op_out_purchase', SUPP.impairment, SUPP.impairment),
  R(['受托代销商品'], 'op_in_sales', 'op_in_sales', SUPP.inventory, SUPP.inventory),
  R(
    ['材料采购', '在途物资', '原材料', '材料成本差异', '库存商品', '发出商品', '商品进销差价', '委托加工物资', '周转材料', '消耗性生物资产', '包装物', '低值易耗品', '库存物品', '加工物品'],
    'op_out_purchase',
    'op_out_purchase',
    SUPP.inventory,
    SUPP.inventory
  ),
  R(['合同取得成本', '合同履约成本'], 'op_out_purchase', 'op_out_purchase', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['合同结算'], 'op_in_sales', 'op_in_sales', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['持有待售资产减值准备'], 'inv_in_recover', 'inv_out_invest', SUPP.impairment, SUPP.impairment),
  R(['持有待售资产'], 'inv_in_recover', 'inv_out_invest', null, null),
  R(['债权投资减值准备'], 'inv_in_recover', 'inv_out_invest', SUPP.creditImpairment, SUPP.creditImpairment),
  R(['长期股权投资减值准备', '长期投资减值准备'], 'inv_in_recover', 'inv_out_invest', SUPP.impairment, SUPP.impairment),
  R(['债权投资', '其他债权投资', '其他权益工具投资', '长期股权投资', '长期债券投资', '长期投资', '对外投资', '投资性房地产', '衍生工具', '套期工具', '被套期项目'], 'inv_in_recover', 'inv_out_invest', null, null),
  R(['长期应收款'], 'inv_in_dispose', 'inv_out_build', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['未实现融资收益'], 'inv_in_other', 'inv_out_other', null, null),
  R(['固定资产减值准备', '在建工程减值准备', '工程物资减值准备', '无形资产减值准备', '使用权资产减值准备', '生产性生物资产减值准备', '商誉减值准备'], 'inv_in_dispose', 'inv_out_build', SUPP.impairment, SUPP.impairment),
  R(['累计折旧', '固定资产累计折旧', '使用权资产累计折旧', '生产性生物资产累计折旧', '公共基础设施累计折旧'], 'inv_out_build', 'inv_in_dispose', SUPP.depreciation, null),
  R(['累计摊销', '无形资产累计摊销'], 'inv_out_build', 'inv_in_dispose', SUPP.intangibleAmort, null),
  R(['长期待摊费用'], 'inv_in_dispose', 'inv_out_build', SUPP.longTermAmort, null),
  R(['固定资产清理'], 'inv_in_dispose', 'inv_out_build', null, null),
  R(['固定资产', '在建工程', '工程物资', '使用权资产', '生产性生物资产', '公益性生物资产', '无形资产', '开发支出', '公共基础设施', '政府储备物资', '文物文化资产', '保障性住房'], 'inv_in_dispose', 'inv_out_build', null, null),
  R(['商誉'], 'inv_in_dispose', 'inv_out_build', null, null),
  R(['递延所得税资产'], 'inv_in_other', 'inv_out_other', SUPP.deferredTaxAsset, SUPP.deferredTaxAsset),
  R(['待处理财产损溢', '待处理财产损益'], 'inv_in_other', 'inv_out_other', null, null),

  // ── 负债 ──
  R(['短期借款', '长期借款', '应付债券', '长期应付款', '专项应付款', '借入款项'], 'fin_in_borrow', 'fin_out_repay', null, null),
  R(['应付票据', '应付账款'], 'op_out_purchase', 'op_out_purchase', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['预收账款', '预收款项', '合同负债'], 'op_in_sales', 'op_in_sales', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['应付职工薪酬'], 'op_out_staff', 'op_out_staff', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['应交税费', '应缴税费', '应交增值税', '应缴增值税', '其他应交税费'], 'op_out_tax', 'op_out_tax', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['应付股利', '应付利润'], 'fin_out_dividend', 'fin_out_dividend', null, null),
  R(['应付利息'], 'fin_out_interest', 'fin_out_interest', null, null),
  R(['其他应付款'], 'op_in_other', 'op_out_other', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['持有待售负债'], 'fin_in_borrow', 'fin_out_repay', null, null),
  R(['受托代销商品款'], 'op_in_sales', 'op_in_sales', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['递延收益'], 'op_in_other', 'op_out_other', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['租赁负债'], 'inv_out_build', 'fin_out_other', null, null),
  R(['未确认融资费用'], 'inv_in_dispose', 'inv_out_build', null, null),
  R(['预计负债'], 'op_in_other', 'op_out_other', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['递延所得税负债'], 'fin_in_other', 'fin_out_other', SUPP.deferredTaxLiability, SUPP.deferredTaxLiability),

  // ── 旧《企业会计制度》常见科目（编码段与新准则不同，按名称识别） ──
  R(['预提费用'], 'op_in_other', 'op_out_other', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['待摊费用'], 'op_in_other', 'op_out_other', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['应付工资', '应付福利费'], 'op_out_staff', 'op_out_staff', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['其他应交款', '应交款项'], 'op_out_tax', 'op_out_tax', SUPP.operatingPayable, SUPP.operatingPayable),
  R(['应收补贴款', '应收出口退税'], 'op_in_tax_refund', 'op_in_tax_refund', SUPP.operatingReceivable, SUPP.operatingReceivable),
  R(['物资采购', '商品采购'], 'op_out_purchase', 'op_out_purchase', SUPP.inventory, SUPP.inventory),

  // ── 权益（附表留空：筹资活动不进经营活动调节） ──
  R(['利润分配'], 'fin_out_dividend', 'fin_out_dividend', null, null),
  R(['专项储备'], 'fin_in_other', 'fin_out_other', null, null),
  R(['实收资本', '股本', '资本公积', '其他综合收益', '盈余公积', '本年利润', '库存股', '其他权益工具', '一般风险准备', '累计盈余', '专用基金', '权益法调整', '本期盈余', '无偿调拨净资产', '以前年度盈余调整'], 'fin_in_invest', 'fin_in_invest', null, null),

  // ── 成本（与存货同口径） ──
  R(['研发支出'], 'op_out_purchase', 'op_out_purchase', SUPP.other, SUPP.other),
  R(['生产成本', '制造费用', '劳务成本', '工程施工', '机械作业', '加工物品'], 'op_out_purchase', 'op_out_purchase', SUPP.inventory, SUPP.inventory),

  // ── 损益（附表只设非现金 / 非经营的加回项，其余已含在净利润里） ──
  R(['主营业务收入', '其他业务收入', '营业收入', '事业收入', '经营收入'], 'op_in_sales', 'op_in_sales', null, null),
  R(['主营业务成本', '其他业务成本', '营业成本'], 'op_out_purchase', 'op_out_purchase', null, null),
  R(['税金及附加', '营业税金及附加', '所得税费用', '所得税'], 'op_out_tax', 'op_out_tax', null, null),
  R(['财务费用'], 'fin_out_interest', 'fin_out_interest', SUPP.financeExpense, SUPP.financeExpense),
  R(['投资收益'], 'inv_in_income', 'inv_in_income', SUPP.investLoss, SUPP.investLoss),
  R(['公允价值变动损益', '公允价值变动收益'], 'inv_in_recover', 'inv_out_invest', SUPP.fairValueLoss, SUPP.fairValueLoss),
  R(['资产处置收益', '资产处置损益'], 'inv_in_dispose', 'inv_out_build', SUPP.disposalLoss, SUPP.disposalLoss),
  R(['资产减值损失', '信用减值损失'], 'op_in_other', 'op_out_other', null, null),
  R(['补贴收入', '其他收益'], 'op_in_other', 'op_out_other', null, null),
  R(['营业外收入', '营业外支出', '销售费用', '营业费用', '管理费用', '以前年度损益调整', '其他收入', '其他费用'], 'op_in_other', 'op_out_other', null, null),
]

/** 未命中任何规则时按科目大类兜底 */
export const CATEGORY_FALLBACK_RULES: Record<string, Omit<AccountCashFlowRule, 'keywords'>> = {
  current_asset: { mc: 'op_in_other', md: 'op_out_other', sc: SUPP.operatingReceivable, sd: SUPP.operatingReceivable },
  non_current_asset: { mc: 'inv_in_other', md: 'inv_out_other', sc: null, sd: null },
  current_liability: { mc: 'op_in_other', md: 'op_out_other', sc: SUPP.operatingPayable, sd: SUPP.operatingPayable },
  non_current_liability: { mc: 'fin_in_other', md: 'fin_out_other', sc: null, sd: null },
  common: { mc: 'inv_in_recover', md: 'inv_out_invest', sc: null, sd: null },
  equity: { mc: 'fin_in_invest', md: 'fin_in_invest', sc: null, sd: null },
  cost: { mc: 'op_out_purchase', md: 'op_out_purchase', sc: SUPP.inventory, sd: SUPP.inventory },
  pl: { mc: 'op_in_other', md: 'op_out_other', sc: null, sd: null },
}

/** 现金及现金等价物：科目自身或上级勾了现金 / 银行，或名称为下列之一（含下级） */
export const CASH_EQUIVALENT_ACCOUNT_NAMES = ['库存现金', '现金', '银行存款', '其他货币资金', '零余额账户用款额度']
