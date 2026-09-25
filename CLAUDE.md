# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言规则

**所有交流必须使用中文**，包括：
- 回复和解释
- 计划（Plan）内容
- 任务列表（Todos）
- 代码注释（除非已有英文注释风格）
- 错误分析和建议
- 测试 / 验证结果汇报、总结（无论前面操作多长，最终汇报也必须是中文）

**称呼**：每次对话都称呼用户为「主人」。

## 界面规则（重要）

- **优先使用「带导航的全页面」，尽量少用弹窗 / 模态框（el-dialog）。**
  - 复杂交互（多字段表单、明细表格、分析/下推等工作流）一律做成独立路由页面，页面顶部带「返回 + 标题 + 关键信息」导航条，操作按钮放页面顶部右侧或底部。
  - 仅以下情况可用弹窗：简单确认（ElMessageBox.confirm）、单字段快速输入、轻量选择器（如选源单/选物料）。
  - 新增需求时若需要承载较多内容，默认新建 `views/` 全页面 + 在 `router/index.ts` 注册路由，而不是新增 el-dialog。
  - 参考实现：`views/scm/StockDispatch.vue`（缺货分析/智能下推）= 全页面 + 顶部导航。

## 项目上下文

每次会话开始时，先读取以下文件了解项目状态：

1. 读取 `.claude-summary.md` 了解项目概述
2. 读取 `.tasks/current.md` 了解当前任务状态

## 项目信息

- **项目名称**：CW Finance（财务记账系统）
- **项目类型**：Monorepo（npm workspaces）
- **技术栈**：
  - 前端：Vue 3 + TypeScript + Vite + Element Plus + Pinia
  - 后端：Node.js + Express + TypeScript + SQLite (better-sqlite3)
  - 测试：Vitest（单元测试）+ Playwright（E2E测试）
- **前端地址**：http://localhost:5275（见 `client/vite.config.ts`；本分支 cw0523 用独立端口，可与原项目 cw 的 5175 并存）
- **后端地址**：http://localhost:3105（见 `server/src/index.ts` 的 `PORT` 默认值）
- **数据库位置**：`data/finance-0523.db`（开发环境，由 `server/.env` 的 `DB_PATH` 指定）
  - 注意：`data/` 下还有 `finance.db`、`finance1.db` 等历史文件，**不是**本分支在用的库；其中的 SCM 单据属于已不存在的孤儿账套，照着查会得到与界面对不上的数据。

## 常用开发命令

### 启动服务
```bash
# 同时启动前后端（推荐）
npm run dev

# 单独启动前端
npm run dev:client

# 单独启动后端
npm run dev:server

# 或使用批处理脚本
start-services.bat
```

### 构建
```bash
# 构建前后端
npm run build

# 并行构建（更快）
npm run build:parallel
```

### 测试
```bash
# 运行所有测试
npm run test

# 后端单元测试
npm run test --workspace=server
npm run test:watch --workspace=server  # 监听模式
npm run test:coverage --workspace=server  # 覆盖率

# 前端单元测试
npm run test --workspace=client

# E2E 测试
npm run test:e2e --workspace=client
npm run test:e2e:ui --workspace=client  # UI 模式
```

### 代码质量
```bash
# Lint 检查
npm run lint
npm run lint:fix  # 自动修复

# 代码格式化
npm run format
npm run format:check  # 仅检查
```

### 数据库操作
```bash
# 初始化数据库（创建表结构和默认数据）
npm run db:init --workspace=server

# 运行迁移
npm run db:migrate --workspace=server

# 查看迁移状态
npm run db:migrate:status --workspace=server

# 回滚迁移
npm run db:migrate:rollback --workspace=server

# 导入 ACD 文件
npm run db:import:acd --workspace=server
```

## 架构说明

### 后端架构（分层设计）

```
routes/          # 路由层：处理 HTTP 请求、参数验证、响应格式化
  ├── auth.ts           # 认证相关
  ├── voucher.ts        # 凭证录入
  ├── voucherAudit.ts   # 凭证审核
  ├── voucherPosting.ts # 凭证过账
  ├── ledger.ts         # 账簿查询
  ├── report*.ts        # 各类报表
  └── base*.ts          # 基础数据

services/        # 业务逻辑层：核心业务逻辑、数据处理
  ├── voucherQuery.ts   # 凭证查询逻辑
  ├── voucherPosting.ts # 过账业务逻辑
  ├── ledgerQuery.ts    # 账簿查询逻辑
  ├── reportQuery.ts    # 报表查询逻辑
  └── accountService.ts # 科目服务

db/              # 数据访问层：数据库连接、迁移
  ├── index.ts          # 数据库初始化
  ├── migrations.ts     # 迁移执行器
  └── migrationList.ts  # 迁移列表

middleware/      # 中间件：认证、日志、错误处理
scripts/         # 脚本：数据库初始化、迁移、导入等
```

### 前端架构

```
views/           # 页面组件（路由级别）
  ├── voucher/        # 凭证管理
  ├── ledger/         # 账簿查询
  ├── report/         # 报表
  ├── base/           # 基础数据
  └── system/         # 系统管理

components/      # 可复用组件
  ├── voucher/        # 凭证相关组件
  ├── report/         # 报表相关组件
  └── print/          # 打印相关组件

stores/          # Pinia 状态管理
  └── user.ts         # 用户状态

router/          # 路由配置
api/             # API 请求封装
utils/           # 工具函数
```

## 核心功能模块

### 1. 凭证系统（voucher）
- **录入**：`views/voucher/Entry.vue` + `routes/voucher.ts`
- **审核**：`views/voucher/Audit.vue` + `routes/voucherAudit.ts`
- **过账**：`routes/voucherPosting.ts` + `services/voucherPosting.ts`
- **自动转账**：`routes/voucherAutoTransfer.ts` + `services/autoTransfer.ts`
- **批量操作**：`routes/voucherBatch.ts`

### 2. 账簿系统（ledger）
- **总账**：`views/ledger/General.vue`
- **明细账**：`views/ledger/Detail.vue`
- **序时账**：`views/ledger/Chronological.vue`
- **余额表**：`views/ledger/Balance.vue`
- **辅助核算**：`views/ledger/Aux*.vue`
- **查询逻辑**：`services/ledgerQuery.ts`（核心查询逻辑）

### 3. 报表系统（report）
- **资产负债表**：`routes/reportBalanceSheet.ts`
- **利润表**：`routes/reportIncomeStatement.ts`
- **权益变动表**：`routes/reportEquity.ts`
- **动态报表**：`views/report/DynamicReport.vue` + `routes/reportTemplate.ts`

### 4. 基础数据（base）
- **科目管理**：`routes/baseAccount.ts` + `services/accountService.ts`
- **项目管理**：`routes/baseProject.ts`
- **凭证类型**：`routes/baseVoucherType.ts`
- **打印模板**：`routes/basePrintTemplate.ts`
- **期初余额**：`routes/baseInitBalance.ts`

## 开发规范

- 前端代码位于 `client/src/`
- 后端代码位于 `server/src/`
- 账簿查询逻辑在 `server/src/services/ledgerQuery.ts`
- 账簿路由在 `server/src/routes/ledger.ts`
- 所有 API 路由都需要通过 `middleware/auth.ts` 进行认证（除了 `/api/auth/login`）
- 数据库操作使用 better-sqlite3 的同步 API

## 重启服务规则

**凡是修改了后端代码（`server/src/` 下任何文件），必须在完成修改后自动重启前后端服务。**

### 方式一：使用批处理脚本（推荐）
```bash
# 直接运行项目根目录的启动脚本
./start-services.bat
```

### 方式二：手动重启（PowerShell）
```powershell
# 1. 关闭占用端口的进程
foreach ($port in @(3105, 5275)) {
    $pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

# 2. 重新启动服务
Start-Process "cmd" -ArgumentList "/k cd /d D:\BDKF\qskj && npm run dev:server" -WindowStyle Normal
Start-Sleep -Seconds 3
Start-Process "cmd" -ArgumentList "/k cd /d D:\BDKF\qskj && npm run dev:client" -WindowStyle Normal
```

### 方式三：使用 npm 命令
```bash
# 在项目根目录执行（会同时启动前后端）
npm run dev
```

**注意**：
- 开发模式下后端使用 `--watch` 模式，修改 `server/src/` 后会自动重载，通常**无需**手动重启；仅在修改环境变量、数据库结构时才需要。
- 重启前先确认 3105 是否已有后端在跑（`Get-NetTCPConnection -LocalPort 3105`）。若已在运行又重复启动，新进程会报「端口 3105 已被占用」后退出，容易误以为服务没起来。

## BUG 修复日志规则（debug 目录）

**每次完成一项 BUG 修复（无论大小），必须在 `debug/修复日志.md` 文件顶部追加一条记录。提交代码前完成写入。**

- 模板与编号约定见 [debug/README.md](debug/README.md)
- 修复来源于代码评审时，必须在记录里注明对应条目编号（如 P0-6、P1-12）
- 与 `优化日志.md` 的区别：
  - `debug/修复日志.md` ：单个 BUG 的根因 / 修改文件 / 数据修复 / 回滚方法（面向开发）
  - `优化日志.md` ：功能演进、用户可感知的变化（面向用户/运维）
- 同一 BUG 同时涉及功能变化时，两个文件都要写，并互相引用 FIX 编号

## 优化日志更新规则

**每次完成功能修改、优化或 bug 修复后，必须同步更新 `优化日志.md` 文件。**

更新要求：
1. **时机**：在完成代码修改并测试通过后立即更新
2. **格式**：按日期分组，每项修改包含：
   - 修改标题（简明扼要）
   - 修改文件列表（完整路径）
   - 具体说明（详细描述修改内容、技术实现）
   - 修改原因（为什么要这样改）
   - 影响范围（如有）
3. **内容要求**：
   - 记录所有修改的文件路径
   - 说明关键代码逻辑变更
   - 如涉及快捷键，同步更新 `快捷键.md`
   - 如涉及数据库，说明迁移脚本或手动操作步骤
4. **特殊情况**：
   - 后端修改：注明是否需要重启服务
   - 数据库修改：注明是否需要运行迁移脚本
   - 配置修改：注明是否需要更新环境变量或配置文件

示例格式：
```markdown
## 2026-04-26

### 1. 功能名称

**修改文件：**
- `client/src/xxx.vue`
- `server/src/xxx.ts`

**具体说明：**
- 详细描述修改内容
- 关键代码逻辑说明

**原因：**
- 为什么要这样修改

**影响范围：**（可选）
- 对其他功能的影响
```
