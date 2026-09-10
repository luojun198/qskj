# 标准模版目录（会计准则库）

会计准则随时更新，本目录被设计成「可替换」的数据目录：**换菜单（catalog.json）+ 换 ACD 文件**即可，
不需要改代码、不需要重新打包前端。

## 目录结构

```
标准模版/
  catalog.json          # 菜单（下拉列表的分组、序号、名称、对应 ACD）
  准则库/                # 单文件模版：一个 .acd 一个准则
    02-企业会计准则（科目级数4-2-2）.acd
    ...
  新企业会计准则/         # 目录型模版：一个 .acd + 若干 Excel 报表模板
    xxx.acd
    资产负债表.xlsx
```

## catalog.json 格式

```jsonc
{
  "groups": ["企业会计准则", "非营利与合作组织", "行业专用模版", "行政事业与公共部门", "已停用旧准则"],
  "templates": [
    // 目录型：dir 指向本目录下的子目录（可附带 Excel 报表模板）
    { "id": "新企业会计准则", "code": "01", "name": "企业会计准则（科目级数4-3-3）",
      "group": "企业会计准则", "standard": "enterprise", "dir": "新企业会计准则" },
    // 单文件型：acd 指向相对本目录的 ACD 文件
    { "id": "rh02", "code": "02", "name": "企业会计准则（科目级数4-2-2）",
      "group": "企业会计准则", "standard": "enterprise", "acd": "准则库/02-企业会计准则（科目级数4-2-2）.acd" }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 模版唯一标识，建账时前端传回的值。**已建账套引用的 id 不要改**，改了旧账套无法追溯来源模版 |
| `code` | 否 | 序号（原软件行业代码），下拉列表左侧显示，用于与原软件一一对应；也可按 `code` 搜索 |
| `name` | 是 | 下拉列表显示的准则名称 |
| `group` | 否 | 所属分组；不在 `groups` 中的分组会追加到末尾，缺省为「其他模版」 |
| `standard` | 否 | 主页取数规则预设：`enterprise` / `small_business` / `government` / `auto`（缺省按名称推断） |
| `dir` / `acd` | 二选一 | 模版来源；`dir` 型可附带 Excel 报表模板，`acd` 型只导入 ACD |
| `retired` | 否 | `true` 表示已停用旧准则，整组沉到列表末尾并标注「停用」 |
| `description` | 否 | 备注；列表默认显示自动解析出的概况（科目数 / 报表数 / 级次） |

未登记到 `catalog.json` 的子目录，只要目录里有 `.acd` 就仍会被扫描进来（分组「其他模版」），
方便临时试用新准则。

## 更新流程

1. 把新的 `.acd` 放进 `准则库/`（或新建一个带 Excel 报表的子目录）；
2. 编辑 `catalog.json`，增改对应条目（保持 `code` 与原软件序号一致）；
3. 生效方式（任选其一）：
   - 系统管理 → 账套管理 → 新增账套 → 「刷新模版目录」按钮；
   - 调用接口 `POST /api/system/standard-account-set-templates/refresh`（需 `system:account` 权限）；
   - 什么都不做：目录/`catalog.json`/`准则库` 的修改时间变化后，下次读列表会自动重扫。

模版概况缓存按 ACD 文件的「修改时间 + 大小」作键，**替换同名 ACD 文件后概况会自动重算**。

## 相关接口

| 接口 | 权限 | 用途 |
| --- | --- | --- |
| `GET /api/auth/standard-account-set-templates` | 免登录 | 登录页「新增账套」下拉 |
| `GET /api/system/standard-account-set-templates` | 登录 | 系统管理「新增账套」下拉 |
| `POST /api/system/standard-account-set-templates/refresh` | `system:account` | 重扫目录并返回最新列表 |

返回体：`{ code: 0, data: 模版数组, groups: 分组顺序 }`，模版项含
`id / code / name / group / retired / order / inferredStandard / description / excelFiles / summary`。

## 部署包

后端按以下顺序查找本目录：部署目录 → 服务进程工作目录 → 工作目录的上一级。
现场升级准则库时，把新的 `标准模版/` 覆盖到部署目录即可。
