# 阶段一：代码质量提升 - 总体实施计划

## 📋 概览

**目标**：提升代码质量、可维护性和安全性
**时间**：1-2周（10个工作日）
**优先级**：🔴 最高优先级

## 📊 工作量分配

| 任务模块 | 预计时间 | 优先级 | 负责人 |
|---------|---------|--------|--------|
| 路由层重构 | 3-4天 | 🔴 高 | 后端开发 |
| 前端组件优化 | 2-3天 | 🟡 中 | 前端开发 |
| 测试覆盖提升 | 3-4天 | 🔴 高 | 全栈开发 |
| 安全审查 | 2-3天 | 🔴 高 | 全栈开发 |

**总计：10-14天**

## 🗓️ 详细时间表

### 第1周（Day 1-5）

#### Day 1-2：路由层重构（高优先级）
- ✅ 拆分 voucher.ts（760行 → <400行）
  - 创建 voucherBatch.ts
  - 创建 voucherAudit.ts
  - 创建 voucherPosting.ts
  - 创建 voucherPeriod.ts
  - 创建 voucherAi.ts
- ✅ 更新路由挂载
- ✅ 运行测试验证

#### Day 3：路由层重构（继续）
- ✅ 拆分 base.ts（647行 → <400行）
  - 创建 baseAccount.ts
  - 创建 baseVoucherType.ts
  - 创建 baseProject.ts
  - 创建 baseInitBalance.ts
- ✅ 提取公共校验逻辑

#### Day 4：路由层重构（完成）
- ✅ 拆分 report.ts（665行 → <400行）
  - 创建 reportFinancial.ts
  - 创建 reportAuxiliary.ts
  - 创建 reportAi.ts
- ✅ 优化报表计算逻辑
- ✅ 全面测试验证

#### Day 5：安全审查（启动）
- ✅ SQL注入审查
  - 运行审查脚本
  - 修复发现的问题
  - 验证修复效果

### 第2周（Day 6-10）

#### Day 6：安全审查（继续）
- ✅ XSS防护
  - 前端输出转义
  - 后端响应头配置
- ✅ CSRF防护
  - 实现CSRF Token
  - 前端集成

#### Day 7：安全审查（完成）
- ✅ 敏感数据加密
  - 实现加密工具
  - 加密AI密钥
- ✅ 认证授权加固
  - JWT安全配置
  - 密码策略加强
  - 登录保护

#### Day 8-9：测试覆盖提升
- ✅ 后端集成测试
  - 凭证管理接口测试（20个用例）
  - 基础设置接口测试（15个用例）
  - 账簿查询接口测试（10个用例）
  - 报表管理接口测试（15个用例）
- ✅ 测试覆盖率配置
- ✅ CI/CD集成

#### Day 10：前端组件优化（启动）
- ✅ Entry.vue 重构
  - 提取 VoucherForm.vue
  - 提取 VoucherEntryTable.vue
  - 创建 Composables

## 📝 详细任务清单

### 1. 路由层重构（3-4天）

#### 1.1 Voucher.ts 拆分
- [ ] 创建 `server/src/routes/voucherBatch.ts`
- [ ] 创建 `server/src/routes/voucherAudit.ts`
- [ ] 创建 `server/src/routes/voucherPosting.ts`
- [ ] 创建 `server/src/routes/voucherPeriod.ts`
- [ ] 创建 `server/src/routes/voucherAi.ts`
- [ ] 创建 `server/src/routes/voucherAutoTransfer.ts`
- [ ] 更新 `server/src/index.ts` 路由挂载
- [ ] 运行 `npm run test:services` 验证
- [ ] 手动测试所有凭证接口

#### 1.2 Base.ts 拆分
- [ ] 创建 `server/src/routes/baseAccount.ts`
- [ ] 创建 `server/src/routes/baseVoucherType.ts`
- [ ] 创建 `server/src/routes/baseProject.ts`
- [ ] 创建 `server/src/routes/baseInitBalance.ts`
- [ ] 创建 `server/src/services/baseValidation.ts`
- [ ] 更新路由挂载
- [ ] 测试验证

#### 1.3 Report.ts 拆分
- [ ] 创建 `server/src/routes/reportFinancial.ts`
- [ ] 创建 `server/src/routes/reportAuxiliary.ts`
- [ ] 创建 `server/src/routes/reportAi.ts`
- [ ] 创建 `server/src/services/reportCalculation.ts`
- [ ] 更新路由挂载
- [ ] 测试验证

### 2. 前端组件优化（2-3天）

#### 2.1 Entry.vue 重构
- [ ] 创建 `client/src/components/voucher/VoucherForm.vue`
- [ ] 创建 `client/src/components/voucher/VoucherEntryTable.vue`
- [ ] 创建 `client/src/components/voucher/EntryRow.vue`
- [ ] 创建 `client/src/components/voucher/AuxiliaryDialog.vue`
- [ ] 创建 `client/src/components/voucher/BatchDeleteDialog.vue`
- [ ] 创建 `client/src/components/voucher/AiSummaryButton.vue`
- [ ] 创建 `client/src/composables/useVoucherForm.ts`
- [ ] 创建 `client/src/composables/useVoucherEntries.ts`
- [ ] 创建 `client/src/composables/useAiSummary.ts`
- [ ] 重构主组件 Entry.vue
- [ ] 测试功能完整性

#### 2.2 其他大组件优化
- [ ] 重构 BalanceSheet.vue（816行 → <400行）
- [ ] 重构 Account.vue（600行 → <400行）
- [ ] 重构 Audit.vue（579行 → <400行）

#### 2.3 通用组件提取
- [ ] 创建 `client/src/components/common/DataTable.vue`
- [ ] 创建 `client/src/components/common/SearchForm.vue`
- [ ] 创建 `client/src/components/common/ExportButton.vue`

### 3. 测试覆盖提升（3-4天）

#### 3.1 后端集成测试
- [ ] 安装测试依赖：`npm install -D vitest supertest @types/supertest`
- [ ] 创建测试目录结构
- [ ] 创建 `server/tests/fixtures/testDb.ts`
- [ ] 创建 `server/tests/integration/voucher.test.ts`（20个用例）
- [ ] 创建 `server/tests/integration/base.test.ts`（15个用例）
- [ ] 创建 `server/tests/integration/ledger.test.ts`（10个用例）
- [ ] 创建 `server/tests/integration/report.test.ts`（15个用例）
- [ ] 创建 `server/tests/integration/system.test.ts`（10个用例）
- [ ] 创建 `server/tests/integration/auth.test.ts`（8个用例）
- [ ] 配置测试覆盖率
- [ ] 运行 `npm run test:coverage`

#### 3.2 前端单元测试
- [ ] 安装测试依赖：`npm install -D vitest @vue/test-utils jsdom`
- [ ] 创建测试目录结构
- [ ] 创建组件测试（15个用例）
- [ ] 创建 Composables 测试（10个用例）
- [ ] 创建工具函数测试（10个用例）
- [ ] 运行前端测试

#### 3.3 CI/CD集成
- [ ] 创建 `.github/workflows/test.yml`
- [ ] 配置自动化测试
- [ ] 配置代码覆盖率上传

### 4. 安全审查（2-3天）

#### 4.1 SQL注入防护
- [ ] 创建 `scripts/audit-sql-injection.ts`
- [ ] 运行审查脚本
- [ ] 修复发现的问题
- [ ] 验证所有SQL使用参数化查询

#### 4.2 XSS防护
- [ ] 审查前端 v-html 使用
- [ ] 安装 DOMPurify：`npm install dompurify`
- [ ] 创建 `client/src/utils/sanitize.ts`
- [ ] 配置安全响应头

#### 4.3 CSRF防护
- [ ] 创建 `server/src/middleware/csrf.ts`
- [ ] 实现CSRF Token生成和验证
- [ ] 前端集成CSRF Token

#### 4.4 敏感数据加密
- [ ] 创建 `server/src/utils/encryption.ts`
- [ ] 加密AI API密钥
- [ ] 加密敏感系统参数

#### 4.5 认证授权加固
- [ ] 实现刷新令牌机制
- [ ] 实现令牌黑名单
- [ ] 加强密码策略
- [ ] 实现登录失败次数限制

#### 4.6 依赖安全审计
- [ ] 运行 `npm audit`
- [ ] 修复高危漏洞
- [ ] 更新过期依赖

## 🎯 验收标准

### 路由层重构
- ✅ 所有路由文件 < 400行
- ✅ 职责单一，易于维护
- ✅ 所有现有测试通过
- ✅ 手动测试无回归问题

### 前端组件优化
- ✅ 所有组件 < 400行
- ✅ 代码复用率提升 30%
- ✅ 功能完整，无回归问题
- ✅ 性能无明显下降

### 测试覆盖提升
- ✅ 代码覆盖率 ≥ 70%
- ✅ 后端集成测试 ≥ 78个用例
- ✅ 前端单元测试 ≥ 35个用例
- ✅ CI/CD自动化测试运行

### 安全审查
- ✅ 无SQL注入风险
- ✅ XSS防护完善
- ✅ CSRF防护实现
- ✅ 敏感数据加密
- ✅ npm audit 无高危漏洞

## 📈 进度跟踪

使用 `.tasks/current.md` 跟踪进度：

```markdown
## 阶段一：代码质量提升

### 路由层重构（3-4天）
- [x] Voucher.ts 拆分
- [x] Base.ts 拆分
- [x] Report.ts 拆分
- [x] 测试验证

### 前端组件优化（2-3天）
- [ ] Entry.vue 重构
- [ ] BalanceSheet.vue 重构
- [ ] Account.vue 重构
- [ ] 通用组件提取

### 测试覆盖提升（3-4天）
- [ ] 后端集成测试
- [ ] 前端单元测试
- [ ] CI/CD集成

### 安全审查（2-3天）
- [ ] SQL注入防护
- [ ] XSS/CSRF防护
- [ ] 敏感数据加密
- [ ] 认证授权加固
```

## 🚀 快速启动

### 第一天开始
```bash
# 1. 创建工作分支
git checkout -b refactor/stage-1-quality

# 2. 创建文档目录
mkdir -p docs

# 3. 开始路由层重构
# 参考 docs/refactor-plan-voucher.md

# 4. 每天提交进度
git add .
git commit -m "refactor: voucher routes split - day 1"
git push origin refactor/stage-1-quality
```

### 每日检查清单
- [ ] 更新 `.tasks/current.md` 进度
- [ ] 运行测试确保无回归
- [ ] 代码格式化 `npm run format`
- [ ] 提交代码到分支
- [ ] 更新工作日志到 `.claude-summary.md`

## 📚 参考文档

- [Voucher.ts 重构计划](./refactor-plan-voucher.md)
- [Base.ts 重构计划](./refactor-plan-base.md)
- [Report.ts 重构计划](./refactor-plan-report.md)
- [前端组件优化计划](./refactor-plan-frontend.md)
- [测试覆盖提升计划](./test-plan.md)
- [安全审查计划](./security-audit-plan.md)

## 🎉 预期收益

### 代码质量
- 路由文件平均行数减少 50%
- 组件平均行数减少 50%
- 代码复用率提升 30%

### 测试覆盖
- 代码覆盖率：0% → 70%+
- 自动化测试：0个 → 113个用例

### 安全性
- 消除SQL注入风险
- 防止XSS/CSRF攻击
- 敏感数据加密保护

### 可维护性
- 职责更清晰
- 易于扩展
- 降低bug率
- 提升开发效率

---

**准备好了吗？让我们开始吧！** 🚀
