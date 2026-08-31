## 销售订单关联表卡顿和报错修复方案

### 问题诊断

`/scm/sales-order-relations` 卡顿与报错有三层原因：

1. **BFS 没有节点总量上限**（`scmSalesOrderRelations.ts:258`）：BFS 只限制深度（≤20），但 frontier 宽度无限。一页最多 50 个根销售订单，每个根的下游关联子树展开后可能达到几千甚至上万节点（MRP 多物料 × 采购单 × 完工单 × 报工 × 质检）。

2. **`queryDocNodes` 行级相关子查询**（`scmSalesOrderRelations.ts:106-115`）：与上次修复 `queryDocRows` 同样的反模式，每个文档节点都带 3 个相关子查询（其中 2 个还做 JOIN 聚合）。N=1000 节点 → 3000 次子查询。

3. **arap_payment JOIN 4 表无索引**（`scmSalesOrderRelations.ts:300-309`）：`scm_ar_ap_log` 上没有 `(account_set_id, doc_type, doc_no)` 复合索引，JOIN 时全表扫描，是 BFS 每层最慢的一条 SQL。

4. **路由层无 try/catch**（`scmDoc.ts:410-422`）：任何 SQL 异常或字段问题都冒泡到 Express 默认错误处理器，前端只看到「销售订单关联数据加载失败」。

5. **前端 `load`/`selectNode` 吞错**（`SalesOrderRelations.vue:223, 260`）：`catch {}` 直接吞掉错误，控制台无日志，无法定位真实原因。

### 修复方案

#### 一、后端：加节点上限 + 批量化查询 + try/catch

**1. 加 BFS 节点总量上限**（`scmSalesOrderRelations.ts`）
- 设置 `MAX_NODES = 2000`，`allDocIds`、`allPlanIds`、`workIds`、`qcIds` 累计超过时提前结束 BFS（保住响应时间）。
- 在响应中加 `truncated: boolean` 字段告诉前端被截断了。

**2. 改造 `queryDocNodes`**（`scmSalesOrderRelations.ts:103-149`）
- 把每行 3 个相关子查询改为「批量聚合 + JS 合并」：
  - 先 `SELECT d.id, ... FROM scm_doc d LEFT JOIN scm_partner p ... WHERE id IN (...)`
  - 再批量算 `line_count`：`SELECT doc_id, COUNT(*) FROM scm_doc_line WHERE doc_id IN (...) GROUP BY doc_id`
  - 再批量算 `pushed_qty`：分别 `SELECT source_line_id, SUM(qty) FROM scm_doc_line WHERE source_line_id IN (相关 line_id) GROUP BY source_line_id`（scm_doc_line 下游）+ `SELECT source_line_id, SUM(plan_qty) FROM scm_production_plan_product WHERE source_line_id IN (...) GROUP BY source_line_id`，按 doc 聚合。
  - JS 端按 doc_id 合并。
- 逻辑保持与原来 1:1 一致，本地单测可作为对比基准。

**3. 简化 `arap_payment` 子查询**（同上）
- 现有 JOIN 是按 `(sd.doc_type, sd.doc_no) = (al.doc_type, al.doc_no)` 反查 al → sd，逻辑等价于「销售订单的明细行 arap_source_log_id 指向的 log 的 doc_type/doc_no = sd」。
- 可以改写为：先按 `arap_source_log_id IN (...)` 批量取 log，再按 log.doc_type+log.doc_no 批量取「源头单据 id」，再加 `dl.doc_id IN (源头单据 id) AND pd.doc_type IN ('RCV','PAY')` 过滤下游结算单。
- 这条改动较大，先用「加索引」解决主要瓶颈，**这一条 SQL 本身结构不动**（保持正确性），只靠索引提速。

**4. 路由层加 try/catch**（`scmDoc.ts:410-422`）
- 包装 `querySalesOrderRelations` 调用，出错时返回 `{ code: 500, message: '销售订单关联数据查询失败', detail: err.message }`，并 `console.error` 打栈到后端日志。
- 这样前端能看到具体错误（前端 axios catch 也能拿到 message），后端日志能定位。

#### 二、索引迁移（版本 103）

新建 `server/src/db/migrations/20260720_add_scm_arap_doc_index.ts`：

```sql
CREATE INDEX IF NOT EXISTS idx_scm_arap_doc
  ON scm_ar_ap_log(account_set_id, doc_type, doc_no);
```

并在 `migrationList.ts` 注册。

#### 三、前端：错误透传 + 截断提示

**1. `load`/`selectNode` 的 catch 加 `console.error`**（`SalesOrderRelations.vue`）
- 把吞掉的错误打到控制台，便于排查。
- 错误信息从 `error?.response?.data?.message` 取（如果有），后端 try/catch 后会有具体 message。

**2. 截断提示**
- 接口返回 `truncated: true` 时，前端弹 `ElMessage.warning('关联范围过大，已截断显示前 2000 个节点，请缩小查询条件')`。

### 修改文件清单

| 文件 | 改动 |
|---|---|
| `server/src/services/scmSalesOrderRelations.ts` | 加 MAX_NODES 上限；改造 `queryDocNodes` 为批量聚合；返回结构加 `truncated` 字段 |
| `server/src/routes/scmDoc.ts` | 路由层加 try/catch |
| `server/src/db/migrations/20260720_add_scm_arap_doc_index.ts` | 新建（版本 103） |
| `server/src/db/migrationList.ts` | 注册新迁移 |
| `client/src/views/scm/SalesOrderRelations.vue` | catch 加 console.error + 截断提示；类型补充 truncated |
| `client/src/api/scm.ts` | SalesOrderRelationResult 加 `truncated?: boolean` |
| `优化日志.md` | 追加本次修复条目 |

### 不改动

- arap_payment 4 表 JOIN SQL 本身（保持正确性，靠索引提速）
- BFS 的 6 类边查询逻辑（已有索引）
- 前端 UI 结构

### 验证

1. 跑现有单测：`npx vitest run server/src/__tests__/scmSalesOrderRelations.test.ts`（5 个用例必须全通过——验证批量化改造没有改变行为）
2. 跑迁移：`npm run db:migrate --workspace=server`
3. 重启后端
4. 直接打 API 验证：`/scm/sales-order-relations?page=1&page_size=20` 返回结构与改造前一致
5. 在 mock 数据库（用现有单测的 in-memory db）压测大量节点，验证 MAX_NODES 上限生效

### 风险

- **批量化改造与原行为必须 1:1**。靠现有 5 个单测做基线保护。
- MAX_NODES=2000 是经验值，可调。
- 索引迁移在生产大表上需要几秒，不影响业务。