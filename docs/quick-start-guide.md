# 快速启动指南 - 阶段一：代码质量提升

## 🎯 目标
在1-2周内完成代码质量提升，包括路由重构、组件优化、测试覆盖和安全审查。

## 📋 准备工作（15分钟）

### 1. 创建工作分支
```bash
cd /Users/luojun/projects/cwnew
git checkout -b refactor/stage-1-quality
```

### 2. 确认环境
```bash
# 检查Node版本（需要 >= 18）
node -v

# 检查依赖
npm install

# 运行现有测试
npm run test:services --workspace=server

# 启动开发环境
npm run dev
```

### 3. 阅读计划文档
- ✅ [总体实施计划](./stage-1-implementation-plan.md)
- ✅ [Voucher重构计划](./refactor-plan-voucher.md)
- ✅ [测试计划](./test-plan.md)
- ✅ [安全审查计划](./security-audit-plan.md)

## 🚀 Day 1-2：路由层重构 - Voucher.ts

### 任务目标
将 760 行的 voucher.ts 拆分为 7 个职责单一的文件。

### Step 1: 创建新路由文件（2小时）

#### 1.1 创建 voucherBatch.ts
```bash
touch server/src/routes/voucherBatch.ts
```

```typescript
// server/src/routes/voucherBatch.ts
import { Router } from 'express'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.ts'
import { getDb } from '../db/index.ts'
import {
  getBatchVoucherFilters,
  validateBatchVoucherFilters,
  loadBatchVouchers,
  buildBatchAuditPreviewData,
  buildBatchDeletePreviewData,
  auditBatchVouchers,
  deleteBatchVouchers,
} from '../services/voucherEntry.ts'

const router = Router()
router.use(authMiddleware)

// 批量审核预览
router.post('/vouchers/batch/audit/preview', (req: AuthRequest, res) => {
  const filters = getBatchVoucherFilters(req.body)
  const validationError = validateBatchVoucherFilters(filters)
  if (validationError) {
    return res.status(400).json({ code: 400, message: validationError })
  }

  const db = getDb()
  const vouchers = loadBatchVouchers({ db, accountSetId: req.accountSetId || '', filters })
  const preview = buildBatchAuditPreviewData(vouchers)

  res.json({ code: 0, data: preview })
})

// 批量审核执行
router.post('/vouchers/batch/audit', operationLog('批量审核凭证', '凭证管理'), (req: AuthRequest, res) => {
  const filters = getBatchVoucherFilters(req.body)
  const validationError = validateBatchVoucherFilters(filters)
  if (validationError) {
    return res.status(400).json({ code: 400, message: validationError })
  }

  const db = getDb()
  const vouchers = loadBatchVouchers({ db, accountSetId: req.accountSetId || '', filters })

  const result = auditBatchVouchers({
    db,
    vouchers,
    auditorId: req.userId || '',
    auditorName: req.userName || '',
  })

  res.json({ code: 0, message: `成功审核 ${result.count} 张凭证` })
})

// 批量删除预览
router.post('/vouchers/batch/delete/preview', (req: AuthRequest, res) => {
  const filters = getBatchVoucherFilters(req.body)
  const validationError = validateBatchVoucherFilters(filters)
  if (validationError) {
    return res.status(400).json({ code: 400, message: validationError })
  }

  const db = getDb()
  const vouchers = loadBatchVouchers({ db, accountSetId: req.accountSetId || '', filters })
  const preview = buildBatchDeletePreviewData(vouchers)

  res.json({ code: 0, data: preview })
})

// 批量删除执行
router.post('/vouchers/batch/delete', operationLog('批量删除凭证', '凭证管理'), (req: AuthRequest, res) => {
  const filters = getBatchVoucherFilters(req.body)
  const validationError = validateBatchVoucherFilters(filters)
  if (validationError) {
    return res.status(400).json({ code: 400, message: validationError })
  }

  const db = getDb()
  const vouchers = loadBatchVouchers({ db, accountSetId: req.accountSetId || '', filters })

  const result = deleteBatchVouchers({ db, vouchers })

  res.json({ code: 0, message: `成功删除 ${result.count} 张凭证` })
})

export default router
```

#### 1.2 创建其他路由文件
```bash
touch server/src/routes/voucherAudit.ts
touch server/src/routes/voucherPosting.ts
touch server/src/routes/voucherPeriod.ts
touch server/src/routes/voucherAi.ts
touch server/src/routes/voucherAutoTransfer.ts
```

参考 `docs/refactor-plan-voucher.md` 完成其他文件。

### Step 2: 更新主路由挂载（30分钟）

编辑 `server/src/index.ts`：

```typescript
// 导入新路由
import voucherRoutes from './routes/voucher.ts'
import voucherBatchRoutes from './routes/voucherBatch.ts'
import voucherAuditRoutes from './routes/voucherAudit.ts'
import voucherPostingRoutes from './routes/voucherPosting.ts'
import voucherPeriodRoutes from './routes/voucherPeriod.ts'
import voucherAiRoutes from './routes/voucherAi.ts'
import voucherAutoTransferRoutes from './routes/voucherAutoTransfer.ts'

// 挂载路由
app.use('/api/voucher', voucherRoutes)
app.use('/api/voucher', voucherBatchRoutes)
app.use('/api/voucher', voucherAuditRoutes)
app.use('/api/voucher', voucherPostingRoutes)
app.use('/api/voucher', voucherPeriodRoutes)
app.use('/api/voucher', voucherAiRoutes)
app.use('/api/voucher', voucherAutoTransferRoutes)
```

### Step 3: 测试验证（1小时）

```bash
# 1. 运行服务测试
npm run test:services --workspace=server

# 2. 启动开发服务器
npm run dev:server

# 3. 手动测试关键接口
# 使用 curl 或 Postman 测试：
# - POST /api/voucher/vouchers
# - GET /api/voucher/vouchers
# - POST /api/voucher/vouchers/:id/audit
# - POST /api/voucher/batch/audit/preview
```

### Step 4: 清理旧代码（30分钟）

从 `server/src/routes/voucher.ts` 中删除已迁移的代码，保留核心CRUD操作。

### Step 5: 提交代码
```bash
git add .
git commit -m "refactor: split voucher.ts into 7 focused route files

- Create voucherBatch.ts for batch operations
- Create voucherAudit.ts for audit workflow
- Create voucherPosting.ts for posting workflow
- Create voucherPeriod.ts for period management
- Create voucherAi.ts for AI features
- Create voucherAutoTransfer.ts for auto transfer
- Reduce voucher.ts from 760 to ~250 lines"

git push origin refactor/stage-1-quality
```

## 📊 进度跟踪

更新 `.tasks/current.md`：

```markdown
## 阶段一：代码质量提升

### Day 1-2: 路由层重构 - Voucher.ts
- [x] 创建 voucherBatch.ts
- [x] 创建 voucherAudit.ts
- [x] 创建 voucherPosting.ts
- [x] 创建 voucherPeriod.ts
- [x] 创建 voucherAi.ts
- [x] 创建 voucherAutoTransfer.ts
- [x] 更新路由挂载
- [x] 测试验证
- [x] 清理旧代码
- [x] 提交代码

### Day 3: 路由层重构 - Base.ts
- [ ] 待开始...
```

## 🎯 Day 1-2 验收标准

- ✅ 创建了 6 个新路由文件
- ✅ voucher.ts 从 760行 减少到 ~250行
- ✅ 所有现有测试通过
- ✅ 手动测试无回归问题
- ✅ 代码已提交到分支

## 💡 常见问题

### Q: 如何确保没有遗漏代码？
A: 对比新旧文件的导出函数，确保所有路由都已迁移。

### Q: 测试失败怎么办？
A: 检查导入路径是否正确，确保所有依赖的服务函数都已导入。

### Q: 如何验证接口功能？
A: 使用现有的前端页面测试，或使用 curl/Postman 测试API。

## 📞 需要帮助？

如果遇到问题，可以：
1. 查看详细计划文档
2. 运行 `npm run test:services` 检查服务层
3. 查看 Git diff 确认修改范围
4. 回滚到上一个提交重新开始

---

**Day 1-2 完成后，继续 Day 3 的 Base.ts 重构！** 🚀
