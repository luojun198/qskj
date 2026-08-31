# Purchase Receipt Order Number Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在采购入库明细中显示可追溯的采购订单号，多来源使用顿号连接。

**Architecture:** 复用销售发货订单号的来源行聚合模式，在后端详情接口实时计算历史数据，在前端新建流程写入临时展示字段。字段不落库，来源关系仍以现有行级键为准。

**Tech Stack:** Vue 3、TypeScript、Node.js、Express、better-sqlite3、Vitest

---

### Task 1: 后端采购订单号聚合

**Files:**
- Modify: `server/src/services/scmSalesDispatchOrderNumbers.ts`
- Modify: `server/src/__tests__/scmSalesDispatchOrderNumbers.test.ts`
- Modify: `server/src/routes/scmDoc.ts`

- [x] **Step 1: 添加失败测试**

新增采购入库明细测试，覆盖直接来源、多来源分配、去重、账套隔离和非 PO 来源过滤。

- [x] **Step 2: 运行测试确认失败**

```bash
npm.cmd run test --workspace=server -- src/__tests__/scmSalesDispatchOrderNumbers.test.ts --run
```

Expected: `getPurchaseReceiptOrderNosByLine` 尚不存在或详情接口未写入 `purchase_order_no`。

- [x] **Step 3: 实现通用来源订单号聚合**

将现有来源行收集逻辑参数化为来源单类型，并保留销售包装函数；新增采购包装函数：

```ts
getPurchaseReceiptOrderNosByLine(db, accountSetId, lines)
```

- [x] **Step 4: 接入采购入库详情**

当 `doc.doc_type === 'PI'` 时，为每行写入：

```ts
line.purchase_order_no = orderNos.get(line.id) || ''
```

### Task 2: 前端采购订单号列

**Files:**
- Modify: `client/src/api/scm.ts`
- Modify: `client/src/views/scm/DocForm.vue`
- Modify: `client/src/components/scm/SourceDocPicker.vue`
- Modify: `client/src/utils/scmMultiSource.ts`
- Modify: `client/src/utils/__tests__/scmMultiSource.spec.ts`
- Create: `client/src/views/scm/__tests__/DocFormPurchaseOrderNumber.spec.ts`

- [x] **Step 1: 添加失败测试**

锁定采购入库列、详情映射、单订单下推、多来源下推及反向选择源单必须携带采购订单号。

- [x] **Step 2: 实现前端字段与列**

在 `ScmDocLine` 增加 `purchase_order_no?: string`；PI 明细渲染只读“采购订单号”列并加入列设置。

- [x] **Step 3: 补齐新建流程**

单来源使用采购订单头 `doc_no`；多来源工具输出 `source_doc_no`；源单选择器使用当前来源行的 `doc_no`。

### Task 3: 验证与记录

**Files:**
- Modify: `优化日志.md`

- [x] **Step 1: 运行相关回归**

```bash
npm.cmd run test --workspace=server -- src/__tests__/scmSalesDispatchOrderNumbers.test.ts --run
npm.cmd run test --workspace=client -- src/utils/__tests__/scmMultiSource.spec.ts src/views/scm/__tests__/DocFormPurchaseOrderNumber.spec.ts --run
```

- [x] **Step 2: 重启服务并验证真实采购入库详情**

重启 3105/5275，读取开发账套采购入库详情，确认 `purchase_order_no` 与来源采购订单一致。

- [x] **Step 3: 更新优化日志**

记录修改文件、顿号规则、测试结果、服务重启和无迁移说明。
