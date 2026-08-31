import { getDb, seedRoles, ensureAccountSetSecurityBootstrap } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { importAcdTemplateToAccountSet } from './importAcdToCurrentAccountSet.js'

// 政府会计制度标准科目（财务会计）
// 结构: code, name, direction(余额方向), level, parentCode(父级编码), isCash, isBank, isAux, auxType
// direction: debit=借方余额, credit=贷方余额
// auxType: dept=部门核算, project=项目核算, supplier=往来单位, person=个人, func_class=功能分类
type AccountDef = {
  code: string
  name: string
  direction: 'debit' | 'credit'
  level: number
  parentCode?: string | null
  isCash?: 1
  isBank?: 1
  isAux?: 1
  auxType?: string
}

const ACCOUNT_TEMPLATES: AccountDef[] = [
  { code: '1001', name: '库存现金', direction: 'debit', level: 1, isCash: 1 },
  { code: '1001.01', name: '现金', direction: 'debit', level: 2, parentCode: '1001', isCash: 1 },
  { code: '1001.02', name: '受托代理资产', direction: 'debit', level: 2, parentCode: '1001', isCash: 1 },
  { code: '1002', name: '银行存款', direction: 'debit', level: 1, isBank: 1 },
  { code: '1002.01', name: '本单位', direction: 'debit', level: 2, parentCode: '1002', isBank: 1 },
  { code: '1002.02', name: '受托代理资产', direction: 'debit', level: 2, parentCode: '1002', isBank: 1 },
  { code: '1011', name: '零余额账户用款额度 ', direction: 'debit', level: 1 },
  { code: '1021', name: '其他货币资金', direction: 'debit', level: 1 },
  { code: '1021.01', name: '外埠存款', direction: 'debit', level: 2, parentCode: '1021' },
  { code: '1021.02', name: '银行本票存款', direction: 'debit', level: 2, parentCode: '1021' },
  { code: '1021.03', name: '银行汇票存款', direction: 'debit', level: 2, parentCode: '1021' },
  { code: '1021.04', name: '信用卡存款', direction: 'debit', level: 2, parentCode: '1021' },
  { code: '1101', name: '短期投资', direction: 'debit', level: 1 },
  { code: '1201', name: '财政应返还额度', direction: 'debit', level: 1 },
  { code: '1201.01', name: '财政直接支付', direction: 'debit', level: 2, parentCode: '1201' },
  { code: '1201.02', name: '财政授权支付', direction: 'debit', level: 2, parentCode: '1201' },
  { code: '1211', name: '应收票据', direction: 'debit', level: 1 },
  { code: '1212', name: '应收账款', direction: 'debit', level: 1 },
  { code: '1214', name: '预付账款', direction: 'debit', level: 1 },
  { code: '1215', name: '应收股利', direction: 'debit', level: 1 },
  { code: '1216', name: '应收利息', direction: 'debit', level: 1 },
  { code: '1218', name: '其他应收款', direction: 'debit', level: 1 },
  { code: '1219', name: '坏账准备', direction: 'credit', level: 1 },
  { code: '1301', name: '在途物品', direction: 'debit', level: 1 },
  { code: '1302', name: '库存物品', direction: 'debit', level: 1 },
  { code: '1303', name: '加工物品', direction: 'debit', level: 1 },
  { code: '1303.01', name: '自制物品', direction: 'debit', level: 2, parentCode: '1303' },
  { code: '1303.01.01', name: '直接材料', direction: 'debit', level: 3, parentCode: '1303.01' },
  { code: '1303.01.02', name: '直接人工', direction: 'debit', level: 3, parentCode: '1303.01' },
  { code: '1303.01.03', name: '其他直接费用', direction: 'debit', level: 3, parentCode: '1303.01' },
  { code: '1303.01.04', name: '间接费用', direction: 'debit', level: 3, parentCode: '1303.01' },
  { code: '1303.02', name: '委托加工物品', direction: 'debit', level: 2, parentCode: '1303' },
  { code: '1401', name: '待摊费用', direction: 'debit', level: 1 },
  { code: '1501', name: '长期股权投资', direction: 'debit', level: 1 },
  { code: '1502', name: '长期债券投资', direction: 'debit', level: 1 },
  { code: '1502.01', name: '成本', direction: 'debit', level: 2, parentCode: '1502' },
  { code: '1502.02', name: '应计利息', direction: 'debit', level: 2, parentCode: '1502' },
  { code: '1601', name: '固定资产', direction: 'debit', level: 1 },
  { code: '1601.01', name: '房屋及构筑物', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1601.02', name: '专用设备', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1601.03', name: '通用设备', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1601.04', name: '文物和陈列品', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1601.05', name: '图书、档案', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1601.06', name: '家具、用具、装具及动植物', direction: 'debit', level: 2, parentCode: '1601' },
  { code: '1602', name: '固定资产累计折旧 ', direction: 'credit', level: 1 },
  { code: '1611', name: '工程物资', direction: 'debit', level: 1 },
  { code: '1613', name: '在建工程', direction: 'debit', level: 1 },
  { code: '1613.01', name: '建筑安装工程投资', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1613.02', name: '设备投资', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1613.03', name: '待摊投资', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1613.04', name: '其他投资', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1613.05', name: '待核销基建支出', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1613.06', name: '基建转出投资', direction: 'debit', level: 2, parentCode: '1613' },
  { code: '1701', name: '无形资产', direction: 'debit', level: 1 },
  { code: '1702', name: '无形资产累计摊销', direction: 'credit', level: 1 },
  { code: '1703', name: '研发支出', direction: 'debit', level: 1 },
  { code: '1703.01', name: '研究支出', direction: 'debit', level: 2, parentCode: '1703' },
  { code: '1703.02', name: '开发支出', direction: 'debit', level: 2, parentCode: '1703' },
  { code: '1801', name: '公共基础设施', direction: 'debit', level: 1 },
  { code: '1802', name: '公共基础设施累计折旧（摊销）', direction: 'credit', level: 1 },
  { code: '1811', name: '政府储备物资', direction: 'debit', level: 1 },
  { code: '1821', name: '文物文化资产', direction: 'debit', level: 1 },
  { code: '1831', name: '保障性住房', direction: 'debit', level: 1 },
  { code: '1832', name: '保障性住房累计折旧', direction: 'credit', level: 1 },
  { code: '1891', name: '受托代理资产', direction: 'debit', level: 1 },
  { code: '1901', name: '长期待摊费用', direction: 'debit', level: 1 },
  { code: '1902', name: '待处理财产损溢', direction: 'debit', level: 1 },
  { code: '2001', name: '短期借款', direction: 'credit', level: 1 },
  { code: '2101', name: '应交增值税', direction: 'credit', level: 1 },
  { code: '2101.01', name: '应交税金', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.01.01', name: '进项税额', direction: 'debit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.02', name: '已交税金', direction: 'credit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.03', name: '转出未交增值税', direction: 'credit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.04', name: '减免税款', direction: 'debit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.05', name: '销项税额', direction: 'credit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.06', name: '进项税额转出', direction: 'credit', level: 3, parentCode: '2101.01' },
  { code: '2101.01.07', name: '转出多交增值税', direction: 'debit', level: 3, parentCode: '2101.01' },
  { code: '2101.02', name: '未交税金', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.03', name: '预交税金', direction: 'debit', level: 2, parentCode: '2101' },
  { code: '2101.04', name: '待抵扣进项税额', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.05', name: '待认证进项税额', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.06', name: '待转销项税额', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.07', name: '简易计税', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.08', name: '转让金融商品应交增值税', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2101.09', name: '代扣代交增值税', direction: 'credit', level: 2, parentCode: '2101' },
  { code: '2102', name: '其他应交税费', direction: 'credit', level: 1 },
  { code: '2102.01', name: '城市维护建设税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.02', name: '教育费附加', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.03', name: '地方教育费附', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.04', name: '车船税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.05', name: '房产税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.06', name: '城镇土地使用税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.07', name: '企业所得税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2102.08', name: '单位代扣代缴的个人所得税', direction: 'credit', level: 2, parentCode: '2102' },
  { code: '2103', name: '应缴财政款', direction: 'credit', level: 1 },
  { code: '2201', name: '应付职工薪酬', direction: 'credit', level: 1 },
  { code: '2201.01', name: '基本工资', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.02', name: '国家统一规定的津贴补贴', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.03', name: '规范津贴补贴', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.04', name: '改革性补贴', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.05', name: '社会保险费', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.06', name: '住房公积金', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2201.07', name: '其他个人收入', direction: 'credit', level: 2, parentCode: '2201' },
  { code: '2301', name: '应付票据', direction: 'credit', level: 1 },
  { code: '2302', name: '应付账款', direction: 'credit', level: 1 },
  { code: '2303', name: '应付政府补贴款', direction: 'credit', level: 1 },
  { code: '2304', name: '应付利息', direction: 'credit', level: 1 },
  { code: '2305', name: '预收账款', direction: 'credit', level: 1 },
  { code: '2307', name: '其他应付款', direction: 'credit', level: 1 },
  { code: '2401', name: '预提费用', direction: 'credit', level: 1 },
  { code: '2501', name: '长期借款', direction: 'credit', level: 1 },
  { code: '2502', name: '长期应付款', direction: 'credit', level: 1 },
  { code: '2601', name: '预计负债', direction: 'credit', level: 1 },
  { code: '2901', name: '受托代理负债', direction: 'credit', level: 1 },
  { code: '3001', name: '累计盈余', direction: 'credit', level: 1 },
  { code: '3101', name: '专用基金', direction: 'credit', level: 1 },
  { code: '3201', name: '权益法调整', direction: 'credit', level: 1 },
  { code: '3301', name: '本期盈余', direction: 'credit', level: 1 },
  { code: '3302', name: '本年盈余分配', direction: 'credit', level: 1 },
  { code: '3401', name: '无偿调拨净资产', direction: 'credit', level: 1 },
  { code: '3501', name: '以前年度盈余调整', direction: 'credit', level: 1 },
  { code: '4001', name: '财政拨款收入', direction: 'credit', level: 1 },
  { code: '4001.01', name: '一般公共预算财政拨款', direction: 'credit', level: 2, parentCode: '4001' },
  { code: '4001.02', name: '政府性基金预算财政拨款', direction: 'credit', level: 2, parentCode: '4001' },
  { code: '4101', name: '事业收入', direction: 'credit', level: 1 },
  { code: '4201', name: '上级补助收入', direction: 'credit', level: 1 },
  { code: '4301', name: '附属单位上缴收入', direction: 'credit', level: 1 },
  { code: '4401', name: '经营收入', direction: 'credit', level: 1 },
  { code: '4601', name: '非同级财政拨款收入', direction: 'credit', level: 1 },
  { code: '4602', name: '投资收益', direction: 'credit', level: 1 },
  { code: '4603', name: '捐赠收入', direction: 'credit', level: 1 },
  { code: '4604', name: '利息收入', direction: 'credit', level: 1 },
  { code: '4605', name: '租金收入', direction: 'credit', level: 1 },
  { code: '4609', name: '其他收入', direction: 'credit', level: 1 },
  { code: '5001', name: '业务活动费用', direction: 'debit', level: 1 },
  { code: '5101', name: '单位管理费用', direction: 'debit', level: 1 },
  { code: '5201', name: '经营费用', direction: 'debit', level: 1 },
  { code: '5301', name: '资产处置费用', direction: 'debit', level: 1 },
  { code: '5401', name: '上缴上级费用', direction: 'debit', level: 1 },
  { code: '5501', name: '对附属单位补助费用', direction: 'debit', level: 1 },
  { code: '5701', name: '利息费用', direction: 'debit', level: 1 },
  { code: '5801', name: '所得税费用', direction: 'debit', level: 1 },
  { code: '5901', name: '其他费用', direction: 'debit', level: 1 },
  { code: '6001', name: '财政拨款预算收入', direction: 'credit', level: 1 },
  { code: '6001.01', name: '基本支出', direction: 'credit', level: 2, parentCode: '6001' },
  { code: '6001.01.01', name: '人员经费', direction: 'credit', level: 3, parentCode: '6001.01' },
  { code: '6001.01.02', name: '日常公用经费', direction: 'credit', level: 3, parentCode: '6001.01' },
  { code: '6001.02', name: '项目支出', direction: 'credit', level: 2, parentCode: '6001' },
  { code: '6101', name: '事业预算收入', direction: 'credit', level: 1 },
  { code: '6101.01', name: '专项资金收入', direction: 'credit', level: 2, parentCode: '6101' },
  { code: '6101.02', name: '非专项资金收入', direction: 'credit', level: 2, parentCode: '6101' },
  { code: '6201', name: '上级补助预算收入', direction: 'credit', level: 1 },
  { code: '6201.01', name: '专项资金收入', direction: 'credit', level: 2, parentCode: '6201' },
  { code: '6201.02', name: '非专项资金收入', direction: 'credit', level: 2, parentCode: '6201' },
  { code: '6301', name: '附属单位上缴预算收入', direction: 'credit', level: 1 },
  { code: '6301.01', name: '专项资金收入', direction: 'credit', level: 2, parentCode: '6301' },
  { code: '6301.02', name: '非专项资金收入', direction: 'credit', level: 2, parentCode: '6301' },
  { code: '6401', name: '经营预算收入', direction: 'credit', level: 1 },
  { code: '6501', name: '债务预算收入', direction: 'credit', level: 1 },
  { code: '6501.01', name: '专项资金收入', direction: 'credit', level: 2, parentCode: '6501' },
  { code: '6501.02', name: '非专项资金收入', direction: 'credit', level: 2, parentCode: '6501' },
  { code: '6601', name: '非同级财政拨款预算收入', direction: 'credit', level: 1 },
  { code: '6601.01', name: '专项资金收入', direction: 'credit', level: 2, parentCode: '6601' },
  { code: '6601.02', name: '非专项资金收入', direction: 'credit', level: 2, parentCode: '6601' },
  { code: '6602', name: '投资预算收益', direction: 'credit', level: 1 },
  { code: '6609', name: '其他预算收入', direction: 'credit', level: 1 },
  { code: '6609.01', name: '捐赠预算收入', direction: 'credit', level: 2, parentCode: '6609' },
  { code: '6609.01.01', name: '专项资金收入', direction: 'credit', level: 3, parentCode: '6609.01' },
  { code: '6609.01.02', name: '非专项资金收入', direction: 'credit', level: 3, parentCode: '6609.01' },
  { code: '6609.02', name: '利息预算收入', direction: 'credit', level: 2, parentCode: '6609' },
  { code: '6609.02.01', name: '专项资金收入', direction: 'credit', level: 3, parentCode: '6609.02' },
  { code: '6609.02.02', name: '非专项资金收入', direction: 'credit', level: 3, parentCode: '6609.02' },
  { code: '6609.03', name: '租金预算收入', direction: 'credit', level: 2, parentCode: '6609' },
  { code: '6609.03.01', name: '专项资金收入', direction: 'credit', level: 3, parentCode: '6609.03' },
  { code: '6609.03.02', name: '非专项资金收入', direction: 'credit', level: 3, parentCode: '6609.03' },
  { code: '6609.04', name: '现金盘盈收入', direction: 'credit', level: 2, parentCode: '6609' },
  { code: '6609.04.01', name: '专项资金收入', direction: 'credit', level: 3, parentCode: '6609.04' },
  { code: '6609.04.02', name: '非专项资金收入', direction: 'credit', level: 3, parentCode: '6609.04' },
  { code: '7101', name: '行政支出', direction: 'debit', level: 1 },
  { code: '7101.01', name: '财政拨款支出', direction: 'debit', level: 2, parentCode: '7101' },
  { code: '7101.02', name: '非财政专项资金支出', direction: 'debit', level: 2, parentCode: '7101' },
  { code: '7101.03', name: '其他资金支出', direction: 'debit', level: 2, parentCode: '7101' },
  { code: '7201', name: '事业支出', direction: 'debit', level: 1 },
  { code: '7201.01', name: '财政拨款支出', direction: 'debit', level: 2, parentCode: '7201' },
  { code: '7201.02', name: '非财政专项资金支出', direction: 'debit', level: 2, parentCode: '7201' },
  { code: '7201.03', name: '其他资金支出', direction: 'debit', level: 2, parentCode: '7201' },
  { code: '7301', name: '经营支出', direction: 'debit', level: 1 },
  { code: '7401', name: '上缴上级支出', direction: 'debit', level: 1 },
  { code: '7501', name: '对附属单位补助支出', direction: 'debit', level: 1 },
  { code: '7601', name: '投资支出', direction: 'debit', level: 1 },
  { code: '7701', name: '债务还本支出', direction: 'debit', level: 1 },
  { code: '7901', name: '其他支出', direction: 'debit', level: 1 },
  { code: '7901.01', name: '利息支出', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.01.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.01' },
  { code: '7901.01.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.01' },
  { code: '7901.01.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.01' },
  { code: '7901.02', name: '对外捐赠现金支出', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.02.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.02' },
  { code: '7901.02.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.02' },
  { code: '7901.02.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.02' },
  { code: '7901.03', name: '现金盘亏损失', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.03.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.03' },
  { code: '7901.03.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.03' },
  { code: '7901.03.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.03' },
  { code: '7901.04', name: '接收捐赠和对外捐赠非现金资产的税费支出', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.04.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.04' },
  { code: '7901.04.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.04' },
  { code: '7901.04.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.04' },
  { code: '7901.05', name: '资产置换产生的税费支出', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.05.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.05' },
  { code: '7901.05.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.05' },
  { code: '7901.05.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.05' },
  { code: '7901.06', name: '罚没支出', direction: 'debit', level: 2, parentCode: '7901' },
  { code: '7901.06.01', name: '财政拨款支出', direction: 'debit', level: 3, parentCode: '7901.06' },
  { code: '7901.06.02', name: '非财政专项资金支出', direction: 'debit', level: 3, parentCode: '7901.06' },
  { code: '7901.06.03', name: '其他资金支出', direction: 'debit', level: 3, parentCode: '7901.06' },
  { code: '8001', name: '资金结存', direction: 'credit', level: 1 },
  { code: '8001.01', name: '零余额账户用款额度', direction: 'credit', level: 2, parentCode: '8001' },
  { code: '8001.02', name: '货币资金', direction: 'credit', level: 2, parentCode: '8001' },
  { code: '8001.03', name: '财政应返还额度', direction: 'credit', level: 2, parentCode: '8001' },
  { code: '8101', name: '财政拨款结转', direction: 'credit', level: 1 },
  { code: '8101.01', name: '年初余额调整', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.02', name: '归集调入', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.03', name: '归集调出', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.04', name: '归集上缴', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.05', name: '单位内部调剂', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.06', name: '本年收支结转', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8101.07', name: '累计结转', direction: 'credit', level: 2, parentCode: '8101' },
  { code: '8102', name: '财政拨款结余', direction: 'credit', level: 1 },
  { code: '8102.01', name: '年初余额调整', direction: 'credit', level: 2, parentCode: '8102' },
  { code: '8102.02', name: '归集上缴', direction: 'credit', level: 2, parentCode: '8102' },
  { code: '8102.03', name: '单位内部调剂', direction: 'credit', level: 2, parentCode: '8102' },
  { code: '8102.04', name: '结转转入', direction: 'credit', level: 2, parentCode: '8102' },
  { code: '8102.05', name: '累计结余', direction: 'credit', level: 2, parentCode: '8102' },
  { code: '8201', name: '非财政拨款结转', direction: 'credit', level: 1 },
  { code: '8201.01', name: '年初余额调整', direction: 'credit', level: 2, parentCode: '8201' },
  { code: '8201.02', name: '缴回资金', direction: 'credit', level: 2, parentCode: '8201' },
  { code: '8201.03', name: '项目间接费用或管理费', direction: 'credit', level: 2, parentCode: '8201' },
  { code: '8201.04', name: '本年收支结转', direction: 'credit', level: 2, parentCode: '8201' },
  { code: '8201.05', name: '累计结转', direction: 'credit', level: 2, parentCode: '8201' },
  { code: '8202', name: '非财政拨款结余', direction: 'credit', level: 1 },
  { code: '8202.01', name: '年初余额调整', direction: 'credit', level: 2, parentCode: '8202' },
  { code: '8202.02', name: '缴回资金', direction: 'credit', level: 2, parentCode: '8202' },
  { code: '8202.03', name: '项目间接费用或管理费', direction: 'credit', level: 2, parentCode: '8202' },
  { code: '8202.04', name: '本年收支结转', direction: 'credit', level: 2, parentCode: '8202' },
  { code: '8202.05', name: '累计结转', direction: 'credit', level: 2, parentCode: '8202' },
  { code: '8301', name: '专用结余', direction: 'credit', level: 1 },
  { code: '8401', name: '经营结余', direction: 'credit', level: 1 },
  { code: '8501', name: '其他结余', direction: 'credit', level: 1 },
  { code: '8701', name: '非财政拨款结余分配', direction: 'credit', level: 1 },
]

// 凭证类型
const VOUCHER_TYPES = [
  { name: '记账凭证', code: 'JZ' },
  { name: '收款凭证', code: 'SK' },
  { name: '付款凭证', code: 'FK' },
  { name: '转账凭证', code: 'ZZ' },
]

function insertAccounts(accountSetId: string): number {
  const db = getDb()

  const codeToId = new Map<string, string>()

  const insert = db.prepare(`
    INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_cash, is_bank, is_aux, aux_types, is_enabled, allow_delete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `)

  const insertMany = db.transaction((items: AccountDef[]) => {
    for (const item of items) {
      const id = uuidv4()
      const normalizedCode = item.code
      const normalizedParentCode = item.parentCode ?? null
      const parentId = normalizedParentCode ? codeToId.get(normalizedParentCode) ?? null : null

      if (normalizedParentCode && !parentId) {
        throw new Error(`missing parent account ${item.parentCode} for ${item.code}`)
      }

      codeToId.set(normalizedCode, id)

      insert.run(
        id,
        accountSetId,
        normalizedCode,
        item.name,
        item.direction,
        item.level,
        parentId,
        item.isCash ?? 0,
        item.isBank ?? 0,
        item.isAux ?? 0,
        item.auxType ?? null
      )
    }
  })

  insertMany(ACCOUNT_TEMPLATES)
  return ACCOUNT_TEMPLATES.length
}

function insertVoucherTypes(accountSetId: string) {
  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO voucher_types (id, account_set_id, name, code, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `)
  VOUCHER_TYPES.forEach((t, i) => {
    insert.run(uuidv4(), accountSetId, t.name, t.code, i)
  })
}

function createDefaultAdmin(accountSetId: string) {
  ensureAccountSetSecurityBootstrap(accountSetId)
}

// 初始化默认账套（仅在账套不存在时）
export function initDefaultAccountSet(unitName: string = '行政事业单位财务账套') {
  const db = getDb()

  const existing = db.prepare('SELECT * FROM account_sets LIMIT 1').get() as any
  if (existing) {
    // 账套已存在，检查是否需要重新初始化科目
    const accountCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM accounts WHERE account_set_id=?')
        .get(existing.id) as any
    ).c
    if (accountCount < 10) {
      // 科目数据异常，重新插入
      console.log(`[Seed] 账套 ${existing.name} 科目数据不完整，插入标准科目...`)
      const count = insertAccounts(existing.id)
      console.log(`[Seed] 插入 ${count} 个标准科目`)
    }
    return existing
  }

  const year = new Date().getFullYear()
  const accountSetId = uuidv4()

  db.prepare(
    `
    INSERT INTO account_sets (id, name, code, fiscal_year, start_date, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `
  ).run(accountSetId, unitName, 'GOV001', year, `${year}-01-01`)

  // 初始化角色
  seedRoles(accountSetId)

  const count = insertAccounts(accountSetId)
  insertVoucherTypes(accountSetId)
  createDefaultAdmin(accountSetId)

  // 默认系统参数
  const params = [
    { key: 'voucher_no_rule', value: 'auto' },
    { key: 'require_audit', value: 'true' },
    { key: 'require_post', value: 'true' },
    { key: 'allow_direct_post', value: 'false' },
    // 结转损益配置 - 依据政府会计制度（财会〔2017〕25号）
    { key: 'auto_transfer:balance_account_code', value: '3301' }, // 本期盈余（优先）
    { key: 'auto_transfer:surplus_account_code', value: '3301' }, // 本期盈余（备选）
  ]
  const insertParam = db.prepare(`
    INSERT OR IGNORE INTO system_params (id, account_set_id, param_key, param_value)
    VALUES (?, ?, ?, ?)
  `)
  for (const p of params) {
    insertParam.run(uuidv4(), accountSetId, p.key, p.value)
  }

  // 初始化结转类型
  insertTransferTypes(accountSetId)

  // 初始化结转配置项
  insertTransferItems(accountSetId)

  // 从ACD模版导入报表模板
  try {
    const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
    const templateDirs = [
      join(MODULE_DIR, '..', '..', '..', '模版'),
      join(MODULE_DIR, '..', '..', '..', '..', '模版'),
      resolve(process.cwd(), '模版'),
      resolve(process.cwd(), '..', '模版'),
    ]
    const acdFileName = '行政事业单位.acd'
    let acdPath: string | null = null
    for (const dir of templateDirs) {
      const candidate = join(dir, acdFileName)
      if (existsSync(candidate)) {
        acdPath = candidate
        break
      }
    }
    if (acdPath) {
      const acdBuffer = readFileSync(acdPath)
      const stats = importAcdTemplateToAccountSet(accountSetId, acdBuffer)
      console.log(`[Seed] 从ACD导入报表模板: ${stats.reportTemplates.definitions} 个报表定义`)
    } else {
      console.warn(`[Seed] 未找到ACD模版文件: ${acdFileName}，跳过报表模板导入`)
    }
  } catch (err: any) {
    console.warn('[Seed] ACD报表模板导入失败:', err.message)
  }

  console.log(`[Seed] 初始化完成: ${unitName}, 插入 ${count} 个标准科目`)
  return db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId)
}

// 强制重建科目（清空后重新插入）
export function rebuildAccounts(accountSetId: string): number {
  const db = getDb()
  const resetAccounts = db.transaction(() => {
    db.prepare('DELETE FROM init_balances WHERE account_set_id=?').run(accountSetId)
    db.prepare('DELETE FROM account_balances WHERE account_set_id=?').run(accountSetId)
    db.prepare('DELETE FROM voucher_entries WHERE account_set_id=?').run(accountSetId)
    db.prepare('DELETE FROM accounts WHERE account_set_id=?').run(accountSetId)
    return insertAccounts(accountSetId)
  })

  return resetAccounts()
}

// 初始化结转类型
function insertTransferTypes(accountSetId: string) {
  const db = getDb()

  const transferTypes = [
    { id: '1', code: '10', name: '结转本期收', voucherType: '结转', periodType: 'monthly' },
    { id: '2', code: '20', name: '结转本期支', voucherType: '结转', periodType: 'monthly' },
    { id: '3', code: '60', name: '结转盈余(口)', voucherType: '结转', periodType: 'yearly' },
    { id: '4', code: '70', name: '结转累计盈', voucherType: '结转', periodType: 'yearly' },
    { id: '5', code: '80', name: '结转财政拨', voucherType: '结转', periodType: 'yearly' },
    { id: '6', code: '82', name: '结转非财政', voucherType: '结转', periodType: 'yearly' },
    { id: '7', code: '84', name: '结转其他资', voucherType: '结转', periodType: 'yearly' },
    { id: '8', code: '86', name: '结转经营(口)', voucherType: '结转', periodType: 'yearly' },
    { id: '9', code: '88', name: '财政拨款结', voucherType: '结转', periodType: 'yearly' },
  ]

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transfer_types (id, code, name, voucher_type, period_type, account_set_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  for (const t of transferTypes) {
    insert.run(t.id, t.code, t.name, t.voucherType, t.periodType, accountSetId)
  }
}

// 初始化结转配置项
function insertTransferItems(accountSetId: string) {
  const db = getDb()

  // 结转本期收入配置
  const incomeItems = [
    { typeCode: '10', summary: '结转财政拨款收入', fromCode: '4001', fromName: '财政拨款收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转事业收入', fromCode: '4101', fromName: '事业收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转上级补助收入', fromCode: '4201', fromName: '上级补助收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转附属单位上缴收入', fromCode: '4301', fromName: '附属单位上缴收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转经营收入', fromCode: '4401', fromName: '经营收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转非同级财政拨款收入', fromCode: '4601', fromName: '非同级财政拨款收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转投资收益', fromCode: '4602', fromName: '投资收益', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转捐赠收入', fromCode: '4603', fromName: '捐赠收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转利息收入', fromCode: '4604', fromName: '利息收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转租金收入', fromCode: '4605', fromName: '租金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转其他收入', fromCode: '4609', fromName: '其他收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '转入本期盈余', fromCode: '', fromName: '', toCode: '3301', toName: '本期盈余', transferType: 'all', ratio: 100 },
  ]

  // 结转本期支出配置
  const expenseItems = [
    { typeCode: '20', summary: '结转业务活动费用', fromCode: '5001', fromName: '业务活动费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转单位管理费用', fromCode: '5101', fromName: '单位管理费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转经营费用', fromCode: '5201', fromName: '经营费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转资产处置费用', fromCode: '5301', fromName: '资产处置费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转上缴上级费用', fromCode: '5401', fromName: '上缴上级费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转对附属单位补助费用', fromCode: '5501', fromName: '对附属单位补助费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转利息费用', fromCode: '5701', fromName: '利息费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转所得税费用', fromCode: '5801', fromName: '所得税费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转其他费用', fromCode: '5901', fromName: '其他费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '转入本期盈余', fromCode: '', fromName: '', toCode: '3301', toName: '本期盈余', transferType: 'all', ratio: 100 },
  ]

  // 结转盈余配置
  const surplusItems = [
    { typeCode: '60', summary: '结转本期盈余', fromCode: '3301', fromName: '本期盈余', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '60', summary: '转入本年盈余分配', fromCode: '', fromName: '', toCode: '3302', toName: '本年盈余分配', transferType: 'all', ratio: 100 },
  ]

  // 结转累计盈余配置
  const accumulatedItems = [
    { typeCode: '70', summary: '结转本年盈余分配', fromCode: '3302', fromName: '本年盈余分配', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '结转无偿调拨净资产', fromCode: '3401', fromName: '无偿调拨净资产', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '结转以前年度盈余调整', fromCode: '3501', fromName: '以前年度盈余调整', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '转入累计盈余', fromCode: '', fromName: '', toCode: '3001', toName: '累计盈余', transferType: 'all', ratio: 100 },
  ]

  // 财政拨款结转配置
  const financeItems = [
    { typeCode: '80', summary: '结转财政拨款预算收入', fromCode: '6001', fromName: '财政拨款预算收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '结转行政支出财政拨款', fromCode: '710101', fromName: '行政支出财政拨款支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '结转事业支出财政拨款', fromCode: '720101', fromName: '事业支出财政拨款支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '转入财政拨款结转', fromCode: '', fromName: '', toCode: '810106', toName: '财政拨款结转/本年收支结转', transferType: 'all', ratio: 100 },
  ]

  // 非财政拨款结转配置
  const nonFinanceItems = [
    { typeCode: '82', summary: '结转事业预算收入专项', fromCode: '610101', fromName: '事业预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转上级补助预算收入专项', fromCode: '620101', fromName: '上级补助预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转附属单位上缴预算收入专项', fromCode: '630101', fromName: '附属单位上缴预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转债务预算收入专项', fromCode: '650101', fromName: '债务预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转非同级财政拨款预算收入专项', fromCode: '660101', fromName: '非同级财政拨款预算收入/专项资金', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '转入非财政拨款结转', fromCode: '', fromName: '', toCode: '820104', toName: '非财政拨款结转/本年收支结转', transferType: 'all', ratio: 100 },
  ]

  // 其他资金结转配置
  const otherItems = [
    { typeCode: '84', summary: '结转事业预算收入非专项', fromCode: '610102', fromName: '事业预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转上级补助预算收入非专项', fromCode: '620102', fromName: '上级补助预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转附属单位上缴预算收入非专项', fromCode: '630102', fromName: '附属单位上缴预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转债务预算收入非专项', fromCode: '650102', fromName: '债务预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转非同级财政拨款预算收入非专项', fromCode: '660102', fromName: '非同级财政拨款预算收入/非专项资金', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '转入其他结余', fromCode: '', fromName: '', toCode: '8501', toName: '其他结余', transferType: 'all', ratio: 100 },
  ]

  // 经营结转配置
  const operatingItems = [
    { typeCode: '86', summary: '结转经营预算收入', fromCode: '6401', fromName: '经营预算收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '86', summary: '结转经营支出', fromCode: '7301', fromName: '经营支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '86', summary: '转入经营结余', fromCode: '', fromName: '', toCode: '8401', toName: '经营结余', transferType: 'all', ratio: 100 },
  ]

  // 财政拨款结余配置
  const financeSurplusItems = [
    { typeCode: '88', summary: '结转财政拨款结转', fromCode: '810107', fromName: '财政拨款结转/累计结转', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '88', summary: '转入财政拨款结余', fromCode: '', fromName: '', toCode: '810205', toName: '财政拨款结余/累计结余', transferType: 'all', ratio: 100 },
  ]

  const allItems = [...incomeItems, ...expenseItems, ...surplusItems, ...accumulatedItems, ...financeItems, ...nonFinanceItems, ...otherItems, ...operatingItems, ...financeSurplusItems]

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transfer_items
    (id, type_code, summary, from_code, from_name, to_code, to_name, transfer_type, ratio, sort_order, account_set_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  allItems.forEach((item, index) => {
    insert.run(uuidv4(), item.typeCode, item.summary, item.fromCode, item.fromName, item.toCode, item.toName, item.transferType, item.ratio, index, accountSetId)
  })
}

export { insertAccounts, insertVoucherTypes }
