# BOM 多级树展开可视化页面 — 设计

日期：2026-06-23

## 背景与目标

供应链已支持多级 BOM（套装→主机→配件），但目前只能在 BOM 表单里看单层组件，缺一个**直观看整棵多级装配结构 + 用量/成本上推**的页面。本设计新增一个独立路由页，从 BOM 列表每行进入，把指定 BOM 完整炸开为多级树，并做用量与成本的逐层上推。

## 范围

- 入口：BomList 每行操作列加「展开」按钮 → 跳独立页 `/scm/boms/:id/tree`。
- 呈现：el-table 树形表格，节点含用量 + 成本汇总。
- 成本基准：物料档案进价 `purchase_price`（标准成本）；自制/装配件成本=子件累计，自身进价不计。
- **不改**现有 MRP（`explodeShortageMrp`）、单级 `explode`、BomForm。
- 不做：库存/可装配数列、移动平均成本切换（留待后续）。

## 后端

新增 `GET /scm/boms/:id/tree?qty=N`（默认 N=1），位于 `server/src/routes/scmDoc.ts`（紧邻现有 `/scm/boms/:id/explode`，约 line 1481）。

递归算法（复刻 `explodeShortageMrp` 的 `getBom` 取数与防环套路，scmDoc.ts:1084）：
- 根 = 该 BOM 的成品 `item_code`，根 `total_qty = N`。
- 子件 `per_qty = qty × (1 + scrap_rate/100)`；`total_qty = 父.total_qty × per_qty`。
- 按 `item_code` 查 active BOM：有 → 装配件，递归子件；无 → 叶子（采购件）。
- 成本上推：叶子 `unit_cost = item.purchase_price`；装配件 `unit_cost = Σ(子.per_qty × 子.unit_cost)`。`amount = total_qty × unit_cost`。
- 防环：沿路径 `Set` 去重，遇环停止并标记 `cycle:true`。

返回结构：
```jsonc
{ code:0, data:{
  bom_id, qty,
  root:{ item_code, item_name, spec, unit, level:0, item_type,
         per_qty, total_qty, scrap_rate, is_assembly, unit_cost, amount, children:[ ...同结构(level 递增)... ] },
  summary:{ unit_cost, total_cost, leaf_kinds, max_level }
}}
```
权限：复用 scmDoc.ts 现有 `/scm/boms` 网关（line 55/71 路径前缀判定），无需新权限。

前端 API：`client/src/api/scm.ts` 加 `getBomTree(id, qty?)`。

## 前端

新视图 `client/src/views/scm/BomTree.vue`，新路由 `/scm/boms/:id/tree`（注册于 `client/src/router/index.ts`，紧邻 ScmBomNew/Edit）。

- 顶部导航条：返回 + 标题「BOM 多级展开」+ 成品编号/名称 + 计划数量 `el-input-number`（改动重新请求重算）+ 一键展开/收起。
- el-table 树形表（`row-key`、`tree-props children`、`default-expand-all` 或一键展开），列：编号(缩进显示)、名称、规格、性质(成品/半成品/采购，按 item_type 映射)、单件用量、累计用量、单位、损耗%、单件成本、金额。
- 底部汇总条：成品单位成本 = `summary.unit_cost`；计划总成本 = `summary.total_cost`。
- 复用 ItemList 树表与一键展开/收起模式；row-key 用节点路径（item_code 可能在不同分支重复，需用路径或递增 id 作 key）。

BomList.vue：操作列加 `<el-button link @click="router.push('/scm/boms/'+row.id+'/tree')">展开</el-button>`。

## 边界
- BOM 无明细 → 根下空 children。
- 组件物料无 BOM → 叶子（采购件）。
- 环 → 停止递归并在该节点标记，不死循环。
- 物料档案缺失 → 名称/进价取空/0，不报错。

## 验证
1. 后端重启（改了 server 代码）。
2. API 直查 `GET /scm/boms/<BOM0004 id>/tree`：root=9004，children 含 9001(is_assembly,有自己的 children CPU 等) + 三外设(叶子)；unit_cost 上推正确。
3. 浏览器登录 ZT003 → BomList 点 BOM0004「展开」→ 树表显示多级；改计划数量累计用量/金额×倍；一键展开/收起；无控制台报错。
4. 更新 `优化日志.md`。
