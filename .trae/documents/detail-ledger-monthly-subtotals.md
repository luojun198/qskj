# 明细账按月份插入小计行计划

## 概述

在明细账页面（`/ledger/detail`）中，按月份分组显示数据，在每个月的最后一笔记录后插入2行：
1. **本月合计**：显示当月的借方合计、贷方合计和月末余额
2. **本年累计**：显示从年初到当月的累计借方、累计贷方和累计余额

## 当前状态分析

### 前端实现（`client/src/views/ledger/Detail.vue`）
- 明细账数据通过 `/ledger/detail` API 获取
- 数据结构：包含 `voucher_date`、`voucher_no`、`summary`、`direction`、`amount`、`running_balance` 等字段
- 当前显示方式：按日期顺序显示所有分录，没有按月份分组
- 第一行显示"期初余额"（`buildCarryForwardRow`）
- 表格底部有合计行（`getSummaries` 函数）
- 支持分页显示（`currentPage`、`pageSize`）

### 后端实现（`server/src/routes/ledger.ts`）
- 路由：`GET /ledger/detail`
- 查询函数：`buildLedgerDetailQuery`（位于 `services/ledgerQuery.ts`）
- 返回数据：
  - `data`：分录列表
  - `initBalance`：期初余额
  - `total`：总记录数（用于分页）
- 数据按 `voucher_date` 排序

### 数据流程
1. 前端调用 API 获取分录数据
2. 前端计算每行的 `running_balance`（累计余额）
3. 前端在第一行插入"期初余额"行
4. 表格显示所有数据

## 需求分析

### 功能需求
1. **按月份分组**：将分录按月份（`YYYY-MM`）分组
2. **插入小计行**：在每个月的最后一笔后插入2行：
   - **本月合计**：
     - 摘要列显示："本月合计"
     - 借方列：当月所有借方金额合计
     - 贷方列：当月所有贷方金额合计
     - 余额列：当月最后一笔的余额（月末余额）
   - **本年累计**：
     - 摘要列显示："本年累计"
     - 借方列：从年初到当月的累计借方金额
     - 贷方列：从年初到当月的累计贷方金额
     - 余额列：当月最后一笔的余额（与本月合计相同）

### 显示规则
- 小计行的样式应与普通行区分（如背景色、字体加粗）
- 小计行不可点击、不可编辑
- 小计行不参与表格底部的总合计计算
- 分页时，小计行应该包含在当前页的数据中

### 边界情况
- 如果某月没有数据，不显示该月的小计行
- 如果查询跨年，每年的1月都应该重置"本年累计"
- 期初余额行不参与月度小计

## 设计决策

### 方案选择：前端计算 vs 后端计算

**选择：前端计算**

**理由：**
1. **分页兼容性**：后端分页返回的是原始分录，前端可以在当前页数据中插入小计行
2. **灵活性**：前端可以根据显示需求动态调整小计行的样式和内容
3. **性能**：明细账数据量通常不大（分页后每页50-200条），前端计算开销可接受
4. **简单性**：不需要修改后端 SQL 查询和数据结构

### 实现方式

**前端处理流程：**
1. 获取 API 返回的分录数据
2. 计算每行的 `running_balance`（现有逻辑）
3. 按月份分组数据
4. 在每个月的最后一笔后插入2行小计数据
5. 标记小计行（添加特殊字段如 `is_monthly_subtotal`、`is_yearly_subtotal`）
6. 渲染表格时根据标记应用特殊样式

## 实施步骤

### 步骤 1：修改前端数据处理逻辑

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
1. 在 `fetchData` 函数中，计算完 `running_balance` 后，调用新函数 `insertMonthlySubtotals`
2. 创建 `insertMonthlySubtotals` 函数，实现按月份分组和插入小计行的逻辑

**代码逻辑**：
```typescript
function insertMonthlySubtotals(entries: any[], initBalance: number): any[] {
  if (entries.length === 0) return entries
  
  const result: any[] = []
  let currentMonth = ''
  let monthlyDebit = 0
  let monthlyCredit = 0
  let yearlyDebit = 0
  let yearlyCredit = 0
  let currentYear = ''
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const entryMonth = entry.voucher_date.substring(0, 7) // YYYY-MM
    const entryYear = entry.voucher_date.substring(0, 4) // YYYY
    
    // 检测年份变化，重置年度累计
    if (entryYear !== currentYear) {
      currentYear = entryYear
      yearlyDebit = 0
      yearlyCredit = 0
    }
    
    // 检测月份变化，插入上月小计
    if (currentMonth && entryMonth !== currentMonth) {
      // 插入本月合计
      result.push({
        id: `__monthly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31', // 月末日期
        voucher_no: '',
        voucher_type_name: '',
        summary: '本月合计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_monthly_subtotal: true,
        monthly_debit: monthlyDebit,
        monthly_credit: monthlyCredit,
      })
      
      // 插入本年累计
      result.push({
        id: `__yearly_subtotal_${currentMonth}__`,
        voucher_date: currentMonth + '-31',
        voucher_no: '',
        voucher_type_name: '',
        summary: '本年累计',
        opposite_accounts: '',
        direction: '',
        amount: 0,
        running_balance: result[result.length - 1].running_balance,
        is_yearly_subtotal: true,
        yearly_debit: yearlyDebit,
        yearly_credit: yearlyCredit,
      })
      
      // 重置月度累计
      monthlyDebit = 0
      monthlyCredit = 0
    }
    
    // 累加当月和当年金额
    if (entry.direction === 'debit') {
      monthlyDebit += entry.amount
      yearlyDebit += entry.amount
    } else if (entry.direction === 'credit') {
      monthlyCredit += entry.amount
      yearlyCredit += entry.amount
    }
    
    currentMonth = entryMonth
    result.push(entry)
  }
  
  // 处理最后一个月的小计
  if (currentMonth && entries.length > 0) {
    result.push({
      id: `__monthly_subtotal_${currentMonth}__`,
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      voucher_type_name: '',
      summary: '本月合计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_monthly_subtotal: true,
      monthly_debit: monthlyDebit,
      monthly_credit: monthlyCredit,
    })
    
    result.push({
      id: `__yearly_subtotal_${currentMonth}__`,
      voucher_date: currentMonth + '-31',
      voucher_no: '',
      voucher_type_name: '',
      summary: '本年累计',
      opposite_accounts: '',
      direction: '',
      amount: 0,
      running_balance: result[result.length - 1].running_balance,
      is_yearly_subtotal: true,
      yearly_debit: yearlyDebit,
      yearly_credit: yearlyCredit,
    })
  }
  
  return result
}
```

### 步骤 2：修改表格列显示逻辑

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
1. 修改借方列的显示逻辑，识别小计行并显示对应的合计金额
2. 修改贷方列的显示逻辑，识别小计行并显示对应的合计金额
3. 修改方向列和余额列的显示逻辑

**代码**：
```vue
<!-- 借方列 -->
<el-table-column column-key="借方" label="借方" :width="colWidth('借方', 140)" align="right">
  <template #default="{ row }">
    <template v-if="row.is_monthly_subtotal">
      {{ formatAmount(row.monthly_debit) }}
    </template>
    <template v-else-if="row.is_yearly_subtotal">
      {{ formatAmount(row.yearly_debit) }}
    </template>
    <template v-else>
      {{ row.direction === 'debit' ? formatAmount(row.amount) : '' }}
    </template>
  </template>
</el-table-column>

<!-- 贷方列 -->
<el-table-column column-key="贷方" label="贷方" :width="colWidth('贷方', 140)" align="right">
  <template #default="{ row }">
    <template v-if="row.is_monthly_subtotal">
      {{ formatAmount(row.monthly_credit) }}
    </template>
    <template v-else-if="row.is_yearly_subtotal">
      {{ formatAmount(row.yearly_credit) }}
    </template>
    <template v-else>
      {{ row.direction === 'credit' ? formatAmount(row.amount) : '' }}
    </template>
  </template>
</el-table-column>
```

### 步骤 3：添加小计行样式

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
1. 使用 `el-table` 的 `row-class-name` 属性为小计行添加特殊样式类
2. 添加 CSS 样式定义

**代码**：
```vue
<el-table
  :row-class-name="getRowClassName"
  ...
>
```

```typescript
function getRowClassName({ row }: { row: any }) {
  if (row.is_monthly_subtotal) return 'monthly-subtotal-row'
  if (row.is_yearly_subtotal) return 'yearly-subtotal-row'
  if (row.is_carry_forward) return 'carry-forward-row'
  return ''
}
```

```css
<style scoped>
:deep(.monthly-subtotal-row) {
  background-color: #f0f9ff !important;
  font-weight: 600;
}

:deep(.yearly-subtotal-row) {
  background-color: #fef3c7 !important;
  font-weight: 600;
}

:deep(.carry-forward-row) {
  background-color: #f3f4f6 !important;
  font-weight: 500;
}
</style>
```

### 步骤 4：修改合计行计算逻辑

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
修改 `getSummaries` 函数，排除小计行参与总合计计算

**代码**：
```typescript
function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns, data } = param
  const sums: string[] = []
  
  // 过滤掉小计行和期初余额行
  const normalEntries = data.filter(
    row => !row.is_monthly_subtotal && !row.is_yearly_subtotal && !row.is_carry_forward
  )

  columns.forEach((_column, index) => {
    if (index === 0) {
      sums[index] = '合计'
      return
    }
    if (index === 1 || index === 2 || index === 3) {
      sums[index] = ''
      return
    }

    // 借方
    if (index === 4) {
      const total = normalEntries.reduce(
        (sum, row) => sum + (row.direction === 'debit' ? row.amount : 0),
        0
      )
      sums[index] = formatAmount(total)
    }
    // 贷方
    else if (index === 5) {
      const total = normalEntries.reduce(
        (sum, row) => sum + (row.direction === 'credit' ? row.amount : 0),
        0
      )
      sums[index] = formatAmount(total)
    }
    // 方向和余额（使用最后一条普通记录）
    else if (index === 6 || index === 7) {
      const lastRow = normalEntries[normalEntries.length - 1]
      if (lastRow) {
        if (index === 6) {
          const balance = lastRow.running_balance
          sums[index] =
            balance === 0
              ? '平'
              : balance > 0
                ? selectedAccount.value?.direction === 'debit'
                  ? '借'
                  : '贷'
                : selectedAccount.value?.direction === 'debit'
                  ? '贷'
                  : '借'
        } else {
          sums[index] = formatAmount(Math.abs(lastRow.running_balance))
        }
      }
    }
  })

  return sums
}
```

### 步骤 5：修改导出逻辑

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
修改 `exportData` 函数，确保导出的 Excel 也包含小计行

**代码**：
```typescript
async function exportData() {
  // ... 现有代码 ...
  
  // 计算余额后，插入小计行
  const exportRows = insertMonthlySubtotals(
    [buildCarryForwardRow(exportInitBalance), ...entries],
    exportInitBalance
  )
  
  // ... 其余导出逻辑 ...
}
```

### 步骤 6：处理双击事件

**文件**：`client/src/views/ledger/Detail.vue`

**修改点**：
修改 `handleLedgerRowDblClick` 函数，禁止双击小计行

**代码**：
```typescript
const { handleLedgerRowDblClick } = useLedgerVoucherNavigate({
  returnLabel: '明细账',
  getReturnQuery: () => ({
    account_id: filters.value.account_id || '',
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
  }),
  openVoucherModal: row => {
    // 忽略小计行和期初余额行
    if (row.is_monthly_subtotal || row.is_yearly_subtotal || row.is_carry_forward) {
      return
    }
    
    const voucherId = resolveLedgerVoucherId(row)
    if (!voucherId) return
    entryDialogHostRef.value?.open({
      _voucherId: voucherId,
      id: voucherId,
      status: row.voucher_status,
    })
  },
})
```

## 验证步骤

### 功能验证
1. **基本显示**：
   - 打开明细账页面
   - 选择科目和日期范围（跨多个月）
   - 验证每个月的最后一笔后是否显示"本月合计"和"本年累计"

2. **金额计算**：
   - 验证"本月合计"的借方、贷方金额是否正确
   - 验证"本年累计"的借方、贷方金额是否正确
   - 验证余额列显示是否正确

3. **样式显示**：
   - 验证小计行的背景色是否正确
   - 验证小计行的字体是否加粗

4. **交互功能**：
   - 双击小计行，验证不会打开凭证弹窗
   - 验证表格底部的合计行不包含小计行的金额

5. **分页功能**：
   - 切换页码，验证小计行是否正确显示
   - 修改每页数量，验证小计行是否正确显示

6. **导出功能**：
   - 导出 Excel，验证小计行是否包含在导出文件中
   - 验证导出文件的格式和样式

7. **打印功能**：
   - 打印页面，验证小计行是否正确显示

### 边界情况验证
1. **单月数据**：查询单个月的数据，验证小计行显示
2. **跨年数据**：查询跨年的数据，验证年度累计在新年重置
3. **空数据**：查询无数据的科目，验证不显示小计行
4. **期初余额**：验证期初余额行不参与月度小计

## 注意事项

### 性能考虑
- 小计行的插入在前端进行，对于大数据量（每页500条以上）可能有性能影响
- 建议保持分页大小在合理范围（50-200条）

### 兼容性
- 小计行的标记字段（`is_monthly_subtotal`、`is_yearly_subtotal`）不会影响现有功能
- 导出和打印功能需要同步更新以支持小计行

### 扩展性
- 如果未来需要支持季度小计、半年小计，可以复用相同的逻辑
- 小计行的样式可以通过 CSS 变量配置，方便主题定制

## 时间估算

- 步骤 1：修改数据处理逻辑 - 1 小时
- 步骤 2：修改表格列显示 - 0.5 小时
- 步骤 3：添加样式 - 0.5 小时
- 步骤 4：修改合计行计算 - 0.5 小时
- 步骤 5：修改导出逻辑 - 0.5 小时
- 步骤 6：处理双击事件 - 0.5 小时
- 测试验证 - 1 小时

**总计**：约 4.5 小时
