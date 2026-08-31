# Base.ts 重构计划

## 目标
将 647 行的 base.ts 拆分为多个职责单一的路由文件

## 当前结构分析
```
base.ts 当前结构：
- 会计科目管理：~200行
- 凭证类型管理：~80行
- 核算项目管理：~150行
- 辅助核算类别：~80行
- 期初余额管理：~137行
```

## 拆分方案

### 1. baseAccount.ts (会计科目) - 新建 ~220行
- GET /base/accounts - 查询科目列表
- POST /base/accounts - 新增科目
- PUT /base/accounts/:id - 修改科目
- DELETE /base/accounts/:id - 删除科目
- GET /base/accounts/tree - 科目树形结构

### 2. baseVoucherType.ts (凭证类型) - 新建 ~100行
- GET /base/voucher-types - 查询凭证类型
- POST /base/voucher-types - 新增凭证类型
- PUT /base/voucher-types/:id - 修改凭证类型
- DELETE /base/voucher-types/:id - 删除凭证类型

### 3. baseProject.ts (核算项目) - 新建 ~170行
- GET /base/projects - 查询核算项目
- POST /base/projects - 新增核算项目
- PUT /base/projects/:id - 修改核算项目
- DELETE /base/projects/:id - 删除核算项目
- GET /base/aux-categories - 辅助核算类别

### 4. baseInitBalance.ts (期初余额) - 新建 ~150行
- GET /base/init-balances - 查询期初余额
- POST /base/init-balances/batch - 批量保存期初余额
- POST /base/init-balances/import - 导入期初余额
- GET /base/init-balances/validate - 验证期初余额平衡

## 实施步骤

### Step 1: 创建新路由文件（1天）
1. 创建 4 个新路由文件
2. 迁移对应代码
3. 调整导入路径

### Step 2: 提取公共校验逻辑（0.5天）
创建 baseValidation.ts 服务：
```typescript
// 科目编码校验
export function validateAccountCode(code: string): string | null

// 科目层级校验
export function validateAccountLevel(parentId: string, level: number): string | null

// 期初余额平衡校验
export function validateInitBalanceBalance(balances: InitBalance[]): string | null
```

### Step 3: 统一错误处理（0.5天）
```typescript
// 统一基础设置模块错误码
enum BaseErrorCode {
  ACCOUNT_CODE_EXISTS = 'ACCOUNT_CODE_EXISTS',
  ACCOUNT_HAS_CHILDREN = 'ACCOUNT_HAS_CHILDREN',
  ACCOUNT_HAS_VOUCHERS = 'ACCOUNT_HAS_VOUCHERS',
  INIT_BALANCE_NOT_BALANCED = 'INIT_BALANCE_NOT_BALANCED',
}
```

### Step 4: 测试验证（0.5天）
1. 测试所有基础设置接口
2. 验证数据完整性约束
3. 测试级联删除逻辑

## 预期收益
- 单文件行数：647 → 220（减少66%）
- 模块职责更清晰
- 校验逻辑可复用
- 便于单元测试
