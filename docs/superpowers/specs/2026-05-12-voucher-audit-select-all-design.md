# 凭证审核页面跨分页全选功能设计文档

## 一、背景与目标

### 问题描述

当前凭证审核页面（`/voucher/audit`）的全选功能只能选中当前页的数据，导致批量审核和批量过账操作只对当前页生效。用户期望点击全选按钮时，能够选中所有分页的数据，实现真正的批量操作。

### 目标

实现跨分页全选功能，使批量审核、批量过账等操作能够一次性处理所有符合筛选条件的凭证数据。

### 设计原则

- **性能优先**：采用"记录筛选条件，后端处理"的方案，避免一次性加载大量数据导致前端卡顿
- **用户体验**：通过确认对话框和明确的视觉反馈，让用户清楚了解当前的选择状态
- **向后兼容**：保留原有的"当前页选择"功能，不影响现有用户习惯

## 二、核心概念

### 全选模式

系统支持两种全选模式：

1. **当前页模式**（默认）
   - 只选中当前页的数据
   - 批量操作时传递凭证 ID 列表给后端
   - 适用于小范围、精确的批量操作

2. **全部页模式**
   - 选中所有符合当前筛选条件的数据
   - 批量操作时传递筛选条件给后端，由后端查询并处理
   - 适用于大范围的批量操作

### 工作流程

```
用户点击全选按钮
  ↓
检查当前筛选条件下的总数据量
  ↓
弹出确认对话框："当前筛选条件下共有 X 条凭证，是否全部选中？"
  ├─ 用户选择"全部选中"
  │   ↓
  │   进入全部页模式
  │   保存当前筛选条件快照
  │   显示全选提示："已选中全部 X 条凭证（所有分页）"
  │
  └─ 用户选择"仅选中当前页"
      ↓
      保持当前页模式
      仅选中当前页数据
  ↓
用户点击批量操作（审核/过账/反审核/反过账）
  ↓
根据当前模式调用不同的后端接口
  ├─ 全部页模式：传递筛选条件
  └─ 当前页模式：传递 ID 列表
  ↓
操作完成，重置全选状态，刷新数据
```

## 三、架构设计

### 前端架构

#### 1. 状态管理（Audit.vue）

```typescript
// 全选模式状态
const selectAllMode = ref(false)  // false: 当前页模式, true: 全部页模式
const selectAllFilters = ref<VoucherFilters | null>(null)  // 全选时的筛选条件快照
const selectAllTotal = ref(0)  // 全选时的总数据量
```

#### 2. 组件结构

```
Audit.vue (页面容器)
  ├─ VoucherFilterBar (筛选条件组件)
  ├─ SelectAllBanner (全选提示条，新增)
  ├─ VoucherAuditTable (数据表格)
  └─ 批量操作按钮组
```

#### 3. 关键方法

**handleTableSelectAll()**
- 监听表格的全选事件
- 弹出确认对话框
- 根据用户选择设置全选模式

**handleBatchOperation(type: 'audit' | 'post' | 'unaudit' | 'unpost')**
- 判断当前全选模式
- 调用对应的后端接口
- 传递筛选条件或 ID 列表

**resetSelectAllMode()**
- 重置全选状态
- 清空筛选条件快照
- 清空选中数据

### 后端架构

#### 1. 接口设计

后端已有的批量接口支持两种调用方式，无需新增接口：

**方式一：传递 ID 列表（当前页模式）**

```http
POST /api/voucher/vouchers/batch-audit
Content-Type: application/json

{
  "voucherIds": ["id1", "id2", "id3"]
}
```

**方式二：传递筛选条件（全部页模式）**

```http
POST /api/voucher/vouchers/batch-audit
Content-Type: application/json

{
  "dateRange": ["2024-01-01", "2024-12-31"],
  "voucher_type_ids": ["type1", "type2"],
  "status": "draft",
  "startNo": "1",
  "endNo": "100"
}
```

#### 2. 接口修改

需要修改 `server/src/routes/voucherAudit.ts` 中的批量接口，使其支持两种参数格式：

```typescript
router.post('/vouchers/batch-audit', (req: AuthRequest, res) => {
  const { voucherIds, dateRange, voucher_type_ids, status, startNo, endNo } = req.body

  if (voucherIds && Array.isArray(voucherIds)) {
    // 方式一：按 ID 列表处理（现有逻辑）
    // ... 现有代码
  } else if (dateRange && voucher_type_ids) {
    // 方式二：按筛选条件处理（调用 voucherBatch.ts 的逻辑）
    // ... 新增逻辑
  } else {
    return res.status(400).json({ code: 400, message: '参数错误' })
  }
})
```

## 四、详细实现

### 前端实现

#### 1. 全选确认对话框

```typescript
async function handleTableSelectAll(selection: any[]) {
  // 如果是取消全选
  if (selection.length === 0) {
    resetSelectAllMode()
    return
  }

  // 如果当前页已全选，询问是否选中所有页
  const currentPageFullSelected = selection.length === flatList.value.filter(isSelectableRow).length

  if (currentPageFullSelected && pagination.total > pagination.pageSize) {
    try {
      await ElMessageBox.confirm(
        `当前筛选条件下共有 ${pagination.total} 条凭证，是否全部选中？`,
        '全选确认',
        {
          confirmButtonText: '全部选中',
          cancelButtonText: '仅选中当前页',
          type: 'info',
          distinguishCancelAndClose: true,
        }
      )

      // 用户选择"全部选中"
      selectAllMode.value = true
      selectAllFilters.value = { ...filters.value }
      selectAllTotal.value = pagination.total

    } catch (action) {
      // 用户选择"仅选中当前页"或关闭对话框
      selectAllMode.value = false
    }
  }
}
```

#### 2. 全选提示条组件（SelectAllBanner.vue）

```vue
<template>
  <div v-if="selectAllMode" class="select-all-banner">
    <el-icon><InfoFilled /></el-icon>
    <span>已选中全部 {{ total }} 条凭证（所有分页）</span>
    <el-button link type="primary" @click="$emit('cancel')">取消全选</el-button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  selectAllMode: boolean
  total: number
}>()

defineEmits<{
  cancel: []
}>()
</script>

<style scoped>
.select-all-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background-color: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 4px;
  margin-bottom: 12px;
  color: #0050b3;
}
</style>
```

#### 3. 批量操作逻辑修改

```typescript
async function handleBatchAudit() {
  if (selectAllMode.value && selectAllFilters.value) {
    // 全部页模式：传递筛选条件
    const params: any = {}

    if (selectAllFilters.value.dateRange?.length === 2) {
      params.dateRange = selectAllFilters.value.dateRange
    }

    if (selectAllFilters.value.voucherTypeIds?.length > 0) {
      params.voucher_type_ids = selectAllFilters.value.voucherTypeIds
    }

    if (selectAllFilters.value.status) {
      params.status = selectAllFilters.value.status
    }

    // 调用批量审核接口（传递筛选条件）
    const res = await request.post('/voucher/vouchers/batch-audit', params)
    showSuccess(res.message || '批量审核成功')

  } else {
    // 当前页模式：传递 ID 列表
    const voucherIds = selected.value.map(v => v.id || v._voucherId)

    if (voucherIds.length === 0) {
      showError('请选择要审核的凭证')
      return
    }

    const res = await request.post('/voucher/vouchers/batch-audit', { voucherIds })
    showSuccess(res.message || '批量审核成功')
  }

  // 操作完成后重置状态
  resetSelectAllMode()
  selected.value = []
  await fetchData()
}
```

#### 4. 状态重置逻辑

```typescript
function resetSelectAllMode() {
  selectAllMode.value = false
  selectAllFilters.value = null
  selectAllTotal.value = 0
}

// 监听筛选条件变化，自动重置全选状态
watch(filters, () => {
  if (selectAllMode.value) {
    resetSelectAllMode()
  }
}, { deep: true })

// 监听分页变化，自动重置全选状态
watch(() => pagination.page, () => {
  if (selectAllMode.value) {
    resetSelectAllMode()
  }
})
```

### 后端实现

#### 修改 voucherAudit.ts

```typescript
router.post('/vouchers/batch-audit', operationLog('批量审核凭证', '凭证管理'), (req: AuthRequest, res) => {
  const { voucherIds, dateRange, voucher_type_ids, status, startNo, endNo } = req.body
  const db = getDb()

  // 方式一：按 ID 列表处理
  if (voucherIds && Array.isArray(voucherIds)) {
    if (voucherIds.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择要审核的凭证' })
    }

    if (voucherIds.length > 100) {
      return res.status(400).json({ code: 400, message: '单次最多审核100张凭证' })
    }

    // ... 现有的 ID 列表处理逻辑

  }
  // 方式二：按筛选条件处理
  else if (dateRange && voucher_type_ids) {
    const filters = {
      startDate: dateRange[0],
      endDate: dateRange[1],
      voucherTypeIds: voucher_type_ids,
      startNo,
      endNo,
    }

    // 复用 voucherBatch.ts 的逻辑
    const vouchers = loadBatchDraftVouchers({
      db,
      accountSetId: req.accountSetId || '',
      filters,
    })

    if (vouchers.length === 0) {
      return res.status(400).json({ code: 400, message: '未找到符合条件的草稿凭证' })
    }

    const selfMadeVoucher = findSelfMadeVoucher(vouchers, req.userId)
    if (selfMadeVoucher) {
      return res.status(400).json({
        code: 400,
        message: `制单人与审核人不能为同一人：${selfMadeVoucher.voucher_no}`
      })
    }

    auditBatchVouchers({
      db,
      vouchers,
      userId: req.userId,
      userName: req.userName,
    })

    res.json({
      code: 0,
      message: `批量审核成功，共审核 ${vouchers.length} 张凭证`,
      data: { count: vouchers.length },
    })

  } else {
    return res.status(400).json({ code: 400, message: '参数错误：请提供凭证ID列表或筛选条件' })
  }
})
```

同样的逻辑需要应用到：
- `POST /vouchers/batch-unaudit`（批量反审核）
- `POST /vouchers/batch-post`（批量过账，在 voucherPosting.ts 中）
- `POST /vouchers/batch-unpost`（批量反过账，在 voucherPosting.ts 中）

## 五、错误处理

### 前端错误处理

1. **筛选条件为空**
   ```typescript
   if (!filters.value.dateRange?.length && !filters.value.voucherTypeIds?.length) {
     showError('请先设置筛选条件（日期范围或凭证类型），或使用当前页选择')
     return
   }
   ```

2. **数据量过大警告**
   ```typescript
   if (pagination.total > 1000) {
     const confirmed = await ElMessageBox.confirm(
       `数据量较大（${pagination.total} 条），批量操作可能需要较长时间，是否继续？`,
       '操作确认',
       { type: 'warning' }
     )
     if (!confirmed) return
   }
   ```

3. **网络请求失败**
   ```typescript
   try {
     await handleBatchAudit()
   } catch (error: any) {
     showError(error.message || '批量操作失败')
     console.error('批量操作错误：', error)
   }
   ```

### 后端错误处理

1. **参数验证**
   - 检查必需参数是否存在
   - 验证日期格式是否正确
   - 验证凭证类型 ID 是否有效

2. **业务逻辑验证**
   - 检查是否存在制单人与审核人相同的情况
   - 检查凭证状态是否符合操作要求
   - 检查是否存在已过账的凭证（反审核时）

3. **事务处理**
   - 使用数据库事务确保批量操作的原子性
   - 操作失败时自动回滚

## 六、用户体验优化

### 视觉反馈

1. **全选提示条**
   - 使用醒目的蓝色背景（`#e6f7ff`）
   - 显示选中的总数量
   - 提供"取消全选"按钮

2. **按钮文案动态变化**
   ```typescript
   const batchAuditButtonText = computed(() => {
     if (selectAllMode.value) {
       return `批量审核（全部 ${selectAllTotal.value} 张）`
     } else {
       return `批量审核（已选 ${selected.value.length} 张）`
     }
   })
   ```

3. **Loading 状态**
   - 批量操作时显示 loading 状态
   - 禁用所有操作按钮，防止重复提交

### 操作提示

1. **成功提示**
   ```typescript
   showSuccess(`批量审核成功，共审核 ${count} 张凭证`)
   ```

2. **失败提示**
   ```typescript
   showError(`批量审核失败：${errorMessage}`)
   ```

3. **部分成功提示**
   ```typescript
   showWarning(`批量审核完成：成功 ${successCount} 张，失败 ${failCount} 张`)
   ```

## 七、测试计划

### 功能测试

1. **全选功能测试**
   - [ ] 点击全选按钮，弹出确认对话框
   - [ ] 选择"全部选中"，进入全部页模式
   - [ ] 选择"仅选中当前页"，保持当前页模式
   - [ ] 全选提示条正确显示

2. **批量操作测试**
   - [ ] 全部页模式下批量审核
   - [ ] 全部页模式下批量过账
   - [ ] 全部页模式下批量反审核
   - [ ] 全部页模式下批量反过账
   - [ ] 当前页模式下的批量操作（保持原有功能）

3. **状态重置测试**
   - [ ] 修改筛选条件后，全选状态自动重置
   - [ ] 切换分页后，全选状态自动重置
   - [ ] 批量操作完成后，全选状态自动重置
   - [ ] 点击"取消全选"按钮，全选状态重置

4. **边界条件测试**
   - [ ] 筛选条件为空时的处理
   - [ ] 数据量为 0 时的处理
   - [ ] 数据量超过 1000 时的警告
   - [ ] 单次操作超过 100 条的限制（ID 列表模式）

### 性能测试

1. **大数据量测试**
   - [ ] 1000 条数据的批量审核
   - [ ] 5000 条数据的批量审核
   - [ ] 10000 条数据的批量审核

2. **并发测试**
   - [ ] 多个用户同时进行批量操作
   - [ ] 批量操作期间其他用户查询数据

### 兼容性测试

1. **浏览器兼容性**
   - [ ] Chrome
   - [ ] Firefox
   - [ ] Safari
   - [ ] Edge

2. **响应式测试**
   - [ ] 桌面端（1920x1080）
   - [ ] 笔记本（1366x768）
   - [ ] 平板（iPad）

## 八、关键文件清单

### 前端文件

- `client/src/views/voucher/Audit.vue` - 主页面，增加全选逻辑
- `client/src/components/voucher/VoucherAuditTable.vue` - 表格组件，监听全选事件
- `client/src/components/voucher/SelectAllBanner.vue` - 全选提示条组件（新增）
- `client/src/composables/useVoucherAuditActions.ts` - 批量操作逻辑，修改批量方法
- `client/src/composables/useVoucherQuery.ts` - 查询逻辑，无需修改

### 后端文件

- `server/src/routes/voucherAudit.ts` - 批量审核/反审核接口，支持筛选条件参数
- `server/src/routes/voucherPosting.ts` - 批量过账/反过账接口，支持筛选条件参数
- `server/src/routes/voucherBatch.ts` - 批量操作逻辑，复用现有方法
- `server/src/services/voucherEntry.ts` - 凭证服务，无需修改

## 九、实施计划

### 第一阶段：前端基础功能（1-2 天）

1. 创建 SelectAllBanner 组件
2. 在 Audit.vue 中增加全选状态管理
3. 实现全选确认对话框
4. 实现全选提示条显示/隐藏逻辑
5. 实现状态重置逻辑

### 第二阶段：前端批量操作（1 天）

1. 修改 useVoucherAuditActions.ts 中的批量方法
2. 根据全选模式调用不同的接口参数
3. 实现按钮文案动态变化
4. 实现 loading 状态管理

### 第三阶段：后端接口修改（1 天）

1. 修改 voucherAudit.ts 的批量审核/反审核接口
2. 修改 voucherPosting.ts 的批量过账/反过账接口
3. 增加参数验证和错误处理
4. 编写单元测试

### 第四阶段：测试与优化（1-2 天）

1. 功能测试
2. 性能测试
3. 边界条件测试
4. Bug 修复和优化

### 第五阶段：文档与部署（0.5 天）

1. 更新优化日志
2. 更新用户手册（如有）
3. 部署到测试环境
4. 部署到生产环境

**预计总工期：4-6 天**

## 十、风险与应对

### 风险 1：大数据量性能问题

**风险描述**：当筛选条件下的数据量超过 10000 条时，批量操作可能导致数据库压力过大，响应时间过长。

**应对措施**：
- 在后端增加数据量限制，单次批量操作最多处理 5000 条
- 超过限制时，提示用户缩小筛选范围
- 考虑使用异步任务队列处理超大批量操作

### 风险 2：用户误操作

**风险描述**：用户可能在不理解全选含义的情况下，误操作导致大量数据被修改。

**应对措施**：
- 确认对话框中明确显示数据量
- 全选提示条醒目显示
- 批量操作前再次确认
- 提供操作日志，方便追溯

### 风险 3：筛选条件不一致

**风险描述**：用户在全选后修改了筛选条件，但全选状态未重置，导致批量操作的数据与预期不符。

**应对措施**：
- 监听筛选条件变化，自动重置全选状态
- 在批量操作时，再次验证筛选条件是否与快照一致
- 如果不一致，提示用户重新全选

## 十一、后续优化方向

1. **异步任务队列**：对于超大批量操作，使用异步任务队列，避免阻塞用户操作
2. **操作进度显示**：批量操作时显示实时进度（已处理 X / 总共 Y）
3. **批量操作历史**：记录批量操作历史，方便用户查看和回滚
4. **智能筛选建议**：根据用户的操作习惯，推荐常用的筛选条件组合
5. **导出功能**：支持将全选的数据导出为 Excel 文件

## 十二、总结

本设计方案通过引入"全选模式"概念，在保持原有功能的基础上，实现了跨分页全选功能。采用"记录筛选条件，后端处理"的方案，既保证了性能，又提供了良好的用户体验。通过详细的错误处理和用户反馈机制，确保了功能的健壮性和易用性。
