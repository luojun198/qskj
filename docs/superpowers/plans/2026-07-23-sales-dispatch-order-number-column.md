# 销售发货单明细显示销售订单号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在销售发货单新增、编辑、查看页面的每条明细中显示对应销售订单号，多来源使用中文顿号连接。

**Architecture:** 后端根据直接 `source_line_id` 和 `field_values.source_line_allocations` 批量反查 `SOa` 单号并返回 `sales_order_no`。前端新建时从可用量数据即时生成，重新加载时使用详情接口返回值；表格列仅对 `SO` 显示。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Express、better-sqlite3、Vitest

---

### Task 1: 后端销售订单号聚合服务

**Files:**
- Create: `server/src/services/scmSalesDispatchOrderNumbers.ts`
- Create: `server/src/__tests__/scmSalesDispatchOrderNumbers.test.ts`

- [ ] **Step 1: 编写失败测试**

建立内存数据库，创建最小 `scm_doc`、`scm_doc_line` 表，覆盖：

```ts
expect(result.get('SHIP-L1')).toBe('SOA-001')
expect(result.get('SHIP-L2')).toBe('SOA-001、SOA-002')
expect(result.has('SHIP-L3')).toBe(false)
```

其中 `SHIP-L1` 使用直接来源；`SHIP-L2` 使用重复的 `source_line_allocations`；`SHIP-L3` 指向非 `SOa` 单据。

- [ ] **Step 2: 验证测试因功能缺失而失败**

Run:

```bash
npm run test --workspace=server -- src/__tests__/scmSalesDispatchOrderNumbers.test.ts --run
```

Expected: FAIL，提示无法导入 `getSalesDispatchOrderNosByLine`。

- [ ] **Step 3: 实现最小聚合服务**

导出：

```ts
export function getSalesDispatchOrderNosByLine(
  db: Database.Database,
  accountSetId: string,
  lines: Array<{ id?: string; source_line_id?: string | null; field_values?: string | Record<string, any> | null }>,
): Map<string, string>
```

实现要求：

- 收集直接来源行和 `source_line_allocations` 中的来源行。
- 对来源行 ID 去重后一次查询。
- 只连接 `source.doc_type='SOa'` 且账套一致的数据。
- 每条发货行的订单号去重、按中文排序、使用 `、` 连接。
- 无合法来源时不写入 Map。

- [ ] **Step 4: 验证后端服务测试通过**

Run:

```bash
npm run test --workspace=server -- src/__tests__/scmSalesDispatchOrderNumbers.test.ts --run
```

Expected: PASS。

### Task 2: 销售发货详情接口返回订单号

**Files:**
- Modify: `server/src/routes/scmDoc.ts`
- Modify: `client/src/api/scm.ts`
- Test: `server/src/__tests__/scmSalesDispatchOrderNumbers.test.ts`

- [ ] **Step 1: 扩展失败测试**

增加断言，验证聚合结果可直接赋值到发货明细：

```ts
const orderNos = getSalesDispatchOrderNosByLine(db, 'A1', lines)
expect(lines.map(line => orderNos.get(line.id) || '')).toEqual([
  'SOA-001',
  'SOA-001、SOA-002',
  '',
])
```

- [ ] **Step 2: 验证新增断言失败**

运行 Task 1 的测试命令，确认失败原因是当前测试数据或接口映射尚未满足新断言。

- [ ] **Step 3: 接入详情路由和类型**

在 `GET /scm/docs/:id` 的 `lines` 查询后执行：

```ts
if (doc.doc_type === 'SO') {
  const orderNos = getSalesDispatchOrderNosByLine(db, asid(req), lines)
  for (const line of lines) line.sales_order_no = orderNos.get(line.id) || ''
}
```

同时给 `ScmDocLine` 增加：

```ts
sales_order_no?: string
```

- [ ] **Step 4: 验证后端测试通过**

运行 Task 1 测试命令，Expected: PASS。

### Task 3: 新建发货明细生成并合并订单号

**Files:**
- Modify: `client/src/utils/scmSalesDispatch.ts`
- Modify: `client/src/utils/__tests__/scmSalesDispatch.spec.ts`

- [ ] **Step 1: 编写失败测试**

增加两项断言：

```ts
expect(buildSalesDispatchLines([row])[0].sales_order_no).toBe('SOA-001')
```

```ts
expect(mergeSalesDispatchLines([
  { ...line1, sales_order_no: 'SOA-002' },
  { ...line2, sales_order_no: 'SOA-001' },
  { ...line3, sales_order_no: 'SOA-002' },
])[0].sales_order_no).toBe('SOA-001、SOA-002')
```

- [ ] **Step 2: 验证测试失败**

Run:

```bash
npm run test --workspace=client -- src/utils/__tests__/scmSalesDispatch.spec.ts --run
```

Expected: FAIL，实际值缺少 `sales_order_no`。

- [ ] **Step 3: 实现订单号生成与合并**

- `buildSalesDispatchLines` 把 `row.source_doc_no` 写入 `sales_order_no`。
- `mergeSalesDispatchLines` 合并同组明细时收集订单号，去重、中文排序并使用 `、` 拼接。
- 单来源及未合并行保持原订单号。

- [ ] **Step 4: 验证前端工具测试通过**

运行 Step 2 命令，Expected: PASS。

### Task 4: 销售发货表格增加只读列

**Files:**
- Modify: `client/src/views/scm/DocForm.vue`
- Modify: `client/src/views/scm/__tests__/DocFormInitialization.spec.ts`

- [ ] **Step 1: 编写失败组件结构测试**

读取 `DocForm.vue` 源码并断言：

```ts
expect(source).toContain('column-key="sales_order_no"')
expect(source).toContain('label="销售订单号"')
expect(source).toContain("available: () => form.value.doc_type === 'SO'")
```

- [ ] **Step 2: 验证组件测试失败**

Run:

```bash
npm run test --workspace=client -- src/views/scm/__tests__/DocFormInitialization.spec.ts --run
```

Expected: FAIL，模板尚无该列。

- [ ] **Step 3: 增加只读列和列配置**

在规格列后增加：

```vue
<el-table-column
  v-if="form.doc_type === 'SO'"
  column-key="sales_order_no"
  label="销售订单号"
  min-width="170"
  prop="sales_order_no"
  show-overflow-tooltip
>
  <template #default="{ row }">{{ row.__summary ? '' : (row.sales_order_no || '—') }}</template>
</el-table-column>
```

在 `LINE_CORE_COLUMNS` 增加仅 `SO` 可用的同名列，使列顺序设置包含它。

- [ ] **Step 4: 验证组件测试通过**

运行 Step 2 命令，Expected: PASS。

### Task 5: 全量验证与记录

**Files:**
- Modify: `优化日志.md`

- [ ] **Step 1: 运行相关测试**

```bash
npm run test --workspace=server -- src/__tests__/scmSalesDispatchOrderNumbers.test.ts --run
npm run test --workspace=client -- src/utils/__tests__/scmSalesDispatch.spec.ts src/views/scm/__tests__/DocFormInitialization.spec.ts --run
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行类型检查和生产构建**

```bash
npm run build:deploy --workspace=client
npm run build --workspace=server
```

Expected: 两项退出码均为 0。

- [ ] **Step 3: 更新优化日志**

在 `2026-07-23` 下记录修改文件、两种来源聚合口径、无数据库迁移，以及后端代码修改后需重启服务。

- [ ] **Step 4: 重启服务并冒烟**

运行项目既有重启脚本，访问目标销售发货单，确认：

- 页面正常加载。
- 明细出现“销售订单号”。
- 多来源用 `、` 显示。
- 浏览器控制台无新增 Vue 错误。
