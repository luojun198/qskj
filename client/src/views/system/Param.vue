<template>
  <div class="page param-page">
    <div class="page-header param-page-header">
      <div class="param-page-header__main">
        <h3>系统参数</h3>
        <span class="param-page-header__desc">账套级全局配置，保存后对凭证、主页取数等生效</span>
      </div>
      <el-button v-if="activeTab === 'ledger'" type="primary" size="small" @click="handleSave">保存</el-button>
    </div>

    <el-tabs v-model="activeTab" class="param-tabs">
      <!-- ── 总账 ── -->
      <el-tab-pane label="总账" name="ledger">
        <div class="param-sections">
          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">
                基本信息
                <span class="param-section__sub">单位名称、凭证编号规则与账套只读信息</span>
              </h4>
            </header>
            <div class="param-section__body">
              <div class="param-basic-row">
                <el-form :model="form" label-width="96px" size="small" class="param-form param-form--inline">
                  <el-form-item label="使用单位名称">
                    <el-input v-model="form.unit_name" placeholder="默认取账套名称" clearable style="width: 200px" />
                  </el-form-item>
                  <el-form-item label="凭证编号规则">
                    <el-select v-model="form.voucher_no_rule" style="width: 148px">
                      <el-option label="按凭证类型编号" value="by_type" />
                      <el-option label="统一编号" value="unified" />
                    </el-select>
                  </el-form-item>
                </el-form>
                <div class="param-meta-inline">
                  <span class="param-meta-chip">
                    <label>建账日期</label>{{ meta.start_date || '—' }}
                  </span>
                  <span class="param-meta-chip">
                    <label>会计区间</label>{{ meta.current_year }}年第{{ meta.current_period }}期
                  </span>
                  <span class="param-meta-chip">
                    <label>科目级数</label>{{ form.account_levels }}级 ·
                    {{ form.account_code_lengths.slice(0, form.account_levels).join('-') }}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section class="param-section param-section--dashboard">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">
                主页取数
                <span class="param-section__sub">控制主面板趋势图与统计指标分类</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <div class="dashboard-rule-panel">
                <span class="dashboard-rule-label">当前取数口径</span>
                <span class="dashboard-rule-current">{{ dashboardRuleSummary }}</span>
                <el-button type="primary" plain size="small" @click="openRulesDialog">
                  配置取数规则
                </el-button>
              </div>
            </div>
          </section>

          <section class="param-section param-section--switches">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">
                业务开关
                <span class="param-section__sub">凭证流程与辅助核算相关功能</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <div class="param-switch-grid">
                <div class="param-switch-card">
                  <span class="param-switch-card__label">凭证审核</span>
                  <el-switch v-model="form.require_audit" size="small" inline-prompt active-text="开" inactive-text="关" />
                </div>
                <div class="param-switch-card">
                  <span class="param-switch-card__label">直接打印</span>
                  <el-switch v-model="form.direct_print" size="small" inline-prompt active-text="开" inactive-text="关" />
                </div>
                <div class="param-switch-card">
                  <span class="param-switch-card__label">凭证时序控制</span>
                  <el-switch v-model="form.voucher_time_control" size="small" inline-prompt active-text="开" inactive-text="关" />
                </div>
                <div class="param-switch-card">
                  <span class="param-switch-card__label">现金流核算</span>
                  <el-switch v-model="form.enable_cash_flow" size="small" inline-prompt active-text="开" inactive-text="关" />
                </div>
                <div class="param-switch-card">
                  <span class="param-switch-card__label">外币核算</span>
                  <el-switch v-model="form.enable_foreign_currency" size="small" inline-prompt active-text="开" inactive-text="关" />
                </div>
              </div>
              <div v-if="form.enable_foreign_currency" class="param-field-row" style="margin-top: 12px">
                <span class="param-field-label">本位币</span>
                <el-input v-model="form.base_currency" style="width: 120px" size="small" placeholder="RMB" />
              </div>
            </div>
          </section>

          <BrandSettingsPanel :visible="brandPanelVisible" />

          <section class="param-section param-section--danger">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">
                系统初始化
                <span class="param-section__sub">清理凭证或按标准模板重新初始化（危险操作）</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <SystemReinitializePanel
                :current-start-date="meta.start_date"
                :account-levels="form.account_levels"
                :account-code-lengths="form.account_code_lengths"
                @completed="handleReinitializeCompleted"
              />
            </div>
          </section>
        </div>
      </el-tab-pane>

      <!-- ── 出纳（按注册模块显示） ── -->
      <el-tab-pane v-if="licenseStore.hasModule('cashier')" label="出纳" name="cashier">
        <div class="param-sections">
          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">凭证生成
                <span class="param-section__sub">出纳录入生成凭证时的默认参数</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="默认出纳凭证类型">
                  <el-select v-model="cashierForm.default_voucher_type_id" style="width:220px" placeholder="自动选最小编码">
                    <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--danger">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">出纳初始化
                <span class="param-section__sub">清空本账套出纳数据（危险操作，不可恢复）</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <ModuleResetPanel
                module-label="出纳"
                business-desc="清空出纳单据、期初余额、银行对账单"
                :reset-fn="() => cashierApi.reset()"
              />
            </div>
          </section>
        </div>
        <div style="padding:0 0 12px 0;display:flex;justify-content:flex-end">
          <el-button type="primary" size="small" @click="handleSaveCashier">保存</el-button>
        </div>
      </el-tab-pane>

      <!-- ── 资产（按注册模块显示） ── -->
      <el-tab-pane v-if="licenseStore.hasModule('asset')" label="资产" name="asset">
        <div class="param-sections">
          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">凭证生成
                <span class="param-section__sub">固定资产生成凭证时使用的凭证类型</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="折旧凭证类型">
                  <el-select v-model="assetForm.depr_voucher_type_id" style="width:220px" clearable placeholder="未设置则不带类型">
                    <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="购买资产凭证类型">
                  <el-select v-model="assetForm.purchase_voucher_type_id" style="width:220px" clearable placeholder="未设置则不带类型">
                    <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                  </el-select>
                </el-form-item>
                <el-form-item label="处置凭证类型">
                  <el-select v-model="assetForm.disposal_voucher_type_id" style="width:220px" clearable placeholder="未设置则不带类型">
                    <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                  </el-select>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">折旧期间控制
                <span class="param-section__sub">折旧初始化与逐月计提顺序</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="折旧起始期间">
                  <el-date-picker
                    v-model="assetForm.depr_start_period"
                    type="month"
                    value-format="YYYY-MM"
                    placeholder="选择起始期间（如 2026-06）"
                    clearable
                    style="width:220px"
                  />
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    设置后从该期间起须逐月计提折旧并生成凭证；前面月份未生成凭证时不允许计提后续月份。留空则不启用。
                  </span>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">盘点科目
                <span class="param-section__sub">盘点生成盘盈/盘亏凭证时使用的对应科目（未配置时盘盈回退 6901 以前年度损益调整、盘亏回退 1901 待处理财产损溢）</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="盘盈对应科目">
                  <div style="width:280px">
                    <AccountSelect v-model="assetForm.inventory_surplus_account" placeholder="盘盈凭证贷方科目" />
                  </div>
                </el-form-item>
                <el-form-item label="盘亏对应科目">
                  <div style="width:280px">
                    <AccountSelect v-model="assetForm.inventory_deficit_account" placeholder="盘亏凭证借方科目" />
                  </div>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">处置科目
                <span class="param-section__sub">处置凭证的资金与损益科目（未配置时回退 1001 / 6301 / 6711）</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="处置收付款科目">
                  <div style="width:280px">
                    <AccountSelect v-model="assetForm.disposal_bank_account" placeholder="收取处置价款的科目" />
                  </div>
                </el-form-item>
                <el-form-item label="处置净收益科目">
                  <div style="width:280px">
                    <AccountSelect v-model="assetForm.disposal_gain_account" placeholder="结转处置净收益" />
                  </div>
                </el-form-item>
                <el-form-item label="处置净损失科目">
                  <div style="width:280px">
                    <AccountSelect v-model="assetForm.disposal_loss_account" placeholder="结转处置净损失" />
                  </div>
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    处置时若所需科目在账套中不存在，将直接报错而不会生成借贷不平的凭证。
                  </span>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">辅助核算对接
                <span class="param-section__sub">资产凭证按资产的部门/使用人自动带出辅助核算项</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="部门核算类别编码">
                  <el-input v-model="assetForm.aux_dept_category_code" style="width:220px" clearable placeholder="默认 dept" />
                </el-form-item>
                <el-form-item label="人员核算类别编码">
                  <el-input v-model="assetForm.aux_person_category_code" style="width:220px" clearable placeholder="默认 person" />
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    资产部门字典（资产档案）与系统辅助核算档案按「编码优先、名称兜底」自动匹配；
                    仅当目标科目已启用对应辅助核算时才写入，匹配不上则该分录不带辅助项。
                  </span>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--danger">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">资产初始化
                <span class="param-section__sub">清空本账套固定资产数据（危险操作，不可恢复）</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <ModuleResetPanel
                module-label="固定资产"
                two-mode
                business-desc="清空资产卡片、折旧、变动、盘点、工作量记录"
                all-desc="另清空 资产分类/部门/用途/状态/变动方式 等基础档案"
                :reset-fn="m => fixedAssetApi.reset(m)"
              />
            </div>
          </section>
        </div>
        <div style="padding:0 0 12px 0;display:flex;justify-content:flex-end">
          <el-button type="primary" size="small" @click="handleSaveAsset">保存</el-button>
        </div>
      </el-tab-pane>

      <!-- ── 供应链（按注册模块显示：进销存 / 生产 / 委外任一） ── -->
      <el-tab-pane
        v-if="licenseStore.hasModule(['scm', 'production', 'outsource'])"
        label="供应链"
        name="supply"
      >
        <div class="param-sections param-sections--supply">
          <section class="param-section param-section--overrun param-section--span-full">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">订单与计划超量控制
                <span class="param-section__sub">仅放宽手工执行上限，不自动增加下推数量、领料建议或 MRP 需求</span>
              </h4>
            </header>
            <div class="param-section__body">
              <div class="overrun-grid">
                <div class="overrun-card" :class="{ 'is-enabled': scmForm.sales_over_delivery_enabled }">
                  <div class="overrun-card__head">
                    <div><span class="overrun-card__eyebrow">销售订单</span><b>销售超发</b></div>
                    <el-switch v-model="scmForm.sales_over_delivery_enabled" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <p>下推销售出库；审核销售退货后恢复额度。</p>
                  <div class="overrun-card__rate"><span>最大超量</span><el-input-number v-model="scmForm.sales_over_delivery_rate" :min="0" :max="1000" :precision="2" :disabled="!scmForm.sales_over_delivery_enabled" :controls="false" /><span>%</span></div>
                </div>
                <div class="overrun-card" :class="{ 'is-enabled': scmForm.purchase_over_receipt_enabled }">
                  <div class="overrun-card__head">
                    <div><span class="overrun-card__eyebrow">采购订单</span><b>采购超收</b></div>
                    <el-switch v-model="scmForm.purchase_over_receipt_enabled" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <p>下推采购入库；审核采购退货后恢复额度。</p>
                  <div class="overrun-card__rate"><span>最大超量</span><el-input-number v-model="scmForm.purchase_over_receipt_rate" :min="0" :max="1000" :precision="2" :disabled="!scmForm.purchase_over_receipt_enabled" :controls="false" /><span>%</span></div>
                </div>
                <div class="overrun-card" :class="{ 'is-enabled': scmForm.production_overrun_enabled }">
                  <div class="overrun-card__head">
                    <div><span class="overrun-card__eyebrow">自制生产</span><b>生产计划超量</b></div>
                    <el-switch v-model="scmForm.production_overrun_enabled" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <p>约束领料、补料与完工入库；审核退料后恢复额度。</p>
                  <div class="overrun-card__rate"><span>最大超量</span><el-input-number v-model="scmForm.production_overrun_rate" :min="0" :max="1000" :precision="2" :disabled="!scmForm.production_overrun_enabled" :controls="false" /><span>%</span></div>
                </div>
                <div class="overrun-card" :class="{ 'is-enabled': scmForm.outsource_overrun_enabled }">
                  <div class="overrun-card__head">
                    <div><span class="overrun-card__eyebrow">委外加工</span><b>委外计划超量</b></div>
                    <el-switch v-model="scmForm.outsource_overrun_enabled" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <p>约束委外发料与委外入库，和自制生产参数独立。</p>
                  <div class="overrun-card__rate"><span>最大超量</span><el-input-number v-model="scmForm.outsource_overrun_rate" :min="0" :max="1000" :precision="2" :disabled="!scmForm.outsource_overrun_enabled" :controls="false" /><span>%</span></div>
                </div>
              </div>
              <div class="overrun-formula"><span>计算规则</span>最大执行量＝原订单或计划量 ×（1＋比例）；精确等于上限时允许保存和审核。</div>
            </div>
          </section>

          <section class="param-section param-section--basic param-section--span-7">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">库存计价
                <span class="param-section__sub">出入库成本计算方式</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="计价方式">
                  <el-select v-model="scmForm.costing_method" style="width:220px" placeholder="默认移动加权平均">
                    <el-option v-for="(n,k) in SCM_COSTING" :key="k"
                      :label="COSTING_IMPLEMENTED.includes(k) ? n : n + '（开发中）'"
                      :value="k" :disabled="!COSTING_IMPLEMENTED.includes(k)" />
                  </el-select>
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    移动加权平均：出库取当前均价。先进先出 / 后进先出：按入库批次形成成本层逐层扣减。指定成本（个别计价）：出库行指定批次即取该批次的入库成本，未指定批次按先进先出。<br>
                    全月平均：期内出库按当前均价暂估，月末在「库存报表 → 全月平均成本计算」统一重算。切换方式时已有结存自动补为「期初层」；成本层可在「库存报表 → 库存成本层」查看。
                  </span>
                </el-form-item>
                <el-form-item label="工序流转校验">
                  <el-switch v-model="scmForm.process_flow_strict" inline-prompt active-text="开" inactive-text="关" />
                  <span style="margin-left:12px;font-size:12px;color:var(--el-text-color-secondary)">
                    开启后，有工艺路线的工单报工时后道工序累计（合格+不良）不得超过前道已审核完成数；关闭则各工序只受计划数约束
                  </span>
                </el-form-item>
                <el-form-item label="采购/委外入库须到货检验">
                  <el-switch v-model="scmForm.qc_required_for_receipt" inline-prompt active-text="开" inactive-text="关" />
                  <span style="margin-left:12px;font-size:12px;color:var(--el-text-color-secondary)">
                    开启后，采购入库(PI) 与委外入库(WI) 审核前必须有挂本入库单号、判定合格且合格数覆盖入库数的已审核到货检验单(IQC)
                  </span>
                </el-form-item>
                <el-form-item label="完工入库须质检">
                  <el-switch v-model="scmForm.qc_required_for_finish" inline-prompt active-text="开" inactive-text="关" />
                  <span style="margin-left:12px;font-size:12px;color:var(--el-text-color-secondary)">
                    开启后，完工入库(PF)/委外入库(WI) 审核前必须有一张判定合格的已审核完工检验单(FQC)
                  </span>
                </el-form-item>
                <el-form-item label="可选币别">
                  <el-input v-model="scmForm.currencies" style="width:420px" placeholder="逗号分隔，如 CNY,USD,EUR；留空用默认" />
                </el-form-item>
                <el-form-item label="收发类别">
                  <el-input v-model="scmForm.io_categories" style="width:420px" placeholder="逗号分隔，如 领用,报废,盘盈,盘亏（其他出入库用）" />
                </el-form-item>
                <el-form-item label="运输方式">
                  <el-input v-model="scmForm.transport_methods" style="width:420px" placeholder="逗号分隔，如 自提,快递,物流,专车" />
                </el-form-item>
                <el-form-item label="单据编号规则">
                  <el-input v-model="scmForm.doc_no_rule" style="width:420px" placeholder="默认 {YYYY}{MM}-{CODE}-{SEQ:3}" />
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    编号规则占位符：{YYYY}年 {YY}年后两位 {MM}月 {DD}日 {CODE}单据类型 {SEQ:n}序号(n位)。留空用默认。
                  </span>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic param-section--span-5">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">负库存控制
                <span class="param-section__sub">按仓库控制出库、调拨、组装、拆卸、盘点等审核时是否允许库存为负</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-form-item label="允许负库存仓库">
                  <el-select
                    v-model="scmForm.negative_stock_warehouses"
                    multiple
                    filterable
                    clearable
                    collapse-tags
                    collapse-tags-tooltip
                    placeholder="未选择则所有仓库均不允许负库存"
                    style="width:420px"
                  >
                    <el-option
                      v-for="warehouse in scmWarehouses"
                      :key="warehouse.code"
                      :label="`${warehouse.code} ${warehouse.name}`"
                      :value="warehouse.code"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label=" ">
                  <span style="font-size:12px;color:var(--el-text-color-secondary);line-height:1.7">
                    勾选后，该仓库出库或因修改、反审核入库单造成库存为负时仍允许审核；未勾选仓库继续按库存不足拦截。
                  </span>
                </el-form-item>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--basic param-section--span-8">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">单据生成凭证对方科目
                <span class="param-section__sub">未填时系统按「默认编码 → 科目名称」自动匹配本账套科目；往来单位配了应收/应付科目时优先取单位科目</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="150px" size="small">
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="应付账款（采购）">
                      <AccountSelect v-model="scmForm.acc_ap" :accounts="accountOptions" placeholder="默认 2202" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_ap']" :configured="!!scmForm.acc_ap" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="应收账款（销售）">
                      <AccountSelect v-model="scmForm.acc_ar" :accounts="accountOptions" placeholder="默认 1122" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_ar']" :configured="!!scmForm.acc_ar" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="主营业务收入">
                      <AccountSelect v-model="scmForm.acc_revenue" :accounts="accountOptions" placeholder="默认 6001" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_revenue']" :configured="!!scmForm.acc_revenue" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="主营业务成本">
                      <AccountSelect v-model="scmForm.acc_cost" :accounts="accountOptions" placeholder="默认 6401" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_cost']" :configured="!!scmForm.acc_cost" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="生产成本">
                      <AccountSelect v-model="scmForm.acc_production" :accounts="accountOptions" placeholder="默认 5001" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_production']" :configured="!!scmForm.acc_production" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="其他出入库对方科目">
                      <AccountSelect v-model="scmForm.acc_other" :accounts="accountOptions" placeholder="默认 1901 待处理财产损溢" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_other']" :configured="!!scmForm.acc_other" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="进项税（采购发票）">
                      <AccountSelect v-model="scmForm.acc_tax_input" :accounts="accountOptions" placeholder="默认 22210101" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_tax_input']" :configured="!!scmForm.acc_tax_input" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="销项税（销售发票）">
                      <AccountSelect v-model="scmForm.acc_tax_output" :accounts="accountOptions" placeholder="默认 22210105" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_tax_output']" :configured="!!scmForm.acc_tax_output" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="应付职工薪酬（完工人工）">
                      <AccountSelect v-model="scmForm.acc_labor" :accounts="accountOptions" placeholder="默认 2211" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_labor']" :configured="!!scmForm.acc_labor" />
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="制造费用（完工制费）">
                      <AccountSelect v-model="scmForm.acc_overhead" :accounts="accountOptions" placeholder="默认 5101" style="width:100%" />
                      <ScmAccountHint :info="resolvedAcc['scm:acc_overhead']" :configured="!!scmForm.acc_overhead" />
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </div>
          </section>
          <section class="param-section param-section--basic param-section--span-4">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">物料档案分级
                <span class="param-section__sub">参照会计科目分级，控制物料档案编码层级</span>
              </h4>
            </header>
            <div class="param-section__body">
              <el-form label-width="130px" size="small">
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form-item label="最大级次">
                      <el-input-number v-model="scmForm.item_levels" :min="1" :max="10" :controls="false" style="width:120px" />
                      <span style="margin-left:8px;font-size:12px;color:#909399">默认 4 级</span>
                    </el-form-item>
                  </el-col>
                  <el-col :span="12">
                    <el-form-item label="每级编码长度">
                      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                        <template v-for="(_, index) in Array(scmForm.item_levels || 4)" :key="index">
                          <span v-if="index > 0" style="color: var(--el-text-color-secondary); font-size: 12px;">-</span>
                          <el-input-number
                            v-model="scmForm.item_code_lengths[index]"
                            :min="1"
                            :max="10"
                            :controls="false"
                            style="width: 52px;"
                          />
                        </template>
                      </div>
                    </el-form-item>
                  </el-col>
                </el-row>
              </el-form>
            </div>
          </section>

          <section class="param-section param-section--danger param-section--span-full">
            <header class="param-section__head">
              <span class="param-section__marker" aria-hidden="true"></span>
              <h4 class="param-section__title">供应链初始化
                <span class="param-section__sub">清空本账套供应链数据（危险操作，不可恢复）</span>
              </h4>
            </header>
            <div class="param-section__body param-section__body--compact">
              <ModuleResetPanel
                module-label="供应链"
                two-mode
                business-desc="清空 单据/库存/出入库流水/批次/生产计划/往来台账/报工"
                all-desc="另清空 物料/物料分类/计量单位/往来单位/仓库/BOM 等基础档案（单据类型为系统预置，始终保留）"
                :reset-fn="m => scmApi.resetData(m)"
              />
            </div>
          </section>
        </div>
        <div class="param-save-bar">
          <span>参数按当前账套保存，保存后立即生效</span>
          <el-button type="primary" size="small" @click="handleSaveScm">保存供应链参数</el-button>
        </div>
      </el-tab-pane>
    </el-tabs>

  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/api/request'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useBaseDataStore } from '@/stores/baseData'
import { useLicenseStore } from '@/stores/license'
import BrandSettingsPanel from '@/components/system/BrandSettingsPanel.vue'
import SystemReinitializePanel from '@/components/system/SystemReinitializePanel.vue'
import ModuleResetPanel from '@/components/system/ModuleResetPanel.vue'
import AccountSelect from '@/components/base/AccountSelect.vue'
import ScmAccountHint, { type ScmAccountResolveInfo } from '@/components/system/ScmAccountHint.vue'
import type { Account } from '@/types/base'
import { scmApi, type ScmWarehouse } from '@/api/scm'
import { cashierApi } from '@/api/cashier'
import { fixedAssetApi } from '@/api/fixedAsset'

interface SystemParam {
  id?: string
  account_set_id?: string
  param_key: string
  param_value: string
}

const ACCOUNTING_STANDARD_LABELS: Record<string, string> = {
  auto: '自动识别',
  government: '政府会计制度',
  small_business: '小企业会计准则',
  enterprise: '新企业会计准则',
  custom: '自定义',
}

const form = ref({
  unit_name: '',
  accounting_standard: 'auto',
  voucher_no_rule: 'by_type',
  require_audit: true,
  direct_print: false,
  voucher_time_control: false,
  enable_cash_flow: false,
  enable_foreign_currency: false,
  base_currency: 'RMB',
  account_levels: 6,
  account_code_lengths: [4, 2, 2, 2, 2, 2, 2, 2, 2, 2],
})

const brandPanelVisible = ref(false)
const activeTab = ref('ledger')

// ── 出纳参数 ──────────────────────────────────────────────
interface VoucherType { id: string; code: string; name: string }
const voucherTypes = ref<VoucherType[]>([])
const cashierForm = ref({ default_voucher_type_id: '' })
const assetForm = ref({
  depr_voucher_type_id: '',
  purchase_voucher_type_id: '',
  disposal_voucher_type_id: '',
  depr_start_period: '',
  inventory_surplus_account: '',
  inventory_deficit_account: '',
  disposal_bank_account: '',
  disposal_gain_account: '',
  disposal_loss_account: '',
  aux_dept_category_code: '',
  aux_person_category_code: '',
})
const scmForm = ref({
  costing_method: '',
  acc_ap: '',
  acc_ar: '',
  acc_revenue: '',
  acc_cost: '',
  acc_production: '',
  acc_other: '',
  acc_tax_input: '',
  acc_tax_output: '',
  acc_labor: '',
  acc_overhead: '',
  item_levels: 4,
  item_code_lengths: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  negative_stock_warehouses: [] as string[],
  sales_over_delivery_enabled: false,
  sales_over_delivery_rate: 0,
  purchase_over_receipt_enabled: false,
  purchase_over_receipt_rate: 0,
  production_overrun_enabled: false,
  production_overrun_rate: 0,
  outsource_overrun_enabled: false,
  outsource_overrun_rate: 0,
  qc_required_for_finish: false,
  qc_required_for_receipt: false,
  process_flow_strict: true,
  currencies: '',
  io_categories: '',
  transport_methods: '',
  doc_no_rule: '',
})
const scmWarehouses = ref<ScmWarehouse[]>([])
const SCM_COSTING: Record<string, string> = { moving_avg: '移动加权平均', month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }
// 已实现的计价方式（其余在参数页禁选、过账时拦截）
const COSTING_IMPLEMENTED = ['moving_avg', 'fifo', 'lifo', 'specified', 'month_avg']
const SCM_ACC_KEYS = ['acc_ap','acc_ar','acc_revenue','acc_cost','acc_production','acc_other','acc_tax_input','acc_tax_output','acc_labor','acc_overhead'] as const

async function fetchVoucherTypes() {
  if (voucherTypes.value.length) return
  try {
    const res = await request.get<VoucherType[]>('/base/voucher-types')
    voucherTypes.value = (res.data || []).sort((a, b) => a.code.localeCompare(b.code))
    // 若未设置参数，默认选最小 code
    if (!cashierForm.value.default_voucher_type_id && voucherTypes.value.length)
      cashierForm.value.default_voucher_type_id = voucherTypes.value[0].id
  } catch { /* ignore */ }
}

/** 供应链对方科目的自动匹配结果，按 param_key 索引 */
const resolvedAcc = ref<Record<string, ScmAccountResolveInfo>>({})
async function fetchResolvedScmAccounts() {
  try {
    const res = await request.get<ScmAccountResolveInfo[]>('/scm/params/resolved-accounts')
    const map: Record<string, ScmAccountResolveInfo> = {}
    for (const row of res.data || []) map[row.param_key] = row
    resolvedAcc.value = map
  } catch { /* 提示性信息，取不到就不显示 */ }
}

async function fetchScmWarehouses() {
  if (scmWarehouses.value.length) return
  try {
    const res = await scmApi.getWarehouses()
    scmWarehouses.value = (res.data || []).filter(w => w.enabled !== 0)
  } catch (error) {
    showOperationError('加载仓库列表', error)
  }
}

watch(activeTab, v => {
  if (v === 'cashier' || v === 'asset') fetchVoucherTypes()
  if (v === 'supply') { fetchScmWarehouses(); fetchResolvedScmAccounts() }
})
const route = useRoute()
const router = useRouter()
const baseDataStore = useBaseDataStore()
const licenseStore = useLicenseStore()

const accountOptions = computed<Account[]>(() => baseDataStore.accounts)

const dashboardRuleSummary = computed(() => {
  if (meta.value.resolved_accounting_standard_name) {
    return meta.value.resolved_accounting_standard_name
  }
  return ACCOUNTING_STANDARD_LABELS[form.value.accounting_standard] || '未设置'
})

const meta = ref({
  unit_name: '',
  start_date: '',
  current_year: new Date().getFullYear(),
  current_period: new Date().getMonth() + 1,
  resolved_accounting_standard_name: '',
  dashboard_rules_editable: false,
})

async function openRulesDialog() {
  await router.push('/system/dashboard-rules')
}

async function fetchData() {
  try {
    const res = await request.get<SystemParam[]>('/system/params')
    const params = (res.data || []) as SystemParam[]
    for (const p of params) {
      if (p.param_key === 'unit_name') {
        form.value.unit_name = p.param_value || ''
      } else if (p.param_key === 'accounting_standard') {
        form.value.accounting_standard = p.param_value || 'auto'
      } else if (p.param_key === 'voucher_no_rule') {
        form.value.voucher_no_rule = p.param_value || 'by_type'
      } else if (p.param_key === 'require_audit') {
        form.value.require_audit = p.param_value === 'true'
      } else if (p.param_key === 'direct_print') {
        form.value.direct_print = p.param_value === 'true'
      } else if (p.param_key === 'voucher_time_control') {
        form.value.voucher_time_control = p.param_value === 'true'
      } else if (p.param_key === 'enable_cash_flow') {
        form.value.enable_cash_flow = p.param_value === 'true'
      } else if (p.param_key === 'enable_foreign_currency') {
        form.value.enable_foreign_currency = p.param_value === 'true'
      } else if (p.param_key === 'base_currency') {
        form.value.base_currency = p.param_value || 'RMB'
      } else if (p.param_key === 'account_levels') {
        form.value.account_levels = parseInt(p.param_value) || 6
      } else if (p.param_key === 'account_code_lengths') {
        try {
          const lengths = JSON.parse(p.param_value)
          if (Array.isArray(lengths)) form.value.account_code_lengths = lengths
        } catch {
          /* 保持默认值 */
        }
      } else if (p.param_key === 'cashier:default_voucher_type_id') {
        cashierForm.value.default_voucher_type_id = p.param_value || ''
      } else if (p.param_key === 'asset:depr_voucher_type_id') {
        assetForm.value.depr_voucher_type_id = p.param_value || ''
      } else if (p.param_key === 'asset:purchase_voucher_type_id') {
        assetForm.value.purchase_voucher_type_id = p.param_value || ''
      } else if (p.param_key === 'asset:depr_start_period') {
        assetForm.value.depr_start_period = p.param_value || ''
      } else if (p.param_key === 'asset:inventory_surplus_account') {
        assetForm.value.inventory_surplus_account = p.param_value || ''
      } else if (p.param_key === 'asset:inventory_deficit_account') {
        assetForm.value.inventory_deficit_account = p.param_value || ''
      } else if (p.param_key === 'asset:disposal_voucher_type_id') {
        assetForm.value.disposal_voucher_type_id = p.param_value || ''
      } else if (p.param_key === 'asset:disposal_bank_account') {
        assetForm.value.disposal_bank_account = p.param_value || ''
      } else if (p.param_key === 'asset:disposal_gain_account') {
        assetForm.value.disposal_gain_account = p.param_value || ''
      } else if (p.param_key === 'asset:disposal_loss_account') {
        assetForm.value.disposal_loss_account = p.param_value || ''
      } else if (p.param_key === 'asset:aux_dept_category_code') {
        assetForm.value.aux_dept_category_code = p.param_value || ''
      } else if (p.param_key === 'asset:aux_person_category_code') {
        assetForm.value.aux_person_category_code = p.param_value || ''
      } else if (p.param_key === 'scm:costing_method') {
        scmForm.value.costing_method = p.param_value || ''
      } else if (p.param_key === 'scm:item_levels') {
        scmForm.value.item_levels = parseInt(p.param_value) || 4
      } else if (p.param_key === 'scm:item_code_lengths') {
        const lengths = (p.param_value || '2,2,2,2').split(',').map(n => parseInt(n) || 2)
        lengths.forEach((len, i) => { if (i < 10) scmForm.value.item_code_lengths[i] = len })
      } else if (p.param_key === 'scm:negative_stock_warehouses') {
        try {
          const parsed = JSON.parse(p.param_value || '[]')
          scmForm.value.negative_stock_warehouses = Array.isArray(parsed)
            ? parsed.map(code => String(code || '').trim()).filter(Boolean)
            : []
        } catch {
          scmForm.value.negative_stock_warehouses = []
        }
      } else if (p.param_key === 'scm:sales_over_delivery_enabled') {
        scmForm.value.sales_over_delivery_enabled = p.param_value === '1'
      } else if (p.param_key === 'scm:sales_over_delivery_rate') {
        scmForm.value.sales_over_delivery_rate = Math.max(0, Number(p.param_value) || 0)
      } else if (p.param_key === 'scm:purchase_over_receipt_enabled') {
        scmForm.value.purchase_over_receipt_enabled = p.param_value === '1'
      } else if (p.param_key === 'scm:purchase_over_receipt_rate') {
        scmForm.value.purchase_over_receipt_rate = Math.max(0, Number(p.param_value) || 0)
      } else if (p.param_key === 'scm:qc_required_for_finish') {
        scmForm.value.qc_required_for_finish = p.param_value === '1'
      } else if (p.param_key === 'scm:qc_required_for_receipt') {
        scmForm.value.qc_required_for_receipt = p.param_value === '1'
      } else if (p.param_key === 'scm:process_flow_strict') {
        scmForm.value.process_flow_strict = p.param_value !== '0'
      } else if (p.param_key === 'scm:production_overrun_enabled') {
        scmForm.value.production_overrun_enabled = p.param_value === '1'
      } else if (p.param_key === 'scm:production_overrun_rate') {
        scmForm.value.production_overrun_rate = Math.max(0, Number(p.param_value) || 0)
      } else if (p.param_key === 'scm:outsource_overrun_enabled') {
        scmForm.value.outsource_overrun_enabled = p.param_value === '1'
      } else if (p.param_key === 'scm:outsource_overrun_rate') {
        scmForm.value.outsource_overrun_rate = Math.max(0, Number(p.param_value) || 0)
      } else if (p.param_key === 'scm:currencies') {
        scmForm.value.currencies = p.param_value || ''
      } else if (p.param_key === 'scm:io_categories') {
        scmForm.value.io_categories = p.param_value || ''
      } else if (p.param_key === 'scm:transport_methods') {
        scmForm.value.transport_methods = p.param_value || ''
      } else if (p.param_key === 'scm:doc_no_rule') {
        scmForm.value.doc_no_rule = p.param_value || ''
      } else if (p.param_key.startsWith('scm:acc_')) {
        const k = p.param_key.slice('scm:'.length) as keyof typeof scmForm.value
        if (k in scmForm.value) (scmForm.value as any)[k] = p.param_value || ''
      }
    }
    const meta_ = (res as any).meta
    if (meta_) {
      meta.value = { ...meta.value, ...meta_ }
      if (!form.value.unit_name) {
        form.value.unit_name = meta_.unit_name || ''
      }
    }
  } catch (error) {
    showOperationError('加载系统参数', error)
  }
}

async function handleSave() {
  try {
    const params: SystemParam[] = [
      { param_key: 'unit_name', param_value: form.value.unit_name },
      { param_key: 'accounting_standard', param_value: form.value.accounting_standard },
      { param_key: 'voucher_no_rule', param_value: form.value.voucher_no_rule },
      { param_key: 'require_audit', param_value: String(form.value.require_audit) },
      { param_key: 'direct_print', param_value: String(form.value.direct_print) },
      { param_key: 'voucher_time_control', param_value: String(form.value.voucher_time_control) },
      { param_key: 'enable_cash_flow', param_value: String(form.value.enable_cash_flow) },
      {
        param_key: 'enable_foreign_currency',
        param_value: String(form.value.enable_foreign_currency),
      },
      { param_key: 'base_currency', param_value: form.value.base_currency || 'RMB' },
      { param_key: 'account_levels', param_value: String(form.value.account_levels) },
      {
        param_key: 'account_code_lengths',
        param_value: JSON.stringify(
          form.value.account_code_lengths.slice(0, form.value.account_levels)
        ),
      },
    ]
    await request.put('/system/params', { params })
    await useSystemParamsStore().load(true)
    await fetchData()
    showSuccess('保存成功')
  } catch (error) {
    showOperationError('保存系统参数', error)
  }
}

async function handleSaveCashier() {
  try {
    await request.put('/cashier/params', {
      params: [{ param_key: 'cashier:default_voucher_type_id', param_value: cashierForm.value.default_voucher_type_id }],
    })
    showSuccess('保存成功')
  } catch (error) {
    showOperationError('保存出纳参数', error)
  }
}

async function handleSaveAsset() {
  try {
    await request.put('/asset/params', {
      params: [
        { param_key: 'asset:depr_voucher_type_id', param_value: assetForm.value.depr_voucher_type_id || '' },
        { param_key: 'asset:purchase_voucher_type_id', param_value: assetForm.value.purchase_voucher_type_id || '' },
        { param_key: 'asset:depr_start_period', param_value: assetForm.value.depr_start_period || '' },
        { param_key: 'asset:inventory_surplus_account', param_value: assetForm.value.inventory_surplus_account || '' },
        { param_key: 'asset:inventory_deficit_account', param_value: assetForm.value.inventory_deficit_account || '' },
        { param_key: 'asset:disposal_voucher_type_id', param_value: assetForm.value.disposal_voucher_type_id || '' },
        { param_key: 'asset:disposal_bank_account', param_value: assetForm.value.disposal_bank_account || '' },
        { param_key: 'asset:disposal_gain_account', param_value: assetForm.value.disposal_gain_account || '' },
        { param_key: 'asset:disposal_loss_account', param_value: assetForm.value.disposal_loss_account || '' },
        { param_key: 'asset:aux_dept_category_code', param_value: assetForm.value.aux_dept_category_code || '' },
        { param_key: 'asset:aux_person_category_code', param_value: assetForm.value.aux_person_category_code || '' },
      ],
    })
    showSuccess('保存成功')
  } catch (error) {
    showOperationError('保存资产参数', error)
  }
}

async function handleSaveScm() {
  try {
    const params = [
      { param_key: 'scm:costing_method', param_value: scmForm.value.costing_method || '' },
      ...SCM_ACC_KEYS.map(k => ({ param_key: `scm:${k}`, param_value: (scmForm.value as any)[k] || '' })),
      { param_key: 'scm:item_levels', param_value: String(scmForm.value.item_levels || 4) },
      { param_key: 'scm:item_code_lengths', param_value: scmForm.value.item_code_lengths.slice(0, scmForm.value.item_levels || 4).join(',') },
      { param_key: 'scm:negative_stock_warehouses', param_value: JSON.stringify(scmForm.value.negative_stock_warehouses || []) },
      { param_key: 'scm:sales_over_delivery_enabled', param_value: scmForm.value.sales_over_delivery_enabled ? '1' : '0' },
      { param_key: 'scm:sales_over_delivery_rate', param_value: String(Math.max(0, Number(scmForm.value.sales_over_delivery_rate) || 0)) },
      { param_key: 'scm:purchase_over_receipt_enabled', param_value: scmForm.value.purchase_over_receipt_enabled ? '1' : '0' },
      { param_key: 'scm:purchase_over_receipt_rate', param_value: String(Math.max(0, Number(scmForm.value.purchase_over_receipt_rate) || 0)) },
      { param_key: 'scm:qc_required_for_finish', param_value: scmForm.value.qc_required_for_finish ? '1' : '0' },
      { param_key: 'scm:qc_required_for_receipt', param_value: scmForm.value.qc_required_for_receipt ? '1' : '0' },
      { param_key: 'scm:process_flow_strict', param_value: scmForm.value.process_flow_strict ? '1' : '0' },
      { param_key: 'scm:production_overrun_enabled', param_value: scmForm.value.production_overrun_enabled ? '1' : '0' },
      { param_key: 'scm:production_overrun_rate', param_value: String(Math.max(0, Number(scmForm.value.production_overrun_rate) || 0)) },
      { param_key: 'scm:outsource_overrun_enabled', param_value: scmForm.value.outsource_overrun_enabled ? '1' : '0' },
      { param_key: 'scm:outsource_overrun_rate', param_value: String(Math.max(0, Number(scmForm.value.outsource_overrun_rate) || 0)) },
      { param_key: 'scm:currencies', param_value: scmForm.value.currencies || '' },
      { param_key: 'scm:io_categories', param_value: scmForm.value.io_categories || '' },
      { param_key: 'scm:transport_methods', param_value: scmForm.value.transport_methods || '' },
      { param_key: 'scm:doc_no_rule', param_value: scmForm.value.doc_no_rule || '' },
    ]
    await request.put('/scm/params', { params })
    fetchResolvedScmAccounts()
    await fetchData()
    showSuccess('保存成功')
  } catch (error) {
    showOperationError('保存供应链参数', error)
  }
}

async function handleReinitializeCompleted() {
  baseDataStore.invalidate()
  useSystemParamsStore().reset()
  await fetchData()
  showSuccess('系统初始化已完成，请检查科目与期初数据')
}

function syncBrandPanelFromRoute() {
  brandPanelVisible.value = route.query.openBrandSettings === '1'
}

/** 支持 ?tab=xxx 直达指定页签（如从固定资产工作台「套账信息」进入） */
const PARAM_TAB_NAMES = ['ledger', 'cashier', 'asset', 'supply']
function syncTabFromRoute() {
  const tab = route.query.tab
  if (typeof tab === 'string' && (PARAM_TAB_NAMES as string[]).includes(tab)) {
    activeTab.value = tab
  }
}

watch(
  () => route.query.openBrandSettings,
  () => syncBrandPanelFromRoute()
)

// keep-alive 缓存下 onMounted 不重跑：激活或 query.tab 变化时同步页签
watch(
  () => route.query.tab,
  () => syncTabFromRoute()
)
onActivated(() => syncTabFromRoute())

onMounted(async () => {
  syncBrandPanelFromRoute()
  syncTabFromRoute()
  await fetchData()
  if (route.query.openDashboardRules === '1') {
    await router.replace('/system/dashboard-rules')
  }
})
</script>

<style scoped>
.param-page {
  gap: 8px;
  padding: 8px 12px 16px;
}

.overrun-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.overrun-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-default, #d6e5e6);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.86);
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.overrun-card.is-enabled {
  border-color: var(--mint-300, #66e0cb);
  background: var(--mint-50, #e8fbf7);
  box-shadow: inset 0 0 0 1px rgba(18, 199, 174, 0.06);
}

.overrun-card__head,
.overrun-card__rate {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overrun-card__head {
  justify-content: space-between;
}

.overrun-card__head > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.overrun-card__head b {
  color: var(--text-strong, #0c2a2e);
  font-size: var(--cw-text-base);
  line-height: 1.35;
}

.overrun-card__eyebrow {
  color: var(--mint-700, #0a8576);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.overrun-card p {
  min-height: 0;
  margin: 5px 0 7px;
  color: var(--text-muted, #62858a);
  font-size: 12px;
  line-height: 1.5;
}

.overrun-card__rate {
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px dashed var(--border-default, #d6e5e6);
  color: var(--text-body, #2b4c51);
  font-size: 12px;
}

.overrun-card__rate > span:first-child {
  margin-right: auto;
}

.overrun-card__rate .el-input-number {
  width: 82px;
}

.overrun-formula {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-sunken, #ecf6f4);
  color: var(--text-muted, #62858a);
  font-size: 12px;
  line-height: 1.5;
}

.overrun-formula > span {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--mint-700, #0a8576);
  font-weight: 600;
}

.param-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 0 2px 8px;
  border-bottom: 1px solid var(--border-subtle, #e9f2f2);
}

.param-page-header__main {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.param-page-header__main h3 {
  margin: 0;
  color: var(--text-strong, #0c2a2e);
  font-size: var(--cw-text-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.param-page-header__desc {
  color: var(--text-muted, #62858a);
  font-size: 12px;
  line-height: 1.4;
}

.param-tabs {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.param-tabs :deep(.el-tabs__header) {
  margin: 0 0 12px;
  padding: 2px;
  background: var(--surface-sunken, #ecf6f4);
  border-bottom: none;
  border-radius: 10px;
}
.param-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}
.param-tabs :deep(.el-tabs__item) {
  height: 34px;
  margin-right: 2px;
  padding: 0 18px;
  border-radius: 8px;
  color: var(--text-muted, #62858a);
  font-size: var(--cw-text-base);
  font-weight: 500;
  line-height: 34px;
  transition: color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}
.param-tabs :deep(.el-tabs__item:hover) {
  background: rgba(255, 255, 255, 0.64);
  color: var(--mint-600, #0e9f8b);
}
.param-tabs :deep(.el-tabs__item.is-active) {
  background: var(--surface-card, #fff);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(12, 42, 46, 0.06));
  color: var(--mint-700, #0a8576);
  font-size: var(--cw-text-base);
  font-weight: 700;
}
.param-tabs :deep(.el-tabs__active-bar) {
  display: none;
}
.param-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: visible;
  padding: 0;
}
.param-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 200px;
  color: var(--el-text-color-secondary);
  font-size: var(--cw-text-base);
}
.param-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 8px;
  align-items: start;
}

.param-sections--supply {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.param-section--span-full {
  grid-column: 1 / -1;
}

.param-section--span-8 {
  grid-column: span 8;
}

.param-section--span-7 {
  grid-column: span 7;
}

.param-section--span-5 {
  grid-column: span 5;
}

.param-section--span-4 {
  grid-column: span 4;
}

.param-section {
  overflow: hidden;
  border: 1px solid var(--border-default, #d6e5e6);
  border-radius: 10px;
  background: var(--surface-card, #fff);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(12, 42, 46, 0.06));
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.param-section:hover {
  border-color: var(--border-strong, #b4cbce);
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(12, 42, 46, 0.07));
}

.param-section--overrun {
  --param-accent: var(--mint-500, #12c7ae);
  border-color: var(--mint-200, #9feddf);
  background: linear-gradient(180deg, rgba(232, 251, 247, 0.7) 0, #fff 92px);
}

.param-section--basic {
  --param-accent: var(--mint-500, #12C7AE);
}

.param-section--dashboard {
  --param-accent: var(--mint-500, #12C7AE);
}

.param-section--switches {
  --param-accent: var(--mint-500, #12C7AE);
}

.param-section--danger {
  --param-accent: var(--danger, #f2545b);
}

.param-section__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border-subtle, #e9f2f2);
}

.param-section__marker {
  flex-shrink: 0;
  width: 3px;
  height: 17px;
  margin-top: 1px;
  border-radius: 4px;
  background: var(--param-accent);
}

.param-section__title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  color: var(--text-strong, #0c2a2e);
  font-size: var(--cw-text-base);
  font-weight: 700;
  line-height: 1.35;
}

.param-section__sub {
  color: var(--text-muted, #62858a);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
}

.param-section__body {
  padding: 10px 12px 12px;
}

.param-section__body--compact {
  padding: 9px 12px 12px;
}

.param-section :deep(.el-form-item) {
  margin-bottom: 8px;
}

.param-section :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.param-section :deep(.el-input),
.param-section :deep(.el-select),
.param-section :deep(.el-input-number) {
  max-width: 100%;
}

.param-form--inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
}

.param-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.param-basic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
}

.param-meta-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.param-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid var(--mint-100, #cff6ef);
  border-radius: 7px;
  background: var(--mint-50, #e8fbf7);
  color: var(--mint-800, #0A8576);
  font-size: 12px;
  white-space: nowrap;
}

.param-meta-chip label {
  font-size: 12px;
  color: var(--mint-600, #0e9f8b);
  font-weight: 500;
}

.dashboard-rule-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle, #e9f2f2);
  border-radius: 9px;
  background: var(--surface-sunken, #ecf6f4);
}

.dashboard-rule-label {
  font-size: var(--cw-text-base);
  color: var(--el-text-color-secondary, #909399);
  flex-shrink: 0;
}

.dashboard-rule-current {
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: var(--param-accent);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.param-switch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.param-switch-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle, #e9f2f2);
  border-radius: 9px;
  background: var(--surface-sunken, #ecf6f4);
  transition: border-color 140ms ease, background-color 140ms ease;
}

.param-switch-card:hover {
  border-color: var(--mint-200, #9feddf);
  background: var(--mint-50, #e8fbf7);
}

.param-switch-card__label {
  font-size: var(--cw-text-base);
  font-weight: 500;
  color: var(--el-text-color-primary, #303133);
  white-space: nowrap;
}

.param-save-bar {
  position: sticky;
  z-index: 5;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-default, #d6e5e6);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 -3px 12px rgba(12, 42, 46, 0.05);
  backdrop-filter: blur(10px);
}

.param-save-bar > span {
  color: var(--text-muted, #62858a);
  font-size: 12px;
}

@media (max-width: 1180px) {
  .overrun-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .param-section--span-8,
  .param-section--span-7,
  .param-section--span-5,
  .param-section--span-4 {
    grid-column: span 12;
  }

  .param-switch-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .param-meta-inline {
    margin-left: 0;
    width: 100%;
  }
}

@media (max-width: 900px) {
  .param-sections,
  .param-sections--supply {
    grid-template-columns: 1fr;
  }

  .param-section--span-full,
  .param-section--span-8,
  .param-section--span-7,
  .param-section--span-5,
  .param-section--span-4 {
    grid-column: 1;
  }

  .overrun-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .param-page {
    padding-inline: 8px;
  }

  .param-tabs :deep(.el-tabs__item) {
    padding: 0 12px;
  }

  .param-switch-grid {
    grid-template-columns: 1fr;
  }

  .param-page-header__main {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .param-save-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .param-save-bar :deep(.el-button) {
    width: 100%;
  }
}
</style>
