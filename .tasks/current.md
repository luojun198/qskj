# 当前任务

> 这个文件用于跟踪项目的当前任务状态。Claude 会读取和更新这个文件。

## 进行中

- [ ] 进销存评审修复（按 `docs/2026-09-17-进销存模块完整评审与继续开发计划.md` §六 推进）
  - [x] 阶段 0：冒烟脚本 `scratch/scmSmokeTest.mjs`（临时库副本 + 3198 端口，HTTP 6 场景 31 断言）；§5.6 测试空白已补 6/10（P0-1/P0-2/P0-3/P0-4 走路由 + 反审核）
  - [x] 阶段 A：P0×4 全部修复（FIX-203 ~ FIX-206），服务端 176 文件 1679 用例全绿、冒烟 0 失败
  - [x] 阶段 B：P1×13 + B-14 全部修复（FIX-207 ~ FIX-219），服务端 1690 / 前端 575 用例全绿、冒烟 48 项 0 失败；P1-6 取「强制关联工单」、P1-10 取「补调整凭证」、P1-9 币种校验留待 P2-14
  - [ ] 产品决策会：§九 7 项（占位功能取舍、发票差额处理、手工 PJ/PS、多币种）
  - [ ] 阶段 C / D / E

## 已完成（最新）

- [x] 进销存评审修复 阶段 B（2026-09-17，FIX-207 ~ FIX-219）
  - 成本：折后成本入库（207）、SR 按均价（208）；生产：工单删除守卫（209）、重复成品（210）、完工默认值扣报废（211）、PJ/PS 强制关联 + 退料上限（212）；往来：账龄截止/未到期（213）、对账单符号（214）、核销方向（215）、发票差额调整凭证（216）；MRP：安全库存候选（217）、追加调整开关（218）；下推：保存/审核分级（219）；信用占用含税（P2-9）
  - 新增 `scmReviewRegression.test.ts`（12 例）等；冒烟场景⑧~⑬
- [x] 进销存评审修复 阶段 0 + 阶段 A（2026-09-17，FIX-203 ~ FIX-206）
  - FIX-203 发票反审核改走 `reverseInvoice`（`scmDoc.ts` unaudit 分支）；FIX-204 PR/SR 审核写 `direction='out'` 冲减台账（`scmArAp.ts applyReturnAdjustment`）、信用占用扣退货；FIX-205 序列号反审核按剩余流水还原（`scmSerial.ts`）；FIX-206 AS/DS 按 `scm_stock_move` 维护批次与序列号
  - 新增 `scmReturnInvoiceArap.test.ts`（7 例）、`scmSerial/scmBatch` 各增用例；修复前 9 例红、修复后全绿
  - 冒烟：`node scratch/scmSmokeTest.mjs` 31 项 0 失败（P1-1 折扣不进成本以 KNOWN 记录）

- [x] 进销存（SCM）模块完整评审 + 继续开发计划（2026-09-17）
  - 范围：单据全生命周期（`routes/scmDoc.ts` 4190 行）、主数据（`scmBase.ts`）、成本（`scmCosting`/`scmCostVariance`）、批次与序列号（`scmBatch`/`scmSerial`）、往来（`scmArAp` 658 行）、生产/委外/报工/质检、MRP 与下推、三大报表、前端 55 个页面
  - **上一轮 S1–S11 核验：S1–S7 已全部修复**（发票挂账 `scmDoc.ts:1697`、往来含税口径 `scmArAp.ts:104 sumGrossAmount`、整单折扣传导 `scmDoc.ts:395`、取号并发 `withDocNoRetry`、负库存成本兜底 `lastInboundUnitCost`、盘点序列号 `scmSerial.ts:79-118`、回算舍入）
  - 新 P0×4：① 发票反审核分支写反，`reverseInvoice` 成永不执行的死代码（`scmDoc.ts:1762-1770`）→ 下推发票反审核后来源单暂估额永久停在发票金额；② 退货 PR/SR 审核不写往来台账（`scmDoc.ts:1693-1702` 只覆盖 SO/PI/RP/RS），而读侧 `AR_DOC_TYPES`(`scmArAp.ts:275`)/`isAdjustment`(`:308-312`) 早已为 PR/SR 备好分支 → 往来余额与总账差整笔退货额（算例差 2260）；③ 调拨序列号反审核**物理删除** `scm_serial` 档案（`scmSerial.ts:144-158` + `:32-35` 无条件覆盖 `in_doc_no`）→ 原始入库追溯永久丢失、两台账不勾稽、单据再也无法审核；④ 组装/拆卸 `direction='none'` 使批次与序列号维护直接 early return（`scmBatch.ts:179-181`、`scmSerial.ts:121-123`）→ 被组装消耗的序列号仍为 in_stock，**可被再次销售出库**
  - 新 P1×13：入库成本只取行单价（折扣不进成本，`scmDoc.ts:1681`，算例库存 vs 存货科目差 100 = 折扣额）；手工 SR 退货以售价作入库成本（算例利润虚增 400）；工单删除守卫判 `status==='audited'` 但该值永不出现（`scmDoc.ts:3356`，实际为 draft/released/closed）→ 已审核工单可直删；重复成品行「审核写末行、反审核退首行」（`scmDoc.ts:1548/1635` vs `:1779/1790`，WIP 永不消耗）；完工对话框未扣报废数（`ProductionOrder.vue:242-243`）；PJ/PS 不强制关工单（`scmDocumentControls.ts:156`）；账龄不按 asOf 截断（`scmArAp.ts:597-601`）；对账单明细合计无符号（`PartnerStatement.vue:237-252`，算例合计 16300 vs 应 6300）；核销不校验业务方向（`scmArAp.ts:555`，收款可核销应付）；发票校正不产生调整凭证（`scmArAp.ts:135-137` vs `scmDoc.ts:3582-3592`，差 1300）；MRP 缺"仅安全库存补货"物料（`scmMrpDocument.ts:491-496`）；MRP 追加调整开关语义（`MrpForm.vue:144/193`）；草稿 PO 批量下推后死锁（`scmBatchDocuments.ts:37-41` vs `scmDocumentControls.ts:142`）
  - 新 P2×18：主数据删除无引用校验、库存金额 2/4 位舍入漂移、单号位宽未钳制、分页 NaN 500、凭证号取号无重试、`/scm/reset` 漏清 10+ 张表、负库存仓库参数**完全无效**、账龄未到期混桶与 NaN 丢行、信用额度含税口径混用、库存明细账筛选后期末失真、收发存汇总带仓库返回空、订单关联表含作废、固定报表打开即报错、多币种未折算、BOM 两端点缺账套隔离、`push-options` 无权限守卫、非末批关单在制无结转、领料锁定过宽、QC 完工校验只判存在性、PS 超额策略缺失
  - **完成度盘点（开发计划核心依据）**：15 项已完整；**7 项占位功能**（BOM 版本/生效期、BOM 替代料、BOM 副产品/联产品、工序委外、计价方式 5 选 1、质检检验项/标准/抽样、IQC/IPQC）——特征是"字段有 UI、后端有列、运算不读"，**靠"功能规划中"文案检索会全部漏检**；5 项有端点无前端入口（BOM 反查、采购建议带数据、生产执行表过滤、委外排序、工单 MRP 状态列）；4 项死代码/文档不一致；菜单/路由无缺失
  - **并发批次勘误**：报告定稿期间合入的三模块评审批次（FIX-183~201）已修其中 4 项——SCM 生成凭证期间闸（`scmDoc.ts:3773`）、SCM 收付款出纳闸（`scmArAp.ts:20/53/265`）、出纳流水币种归一（`scmArAp.ts:51` + 迁移 128）、`scmDoc.ts:1838` 残值率 5→0.05；报告已加「勘误与状态更新」并按其重核全部 P0/P1 行号
  - 产出 `docs/2026-09-17-进销存模块完整评审与继续开发计划.md`（含 S1-S11 核验表、P0/P1/P2 清单、完成度三维盘点、**阶段 0~E 开发路线图**、20 项待实测、7 项产品决策）
  - 基线：SCM 41 测试文件 / 383 用例；35 张 `scm_*` 表；开发库 SCM **业务数据为空**（`scm_doc`/`scm_item`/`scm_partner`/`scm_bom` 均 0 行）→ 全部为静态走查结论，阶段 0 需先建回归账套
  - 本轮为**只读评审**，未修改任何业务代码；未执行 HTTP 实操

- [x] 三模块综合评审（2026-09-17）P0/P1 修复（批次 A~E，5 个 commit，FIX-183 ~ FIX-201）
  - 报告 4 项 P0、21 项 P1 全部修复；顺带 P2-2/3/4/5/6/10/12/13/14/15 与 3 项待产品决策（按报告推荐方案：出纳有未生成凭证流水禁止结账、增减变动表增加含原值变动、已提满资产自动顺延月数）
  - P2-16（减值撤销）判断为现有三道限制已足够，未额外禁用；历轮总账 P2 残留（报告 §4.3）未在本轮处理
  - 迁移 126（残值率触发器）/ 127（`cashier_journal.bank_statement_id` / `voucher_id`）/ 128（CNY→RMB）已在 `finance-0523.db` 应用
  - 验证：服务端 175 文件 1667 用例、前端 89 文件 575 用例全绿，tsc / vue-tsc 0；报告 §六 16 项实测未在本轮执行（见待办）
  - [x] 批次 A 期间闸收口（FIX-183 ~ FIX-187）：`voucherMutationGuard.ts` 统一守卫接入 12 处入口；`assertGlPeriodOpen` 接入出纳生成凭证 / 日记账写入 / SCM 生成凭证；出纳闸 fail-closed + `normalizeBizDate`；结账年月整数 / 未来月校验 + 权限规则收紧。服务端 171 文件 1644 用例全绿、tsc 0
  - [x] 批次 B 固定资产数据完整性（FIX-188 ~ FIX-190）：残值率四入口归一 + 迁移 126 触发器兜底；盘点完成前一致性校验、部分盘亏按比例核销、损毁并入盘亏；原值减少下限。服务端 172 文件 1653 用例全绿、tsc / vue-tsc 0；迁移 126 已应用
  - [x] 批次 C 出纳完整性（FIX-191 ~ FIX-193）：出纳闸补齐 8 类入口 + SCM 收付款接闸；已勾对行保护；勾对每对独立批次 + `bank_statement_id`；迁移 127 加 `bank_statement_id` / `voucher_id` 并回填；删除统一走 `deleteVoucherWithRefs`；同步查重去 `biz_date`；金额校验前移。服务端 173 文件 1659 用例全绿、tsc / vue-tsc 0；迁移 127 已应用
  - [x] 批次 D 口径 / 权限 / 关联（FIX-194 ~ FIX-197）：本位币解析 + CNY 归一（迁移 128）；`middleware/cashierPermission.ts` 共享守卫、reset 权限 / 结账 / 凭证清理；科目授权铺开 12 个入口；重排号 / 插号 / 改号同步日记账凭证号。服务端 174 文件 1664 用例全绿、tsc / vue-tsc 0；迁移 128 已应用
  - [x] 批次 F 剩余 P2（FIX-202）：P2-1/7/8/9/11/17/18/19 全部处理；服务端 1668 / 前端 575 用例全绿
  - [x] 批次 E 业务规则（FIX-198 ~ FIX-201）：已提满资产增值自动顺延月数；增减变动表按 `fixed_asset_change` 倒推 + 分类 / 部门汇总默认不含已处置；变动 / 处置 / 盘点禁填未来月（前后端）；出纳有未生成凭证流水禁止结账。服务端 175 文件 1667 用例、前端 575 用例全绿

- [x] 总账 / 固定资产 / 出纳三模块综合评审（2026-09-17）
  - 范围：出纳（routes/cashierJournal.ts、services/cashierQuery.ts、cashierPeriodClosing.ts、出纳前端 11 页）、总账（凭证全链路 / 账簿 / 报表）、固定资产（卡片/变动/处置/领用/盘点/折旧/报表）；含三模块联动与期间闸口一致性
  - 新 P0×4：① 出纳结账闸在总账侧零引用（已结账月份凭证仍可反记账/修改/反审核/冲红，`cashierPeriodClosing` 全仓仅 `cashierJournal.ts:30` 一个引用）；② 出纳侧不认总账 `period_closing`（可向已结账 / 已年结期间生成凭证，`cashierQuery.ts` 全无 period_closing）；③ 残值率归一化漏 `applySplit`(`assetChange.ts:749`) / `adjustSurplusAssets`(`assetInventory.ts:387`)，叠加 `scmDoc.ts:1835` 写百分数 → 残值放大 100 倍、折旧静默停提；④ 盘点盘亏明细无 `scrap_date IS NULL` 过滤(`assetInventory.ts:432-438`) → 已处置卡片重复核销、1601 贷方超冲
  - 新 P1×21：SCM 收付款单审核/反审核直写删 `cashier_journal` 绕过出纳闸（`scmArAp.ts:43/239`）；SCM 写出纳流水 CNY 与出纳默认 RMB 脱节；`/cashier/reset` 权限错挂 `cashier:journal` + 清结账记录 + 留凭证；已对账日记账可删改致调节表永久不平；自动勾对共用 `match_batch` 撤销连带清整批；出纳结账闸漏挂 8 类入口；日期解析失败 fail-open；结账 year 未校验整数可永久锁死（`2026.5`）；可结未来月份；科目授权仅 2 接口生效；凭证重排号后出纳号脱钩；凭证删除/反审核/冲红/edit-audited 无期间闸或无来源守卫；SCM 生成凭证无期间闸；原值减少无下限致净值负数 + 处置必不平；已提满资产原值增加后永久不提；增减变动表取卡片当前原值致历史期初被追溯改写；变动/处置/盘点可填未来期间；部分数量盘亏按整卡核销
  - 新 P2×19：出纳金额精度 / NaN / 分页未钳制 / reset 物理附件 / 未走 `deleteVoucherWithRefs` / 凭证同步按 biz_date 查重 / 前端 UTC 默认日期 / 期初导入忽略币别列 / 删结算方式无引用校验 / 单条不校验借贷 / 选中行生成凭证取交集 / 权限码与菜单不一致 ×2；固资残值率允许 =1 / 盘点「损毁」无处理 / 减值可撤销 / 撤销处置绕过 deleteVoucherRecords / 无取得日期卡片明细账原值恒 0 / 撤销不返回 affectedGroups
  - 历轮 P2 残留逐条复核：`voucherQuery` FTS5 未转义与游标 JSON.parse、`ledger.ts` min/max_amount 的 0 被 falsy 忽略、`parseFloat` NaN、`Detail.vue` 小计行伪造日期、`AuxBalance` chunked 死代码、`hideZero` 恒真、`/ledger/balance` 休眠端点等**均原样存在**
  - 现场核对：只读查询 `data/finance-0523.db`——262 张卡片 `salvage_rate` 全部 ≤1、`cashier_journal` 仅 RMB/USD（P0-3、P1-2 为"路径确定、尚未显形"的潜伏缺陷）
  - 产出 `docs/2026-09-17-总账固定资产出纳模块综合评审报告.md`（含 P0/P1/P2 清单、file:line 证据、手工算账过程、收口式解决方案、修复批次建议、16 项待实测清单、3 项待产品决策）
  - 本轮为**只读评审**，未修改任何业务代码；未执行 HTTP 实操

- [x] 出纳模块结账 / 反结账（2026-09-16）
  - 迁移 124 `cashier_period_closing`；服务 `cashierPeriodClosing.ts`（顺序结账 / 倒序反结 / 闸口）；日记账增删改导入 + 生成删凭证接闸
  - 新页面 `/cashier/period-close`（权限 `cashier:param`）；工作台「结账」+「反结账」节点、菜单「出纳设置 → 出纳结账」
  - 后端 1623 / 前端 572 用例全绿

- [x] 全站页面字号对齐左侧导航（2026-09-16）
  - `styles.css` 覆盖 Element 写死字号组件（步骤条 / 上传 / 结果页 / 空状态 / 消息框 / 抽屉等）
  - 19 个页面的 16~24px 大标题统一为 `--cw-text-lg` / `--cw-text-xl`；KPI 数值与打印页有意保留

- [x] 资产档案折旧科目预设纠正 + AccountSelect 完整路径显示（2026-09-16）
  - 预设：管理用 → 管理费用/折旧、经营用 → 销售费用/折旧、生产用 → 制造费用/折旧（按父科目解析末级）
  - `AccountSelect` 与资产档案表格科目统一显示「编码 上级/…/末级」

- [x] 固定资产凭证在凭证录入/查询页只读（2026-09-16）
  - `voucherSourceGuard.ts` 前端识别 `asset_*` 来源；录入页编辑改只读查看、删除拦截；查询页删除拦截
  - 后端 `PUT /vouchers/:id` 增 `asset_*` 守卫（删除守卫已有）
  - 待实测：需在浏览器窗格用 localhost:5275 登录后走一遍（192 IP 地址逐次弹授权）

- [x] 固定资产工作台补齐「计提折旧 / 取消折旧」流程（2026-09-16）
  - 新增独立全页面 `DepreciationReverse.vue`（`/asset/depreciation/reverse`）：按期间反折旧，只放行最新期、已记账/更晚期禁用并提示；共用 `deprHistory.ts` 分组工具
  - 工作台流程图四节点重新指向（计提折旧自动预览 / 取消折旧 / 凭证生成→历史记录 / 折旧查询→折旧汇总表）；`AssetWorkspace.findMenuItem` 子页面按前缀归属权限
  - 后端 `/asset/depr/history` 增 `voucher_status`；顺带修 FIX-180 资产报表变动记录 404
  - 验证：浏览器全链路计提→反折旧通过；前端 569 用例、类型检查 0

- [x] 固定资产模块评审修复 批次 A+B（2026-09-15，FIX-160 ~ FIX-179）
  - P0×4：残值率双量纲统一（迁移 123 存量自动修正）+ normalizeSalvageRate 四入口；工作量法过滤/计提/反计提闭环（workload_done 闭环）；删卡片清理全部关联凭证与孤儿数据；reset 清凭证 + 删已完成盘点拦截 + 盘点凭证回写
  - P1×10：处置补减值分录（AS-P1-1）；反折旧×已处置拦截（P1-4）；顺序闸兜底 + 禁止未来计提（P1-3）；平均年限末期尾差补提（P1-6）；增减变动表期初双计（P1-8）；明细账净值口径（P1-9）；折旧汇总历史净值（P1-10）；卡片 PUT 守卫（P1-11）；asset:impair 权限接线 + 处置/折旧/盘点 scope（P1-12）；撤销变动 rowid + dept 整组还原（P1-13）；拆分 rebased（P1-14）；起折日期脏数据（P1-15）；切期清空过期预览（P1-16）；处置/撤销期间校验（P1-17）；前端 8 页 v-permission
  - 验证：后端 1618 / 前端 559 用例全绿、build 0 错、迁移 123 已执行（存量 254 卡片 0 行 >1）、已重启 3105/5275

- [x] 固定资产模块评审：Bug 报告 + 优化建议（2026-09-15）
  - 范围：卡片/变动/处置/领用/盘点/折旧/导入/报表 + 路由层 + 前端 10 页（不含出纳）；只读评审
  - 新 P0×4（均人工复核）：残值率双量纲混存（卡片页百分数 vs 导入小数，变动后折旧静默停止）、工作量法漏提（use_months 过滤）、删卡片/reset/删盘点凭证断链死锁、删已完成盘点无校验+盘点凭证零回写
  - 新 P1×17：带减值处置凭证必不平（功能阻断）、workload_done 从不累加、跳期闸未配置即失效、反折旧×处置脱钩、增减变动表期初双计、明细账净值口径错、卡片 PUT 绕过变动、asset:impair 权限摆设等
  - 定向测试 56 用例全绿（现有测试均未覆盖上述问题）；与总账联动核对无新问题（FIX-131 闸不误拦）
  - 产出 `docs/2026-09-15-固定资产模块评审Bug与优化报告.md`（含优化建议、优先级、待实测清单）

- [x] 总账模块评审第二轮：P0/P1 全部修复（FIX-129 ~ FIX-159，2026-09-15）
  - 批次 A（P0）：年结后总账期初双计 / 空分录清空凭证 / amount_cents 绕过平衡 + 过账平衡闸 / 批量删除共用来源守卫（`voucherDelete.ts`）/ 导出漏负余额
  - 批次 B（凭证 P1）：筛选批量记账·反记账·反审核补 scope 与已结账期间、requireAudit 读参数；凭证详情按账套过滤；重新排号预检；撤销结转改 `applyVoucherUnpost`；删遗留结转 API；年结结转外币与数量期初
  - 批次 C（报表 P1）：静态配置编码去重 + 断言；间接法透传 scope；`voucher_types.is_closing` 标志化排除结转（迁移 121）；公式错误沿链传播 + 页面提示；准则尊重显式配置 + 缓存；老库 `opening_*` 回填（迁移 122）
  - 批次 D（账簿 P1）：aux-multi include_unposted；明细账单边界区间；多栏/VAT/辅助多栏期初口径统一（`buildLedgerOpeningExpr`）；辅助余额表 summary 年初下限；明细账辅助过滤 JSON 匹配；期初链式上溯（`resolveOpeningBaseYear`）；补出父行保留
  - 批次 E（前端 P1）：检查表三列插槽；银行日记账快捷按钮；`useRacedQuery` 接入 13 页面；`fetchAllPages` 分页拉全量；数量金额表合计分侧
  - 批次 F（部分）：删 `voucher.ts.fixcand` / `ledger.styles.css`；`ledgerQueryPlaceholderAlignment.test.ts` 130 组占位符对齐断言
  - 验证：服务端 168 文件 1615 用例、前端 86 文件 559 用例全绿；tsc / vue-tsc 0；迁移 121/122 已在 `finance-0523.db` 应用；浏览器实测日记账 / 序时账 / 总分类账 / 凭证类型页
  - 每批一次提交（共 6 个 commit）

## 待办

- [ ] 进销存（SCM）评审修复与继续开发（报告：`docs/2026-09-17-进销存模块完整评审与继续开发计划.md`）
  - **阶段 0（0.5 周，必须先做）**：建"进销存回归账套"（10 类场景：含税+整单折扣采购、有成本销售、采购/销售退货、下推发票金额不一致、序列号入库+调拨+组装、批次 FIFO、多成品分批完工含报废、委外、部分收付款核销、独立安全库存物料）+ 固化冒烟脚本（仿 `scratch/fixedAssetGlTest.mjs`）。**当前开发库 SCM 业务数据为空，不先建数据后面无法验证**
  - **阶段 A（1 周）P0×4**：A-1 发票反审核走 `reverseInvoice` + 补**走路由**的回归用例（现有测试直调 service，绿灯掩盖了不可达）；A-2 补 PR/SR 退货挂账 + 账龄/余额/信用归类；A-3 序列号回退改"按 `scm_serial_move` 现场还原"，不再物理删除档案（`scm_serial` 增 `created_doc_no`）；A-4 AS/DS 补批次与序列号维护分支
  - **阶段 B（1.5–2 周）P1×13**：入库成本取折后单价（+ 库存金额/流水/存货科目三方断言）；SR 退货成本取来源或当前均价；工单删除守卫改 `status !== 'draft'`；成品行回写回退统一按行 id + 工单保存拒绝重复 `item_code`；完工对话框用 `action_state.finish` 口径；PJ/PS 纳入 `PLAN_DOC_TYPES`；账龄加 `doc_date <= asOf` + 分桶补"未到期" + 写入侧 `normalizeBizDate`；对账单明细带符号；核销校验业务方向与币种；发票差额补调整凭证；MRP 并入安全库存候选；MRP 调整开关语义；草稿 PO 批量下推死锁；信用额度改含税
  - **阶段 C（关键决策 + 3–4 周）**：**先开产品决策会**，对 7 项占位功能逐项拍板"实现 / 撤下 UI"——BOM 版本生效期、BOM 替代料、BOM 副产品联产品、工序委外、计价方式（建议先收敛为单项，FIFO 排后）、质检检验项/标准/抽样、IQC/IPQC。目标是 UI 上**不存在"可填但不生效"的字段**。此决策决定总工作量是 4 周还是 12 周
  - **阶段 D（1–2 周）P2×18 + 前端接线**：BOM 反查入口、采购建议带数据、生产执行表过滤、工单 MRP 状态列；主数据删除引用校验；分页/位宽/取号钳制；`/scm/reset` 表清单补齐；负库存仓库参数接线或删除；报表默认期间修复；**多币种口径（SCM 全链路未折算本位币、`resolveExchangeRate` 无调用者，仍未处理）**；BOM 两端点账套隔离 + `push-options` 权限；领料锁定范围、PS 超额策略、QC 完工校验、非末批关单在制结转；死代码清理（`scmMrp.ts` + 410 端点 + JSDoc + `voided` 死状态）
  - **阶段 E（贯穿）**：每项修复补**走路由**的回归用例；补 10 项测试空白（安全库存专有物料、重复成品行、非末批关单、同成品多行余数、无工单 PJ/PS、下推发票走路由反审核、退货挂账、折扣进成本、AS/DS 批号序列号、TR 序列号反审核）；冒烟脚本纳入交付门禁
  - **待实测 20 项**：报告 §八（清单已逐条给出预期与实际对照）
  - **需产品决策 7 项**：报告 §九（占位功能去留、发票差额处理、委外超收、手工 PJ/PS、MRP 占用口径、质检定位、多币种）

- [ ] 三模块综合评审（2026-09-17）收尾
  - **待实测 16 项**：报告 §六（出纳结账×总账反记账、总账结账×出纳生成凭证、百分数卡片拆分、已处置卡片盘点、CNY 收款单出纳可见性、`2026.5` 年份、科目白名单、原值减少下限、已提满增值、增减变动表回查、部分盘亏等）——代码已改并有单测覆盖，建议在库副本 + 浏览器窗格 5275 走一遍
  - **报告 §四 P2**：已全部处理（批次 F，FIX-202）；P2-16 减值撤销判定为现有限制已足够
  - **历轮总账 P2 残留**：报告 §4.3（见下一条待办）

- [ ] 总账评审第二轮 P2 与优化（报告 §二 P2、§三 优化建议）
  - 未做的「优先做」项：`AuxBalance.vue` chunked 三函数（与进度条模板耦合）、`ForeignBalance/QuantityBalance` 恒真 `hideZero`、`/ledger/balance` 休眠端点删除、FTS5 关键字转义、游标 JSON try/catch、min/max_amount 为 0、parseFloat NaN、小计行伪造日期
  - 排期项：精度统一（`round2` 负数对称 / `MONEY_EPSILON` / `*_cents` 列）、报表计算会话缓存、`buildLedgerGeneralQuery` CTE pivot、`insertMonthlySubtotals` 收敛、Detail 虚拟滚动
  - 需产品决策：P1-报表-7 报表「含未过账」口径
  - 数据侧待办：已年结的外币 / 数量账套需「反年结 → 重新年结」补下年外币 / 数量期初（FIX-140）

- [x] 总账模块评审第二轮：Bug 报告 + 优化建议（2026-09-15）
  - 范围：账簿查询、凭证链路、前端账簿页面、报表链路（不含出纳/固定资产）；只读评审
  - 复核上轮修复：GL-01/02/05 正确；GL-04 漏 aux-multi-column 一处；GL-06 半修复升级 P1；/ledger/balance 已成休眠代码（无前端调用）
  - 新 P0×5（均人工复核）：年结后总账期初双计、PUT 凭证可传空分录清空、amount_cents 信任客户端绕过平衡校验、批量删除绕过 source 守卫、总分类账导出漏负余额
  - 新 P1×20+：凭证批量接口缺校验/越权、报表配置跨组重复编码、公式引擎 SUM 静默跳错误格、间接法缺 accountScope、多栏账 preBook 未接入等
  - 产出 `docs/2026-09-15-总账模块评审Bug与优化报告.md`（含优化建议、修复优先级、待实测清单）

- [x] 阶段三 ACD 导入完整性（zjnc/bzk/dwk，2026-09-11）
  - `zjnc` 资金来源期初 → `init_balances`（`fund_source:<id>`），新增 `FUND_SOURCE_NC_COLUMNS` 与每来源列配置
  - `bzk` 币种档案 → `currencies`（新增导出函数 `importCurrencyArchive`，仅补齐不覆盖）
  - `dwk` 往来明细 → `aux_items.field_values`/`remark`（地址/联系人/电话/开户行/账号/税号/简称）
  - 经证据确认无法导入：数量期初（ACD 无数量列）、`sybz`（模板全 '0' 无语义）、`pz_fj`、`nc_cross`
  - 新增 `acdImportCompleteness.test.ts`（6 用例）+ `docs/2026-09-11-ACD导入完整性阶段三报告.md`
  - 验证：服务端 158 文件 1446 用例全绿、tsc 0；ACD 冒烟通过；已重启 3105/5275

- [x] B3 测试补强 + B4 文档回填（2026-09-11）
  - 新增 `cashierQuery.test.ts`（14 用例）：生成凭证方向/缺对方科目拦截/挂账末级/勾对联动/凭证同步幂等/回写对方科目
  - 新增 `ledgerPreBookCrossYear.test.ts`（4 用例）：GL-02 账前发生额跨年归属回归
  - 新增 `scm-system.spec.ts`（3 冒烟）；`playwright.config.ts` 的 `webServer` 增加后端 3105 启动
  - 修正 `AGENTS.md` 端口（5275/3105）与 DB 路径（finance-0523.db）；补建 `.Codex-summary.md`
  - 验证：后端 157 文件 1440 用例全绿；`playwright --list` 50 tests/10 files

- [x] 阶段一 可用性修复 + 阶段二 构建/类型清零（build gate 转绿，2026-09-11）
  - 阶段一：恢复固定资产折旧「预览/计提/工作量」、盘点「新建盘点」；出纳期初导入导出、单据查询打印、余额调节表工具栏与筛选；供应链税科目兜底已由 `scmAccountResolver` 实现
  - 阶段二 B1：服务端 `tsc` 125→0（Database 命名类型、迁移类型、结构 db 参数、索引签名等根因修复）
  - 阶段二 B2：前端 `vue-tsc -b` + `vite build` 198→0（`useFillHeightTable.tableRef`、`@cw/shared-types` 路径、各类型补全）
  - 前端临时关闭 `noUnusedLocals/noUnusedParameters`（约 64 个死符号待专项清理；服务端仍严格）
  - 验证：服务端 tsc 0 + 1422 用例全绿；前端 build 成功 + 546 用例全绿；已重启 3105/5275
  - 待办：B3 测试补强 + E2E 起后端；B4 文档回填（AGENTS 端口、`.Codex-summary.md`）

- [x] 总账 + ACD 兼容性 Bug 修复（P0/P1 主体，2026-09-11）
  - GL-01：`/ledger/balance` 接入 `preBookEnabled`/`accountSetStartDate`，消除 TS2339
  - GL-02：跨年账前发生额占位符改用 `preBookYear`（general/quantity/foreign）
  - GL-04：`includeUnpostedFlag` 统一 `include_unposted` 语义
  - GL-05/06：分页上限钳制；明细账单边界科目区间
  - ACD-01：科目缺失凭证整张跳过并告警，不再整账套回滚
  - ACD-03/04/05/06：数量核算映射、辅助期初复合键、CLI 编码配置、先币种后科目
  - UI-01/04/05/07：余额表负数合计、跨年累计、AuxDetail 全量、恢复不可达控件
  - 复核：UI-02（日记账分页余额）为误报（carryAmountSql 已处理）
  - 暂缓：ACD-02/GL-03/GL-07/GL-09/11/12/13/UI-03（报告“修复状态”已说明）
  - 测试：后端 1422、前端 546 全绿；ACD 导入冒烟通过；已重启 3105/5275

- [x] 总账模块 + ACD 兼容性评审（Bug 与优化报告，2026-09-11）
  - 只读走查 `ledgerQuery.ts` / `routes/ledger.ts` / 总账前端 / ACD 导入，附 `file:line` 并经 tsc 交叉验证
  - P0：`/ledger/balance` FIX-105（`preBookEnabled`）未接入致 `TS2339` 编译错误且口径旧；ACD 未匹配科目 `account_id=null` 触发 `NOT NULL` → 整账套导入回滚
  - P1：跨年账前发生额漏算、年结丢外币/数量期初、`include_unposted` 不统一、ACD 数量/停用/辅助期初映射缺失、前端余额表负数漏计、日记账分页运行余额错误、分页小计/跨年累计错误、AuxDetail 全量上限 1000
  - 产出 `docs/2026-09-11-总账与ACD兼容性Bug与优化报告.md`（含 P0/P1/P2 清单、ACD 对照表、优化建议、待实测清单）

- [x] 固定资产与总账联动测试 + 报告（2026-09-11）
  - 新增 `scratch/fixedAssetGlTest.mjs`：隔离库副本 + 3199 端口独立后端，全链路「建卡片→计提折旧→生成凭证→总账取数→反折旧→再计提→记账过账→购置凭证」
  - 覆盖平均年限/双倍余额递减/年数总和三种算法；折旧合计 6,134.86（借 5101 / 贷 1602）
  - 23/23 断言通过；产出 `docs/2026-09-11-固定资产总账联动测试报告.md`
  - 建议：资产类别「原值科目」应配置到末级（未配置时购置凭证回退父科目 1601）

- [x] 出纳管理模块评审 + 按优先级修复（2026-09-11）
  - P0：`Journal.vue` 恢复筛选/操作工具栏（生成凭证/导入/导出/借贷互换/删除凭证/对账）；`DocumentQuery.vue` 补 onMounted 查询并加筛选条
  - P0：结算方式权限码统一（`cashier:dict` 兼容 `cashier:param`/`cashier:journal`、允许 `scm:*` 读字典；预设财务会计角色补 `cashier:dict`）
  - P0：`/cashier/delete-vouchers` 按 `account_code` 收窄删除范围
  - P1：ACD `gzm/dzbz` 0/1 严格判断、`rq` 用 nf/yf/dd 兜底、导入幂等去重
  - P1：出纳补币种维度（新增 `/cashier/currencies`，各查询/报表支持 currency）
  - P1：ACD 导出 `p_pzlx/p_pzbh` 回写数值、凭证号匹配改 CAST
  - P1：账套清理/重置补齐出纳与固资全部表
  - P2：列校验告警、新增删对账单接口、E2E 清理、迁移健壮性、文档更正
  - 后端 155 文件 1422 用例、前端 82 文件 546 用例全绿；已重启服务（3105/5275）

- [x] 期末调汇链路打通（2026-09-10）
  - 工作台**左侧面板**的「期末调汇」「外币类型」不再弹「功能规划中」，与底部链接同款：可点、提示「账套未启用外币核算」、点击引导去账套参数（FIX-123）
  - 左右两列逐字重复的 5 分支模板收敛为 `sidebarSections` 计算视图模型；`item.action` 分支必须排在 status 之前（单测锁死）
  - 期末调汇新增「本期还有 N 张凭证未记账」拦截：调汇基数只算已过账凭证，没记完账就生成会用不完整余额算差额（FIX-124）；明细仍照算，用户看得到差在哪；调汇凭证自身不计入
  - 调汇明细的汇率列标注来源（期间汇率 / 外币类型期末汇率 / 最近一期 / 默认），并在期间汇率盖过外币类型页时给出信息条（FIX-125）
  - 后端 1422 / 前端 546 用例全绿；真实账套副本 HTTP 37 项断言全过：拦截 → 过账放行 → 改期末汇率 → 生成汇兑损益凭证（USD 54 + HKD 4，借贷平衡 58）→ 反调汇复原 → 可重做
  - 界面实测：两条提示条、生成按钮禁用、汇率来源标签、侧栏确认框跳转均正常
  - 无数据库迁移；后端改动需重启服务

- [x] 外币余额表 + 辅助项目外币余额表（2026-09-10）
  - 两张外币表统一到凭证明细口径：`buildForeignBalanceQuery` 重写为从 `voucher_entries` 聚合，不再读过账后的 `account_balances.foreign_*`
  - `/ledger/foreign-balance` 支持日期区间 / 科目编码 / 币种 / 有期初·有发生额·有余额 / 统计未记账凭证；响应带按币种分桶的 `summary` 与期末汇率 `rates`
  - `ForeignBalance.vue` 整页重写（125 → 约 560 行）：两级表头原币与本位币成对、本年累计、汇率列、合计行、各币种小计、导出 Excel、hiprint 打印、双击下钻明细账、列宽记忆、骨架屏
  - 辅助项目外币余额表补汇率列与按币种小计；`foreign_totals` 分桶扩成原币+本位币成对；导出/打印通用能力新增 `subtotalRows` / `footerSubtotals`
  - 期末调汇跟随新口径（期间首末日 + 仅已记账），数值不变
  - 工作台「账套未启用外币核算」不再提示成「功能规划中」，改为可点并引导去账套参数（FIX-121）；科目余额表移除「显示原币」空开关（FIX-122）
  - 新增 `foreignBalanceQuery.test.ts` 8 项；后端 1420 / 前端 545 用例全绿；真实账套副本 HTTP 37 项断言全过（含「辅助表与外币余额表同科目完全对得上」四条）
  - 无数据库迁移；后端改动需重启服务

- [x] 辅助项目多栏明细账（2026-09-09）
  - 新增 `/ledger/aux-multi-column`，两种分栏方式对应参考图上下两半：对方科目分栏 / 辅助项目分栏
  - 栏目 key 统一 `d_*`/`c_*`，借贷两组各列一遍，金额按分录自身方向落格；多对方科目按金额比例分摊、尾差补最后一栏
  - 期初 = 期初余额表 + 区间前发生额；本月合计 / 本年累计 / 方向标记与普通多栏账同口径
  - 辅助匹配复用 `utils/auxLedgerQuery.ts`，`aux_data` JSON 与 `dept_id` 固定列两种存储都命中
  - 栏目设置存 `system_params`，键含模式/类别/主科目/所选项目；设置与查询共用同一条栏目发现路径
  - 修 FIX-118：上一轮半成品把「辅助项目 ID」当「科目 ID」比对，查询恒为空；栏目还落错格、金额未按方向取符号
  - 后端 1412 / 前端 534 用例全绿（新增后端 26 项）；真实账套 HTTP 全链路 36 项断言全过；无数据库迁移

- [x] 总账数量核算 + 库存数量金额表（2026-09-09）
  - 科目可勾「数量」并填计量单位；凭证录入数量必填、单价与金额二选一自动互算（数量气泡仿外币气泡）
  - 期初余额表新增「数量借/数量贷」可编辑列；明细账数量科目自动出「单价/数量借方/数量贷方」
  - 新增 `/ledger/quantity-balance` 库存数量金额表与 `/ledger/aux-quantity-balance` 辅助项目版，补掉工作台两个占位
  - 数量走 voucher_entries 实时聚合，不进 account_balances，过账逻辑零改动
  - migration 120 `add_quantity_accounting`（纯加列幂等）；后端 1386 / 前端 528 用例全绿
  - 真实账套副本 31 项断言全过，复刻参考图：1403 原材料/个/本期借方 10 个 111.00/结余单价 11.1000
  - 顺带修 FIX-117：冲红手写 INSERT 漏传外币三列，此前冲红必然报「参数个数不符」

- [x] 供应链对方科目自动匹配（FIX-100，2026-09-05）
  - 带税单据不再卡在「科目不存在 22210101」：按「默认编码 → 科目名称」自动匹配本账套科目，纯读取无迁移
  - 编码撞车（行政事业 6401=经营预算收入）改为橙色警告，不再静默记错科目
  - 参数页显示自动匹配结果与候选科目；补上一直漏配的「应付职工薪酬」「制造费用」两项
  - 新增 `scmAccountResolver.test.ts` 19 用例；后端 133 文件 1189 用例、前端 437 全绿
  - 反证：委外实测脚本删掉手工配参数那步后仍 28 项断言全过

- [x] 委外链路端到端验收（2026-09-05）
  - 新增 `scmOutsourceFlow.test.ts` 15 用例；真实账套 HTTP 全链路 29 项断言全过，测试数据与临时参数已清理
  - 验证 2026-09-04 生产收尾改动的三处共用代码（getPlanCostSummary / PF·WI 审核分支 / 工单动作判定）未把委外带坏
  - 后端 132 文件 1170 用例全绿
  - 实测发现待处理：供应链默认税科目 22210101/22210105 在任何账套上都不存在（ACD 账套用 2221001001/2221001005），
    导致带税的采购入库/销售出库/委外入库生成凭证必然 400，详见 `优化日志.md` 2026-09-05

- [x] 生产制造模块独立走通（三阶段全部完成，2026-09-04）
  - [x] 阶段一：模块可独立授权运行（FIX-096）——共享基础层放开给生产/委外、IS 期初入库共享、权限树同步；后端 1093 / 前端 437 用例全绿
  - [x] 阶段二：主链端到端验收（FIX-097 退料按领用单价回冲、FIX-098 组装成品行凭证方向、出库库存按合计校验）
    - 新增 `scmProductionFlow.test.ts` 21 用例；真实账套（东汇）HTTP 全链路 27 项断言全过，测试主数据已清理
    - 后端 128 文件 1114 用例、前端 437 用例全绿
  - [x] 阶段三：PS 不良品并入工单成本（FIX-099）/ QC 与完工联动（参数化拦截 + 不良下推）/ 报工数量校验 / 生产执行及在制结存表 / 工艺路线·报工·质检改全页面
    - 新增 `scmQcControl.ts`、`scmWorkReport.ts`、`scmProductionExecutionReport.ts` 三个服务与 4 个前端页面
    - 后端 131 文件 1155 用例、前端 437 用例全绿；真实账套质检联动 9 项断言全过

- [x] 全站列表字号铺开到录入/审核/账簿/供应链等，不再只作用凭证查询（2026-09-04）

- [x] 全站列表字号与左侧导航对齐：正文/表头 13px、表头字重 600（2026-09-04）

- [x] 凭证新增/查看弹窗分录网格去掉圆弧内框（2026-09-04）

- [x] 去掉标准报表打印对话框「用 Excel 打印」按钮（2026-09-04）

- [x] 标准报表进入时默认「取数」并自动按当前期间计算（2026-09-04）

- [x] 标准报表打印预览改走原始 HTML 连续网格，不再经 hiprint 拆表（2026-09-04）

- [x] 标准报表「用 Excel 打印」：与导出同一份工作簿，并写入页面设置（2026-09-04）

- [x] 标准报表打印/导出 PDF 边框检测：td 不再 overflow:hidden，铺开遇带框空格即停，漏框格补全（2026-09-04）

- [x] 左侧应用栏改名：财务会计→财务总账、资金管理→出纳管理、资产管理→固定资产（2026-09-04）
  - 应用 key / 权限不变；旧 `/group/` 地址走别名

- [x] 财务会计模块首页右上角「凭证录入」改为「新增凭证」（2026-09-04）

- [x] 凭证录入列表垂直空间（2026-09-04）
  - 拆掉 `.main-view` 白卡，主区 padding 8px，白卡只留在 `.page`
  - `VoucherDraftList` 改用 `useFillHeightTable`，900px 视口表体 470→604
  - 录入 / 审核 / 查询 / 科目列表无双滚动条

- [x] 图标宫格长标题自动换行居中（2026-09-04）
  - 共用 `.app-tile__label` / `.app-tile__sub` 去掉单行省略，一行放不下换行并相对图标居中
  - 流程主节点「科目与基础资料」等长标题同步换行
  - 侧栏 / 页签 / 表格等横向列表仍保留省略号

- [x] TR/CK 调拨盘点审核实测（2026-09-04）
  - 新增 14 项单元测试（`scmTransferStockCheckAudit.test.ts`）：TR 双仓移动/多调入仓/同仓拦截/超库存拦截/缺调出仓拦截/反审核还原；CK 盘盈/盘亏/零差异/实盘0全盘亏/无账面从零建仓/反审核还原；TR/CK gen-voucher 锁定「无有效分录」
  - `auditDocHandler` 导出供单测直调（与 genVoucherHandler/unauditDocHandler 一致）
  - 真实账套（东汇）HTTP 全链路实测通过：建仓/料→IS 期初造库存→TR 审核（W-A 10→6、W-B 0→4）→同仓/超库存拦截→反审核还原→CK 盘盈(10→12)/盘亏(10→7)/零差异审核与反审核还原→测试主数据已清理
  - 结论：TR/CK 审核逻辑实现正确，未发现 bug

- [x] PAY/RCV 收付款生成凭证（2026-09-04）
  - 验收结论：`genVoucherHandler` 的 `cat='finance'` 分支早已实现（RCV 借结算账户/贷应收，PAY 借应付/贷结算账户），前端未隐藏按钮，原任务描述已过时
  - 新增 10 项单元测试（`scmPaymentGenVoucher.test.ts`）锁定分录方向、科目优先级（partner > 系统参数 > 默认）、各类拦截
  - 顺带修复 FIX-088：已生成凭证单据禁止反审核；删除凭证自动清除单据 `voucher_id` 回写（消除死锁）
  - 真实账套（东汇）HTTP 全链路实测通过：建单→审核→生成凭证→删凭证→反审核→删单

## 已完成（近期）

- [x] FIX-084：登录页「记住账号密码」退出后失效（2026-09-02）
  - 登录成功后同时保存密码（本地混淆）
  - 退出登录不再清除记住标记
  - 提交前同步浏览器自动填充的密码，避免误报「请输入密码」

- [x] 面包屑导航模块名称可点击，返回模块主页（2026-06-16）
  - 在 Layout.vue 中为模块名称添加点击处理
  - 添加 navigateToModuleHome 方法导航到 /group/:groupTitle
  - 样式：薄荷绿色链接、悬停效果、过渡动画
- [x] 主页（财务驾驶舱）整体重设计：迁移「财务洗头膏」薄荷设计系统（Hero 泡泡横幅 / 指标卡 / 布局重排 / ECharts 色板 / 风险项可点击跳转）(2026-06-10)
- [x] AS/DS 组装拆卸按 BOM 配料：审核（子件↔成品双向库存移动，成本自动分配）+ 生成凭证（存货↔生产成本对开，借贷平衡）
- [x] 订单下推功能（PO→PI / SOa→SO）：DocList 下推按钮 + DocForm 源单加载 + source_doc_id 关联
- [x] 供应链全流程端到端联调（2026-06-08）：PI/SO/PF/PL/PO→PI/SOa→SO/AS/DS 均通过 新增→审核→生成凭证 全链路
- [x] FIX-019：修复供应商科目编码（全部 55 个 partner 的 ap/ar_account 无效值清空，回退到系统参数）
- [x] FIX-018 端到端验证通过：gen-voucher 借贷配平、发票应收应付、调拨/盘点审核

- [x] 修复辅助期初页切换账套报错 (2026-05-24)
- [x] 修复 ACD 导入后 admin 超管无法登录 (2026-05-24)
- [x] 现金流量表 P0–P5（多口径统一、完整打印导出）(2026-05-20)

## 已完成

- [x] 优化构建配置以支持严格类型检查 (2026-05-15)
  - 清理所有 noUnusedLocals/noUnusedParameters 警告（涉及 30+ 个文件）
  - 在 client/tsconfig.json 中启用严格未使用检查：
    - `"noUnusedLocals": true`
    - `"noUnusedParameters": true`
  - 验证结果：
    - ✅ `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters` 通过（0 个错误）
    - ✅ `npx vue-tsc --noEmit` 通过（EXIT:0）

- [x] 修复前端 TypeScript 类型错误（第二轮，全部清零）(2026-05-15)
  - AuxDetail.vue：`res.total` / `res.initBalance` 改为 `(res as any).xxx`
  - AuxBalance.vue：`.map(cat =>` 补全 `(cat: any)` 类型
  - useConfirm.ts：接口/解构/调用处补全 `showCancelButton` 字段，修复 Project.vue 间接报错
  - DynamicReport.vue：`executionCell?.numeric_value` → `(executionCell as any)?.numeric_value`；`sheet.metrics.colWidths` → `(sheet.metrics as any).colWidths`
  - TransferType.vue：布尔联合返回值加 `!!` 强制转 boolean
  - VoucherFilterBar.vue：`:value="null"` → `:value="(null as any)"`
  - KeyboardShortcuts.vue：`@keydown` 事件显式转型为 `KeyboardEvent`
  - print.ts：`TableColumn` 接口补充 `showPaddingSettings?: boolean`
  - TemplateDesigner.vue：拖拽/缩放回调参数补全类型；mock 数据补 `account_set_name`；模板访问 `showPaddingSettings` 改为 `(col as any)`
  - 新增 `src/types/vue-draggable-resizable.d.ts`（第三方组件类型声明）
  - VoucherEntryForm.vue：摘要列 slot 补 `$index` 解构；`@update:model-value` 参数改为 `string | number`；`@select` item 类型改为 `any`；`setCurrentEntry(null as any)`；`HTMLElement` → `HTMLInputElement | null` 并直接调用 `select()`
  - 验证结果：
    - ✅ `npx vue-tsc --noEmit` 通过（0 个错误）
    - ✅ 前端单元测试：5 个测试文件，29 个用例全部通过

- [x] 修复登录页用户名输入框无法手动输入的问题 (2026-05-15)
  - 将登录页用户名组件从 `el-select` 改为 `el-autocomplete`
  - 保留账套用户列表联想能力，同时允许直接手动输入如 `admin`
  - 新增 `queryUsers` 过滤函数，按用户名/昵称提供建议
  - 将 `LoginForm` 中的 `captcha` / `captchaId` 改为可选，匹配当前登录页实际调用
  - 验证结果：
    - ✅ 登录相关前端类型检查通过
    - ✅ 前端单元测试 29 个用例全部通过

- [x] 修复前端 TypeScript 类型错误（第一轮）(2026-05-14)
  - 修复 useVoucherQuery.ts 中的 filters 类型声明
  - 修复 useBatchAuditDialog.ts 中的索引类型问题
  - 修复 useDebounceThrottle.ts 中的 require 问题，改用 import
  - 修复 useSearchMemory.ts 的返回类型，从 T 改为 Ref<T>
  - 进度：前端类型错误从90个减少到42个
  - 剩余问题：
    - 约42个前端类型错误（主要是组件属性类型、Vue 模板类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第六轮 - 完成）(2026-05-14)
  - 修复 voucherPosting.test.ts 中的所有类型错误，使用 Partial<VoucherEntryLike> 和类型断言
  - 修复 testExcelImportScript.ts 中的导入路径（.ts -> .js）
  - 修复 testModels.ts 中的函数参数类型和错误类型
  - 修复 testXlsxModule.ts 中的 path 导入问题
  - 修复 db/index.ts 中的 initDatabase 返回类型问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 后端 TypeScript 类型检查：0个错误
  - 进度：后端类型错误从17个减少到0个
  - **后端 TypeScript 类型错误已全部修复完成！**
  - 剩余问题：
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第五轮）(2026-05-14)
  - 修复 voucherPosting.ts 中的 VoucherEntryLike 接口，支持 number 类型的辅助核算字段
  - 修复 autoTransfer.ts 中的 createTransferVoucherForType 函数签名，使用 Database 类型
  - 修复 importExcelReport.ts 中的 async/await 问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 非测试和非脚本文件：0个类型错误
  - 进度：后端类型错误从20个减少到17个
  - 剩余问题：
    - 后端约17个类型错误（全部是测试文件和脚本文件的类型问题，不影响生产代码）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第四轮）(2026-05-14)
  - 修复 voucher.ts 中的 auxItems 数组类型过滤和 attachmentCount 类型断言
  - 修复 voucherPeriod.ts 中的 year 参数类型问题
  - 修复 voucherEntry.ts 中的函数签名，统一使用 Database 类型：
    - deleteVoucherRecords
    - auditBatchVouchers
    - deleteBatchVouchers
  - 修复 autoTransfer.ts 中的 createAllTransferVouchers 函数签名
  - 修复 voucherAutoTransfer.ts 中的 error 属性类型守卫
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
  - 进度：后端类型错误从27个减少到23个
  - 剩余问题：
    - 后端约23个类型错误（其中19个是测试文件 voucherPosting.test.ts 的 VoucherEntryLike 类型问题，4个是 scripts 文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第三轮）(2026-05-14)
  - 修复 reportEquity.ts 中的 req.accountSetId 类型错误（7处）
  - 修复 reportIncomeStatement.ts 中的 req.accountSetId 类型错误（4处）
  - 修复 task.ts 中的 userId 和 userName 类型错误（8处）
  - 修复 backup.ts 中的 filepath 缺失和 accountSetId 类型错误（2处）
  - 修复 reportAi.ts 中的 data 类型错误（使用 as any）
  - 修复 reportTemplate.ts 和 reportTemplateExecutor.ts 中的 Database 类型兼容性问题
  - 修复 voucher.ts 中的 auxItems 数组类型转换和 user.id 错误
  - 修复 autoTransfer.ts 中的 userId/userName null 类型问题
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
  - 进度：后端类型错误从57个减少到27个
  - 剩余问题：
    - 后端约27个类型错误（主要是测试文件类型问题、Database 类型兼容性、scripts 文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 类型错误（第二轮）(2026-05-14)
  - 修复 auth.ts 中的变量作用域问题（accountsMap、vouchersMap、entryCount）
  - 修复 process.pkg 和 Database.OPEN_READONLY 的类型错误
  - 修复 reportBalance.ts 中的 BalanceQueryDb 类型兼容性问题
  - 批量修复所有函数签名，支持 Database | BalanceQueryDb 联合类型
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 前端单元测试：29个测试用例全部通过
  - 进度：后端类型错误从63个减少到57个
  - 剩余问题：
    - 后端约57个类型错误（主要是 string | undefined 类型问题、测试文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] 修复 TypeScript 导入路径问题 (2026-05-14)
  - 批量修复后端 ES 模块导入路径（添加 .js 扩展名）
  - 修复 process.pkg 类型错误（使用 as any 类型断言）
  - 修复前端部分类型错误（API 响应类型、组件属性类型等）
  - 测试结果：后端单元测试仍然全部通过（36个测试用例）
  - 剩余问题：
    - 后端约63个类型错误（主要是 Database 类型不兼容、测试文件类型问题）
    - 前端约60个类型错误（主要是组件属性类型、API 响应类型）

- [x] Phase 5: 测试与优化 (2026-05-14)
  - 测试结果：
    - ✅ 后端单元测试：36个测试用例全部通过
    - ✅ 前端单元测试：29个测试用例全部通过
    - ✅ 前端构建：成功（跳过类型检查）
    - ⚠️ 后端构建：存在类型错误（主要是导入路径和类型断言问题）
    - ⚠️ 代码质量检查：3486个问题（402个错误，3084个警告）
  - 主要问题：
    - 项目根目录存在大量临时测试脚本文件，导致 lint 错误
    - TypeScript 类型定义不够严格，存在 any 类型和类型断言问题
    - 后端 ES 模块导入路径需要 .js 扩展名
  - 优化建议：
    - 清理项目根目录的临时测试脚本
    - 完善 TypeScript 类型定义
    - 考虑代码分割优化（index.js 文件 1.2MB）

## 已完成

- [x] Phase 4: 打印与导出功能实现 (可选,已有基础导出) (2026-05-14)
  - 打印：已具备单张/批量凭证打印、模板选择、打印预览、分页打印能力
  - 模板：已具备模板管理（新增/编辑/删除/设默认）与可视化设计器能力
  - 数据：已具备后端打印模板接口与凭证打印数据接口
  - 导出：已有基础导出能力（账簿相关页面已包含导出入口）
- [x] 总账日期筛选改为开始日期和结束日期区间查询 (2026-04-21)
  - 前端: 将年份/期间选择器改为日期选择器
  - 后端: 重写查询逻辑,使用子查询计算期初余额、本期发生额、期末余额
  - 期初余额 = 期初余额表 + 开始日期之前的凭证分录
  - 本期发生额 = 开始日期到结束日期之间的凭证分录
  - 期末余额 = 期初余额表 + 结束日期及之前的所有凭证分录
  - 使用子查询包装解决HAVING子句错误
  - 测试验证: 查询2026-04-01至2026-04-30期间,正确返回5个有发生额的科目
- [x] 改进总账筛选为多选复选框 (2026-04-21)
  - 将单选改为多选复选框，支持任意组合
  - 有期初: 期初余额不为0
  - 有发生额: 借方或贷方发生额不为0
  - 有余额: 期末余额不为0
  - 多个条件使用OR逻辑连接
  - 不选任何条件时显示全部科目
- [x] 实现总账三项单选筛选功能 (2026-04-21)
- [x] 修复HAVING子句别名问题 (2026-04-21)
- [x] 修复总账查询参数顺序错误 (2026-04-21)
- [x] 修复总账和余额表科目重复显示问题 (2026-04-21)
- [x] Phase 3: 前端组件开发 - 优化各账簿页面 (2026-04-21)
- [x] Phase 2: 后端API增强 - 优化查询构建器 (2026-04-21)
- [x] Phase 1: 数据库优化 - 添加新字段和索引 (2026-04-21)
  - 添加 voucher_entries 表的 quantity, unit_price, unit 字段
  - 添加 accounts 表的 ledger_format 字段
  - 添加查询优化索引
- [x] 修改结转逻辑：当转出科目为父科目时，在结转预览中显示所有子科目明细，而不是只显示父科目汇总 (2026-04-21)
  - 添加 `isParentAccount` 函数检查科目是否有子科目
  - 添加 `getChildrenBalances` 函数获取所有子科目余额
  - 修改 `getPeriodEndBalanceByCode` 函数，父科目返回子科目数组，明细科目返回单个对象
  - 修改 `buildEntriesFromTransferItems` 函数，支持处理数组返回值，为每个子科目生成单独的分录
---

## 使用说明

### 任务状态
- `- [ ]` 待办/进行中
- `- [x]` 已完成

### 分类
- **进行中**: 当前正在处理的任务
- **待办**: 计划要做但还没开始的任务
- **已完成**: 已经完成的任务

### 更新方式
1. Claude 会在工作时自动更新这个文件
2. 你也可以直接编辑这个文件
3. 下次会话时，Claude 会读取这个文件来了解任务状态
