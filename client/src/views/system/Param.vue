<template>
  <div class="param-page">
    <div class="param-tabs-wrap">
      <el-tabs v-model="activeTab" class="param-tabs">
        <!-- ── 总账 ── -->
        <el-tab-pane label="总账参数" name="ledger">
          <div class="param-sections param-sections--grid12">
            <section class="param-section param-section--basic param-section--span-7">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">基本信息<ParamTip content="单位名称、凭证编号规则与账套只读信息；保存后对凭证、主页取数等生效" /></h4>
                <div class="param-meta-inline">
                  <span class="param-meta-chip"><label>建账</label>{{ meta.start_date || '—' }}</span>
                  <span class="param-meta-chip"><label>当前</label>{{ meta.current_year }}年{{ meta.current_period }}期</span>
                  <span class="param-meta-chip">
                    <label>科目</label>{{ form.account_levels }}级 · {{ form.account_code_lengths.slice(0, form.account_levels).join('-') }}
                  </span>
                </div>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'ledger-basic'" @click="saveLedgerBasic">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form :model="form" label-width="72px" size="small" class="param-form param-form--inline">
                  <el-form-item label="使用单位">
                    <el-input v-model="form.unit_name" placeholder="默认取账套名称" clearable style="width: 200px" />
                  </el-form-item>
                  <el-form-item label="凭证编号">
                    <el-select v-model="form.voucher_no_rule" style="width: 140px">
                      <el-option label="按凭证类型编号" value="by_type" />
                      <el-option label="统一编号" value="unified" />
                    </el-select>
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--dashboard param-section--span-5">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">主页取数<ParamTip content="控制主面板趋势图与统计指标分类" /></h4>
              </header>
              <div class="param-section__body">
                <div class="dashboard-rule-panel">
                  <span class="dashboard-rule-label">当前口径</span>
                  <span class="dashboard-rule-current" :title="dashboardRuleSummary">{{ dashboardRuleSummary }}</span>
                  <el-button type="primary" link size="small" @click="openRulesDialog">配置取数规则</el-button>
                </div>
              </div>
            </section>

            <section class="param-section param-section--switches param-section--span-7">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">业务开关<ParamTip content="凭证流程与辅助核算相关功能" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'ledger-switches'" @click="saveLedgerSwitches">保存</el-button>
              </header>
              <div class="param-section__body">
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
                    <span class="param-switch-card__label">现金流量表<ParamTip content="开启后按「基础资料 → 科目现金流量项目」自动生成现金流量表，录凭证无需选择现金流量" /></span>
                    <el-switch v-model="form.enable_cash_flow" size="small" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <div class="param-switch-card">
                    <span class="param-switch-card__label">外币核算</span>
                    <el-switch v-model="form.enable_foreign_currency" size="small" inline-prompt active-text="开" inactive-text="关" />
                  </div>
                  <div v-if="form.enable_foreign_currency" class="param-switch-card">
                    <span class="param-switch-card__label">本位币</span>
                    <el-input v-model="form.base_currency" style="width: 72px" size="small" placeholder="RMB" />
                  </div>
                </div>
              </div>
            </section>

            <section class="param-section param-section--switches param-section--span-5">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">收付款制证方式<ParamTip :content="paymentModeTip" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'ledger-payment'" @click="saveLedgerPaymentMode">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-radio-group v-model="form.payment_voucher_mode" size="small">
                  <el-radio value="scm">收付款单直接生成</el-radio>
                  <el-radio value="cashier" :disabled="!licenseStore.hasModule('cashier')">通过出纳生成</el-radio>
                </el-radio-group>
              </div>
            </section>

            <BrandSettingsPanel :visible="brandPanelVisible" class="param-section--span-full" />

            <section class="param-section param-section--danger param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">系统初始化<ParamTip danger content="清理凭证或按标准模板重新初始化（危险操作）" /></h4>
              </header>
              <div class="param-section__body">
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
                <h4 class="param-section__title">凭证生成<ParamTip content="出纳录入生成凭证时的默认参数" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'cashier'" @click="saveCashier">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="96px" size="small">
                  <el-form-item label="默认凭证类型">
                    <el-select v-model="cashierForm.default_voucher_type_id" style="width:200px" placeholder="自动选最小编码">
                      <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                    </el-select>
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--danger">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">出纳初始化<ParamTip danger content="清空本账套出纳数据（危险操作，不可恢复）" /></h4>
              </header>
              <div class="param-section__body">
                <ModuleResetPanel
                  module-label="出纳"
                  business-desc="清空出纳单据、期初余额、银行对账单"
                  :reset-fn="() => cashierApi.reset()"
                />
              </div>
            </section>
          </div>
        </el-tab-pane>

        <!-- ── 资产（按注册模块显示） ── -->
        <el-tab-pane v-if="licenseStore.hasModule('asset')" label="资产" name="asset">
          <div class="param-sections">
            <section class="param-section param-section--basic">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">凭证类型<ParamTip content="固定资产生成凭证时使用的凭证类型；未设置则不带类型" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'asset-vt'" @click="saveAsset('asset-vt')">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="96px" size="small">
                  <el-form-item label="折旧凭证">
                    <el-select v-model="assetForm.depr_voucher_type_id" style="width:200px" clearable placeholder="未设置">
                      <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="购买资产凭证">
                    <el-select v-model="assetForm.purchase_voucher_type_id" style="width:200px" clearable placeholder="未设置">
                      <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="处置凭证">
                    <el-select v-model="assetForm.disposal_voucher_type_id" style="width:200px" clearable placeholder="未设置">
                      <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
                    </el-select>
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--basic">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">处置科目<ParamTip :content="'处置凭证的资金与损益科目，未配置时回退 1001 / 6301 / 6711。\n所需科目在账套中不存在时直接报错，不会生成借贷不平的凭证。'" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'asset-disposal'" @click="saveAsset('asset-disposal')">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="96px" size="small">
                  <el-form-item label="收付款科目">
                    <div style="width:220px"><AccountSelect v-model="assetForm.disposal_bank_account" placeholder="收取处置价款的科目" /></div>
                  </el-form-item>
                  <el-form-item label="净收益科目">
                    <div style="width:220px"><AccountSelect v-model="assetForm.disposal_gain_account" placeholder="结转处置净收益" /></div>
                  </el-form-item>
                  <el-form-item label="净损失科目">
                    <div style="width:220px"><AccountSelect v-model="assetForm.disposal_loss_account" placeholder="结转处置净损失" /></div>
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--basic">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">盘点与折旧<ParamTip content="盘盈/盘亏凭证的对应科目：未配置时盘盈回退 6901 以前年度损益调整、盘亏回退 1901 待处理财产损溢" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'asset-inventory'" @click="saveAsset('asset-inventory')">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="96px" size="small">
                  <el-form-item label="盘盈对应科目">
                    <div style="width:220px"><AccountSelect v-model="assetForm.inventory_surplus_account" placeholder="盘盈凭证贷方科目" /></div>
                  </el-form-item>
                  <el-form-item label="盘亏对应科目">
                    <div style="width:220px"><AccountSelect v-model="assetForm.inventory_deficit_account" placeholder="盘亏凭证借方科目" /></div>
                  </el-form-item>
                  <el-form-item>
                    <template #label>折旧起始<ParamTip content="设置后从该期间起须逐月计提折旧并生成凭证；前面月份未生成凭证时不允许计提后续月份。留空则不启用。" /></template>
                    <el-date-picker
                      v-model="assetForm.depr_start_period"
                      type="month"
                      value-format="YYYY-MM"
                      placeholder="留空不启用"
                      clearable
                      style="width:200px"
                    />
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--basic">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">辅助核算对接<ParamTip :content="'资产凭证按资产的部门/使用人自动带出辅助核算项。\n资产部门字典与系统辅助核算档案按「编码优先、名称兜底」自动匹配；仅当目标科目已启用对应辅助核算时才写入，匹配不上则该分录不带辅助项。'" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'asset-aux'" @click="saveAsset('asset-aux')">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="96px" size="small">
                  <el-form-item label="部门类别编码">
                    <el-input v-model="assetForm.aux_dept_category_code" style="width:200px" clearable placeholder="默认 dept" />
                  </el-form-item>
                  <el-form-item label="人员类别编码">
                    <el-input v-model="assetForm.aux_person_category_code" style="width:200px" clearable placeholder="默认 person" />
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <section class="param-section param-section--danger param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">资产初始化<ParamTip danger content="清空本账套固定资产数据（危险操作，不可恢复）" /></h4>
              </header>
              <div class="param-section__body">
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
        </el-tab-pane>

        <!-- ── 供应链（按注册模块显示：进销存 / 生产 / 委外任一） ── -->
        <el-tab-pane
          v-if="licenseStore.hasModule(['scm', 'production', 'outsource'])"
          label="供应链"
          name="supply"
        >
          <div class="param-sections param-sections--grid12">
            <section class="param-section param-section--overrun param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">订单与计划超量控制<ParamTip :content="'仅放宽手工执行上限，不自动增加下推数量、领料建议或 MRP 需求。\n最大执行量＝原订单或计划量 ×（1＋比例）；精确等于上限时允许保存和审核。'" /></h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'scm-overrun'" @click="saveScmSection('scm-overrun')">保存</el-button>
              </header>
              <div class="param-section__body">
                <div class="overrun-grid">
                  <div v-for="c in OVERRUN_CARDS" :key="c.enabled" class="overrun-card" :class="{ 'is-enabled': scmForm[c.enabled] }">
                    <span class="overrun-card__title">{{ c.title }}<ParamTip :content="c.tip" /></span>
                    <el-switch v-model="scmForm[c.enabled]" size="small" inline-prompt active-text="开" inactive-text="关" />
                    <el-input-number v-model="scmForm[c.rate]" size="small" :min="0" :max="1000" :precision="2" :disabled="!scmForm[c.enabled]" :controls="false" class="overrun-card__rate" />
                    <span class="overrun-card__unit">%</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="param-section param-section--basic param-section--span-7">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">库存计价与业务控制</h4>
                <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'scm-business'" @click="saveScmSection('scm-business')">保存</el-button>
              </header>
              <div class="param-section__body">
                <el-form label-width="120px" size="small">
                  <el-form-item>
                    <template #label>计价方式<ParamTip :content="COSTING_TIP" /></template>
                    <el-select v-model="scmForm.costing_method" style="width:200px" placeholder="默认移动加权平均">
                      <el-option v-for="(n,k) in SCM_COSTING" :key="k"
                        :label="COSTING_IMPLEMENTED.includes(k) ? n : n + '（开发中）'"
                        :value="k" :disabled="!COSTING_IMPLEMENTED.includes(k)" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="质量与工序">
                    <div class="param-inline-switches">
                      <span>工序流转校验<ParamTip content="开启后，有工艺路线的工单报工时后道工序累计（合格+不良）不得超过前道已审核完成数；关闭则各工序只受计划数约束" /></span>
                      <el-switch v-model="scmForm.process_flow_strict" size="small" inline-prompt active-text="开" inactive-text="关" />
                      <span>入库须到货检验<ParamTip content="开启后，采购入库(PI) 与委外入库(WI) 审核前必须有挂本入库单号、判定合格且合格数覆盖入库数的已审核到货检验单(IQC)" /></span>
                      <el-switch v-model="scmForm.qc_required_for_receipt" size="small" inline-prompt active-text="开" inactive-text="关" />
                      <span>完工入库须质检<ParamTip content="开启后，完工入库(PF)/委外入库(WI) 审核前必须有一张判定合格的已审核完工检验单(FQC)" /></span>
                      <el-switch v-model="scmForm.qc_required_for_finish" size="small" inline-prompt active-text="开" inactive-text="关" />
                    </div>
                  </el-form-item>
                  <el-form-item label="档案审核">
                    <div class="param-inline-switches">
                      <span>物料 / 往来单位须审核后才能使用<ParamTip content="开启后，未审核的物料、客户、供应商不出现在单据录入的选择器里，保存单据时也会拦截；已有单据不受影响。关闭时审核只作标记。新增、Excel 导入的档案默认未审核，可在档案列表勾选后批量审核" /></span>
                      <el-switch v-model="scmForm.master_audit_required" size="small" inline-prompt active-text="开" inactive-text="关" />
                    </div>
                  </el-form-item>
                  <el-form-item label="可选币别">
                    <el-input v-model="scmForm.currencies" style="width:320px" placeholder="逗号分隔，如 CNY,USD,EUR；留空用默认" />
                  </el-form-item>
                  <el-form-item label="收发类别">
                    <el-input v-model="scmForm.io_categories" style="width:320px" placeholder="逗号分隔，如 领用,报废,盘盈,盘亏" />
                  </el-form-item>
                  <el-form-item label="运输方式">
                    <el-input v-model="scmForm.transport_methods" style="width:320px" placeholder="逗号分隔，如 自提,快递,物流,专车" />
                  </el-form-item>
                </el-form>
              </div>
            </section>

            <div class="param-stack param-section--span-5">
              <section class="param-section param-section--basic">
                <header class="param-section__head">
                  <span class="param-section__marker" aria-hidden="true"></span>
                  <h4 class="param-section__title">负库存控制<ParamTip :content="'按仓库控制出库、调拨、组装、拆卸、盘点等审核时是否允许库存为负。\n勾选的仓库出库或因修改、反审核入库单造成库存为负时仍允许审核；未勾选仓库继续按库存不足拦截。'" /></h4>
                  <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'scm-negative'" @click="saveScmSection('scm-negative')">保存</el-button>
                </header>
                <div class="param-section__body">
                  <el-select
                    v-model="scmForm.negative_stock_warehouses"
                    multiple
                    filterable
                    clearable
                    collapse-tags
                    collapse-tags-tooltip
                    size="small"
                    placeholder="允许负库存的仓库（不选则均不允许）"
                    style="width:100%"
                  >
                    <el-option
                      v-for="warehouse in scmWarehouses"
                      :key="warehouse.code"
                      :label="`${warehouse.code} ${warehouse.name}`"
                      :value="warehouse.code"
                    />
                  </el-select>
                </div>
              </section>

              <section class="param-section param-section--basic">
                <header class="param-section__head">
                  <span class="param-section__marker" aria-hidden="true"></span>
                  <h4 class="param-section__title">物料档案分级<ParamTip content="参照会计科目分级，控制物料档案编码层级；默认 4 级" /></h4>
                  <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'scm-levels'" @click="saveScmSection('scm-levels')">保存</el-button>
                </header>
                <div class="param-section__body param-inline-row">
                  <span class="param-field-label">级次</span>
                  <el-input-number v-model="scmForm.item_levels" size="small" :min="1" :max="10" :controls="false" style="width:52px" />
                  <span class="param-field-label">每级长度</span>
                  <template v-for="(_, index) in Array(scmForm.item_levels || 4)" :key="index">
                    <span v-if="index > 0" class="param-sep">-</span>
                    <el-input-number v-model="scmForm.item_code_lengths[index]" size="small" :min="1" :max="10" :controls="false" style="width: 40px;" />
                  </template>
                </div>
              </section>

              <section class="param-section param-section--basic">
                <header class="param-section__head">
                  <span class="param-section__marker" aria-hidden="true"></span>
                  <h4 class="param-section__title">单据生成凭证对方科目<ParamTip content="已迁到「基础资料 → 供应链档案 → 进销存凭证设置」，并在那里设置往来单位等与总账辅助核算的对应" /></h4>
                  <el-button type="primary" link size="small" class="param-section__head-action" @click="router.push('/base/scm-voucher-setting')">进销存凭证设置 →</el-button>
                </header>
              </section>
            </div>

            <section class="param-section param-section--basic param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">单据单号规则<ParamTip :content="NO_RULE_TIP" /></h4>
              </header>
              <div class="param-section__body">
                <el-table
                  :data="noRuleRows" size="small" border max-height="360" row-key="key"
                  :expand-row-keys="expandedDocRules" class="no-rule-table"
                >
                  <el-table-column type="expand" width="1">
                    <template #default="{ row }">
                      <NoRuleEditor
                        :model-value="docTplOf(row)"
                        :fields="row.isAux ? [] : DOC_FIELDS"
                        :code-label="row.key"
                        :presets="docPresets(row)"
                        @update:model-value="(v: string) => setDocTpl(row, v)"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="单据类型" min-width="150">
                    <template #default="{ row }">{{ row.name }}<span class="no-rule-code">{{ row.key }}</span></template>
                  </el-table-column>
                  <el-table-column label="当前规则" min-width="240">
                    <template #default="{ row }">
                      <span class="no-rule-tpl" :class="{ 'no-rule-tpl--default': !scmForm.doc_no_rules[row.key] }">{{ docTplOf(row) }}</span>
                      <el-tag v-if="!scmForm.doc_no_rules[row.key]" size="small" type="info" class="no-rule-tag">默认</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="示例" min-width="170">
                    <template #default="{ row }"><span class="no-rule-preview">{{ previewDocNo(row) }}</span></template>
                  </el-table-column>
                  <el-table-column label="操作" width="170">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="toggleDocRule(row.key)">{{ expandedDocRules.includes(row.key) ? '收起' : '编辑' }}</el-button>
                      <el-button link type="primary" size="small" :disabled="!isDocRuleDirty(row.key)" :loading="savingSection === `doc-${row.key}`" @click="saveDocRule(row.key)">保存</el-button>
                      <el-button v-if="savedDocNoRules[row.key]" link size="small" @click="restoreDocRule(row.key)">恢复默认</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="no-rule-fallback">
                  <div class="no-rule-fallback__title">
                    兜底规则<ParamTip content="未单独设置规则的业务单据类型使用此规则" />
                    <el-button type="primary" size="small" class="param-section__save" :loading="savingSection === 'scm-doc-fallback'" @click="saveDocFallback">保存</el-button>
                  </div>
                  <NoRuleEditor
                    :model-value="scmForm.doc_no_rule || DEFAULT_DOC_TPL"
                    :code-label="'PO'"
                    :presets="DOC_PRESETS"
                    @update:model-value="(v: string) => (scmForm.doc_no_rule = v)"
                  />
                </div>
              </div>
            </section>

            <section class="param-section param-section--basic param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">基础资料编码规则<ParamTip content="客户、供应商及每种物料属性各自独立；未单独设置的物料属性沿用「原辅材料」规则。新建时自动取号，仍可手改" /></h4>
                <div class="param-section__head-action">
                  <span class="param-field-label">物料编码方式</span>
                  <el-radio-group v-model="scmForm.item_code_mode" size="small">
                    <el-radio value="level">分级编码</el-radio>
                    <el-radio value="rule">按物料属性规则</el-radio>
                  </el-radio-group>
                  <el-button type="primary" size="small" :loading="savingSection === 'scm-item-mode'" @click="saveScmSection('scm-item-mode')">保存</el-button>
                </div>
              </header>
              <div class="param-section__body code-rule-grid">
                <div v-for="r in codeRuleRows" :key="r.key" class="no-rule-fallback">
                  <div class="no-rule-fallback__title">
                    {{ r.name }}编码
                    <span v-if="r.key === 'material'" class="no-rule-code">兜底：未单独设置的物料属性沿用此规则</span>
                    <el-tag v-if="isCodeRuleDirty(r.key)" size="small" type="warning" class="no-rule-tag">未保存</el-tag>
                    <template v-if="r.inherit && (savedCodeRules[r.key] || scmForm.code_rules[r.key])">
                      <el-button link size="small" class="param-section__save" :disabled="!!savingSection" @click="restoreCodeRule(r.key)">恢复沿用</el-button>
                      <el-button type="primary" size="small" :loading="savingSection === `code-${r.key}`" @click="saveCodeRule(r.key)">保存</el-button>
                    </template>
                    <el-button
                      v-else-if="!r.inherit"
                      type="primary" size="small" class="param-section__save"
                      :loading="savingSection === `code-${r.key}`" @click="saveCodeRule(r.key)"
                    >保存</el-button>
                  </div>
                  <div v-if="r.inherit && !scmForm.code_rules[r.key]" class="code-rule-inherit">
                    <span>沿用材料规则</span>
                    <span class="no-rule-tpl no-rule-tpl--default">{{ scmForm.code_rules.material }}</span>
                    <el-button link type="primary" size="small" @click="customizeCodeRule(r.key)">单独设置</el-button>
                  </div>
                  <NoRuleEditor
                    v-else
                    :model-value="scmForm.code_rules[r.key]"
                    :fields="r.isItem ? ITEM_FIELDS : []"
                    :code-label="null"
                    :presets="MASTER_PRESETS[r.key] || ITEM_PRESETS"
                    @update:model-value="(v: string) => (scmForm.code_rules[r.key] = v)"
                  />
                </div>
              </div>
            </section>

            <section class="param-section param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">小数位设置<ParamTip content="按单据类型 / 报表分别设置数量、单价、金额的显示与录入位数（第六份反馈）" /></h4>
              </header>
              <div class="param-section__body">
                <ScmDecimalsPanel />
              </div>
            </section>

            <section class="param-section param-section--danger param-section--span-full">
              <header class="param-section__head">
                <span class="param-section__marker" aria-hidden="true"></span>
                <h4 class="param-section__title">供应链初始化<ParamTip danger content="清空本账套供应链数据（危险操作，不可恢复）" /></h4>
              </header>
              <div class="param-section__body">
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
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onActivated, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/api/request'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useSystemParamsStore } from '@/stores/systemParams'
import ScmDecimalsPanel from '@/components/system/ScmDecimalsPanel.vue'
import { useBaseDataStore } from '@/stores/baseData'
import { useLicenseStore } from '@/stores/license'
import BrandSettingsPanel from '@/components/system/BrandSettingsPanel.vue'
import SystemReinitializePanel from '@/components/system/SystemReinitializePanel.vue'
import ModuleResetPanel from '@/components/system/ModuleResetPanel.vue'
import AccountSelect from '@/components/base/AccountSelect.vue'
import NoRuleEditor from '@/components/system/NoRuleEditor.vue'
import ParamTip from '@/components/system/ParamTip.vue'
import { parseTpl, validateSegs } from '@/utils/noRule'
import type { Account } from '@/types/base'
import { scmApi, ITEM_TYPES, type ScmWarehouse } from '@/api/scm'
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
  /** 收付款制证方式：scm=收付款单直接生成凭证，cashier=通过出纳生成凭证 */
  payment_voucher_mode: 'scm' as 'scm' | 'cashier',
})
/** 已保存的收付款制证方式，用于切换时二次确认 */
const savedPaymentVoucherMode = ref<'scm' | 'cashier'>('scm')

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
  master_audit_required: false,
  qc_required_for_receipt: false,
  process_flow_strict: true,
  currencies: '',
  io_categories: '',
  transport_methods: '',
  doc_no_rule: '',
  doc_no_rules: {} as Record<string, string>,
  // 客户 / 供应商 / 材料 / 成品编码模板（占位符见 NoRuleEditor）
  code_rules: {
    customer: 'KH{SEQ:4}', supplier: 'GYS{SEQ:4}', material: 'WL{SEQ:4}', product: 'WL{SEQ:4}',
  } as Record<string, string>,
  item_code_mode: 'level',
})

// ── 编号规则：单据类型清单（业务单据来自接口，辅助单号内置）与示例渲染 ──
const AUX_NO_ROWS = [
  { key: 'PP', name: '生产计划（工单）', tpl: '{YYYY}{MM}-{CODE}-{SEQ:3}' },
  { key: 'OUT', name: '委外计划（工单）', tpl: '{YYYY}{MM}-{CODE}-{SEQ:3}' },
  { key: 'RT', name: '工艺路线', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'WR', name: '生产报工', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'IQC', name: '来料检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'FQC', name: '成品检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'IPQC', name: '过程检验', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'PC', name: '生产计划变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'POC', name: '采购订单变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'SOC', name: '销售订单变更', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'WC', name: '在制盘点', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'HX', name: '核销单', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'DZ', name: '对账单', tpl: '{CODE}-{YYYY}{MM}-{SEQ:3}' },
  { key: 'BOM', name: 'BOM', tpl: '{CODE}{SEQ:4}' },
]
const scmDocTypeRows = ref<Array<{ key: string; name: string; tpl?: string }>>([])
const noRuleRows = computed(() => [
  ...scmDocTypeRows.value.map(r => ({ ...r, isAux: false })),
  ...AUX_NO_ROWS.map(r => ({ ...r, isAux: true })),
])
const DEFAULT_DOC_TPL = '{YYYY}{MM}-{CODE}-{SEQ:3}'
const DOC_FIELDS = [
  { key: 'partner_code', label: '往来单位编码' }, { key: 'warehouse_code', label: '仓库编码' },
  { key: 'dept_code', label: '部门编码' }, { key: 'biz_person', label: '业务员' },
]
const ITEM_FIELDS = [
  { key: 'category_code', label: '物料大类' }, { key: 'subcategory_code', label: '物料小类' }, { key: 'item_type', label: '物料属性' },
]
const DOC_PRESETS = [
  { name: '年月-类型-流水（默认）', tpl: DEFAULT_DOC_TPL },
  { name: '类型-年月日-流水', tpl: '{CODE}-{YYYY}{MM}{DD}-{SEQ:3}' },
  { name: '类型+年月+流水4位', tpl: '{CODE}{YY}{MM}-{SEQ:4}' },
  { name: '类型-流水（不重置）', tpl: '{CODE}-{SEQ:5}' },
]
const MASTER_PRESETS: Record<string, Array<{ name: string; tpl: string }>> = {
  customer: [{ name: 'KH + 4位流水', tpl: 'KH{SEQ:4}' }, { name: 'KH-年月-流水', tpl: 'KH-{YYYY}{MM}-{SEQ:3}' }],
  supplier: [{ name: 'GYS + 4位流水', tpl: 'GYS{SEQ:4}' }, { name: 'GYS-年月-流水', tpl: 'GYS-{YYYY}{MM}-{SEQ:3}' }],
  material: [{ name: 'WL + 4位流水', tpl: 'WL{SEQ:4}' }, { name: 'CL-大类-流水', tpl: 'CL-{F:category_code}-{SEQ:4}' }],
  product: [{ name: 'CP + 4位流水', tpl: 'CP{SEQ:4}' }, { name: 'CP-大类-流水', tpl: 'CP-{F:category_code}-{SEQ:4}' }],
}
/** 其他物料属性（半成品 / 自定义属性）的通用预设 */
const ITEM_PRESETS = [
  { name: 'BCP + 4位流水', tpl: 'BCP{SEQ:4}' },
  { name: '前缀-大类-流水', tpl: 'BCP-{F:category_code}-{SEQ:4}' },
]
/** 已保存到后端的单据规则 / 主数据编码规则快照：分项保存时与之合并，避免把别的项未保存的修改一并提交 */
const savedDocNoRules = ref<Record<string, string>>({})
const savedCodeRules = ref<Record<string, string>>({})
const expandedDocRules = ref<string[]>([])
function toggleDocRule(key: string) {
  const i = expandedDocRules.value.indexOf(key)
  if (i >= 0) expandedDocRules.value.splice(i, 1)
  else expandedDocRules.value.push(key)
}
/** 该行当前生效的模板：自己的 → 内置默认（辅助单号）→ 兜底规则 */
function docTplOf(row: { key: string; tpl?: string }): string {
  return scmForm.value.doc_no_rules[row.key] || row.tpl || scmForm.value.doc_no_rule || DEFAULT_DOC_TPL
}
function setDocTpl(row: { key: string }, v: string) { scmForm.value.doc_no_rules[row.key] = v }
function docPresets(row: { isAux?: boolean }) {
  return row.isAux ? DOC_PRESETS : [...DOC_PRESETS, { name: '类型-往来单位-年月-流水', tpl: '{CODE}-{F:partner_code}-{YYYY}{MM}-{SEQ:3}' }]
}
/** 用户自定义物料属性（scm:item_types，与物料档案 / 物料属性页同一口径） */
const customItemTypes = ref<Record<string, string>>({})
/** 物料属性 → 编码规则键：0 原辅材料=material（兜底），9 成品=product，其余 item:<键> */
function itemRuleKey(type: string) {
  return type === '0' ? 'material' : type === '9' ? 'product' : `item:${type}`
}
/** 编码规则卡片：客户、供应商 + 按物料属性动态生成；inherit=未单独设置时沿用材料规则 */
const codeRuleRows = computed(() => [
  { key: 'customer', name: '客户', isItem: false, inherit: false },
  { key: 'supplier', name: '供应商', isItem: false, inherit: false },
  ...Object.entries({ ...ITEM_TYPES, ...customItemTypes.value })
    .sort(([a], [b]) => (Number(a) - Number(b)) || a.localeCompare(b))
    .map(([type, name]) => {
      const key = itemRuleKey(type)
      return { key, name, isItem: true, inherit: key.startsWith('item:') }
    }),
])
function renderNoTpl(tpl: string, code: string): string {
  const now = new Date()
  let rule = (tpl || '').trim() || DEFAULT_DOC_TPL
  if (!/\{SEQ(:\d+)?\}/.test(rule)) rule += '-{SEQ:3}'
  const yyyy = String(now.getFullYear())
  return rule.replace(/\{YYYY\}/g, yyyy).replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, String(now.getMonth() + 1).padStart(2, '0'))
    .replace(/\{DD\}/g, String(now.getDate()).padStart(2, '0'))
    .replace(/\{CODE\}/g, code)
    .replace(/\{F:[a-z_]+(?::\d+)?\}/g, '*')
    .replace(/\{SEQ(?::(\d+))?\}/, (_m, n) => '1'.padStart(Math.min(10, Math.max(1, Number(n) || 3)), '0'))
}
function previewDocNo(row: { key: string; tpl?: string }): string {
  return renderNoTpl(docTplOf(row), row.key)
}
async function loadScmDocTypes() {
  try {
    const r = await scmApi.getDocTypes()
    if (r.code === 0) scmDocTypeRows.value = (r.data as any[]).map(t => ({ key: t.code, name: t.name }))
  } catch { /* 取不到则只显示辅助单号 */ }
}
const scmWarehouses = ref<ScmWarehouse[]>([])
const SCM_COSTING: Record<string, string> = { moving_avg: '移动加权平均', month_avg: '全月平均', fifo: '先进先出', lifo: '后进先出', specified: '指定成本' }
// 已实现的计价方式（其余在参数页禁选、过账时拦截）
const COSTING_IMPLEMENTED = ['moving_avg', 'fifo', 'lifo', 'specified', 'month_avg']

// ── 说明气泡文案（原页面上的大段说明文字统一收进 ParamTip） ──
const COSTING_TIP = [
  '移动加权平均：出库取当前均价。',
  '先进先出 / 后进先出：按入库批次形成成本层逐层扣减。',
  '指定成本（个别计价）：出库行指定批次即取该批次的入库成本，未指定批次按先进先出。',
  '全月平均：期内出库按当前均价暂估，月末在「库存报表 → 全月平均成本计算」统一重算。',
  '切换方式时已有结存自动补为「期初层」；成本层可在「库存报表 → 库存成本层」查看。',
].join('\n')
const NO_RULE_TIP = [
  '每种单据可独立设置，未设置的使用表下方的「兜底规则」。',
  '点击「编辑」→ 添加固定文字、日期、业务字段、流水号，拖动方块调整顺序，下方实时显示示例。',
  '流水号随日期段自动重置（含日→每天、含月→每月、仅年→每年、无日期→连续）。',
].join('\n')
type OverrunEnabledKey = 'sales_over_delivery_enabled' | 'purchase_over_receipt_enabled' | 'production_overrun_enabled' | 'outsource_overrun_enabled'
type OverrunRateKey = 'sales_over_delivery_rate' | 'purchase_over_receipt_rate' | 'production_overrun_rate' | 'outsource_overrun_rate'
const OVERRUN_CARDS: Array<{ title: string; tip: string; enabled: OverrunEnabledKey; rate: OverrunRateKey }> = [
  { title: '销售超发', tip: '销售订单下推销售出库；审核销售退货后恢复额度。', enabled: 'sales_over_delivery_enabled', rate: 'sales_over_delivery_rate' },
  { title: '采购超收', tip: '采购订单下推采购入库；审核采购退货后恢复额度。', enabled: 'purchase_over_receipt_enabled', rate: 'purchase_over_receipt_rate' },
  { title: '生产计划超量', tip: '自制生产：约束领料、补料与完工入库；审核退料后恢复额度。', enabled: 'production_overrun_enabled', rate: 'production_overrun_rate' },
  { title: '委外计划超量', tip: '委外加工：约束委外发料与委外入库，和自制生产参数独立。', enabled: 'outsource_overrun_enabled', rate: 'outsource_overrun_rate' },
]

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
  if (v === 'supply') fetchScmWarehouses()
})
const route = useRoute()
const router = useRouter()
const baseDataStore = useBaseDataStore()
const licenseStore = useLicenseStore()

const accountOptions = computed<Account[]>(() => baseDataStore.accounts)

const paymentModeTip = computed(() =>
  '收付款单审核都会写出纳日记账；凭证只能由所选一侧生成，另一侧一律拦截，避免同一笔收付款重复记账。' +
  (licenseStore.hasModule('cashier') ? '' : '\n未注册出纳模块，只能由收付款单生成凭证。'))

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
    form.value.payment_voucher_mode = 'scm'
    savedPaymentVoucherMode.value = 'scm'
    for (const p of params) {
      if (p.param_key === 'payment_voucher_mode') {
        form.value.payment_voucher_mode = p.param_value === 'cashier' ? 'cashier' : 'scm'
        savedPaymentVoucherMode.value = form.value.payment_voucher_mode
      } else if (p.param_key === 'unit_name') {
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
      } else if (p.param_key === 'scm:doc_no_rules') {
        try { scmForm.value.doc_no_rules = JSON.parse(p.param_value || '{}') || {} } catch { scmForm.value.doc_no_rules = {} }
      } else if (p.param_key === 'scm:code_rules') {
        try {
          const saved = JSON.parse(p.param_value || '{}') || {}
          // 固定四类 + 已保存的物料属性单独规则 item:<键>
          const keys = new Set([...Object.keys(scmForm.value.code_rules), ...Object.keys(saved).filter(k => k.startsWith('item:'))])
          for (const k of keys) {
            const v = saved[k]
            if (typeof v === 'string' && v.trim()) scmForm.value.code_rules[k] = v.trim()
            else if (v && typeof v === 'object') {   // 旧结构 prefix/sep/seqLen/withDate → 模板
              const sep = v.sep || ''
              scmForm.value.code_rules[k] = `${v.prefix ?? ''}${sep}${v.withDate ? `{YYYY}{MM}${sep}` : ''}{SEQ:${Number(v.seqLen) || 4}}`
            }
          }
        } catch { /* 保持默认 */ }
      } else if (p.param_key === 'scm:item_types') {
        try {
          const parsed = JSON.parse(p.param_value || '{}')
          customItemTypes.value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch { customItemTypes.value = {} }
      } else if (p.param_key === 'scm:item_code_mode') {
        scmForm.value.item_code_mode = p.param_value === 'rule' ? 'rule' : 'level'
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
      } else if (p.param_key === 'scm:master_audit_required') {
        scmForm.value.master_audit_required = p.param_value === '1'
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
      }
    }
    savedDocNoRules.value = { ...scmForm.value.doc_no_rules }
    savedCodeRules.value = { ...scmForm.value.code_rules }
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

// ── 分项保存：每个参数分区 / 每条编号规则独立保存，只提交本项的键（后端按键 upsert） ──
type ParamPair = { param_key: string; param_value: string }
/** 正在保存的分项键，用于按钮 loading，并防止重复点击 */
const savingSection = ref('')

async function runSave(section: string, label: string, fn: () => Promise<unknown>) {
  if (savingSection.value) return
  savingSection.value = section
  try {
    await fn()
    showSuccess(`${label}已保存`)
  } catch (error) {
    showOperationError(`保存${label}`, error)
  } finally {
    savingSection.value = ''
  }
}

async function putSystemParams(params: ParamPair[]) {
  await request.put('/system/params', { params })
  await useSystemParamsStore().load(true)
}

function saveLedgerBasic() {
  return runSave('ledger-basic', '基本信息', () => putSystemParams([
    { param_key: 'unit_name', param_value: form.value.unit_name },
    { param_key: 'voucher_no_rule', param_value: form.value.voucher_no_rule },
  ]))
}

function saveLedgerSwitches() {
  return runSave('ledger-switches', '业务开关', () => putSystemParams([
    { param_key: 'require_audit', param_value: String(form.value.require_audit) },
    { param_key: 'direct_print', param_value: String(form.value.direct_print) },
    { param_key: 'voucher_time_control', param_value: String(form.value.voucher_time_control) },
    { param_key: 'enable_cash_flow', param_value: String(form.value.enable_cash_flow) },
    { param_key: 'enable_foreign_currency', param_value: String(form.value.enable_foreign_currency) },
    { param_key: 'base_currency', param_value: form.value.base_currency || 'RMB' },
  ]))
}

async function saveLedgerPaymentMode() {
  const mode = form.value.payment_voucher_mode
  if (mode !== savedPaymentVoucherMode.value) {
    const target = mode === 'cashier' ? '通过出纳生成凭证' : '收付款单直接生成凭证'
    try {
      await ElMessageBox.confirm(
        `收付款制证方式将改为「${target}」。已生成的凭证保持在原来一侧，不会自动迁移；之后只有「${target}」一侧能对收付款制证。确定修改？`,
        '修改收付款制证方式',
        { type: 'warning', confirmButtonText: '确定修改', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  return runSave('ledger-payment', '收付款制证方式', async () => {
    await putSystemParams([{ param_key: 'payment_voucher_mode', param_value: mode }])
    savedPaymentVoucherMode.value = mode
  })
}

function saveCashier() {
  return runSave('cashier', '出纳凭证参数', () => request.put('/cashier/params', {
    params: [{ param_key: 'cashier:default_voucher_type_id', param_value: cashierForm.value.default_voucher_type_id }],
  }))
}

type AssetFormKey = keyof typeof assetForm.value
const ASSET_SECTIONS: Record<string, { label: string; keys: AssetFormKey[] }> = {
  'asset-vt': { label: '资产凭证类型', keys: ['depr_voucher_type_id', 'purchase_voucher_type_id', 'disposal_voucher_type_id'] },
  'asset-disposal': { label: '处置科目', keys: ['disposal_bank_account', 'disposal_gain_account', 'disposal_loss_account'] },
  'asset-inventory': { label: '盘点与折旧', keys: ['inventory_surplus_account', 'inventory_deficit_account', 'depr_start_period'] },
  'asset-aux': { label: '辅助核算对接', keys: ['aux_dept_category_code', 'aux_person_category_code'] },
}
function saveAsset(section: string) {
  const s = ASSET_SECTIONS[section]
  return runSave(section, s.label, () => request.put('/asset/params', {
    params: s.keys.map(k => ({ param_key: `asset:${k}`, param_value: assetForm.value[k] || '' })),
  }))
}

const rateParam = (v: number) => String(Math.max(0, Number(v) || 0))
const flagParam = (v: boolean) => (v ? '1' : '0')
/** 供应链各分区要提交的参数 */
const SCM_SECTIONS: Record<string, { label: string; params: () => ParamPair[] }> = {
  'scm-overrun': {
    label: '超量控制',
    params: () => OVERRUN_CARDS.flatMap(c => [
      { param_key: `scm:${c.enabled}`, param_value: flagParam(scmForm.value[c.enabled]) },
      { param_key: `scm:${c.rate}`, param_value: rateParam(scmForm.value[c.rate]) },
    ]),
  },
  'scm-business': {
    label: '库存计价与业务控制',
    params: () => [
      { param_key: 'scm:costing_method', param_value: scmForm.value.costing_method || '' },
      { param_key: 'scm:process_flow_strict', param_value: flagParam(scmForm.value.process_flow_strict) },
      { param_key: 'scm:qc_required_for_receipt', param_value: flagParam(scmForm.value.qc_required_for_receipt) },
      { param_key: 'scm:qc_required_for_finish', param_value: flagParam(scmForm.value.qc_required_for_finish) },
      { param_key: 'scm:master_audit_required', param_value: flagParam(scmForm.value.master_audit_required) },
      { param_key: 'scm:currencies', param_value: scmForm.value.currencies || '' },
      { param_key: 'scm:io_categories', param_value: scmForm.value.io_categories || '' },
      { param_key: 'scm:transport_methods', param_value: scmForm.value.transport_methods || '' },
    ],
  },
  'scm-negative': {
    label: '负库存控制',
    params: () => [{ param_key: 'scm:negative_stock_warehouses', param_value: JSON.stringify(scmForm.value.negative_stock_warehouses || []) }],
  },
  'scm-levels': {
    label: '物料档案分级',
    params: () => [
      { param_key: 'scm:item_levels', param_value: String(scmForm.value.item_levels || 4) },
      { param_key: 'scm:item_code_lengths', param_value: scmForm.value.item_code_lengths.slice(0, scmForm.value.item_levels || 4).join(',') },
    ],
  },
  'scm-item-mode': {
    label: '物料编码方式',
    params: () => [{ param_key: 'scm:item_code_mode', param_value: scmForm.value.item_code_mode === 'rule' ? 'rule' : 'level' }],
  },
}
function putScmParams(params: ParamPair[]) {
  return request.put('/scm/params', { params })
}
function saveScmSection(section: string) {
  const s = SCM_SECTIONS[section]
  return runSave(section, s.label, () => putScmParams(s.params()))
}

/** 前端预校验模板，返回错误信息或空串 */
function checkTpl(label: string, tpl: string): string {
  const err = validateSegs(parseTpl(tpl))
  return err ? `${label}：${err}` : ''
}

function isDocRuleDirty(key: string) {
  return String(scmForm.value.doc_no_rules[key] || '').trim() !== (savedDocNoRules.value[key] || '')
}
/** 单条单据规则保存：与已保存快照合并后整体写回 scm:doc_no_rules */
function saveDocRule(key: string) {
  const name = noRuleRows.value.find(r => r.key === key)?.name || key
  const tpl = String(scmForm.value.doc_no_rules[key] || '').trim()
  const err = tpl ? checkTpl(`${name}单号规则`, tpl) : ''
  if (err) return showOperationError('保存单号规则', new Error(err))
  const merged = { ...savedDocNoRules.value }
  if (tpl) merged[key] = tpl
  else delete merged[key]
  return runSave(`doc-${key}`, `${name}单号规则`, async () => {
    await putScmParams([{ param_key: 'scm:doc_no_rules', param_value: JSON.stringify(merged) }])
    savedDocNoRules.value = merged
  })
}
function restoreDocRule(key: string) {
  delete scmForm.value.doc_no_rules[key]
  return saveDocRule(key)
}

function saveDocFallback() {
  const tpl = scmForm.value.doc_no_rule || DEFAULT_DOC_TPL
  const err = checkTpl('兜底规则', tpl)
  if (err) return showOperationError('保存兜底规则', new Error(err))
  return runSave('scm-doc-fallback', '兜底规则', () => putScmParams([
    { param_key: 'scm:doc_no_rule', param_value: tpl === DEFAULT_DOC_TPL ? '' : tpl },
  ]))
}

function isCodeRuleDirty(key: string) {
  return (scmForm.value.code_rules[key] || '') !== (savedCodeRules.value[key] || '')
}
/** 单类主数据编码规则保存：与已保存快照合并后整体写回 scm:code_rules；物料属性规则为空=沿用材料规则，删掉该键 */
function saveCodeRule(key: string) {
  const name = codeRuleRows.value.find(r => r.key === key)?.name || key
  const tpl = String(scmForm.value.code_rules[key] || '').trim()
  const inherit = key.startsWith('item:')
  if (tpl || !inherit) {
    const err = checkTpl(`${name}编码`, tpl)
    if (err) return showOperationError('保存编码规则', new Error(err))
  }
  const merged = { ...savedCodeRules.value }
  if (tpl || !inherit) merged[key] = tpl
  else delete merged[key]
  return runSave(`code-${key}`, `${name}编码规则`, async () => {
    await putScmParams([{ param_key: 'scm:code_rules', param_value: JSON.stringify(merged) }])
    savedCodeRules.value = merged
  })
}

/** 物料属性单独设置：以材料规则为初值，保存后才生效 */
function customizeCodeRule(key: string) {
  scmForm.value.code_rules[key] = scmForm.value.code_rules.material || 'WL{SEQ:4}'
}
/** 恢复沿用材料规则：清空该属性规则并立即保存 */
function restoreCodeRule(key: string) {
  delete scmForm.value.code_rules[key]
  return saveCodeRule(key)
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
  loadScmDocTypes()
  if (route.query.openDashboardRules === '1') {
    await router.replace('/system/dashboard-rules')
  }
})
</script>

<style scoped>
.no-rule-code { margin-left: 6px; font-size: 11px; color: var(--el-text-color-placeholder); }
.no-rule-table :deep(.el-table__expand-column .cell) { display: none; }
.no-rule-table :deep(.el-table__expanded-cell) { padding: 4px 12px 8px; background: var(--el-fill-color-lighter); }
.no-rule-tpl { font-family: Consolas, monospace; font-size: 12px; }
.no-rule-tpl--default { color: var(--el-text-color-secondary); }
.no-rule-tag { margin-left: 6px; }
.no-rule-fallback { margin-top: 6px; padding: 4px 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.no-rule-fallback__title { display: flex; align-items: center; font-size: 12px; font-weight: 600; }
.no-rule-preview { font-family: Consolas, monospace; color: var(--el-color-primary); }

.code-rule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
  gap: 6px;
}
.code-rule-grid .no-rule-fallback { margin-top: 0; }
.code-rule-inherit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.param-page {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.param-tabs-wrap {
  position: relative;
}

/* 分项保存按钮：贴在各分区标题行最右侧 */
.param-section__save {
  flex-shrink: 0;
  margin-left: auto;
}
.param-meta-inline + .param-section__save {
  margin-left: 8px;
}

.param-field-label {
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.param-inline-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.param-sep {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.param-inline-switches {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.param-inline-switches > span {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
}
.param-inline-switches > span:first-child { margin-left: 0; }

/* ── 超量控制：每张卡一行（名称 · 开关 · 比例） ── */
.overrun-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.overrun-card {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-default, #d6e5e6);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  transition: border-color 140ms ease, background-color 140ms ease;
}

.overrun-card.is-enabled {
  border-color: var(--mint-300, #66e0cb);
  background: var(--mint-50, #e8fbf7);
}

.overrun-card__title {
  display: inline-flex;
  align-items: center;
  margin-right: auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong, #0c2a2e);
  white-space: nowrap;
}

.overrun-card__rate { width: 64px; }
.overrun-card__unit { font-size: 12px; color: var(--el-text-color-secondary); }

/* ── 页签条 ── */
.param-tabs :deep(.el-tabs__header) {
  margin: 0 0 6px;
  padding: 2px;
  padding-right: 72px;
  background: var(--surface-sunken, #ecf6f4);
  border-bottom: none;
  border-radius: 8px;
}
.param-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}
.param-tabs :deep(.el-tabs__item) {
  height: 28px;
  margin-right: 2px;
  padding: 0 14px;
  border-radius: 6px;
  color: var(--text-muted, #62858a);
  font-size: var(--cw-text-sm);
  font-weight: 500;
  line-height: 28px;
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
  font-weight: 700;
}
.param-tabs :deep(.el-tabs__active-bar) {
  display: none;
}
.param-tabs :deep(.el-tabs__content) {
  overflow: visible;
  padding: 0;
}

/* ── 分区网格 ── */
.param-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 6px;
  align-items: start;
}

.param-sections--grid12 {
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-items: stretch;
}

.param-section--span-full { grid-column: 1 / -1; }
.param-section--span-7 { grid-column: span 7; }
.param-section--span-5 { grid-column: span 5; }

.param-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.param-section {
  overflow: hidden;
  border: 1px solid var(--border-default, #d6e5e6);
  border-radius: 8px;
  background: var(--surface-card, #fff);
}

.param-section--overrun {
  border-color: var(--mint-200, #9feddf);
}

.param-section--basic,
.param-section--dashboard,
.param-section--switches,
.param-section--overrun {
  --param-accent: var(--mint-500, #12C7AE);
}

.param-section--danger {
  --param-accent: var(--danger, #f2545b);
}

.param-section__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-subtle, #e9f2f2);
}

.param-section__head:last-child {
  border-bottom: none;
}

.param-section__marker {
  flex-shrink: 0;
  width: 3px;
  height: 14px;
  border-radius: 4px;
  background: var(--param-accent);
}

.param-section__title {
  display: inline-flex;
  align-items: center;
  margin: 0;
  color: var(--text-strong, #0c2a2e);
  font-size: var(--cw-text-sm);
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}

.param-section__head-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.param-section__body {
  padding: 6px 10px 8px;
}

.param-section :deep(.el-form-item) {
  margin-bottom: 4px;
}

.param-section :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.param-section :deep(.el-form-item__label) {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 12px;
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
  gap: 4px 16px;
}

.param-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.param-meta-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.param-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border: 1px solid var(--mint-100, #cff6ef);
  border-radius: 6px;
  background: var(--mint-50, #e8fbf7);
  color: var(--mint-800, #0A8576);
  font-size: 12px;
  white-space: nowrap;
}

.param-meta-chip label {
  font-size: 12px;
  color: var(--mint-600, #0e9f8b);
}

.dashboard-rule-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dashboard-rule-label {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  flex-shrink: 0;
}

.dashboard-rule-current {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--cw-text-sm);
  font-weight: 600;
  color: var(--param-accent);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.param-switch-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.param-switch-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--border-subtle, #e9f2f2);
  border-radius: 6px;
  background: var(--surface-sunken, #ecf6f4);
}

.param-switch-card__label {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
  white-space: nowrap;
}

@media (max-width: 1280px) {
  .overrun-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1100px) {
  .param-section--span-7,
  .param-section--span-5 {
    grid-column: 1 / -1;
  }

  .param-meta-inline {
    display: none;
  }
}

@media (max-width: 640px) {
  .param-sections {
    grid-template-columns: 1fr;
  }

  .overrun-grid {
    grid-template-columns: 1fr;
  }

  .code-rule-grid {
    grid-template-columns: 1fr;
  }
}
</style>
