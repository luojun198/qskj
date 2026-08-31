# ACD文件数据导入分析报告

## 一、当前已导入的数据

### 1.1 基础数据
| 数据类型 | ACD表名 | 本系统对应 | 导入状态 | 说明 |
|---------|---------|-----------|---------|------|
| 系统参数 | xt.txt | system_params | ✅ 已导入 | 账套基本信息、会计制度等 |
| 凭证类型 | pzlx.txt | voucher_types | ✅ 已导入 | 记账凭证、收款凭证、付款凭证等 |
| 会计科目 | kmbm.txt | accounts | ✅ 已导入 | 科目编码、名称、级别、辅助核算标志 |
| 期初余额 | nc.txt | init_balances | ✅ 已导入 | 科目期初借贷方余额 |
| 自动转账 | jzlx.txt | transfer_types/items | ✅ 已导入 | 结转类型和结转分录 |
| 用户信息 | b_user.txt | users | ✅ 已导入 | 用户账号、密码、昵称 |
| 报表模板 | bbml.txt, bb*.vts | report_definitions | ✅ 已导入 | 报表定义、单元格、公式 |

### 1.2 业务数据
| 数据类型 | ACD表名 | 本系统对应 | 导入状态 | 说明 |
|---------|---------|-----------|---------|------|
| 凭证分录 | pz.txt | vouchers/voucher_entries | ✅ 已导入 | 凭证主表和分录明细 |
| 凭证登记 | pzdj.txt | vouchers (状态字段) | ✅ 已导入 | 制单人、审核人、记账人、状态 |

---

## 二、可以导入但尚未实现的重要数据

### 2.1 辅助核算基础数据（高优先级）

#### 2.1.1 项目核算 (xmk.txt)
**表结构：**
```sql
Create table xmk ("xmbm" char(10),"xm_mc" varchar(100),"bz" char(1))
```

**字段说明：**
- xmbm: 项目编码
- xm_mc: 项目名称
- bz: 备注/状态标志

**导入价值：** ⭐⭐⭐⭐⭐
- 项目核算是行政事业单位的核心功能
- 可直接导入项目档案，避免手工录入
- 与科目的项目辅助核算配合使用

**对应本系统表：** `aux_items` (type='project')

---

#### 2.1.2 部门核算 (bmk.txt / bmk_pos.txt)
**表结构：**
```sql
Create table bmk ("bmbm" char(10),"bm_mc" char(100),"bz" char(1))
Create table bmk_pos ("bmbh" char(4),"bmmc" char(20))
```

**字段说明：**
- bmbm/bmbh: 部门编码
- bm_mc/bmmc: 部门名称
- bz: 备注/状态标志

**导入价值：** ⭐⭐⭐⭐⭐
- 部门核算是预算管理的基础
- 支持部门预算执行分析
- 与科目的部门辅助核算配合使用

**对应本系统表：** `aux_items` (type='dept')

---

#### 2.1.3 往来单位 (dwk.txt / khda.txt)
**表结构：**
```sql
Create table dwk (
  "dwbm" char(10),        -- 单位编码
  "dw_mc" char(100),      -- 单位名称
  "txdz" char(20),        -- 通讯地址
  "yzbm" char(6),         -- 邮政编码
  "lxr" char(8),          -- 联系人
  "lxdh" char(14),        -- 联系电话
  "khyh" char(100),       -- 开户银行
  "yhzh" char(100),       -- 银行账号
  "nsh" char(50),         -- 纳税号
  "bz" char(1),           -- 备注
  rq date,                -- 日期
  "dw_jc" char(10)        -- 单位简称
)

Create table khda (
  "dwbh" char(6),         -- 单位编号
  "dwmc" char(50),        -- 单位名称
  "txdz" char(60),        -- 通讯地址
  "yzbm" char(6),         -- 邮政编码
  "lxdh" char(60),        -- 联系电话
  "lxr" char(24),         -- 联系人
  "khyh" char(40),        -- 开户银行
  "yhzh" char(40),        -- 银行账号
  "nsh" char(20),         -- 纳税号
  ...
)
```

**导入价值：** ⭐⭐⭐⭐⭐
- 往来单位是客户/供应商核算的基础
- 包含完整的单位信息（地址、电话、银行账号等）
- 避免重复录入大量往来单位

**对应本系统表：** `aux_items` (type='customer' / 'supplier')

---

#### 2.1.4 个人核算 (grk.txt)
**表结构：**
```sql
Create table grk ("grbm" char(10),"gr_mc" char(100),"bz" char(1))
```

**字段说明：**
- grbm: 个人编码
- gr_mc: 个人名称
- bz: 备注/状态标志

**导入价值：** ⭐⭐⭐⭐
- 个人往来核算（如借款、报销）
- 工资核算的基础数据

**对应本系统表：** `aux_items` (type='person')

---

### 2.2 辅助核算期初余额（高优先级）

#### 2.2.1 项目期初余额 (xmnc.txt)
**表结构：**
```sql
Create table xmnc (
  "kmbm" varchar(30),     -- 科目编码
  "xmbm" char(10),        -- 项目编码
  "bz" char(6),           -- 币种
  nc_jf double,           -- 期初借方
  nc_df double,           -- 期初贷方
  jq_jf double,           -- 借方累计
  jq_df double,           -- 贷方累计
  "fbs" char(1),          -- 辅币标识
  ys double,              -- 原币
  nc_jf_b double,         -- 期初借方(本币)
  nc_df_b double,         -- 期初贷方(本币)
  jq_jf_b double,         -- 借方累计(本币)
  jq_df_b double,         -- 贷方累计(本币)
  nf integer              -- 年份
)
```

**导入价值：** ⭐⭐⭐⭐⭐
- 项目辅助核算的期初数据
- 包含借贷方累计发生额
- 支持多币种

**对应本系统表：** `init_balances` (aux_item_id 关联项目)

---

#### 2.2.2 部门期初余额 (bmnc.txt)
**表结构：** 与 xmnc.txt 类似，xmbm 改为 bmbm

**导入价值：** ⭐⭐⭐⭐⭐
- 部门辅助核算的期初数据

**对应本系统表：** `init_balances` (aux_item_id 关联部门)

---

#### 2.2.3 往来单位期初余额 (dwnc.txt)
**表结构：** 与 xmnc.txt 类似，xmbm 改为 dwbm

**导入价值：** ⭐⭐⭐⭐⭐
- 往来单位辅助核算的期初数据
- 应收应付款的期初余额

**对应本系统表：** `init_balances` (aux_item_id 关联往来单位)

---

#### 2.2.4 个人期初余额 (grnc.txt)
**表结构：** 与 xmnc.txt 类似，xmbm 改为 grbm

**导入价值：** ⭐⭐⭐⭐
- 个人往来的期初数据

**对应本系统表：** `init_balances` (aux_item_id 关联个人)

---

### 2.3 凭证辅助信息（中优先级）

#### 2.3.1 凭证分录的辅助核算信息 (pz.txt)
**当前已导入字段：**
- nf, yf, pzlx, pzbh, pz_xh (凭证标识)
- kmbm (科目编码)
- pz_zy (摘要)
- pz_jf, pz_df (借贷方金额)

**尚未导入的重要字段：**
```sql
"xmbm" char(10),        -- 项目编码 ⭐⭐⭐⭐⭐
"dwbm" char(10),        -- 往来单位编码 ⭐⭐⭐⭐⭐
"bmbm" char(10),        -- 部门编码 ⭐⭐⭐⭐⭐
"grbm" char(10),        -- 个人编码 ⭐⭐⭐⭐
"bz" char(6),           -- 币种 ⭐⭐⭐
"xjbm" char(4),         -- 现金流量项目编码 ⭐⭐⭐⭐
pz_wb double,           -- 外币金额 ⭐⭐⭐
pz_hl double,           -- 汇率 ⭐⭐⭐
pz_sl double,           -- 数量 ⭐⭐
pz_dj double,           -- 单价 ⭐⭐
"dw" char(4),           -- 单位 ⭐⭐
"pz_ph" char(20),       -- 凭证批号 ⭐⭐
dqrq date,              -- 到期日期 ⭐⭐
```

**导入价值：** ⭐⭐⭐⭐⭐
- 辅助核算信息是凭证的核心数据
- 支持按项目、部门、往来单位查询
- 现金流量项目是现金流量表的基础

**对应本系统表：** `voucher_entries` 需要扩展字段

---

#### 2.3.2 现金流量项目 (xjll_xm.txt)
**表结构：**
```sql
Create table xjll_xm (
  "xjbm" char(4) not null,    -- 现金流量编码
  "xjmc" char(40),            -- 现金流量名称
  "jd" char(1),               -- 级次
  primary key (xjbm)
)
```

**导入价值：** ⭐⭐⭐⭐
- 现金流量表的基础数据
- 与凭证分录的 xjbm 字段配合使用

**对应本系统表：** `cash_flow_items`

---

### 2.4 凭证模板（中优先级）

#### 2.4.1 凭证模板 (pzmb.txt / pzmb_pz.txt)
**表结构：**
```sql
Create table pzmb ("mbbh" char(4),"mbmc" varchar(40))

Create table pzmb_pz (
  "mbbh" char(4),         -- 模板编号
  pzlx integer,           -- 凭证类型
  pzbh integer,           -- 凭证编号
  pz_xh integer,          -- 凭证序号
  "kmbm" varchar(30),     -- 科目编码
  "pz_zy" varchar(200),   -- 摘要
  "pz_jf" numeric(18,2),  -- 借方金额
  "pz_df" numeric(18,2),  -- 贷方金额
  ...
)
```

**导入价值：** ⭐⭐⭐⭐
- 常用凭证模板可以提高录入效率
- 包含完整的分录模板

**对应本系统表：** `voucher_templates`

---

### 2.5 币种和汇率（中优先级）

#### 2.5.1 币种档案 (bzk.txt)
**表结构：**
```sql
Create table bzk (
  "bz" char(4) not null,      -- 币种代码
  hl double,                  -- 汇率
  "bwbz" char(1),             -- 本位币标志
  "qtbz" char(1),             -- 其他标志
  primary key (bz)
)
```

**导入价值：** ⭐⭐⭐
- 多币种核算的基础
- 汇率信息

**对应本系统表：** 需要新建 `currencies` 表

---

### 2.6 计税类别（低优先级）

#### 2.6.1 计税类别 (jslb.txt)
**表结构：**
```sql
Create table jslb ("jslb" char(2),"jslb_mc" char(16))
```

**导入价值：** ⭐⭐
- 增值税核算相关
- 与凭证分录的 jslb 字段配合使用

---

## 三、不建议导入的数据

### 3.1 固定资产相关表
- zc_gdzc (固定资产卡片)
- zc_sblb (设备类别)
- zc_yzjb (折旧计提)
- 等等

**原因：** 固定资产管理是独立模块，数据结构复杂，建议单独处理

### 3.2 工资管理相关表
- gz_gzk (工资数据)
- gz_gzjg (工资结构)
- gz_bmk (工资部门)
- 等等

**原因：** 工资管理是独立模块，建议单独处理

### 3.3 库存管理相关表
- kcb (库存表)
- cpda (产品档案)
- ckda (仓库档案)
- 等等

**原因：** 库存管理超出财务核算范围

### 3.4 系统内部表
- pbcat* (PowerBuilder 系统表)
- dlxx (登录信息)
- b_errmsg (错误日志)
- 等等

**原因：** 系统内部数据，无需导入

---

## 四、导入优先级建议

### 第一优先级（立即实现）
1. ✅ 凭证分录的辅助核算字段 (xmbm, dwbm, bmbm, grbm, xjbm)
2. ✅ 项目档案 (xmk.txt)
3. ✅ 部门档案 (bmk.txt)
4. ✅ 往来单位档案 (dwk.txt / khda.txt)
5. ✅ 项目期初余额 (xmnc.txt)
6. ✅ 部门期初余额 (bmnc.txt)
7. ✅ 往来单位期初余额 (dwnc.txt)

### 第二优先级（近期实现）
1. 个人档案 (grk.txt)
2. 个人期初余额 (grnc.txt)
3. 现金流量项目 (xjll_xm.txt)
4. 凭证模板 (pzmb.txt / pzmb_pz.txt)

### 第三优先级（可选实现）
1. 币种档案 (bzk.txt)
2. 计税类别 (jslb.txt)
3. 凭证分录的数量单价字段 (pz_sl, pz_dj, dw)
4. 凭证分录的外币字段 (pz_wb, pz_hl, bz)

---

## 五、数据库表结构扩展建议

### 5.1 voucher_entries 表需要扩展的字段

```sql
ALTER TABLE voucher_entries ADD COLUMN project_id TEXT;           -- 项目ID
ALTER TABLE voucher_entries ADD COLUMN project_code TEXT;         -- 项目编码
ALTER TABLE voucher_entries ADD COLUMN project_name TEXT;         -- 项目名称
ALTER TABLE voucher_entries ADD COLUMN customer_id TEXT;          -- 客户/供应商ID
ALTER TABLE voucher_entries ADD COLUMN customer_code TEXT;        -- 客户/供应商编码
ALTER TABLE voucher_entries ADD COLUMN customer_name TEXT;        -- 客户/供应商名称
ALTER TABLE voucher_entries ADD COLUMN person_code TEXT;          -- 个人编码
ALTER TABLE voucher_entries ADD COLUMN person_name TEXT;          -- 个人名称
ALTER TABLE voucher_entries ADD COLUMN cash_flow_item_id TEXT;    -- 现金流量项目ID
ALTER TABLE voucher_entries ADD COLUMN cash_flow_code TEXT;       -- 现金流量编码
ALTER TABLE voucher_entries ADD COLUMN cash_flow_name TEXT;       -- 现金流量名称
ALTER TABLE voucher_entries ADD COLUMN currency_code TEXT;        -- 币种代码
ALTER TABLE voucher_entries ADD COLUMN foreign_amount REAL;       -- 外币金额
ALTER TABLE voucher_entries ADD COLUMN exchange_rate REAL;        -- 汇率
ALTER TABLE voucher_entries ADD COLUMN quantity REAL;             -- 数量
ALTER TABLE voucher_entries ADD COLUMN unit_price REAL;           -- 单价
ALTER TABLE voucher_entries ADD COLUMN unit TEXT;                 -- 单位
ALTER TABLE voucher_entries ADD COLUMN batch_no TEXT;             -- 批号
ALTER TABLE voucher_entries ADD COLUMN due_date TEXT;             -- 到期日期
```

### 5.2 需要新建的表

#### aux_categories (辅助核算类别)
```sql
CREATE TABLE aux_categories (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'project', 'dept', 'customer', 'supplier', 'person'
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(account_set_id, code, type)
);
```

#### aux_items (辅助核算项目)
```sql
CREATE TABLE aux_items (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL,
  category_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 往来单位专用字段
  address TEXT,
  postal_code TEXT,
  contact TEXT,
  phone TEXT,
  bank_name TEXT,
  bank_account TEXT,
  tax_no TEXT,
  -- 通用字段
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(account_set_id, category_type, code)
);
```

#### cash_flow_items (现金流量项目)
```sql
CREATE TABLE cash_flow_items (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'inflow', 'outflow', 'neutral'
  parent_code TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  is_leaf INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(account_set_id, code)
);
```

#### currencies (币种)
```sql
CREATE TABLE currencies (
  id TEXT PRIMARY KEY,
  account_set_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1.0,
  is_base_currency INTEGER DEFAULT 0,
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(account_set_id, code)
);
```

---

## 六、实施建议

### 6.1 分阶段实施

**第一阶段：辅助核算基础数据**
1. 创建 aux_categories 和 aux_items 表
2. 导入项目、部门、往来单位档案
3. 导入辅助核算期初余额
4. 测试辅助核算功能

**第二阶段：凭证辅助信息**
1. 扩展 voucher_entries 表字段
2. 修改凭证导入逻辑，读取辅助核算字段
3. 修改凭证录入界面，支持辅助核算选择
4. 测试凭证辅助核算功能

**第三阶段：现金流量**
1. 创建 cash_flow_items 表
2. 导入现金流量项目
3. 修改凭证导入逻辑，读取现金流量字段
4. 实现现金流量表

**第四阶段：其他功能**
1. 凭证模板
2. 多币种核算
3. 数量核算

### 6.2 数据验证

每个阶段完成后需要验证：
1. 数据完整性（导入数量是否正确）
2. 数据准确性（字段映射是否正确）
3. 关联关系（辅助核算项与科目、凭证的关联）
4. 业务逻辑（期初余额、发生额、余额的平衡）

---

## 七、总结

### 7.1 当前导入完成度
- ✅ 基础数据：100%（科目、期初、凭证类型、用户、报表）
- ✅ 凭证数据：60%（主表和基本分录已导入，辅助核算字段未导入）
- ❌ 辅助核算：0%（档案和期初余额均未导入）

### 7.2 核心缺失功能
1. **辅助核算档案**：项目、部门、往来单位、个人
2. **辅助核算期初**：各类辅助核算的期初余额
3. **凭证辅助信息**：凭证分录的辅助核算字段
4. **现金流量**：现金流量项目和凭证现金流量

### 7.3 预期收益
完成第一优先级的导入后：
- ✅ 支持完整的项目核算
- ✅ 支持完整的部门核算
- ✅ 支持完整的往来单位核算
- ✅ 辅助核算期初余额完整
- ✅ 凭证辅助核算信息完整
- ✅ 可以生成按项目、部门、往来单位的各类报表
- ✅ 数据迁移更完整，用户体验更好

---

**报告生成时间：** 2026-05-14
**分析依据：** ACD data_stru.txt 数据库结构定义
**当前导入脚本：** server/src/scripts/importAcdToCurrentAccountSet.ts
