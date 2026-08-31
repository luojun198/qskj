# ACD一键导入功能方案

## 产品概述

一键从润衡财务软件的ACD账套备份文件导入完整财务数据到当前系统，包括科目、结转关系、报表模板和凭证。

## 核心功能

- 用户在登录页面选择.acd文件后，系统自动解析并导入所有数据到新建账套
- 导入科目编码表（kmbm.txt）→ accounts表，含科目层级、余额方向、现金/银行标志
- 导入年初余额（nc.txt）→ init_balances表，提取实际借方/贷方余额值
- 导入结转关系（jzlx.txt）→ transfer_types + transfer_items表，自动建立结转类型和结转分录
- 导入凭证数据（pz.txt + pzdj.txt）→ vouchers + voucher_entries表，含凭证主表和分录明细
- 导入凭证类型（pzlx.txt）→ voucher_types表
- 导入报表模板（bbml.txt + bb*.vts）→ report_definitions等报表系列表
- 导入系统参数（xt.txt）→ system_params表
- 导入辅助核算主数据（xmk/dwk/bmk/grk/xjll_xm/zjly）→ aux_items；其中 **xjll_xm（现金流量项目）** 含 `jd` 流向：`0`=流入、`1`=流出，同步写入 `cash_flow_items.direction`
- 导入完成后显示各模块导入数量统计
- 支持文件格式校验，非ACD文件或损坏文件给出友好提示

## 技术栈

- 后端：Node.js + Express + TypeScript + better-sqlite3
- 前端：Vue 3 + Element Plus + TypeScript
- ACD解析：zlib解压 + iconv-lite(GBK解码)
- 数据库：SQLite

## 实现方案

### 核心策略

复用现有 `importAcdToCurrentAccountSet.ts` 中的ACD解析和导入逻辑，将其改造为可从API路由调用的服务模块，并补全结转关系导入、凭证导入、期初余额修复三大缺失功能。

### 关键技术决策

1. **复用而非重写**：`importAcdToCurrentAccountSet.ts` 已有完整的ACD解析（parseAcdTables）、科目导入、报表导入逻辑，将其重构为可导入的服务模块，新增缺失的结转和凭证导入函数
2. **ACD导入 vs SQLite备份导入区分**：现有 `/auth/backup-import` 处理SQLite格式备份；新增 `/auth/acd-import` 专门处理ACD格式文件，两者共存
3. **凭证数据映射**：pz.txt每行是一条分录（非凭证主表），通过 nf+yf+pzlx+pzbh 组合键聚合为一张凭证，pzdj.txt提供凭证级别信息（制单人、审核人等）
4. **结转关系映射**：jzlx.txt中每行代表一个结转分录，按结转类型代码（10/20/60/70/80等）分组为transfer_types，每行映射为transfer_items
5. **期初余额修复**：nc.txt中列索引对应为：row[0]=科目代码, row[2]=年初借方, row[3]=年初贷方, row[4]=借方累计, row[5]=贷方累计, row[6]=余额方向标志, row[14]=年度；当前代码只插入0，需提取实际金额
6. **现金流量流向**：xjll_xm 表结构为 row[0]=xjbm(编码), row[1]=xjmc(名称), row[2]=jd(流向)；导入时双写 aux_items.field_values 与 cash_flow_items

### 性能考虑

- ACD文件上传限制设为50MB（含凭证的账套可能较大）
- 使用SQLite事务包裹整个导入过程，失败时回滚
- 批量插入使用prepared statement，避免重复编译

## 架构设计

```
前端Login.vue → POST /auth/acd-import → parseAcdTables
  → importSystemParams
  → importVoucherTypes
  → importAccounts
  → importInitBalances
  → importTransferTypes
  → importVouchers
  → importReportTemplates
  → 返回导入统计
```

## 目录结构

```
server/src/
├── scripts/
│   └── importAcdToCurrentAccountSet.ts  # [MODIFY] 重构为可服务化调用，新增结转/凭证/余额导入函数
├── routes/
│   └── auth.ts                          # [MODIFY] 新增 /acd-import 路由端点
└── services/
    └── acdImport.ts                     # [NEW] ACD导入服务层，封装导入逻辑供路由调用

client/src/
├── api/
│   └── auth.ts                          # [MODIFY] 新增 acdImport() API函数和类型定义
└── views/
    └── Login.vue                        # [MODIFY] 新增ACD文件导入入口和交互
```

## 文件详细说明

### server/src/scripts/importAcdToCurrentAccountSet.ts [MODIFY]

- 保留：parseAcdFileTables、parseAcdTables、splitTableRows、decodeTableContent等解析函数
- 保留：importSystemParams、importVoucherTypes、importAccounts、importReportTemplates
- 修复：importInitBalances - 从nc.txt提取实际余额值（nc_jf=row[2], nc_df=row[3]），计算init_balance
- 新增：importTransferTypes - 解析jzlx.txt，按结转类型代码分组写入transfer_types和transfer_items
- 新增：importVouchers - 解析pz.txt+pzdj.txt，聚合分录写入vouchers和voucher_entries
- 修改：runImport函数增加结转和凭证导入步骤，支持从Buffer而非文件路径解析
- 导出：将核心函数导出供acdImport.ts服务层调用

### server/src/services/acdImport.ts [NEW]

- 封装ACD导入为可从路由调用的服务函数
- 输入：ACD文件Buffer + 账套信息（名称、编码、会计年度）
- 输出：导入统计结果（各模块导入数量）
- 创建新账套 → 执行导入 → 返回结果
- 处理临时文件写入和清理

### server/src/routes/auth.ts [MODIFY]

- 新增 `POST /auth/acd-import` 路由
- 使用upload.single('file')处理文件上传
- 调用acdImport服务，返回导入结果
- 无需auth中间件（登录前使用）

### client/src/api/auth.ts [MODIFY]

- 新增AcdImportResult类型定义（含各模块导入统计）
- 新增acdImport()函数，发送multipart/form-data请求

### client/src/views/Login.vue [MODIFY]

- 新增"导入ACD账套"按钮（与现有"导入账套"并列）
- 新增ACD导入弹窗，包含文件选择、账套名称、编码、会计年度等字段
- 导入过程显示loading状态
- 导入完成后显示统计结果并自动选中账套

## ACD数据文件结构参考

### jzlx.txt（结转类型）字段映射
| 列索引 | 含义 | 示例 |
|--------|------|------|
| 0 | 结转类型代码 | 10, 20, 60, 70, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98 |
| 1 | 凭证类型 | 记账凭证 |
| 2 | （空列） | |
| 3 | 结转大类名 | 结转本期收入, 结转本期支出, 结转盈余等 |
| 4 | 摘要 | 结转本期收入 |
| 5 | 转出科目代码 | 4001 |
| 6 | 转入科目代码 | 3001 |
| 7 | 比例 | 1.0 |

### pz.txt（凭证分录）字段映射
| 列索引 | 字段名 | 含义 |
|--------|--------|------|
| 0 | nf | 年份 |
| 1 | yf | 月份 |
| 2 | pzlx | 凭证类型 |
| 3 | pzbh | 凭证编号 |
| 4 | pz_xh | 分录序号 |
| 5 | kmbm | 科目编码 |
| 6 | pz_zy | 摘要 |
| 7 | pz_jf | 借方金额 |
| 8 | pz_df | 贷方金额 |
| 9-10 | pz_wb, pz_hl | 外币金额, 汇率 |
| 11-12 | pz_sl, pz_dj | 数量, 单价 |
| 13 | jslb | 结算类别 |
| 14 | pz_ph | 票号 |
| 15 | jzbz | 记账标志 |

### pzdj.txt（凭证登记）字段映射
| 列索引 | 字段名 | 含义 |
|--------|--------|------|
| 0 | nf | 年份 |
| 1 | yf | 月份 |
| 2 | pzlx | 凭证类型 |
| 3 | pzbh | 凭证编号 |
| 4 | pzdj_fds | 分录数 |
| 5 | pzdj_bz | 标志 |
| 6 | pzdj_zdr | 制单人 |
| 7 | pzdj_shr | 审核人 |
| 8 | pzdj_jzr | 记账人 |
| 9 | pzdj_rq | 日期 |
