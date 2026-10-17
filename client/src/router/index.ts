import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useLicenseStore } from '@/stores/license'
import {
  canAccessRoute,
  getDefaultLandingPath,
  normalizePath,
  resolveAccessiblePath,
} from '@/config/navigation'
import { REMEMBER_ME_KEY, clearRememberedLogin } from '@/utils/rememberedLogin'
import { getStoredHomePage } from '@/utils/homePreference'
import { setupRouteSwitchingIndicator } from '@/composables/useRouteSwitching'
import { ElMessage } from 'element-plus'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', requiresAuth: false },
  },
  {
    path: '/activate',
    name: 'LicenseActivate',
    component: () => import('@/views/LicenseActivate.vue'),
    meta: { title: '软件激活', requiresAuth: false },
  },
  {
    path: '/',
    component: () => import('@/views/Layout.vue'),
    // 用户可把任意模块主页设为默认主页；无效路径由下方守卫的 resolveAccessiblePath 兜底
    redirect: () => getStoredHomePage() || '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '工作台', icon: 'Odometer' },
      },
      {
        path: 'forbidden',
        name: 'Forbidden',
        component: () => import('@/views/Forbidden.vue'),
        meta: { title: '无权限', icon: 'Warning' },
      },
      // 系统管理
      {
        path: 'system/account-set',
        name: 'AccountSet',
        component: () => import('@/views/system/AccountSet.vue'),
        meta: { title: '账套管理', icon: 'Coin', parent: '系统管理' },
      },
      {
        path: 'system/user',
        name: 'User',
        component: () => import('@/views/system/User.vue'),
        meta: { title: '用户管理', icon: 'User', parent: '系统管理' },
      },
      {
        path: 'system/role',
        name: 'Role',
        component: () => import('@/views/system/Role.vue'),
        meta: { title: '角色管理', icon: 'UserFilled', parent: '系统管理' },
      },
      {
        // 系统参数已嵌入「系统管理」主页：旧地址保留为重定向，?tab= / ?openBrandSettings= 原样带过去
        path: 'system/param',
        redirect: to => ({ path: `/group/${encodeURIComponent('系统管理')}`, query: to.query }),
      },
      {
        path: 'system/license',
        name: 'SystemLicense',
        component: () => import('@/views/system/License.vue'),
        meta: { title: '注册信息', icon: 'Key', parent: '系统管理' },
      },
      {
        path: 'system/dashboard-rules',
        name: 'DashboardRules',
        component: () => import('@/views/system/DashboardRules.vue'),
        meta: { title: '首页取数规则', icon: 'DataAnalysis', parent: '系统管理' },
      },
      {
        path: 'system/log',
        name: 'Log',
        component: () => import('@/views/system/Log.vue'),
        meta: { title: '操作日志', icon: 'Document', parent: '系统管理' },
      },
      // 基础设置
      {
        path: 'base/account',
        name: 'Account',
        component: () => import('@/views/base/Account.vue'),
        meta: { title: '会计科目', icon: 'Notebook', parent: '基础设置' },
      },
      {
        path: 'base/account-reference-check',
        name: 'AccountReferenceCheck',
        component: () => import('@/views/base/AccountReferenceCheck.vue'),
        meta: { title: '科目设置检查', parent: '基础设置' },
      },
      {
        path: 'base/account-set-info',
        name: 'AccountSetInfo',
        component: () => import('@/views/base/AccountSetInfo.vue'),
        meta: { title: '套账信息', icon: 'InfoFilled', parent: '基础设置' },
      },
      {
        path: 'base/voucher-type',
        name: 'VoucherType',
        component: () => import('@/views/base/VoucherType.vue'),
        meta: { title: '凭证类型', icon: 'Tickets', parent: '基础设置' },
      },
      {
        path: 'base/transfer-type',
        name: 'TransferType',
        component: () => import('@/views/system/TransferType.vue'),
        meta: { title: '结转维护', icon: 'Connection', parent: '基础设置' },
      },
      {
        path: 'report/cash-flow',
        name: 'CashFlowReport',
        component: () => import('@/views/report/CashFlow.vue'),
        meta: { title: '现金流量表(估算)', icon: 'Money', parent: '账簿查询' },
      },
      {
        path: 'report/cash-flow-auto',
        name: 'CashFlowAutoReport',
        component: () => import('@/views/report/CashFlowAuto.vue'),
        meta: { title: '现金流量表', icon: 'Money', parent: '账簿查询', requiresCashFlow: true },
      },
      {
        path: 'report/dynamic/:code?',
        name: 'DynamicReport',
        component: () => import('@/views/report/DynamicReport.vue'),
        meta: { title: '报表维护', icon: 'TrendCharts', parent: '基础设置' },
      },
      {
        path: 'base/scm-voucher-setting',
        name: 'ScmVoucherSetting',
        component: () => import('@/views/base/ScmVoucherSetting.vue'),
        meta: { title: '进销存凭证设置', icon: 'Setting', parent: '基础设置' },
      },
      {
        path: 'base/project',
        name: 'Project',
        component: () => import('@/views/base/Project.vue'),
        meta: { title: '核算项目', icon: 'FolderOpened', parent: '基础设置' },
      },
      {
        path: 'base/project/category/new',
        name: 'ProjectCategoryNew',
        component: () => import('@/views/base/ProjectCategoryForm.vue'),
        meta: { title: '新增核算类别', icon: 'FolderAdd', parent: '基础设置' },
      },
      {
        path: 'base/project/category/:id/edit',
        name: 'ProjectCategoryEdit',
        component: () => import('@/views/base/ProjectCategoryForm.vue'),
        meta: { title: '编辑核算类别', icon: 'Edit', parent: '基础设置' },
      },
      {
        path: 'base/init-balance',
        name: 'InitBalance',
        component: () => import('@/views/base/InitBalance.vue'),
        meta: { title: '期初余额', icon: 'Coin', parent: '基础设置' },
      },
      {
        path: 'base/init-balance/aux',
        name: 'InitBalanceAux',
        component: () => import('@/views/base/InitBalanceAux.vue'),
        meta: { title: '辅助期初录入', parent: '基础设置' },
      },
      {
        path: 'base/print-template',
        name: 'PrintTemplate',
        component: () => import('@/views/base/PrintTemplate.vue'),
        meta: { title: '打印模版', icon: 'Printer', parent: '基础设置' },
      },
      {
        path: 'base/print-template/design/:id?',
        name: 'PrintTemplateDesigner',
        component: () => import('@/views/base/PrintTemplateDesigner.vue'),
        meta: { title: '设计打印模版', icon: 'Printer', parent: '基础设置' },
      },
      {
        path: 'base/cash-flow-items',
        name: 'CashFlowItems',
        component: () => import('@/views/base/CashFlowItems.vue'),
        meta: { title: '现金流量项目', icon: 'Money', parent: '基础设置', requiresCashFlow: true },
      },
      {
        path: 'base/cash-flow-account-map',
        name: 'CashFlowAccountMap',
        component: () => import('@/views/base/CashFlowAccountMap.vue'),
        meta: { title: '科目现金流量项目', icon: 'Money', parent: '基础设置', requiresCashFlow: true },
      },
      {
        path: 'base/currency',
        name: 'Currency',
        component: () => import('@/views/base/Currency.vue'),
        meta: {
          title: '外币类型',
          icon: 'Coins',
          parent: '基础设置',
          requiresForeignCurrency: true,
        },
      },
      {
        path: 'base/fund-source',
        name: 'FundSource',
        component: () => import('@/views/base/FundSource.vue'),
        meta: { title: '资金来源', icon: 'Wallet', parent: '基础设置', requiresCashFlow: true },
      },
      // 凭证管理
      {
        path: 'voucher/entry',
        name: 'VoucherEntry',
        component: () => import('@/views/voucher/Entry.vue'),
        meta: { title: '凭证录入', icon: 'EditPen', parent: '凭证管理' },
      },
      {
        path: 'voucher/excel-import',
        name: 'VoucherExcelImport',
        component: () => import('@/views/voucher/ExcelImport.vue'),
        meta: { title: 'Excel 转入凭证', parent: '凭证管理' },
      },
      {
        path: 'voucher/audit',
        name: 'VoucherAudit',
        component: () => import('@/views/voucher/Audit.vue'),
        meta: { title: '凭证管理', icon: 'CircleCheck', parent: '凭证管理' },
      },
      {
        path: 'voucher/fx-reval',
        name: 'VoucherFxReval',
        component: () => import('@/views/voucher/FxReval.vue'),
        meta: { title: '期末调汇', icon: 'Coins', parent: '凭证管理', requiresForeignCurrency: true },
      },
      {
        path: 'voucher/auto-transfer',
        name: 'VoucherAutoTransfer',
        component: () => import('@/views/voucher/AutoTransfer.vue'),
        meta: { title: '凭证结转', icon: 'RefreshRight', parent: '凭证管理' },
      },
      {
        path: 'voucher/period-close',
        name: 'VoucherPeriodClose',
        component: () => import('@/views/voucher/PeriodClose.vue'),
        meta: { title: '期间结账', icon: 'Calendar', parent: '凭证管理' },
      },
      {
        path: 'voucher/biz-center',
        name: 'BizVoucherCenter',
        component: () => import('@/views/voucher/BizVoucherCenter.vue'),
        meta: { title: '业务凭证', icon: 'Files', parent: '凭证管理' },
      },
      {
        path: 'voucher/aux-unmatched',
        name: 'ScmAuxUnmatched',
        component: () => import('@/views/voucher/ScmAuxUnmatched.vue'),
        meta: { title: '辅助核算对应不上', parent: '凭证管理' },
      },
      {
        path: 'voucher/query',
        name: 'VoucherQuery',
        component: () => import('@/views/voucher/Query.vue'),
        meta: { title: '凭证查询', icon: 'Search', parent: '凭证管理' },
      },
      {
        path: 'voucher/template',
        name: 'VoucherTemplate',
        component: () => import('@/views/voucher/Template.vue'),
        meta: { title: '凭证模版', icon: 'DocumentCopy', parent: '基础设置' },
      },
      // 账簿管理
      {
        path: 'ledger/general',
        name: 'GeneralLedger',
        component: () => import('@/views/ledger/General.vue'),
        meta: { title: '科目余额表', icon: 'DataAnalysis', parent: '账簿管理' },
      },
      {
        path: 'ledger/detail',
        name: 'DetailLedger',
        component: () => import('@/views/ledger/Detail.vue'),
        props: { mode: 'base' },
        meta: { title: '明细账', icon: 'Document', parent: '账簿管理' },
      },
      {
        path: 'ledger/vat-detail',
        name: 'VatDetailLedger',
        component: () => import('@/views/ledger/VatDetail.vue'),
        meta: { title: '增值税明细账', icon: 'Document', parent: '账簿管理' },
      },
      {
        path: 'ledger/multi-column',
        name: 'MultiColumnLedger',
        component: () => import('@/views/ledger/MultiColumn.vue'),
        meta: { title: '多栏账', icon: 'Document', parent: '账簿管理' },
      },
      {
        path: 'ledger/balance',
        name: 'BalanceTable',
        component: () => import('@/views/ledger/Balance.vue'),
        meta: { title: '总分类账', icon: 'List', parent: '账簿管理' },
      },
      {
        path: 'ledger/cash-journal',
        name: 'CashJournal',
        component: () => import('@/views/ledger/CashJournal.vue'),
        meta: { title: '日记账', icon: 'Wallet', parent: '账簿管理' },
      },
      {
        path: 'ledger/cash-flow-trial-balance',
        name: 'CashFlowTrialBalance',
        component: () => import('@/views/ledger/CashFlowTrialBalance.vue'),
        meta: {
          title: '现金流量试算平衡表',
          icon: 'Money',
          parent: '账簿管理',
          requiresCashFlow: true,
        },
      },
      {
        path: 'ledger/foreign-balance',
        name: 'ForeignBalance',
        component: () => import('@/views/ledger/ForeignBalance.vue'),
        meta: {
          title: '外币余额表',
          icon: 'Coins',
          parent: '账簿管理',
          requiresForeignCurrency: true,
        },
      },
      {
        path: 'ledger/foreign-detail',
        name: 'ForeignDetailLedger',
        component: () => import('@/views/ledger/Detail.vue'),
        props: { mode: 'foreign' },
        meta: {
          title: '外币明细账',
          icon: 'Coins',
          parent: '账簿管理',
          requiresForeignCurrency: true,
        },
      },
      {
        path: 'ledger/quantity-balance',
        name: 'QuantityBalance',
        component: () => import('@/views/ledger/QuantityBalance.vue'),
        meta: {
          title: '库存数量金额表',
          icon: 'Goods',
          parent: '账簿管理',
        },
      },
      {
        path: 'ledger/voucher-summary',
        name: 'VoucherSummary',
        component: () => import('@/views/ledger/VoucherSummary.vue'),
        meta: { title: '凭证汇总表', icon: 'DataAnalysis', parent: '账簿管理' },
      },
      {
        path: 'ledger/subject-analysis',
        name: 'SubjectAnalysis',
        component: () => import('@/views/ledger/SubjectAnalysis.vue'),
        meta: { title: '财务分析', icon: 'TrendCharts', parent: '财务报表' },
      },
      {
        path: 'ledger/chronological',
        name: 'Chronological',
        component: () => import('@/views/ledger/Chronological.vue'),
        meta: { title: '序时账', icon: 'Clock', parent: '账簿管理' },
      },
      {
        path: 'ledger/standard-report',
        name: 'StandardReport',
        component: () => import('@/views/ledger/StandardReport.vue'),
        meta: { title: '标准报表', icon: 'Document', parent: '账簿管理' },
      },
      {
        path: 'ledger/aux-balance',
        name: 'LedgerAuxBalance',
        component: () => import('@/views/ledger/AuxBalance.vue'),
        meta: { title: '辅助项目余额表', icon: 'DataAnalysis', parent: '账簿管理' },
      },
      {
        path: 'ledger/aux-foreign-balance',
        name: 'LedgerAuxForeignBalance',
        component: () => import('@/views/ledger/AuxBalance.vue'),
        props: { foreign: true },
        meta: {
          title: '辅助项目外币余额表',
          icon: 'Coins',
          parent: '账簿管理',
          requiresForeignCurrency: true,
        },
      },
      {
        path: 'ledger/aux-quantity-balance',
        name: 'LedgerAuxQuantityBalance',
        component: () => import('@/views/ledger/AuxBalance.vue'),
        props: { quantity: true },
        meta: {
          title: '辅助项目库存数量金额表',
          icon: 'Goods',
          parent: '账簿管理',
        },
      },
      {
        path: 'ledger/aux-detail',
        name: 'LedgerAuxDetail',
        component: () => import('@/views/ledger/AuxDetail.vue'),
        meta: { title: '辅助项目明细账', icon: 'Document', parent: '账簿管理' },
      },
      {
        path: 'ledger/aux-multi-column',
        name: 'LedgerAuxMultiColumn',
        component: () => import('@/views/ledger/AuxMultiColumn.vue'),
        meta: { title: '辅助项目多栏明细账', icon: 'Document', parent: '账簿管理' },
      },
      // 辅助核算
      {
        path: 'aux/dept',
        name: 'AuxDept',
        component: () => import('@/views/_aux/Dept.vue'),
        meta: { title: '部门核算', icon: 'OfficeBuilding', parent: '辅助核算' },
      },
      {
        path: 'aux/project',
        name: 'AuxProject',
        component: () => import('@/views/_aux/AuxProject.vue'),
        meta: { title: '项目核算', icon: 'Suitcase', parent: '辅助核算' },
      },
      {
        path: 'aux/supplier',
        name: 'AuxSupplier',
        component: () => import('@/views/_aux/Supplier.vue'),
        meta: { title: '往来单位', icon: 'OfficeBuilding', parent: '辅助核算' },
      },
      {
        path: 'aux/person',
        name: 'AuxPerson',
        component: () => import('@/views/_aux/Person.vue'),
        meta: { title: '人员核算', icon: 'User', parent: '辅助核算' },
      },
      {
        path: 'aux/func-class',
        name: 'AuxFuncClass',
        component: () => import('@/views/_aux/FuncClass.vue'),
        meta: { title: '功能分类', icon: 'Collection', parent: '辅助核算' },
      },
      // 出纳管理
      {
        path: 'cashier/journal',
        name: 'CashierJournal',
        component: () => import('@/views/cashier/Journal.vue'),
        meta: { title: '出纳录单', icon: 'CreditCard', parent: '出纳管理' },
      },
      {
        path: 'cashier/voucher-generate-result',
        name: 'CashierVoucherGenerateResult',
        component: () => import('@/views/cashier/VoucherGenerateResult.vue'),
        meta: { title: '生成凭证结果', parent: '出纳管理' },
      },
      {
        path: 'cashier/voucher-generate-preview',
        name: 'CashierVoucherGeneratePreview',
        component: () => import('@/views/cashier/VoucherGeneratePreview.vue'),
        meta: { title: '生成凭证预览', parent: '出纳管理' },
      },
      {
        path: 'cashier/init-balance',
        name: 'CashierInitBalance',
        component: () => import('@/views/cashier/InitBalance.vue'),
        meta: { title: '出纳期初', icon: 'Wallet', parent: '出纳管理' },
      },
      {
        path: 'cashier/flow-query',
        name: 'CashierFlowQuery',
        component: () => import('@/views/cashier/CashFlowQuery.vue'),
        meta: { title: '出纳流水账', icon: 'List', parent: '出纳管理' },
      },
      {
        path: 'cashier/daily-report',
        name: 'CashierDailyReport',
        component: () => import('@/views/cashier/DailyReport.vue'),
        meta: { title: '账户余额表', icon: 'DataLine', parent: '出纳管理' },
      },
      {
        path: 'cashier/summary-report',
        name: 'CashFlowSummary',
        component: () => import('@/views/cashier/CashFlowSummary.vue'),
        meta: { title: '资金收支汇总表', icon: 'DataLine', parent: '出纳管理' },
      },
      {
        path: 'cashier/aux-summary',
        name: 'CashierAuxSummary',
        component: () => import('@/views/cashier/AuxCashSummary.vue'),
        meta: { title: '辅助项目收支表', icon: 'DataLine', parent: '出纳管理' },
      },
      {
        path: 'cashier/document-query',
        name: 'DocumentQuery',
        component: () => import('@/views/cashier/DocumentQuery.vue'),
        meta: { title: '单据综合查询', icon: 'Search', parent: '出纳管理' },
      },
      {
        path: 'cashier/period-close',
        name: 'CashierPeriodClose',
        component: () => import('@/views/cashier/PeriodClose.vue'),
        meta: { title: '出纳结账', icon: 'CalendarCheck', parent: '出纳管理' },
      },
      {
        path: 'cashier/reset',
        name: 'CashierReset',
        component: () => import('@/views/cashier/Reset.vue'),
        meta: { title: '出纳初始化', icon: 'RefreshLeft', parent: '出纳管理' },
      },
      {
        path: 'cashier/reconcile',
        name: 'CashierReconcile',
        component: () => import('@/views/cashier/Reconcile.vue'),
        meta: { title: '出纳对账', icon: 'Connection', parent: '出纳管理' },
      },
      {
        path: 'cashier/reconciliation',
        name: 'CashierBankReconciliation',
        component: () => import('@/views/cashier/BankReconciliation.vue'),
        meta: { title: '差异清单', icon: 'ScaleToOriginal', parent: '出纳管理' },
      },
      {
        path: 'cashier/bank-import',
        name: 'CashierBankImport',
        component: () => import('@/views/cashier/BankImport.vue'),
        meta: { title: '对账单导入', icon: 'Upload', parent: '出纳管理' },
      },
      {
        path: 'base/keyboard-shortcuts',
        name: 'KeyboardShortcuts',
        component: () => import('@/views/base/KeyboardShortcuts.vue'),
        meta: { title: '快捷键维护', icon: 'Operation', parent: '系统管理' },
      },
      // 固定资产
      {
        path: 'asset/list',
        name: 'AssetList',
        component: () => import('@/views/asset/AssetList.vue'),
        meta: { title: '资产卡片', icon: 'OfficeBuilding', parent: '固定资产' },
      },
      {
        path: 'scm/items',
        name: 'ScmItemList',
        component: () => import('@/views/scm/ItemList.vue'),
        meta: { title: '物料档案', icon: 'Goods', parent: '供应链' },
      },
      {
        path: 'scm/items/new',
        name: 'ScmItemNew',
        component: () => import('@/views/scm/ItemForm.vue'),
        meta: { title: '新增物料', parent: '供应链' },
      },
      {
        path: 'scm/items/:id/edit',
        name: 'ScmItemEdit',
        component: () => import('@/views/scm/ItemForm.vue'),
        meta: { title: '编辑物料', parent: '供应链' },
      },
      {
        path: 'scm/item-types',
        name: 'ScmItemTypeList',
        component: () => import('@/views/scm/ItemTypeList.vue'),
        meta: { title: '物料属性', icon: 'PriceTag', parent: '供应链' },
      },
      {
        path: 'scm/categories',
        name: 'ScmCategoryList',
        component: () => import('@/views/scm/CategoryList.vue'),
        meta: { title: '物料分类', icon: 'Files', parent: '供应链' },
      },
      {
        path: 'scm/bins',
        name: 'ScmBinList',
        component: () => import('@/views/scm/BinList.vue'),
        meta: { title: '库位档案', icon: 'Grid', parent: '供应链' },
      },
      {
        path: 'scm/partners',
        name: 'ScmPartnerList',
        component: () => import('@/views/scm/PartnerList.vue'),
        meta: { title: '往来单位', icon: 'User', parent: '供应链' },
      },
      {
        path: 'scm/suppliers',
        name: 'ScmSupplierList',
        component: () => import('@/views/scm/PartnerList.vue'),
        meta: { title: '供应商', icon: 'Sell', parent: '供应链' },
      },
      {
        path: 'scm/customers',
        name: 'ScmCustomerList',
        component: () => import('@/views/scm/PartnerList.vue'),
        meta: { title: '客户', icon: 'User', parent: '供应链' },
      },
      {
        path: 'scm/warehouses',
        name: 'ScmWarehouseList',
        component: () => import('@/views/scm/WarehouseList.vue'),
        meta: { title: '仓库档案', icon: 'House', parent: '供应链' },
      },
      {
        path: 'scm/units',
        name: 'ScmUnitList',
        component: () => import('@/views/scm/UnitList.vue'),
        meta: { title: '计量单位', icon: 'ScaleToOriginal', parent: '供应链' },
      },
      {
        path: 'scm/stock',
        name: 'ScmStockList',
        component: () => import('@/views/scm/StockList.vue'),
        meta: { title: '库存查询', icon: 'Box', parent: '供应链' },
      },
      {
        path: 'scm/production-plans',
        name: 'ScmProductionPlan',
        component: () => import('@/views/scm/ProductionPlan.vue'),
        meta: { title: '生产计划', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/work-centers',
        name: 'ScmWorkCenter',
        component: () => import('@/views/scm/WorkCenterList.vue'),
        meta: { title: '工作中心', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/routings',
        name: 'ScmRouting',
        component: () => import('@/views/scm/RoutingList.vue'),
        meta: { title: '工艺路线', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/work-reports',
        name: 'ScmWorkReport',
        component: () => import('@/views/scm/WorkReport.vue'),
        meta: { title: '生产报工', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/kitting',
        name: 'ScmKitting',
        component: () => import('@/views/scm/KittingAnalysis.vue'),
        meta: { title: '齐套分析', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/mrp',
        name: 'ScmMrp',
        component: () => import('@/views/scm/MrpRun.vue'),
        meta: { title: 'MRP计算单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/mrp/new',
        name: 'ScmMrpNew',
        component: () => import('@/views/scm/MrpForm.vue'),
        meta: { title: '新增MRP计算单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/mrp/:id/edit',
        name: 'ScmMrpEdit',
        component: () => import('@/views/scm/MrpForm.vue'),
        meta: { title: '编辑MRP计算单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/mrp/:id',
        name: 'ScmMrpView',
        component: () => import('@/views/scm/MrpForm.vue'),
        meta: { title: 'MRP计算单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/cost-variance',
        name: 'ScmCostVariance',
        component: () => import('@/views/scm/CostVariance.vue'),
        meta: { title: '标准成本差异', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/qc-docs',
        name: 'ScmQc',
        component: () => import('@/views/scm/QcList.vue'),
        meta: { title: '质检管理', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/routings/new',
        name: 'ScmRoutingNew',
        component: () => import('@/views/scm/RoutingForm.vue'),
        meta: { title: '新增工艺路线', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/routings/:id/edit',
        name: 'ScmRoutingEdit',
        component: () => import('@/views/scm/RoutingForm.vue'),
        meta: { title: '编辑工艺路线', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/work-reports/new',
        name: 'ScmWorkReportNew',
        component: () => import('@/views/scm/WorkReportForm.vue'),
        meta: { title: '新增报工', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/work-reports/:id/edit',
        name: 'ScmWorkReportEdit',
        component: () => import('@/views/scm/WorkReportForm.vue'),
        meta: { title: '编辑报工', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/qc-standards',
        name: 'ScmQcStandards',
        component: () => import('@/views/scm/QcStandardList.vue'),
        meta: { title: '检验标准', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/qc-standards/new',
        name: 'ScmQcStandardNew',
        component: () => import('@/views/scm/QcStandardForm.vue'),
        meta: { title: '新增检验标准', parent: '生产管理' },
      },
      {
        path: 'scm/qc-standards/:id/edit',
        name: 'ScmQcStandardEdit',
        component: () => import('@/views/scm/QcStandardForm.vue'),
        meta: { title: '编辑检验标准', parent: '生产管理' },
      },
      {
        path: 'scm/qc-docs/new',
        name: 'ScmQcNew',
        component: () => import('@/views/scm/QcForm.vue'),
        meta: { title: '新增质检单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/qc-docs/:id/edit',
        name: 'ScmQcEdit',
        component: () => import('@/views/scm/QcForm.vue'),
        meta: { title: '编辑质检单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/new',
        name: 'ScmProductionPlanNew',
        component: () => import('@/views/scm/ProductionPlanForm.vue'),
        meta: { title: '新增生产计划', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:id/edit',
        name: 'ScmProductionPlanEdit',
        component: () => import('@/views/scm/ProductionPlanForm.vue'),
        meta: { title: '编辑生产计划', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:planId/change/new',
        name: 'ScmPlanChangeNew',
        component: () => import('@/views/scm/PlanChangeForm.vue'),
        meta: { title: '新建工单变更单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:planId/wip-count/new',
        name: 'ScmWipCountNew',
        component: () => import('@/views/scm/WipCountForm.vue'),
        meta: { title: '在制品盘点', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/wip-counts/:id',
        name: 'ScmWipCountForm',
        component: () => import('@/views/scm/WipCountForm.vue'),
        meta: { title: '在制品盘点', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:id/print',
        name: 'ScmProductionOrderPrint',
        component: () => import('@/views/scm/ProductionOrderPrint.vue'),
        meta: { title: '派工单打印', parent: '生产管理' },
      },
      {
        path: 'scm/plan-changes/:id',
        name: 'ScmPlanChangeForm',
        component: () => import('@/views/scm/PlanChangeForm.vue'),
        meta: { title: '工单变更单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/schedule',
        name: 'ScmAutoSchedule',
        component: () => import('@/views/scm/AutoSchedule.vue'),
        meta: { title: '自动排程', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/order-changes',
        name: 'ScmOrderChangeList',
        component: () => import('@/views/scm/OrderChangeList.vue'),
        meta: { title: '订单变更单', icon: 'Edit', parent: '供应链' },
      },
      {
        path: 'scm/order-changes/new/:docId',
        name: 'ScmOrderChangeNew',
        component: () => import('@/views/scm/OrderChangeForm.vue'),
        meta: { title: '新增订单变更', icon: 'Edit', parent: '供应链' },
      },
      {
        path: 'scm/order-changes/:id',
        name: 'ScmOrderChangeForm',
        component: () => import('@/views/scm/OrderChangeForm.vue'),
        meta: { title: '订单变更单', icon: 'Edit', parent: '供应链' },
      },
      {
        path: 'scm/plan-changes',
        name: 'ScmPlanChangeList',
        component: () => import('@/views/scm/PlanChangeList.vue'),
        meta: { title: '工单变更单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:id',
        name: 'ScmProductionOrder',
        component: () => import('@/views/scm/ProductionOrder.vue'),
        meta: { title: '工单', icon: 'SetUp', parent: '生产管理' },
      },
      {
        path: 'scm/production-plans/:id/downstream',
        name: 'ScmProductionPlanDownstream',
        component: () => import('@/views/scm/DownstreamTrace.vue'),
        meta: { title: '计划上下游追溯', parent: '生产管理' },
      },
      {
        path: 'scm/report',
        name: 'ScmStockReport',
        component: () => import('@/views/scm/StockReport.vue'),
        meta: { title: '收发存汇总', icon: 'DataAnalysis', parent: '供应链' },
      },
      {
        path: 'scm/report/stock-ledger',
        name: 'ScmStockLedger',
        component: () => import('@/views/scm/StockLedger.vue'),
        meta: { title: '物料收发明细账', icon: 'Tickets', parent: '库存' },
      },
      {
        path: 'scm/report/stock-layers',
        name: 'ScmStockLayers',
        component: () => import('@/views/scm/StockLayers.vue'),
        meta: { title: '库存成本层', icon: 'Tickets', parent: '库存' },
      },
      {
        path: 'scm/report/month-avg-costing',
        name: 'ScmMonthAvgCosting',
        component: () => import('@/views/scm/MonthAvgCosting.vue'),
        meta: { title: '全月平均成本计算', icon: 'Tickets', parent: '库存' },
      },
      {
        path: 'scm/report/outsource/execution',
        name: 'ScmOutsourceExecutionReport',
        component: () => import('@/views/scm/OutsourceExecutionReport.vue'),
        meta: { title: '委外执行及结存表', icon: 'DataAnalysis', parent: '委外管理' },
      },
      {
        path: 'scm/report/production/execution',
        name: 'ScmProductionExecutionReport',
        component: () => import('@/views/scm/ProductionExecutionReport.vue'),
        meta: { title: '生产执行及在制结存表', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/production/hours',
        name: 'ScmWorkHoursReport',
        component: () => import('@/views/scm/WorkHoursReport.vue'),
        meta: { title: '工时统计', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/production/daily',
        name: 'ScmProductionDailyReport',
        component: () => import('@/views/scm/ProductionDailyReport.vue'),
        meta: { title: '生产日报', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/production/cost',
        name: 'ScmPlanCostReport',
        component: () => import('@/views/scm/PlanCostReport.vue'),
        meta: { title: '工单成本明细表', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/costing/overhead-variance',
        name: 'ScmOverheadVariance',
        component: () => import('@/views/scm/OverheadVariance.vue'),
        meta: { title: '制费/人工吸收差异结转', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/production/process-wip',
        name: 'ScmProcessWipReport',
        component: () => import('@/views/scm/ProcessWipReport.vue'),
        meta: { title: '工序在制表', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/production/capacity',
        name: 'ScmCapacityLoadReport',
        component: () => import('@/views/scm/CapacityLoadReport.vue'),
        meta: { title: '产能负荷表', icon: 'DataAnalysis', parent: '生产制造' },
      },
      {
        path: 'scm/report/stock-alert',
        name: 'ScmStockAlert',
        component: () => import('@/views/scm/StockAlert.vue'),
        meta: { title: '库存预警', icon: 'Warning', parent: '库存' },
      },
      {
        path: 'scm/report/buysell',
        name: 'ScmBuySellReport',
        component: () => import('@/views/scm/BuySellReport.vue'),
        meta: { title: '购销报表', icon: 'DataAnalysis', parent: '供应链' },
      },
      {
        path: 'scm/report/sales/execution',
        name: 'ScmSalesOrderExecution',
        component: () => import('@/views/scm/SalesOrderExecution.vue'),
        meta: { title: '销售订单执行表', icon: 'DataAnalysis', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/summary',
        name: 'ScmSalesSummaryReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'summary' },
        meta: { title: '销售汇总表', icon: 'DataAnalysis', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/detail',
        name: 'ScmSalesDetailReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'detail' },
        meta: { title: '销售明细表', icon: 'Tickets', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/return',
        name: 'ScmSalesReturnReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'return' },
        meta: { title: '销售退货统计表', icon: 'Undo2', parent: '销售报表' },
      },
      // 退货 / 发票查询表（第四份反馈 Q6 ~ Q8）：逐单逐行，共用 DocQueryReport
      {
        path: 'scm/report/sales/return-query',
        name: 'ScmSalesReturnQuery',
        component: () => import('@/views/scm/DocQueryReport.vue'),
        props: { docType: 'SR' },
        meta: { title: '销售退货查询表', icon: 'Undo2', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/invoice-query',
        name: 'ScmSalesInvoiceQuery',
        component: () => import('@/views/scm/DocQueryReport.vue'),
        props: { docType: 'RS' },
        meta: { title: '销售发票查询表', icon: 'Tickets', parent: '销售报表' },
      },
      {
        path: 'scm/report/purchase/return-query',
        name: 'ScmPurchaseReturnQuery',
        component: () => import('@/views/scm/DocQueryReport.vue'),
        props: { docType: 'PR' },
        meta: { title: '采购退货查询表', icon: 'Undo2', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/invoice-query',
        name: 'ScmPurchaseInvoiceQuery',
        component: () => import('@/views/scm/DocQueryReport.vue'),
        props: { docType: 'RP' },
        meta: { title: '采购发票查询表', icon: 'Tickets', parent: '采购报表' },
      },
      {
        path: 'scm/report/sales/ranking',
        name: 'ScmSalesRankingReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'ranking' },
        meta: { title: '销售排行榜', icon: 'Histogram', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/profit',
        name: 'ScmSalesProfitReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'profit' },
        meta: { title: '销售毛利分析', icon: 'TrendCharts', parent: '销售报表' },
      },
      {
        path: 'scm/report/sales/trend',
        name: 'ScmSalesTrendReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'trend' },
        meta: { title: '销售趋势分析', icon: 'DataLine', parent: '销售报表' },
      },
      {
        path: 'scm/report/purchase/summary',
        name: 'ScmPurchaseSummaryReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'summary', reportType: 'purchase' },
        meta: { title: '采购汇总表', icon: 'DataAnalysis', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/detail',
        name: 'ScmPurchaseDetailReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'detail', reportType: 'purchase' },
        meta: { title: '采购明细表', icon: 'Tickets', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/order-tracking',
        name: 'ScmPurchaseOrderTrackingReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'order_tracking', reportType: 'purchase' },
        meta: { title: '采购订单执行表', icon: 'DocumentChecked', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/ranking',
        name: 'ScmPurchaseRankingReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'ranking', reportType: 'purchase' },
        meta: { title: '采购排行榜', icon: 'Histogram', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/cost',
        name: 'ScmPurchaseCostReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'cost', reportType: 'purchase' },
        meta: { title: '采购成本分析', icon: 'TrendCharts', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/return',
        name: 'ScmPurchaseReturnReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'return', reportType: 'purchase' },
        meta: { title: '采购退货统计表', icon: 'Undo2', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase/trend',
        name: 'ScmPurchaseTrendReport',
        component: () => import('@/views/scm/SalesFixedReport.vue'),
        props: { reportCode: 'trend', reportType: 'purchase' },
        meta: { title: '采购趋势分析', icon: 'DataLine', parent: '采购报表' },
      },
      {
        path: 'scm/report/purchase-advice',
        name: 'ScmPurchaseAdvice',
        component: () => import('@/views/scm/PurchaseAdvice.vue'),
        meta: { title: '采购建议', icon: 'ShoppingCart', parent: '采购管理' },
      },
      {
        path: 'scm/batch-stock',
        name: 'ScmBatchStock',
        component: () => import('@/views/scm/BatchStock.vue'),
        meta: { title: '批次库存', icon: 'Files', parent: '库存' },
      },
      {
        path: 'scm/report/batch-alert',
        name: 'ScmBatchAlert',
        component: () => import('@/views/scm/BatchAlert.vue'),
        meta: { title: '批次临期预警', icon: 'Warning', parent: '库存' },
      },
      {
        path: 'scm/serials',
        name: 'ScmSerialList',
        component: () => import('@/views/scm/SerialList.vue'),
        meta: { title: '序列号查询', icon: 'Tickets', parent: '库存' },
      },
      {
        path: 'scm/arap',
        name: 'ScmPartnerLedger',
        component: () => import('@/views/scm/PartnerLedger.vue'),
        meta: { title: '往来余额表', icon: 'Money', parent: '往来管理' },
      },
      {
        // 往来明细账：复用同一 PartnerLedger 页面，独立路由/标题，作为另一个菜单入口
        path: 'scm/arap-detail',
        name: 'ScmPartnerLedgerDetail',
        component: () => import('@/views/scm/PartnerLedger.vue'),
        meta: { title: '往来明细账', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/arap-verify',
        name: 'ScmArApVerify',
        component: () => import('@/views/scm/ArApVerify.vue'),
        meta: { title: '往来核销', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/arap-verify-records',
        name: 'ScmArApVerifyRecords',
        component: () => import('@/views/scm/ArApVerifyRecords.vue'),
        meta: { title: '核销单记录', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/arap-verify-records/:verifyNo',
        name: 'ScmArApVerifyRecord',
        component: () => import('@/views/scm/ArApVerifyRecord.vue'),
        meta: { title: '核销单', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/arap-due',
        name: 'ScmArApDueReminder',
        component: () => import('@/views/scm/ArApDueReminder.vue'),
        meta: { title: '到期提醒/信用', icon: 'Money', parent: '往来管理' },
      },
      {
        // 对账单：逐笔往来 + 可展开单据明细行，支持按单个往来单位打印
        path: 'scm/arap-statement',
        name: 'ScmPartnerStatement',
        component: () => import('@/views/scm/PartnerStatement.vue'),
        meta: { title: '往来对账查询', icon: 'Money', parent: '往来管理' },
      },
      {
        // 对账单（单据化，第四份反馈 Q2）：列表 / 新增 / 查看编辑 / 打印 / 对账明细表
        path: 'scm/statements',
        name: 'ScmStatementList',
        component: () => import('@/views/scm/StatementList.vue'),
        meta: { title: '对账单', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/statements/new',
        name: 'ScmStatementNew',
        component: () => import('@/views/scm/StatementForm.vue'),
        meta: { title: '新增对账单', parent: '往来管理' },
      },
      {
        path: 'scm/statements/detail-report',
        name: 'ScmStatementDetailReport',
        component: () => import('@/views/scm/StatementDetailReport.vue'),
        meta: { title: '对账明细表', parent: '往来管理' },
      },
      {
        path: 'scm/statements/:id/print',
        name: 'ScmStatementPrint',
        component: () => import('@/views/scm/StatementPrint.vue'),
        meta: { title: '对账单打印', parent: '往来管理' },
      },
      {
        path: 'scm/statements/:id',
        name: 'ScmStatementForm',
        component: () => import('@/views/scm/StatementForm.vue'),
        meta: { title: '对账单', parent: '往来管理' },
      },
      {
        // 对账单打印预览（独立页，query 传 partner_code/start_date/end_date/arap_type）
        path: 'scm/arap-statement/print',
        name: 'ScmPartnerStatementPrint',
        component: () => import('@/views/scm/PartnerStatementPrint.vue'),
        meta: { title: '对账单打印', parent: '往来管理' },
      },
      {
        path: 'scm/arap-fx-reval',
        name: 'ScmArApFxRevaluation',
        component: () => import('@/views/scm/ArApFxRevaluation.vue'),
        meta: { title: '往来汇率重估', parent: '往来管理' },
      },
      {
        path: 'scm/arap-aging',
        name: 'ScmArApAging',
        component: () => import('@/views/scm/ArApAging.vue'),
        meta: { title: '应收应付账龄', icon: 'Money', parent: '往来管理' },
      },
      {
        path: 'scm/boms',
        name: 'ScmBomList',
        component: () => import('@/views/scm/BomList.vue'),
        meta: { title: '物料清单(BOM)', icon: 'Connection', parent: '供应链' },
      },
      {
        path: 'scm/boms/new',
        name: 'ScmBomNew',
        component: () => import('@/views/scm/BomForm.vue'),
        meta: { title: '新增BOM', parent: '供应链' },
      },
      {
        path: 'scm/boms/:id/edit',
        name: 'ScmBomEdit',
        component: () => import('@/views/scm/BomForm.vue'),
        meta: { title: '编辑BOM', parent: '供应链' },
      },
      {
        path: 'scm/boms/:id/tree',
        name: 'ScmBomTree',
        component: () => import('@/views/scm/BomTree.vue'),
        meta: { title: 'BOM多级展开', parent: '供应链' },
      },
      {
        path: 'scm/boms/where-used',
        name: 'ScmBomWhereUsed',
        component: () => import('@/views/scm/BomWhereUsed.vue'),
        meta: { title: 'BOM反查用途', parent: '供应链' },
      },
      {
        path: 'scm/sales-order-relations',
        name: 'ScmSalesOrderRelations',
        component: () => import('@/views/scm/SalesOrderRelations.vue'),
        meta: { title: '销售订单关联表', icon: 'Connection', parent: '销售管理' },
      },
      {
        path: 'scm/docs',
        name: 'ScmDocList',
        component: () => import('@/views/scm/DocList.vue'),
        meta: { title: '供应链单据', icon: 'Document', parent: '供应链' },
      },
      {
        path: 'scm/col-schemes',
        name: 'ScmColSchemeManager',
        component: () => import('@/views/scm/ColSchemeManager.vue'),
        meta: { title: '列方案设置', parent: '供应链' },
      },
      {
        path: 'scm/doc-field-defs',
        name: 'ScmDocFieldDefs',
        component: () => import('@/views/scm/DocFieldDefs.vue'),
        meta: { title: '单据自定义字段', parent: '供应链' },
      },
      {
        // 物料 / 往来单位 Excel 导入（第六份反馈）：?kind=items|partners
        path: 'scm/master-import',
        name: 'ScmMasterImport',
        component: () => import('@/views/scm/MasterImport.vue'),
        meta: { title: '档案导入', parent: '供应链' },
      },
      {
        // 润衡进销存（POS）备份独立导入：预检 → 导入 → 核对报告 → 导入历史 / 撤销
        path: 'scm/acd-import',
        name: 'ScmAcdImport',
        component: () => import('@/views/scm/AcdImport.vue'),
        meta: { title: '进销存ACD导入', parent: '供应链' },
      },
      {
        path: 'scm/docs/import',
        name: 'ScmDocImport',
        component: () => import('@/views/scm/DocImport.vue'),
        meta: { title: '单据批量导入', parent: '供应链' },
      },
      {
        path: 'scm/docs/new',
        name: 'ScmDocNew',
        component: () => import('@/views/scm/DocForm.vue'),
        meta: { title: '新增单据', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/edit',
        name: 'ScmDocEdit',
        component: () => import('@/views/scm/DocForm.vue'),
        meta: { title: '编辑单据', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/dispatch',
        name: 'ScmDocDispatch',
        component: () => import('@/views/scm/StockDispatch.vue'),
        meta: { title: '库存处理/生成MRP计算单', parent: '供应链' },
      },
      {
        // 多张销售订单合并出库：先在库存对比预览页确认本次发货（按订单剩余 × 可用库存），
        // 再生成销售出库（SO）草稿，行级 source_line_id 溯源到各源单。
        path: 'scm/docs/batch-dispatch',
        name: 'ScmDocBatchDispatch',
        component: () => import('@/views/scm/MultiDispatch.vue'),
        meta: { title: '合并出库 / 多订单库存对比', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/mr-push-preview',
        name: 'ScmMrPushPreview',
        component: () => import('@/views/scm/MrPushPreview.vue'),
        meta: { title: '分层下推预览', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/downstream',
        name: 'ScmDocDownstream',
        component: () => import('@/views/scm/DownstreamTrace.vue'),
        meta: { title: '下游单据追溯', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/cost',
        name: 'ScmDocCost',
        component: () => import('@/views/scm/DocCostDetail.vue'),
        meta: { title: '成本明细', parent: '供应链' },
      },
      {
        path: 'scm/docs/batch-print',
        name: 'ScmDocBatchPrint',
        component: () => import('@/views/scm/ScmDocBatchPrint.vue'),
        meta: { title: '批量单据打印', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id/print',
        name: 'ScmDocPrint',
        component: () => import('@/views/scm/ScmDocPrint.vue'),
        meta: { title: '单据打印', parent: '供应链' },
      },
      {
        path: 'scm/docs/:id',
        name: 'ScmDocView',
        component: () => import('@/views/scm/DocForm.vue'),
        meta: { title: '查看单据', parent: '供应链' },
      },
      {
        path: 'asset/detail/:id',
        name: 'AssetDetail',
        component: () => import('@/views/asset/AssetDetail.vue'),
        meta: { title: '资产明细账', parent: '固定资产' },
      },
      {
        path: 'asset/change',
        name: 'AssetChange',
        component: () => import('@/views/asset/AssetChange.vue'),
        meta: { title: '资产变动', icon: 'Switch', parent: '固定资产' },
      },
      {
        path: 'asset/change/list',
        name: 'AssetChangeList',
        component: () => import('@/views/asset/AssetChangeList.vue'),
        meta: { title: '资产变动记录', parent: '固定资产' },
      },
      {
        path: 'asset/import',
        name: 'AssetImport',
        component: () => import('@/views/asset/AssetImport.vue'),
        meta: { title: '资产批量导入', parent: '固定资产' },
      },
      {
        path: 'asset/requisition',
        name: 'AssetRequisition',
        component: () => import('@/views/asset/AssetRequisition.vue'),
        meta: { title: '领用归还', icon: 'User', parent: '固定资产' },
      },
      {
        path: 'asset/depreciation',
        name: 'AssetDepreciation',
        component: () => import('@/views/asset/Depreciation.vue'),
        meta: { title: '折旧计提', icon: 'TrendCharts', parent: '固定资产' },
      },
      {
        path: 'asset/depreciation/query',
        name: 'AssetDepreciationQuery',
        component: () => import('@/views/asset/DepreciationQuery.vue'),
        meta: { title: '折旧查询', parent: '固定资产' },
      },
      {
        path: 'asset/depreciation/reverse',
        name: 'AssetDepreciationReverse',
        component: () => import('@/views/asset/DepreciationReverse.vue'),
        meta: { title: '取消折旧', parent: '固定资产' },
      },
      {
        path: 'asset/vouchers',
        name: 'AssetVoucherManage',
        component: () => import('@/views/asset/AssetVoucherManage.vue'),
        meta: { title: '凭证管理', icon: 'Tickets', parent: '固定资产' },
      },
      {
        path: 'asset/vouchers/regenerate',
        name: 'AssetVoucherRegenerate',
        component: () => import('@/views/asset/AssetVoucherRegenerate.vue'),
        meta: { title: '重新生成凭证', parent: '固定资产' },
      },
      {
        path: 'asset/report',
        name: 'AssetReport',
        component: () => import('@/views/asset/AssetReport.vue'),
        meta: { title: '资产报表', icon: 'DataAnalysis', parent: '固定资产' },
      },
      {
        path: 'asset/inventory',
        name: 'AssetInventory',
        component: () => import('@/views/asset/AssetInventory.vue'),
        meta: { title: '资产盘点', icon: 'Checked', parent: '固定资产' },
      },
      {
        path: 'cashier/accounts-manage',
        name: 'CashierAccountManage',
        component: () => import('@/views/cashier/CashierAccountManage.vue'),
        meta: { title: '出纳账户', icon: 'Wallet', parent: '基础设置' },
      },
      {
        path: 'cashier/settle-type',
        name: 'CashierSettleType',
        component: () => import('@/views/cashier/SettleType.vue'),
        meta: { title: '结算方式', icon: 'Finished', parent: '基础设置' },
      },
      {
        path: 'asset/dict',
        name: 'AssetDict',
        component: () => import('@/views/asset/AssetDict.vue'),
        meta: { title: '资产档案', icon: 'Setting', parent: '基础设置' },
      },
      // 数据安全
      {
        path: 'security/backup',
        name: 'Backup',
        component: () => import('@/views/security/Backup.vue'),
        meta: { title: '备份恢复', icon: 'Box', parent: '数据安全' },
      },
      // 分组导航页
      {
        path: 'group/:groupTitle',
        name: 'GroupNav',
        component: () => import('@/views/GroupNav.vue'),
        meta: { title: '模块导航' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 切换过程中的进度条与特效降级，注册在业务守卫之前，重定向也能覆盖到
setupRouteSwitchingIndicator(router)

router.beforeEach(async (to, _from, next) => {
  const userStore = useUserStore()
  const systemParamsStore = useSystemParamsStore()
  const licenseStore = useLicenseStore()

  await licenseStore.ensureStatus()

  if (to.path !== '/activate' && licenseStore.needsActivation) {
    next('/activate')
    return
  }
  if (to.path === '/activate' && licenseStore.isValid) {
    next('/login')
    return
  }
  // 注册码里授权的模块：菜单、路由都按它裁剪，未授权模块的页面落回可访问首页
  const licensedModules = licenseStore.modules

  await userStore.bootstrapAuth()
  // 带 targetAccountSetId 参数的登录请求，跳转前先清除 token
  if (to.path === '/login' && to.query.targetAccountSetId && userStore.token) {
    userStore.token = ''
    userStore.userInfo = null
    userStore.accountSetId = ''
    userStore.accountSetName = ''
    userStore.authBootstrapped = false
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
    localStorage.removeItem('accountSetId')
    localStorage.removeItem('accountSetName')
    systemParamsStore.reset()
    next()
  } else if (to.meta.requiresAuth !== false && !userStore.token) {
    // 未勾选「记住账号密码」时清掉已保存的账号，但不影响上次账套
    if (localStorage.getItem(REMEMBER_ME_KEY) !== 'true') {
      clearRememberedLogin()
      userStore.rememberMe = false
    }
    next('/login')
  } else if (to.path === '/login' && userStore.token) {
    await systemParamsStore.load()
    next(
      getDefaultLandingPath(
        userStore.permissions,
        systemParamsStore.enableCashFlow,
        licensedModules,
        getStoredHomePage()
      )
    )
  } else if (to.meta.requiresCashFlow) {
    await systemParamsStore.load()
    if (!systemParamsStore.enableCashFlow) {
      // 直接跳走会让人以为「点了没反应」，说明原因再跳
      ElMessage.warning('该账套未启用现金流核算，请先在账套参数中开启')
      next('/system/param')
    } else if (!canAccessRoute(to.fullPath, userStore.permissions, licensedModules)) {
      const landing = resolveAccessiblePath(
        to.fullPath,
        userStore.permissions,
        systemParamsStore.enableCashFlow,
        licensedModules
      )
      next(landing === normalizePath(to.path) ? '/forbidden' : { path: landing, replace: true })
    } else {
      next()
    }
  } else if (to.meta.requiresForeignCurrency) {
    await systemParamsStore.load()
    if (!systemParamsStore.enableForeignCurrency) {
      ElMessage.warning('该账套未启用外币核算，请先在账套参数中开启')
      next('/system/param')
    } else if (!canAccessRoute(to.fullPath, userStore.permissions, licensedModules)) {
      const landing = resolveAccessiblePath(
        to.fullPath,
        userStore.permissions,
        systemParamsStore.enableCashFlow,
        licensedModules
      )
      next(landing === normalizePath(to.path) ? '/forbidden' : { path: landing, replace: true })
    } else {
      next()
    }
  } else if (
    to.meta.requiresAuth !== false &&
    userStore.token &&
    to.path !== '/forbidden' &&
    !canAccessRoute(to.fullPath, userStore.permissions, licensedModules)
  ) {
    await systemParamsStore.load()
    const landing = resolveAccessiblePath(
      to.fullPath,
      userStore.permissions,
      systemParamsStore.enableCashFlow,
      licensedModules
    )
    next(landing === normalizePath(to.path) ? '/forbidden' : { path: landing, replace: true })
  } else {
    next()
  }
})

export default router
