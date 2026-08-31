# Voucher.ts 重构计划

## 目标
将 760 行的 voucher.ts 拆分为多个职责单一的路由文件

## 拆分方案

### 1. voucher.ts (核心凭证CRUD) - 保留 ~250行
- POST /vouchers - 录入凭证
- PUT /vouchers/:id - 修改凭证
- DELETE /vouchers/:id - 删除凭证
- GET /vouchers - 查询凭证列表
- GET /vouchers/:id - 获取凭证详情

### 2. voucherBatch.ts (批量操作) - 新建 ~150行
- POST /vouchers/batch/audit/preview - 批量审核预览
- POST /vouchers/batch/audit - 批量审核
- POST /vouchers/batch/delete/preview - 批量删除预览
- POST /vouchers/batch/delete - 批量删除

### 3. voucherAudit.ts (审核流程) - 新建 ~100行
- POST /vouchers/:id/audit - 审核凭证
- POST /vouchers/:id/unaudit - 反审核凭证

### 4. voucherPosting.ts (过账流程) - 新建 ~100行
- POST /vouchers/:id/post - 过账凭证
- POST /vouchers/:id/unpost - 反过账凭证

### 5. voucherPeriod.ts (期间管理) - 新建 ~80行
- POST /vouchers/periods/close - 月结
- POST /vouchers/periods/open - 反月结
- GET /vouchers/periods/status - 期间状态

### 6. voucherAi.ts (AI功能) - 新建 ~60行
- POST /vouchers/ai/summary - AI智能摘要

### 7. voucherAutoTransfer.ts (自动结转) - 已存在服务层
- GET /vouchers/auto-transfer/status
- POST /vouchers/auto-transfer/preview
- POST /vouchers/auto-transfer/run
- POST /vouchers/auto-transfer/revoke

## 实施步骤

### Step 1: 创建新路由文件（1天）
1. 创建 6 个新路由文件
2. 从 voucher.ts 复制对应代码
3. 调整导入路径
4. 确保中间件正确应用

### Step 2: 更新主路由挂载（0.5天）
在 server/src/index.ts 中挂载新路由：
```typescript
import voucherRoutes from './routes/voucher.ts'
import voucherBatchRoutes from './routes/voucherBatch.ts'
import voucherAuditRoutes from './routes/voucherAudit.ts'
import voucherPostingRoutes from './routes/voucherPosting.ts'
import voucherPeriodRoutes from './routes/voucherPeriod.ts'
import voucherAiRoutes from './routes/voucherAi.ts'
import voucherAutoTransferRoutes from './routes/voucherAutoTransfer.ts'

app.use('/api/voucher', voucherRoutes)
app.use('/api/voucher', voucherBatchRoutes)
app.use('/api/voucher', voucherAuditRoutes)
app.use('/api/voucher', voucherPostingRoutes)
app.use('/api/voucher', voucherPeriodRoutes)
app.use('/api/voucher', voucherAiRoutes)
app.use('/api/voucher', voucherAutoTransferRoutes)
```

### Step 3: 测试验证（0.5天）
1. 运行现有服务测试
2. 手动测试所有接口
3. 确认无回归问题

### Step 4: 清理旧文件（0.5天）
1. 删除 voucher.ts 中已迁移的代码
2. 更新导入引用
3. 代码格式化

## 预期收益
- 单文件行数：760 → 250（减少67%）
- 职责更清晰，易于维护
- 便于后续功能扩展
- 降低代码冲突概率
