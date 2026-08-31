# Sales Order Draft Dispatch MRP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 销售订单下推销售出库草稿后仍可生成 MRP，只有已审核出库才扣减 MRP 需求。

**Architecture:** 将销售出库的“草稿占用口径”和 MRP 的“已履行需求口径”分离。统一下推菜单与 MRP 来源规范化分别使用一致的已审核出库数量。

**Tech Stack:** Node.js、TypeScript、better-sqlite3、Vitest

---

### Task 1: 锁定菜单与 MRP 来源行为

**Files:**
- Modify: `server/src/__tests__/scmPushOptions.test.ts`
- Modify: `server/src/__tests__/scmMrpDocument.test.ts`

- [x] **Step 1: 添加失败测试**

在统一下推测试中建立已审核销售订单和全量销售出库草稿，断言销售出库为 `blocked_draft`，MRP 为 `available`。

在 MRP 文档测试中断言草稿出库不扣需求；将出库状态更新为 `audited` 后，需求才由 10 降为 6。

- [x] **Step 2: 运行测试并确认失败原因**

Run:

```bash
npm.cmd run test --workspace=server -- src/__tests__/scmPushOptions.test.ts src/__tests__/scmMrpDocument.test.ts --run
```

Expected: 两项新增断言失败；现有实现错误地把草稿出库计入 MRP 已履行量。

### Task 2: 分离出库占用与 MRP 需求口径

**Files:**
- Modify: `server/src/services/scmPushOptions.ts`
- Modify: `server/src/services/scmMrpDocument.ts`

- [x] **Step 1: 修改 MRP 来源规范化**

`normalizeSalesOrder` 的下游数量查询关联 `scm_doc`，仅统计：

```sql
cd.doc_type='SO' AND cd.status='audited'
```

- [x] **Step 2: 修改统一下推菜单**

保留全部未作废出库的 `pushed_qty` 计算，同时新增仅统计已审核出库的 `mrp_pushed_qty`。使用前者计算销售出库入口，使用后者计算 MRP 缺口。

- [x] **Step 3: 运行回归测试**

Run:

```bash
npm.cmd run test --workspace=server -- src/__tests__/scmPushOptions.test.ts src/__tests__/scmMrpDocument.test.ts src/__tests__/scmSalesOrderAvailability.test.ts src/__tests__/scmBatchDocuments.test.ts --run
```

Expected: 4 个测试文件、34 项测试全部通过。

### Task 3: 服务验证与记录

**Files:**
- Modify: `优化日志.md`

- [x] **Step 1: 重启开发服务**

重启 3105 后端与 5275 前端，后端明确连接 `data/finance-0523.db`。

- [x] **Step 2: 校验服务状态**

确认 3105、5275 均监听，并使用开发账套令牌读取销售订单接口返回 HTTP 200。

- [x] **Step 3: 更新优化日志**

记录业务口径、修改文件、测试结果、构建限制及无迁移说明。
