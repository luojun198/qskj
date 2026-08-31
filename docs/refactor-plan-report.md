# Report.ts 重构计划

## 目标
将 665 行的 report.ts 拆分为多个职责单一的路由文件

## 当前结构分析
```
report.ts 当前结构：
- 资产负债表：~120行
- 收入费用表：~150行
- 现金流量表：~100行
- 净资产变动表：~80行
- 财政拨款收支表：~80行
- 辅助余额表：~60行
- AI功能（异常检测、配置）：~75行
```

## 拆分方案

### 1. reportFinancial.ts (财务报表) - 新建 ~350行
- GET /report/balance-sheet - 资产负债表
- GET /report/income-statement - 收入费用表
- GET /report/cash-flow - 现金流量表
- GET /report/equity-changes - 净资产变动表
- GET /report/fiscal-appropriation - 财政拨款收支表

### 2. reportAuxiliary.ts (辅助报表) - 新建 ~80行
- GET /report/aux-balance - 辅助余额表
- GET /report/aux-detail - 辅助明细表（未来扩展）

### 3. reportAi.ts (AI功能) - 新建 ~80行
- POST /report/ai/anomaly-check - AI凭证异常检测
- GET /report/ai/config - AI配置查询
- PUT /report/ai/config - AI配置保存

### 4. reportExport.ts (报表导出) - 新建 ~100行（未来扩展）
- POST /report/export/excel - 导出Excel
- POST /report/export/pdf - 导出PDF
- POST /report/export/custom - 自定义报表导出

## 实施步骤

### Step 1: 创建新路由文件（1天）
1. 创建 reportFinancial.ts
2. 创建 reportAuxiliary.ts
3. 创建 reportAi.ts
4. 迁移对应代码并调整导入

### Step 2: 优化报表计算逻辑（1天）
将复杂的报表计算逻辑下沉到服务层：
- 创建 reportCalculation.ts 服务
- 提取资产负债表计算逻辑
- 提取收入费用表计算逻辑
- 提取现金流量表计算逻辑

### Step 3: 统一报表响应格式（0.5天）
```typescript
interface ReportResponse {
  code: number
  data: {
    title: string
    period: { year: number; period: number }
    sections: ReportSection[]
    summary: Record<string, number>
  }
}
```

### Step 4: 测试验证（0.5天）
1. 测试所有报表接口
2. 验证数据准确性
3. 性能测试（大数据量）

## 预期收益
- 单文件行数：665 → 350（减少47%）
- 报表逻辑更清晰
- 便于添加新报表类型
- 计算逻辑可复用
