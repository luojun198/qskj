# 前端组件优化计划

## 目标
优化超大组件，提升代码可维护性和性能

## 当前问题分析

### 超大组件列表
```
1. Entry.vue (凭证录入) - 1091行 ⚠️ 严重超标
2. BalanceSheet.vue (资产负债表) - 816行 ⚠️ 超标
3. Account.vue (会计科目) - 600行 ⚠️ 超标
4. Audit.vue (凭证审核) - 579行 ⚠️ 超标
5. AutoTransfer.vue (自动结转) - 506行 ⚠️ 超标
6. Query.vue (凭证查询) - 471行 ⚠️ 接近超标
```

**建议标准**：单个Vue组件不超过 400 行

## 优化方案

### 1. Entry.vue 重构（1091行 → 目标<400行）

#### 问题分析
- 凭证表单逻辑复杂（~300行）
- 分录编辑逻辑复杂（~250行）
- 批量删除逻辑（~150行）
- AI智能摘要（~100行）
- 辅助核算处理（~150行）

#### 拆分方案
```
Entry.vue (主组件) - 300行
├── VoucherForm.vue (凭证表单) - 200行
├── VoucherEntryTable.vue (分录表格) - 250行
│   ├── EntryRow.vue (分录行) - 100行
│   └── AuxiliaryDialog.vue (辅助核算弹窗) - 80行
├── BatchDeleteDialog.vue (批量删除) - 150行
└── AiSummaryButton.vue (AI摘要) - 80行
```

#### 实施步骤
1. 提取 VoucherForm.vue（凭证头部表单）
2. 提取 VoucherEntryTable.vue（分录表格）
3. 提取 EntryRow.vue（单行分录编辑）
4. 提取 AuxiliaryDialog.vue（辅助核算弹窗）
5. 提取 BatchDeleteDialog.vue（批量删除对话框）
6. 提取 AiSummaryButton.vue（AI智能摘要）
7. 使用 Composables 提取业务逻辑

#### Composables 设计
```typescript
// useVoucherForm.ts - 凭证表单逻辑
export function useVoucherForm() {
  const form = reactive({ ... })
  const validate = () => { ... }
  const submit = async () => { ... }
  return { form, validate, submit }
}

// useVoucherEntries.ts - 分录管理逻辑
export function useVoucherEntries() {
  const entries = ref([])
  const addEntry = () => { ... }
  const deleteEntry = (index) => { ... }
  const calculateTotal = () => { ... }
  return { entries, addEntry, deleteEntry, calculateTotal }
}

// useAiSummary.ts - AI摘要逻辑
export function useAiSummary() {
  const generateSummary = async (entries) => { ... }
  return { generateSummary }
}
```

### 2. BalanceSheet.vue 重构（816行 → 目标<400行）

#### 拆分方案
```
BalanceSheet.vue (主组件) - 250行
├── ReportHeader.vue (报表头部) - 80行
├── ReportTable.vue (报表表格) - 300行
│   ├── ReportSection.vue (报表分组) - 100行
│   └── ReportRow.vue (报表行) - 50行
└── ReportExport.vue (导出功能) - 100行
```

#### Composables 设计
```typescript
// useReportData.ts - 报表数据加载
export function useReportData() {
  const data = ref(null)
  const loading = ref(false)
  const fetchData = async (year, period) => { ... }
  return { data, loading, fetchData }
}

// useReportExport.ts - 报表导出
export function useReportExport() {
  const exportExcel = (data) => { ... }
  const exportPdf = (data) => { ... }
  return { exportExcel, exportPdf }
}
```

### 3. Account.vue 重构（600行 → 目标<400行）

#### 拆分方案
```
Account.vue (主组件) - 300行
├── AccountTree.vue (科目树) - 200行
├── AccountForm.vue (科目表单) - 150行
└── AccountImport.vue (科目导入) - 100行
```

### 4. Audit.vue 重构（579行 → 目标<400行）

#### 拆分方案
```
Audit.vue (主组件) - 250行
├── AuditFilter.vue (筛选条件) - 100行
├── AuditTable.vue (凭证列表) - 150行
└── BatchAuditDialog.vue (批量审核) - 120行
```

### 5. 通用组件提取

#### 创建公共组件库
```
src/components/common/
├── DataTable.vue (通用数据表格)
├── SearchForm.vue (通用搜索表单)
├── ExportButton.vue (通用导出按钮)
├── DateRangePicker.vue (日期区间选择器)
└── AmountInput.vue (金额输入框)
```

## 性能优化

### 1. 虚拟滚动
对于大数据量列表（>100条），使用虚拟滚动：
```typescript
import { useVirtualList } from '@vueuse/core'

const { list, containerProps, wrapperProps } = useVirtualList(
  largeList,
  { itemHeight: 50 }
)
```

### 2. 懒加载
对于复杂组件，使用懒加载：
```typescript
const VoucherEntryTable = defineAsyncComponent(() =>
  import('./components/VoucherEntryTable.vue')
)
```

### 3. 计算属性优化
避免在模板中使用复杂计算：
```typescript
// ❌ 不好
<div>{{ entries.filter(e => e.direction === 'debit').reduce((sum, e) => sum + e.amount, 0) }}</div>

// ✅ 好
const debitTotal = computed(() =>
  entries.value.filter(e => e.direction === 'debit').reduce((sum, e) => sum + e.amount, 0)
)
<div>{{ debitTotal }}</div>
```

## 实施时间表

| 任务 | 时间 | 优先级 |
|------|------|--------|
| Entry.vue 重构 | 2天 | 🔴 高 |
| BalanceSheet.vue 重构 | 1天 | 🟡 中 |
| Account.vue 重构 | 1天 | 🟡 中 |
| Audit.vue 重构 | 1天 | 🟡 中 |
| 通用组件提取 | 1天 | 🟢 低 |
| 性能优化 | 1天 | 🟡 中 |

**总计：7天**

## 预期收益
- 组件平均行数减少 50%
- 代码复用率提升 30%
- 首屏加载时间减少 20%
- 大列表渲染性能提升 80%
- 代码可维护性显著提升
