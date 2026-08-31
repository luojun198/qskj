# 当前任务

> 这个文件用于跟踪项目的当前任务状态。Claude 会读取和更新这个文件。

## 进行中

- [ ] PAY/RCV 收付款生成凭证（当前 cat='finance' 无 gen-voucher 分支）

## 待办

- [ ] TR/CK 调拨盘点审核实测（需补建测试单据）

## 已完成（近期）

- [x] 面包屑导航模块名称可点击，返回模块主页（2026-06-16）
  - 在 Layout.vue 中为模块名称添加点击处理
  - 添加 navigateToModuleHome 方法导航到 /group/:groupTitle
  - 样式：薄荷绿色链接、悬停效果、过渡动画
- [x] 主页（财务驾驶舱）整体重设计：迁移「财务洗头膏」薄荷设计系统（Hero 泡泡横幅 / 指标卡 / 布局重排 / ECharts 色板 / 风险项可点击跳转）(2026-06-10)
- [x] AS/DS 组装拆卸按 BOM 配料：审核（子件↔成品双向库存移动，成本自动分配）+ 生成凭证（存货↔生产成本对开，借贷平衡）
- [x] 订单下推功能（PO→PI / SOa→SO）：DocList 下推按钮 + DocForm 源单加载 + source_doc_id 关联
- [x] 供应链全流程端到端联调（2026-06-08）：PI/SO/PF/PL/PO→PI/SOa→SO/AS/DS 均通过 新增→审核→生成凭证 全链路
- [x] FIX-019：修复供应商科目编码（全部 55 个 partner 的 ap/ar_account 无效值清空，回退到系统参数）
- [x] FIX-018 端到端验证通过：gen-voucher 借贷配平、发票应收应付、调拨/盘点审核

- [x] 修复辅助期初页切换账套报错 (2026-05-24)
- [x] 修复 ACD 导入后 admin 超管无法登录 (2026-05-24)
- [x] 现金流量表 P0–P5（多口径统一、完整打印导出）(2026-05-20)

## 已完成

- [x] 优化构建配置以支持严格类型检查 (2026-05-15)
  - 清理所有 noUnusedLocals/noUnusedParameters 警告（涉及 30+ 个文件）
  - 在 client/tsconfig.json 中启用严格未使用检查：
    - `"noUnusedLocals": true`
    - `"noUnusedParameters": true`
  - 验证结果：
    - ✅ `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过（0 个错误）
    - ✅ `npx vue-tsc --noEmit` 通过（EXIT:0）

- [x] 修复前端 TypeScript 类型错误（第二轮，全部清零）(2026-05-15)
  - AuxDetail.vue：`res.total` / `res.initBalance` 改为 `(res as any).xxx`
  - AuxBalance.vue：`.map(cat =>` 补全 `(cat: any)` 类型
  - useConfirm.ts：接口/解构/调用处补全 `showCancelButton` 字段，修复 Project.vue 间接报错
  - DynamicReport.vue：`executionCell?.numeric_value` → `(executionCell as any)?.numeric_value`；`sheet.metrics.colWidths` → `(sheet.metrics as any).colWidths`
  - TransferType.vue：布尔联合返回值加 `!!` 强制转 boolean
  - VoucherFilterBar.vue：`:value="null"` → `:value="(null as any)"`
  - KeyboardShortcuts.vue：`@keydown` 事件显式转型为 `KeyboardEvent`
  - print.ts：`TableColumn` 接口补充 `showPaddingSettings?: boolean`
  - TemplateDesigner.vue：拖拽/缩放回调参数补全类型；mock 数据补 `account_set_name`；模板访问 `showPaddingSettings` 改为 `(col as any)`
  - 新增 `src/types/vue-draggable-resizable.d.ts`（第三方组件类型声明）
  - VoucherEntryForm.vue：摘要列 slot 补 `$index` 解构；`@update:model-value` 参数改为 `string | number`；`@select` item 类型改为 `any`；`setCurrentEntry(null as any)`；`HTMLElement` → `HTMLInputElement | null` 并直接调用 `select()`
  - 验证结果：
    - ✅ `npx vue-tsc --noEmit` 通过（0 个错误）
    - ✅ 前端单元测试：5 个测试文件，29 个用例全部通过

- [x] 修复登录页用户名输入框无法手动输入的问题 (2026-05-15)
  - 将登录页用户名组件从 `el-select` 改为 `el-autocomplete`
  - 保留账套用户列表联想能力，同时允许直接手动输入如 `admin`
  - 新增 `queryUsers` 过滤函数，按用户名/昵称提供建议
  - 将 `LoginForm` 中的 `captcha` / `captchaId` 改为可选，匹配当前登录页实际调用
  - 验证结果：
    - ✅ 登录相关前端类型检查通过
    - ✅ 前端单元测试 29 个用例全部通过

- [x] 修复前端 TypeScript 类型错误（第一轮）(2026-05-14)
  - 修复 useVoucherQuery.ts 中的 filters 类型声明
  - 修复 useBatchAuditDialog.ts 中的索引类型问题
  - 修复 useDebounceThrottle.ts 中的 require 问题，改用 import
  - 修复 useSearchMemory.ts 的返回类型，从 T 改为 Ref<T>
  - 进度：前端类型错误从90个减少到42个
  - 剩余问题：
    - 约42个前端类型错误（主要是组件属性类型、Vue 模板类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第六轮 - 完成）(2026-05-14)
  - 修复 voucherPosting.test.ts 中的所有类型错误，使用 Partial<VoucherEntryLike> 和类型断言
  - 修复 testExcelImportScript.ts 中的导入路径（.ts -> .js）
  - 修复 testModels.ts 中的函数参数类型和错误类型
  - 修复 testXlsxModule.ts 中的 path 导入问题
  - 修复 db/index.ts 中的 initDatabase 返回类型问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 后端 TypeScript 类型检查：0个错误
  - 进度：后端类型错误从17个减少到0个
  - **后端 TypeScript 类型错误已全部修复完成！**
  - 剩余问题：
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第五轮）(2026-05-14)
  - 修复 voucherPosting.ts 中的 VoucherEntryLike 接口，支持 number 类型的辅助核算字段
  - 修复 autoTransfer.ts 中的 createTransferVoucherForType 函数签名，使用 Database 类型
  - 修复 importExcelReport.ts 中的 async/await 问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 非测试和非脚本文件：0个类型错误
  - 进度：后端类型错误从20个减少到17个
  - 剩余问题：
    - 后端约17个类型错误（全部是测试文件和脚本文件的类型问题，不影响生产代码）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第四轮）(2026-05-14)
  - 修复 voucher.ts 中的 auxItems 数组类型过滤和 attachmentCount 类型断言
  - 修复 voucherPeriod.ts 中的 year 参数类型问题
  - 修复 voucherEntry.ts 中的函数签名，统一使用 Database 类型：
    - deleteVoucherRecords
    - auditBatchVouchers
    - deleteBatchVouchers
  - 修复 autoTransfer.ts 中的 createAllTransferVouchers 函数签名
  - 修复 voucherAutoTransfer.ts 中的 error 属性类型守卫
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
  - 进度：后端类型错误从27个减少到23个
  - 剩余问题：
    - 后端约23个类型错误（其中19个是测试文件 voucherPosting.test.ts 的 VoucherEntryLike 类型问题，4个是 scripts 文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第三轮）(2026-05-14)
  - 修复 reportEquity.ts 中的 req.accountSetId 类型错误（7处）
  - 修复 reportIncomeStatement.ts 中的 req.accountSetId 类型错误（4处）
  - 修复 task.ts 中的 userId 和 userName 类型错误（8处）
  - 修复 backup.ts 中的 filepath 缺失和 accountSetId 类型错误（2处）
  - 修复 reportAi.ts 中的 data 类型错误（使用 as any）
  - 修复 reportTemplate.ts 和 reportTemplateExecutor.ts 中的 Database 类型兼容性问题
  - 修复 voucher.ts 中的 auxItems 数组类型转换和 user.id 错误
  - 修复 autoTransfer.ts 中的 userId/userName null 类型问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
  - 进度：后端类型错误从57个减少到27个
  - 剩余问题：
    - 后端约27个类型错误（主要是测试文件类型问题、Database 类型兼容性、scripts 文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第二轮）(2026-05-14)
  - 修复 auth.ts 中的变量作用域问题（accountsMap、vouchersMap、entryCount）
  - 修复 process.pkg 和 Database.OPEN_READONLY 的类型错误
  - 修复 reportBalance.ts 中的 BalanceQueryDb 类型兼容性问题
  - 批量修复所有函数签名，支持 Database | BalanceQueryDb 联合类型
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 前端单元测试：29个测试用例全部通过
  - 进度：后端类型错误从63个减少到57个
  - 剩余问题：
    - 后端约57个类型错误（主要是 string | undefined 类型问题、测试文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 导入路径问题 (2026-05-14)
  - 批量修复后端 ES 模块导入路径（添加 .js 扩展名）
  - 修复 process.pkg 类型错误（使用 as any 类型断言）
  - 修复前端部分类型错误（API 响应类型、组件属性类型等）
  - 测试结果：后端单元测试仍然全部通过（36个测试用例）
  - 剩余问题：
    - 后端约63个类型错误（主要是 Database 类型不兼容、测试文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] Phase 5: 测试与优化 (2026-05-14)
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 前端单元测试：29个测试用例全部通过
    - ✅ 前端构建：成功（跳过类型检查）
    - ⚠️ 后端构建：存在类型错误（主要是导入路径和类型断言问题）
    - ⚠️ 代码质量检查：3486个问题（402个错误，3084个警告）
  - 主要问题：
    - 项目根目录存在大量临时测试脚本文件，导致 lint 错误
    - TypeScript 类型定义不够严格，存在 any 类型和类型断言问题
    - 后端 ES 模块导入路径需要 .js 扩展名
  - 优化建议：
    - 清理项目根目录的临时测试脚本
    - 完善 TypeScript 类型定义
    - 考虑代码分割优化（index.js 文件 1.2MB）

## 已完成

- [x] Phase 4: 打印与导出功能实现 (可选,已有基础导出) (2026-05-14)
  - 打印：已具备单张/批量凭证打印、模板选择、打印预览、分页打印能力
  - 模板：已具备模板管理（新增/编辑/删除/设默认）与可视化设计器能力
  - 数据：已具备后端打印模板接口与凭证打印数据接口
  - 导出：已有基础导出能力（账簿相关页面已包含导出入口）
- [x] 总账日期筛选改为开始日期和结束日期区间查询 (2026-04-21)
  - 前端: 将年份/期间选择器改为日期选择器
  - 后端: 重写查询逻辑,使用子查询计算期初余额、本期发生额、期末余额
  - 期初余额 = 期初余额表 + 开始日期之前的凭证分录
  - 本期发生额 = 开始日期到结束日期之间的凭证分录
  - 期末余额 = 期初余额表 + 结束日期及之前的所有凭证分录
  - 使用子查询包装解决HAVING子句错误
  - 测试验证: 查询2026-04-01至2026-04-30期间,正确返回5个有发生额的科目
- [x] 改进总账筛选为多选复选框 (2026-04-21)
  - 将单选改为多选复选框，支持任意组合
  - 有期初: 期初余额不为0
  - 有发生额: 借方或贷方发生额不为0
  - 有余额: 期末余额不为0
  - 多个条件使用OR逻辑连接
  - 不选任何条件时显示全部科目
- [x] 实现总账三项单选筛选功能 (2026-04-21)
- [x] 修复HAVING子句别名问题 (2026-04-21)
- [x] 修复总账查询参数顺序错误 (2026-04-21)
- [x] 修复总账和余额表科目重复显示问题 (2026-04-21)
- [x] Phase 3: 前端组件开发 - 优化各账簿页面 (2026-04-21)
- [x] Phase 2: 后端API增强 - 优化查询构建器 (2026-04-21)
- [x] Phase 1: 数据库优化 - 添加新字段和索引 (2026-04-21)
  - 添加 voucher_entries 表的 quantity, unit_price, unit 字段
  - 添加 accounts 表的 ledger_format 字段
  - 添加查询优化索引
- [x] 修改结转逻辑：当转出科目为父科目时，在结转预览中显示所有子科目明细，而不是只显示父科目汇总 (2026-04-21)
  - 添加 `isParentAccount` 函数检查科目是否有子科目
  - 添加 `getChildrenBalances` 函数获取所有子科目余额
  - 修改 `getPeriodEndBalanceByCode` 函数，父科目返回子科目数组，明细科目返回单个对象
  - 修改 `buildEntriesFromTransferItems` 函数，支持处理数组返回值，为每个子科目生成单独的分录
---

## 使用说明

### 任务状态
- `- [ ]` 待办/进行中
- `- [x]` 已完成

### 分类
- **进行中**: 当前正在处理的任务
- **待办**: 计划要做但还没开始的任务
- **已完成**: 已经完成的任务

### 更新方式
1. Claude 会在工作时自动更新这个文件
2. 你也可以直接编辑这个文件
3. 下次会话时，Claude 会读取这个文件来了解任务状态
