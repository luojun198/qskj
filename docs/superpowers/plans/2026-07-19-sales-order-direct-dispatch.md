# 销售订单直达销售出库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 销售订单下推销售出库时，按实时未下推量和库存直接进入可编辑出库单。

**Architecture:** 复用现有库存可用量接口，不新增后端口径。新增纯函数负责把可用量行映射为销售出库明细；DocForm 在 `SOa → SO` 时使用该函数，下推菜单直接导航到新建单据页。

**Tech Stack:** Vue 3、TypeScript、Vue Router、Vitest。

---

### Task 1: 锁定直达路由和数量映射

**Files:**
- Modify: `client/src/utils/__tests__/scmDocNavigation.spec.ts`
- Create: `client/src/utils/__tests__/scmSalesDispatch.spec.ts`

- [x] **Step 1: 写失败测试**

断言销售出库直达 `ScmDocNew`，并断言仅把 `ship_qty > 0` 的库存可发行映射为出库明细。

- [x] **Step 2: 运行测试确认 RED**

Run: `npm run test --workspace=client -- --run client/src/utils/__tests__/scmDocNavigation.spec.ts client/src/utils/__tests__/scmSalesDispatch.spec.ts`

Expected: 因新路由函数和映射模块不存在而失败。

### Task 2: 实现最小直达流程

**Files:**
- Modify: `client/src/utils/scmDocNavigation.ts`
- Create: `client/src/utils/scmSalesDispatch.ts`
- Modify: `client/src/components/scm/ScmPushMenu.vue`
- Modify: `client/src/views/scm/DocForm.vue`

- [x] **Step 1: 实现 `scmSalesDispatchDraftRoute(sourceId)`**

返回 `{ name: 'ScmDocNew', query: { doc_type: 'SO', source_doc_id: sourceId } }`。

- [x] **Step 2: 实现 `buildSalesDispatchLines`**

过滤 `ship_qty <= 0`，以 `ship_qty` 作为数量，并保留价格、税率、金额、仓库和 `source_line_id`。

- [x] **Step 3: 接入菜单与表单**

菜单选择销售出库时直达新建页；DocForm 加载 `SOa → SO` 来源时调用库存可用量接口并按可发量预填。

- [x] **Step 4: 运行专项测试确认 GREEN**

Run: `npm run test --workspace=client -- --run client/src/utils/__tests__/scmDocNavigation.spec.ts client/src/utils/__tests__/scmSalesDispatch.spec.ts`

Expected: 全部通过。

### Task 3: 验证与日志

**Files:**
- Modify: `优化日志.md`

- [x] **Step 1: 运行前端类型检查和构建**

Run: `npm run build --workspace=client`

Expected: 类型检查与 Vite 构建通过；若被工作区既有错误阻断，记录完整错误边界。

- [x] **Step 2: 更新优化日志**

记录修改文件、实时库存口径、无需后端重启与无需数据库迁移。
