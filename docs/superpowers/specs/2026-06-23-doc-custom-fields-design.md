# 业务单据 表头/表尾 自定义字段 — 设计文档

- 日期：2026-06-23
- 模块：供应链（SCM）业务单据
- 方案：A —— 新建 `scm_doc_field_defs` 定义表（按单据类型 + 位置），值复用现有 `scm_doc.field_values`
- 状态：设计已与用户逐段确认通过，待评审 → 进入实现计划

## 1. 需求

给「业务类单据」的**单据头**增加用户可自定义的字段，分「表头(header)」「表尾(footer)」两个位置呈现。自定义字段需同步出现在：**录入/编辑/查看页、单据打印、单据列表**三处。明细行（表体）不在本期范围。

「业务类单据」= SCM 全部单据类型（库存/采购/销售/生产/委外/收付款），见 `server/src/routes/scmDoc.ts` 的 `CODE_CATEGORY` 与 `seedDocTypes()`。

## 2. 现状盘点（实现前提）

- `scm_doc`（表头）与 `scm_doc_line`（明细）**均已有** `field_values TEXT NOT NULL DEFAULT '{}'` 列（迁移 `20260618_extend_scm_doc_fields.ts`）。
- 但表头 `field_values` **尚未接入**新增/修改/读取：`scmDoc.ts` 的 `DOC_HEADER_EXTRA_COLUMNS` 不含它；录入页也**无任何自定义字段 UI**。明细 `field_values` 已在写入链路（本期不动）。
- 录入页 `client/src/views/scm/DocForm.vue`：表头区按单据类型用 `hcol()` 配置化显示内置字段；**无独立「表尾」区域**（备注在表头表单内，合计在明细工具栏）。
- 已有可复用范本：**物料档案自定义字段** —— 表 `scm_item_field_defs`（迁移 `20260609_add_scm_item_custom_fields.ts`）+ 路由 `GET/POST /scm/item-fields`（`scmBase.ts`）+ `ItemForm.vue` 的「扩展信息」区按 `text/number/date/select` 渲染。本设计照搬该模式，增加「位置 header/footer」维度。

## 3. 数据模型

### 3.1 新建表 `scm_doc_field_defs`（字段定义，账套隔离，仿 `scm_item_field_defs`）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | uuid |
| `account_set_id` | TEXT NOT NULL | 账套隔离 |
| `doc_type` | TEXT NOT NULL | 适用单据类型码（如 `PI`/`SO`） |
| `position` | TEXT NOT NULL DEFAULT 'header' | `header`(表头) / `footer`(表尾) |
| `field_key` | TEXT NOT NULL | 字段键，存入 JSON 用，须 `[a-zA-Z0-9_]` |
| `field_name` | TEXT NOT NULL | 显示名（中文标签） |
| `field_type` | TEXT NOT NULL DEFAULT 'text' | `text`/`number`/`date`/`select`/`textarea` |
| `options_json` | TEXT | `select` 的选项 JSON |
| `sort_order` | INTEGER DEFAULT 0 | 同一位置内排序 |
| `is_enabled` | INTEGER DEFAULT 1 | 软删除（停用） |
| `created_at` | TEXT DEFAULT (datetime('now','localtime')) | |
| `updated_at` | TEXT DEFAULT (datetime('now','localtime')) | |

约束：`UNIQUE(account_set_id, doc_type, field_key)`。

### 3.2 值存储

复用**已存在**的 `scm_doc.field_values` JSON 列，结构 `{ field_key: value }`。表头、表尾字段**共用同一个 JSON**，`position` 仅决定渲染区域，因此 `field_key` 在同一 `(账套, 单据类型)` 内唯一即可，天然不撞键。`scm_doc_line.field_values` 本期不动。

### 3.3 已定细节

1. **严格按单据类型**：不设「通用/全部类型」伪类型；配置页提供「复制到其他单据类型」便捷功能（前端实现）。
2. **字段类型 5 种**：在物料档案 4 种基础上加 `textarea`（多行文本）。
3. **`field_key` 校验**：仅字母数字下划线、类型内唯一；与内置字段键重名给警告但不强制拦截。
4. **本期自定义字段一律选填**，不引入 `is_required`，必填校验列为 v2 预留。

### 3.4 迁移

- 新增 `server/src/db/migrations/20260623_add_scm_doc_field_defs.ts`：`CREATE TABLE IF NOT EXISTS scm_doc_field_defs(...)`。
- 登记进 `server/src/db/migrationList.ts`。
- `scm_doc.field_values` 列已存在，无需再加。
- 随服务启动自动执行迁移。

## 4. 后端接口

落点放在 `server/src/routes/scmBase.ts`，紧挨现有 `item-fields` 路由，风格一致。

### 4.1 字段定义 CRUD

- `GET /scm/doc-fields?doc_type=XX` → 返回该类型所有启用字段（含 header+footer），按 `position, sort_order` 排序；前端自行按 position 分组。
- `POST /scm/doc-fields` → body `{ doc_type, fields: [...] }`，**整类型覆盖式 upsert**（逻辑同 item-fields，但用 `doc_type` 限定作用域）：
  - 该 `doc_type` 下、不在新列表里的旧字段 → `is_enabled=0`（软停用，历史值不丢）；
  - 已存在 `field_key` → 更新；新 `field_key` → 插入。
- 「复制到其他单据类型」由前端实现（读源类型字段 → 逐个目标类型 POST），后端不另加端点。

### 4.2 `field_values` 接入单据头读写（`server/src/routes/scmDoc.ts`）

- **写**：`POST /scm/docs`、`PUT /scm/docs/:id` 表头落库加 `field_values` 列，存 `JSON.stringify(b.field_values || {})`。做法：把 `field_values` 并入 `DOC_HEADER_EXTRA_COLUMNS`，并在 `docHeaderExtraValues()` 对它单独 stringify（其余字段照旧）。
- **读**：`GET /scm/docs/:id` 把 `doc.field_values` 字符串 `JSON.parse` 成对象再返回（仿 item 的 `parseFieldValues`）。列表行的 `field_values` 由前端按需解析，列表查询不动。

### 4.3 权限守卫

- `GET /scm/doc-fields`：任意已登录可读（录入/打印/列表都要用）。
- `POST /scm/doc-fields`：配置类操作，加权限守卫（管理员 `*` 或系统设置权限）；具体复用哪个已有权限码在写计划时核对现有权限表后定，优先复用、不轻易新增。

## 5. 配置页（管理员配置）

遵循 CLAUDE.md「优先全页面、少弹窗」。

- **新文件** `client/src/views/scm/DocFieldDefs.vue`，路由 `/scm/doc-field-defs`，顶部导航条「返回 + 标题『单据自定义字段』」。
- **入口**：放供应链设置/基础配置区，参照「列方案管理」(`/scm/col-schemes`, `ColSchemeManager.vue`) 的菜单位置；确切挂点写计划时核对路由/菜单结构后定。无配置权限者隐藏入口。

**页面结构**

1. 顶部：**单据类型选择器**（`el-select`，取 `getDocTypes()`）。切换即加载该类型字段定义（`GET /scm/doc-fields`）。
2. 两个分区「表头字段」「表尾字段」，各为可编辑列表，列：排序（上移/下移）、字段名、字段键、类型（文本/数字/日期/下拉/多行）、选项（仅 `select` 显示，逗号/换行分隔内联输入）、删除；每区底部「+ 添加字段」。
3. 底部：「保存」（两区合并、各行带 `position`，POST 给当前 `doc_type`）；「复制到其他单据类型」（多选目标类型，前端逐个 POST）。

**前端校验**：`field_key` 必填、`[a-zA-Z0-9_]`、类型内不重复、与内置键重名黄色提示；`select` 至少一个选项；`field_name` 必填。

**防呆**：`field_key` 创建后锁定不可改（只能改显示名/类型/选项），避免历史值脱钩；要换键就停用旧的、新建。

## 6. 前端集成

### 6.1 录入页 `DocForm.vue`

- **加载定义**：`watch(form.doc_type)` 调 `GET /scm/doc-fields?doc_type=XX`，拆 `headerFieldDefs` / `footerFieldDefs`（仿 `loadLineColScheme`）。
- **表单状态**：`form` 初始加 `field_values: {}`；编辑/查看加载时把后端对象赋给 `form.field_values`；`handleSave` 提交载荷带 `field_values`（提交点写计划时核对 961+ 行 handleSave）。
- **表头字段渲染**：表头 `el-row` 末尾（备注后）循环 `headerFieldDefs`，每个 `el-col :span="6"` + `el-form-item :label="field_name"`，按 `field_type` 切换控件（text→el-input / number→el-input-number / date→el-date-picker / select→el-select / textarea→el-input type=textarea），`v-model="form.field_values[field_key]"`。复用 `ItemForm` 的「扩展信息」渲染 switch。随表单 `:disabled="isView"` 一并禁用。
- **新建表尾区**：明细 `el-table` 下方新增 `.doc-form-footer`，`v-if="footerFieldDefs.length"`，同样控件 switch 渲染表尾字段。本期表尾区**只放表尾自定义字段**（合计仍在工具栏，不动现有布局）；后续再考虑把合计/签名移入。

### 6.2 打印 `ScmDocPrint.vue`

- 加载时按 `doc.doc_type` 调 `GET /scm/doc-fields` 取定义。
- **表头字段**：追加进 `.meta` 块，每个有值 header 字段渲染 `<span><b>名称：</b>值</span>`。
- **表尾字段**：在 `.signs` 签字块上方新增小块，渲染有值 footer 字段「名称：值」。
- 值取自 `getDoc` 返回的 `doc.field_values`（已是对象），标签/顺序/位置取自定义。

### 6.3 列表 `DocList.vue`

- **仅当选中具体单据类型**（非「全部」）时，调 `GET /scm/doc-fields` 取该类型字段，**动态追加列**（键如 `cf:field_key`），单元格读 `parseFieldValues(row).field_values[field_key]`。
- 接入现有「列设置」可见性机制（合并静态 `allColumns` + 当前类型动态列），可勾选、可持久化。
- 「全部」视图不展示自定义列。
- 按自定义字段筛选 → v2，本期仅展示。

## 7. 边界 / 兼容

- 老单据 `field_values` 为空对象，不渲染任何自定义字段，零影响。
- 停用/删除字段：定义软停用，`field_values` 历史值保留（孤儿键仅不渲染），安全可逆。
- 改类型不迁移旧值，按新控件呈现，可接受。
- 单据仅草稿可改（现有规则）；审核后自定义字段随单据只读。
- 下推（PO→PI 等）只带明细行，表头 `field_values` 不跨类型携带（各类型字段本不同，符合预期）。

## 8. 测试

- **后端单测**（vitest，仿 `server/src/__tests__` 现有 scm 用例）：
  - `scm_doc_field_defs` 覆盖式 upsert（停用未列出 / 更新已存在 / 插入新增）、`doc_type` 作用域隔离、账套隔离；
  - 单据 `field_values` round-trip：POST 带 field_values → GET :id 解析为对象。
- **前端**：按 preview 验证流程实走「配置→新增填写→保存→查看→打印→列表」。

## 9. 落地顺序（分阶段增量验证）

1. 迁移 + 后端 CRUD + `field_values` 读写接入 + 后端单测
2. 配置页 + 路由 + 入口
3. `DocForm` 表头/表尾渲染 + 保存
4. 打印 + 列表
5. 联调 + 更新 `优化日志.md`（必要时 `debug/修复日志.md`）

**重启/迁移**：改后端按 CLAUDE.md 规则重启前后端；新迁移登记进 `migrationList.ts`，随服务启动自动执行。

## 10. 范围外（v2 预留）

- 自定义字段必填校验（`is_required`）。
- 列表按自定义字段筛选 / 排序。
- 明细行（表体）自定义字段 UI（`scm_doc_line.field_values` 已有列，未渲染）。
- 跨模块统一自定义字段基础设施（物料+单据+往来单位共用，方案 C）。
