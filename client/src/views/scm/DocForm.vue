<template>
  <div class="page doc-form-page">
    <!-- 顶部工具栏 -->
    <div class="doc-form-header">
      <div class="doc-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="doc-form-header__sep">/</span>
        <span class="doc-form-header__title">{{ pageTitle }}</span>
        <el-tag v-if="form.doc_no" size="small" style="margin-left:8px">{{ form.doc_no }}</el-tag>
        <el-tag v-if="form.status" :type="form.status === 'audited' ? 'success' : 'info'" size="small" style="margin-left:4px">
          {{ form.status === 'audited' ? '已审核' : '草稿' }}
        </el-tag>
        <DocNavPager
          v-if="editId"
          :doc-id="editId || ''"
          :doc-type="form.doc_type"
          :mode="isView ? 'view' : 'edit'"
          :nav-context="docNavContext"
          :before-navigate="confirmDocNavigation"
          style="margin-left:10px"
        />
        <span v-if="isView && form.maker" class="doc-form-header__meta">制单：{{ form.maker }}</span>
        <span v-if="isView && form.auditor" class="doc-form-header__meta">审核：{{ form.auditor }}</span>
      </div>
      <div class="doc-form-header__right">
        <!-- 选择源单（原明细行工具栏，移到顶部「查询实时库存」左边，节约一行垂直空间） -->
        <template v-if="!isAssembly && !isView && !isPaymentDoc">
          <el-button v-for="opt in visibleSourceOptions" :key="opt.type + opt.detailSource" size="small" type="primary" plain @click="openSourcePicker(opt)">
            <el-icon><Connection /></el-icon>{{ opt.label }}
          </el-button>
        </template>
        <!-- 查询实时库存（原明细行工具栏，移到顶部配置按钮左边） -->
        <el-button v-if="supportsRealtimeStock" size="small" :loading="stockLoading" @click="loadRealtimeStock">
          <el-icon><Goods /></el-icon>查询实时库存
        </el-button>
        <!-- 配置下拉：合并「列设置」+「字段设置」+「方案管理」 -->
        <el-dropdown v-if="showConfigBtn" trigger="click" placement="bottom-end" @command="onConfigCommand">
          <el-button ref="configBtnRef" size="small" plain>
            <el-icon><Setting /></el-icon>配置<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="canColScheme && !isPaymentDoc" command="cols">列设置</el-dropdown-item>
              <el-dropdown-item v-if="canColScheme && hasFieldSettingOpts" command="fields">字段设置</el-dropdown-item>
              <el-dropdown-item command="schemes" divided>方案管理</el-dropdown-item><el-dropdown-item command="fielddefs">自定义字段管理</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <ColumnSettingsDialog v-if="canColScheme && !isPaymentDoc" v-model="colSettingVisible" reset-label="恢复默认（含列宽）" :columns="lineColumnSettings" @update:columns="updateLineColumnSettings" @reset="resetLineColumnSettings" />
        <!-- 字段设置 popover（锚定到配置按钮，trigger=manual 仅由 dropdown command 控制） -->
        <el-popover
          v-if="canColScheme && hasFieldSettingOpts"
          v-model:visible="fieldSettingVisible"
          :virtual-ref="configBtnRef"
          virtual-triggering
          :trigger="('manual' as any)"
          placement="bottom-end"
          :width="240"
        >
          <div class="line-col-setting">
            <template v-if="fieldSettingHeaderOpts.length">
              <div class="line-col-setting__hd"><span>表头字段</span></div>
              <el-checkbox-group v-model="headerFieldVisibleKeys" class="line-col-setting__group">
                <el-checkbox v-for="c in fieldSettingHeaderOpts" :key="c.key" :value="c.key" size="small">{{ c.label }}</el-checkbox>
              </el-checkbox-group>
            </template>
            <template v-if="fieldSettingFooterOpts.length">
              <div class="line-col-setting__hd" style="margin-top:8px"><span>表尾字段</span></div>
              <el-checkbox-group v-model="footerFieldVisibleKeys" class="line-col-setting__group">
                <el-checkbox v-for="c in fieldSettingFooterOpts" :key="c.key" :value="c.key" size="small">{{ c.label }}</el-checkbox>
              </el-checkbox-group>
            </template>
          </div>
        </el-popover>
        <!-- 另存：编辑 / 查看都可导出整张单据（第六份反馈：单据类编辑、查看都要有另存） -->
        <SaveAsButton doc :title="saveAsTitle" :file-name="saveAsTitle" :footer="saveAsFooter" />
        <template v-if="!isView">
          <el-button size="small" @click="goBack">取消</el-button>
          <el-button type="primary" size="small" :loading="saving" @click="handleSave()">保存</el-button>
          <el-button type="success" size="small" :loading="saving" @click="handleSave(true)">保存并审核</el-button>
        </template>
        <template v-else>
          <el-button v-if="form.status === 'draft'" size="small" type="success" :loading="auditing"
            :disabled="assemblyDraftMrp" :title="assemblyDraftMrp ? '请先审核或删除关联的草稿MRP计算单' : '审核'" @click="handleAuditDoc">审核</el-button>
          <el-button v-if="form.status === 'audited'" size="small" type="warning" plain :loading="auditing"
            :disabled="!!activeMrpTarget" :title="activeMrpTarget ? `已进入 MRP 计算单 ${activeMrpTarget.doc_no}，不能反审核` : '反审核'"
            @click="handleUnauditDoc">反审核</el-button>
          <el-tag v-if="form.status === 'audited' && !form.voucher_id && Number(form.external_voucher)" type="info" size="small" effect="plain" title="从润衡等原系统导入的历史单据，原系统已制证">原系统已制证</el-tag>
          <el-button v-else-if="form.status === 'audited' && !form.voucher_id && docGeneratesVoucher(form.doc_type) && !paymentVoucherByCashier(form.doc_type, systemParams.paymentVoucherMode)" size="small" type="warning" plain @click="handleGenVoucher">生成凭证</el-button>
          <el-tag v-else-if="form.status === 'audited' && !form.voucher_id && paymentVoucherByCashier(form.doc_type, systemParams.paymentVoucherMode)" type="info" size="small" effect="plain" title="系统参数「收付款制证方式」为通过出纳生成凭证">凭证请在出纳日记账生成</el-tag>
          <!-- 已审核采购 / 销售订单：走变更单增减数量、改价（客户反馈：订单没有变更功能） -->
          <el-button v-if="form.status === 'audited' && (form.doc_type === 'PO' || form.doc_type === 'SOa') && editId" size="small" type="primary" plain
            @click="router.push({ name: 'ScmOrderChangeNew', params: { docId: editId } })">变更</el-button>
          <el-button v-if="form.status === 'audited' && (form.doc_type === 'PO' || form.doc_type === 'SOa') && editId" size="small"
            @click="router.push({ name: 'ScmOrderChangeList', query: { doc_type: form.doc_type, doc_id: editId } })">变更记录</el-button>
          <el-button v-if="form.voucher_id && docVoucher" size="small" type="success" plain :title="`${docVoucher.year}年${docVoucher.period}期，点击查看凭证`"
            @click="router.push({ path: '/voucher/query', query: { voucher_id: docVoucher.id, year: docVoucher.year, period: docVoucher.period, keyword: form.doc_no } })">凭证 {{ docVoucherLabel }}</el-button>
          <el-button v-if="form.status === 'draft' && !isLocked" size="small" type="primary" @click="goEdit">编辑</el-button>
          <el-button size="small" @click="goPrint"><el-icon><Printer /></el-icon>打印</el-button>
          <el-button v-if="isView && isCostInbound && form.status === 'audited'" size="small" type="primary" plain @click="goCost">成本明细</el-button>
          <el-button v-if="form.status === 'audited' || form.source_doc_id" size="small" plain @click="goDownstream">上下游</el-button>
          <el-tag v-if="detailPushProgress === 'full'" type="success" size="small" effect="plain" style="margin-right:4px">已下推完成</el-tag>
          <el-tag v-else-if="detailPushProgress === 'part'" type="warning" size="small" effect="plain" style="margin-right:4px">部分下推</el-tag>
          <el-tag v-else-if="isLocked" type="warning" size="small" effect="plain" style="margin-right:4px">🔒 已下推锁定</el-tag>
          <ScmPushMenu v-if="editId && form.doc_type === 'SOa' && form.status === 'audited'"
            source-kind="sales_order" :source-id="String(editId)" />
          <ScmPushMenu v-if="editId && isAssembly && form.status === 'draft'"
            source-kind="assembly" :source-id="String(editId)" />
          <el-button v-if="canGenPO" type="info" size="small" plain :loading="genningDoc === 'PQ'" @click="handleGenPurchaseDocs('PQ')">
            生成询价单
          </el-button>
          <el-button v-if="canGenPO" type="primary" size="small" :loading="genningDownstream" @click="handleGenDownstream">
            预览并生成下游单据
          </el-button>
          <el-button v-if="canPush" type="success" size="small" @click="handlePush">
            {{ downstreamActionLabel(form.doc_type, detailPushProgress) }}
          </el-button>
          <el-button v-if="form.status === 'draft' && !isLocked" size="small" type="danger" plain @click="handleDeleteDoc">删除</el-button>
        </template>
      </div>
    </div>

    <!-- 单据头 -->
    <div v-if="formRenderError" style="padding: 20px; color: red;">
      <h3>表单渲染遇到错误</h3>
      <p>{{ formRenderError.message || String(formRenderError) }}</p>
    </div>
    <div v-else class="doc-form-body">
      <el-form :model="form" label-width="80px" size="small" :disabled="isView">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="日期" required>
              <el-date-picker v-model="form.doc_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :disabled-date="disableDocDate" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="单据号">
              <el-input :model-value="form.doc_no" disabled />
            </el-form-item>
          </el-col>
          <el-col v-if="isPlanControlledDoc" :span="6">
            <el-form-item label="来源工单" required>
              <el-select v-model="form.plan_id" filterable clearable style="width:100%" placeholder="选择已审核工单"
                :disabled="isView || !!editId" @change="onPlanChange">
                <el-option v-for="plan in availableProductionPlans" :key="plan.id"
                  :label="`${plan.code} ${plan.item_name || plan.item_code || ''}`" :value="plan.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('warehouse')" :span="6">
            <el-form-item :label="isTransfer ? '调出仓' : '仓库'" :required="isTransfer || isShipment || isPurchaseReturn">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.warehouse_code" clearable filterable style="flex:1" @change="onWarehouseManualChange">
                  <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" :disabled="(w as any).enabled === 0" />
                </el-select>
                <el-button v-if="!isView" size="small" title="新增仓库" @click="warehouseDlgVisible = true"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="(col('tax_rate') || isPurchaseOrSale) && !headerHidden.has('tax_rate')" :span="6">
            <el-form-item label="税率%">
              <el-input-number v-model="form.tax_rate" :min="0" :max="100" :precision="1" :controls="false" style="width:100%" placeholder="整单默认税率，明细行可覆盖" @change="onHeaderTaxChange" />
            </el-form-item>
          </el-col>
          <el-col v-if="isAssembly" :span="6">
            <el-form-item label="加工方式">
              <el-select v-model="form.process_mode" style="width:100%" @change="onProcessModeChange">
                <el-option value="" label="自行组装" />
                <el-option value="entrust" label="委托加工（加工费计成本，挂应付）" />
                <el-option value="contract" label="受托加工（加工费挂应收，不计成本）" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('partner') || auxReqSources.has('partner') || asNeedsPartner" :span="6">
            <el-form-item :label="paymentPartnerLabel" :required="partnerRequired || isPaymentDoc || auxReqSources.has('partner')" :error="auxFieldError('partner')">
              <div style="display:flex;gap:4px;width:100%">
                <el-autocomplete
                  v-model="partnerSearch"
                  :fetch-suggestions="queryPartners"
                  :disabled="isView"
                  placeholder="编号/名称模糊搜索"
                  value-key="label"
                  clearable
                  style="flex:1"
                  @select="onPartnerSelect"
                  @clear="onPartnerClear"
                />
                <el-button v-if="!isView" size="small" :title="`新增${paymentPartnerLabel}`" @click="partnerDlgVisible = true"><el-icon><Plus /></el-icon></el-button>
              </div>
              <el-tag v-if="priceMode === 'sale' && currentPartner" size="small" type="success" effect="plain" style="margin-top:4px">
                {{ Number(currentPartner.price_level) || 1 }} 级售价
              </el-tag>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('biz_person') || (isPurchaseOrSale && !headerHidden.has('biz_person')) || auxReqSources.has('person')" :span="6">
            <el-form-item label="业务员" :required="auxReqSources.has('person')" :error="auxFieldError('person')">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.biz_person" filterable allow-create clearable default-first-option placeholder="选择/输入业务员" style="flex:1">
                  <el-option v-for="p in persons" :key="p.id" :value="p.name" :label="p.code ? `${p.code} ${p.name}` : p.name" />
                </el-select>
                <el-button size="small" title="新增人员到辅助核算" @click="openAuxDialog('person')"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('dept') || auxReqSources.has('dept')" :span="6">
            <el-form-item label="部门" :required="auxReqSources.has('dept')" :error="auxFieldError('dept')">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.dept_code" filterable allow-create clearable default-first-option placeholder="选择/输入部门" style="flex:1">
                  <el-option v-for="d in depts" :key="d.id" :value="d.code" :label="d.code ? `${d.code} ${d.name}` : d.name" />
                </el-select>
                <el-button size="small" title="新增部门到辅助核算" @click="openAuxDialog('dept')"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="showIoCategory" :span="6">
            <el-form-item label="收发类别">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.io_category" filterable allow-create clearable default-first-option :placeholder="form.doc_type === 'OO' ? '如：生产领用 / 盘亏 / 报废' : form.doc_type === 'OI' ? '如：成品入库 / 盘盈' : '选择/输入收发类别'" style="flex:1">
                  <el-option v-for="c in ioCategoryChoices" :key="c" :value="c" :label="c" />
                </el-select>
                <el-button v-if="!isView" size="small" title="新增收发类别到字典" @click="quickDict('io')"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="showTransport" :span="6">
            <el-form-item label="运输方式">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.transport_method" filterable allow-create clearable default-first-option placeholder="选择/输入运输方式" style="flex:1">
                  <el-option v-for="m in transportOptions" :key="m" :value="m" :label="m" />
                </el-select>
                <el-button v-if="!isView" size="small" title="新增运输方式到字典" @click="quickDict('transport')"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('contract')" :span="6">
            <el-form-item label="合同号">
              <el-input v-model="form.contract_no" placeholder="可留空" />
            </el-form-item>
          </el-col>
          <el-col v-if="isSalesOrderOrDispatch" :span="6">
            <el-form-item label="对方订单号">
              <el-input v-model="form.field_values.external_order_no" placeholder="可留空" />
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('payment') && !isPaymentDoc" :span="6">
            <el-form-item :label="isReceivePayment ? '收款方式' : '付款方式'">
              <el-select v-model="form.payment_type" clearable style="width:100%">
                <el-option label="现金" value="cash" />
                <el-option label="转账" value="transfer" />
                <el-option v-if="!isPaymentDoc || form.payment_type === 'credit'" label="挂账（历史）" value="credit" :disabled="isPaymentDoc" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('settle_account')" :span="6">
            <el-form-item v-if="isPaymentDoc" :label="isReceivePayment ? '收款账户' : '付款账户'" required>
              <el-select v-model="form.settle_account" filterable clearable placeholder="选择现金/银行账户" style="width:100%" @change="onPaymentAccountChange">
                <el-option v-for="a in cashierAccounts" :key="a.code" :value="a.code" :label="`${a.code} ${a.name}`" />
              </el-select>
            </el-form-item>
            <el-form-item v-else label="结算方式">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.settle_account" filterable allow-create clearable default-first-option placeholder="选择/输入结算方式" style="flex:1">
                  <el-option v-for="s in settleTypes" :key="s.id || s.code || s.name" :value="s.name" :label="s.name" />
                </el-select>
                <el-button v-if="!isView" size="small" title="新增结算方式" @click="quickAddSettle"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col v-if="showCurrency" :span="6">
            <el-form-item label="币别">
              <div style="display:flex;gap:4px;width:100%">
                <el-select v-model="form.currency" filterable allow-create clearable default-first-option placeholder="CNY" style="flex:1" @change="onCurrencyChange">
                  <el-option v-for="c in currencyOptions" :key="c" :value="c" :label="currencyLabel(c)" />
                </el-select>
                <el-button v-if="!isView" size="small" title="新增币别到字典" @click="quickDict('currency')"><el-icon><Plus /></el-icon></el-button>
              </div>
            </el-form-item>
          </el-col>
          <!-- 多币种双轨：外币单据显示记账汇率（缺省按单据期间从汇率表带出，可改；审核时锁定） -->
          <el-col v-if="showCurrency && isForeignCurrency" :span="6">
            <el-form-item label="记账汇率">
              <el-input-number v-model="form.exchange_rate" :min="0.000001" :precision="6" :controls="false" :disabled="isView" style="width:100%" placeholder="1 外币 = ? 本位币" />
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('discount')" :span="6">
            <el-form-item label="整单折扣(折)">
              <el-input-number v-model="form.discount_rate" :min="0" :max="10" :precision="2" :controls="false" style="width:100%" placeholder="如9.9折填9.9，10折=原价" />
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('expect_date')" :span="6">
            <el-form-item label="预计交期">
              <el-date-picker v-model="form.expect_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col v-if="hcol('credit')" :span="6">
            <el-form-item label="账期(天)">
              <el-input-number v-model="form.credit_days" :min="0" :precision="0" :controls="false" style="width:100%" placeholder="可留空" />
            </el-form-item>
          </el-col>
          <template v-if="hcol('invoice')">
            <el-col :span="6">
              <el-form-item label="发票种类">
                <el-select v-model="form.invoice_type" clearable style="width:100%">
                  <el-option label="增值税专用发票" value="special" />
                  <el-option label="增值税普通发票" value="normal" />
                  <el-option label="收据" value="receipt" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="发票号">
                <el-input v-model="form.invoice_no" placeholder="可留空" />
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="发票日期">
                <el-date-picker v-model="form.invoice_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
          </template>
          <el-col v-if="!headerHidden.has('operator')" :span="6">
            <el-form-item label="经手人">
              <el-input v-model="form.operator" placeholder="可留空" />
            </el-form-item>
          </el-col>
          <el-col v-if="!headerHidden.has('remark')" :span="12">
            <el-form-item label="备注">
              <el-input v-model="form.remark" />
            </el-form-item>
          </el-col>
          <!-- 合计数量 / 金额等放在备注同一行右侧（原明细工具栏），节约垂直空间 -->
          <el-col v-if="!isAssembly" :span="headerHidden.has('remark') ? 24 : 12" class="doc-lines-summary-col">
            <span class="doc-lines-summary">
              <template v-if="isPaymentDoc">
                <template v-if="isAdvancePaymentMode">{{ isReceivePayment ? '预收款' : '预付款' }}金额：¥{{ fmt(advanceAmount) }}</template>
                <template v-else>已选 {{ paymentSelectedCount }} 张源单<span v-if="advanceAmount > 0">　{{ isReceivePayment ? '预收' : '预付' }}：¥{{ fmt(advanceAmount) }}</span>　合计金额：¥{{ fmt(totalAmount) }}</template>
              </template>
              <template v-else>合计数量：{{ decStore.qty(totalQty, form.doc_type) }}　合计金额：{{ currencySymbol }}{{ amtText(displayTotalAmount) }}</template>
              <span v-if="isPurchaseOrSale && !isInvoice">　税额：{{ currencySymbol }}{{ amtText(totalTax) }}</span>
              <span v-if="isInvoice || isPurchaseOrSale">　价税合计：{{ currencySymbol }}{{ amtText(totalTaxAmount) }}</span>
              <span v-if="isForeignCurrency" class="doc-cost-hint">　折本位币（汇率 {{ form.exchange_rate || '-' }}）：¥{{ fmt(round2((isPaymentDoc ? totalAmount : ((isInvoice || isPurchaseOrSale) ? totalTaxAmount : displayTotalAmount)) * (Number(form.exchange_rate) || 0))) }}</span>
              <span v-if="isCostInbound && form.status === 'draft'" class="doc-cost-hint">
                本单成本将在审核时按工单归集自动生成（{{ form.doc_type === 'WI' ? '料 + 加工费' : '料 + 人工/制费' }}），当前草稿暂无成本
              </span>
              <span v-else-if="isCostOutbound && form.status === 'draft'" class="doc-cost-hint">
                本单成本将在审核时按「移动平均成本」出库计算，当前草稿暂无成本
              </span>
            </span>
          </el-col>
          <!-- 表头自定义字段 -->
          <el-col v-for="f in headerFieldDefs" :key="f.field_key" :span="6">
            <el-form-item :label="f.field_name">
              <el-input v-if="f.field_type === 'text'" v-model="form.field_values[f.field_key]" />
              <el-input v-else-if="f.field_type === 'textarea'" v-model="form.field_values[f.field_key]" type="textarea" :rows="1" />
              <el-input-number v-else-if="f.field_type === 'number'" v-model="form.field_values[f.field_key]" :controls="false" style="width:100%" />
              <el-date-picker v-else-if="f.field_type === 'date'" v-model="form.field_values[f.field_key]" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              <el-select v-else-if="f.field_type === 'select'" v-model="form.field_values[f.field_key]" clearable style="width:100%">
                <el-option v-for="opt in parseFieldOptions(f.options_json)" :key="opt" :label="opt" :value="opt" />
              </el-select>
              <el-input v-else v-model="form.field_values[f.field_key]" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <!-- 关联单据链条 + 下游锁定提示（同一行，节省垂直空间） -->
      <div v-if="(sourceDocs && sourceDocs.length) || (targetDocs && targetDocs.length) || docStatements.length" class="doc-relation-bar">
        <span v-if="sourceDocs && sourceDocs.length" class="relation-item">
          <span class="relation-label">上游来源：</span>
          <span v-for="sd in sourceDocs" :key="sd.id" class="target-doc-item" style="margin-right:12px; display:inline-flex; align-items:center;">
            <el-link type="primary" size="small" @click="viewRelationDoc(sd.id)">
              [{{ typeName(sd.doc_type) }}] {{ sd.doc_no }}
            </el-link>
            <el-tag size="small" :type="sd.status === 'audited' ? 'success' : 'info'" style="margin-left:4px">
              {{ sd.status === 'audited' ? '已审核' : '草稿' }}
            </el-tag>
          </span>
        </span>
        <span v-if="targetDocs && targetDocs.length" class="relation-item" style="margin-left:24px">
          <span class="relation-label">下游关联：</span>
          <span v-for="td in targetDocs" :key="td.id" class="target-doc-item" style="margin-right:12px; display:inline-flex; align-items:center;">
            <el-link type="primary" size="small" @click="viewRelationDoc(td.id)">
              [{{ typeName(td.doc_type) }}] {{ td.doc_no }}
            </el-link>
            <el-tag size="small" :type="td.status === 'audited' ? 'success' : 'info'" style="margin-left:4px">
              {{ td.status === 'audited' ? '已审核' : '草稿' }}
            </el-tag>
          </span>
        </span>
        <!-- 已进入对账单（第四份反馈 Q2）：已审核对账单锁定本单 -->
        <span v-if="docStatements.length" class="relation-item" style="margin-left:24px">
          <span class="relation-label">对账单：</span>
          <span v-for="st in docStatements" :key="st.id" class="target-doc-item" style="margin-right:12px; display:inline-flex; align-items:center;">
            <el-link type="primary" size="small" @click="router.push({ name: 'ScmStatementForm', params: { id: st.id } })">{{ st.stmt_no }}</el-link>
            <el-tag size="small" :type="st.status === 'audited' ? 'success' : 'info'" style="margin-left:4px">
              {{ st.status === 'audited' ? '已对账（锁定）' : '对账中' }}
            </el-tag>
          </span>
        </span>
        <!-- 已被下游引用锁定提示（内联到关联条右侧，不再独立成行） -->
        <span v-if="isLocked && isView" class="relation-lock-tip" title="本单已被下游单据引用，不可修改/删除；如需调整请先删除下游单据。锁定只限制改/删，未推完的数量仍可继续下推。">
          🔒 已被下游锁定，不可改/删（未推完仍可继续下推）
        </span>
      </div>

      <!-- 单据类型提示 -->
      <el-alert v-if="isTransfer && !isView" type="info" show-icon :closable="false" style="margin-bottom:10px">
        调拨单：<b>调出仓</b>在上方「调出仓」选择；<b>调入仓</b>在下表每行的「调入仓」列分别指定（可不同行不同仓）。
      </el-alert>
      <el-alert v-if="isCount && !isView" type="info" show-icon :closable="false" style="margin-bottom:10px">
        盘点单：「数量」列填写<b>实盘数量</b>（账面数由系统自动与实盘比较，盘盈自动入库、盘亏自动出库）。
      </el-alert>
      <el-alert v-if="showPlanOverrunInfo && planNoMaterial" type="warning" show-icon :closable="false" style="margin-bottom:10px">
        来源工单没有用料，无物料可{{ form.doc_type === 'PJ' ? '退' : '发' }}：请检查该计划是否已选 BOM，且 BOM 组件行类型为「主件」（副产品 / 联产品不计入用料）。
        <el-button link type="primary" size="small" @click="router.push({ name: 'ScmProductionOrder', params: { id: form.plan_id } })">查看工单</el-button>
      </el-alert>
      <el-alert v-else-if="showPlanOverrunInfo && planExecutionInfo.planned_qty > 0" type="info" show-icon :closable="false" style="margin-bottom:10px">
        原计划 {{ qtyText(planExecutionInfo.planned_qty) }}；已执行 {{ qtyText(planExecutionInfo.executed_qty) }}；
        超量上限 {{ qtyText(planExecutionInfo.max_allowed_qty) }}；剩余额度 {{ qtyText(planExecutionInfo.overrun_remaining) }}。
        默认数量仍按原计划剩余带入，可手工增加但不得超过剩余额度。
      </el-alert>

      <!-- 明细行工具栏（组装单走下方两张表，不用此单表工具栏） -->
      <!-- 选择源单已移到顶部；合计已移到「备注」同一行。仅剩新增库位 / BOM 展开时才占这一行 -->
      <div v-if="!isAssembly && !isView && !isPaymentDoc && (showBinCol || isProduction)" class="doc-lines-toolbar">
        <template v-if="!isView && !isPaymentDoc">
          <el-button v-if="showBinCol" size="small" @click="binDlgVisible = true"><el-icon><Plus /></el-icon>新增库位</el-button>
          <template v-if="isProduction">
            <el-select v-model="selectedBom" placeholder="选择BOM" size="small" style="width:200px" clearable>
              <el-option v-for="b in boms" :key="b.id" :label="`${b.code} ${b.item_code}`" :value="b.id" />
            </el-select>
            <el-button size="small" :disabled="!selectedBom" @click="handleBomExplode">
              <el-icon><Connection /></el-icon>从BOM展开
            </el-button>
          </template>
        </template>
      </div>

      <!-- 收付款单：按应收应付源单逐单结算，空源单金额单独作为预收/预付。 -->
      <div v-if="isPaymentDoc" class="payment-source-panel">
        <!-- 客户 / 供应商有预收预付余额：收付款前先冲抵，否则会多收多付（客户反馈） -->
        <el-alert v-if="showAdvanceOffset" type="warning" show-icon :closable="false" class="payment-source-tip">
          该{{ isReceivePayment ? '客户' : '供应商' }}有可冲抵的{{ isReceivePayment ? '预收款' : '预付款' }}（含退货）
          <b>{{ currencySymbol }}{{ fmt(partnerAdvanceTotal) }}</b>（{{ partnerAdvanceItems.map(i => i.doc_no).join('、') }}），
          建议先冲抵源单，再按剩余金额{{ isReceivePayment ? '收款' : '付款' }}。
          <el-button size="small" type="warning" style="margin-left:8px" :loading="advanceOffsetting" @click="offsetWithAdvance">
            用{{ isReceivePayment ? '预收款' : '预付款' }}冲抵{{ paymentSelectedRows.length ? '所选源单' : '源单' }}
          </el-button>
        </el-alert>
        <el-alert v-if="!isAdvancePaymentMode && !form.partner_code" type="info" show-icon :closable="false" class="payment-source-tip">
          请先选择{{ isReceivePayment ? '客户' : '供应商' }}，系统将列出可结算的{{ isReceivePayment ? '销售发货单' : '采购/委外入库单' }}。
        </el-alert>
        <el-table v-col-width="'scm_DocForm_1'" v-else-if="!isAdvancePaymentMode" v-loading="paymentSourceLoading" :data="paymentSources" border size="small" style="width:100%" class="compact-data-table payment-source-table" empty-text="当前往来单位没有可结算源单">
          <el-table-column label="选择" width="62" align="center" fixed="left">
            <template #default="{ row }">
              <el-checkbox v-model="row.selected" :disabled="isView" @change="onPaymentSourceChecked(row)" />
            </template>
          </el-table-column>
          <el-table-column label="源单类型" width="112">
            <template #default="{ row }">{{ typeName(row.source_doc_type) }}</template>
          </el-table-column>
          <el-table-column label="源单日期" prop="source_doc_date" width="112" />
          <el-table-column label="源单号" prop="source_doc_no" min-width="170">
            <template #default="{ row }">
              <el-link v-if="row.source_doc_id" type="primary" @click="viewRelationDoc(row.source_doc_id)">{{ row.source_doc_no }}</el-link>
              <span v-else class="text-warning">{{ row.source_doc_no || '源单已失效' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="原金额" width="120" align="right">
            <template #default="{ row }">{{ fmt(row.source_amount) }}</template>
          </el-table-column>
          <el-table-column label="退货冲减" width="110" align="right">
            <template #default="{ row }">{{ Number(row.return_offset_amount) ? fmt(row.return_offset_amount) : '' }}</template>
          </el-table-column>
          <el-table-column :label="isReceivePayment ? '已收金额' : '已付金额'" width="120" align="right">
            <template #default="{ row }">{{ fmt(row.settled_amount) }}</template>
          </el-table-column>
          <el-table-column :label="isReceivePayment ? '未收金额' : '未付金额'" width="120" align="right">
            <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
          </el-table-column>
          <el-table-column :label="isReceivePayment ? '本次收款' : '本次付款'" width="150" align="right">
            <template #default="{ row }">
              <span v-if="isView">{{ fmt(row.current_amount) }}</span>
              <el-input-number v-else v-model="row.current_amount" :disabled="!row.selected" :min="0" :max="row.open_amount" :precision="2" :controls="false" style="width:100%" @change="validatePaymentSourceAmount(row)" />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="180">
            <template #default="{ row }">
              <span v-if="isView">{{ row.payment_remark }}</span>
              <el-input v-else v-model="row.payment_remark" :disabled="!row.selected" maxlength="200" placeholder="可留空" />
            </template>
          </el-table-column>
        </el-table>

        <!-- 未冲减的退货：无上游或冲完上游仍有余额的退货单，负数列示，可用上方「冲抵」按钮抵扣（第四份反馈 Q5） -->
        <div v-if="!isAdvancePaymentMode && paymentOpenReturns.length" class="payment-return-block">
          <div class="payment-return-block__title">
            未冲减的{{ isReceivePayment ? '销售退货' : '采购退货' }}
            <span class="payment-return-block__hint">退货会减少{{ isReceivePayment ? '应收' : '应付' }}，可点上方「冲抵」按钮抵扣源单后再按剩余金额{{ isReceivePayment ? '收款' : '付款' }}</span>
          </div>
          <el-table :data="paymentOpenReturns" border size="small" style="width:100%" class="compact-data-table payment-source-table">
            <el-table-column label="源单类型" width="112">
              <template #default="{ row }">{{ typeName(row.source_doc_type) }}</template>
            </el-table-column>
            <el-table-column label="源单日期" prop="source_doc_date" width="112" />
            <el-table-column label="源单号" min-width="170">
              <template #default="{ row }">
                <el-link type="primary" @click="viewRelationDoc(row.source_doc_id)">{{ row.source_doc_no }}</el-link>
              </template>
            </el-table-column>
            <el-table-column label="退货金额" width="120" align="right">
              <template #default="{ row }"><span class="text-danger">-{{ fmt(row.source_amount) }}</span></template>
            </el-table-column>
            <el-table-column label="已冲减" width="120" align="right">
              <template #default="{ row }">{{ fmt(row.offset_amount) }}</template>
            </el-table-column>
            <el-table-column label="未冲减" width="120" align="right">
              <template #default="{ row }"><span class="text-danger">-{{ fmt(row.open_amount) }}</span></template>
            </el-table-column>
            <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
          </el-table>
        </div>

        <el-alert v-if="isAdvancePaymentMode" type="info" show-icon :closable="false" class="payment-source-tip">
          当前为{{ isReceivePayment ? '预收款单' : '预付款单' }}，不关联具体源单；审核后金额进入未核销余额，可在{{ isReceivePayment ? '预收款核销' : '预付款核销' }}中分配。
        </el-alert>

        <div v-if="!isView || advanceAmount > 0" class="payment-advance-row">
          <div class="payment-advance-row__title">{{ isReceivePayment ? '预收款' : '预付款' }}</div>
          <div class="payment-advance-row__hint">不关联具体源单，审核后进入未核销余额，可在往来核销页面继续分配。</div>
          <el-input-number v-if="!isView" v-model="advanceAmount" :min="0" :precision="2" :controls="false" :placeholder="`输入${isReceivePayment ? '预收' : '预付'}金额`" class="payment-advance-row__amount" />
          <span v-else class="payment-advance-row__amount payment-advance-row__value">¥{{ fmt(advanceAmount) }}</span>
          <el-input v-if="!isView" v-model="advanceRemark" maxlength="200" placeholder="预收/预付摘要（可留空）" class="payment-advance-row__remark" />
          <span v-else class="payment-advance-row__remark">{{ advanceRemark }}</span>
        </div>
      </div>

      <!-- 明细表格（非组装单）：max-height 动态收缩；合计行作为表体最后一行，使水平滚动条落在合计行下方 -->
      <el-table v-if="!isAssembly && !isPaymentDoc" ref="linesTableRef" :data="tableRows" border size="small" :max-height="tableMaxHeight" :row-class-name="lineRowClass" style="width:100%" @header-dragend="onLineColDragEnd" @cell-click="handleCellClick" @cell-dblclick="handleCellDblClick" @expand-change="handleCostExpandChange" class="compact-data-table">
        <el-table-column v-if="costLineExpandEnabled" type="expand" width="42" fixed="left">
          <template #default="{ row }">
            <div v-if="!row.__summary" v-loading="costDetailLoading" class="cost-source-panel">
              <template v-if="costDetailFor(row)">
                <div class="cost-source-panel__header">
                  <div>
                    <b>{{ row.item_code }} {{ row.item_name }}</b>
                    <span class="cost-source-panel__formula">
                      成本单价 {{ fmt(costDetailFor(row).unit_cost) }} × 数量 {{ numCell(costDetailFor(row).qty) }} = {{ fmt(costDetailFor(row).total_cost) }}
                    </span>
                  </div>
                  <div class="cost-source-panel__segments">
                    <span>材料 <b>{{ fmt(costDetailFor(row).material_cost) }}</b></span>
                    <span>人工 <b>{{ fmt(costDetailFor(row).labor) }}</b></span>
                    <span>制费 <b>{{ fmt(costDetailFor(row).overhead) }}</b></span>
                    <span>加工费 <b>{{ fmt(costDetailFor(row).fee_total) }}</b></span>
                  </div>
                </div>
                <el-table v-col-width="'scm_DocForm_2'" v-if="costDetailFor(row).materials?.length" :data="costDetailFor(row).materials" border stripe size="small" class="cost-source-table">
                  <el-table-column type="index" label="序号" width="54" align="center" />
                  <el-table-column label="来源物料" prop="item_code" width="130" />
                  <el-table-column label="物料名称" prop="item_name" min-width="160" show-overflow-tooltip />
                  <el-table-column label="规格" prop="spec" min-width="120" show-overflow-tooltip />
                  <el-table-column label="每件用量" width="100" align="right"><template #default="{ row: material }">{{ numCell(material.per_unit) }}</template></el-table-column>
                  <el-table-column label="损耗率%" prop="scrap_rate" width="90" align="right" />
                  <el-table-column label="净领单价" width="110" align="right"><template #default="{ row: material }">{{ fmt(material.issue_unit_price) }}</template></el-table-column>
                  <el-table-column label="单件小计" width="110" align="right"><template #default="{ row: material }">{{ fmt(material.unit_subtotal) }}</template></el-table-column>
                  <el-table-column label="本次材料成本" width="130" align="right"><template #default="{ row: material }"><b>{{ fmt(material.actual_cost) }}</b></template></el-table-column>
                </el-table>
                <el-empty v-else :image-size="44" :description="`未匹配到工单用料明细，材料成本合计 ${fmt(costDetailFor(row).material_cost)}`" />
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column column-key="__line_index__" label="序号" width="52" align="center" fixed="left">
          <template #default="{ row, $index }">{{ row.__summary ? '' : $index + 1 }}</template>
        </el-table-column>
        <el-table-column column-key="item_code" label="编号" :width="lw('item_code')" :min-width="lw('item_code') ? undefined : 140" align="center" prop="item_code">
          <template #default="{ row }">
            <template v-if="isView">
              <span>{{ row.item_code }}</span>
              <!-- 完工入库审核时按 BOM 自动产出的副产品/联产品行 -->
              <el-tag v-if="row.line_role === 'by_product' || row.line_role === 'co_product'" size="small" effect="plain" type="warning" style="margin-left:4px">{{ row.line_role === 'by_product' ? '副产品' : '联产品' }}</el-tag>
            </template>
            <template v-else>
              <ItemPicker v-if="isEditing(row, 'item_code')" v-model="row.item_code" :warehouse-code="lineStockWarehouse(row)" auto-open :focus-search="itemPickerFocusSearch" :browsable="false" :default-stock-only="isOutbound" :default-source="lineDefaultSource" @pick="(item:any) => { onItemPick(row, item); stopEdit() }" />
              <div v-else class="editable-cell">{{ row.item_code || '点击选择物料' }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column column-key="item_name" label="名称" :width="lw('item_name')" :min-width="lw('item_name') ? undefined : 170" align="center" prop="item_name" show-overflow-tooltip />
        <el-table-column column-key="spec" label="规格" :width="lw('spec')" :min-width="lw('spec') ? undefined : 120" align="center" prop="spec" show-overflow-tooltip />
        <el-table-column v-if="form.doc_type === 'SO'" column-key="sales_order_no" label="销售订单号" :width="lw('sales_order_no')" :min-width="lw('sales_order_no') ? undefined : 170" align="center" prop="sales_order_no" show-overflow-tooltip>
          <template #default="{ row }">{{ row.__summary ? '' : (row.sales_order_no || '—') }}</template>
        </el-table-column>
        <el-table-column v-if="form.doc_type === 'PI'" column-key="purchase_order_no" label="采购订单号" :width="lw('purchase_order_no')" :min-width="lw('purchase_order_no') ? undefined : 170" align="center" prop="purchase_order_no" show-overflow-tooltip>
          <template #default="{ row }">{{ row.__summary ? '' : (row.purchase_order_no || '—') }}</template>
        </el-table-column>
        <el-table-column v-if="showPlanOverrunInfo" column-key="plan_qty" label="原计划" :width="lw('plan_qty') ?? 100" align="right">
          <template #default="{ row }">{{ row.__summary ? '' : numCell(row.plan_qty) }}</template>
        </el-table-column>
        <el-table-column v-if="showPlanOverrunInfo" column-key="executed_qty" label="已执行" :width="lw('executed_qty') ?? 100" align="right">
          <template #default="{ row }">{{ row.__summary ? '' : numCell(row.executed_qty) }}</template>
        </el-table-column>
        <el-table-column v-if="showPlanOverrunInfo" column-key="max_allowed_qty" label="超量上限" :width="lw('max_allowed_qty') ?? 110" align="right">
          <template #default="{ row }">{{ row.__summary ? '' : numCell(row.max_allowed_qty) }}</template>
        </el-table-column>
        <el-table-column v-if="showPlanOverrunInfo" column-key="overrun_remaining" label="剩余额度" :width="lw('overrun_remaining') ?? 110" align="right">
          <template #default="{ row }">{{ row.__summary ? '' : numCell(row.overrun_remaining) }}</template>
        </el-table-column>
        <el-table-column column-key="warehouse_code" :label="isTransfer ? '调入仓' : '仓库'" :width="lw('warehouse_code') ?? 130" align="center" prop="warehouse_code">
          <template #default="{ row }">
            <template v-if="isView">{{ whName(row.warehouse_code) }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'warehouse_code')" v-model="row.warehouse_code" :placeholder="isTransfer ? '必填调入仓' : '覆盖头部仓库'" filterable clearable size="small" style="width:100%" @change="stopEdit" @visible-change="v => !v && stopEdit()" v-focus>
                <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" :disabled="(w as any).enabled === 0" />
              </el-select>
              <div v-else class="editable-cell">{{ whName(row.warehouse_code) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column column-key="qty" :label="isCount ? '实盘数量' : '数量'" :width="lw('qty') ?? 110" align="right" prop="qty">
          <template #default="{ row }">
            <template v-if="isView">{{ qtyCell(row.qty) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'qty')" v-model="row.qty" :min="0" :max="planLineMax(row)" :precision="showPlanOverrunInfo ? Math.max(6, dec.qty) : dec.qty" size="small" :controls="false" style="width:100%" placeholder="数量" @change="recalcRow(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ qtyCell(row.qty) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="stockShown && lineColShown('realtime_stock')" column-key="realtime_stock" label="实时库存" :width="lw('realtime_stock') ?? 150" align="right">
          <template #default="{ row }"><span class="rt-stock">{{ stockText(row) }}</span></template>
        </el-table-column>
        <!-- C-1 替代料：工单领料时主料缺料，列出同组替代料在库量，改物料编号即可领替代料（按主料需求上限校验） -->
        <el-table-column v-if="showSubstituteCol" column-key="substitutes" label="可用替代料" :width="lw('substitutes') ?? 200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row._substitutes?.length" class="sub-hint">{{ row._substitutes.map((s: any) => `${s.item_code}(库存 ${stockNum(s.on_hand)})`).join('、') }}</span>
            <span v-else class="text-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="isMr" column-key="source_type" label="来源" :width="lw('source_type') ?? 110" prop="source_type">
          <template #default="{ row }">
            <template v-if="isView">{{ SOURCE_TYPES[row.source_type] || '采购' }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'source_type')" v-model="row.source_type" size="small" style="width:100%" @change="row.supplier_code = ''; stopEdit()" @visible-change="v => !v && stopEdit()" v-focus>
                <el-option v-for="(n, k) in SOURCE_TYPES" :key="k" :label="n" :value="k" />
              </el-select>
              <div v-else class="editable-cell">{{ SOURCE_TYPES[row.source_type] || '采购' }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="isMr" column-key="supplier_code" label="供应商/委外厂" :width="lw('supplier_code') ?? 190" prop="supplier_code">
          <template #default="{ row }">
            <template v-if="isView">{{ supplierLabel(row.supplier_code || row.item_supplier) }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'supplier_code')" v-model="row.supplier_code" :placeholder="noSupplierSrc(row.source_type) ? '自制/组装无需' : '默认取物料'" :disabled="noSupplierSrc(row.source_type)" filterable clearable size="small" style="width:100%" @change="stopEdit" @visible-change="v => !v && stopEdit()" v-focus>
                <el-option v-for="p in rowSupplierOptions(row)" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
              </el-select>
              <div v-else class="editable-cell">{{ noSupplierSrc(row.source_type) ? '—' : ((row.supplier_code || row.item_supplier) ? supplierLabel(row.supplier_code || row.item_supplier) : '点击选择') }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showPushCol && isView" column-key="push_qty" label="已下推数量" :width="lw('push_qty') ?? 110" align="right">
          <template #default="{ row }">
            <template v-if="!row.__summary && (Number(row.qty) || 0) > 0">
              <span :class="(row.pushed_qty || 0) >= row.qty ? 'text-success' : ((row.pushed_qty || 0) > 0 ? 'text-warning' : 'text-muted')">
                {{ decStore.qty(row.pushed_qty || 0, form.doc_type) }}
              </span>
            </template>
            <span v-else-if="!row.__summary" class="text-muted">—</span>
            <template v-else>{{ decStore.qty(row.pushed_qty || 0, form.doc_type) }}</template>
          </template>
        </el-table-column>
        <el-table-column v-if="showPushCol && isView" column-key="push_amount" label="已下推金额" :width="lw('push_amount') ?? 120" align="right">
          <template #default="{ row }">
            <template v-if="!row.__summary && (Number(row.qty) || 0) > 0">{{ decStore.amount(row.pushed_amount || 0, form.doc_type) }}</template>
            <span v-else-if="!row.__summary" class="text-muted">—</span>
            <template v-else>{{ decStore.amount(row.pushed_amount || 0, form.doc_type) }}</template>
          </template>
        </el-table-column>
        <el-table-column v-if="!isMr && !isCostInbound" column-key="price" label="单价" :width="lw('price') ?? 120" align="right" prop="price">
          <template #default="{ row }">
            <template v-if="isView">{{ priceCell(row.price) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'price')" v-model="row.price" :min="0" :precision="dec.price" size="small" :controls="false" style="width:100%" placeholder="单价" @change="recalcRow(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ priceCell(row.price) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="col('price_with_tax') && lineColShown('price_with_tax')" column-key="price_with_tax" label="含税单价" :width="lw('price_with_tax') ?? 120" align="right" prop="price_with_tax">
          <template #default="{ row }">
            <template v-if="isView">{{ priceCell(row.price_with_tax) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'price_with_tax')" v-model="row.price_with_tax" :min="0" :precision="dec.price" size="small" :controls="false" style="width:100%" placeholder="含税单价" @change="recalcFromTaxPrice(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ priceCell(row.price_with_tax) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="col('discount_rate') && lineColShown('discount_rate')" column-key="discount_rate" label="折扣(折)" :width="lw('discount_rate') ?? 90" align="right" prop="discount_rate">
          <template #default="{ row }">
            <template v-if="isView">{{ (Number(row.discount_rate) || 0) > 0 ? row.discount_rate + ' 折' : '' }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'discount_rate')" v-model="row.discount_rate" :min="0" :max="10" :precision="2" size="small" :controls="false" style="width:100%" placeholder="折扣" @change="recalcRow(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ numCell(row.discount_rate) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column column-key="amount" label="金额" :width="lw('amount') ?? 120" align="right">
          <template #default="{ row }">{{ amtCell(isCostDoc && !row.__summary ? (Number(row.unit_cost) || 0) * (Number(row.qty) || 0) : row.amount) }}</template>
        </el-table-column>
        <el-table-column v-if="col('tax_rate') && lineColShown('tax_rate')" column-key="tax_rate" label="税率%" :width="lw('tax_rate') ?? 90" align="right" prop="tax_rate">
          <template #default="{ row }">
            <template v-if="isView">{{ effTax(row) ? effTax(row) + '%' : '' }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'tax_rate')" v-model="row.tax_rate" :min="0" :max="100" :precision="1" size="small" :controls="false" style="width:100%" placeholder="取表头" @change="recalcTax(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell" :title="(row.tax_rate === null || row.tax_rate === undefined || row.tax_rate === '') ? '取表头税率' : ''">{{ effTax(row) ? effTax(row) + '%' : '' }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="col('tax_amount') && lineColShown('tax_amount')" column-key="tax_amount" label="税额" :width="lw('tax_amount') ?? 110" align="right" prop="tax_amount">
          <template #default="{ row }">
            <template v-if="isView">{{ amtCell(row.tax_amount) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'tax_amount')" v-model="row.tax_amount" :min="0" :precision="dec.amount" size="small" :controls="false" style="width:100%" placeholder="税额" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ amtCell(row.tax_amount) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="col('tax_amount') && lineColShown('gross_amount')" column-key="gross_amount" label="价税合计" :width="lw('gross_amount') ?? 130" align="right" prop="gross_amount">
          <template #default="{ row }">
            <template v-if="isView">{{ amtCell(grossOf(row)) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'gross_amount')" v-model="row.gross_amount" :min="0" :precision="dec.amount" size="small" :controls="false" style="width:100%" placeholder="价税合计" @change="recalcFromGross(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ amtCell(grossOf(row)) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showBatchCols && lineColShown('batch_no')" column-key="batch_no" label="批号" :width="lw('batch_no') ?? 120" prop="batch_no">
          <template #default="{ row }">
            <template v-if="isView">{{ row.batch_no }}</template>
            <template v-else>
              <el-input v-if="isEditing(row, 'batch_no')" v-model="row.batch_no" size="small" :placeholder="row._batch && row._batchMode === 'manual' ? '手工选批必填' : '留空按单号'" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.batch_no }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showBatchCols && lineColShown('produce_date')" column-key="produce_date" label="生产日期" :width="lw('produce_date') ?? 140" prop="produce_date">
          <template #default="{ row }">
            <template v-if="isView">{{ row.produce_date }}</template>
            <template v-else>
              <el-date-picker v-if="isEditing(row, 'produce_date')" v-model="row.produce_date" type="date" value-format="YYYY-MM-DD" size="small" style="width:100%" @change="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.produce_date }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="(showBatchCols || col('expire_date')) && lineColShown('expire_date')" column-key="expire_date" label="保质期" :width="lw('expire_date') ?? 140" prop="expire_date">
          <template #default="{ row }">
            <template v-if="isView">{{ row.expire_date }}</template>
            <template v-else>
              <el-date-picker v-if="isEditing(row, 'expire_date')" v-model="row.expire_date" type="date" value-format="YYYY-MM-DD" size="small" style="width:100%" @change="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.expire_date }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showBinCol && lineColShown('bin_no')" column-key="bin_no" label="库位" :width="lw('bin_no') ?? 130" prop="bin_no">
          <template #default="{ row }">
            <template v-if="isView">{{ row.bin_no }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'bin_no')" v-model="row.bin_no" filterable clearable size="small" style="width:100%" @change="stopEdit" v-focus>
                <el-option v-for="b in binsForWh(row.warehouse_code)" :key="b.id" :value="b.code" :label="`${b.code} ${b.name}`" />
              </el-select>
              <div v-else class="editable-cell">{{ row.bin_no }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showSerialCols" column-key="serial_no" label="序列号" :width="lw('serial_no') ?? 130" align="center">
          <template #default="{ row }">
            <template v-if="row._serial">
              <el-button v-if="!isView" link type="primary" size="small" @click="openSerialDialog(row)">
                {{ serialCount(row) }}/{{ Number(row.qty) || 0 }} 录入
              </el-button>
              <span v-else>{{ serialCount(row) }} 个</span>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="col('scrap_rate') && lineColShown('scrap_rate')" column-key="scrap_rate" label="损耗%" :width="lw('scrap_rate') ?? 90" align="right" prop="scrap_rate">
          <template #default="{ row }">
            <template v-if="isView">{{ Number(row.scrap_rate) ? row.scrap_rate + '%' : '' }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'scrap_rate')" v-model="row.scrap_rate" :min="0" :max="100" :precision="2" size="small" :controls="false" style="width:100%" placeholder="损耗%" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ numCell(row.scrap_rate) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="col('process_fee') && lineColShown('process_fee')" column-key="process_fee" label="加工费" :width="lw('process_fee') ?? 110" align="right" prop="process_fee">
          <template #default="{ row }">
            <template v-if="isView">{{ numCell(row.process_fee, true) }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'process_fee')" v-model="row.process_fee" :min="0" :precision="2" size="small" :controls="false" style="width:100%" placeholder="加工费" @change="recalcRow(row)" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell" :class="{ 'is-locked': outsourcePriceLocked(row), 'price-diff': outsourcePriceDiff(row) }" :title="outsourcePriceTitle(row)">{{ numCell(row.process_fee, true) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="isCostDoc || form.status === 'audited'" column-key="unit_cost" label="成本单价" :width="lw('unit_cost') ?? 110" align="right">
          <template #default="{ row }">
            <span v-if="isCostInbound && form.status !== 'audited'" class="doc-cost-pending">审核后计算</span>
            <span v-else>{{ priceCell(row.unit_cost) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="lineColShown('remark')" column-key="remark" label="备注" :width="lw('remark')" :min-width="lw('remark') ? undefined : 120" prop="remark">
          <template #default="{ row }">
            <template v-if="isView">{{ row.remark }}</template>
            <template v-else>
              <el-input v-if="isEditing(row, 'remark')" v-model="row.remark" size="small" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.remark }}</div>
            </template>
          </template>
        </el-table-column>
        <!-- 表体自定义字段（按行存 row.field_values）-->
        <el-table-column v-for="f in bodyFieldDefs" :key="'bf_' + f.field_key" :column-key="'bf_' + f.field_key" :label="f.field_name" :width="lw('bf_' + f.field_key)" :min-width="lw('bf_' + f.field_key) ? undefined : 140">
          <template #default="{ row }">
            <template v-if="isView">{{ lineFieldText(row, f) }}</template>
            <template v-else>
              <el-input-number v-if="f.field_type === 'number'" v-model="ensureLineFv(row)[f.field_key]" :controls="false" size="small" style="width:100%" />
              <el-date-picker v-else-if="f.field_type === 'date'" v-model="ensureLineFv(row)[f.field_key]" type="date" value-format="YYYY-MM-DD" size="small" style="width:100%" />
              <el-select v-else-if="f.field_type === 'select'" v-model="ensureLineFv(row)[f.field_key]" clearable size="small" style="width:100%">
                <el-option v-for="opt in parseFieldOptions(f.options_json)" :key="opt" :label="opt" :value="opt" />
              </el-select>
              <el-input v-else-if="f.field_type === 'textarea'" v-model="ensureLineFv(row)[f.field_key]" type="textarea" :rows="1" size="small" />
              <el-input v-else v-model="ensureLineFv(row)[f.field_key]" size="small" />
            </template>
          </template>
        </el-table-column>
        <el-table-column column-key="__line_actions__" label="操作" :width="isView ? 48 : 70" align="center" fixed="right">
          <template #default="{ row }">
            <div v-if="!row.__summary" class="doc-line-actions">
              <el-button v-if="row.item_code" link type="primary" size="small" title="查询物料收发明细账" @click.stop="openStockLedger(row)">账</el-button>
              <el-button v-if="!isView" link type="danger" size="small" @click="removeLine(row)">删</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 组装单：成品表 + 总用料表（相同物料合并）；仓库可直接改，物料/数量在弹窗维护 -->
      <template v-if="isAssembly">
        <div class="doc-lines-toolbar">
          <template v-if="!isView">
            <el-button v-if="showBinCol" size="small" @click="binDlgVisible = true"><el-icon><Plus /></el-icon>新增库位</el-button>
            <span class="as-group__hint">在成品表空行选成品即可：单 BOM 自动展开，多 BOM 弹框选</span>
          </template>
          <span class="doc-lines-summary">成品 {{ asFilledProductCount }} 个 · 子件 {{ asFilledComponentCount }} 行</span>
        </div>

        <!-- 成品表 -->
        <div class="as-group">
          <div class="as-group__hd">
            <span class="as-group__title is-product">成品（入库）</span>
            <span class="as-group__count">{{ asFilledProductCount }} 个</span>
          </div>
          <el-table v-col-width="'scm_DocForm_3'" :data="productLines" border size="small" show-summary :summary-method="asSummary" style="width:100%" @cell-click="handleCellClick" class="compact-data-table">
            <el-table-column label="序号" width="52" align="center"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
            <el-table-column label="编号" min-width="150" prop="item_code">
              <template #default="{ row }">
                <template v-if="isView"><span>{{ row.item_code }}</span></template>
                <template v-else>
                  <ItemPicker v-if="isEditing(row, 'item_code')" v-model="row.item_code" :warehouse-code="lineStockWarehouse(row)" auto-open :focus-search="itemPickerFocusSearch" :browsable="false" :default-stock-only="isOutbound" @pick="(item:any) => { onItemPick(row, item); stopEdit(); onPickAsProduct(row, item) }" />
                  <div v-else class="editable-cell">{{ row.item_code || '点击选择成品' }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="名称" min-width="170" prop="item_name" show-overflow-tooltip />
            <el-table-column label="规格" min-width="110" prop="spec" show-overflow-tooltip />
            <el-table-column label="入库仓" width="140" prop="warehouse_code">
              <template #default="{ row }">
                <template v-if="isView">{{ whName(row.warehouse_code) }}</template>
                <template v-else>
                  <el-select v-if="isEditing(row, 'warehouse_code')" v-model="row.warehouse_code" placeholder="覆盖头部仓库" filterable clearable size="small" style="width:100%" @change="stopEdit" @visible-change="v => !v && stopEdit()" v-focus>
                    <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" :disabled="(w as any).enabled === 0" />
                  </el-select>
                  <div v-else class="editable-cell">{{ whName(row.warehouse_code) }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="数量" width="120" align="right" prop="qty">
              <template #default="{ row }">
                <template v-if="isView">{{ row.qty }}</template>
                <template v-else>
                  <el-input-number v-if="isEditing(row, 'qty')" v-model="row.qty" :min="0" :precision="dec.qty" size="small" :controls="false" style="width:100%" placeholder="数量" @change="(cur:any, old:any) => recomputeGroupQty(row, cur, old)" @blur="stopEdit" v-focus />
                  <div v-else class="editable-cell">{{ row.qty }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="加工单价" width="110" align="right" prop="process_fee">
              <template #header><span title="不含税">加工单价<small class="as-fee-hint">不含税</small></span></template>
              <template #default="{ row }">
                <template v-if="isView">{{ numCell(row.process_fee, true) }}</template>
                <template v-else>
                  <el-input-number v-if="isEditing(row, 'process_fee')" v-model="row.process_fee" :min="0" :precision="4" size="small" :controls="false" style="width:100%" placeholder="不含税" @change="asRecalcFeeTax(row)" @blur="stopEdit" v-focus />
                  <div v-else class="editable-cell">{{ numCell(row.process_fee, true) }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="税率%" width="80" align="right" prop="tax_rate">
              <template #default="{ row }">
                <template v-if="isView">{{ row.item_code ? effTax(row) : '' }}</template>
                <template v-else>
                  <el-input-number v-if="isEditing(row, 'tax_rate')" v-model="row.tax_rate" :min="0" :max="100" :precision="2" size="small" :controls="false" style="width:100%" placeholder="税率" @change="asRecalcFeeTax(row)" @blur="stopEdit" v-focus />
                  <div v-else class="editable-cell">{{ row.item_code ? effTax(row) : '' }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="含税单价" width="110" align="right" prop="price_with_tax">
              <template #default="{ row }">
                <template v-if="isView">{{ numCell(asFeeWithTax(row), true) }}</template>
                <template v-else>
                  <el-input-number v-if="isEditing(row, 'price_with_tax')" v-model="row.price_with_tax" :min="0" :precision="4" size="small" :controls="false" style="width:100%" placeholder="含税" @change="asRecalcFeeFromTaxPrice(row)" @blur="stopEdit" v-focus />
                  <div v-else class="editable-cell">{{ numCell(asFeeWithTax(row), true) }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="加工费" width="110" align="right" prop="process_amount">
              <template #default="{ row }">{{ row.item_code ? fmt(asProcessAmount(row)) : '' }}</template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="税额" width="96" align="right" prop="process_tax">
              <template #default="{ row }">{{ row.item_code ? fmt(asProcessTax(row)) : '' }}</template>
            </el-table-column>
            <el-table-column v-if="asNeedsPartner" label="价税合计" width="110" align="right" prop="process_gross">
              <template #default="{ row }">{{ row.item_code ? fmt(asProcessAmount(row) + asProcessTax(row)) : '' }}</template>
            </el-table-column>
            <el-table-column label="备注" min-width="110" prop="remark">
              <template #default="{ row }">
                <template v-if="isView">{{ row.remark }}</template>
                <template v-else>
                  <el-input v-if="isEditing(row, 'remark')" v-model="row.remark" size="small" @blur="stopEdit" v-focus />
                  <div v-else class="editable-cell">{{ row.remark }}</div>
                </template>
              </template>
            </el-table-column>
            <el-table-column label="物料" width="96" align="center">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click.stop="openMatDialog(row.product_group)">物料({{ componentLines.filter(c => c.product_group === row.product_group && c.item_code).length }})</el-button>
              </template>
            </el-table-column>
            <el-table-column v-if="!isView" label="" width="44" align="center">
              <template #default="{ row }">
                <el-button link type="danger" size="small" title="删除成品（连同其子件）" @click="removeAsProduct(row)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 子件总用料表（相同物料合并；仓库可直接统一调整） -->
        <div class="as-group">
          <div class="as-group__hd">
            <span class="as-group__title is-component">子件（总用料）</span>
            <span class="as-group__count">{{ mergedMaterials.length }} 种</span>
            <span class="as-group__hint">仓库可直接调整；物料/数量请点成品行的「物料」</span>
          </div>
          <el-table v-col-width="'scm_DocForm_4'" :data="mergedMaterials" border size="small" show-summary :summary-method="asSummary" style="width:100%" class="compact-data-table">
            <el-table-column label="序号" width="52" align="center"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
            <el-table-column label="编号" min-width="150" prop="item_code" />
            <el-table-column label="名称" min-width="170" prop="item_name" show-overflow-tooltip />
            <el-table-column label="规格" min-width="110" prop="spec" show-overflow-tooltip />
            <el-table-column label="出库仓" width="160" prop="warehouse_code">
              <template #default="{ row }">
                <template v-if="isView">{{ row.warehouse_mixed ? '多仓' : whName(row.warehouse_code) }}</template>
                <el-select
                  v-else
                  :model-value="row.warehouse_mixed ? '' : row.warehouse_code"
                  :placeholder="row.warehouse_mixed ? '多仓，选择后统一' : '选择出库仓'"
                  filterable
                  clearable
                  size="small"
                  style="width:100%"
                  @change="(code:any) => setMergedMaterialWarehouse(row, code)"
                >
                  <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" :disabled="(w as any).enabled === 0" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="合计数量" width="120" align="right" prop="qty" />
            <el-table-column label="涉及成品" min-width="180" prop="products" show-overflow-tooltip>
              <template #default="{ row }">
                <el-tag v-if="!row.warehouse_mixed && isCustomerSuppliedWh(row.warehouse_code)" size="small" type="warning" effect="plain" style="margin-right:4px" title="客供仓：只记数量，不计成本">客供</el-tag>{{ row.products }}
              </template>
            </el-table-column>
          </el-table>
          <div v-if="!mergedMaterials.length" class="as-empty">暂无子件，请在上方「选成品BOM」自动展开，或点成品行「物料」手工添加</div>
        </div>
      </template>

      <!-- 单据表尾自定义字段 -->
      <div v-if="footerFieldDefs.length" class="doc-form-footer">
        <el-form :model="form" label-width="90px" size="small" :disabled="isView">
          <el-row :gutter="16">
            <el-col v-for="f in footerFieldDefs" :key="f.field_key" :span="6">
              <el-form-item :label="f.field_name">
                <el-input v-if="f.field_type === 'text'" v-model="form.field_values[f.field_key]" />
                <el-input v-else-if="f.field_type === 'textarea'" v-model="form.field_values[f.field_key]" type="textarea" :rows="2" />
                <el-input-number v-else-if="f.field_type === 'number'" v-model="form.field_values[f.field_key]" :controls="false" style="width:100%" />
                <el-date-picker v-else-if="f.field_type === 'date'" v-model="form.field_values[f.field_key]" type="date" value-format="YYYY-MM-DD" style="width:100%" />
                <el-select v-else-if="f.field_type === 'select'" v-model="form.field_values[f.field_key]" clearable style="width:100%">
                  <el-option v-for="opt in parseFieldOptions(f.options_json)" :key="opt" :label="opt" :value="opt" />
                </el-select>
                <el-input v-else v-model="form.field_values[f.field_key]" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>
    </div>

    <!-- 批量选择物料对话框（双击物料列触发） -->
    <ItemBatchPicker
      v-if="batchPickerVisible"
      v-model="batchPickerVisible"
      :warehouse-code="batchPickerWarehouse"
      :stock-only-default="isOutbound"
      :default-source="lineDefaultSource"
      @confirm="onBatchPickConfirm"
    />

    <!-- 选择源单对话框（订单→下游单据 反向选单，支持多对一合并；PR 支持入库单/采购订单两种来源） -->
    <SourceDocPicker
      v-if="activePick && sourcePickerVisible"
      v-model="sourcePickerVisible"
      :source-doc-type="activePick.type"
      :detail-source="activePick.detailSource"
      :partner-code="form.partner_code"
      @confirm="onSourcePick"
    />

    <!-- 快捷新增 档案：完整表单弹窗，与各档案列表共用 -->
    <PartnerDialog v-if="partnerDlgVisible" v-model="partnerDlgVisible" :default-type="defaultPartnerType()" @saved="onPartnerCreated" />
    <WarehouseDialog v-if="warehouseDlgVisible" v-model="warehouseDlgVisible" @saved="onWarehouseCreated" />
    <BinDialog v-if="binDlgVisible" v-model="binDlgVisible" :default-warehouse="form.warehouse_code" @saved="onBinCreated" />
    <AuxItemDialog v-if="auxDlgVisible" v-model="auxDlgVisible" :entity-type="auxEntityType" :entity-name="auxEntityName" :name-label="auxNameLabel" :default-code="auxDefaultCode" @saved="onAuxSaved" />

    <!-- 序列号录入对话框：每行一个序列号 -->
    <el-dialog v-model="serialDialogVisible" title="录入序列号" width="420px" append-to-body>
      <div style="margin-bottom:8px;color:var(--el-text-color-secondary);font-size: var(--cw-text-base)">
        {{ serialRow?.item_code }} {{ serialRow?.item_name || '' }} · 需 {{ Number(serialRow?.qty) || 0 }} 个（每行一个）
      </div>
      <el-input v-model="serialText" type="textarea" :rows="8" placeholder="每行一个序列号，可粘贴" />
      <div style="margin-top:6px;font-size:12px" :class="serialTextCount === (Number(serialRow?.qty) || 0) ? 'serial-ok' : 'serial-warn'">
        已填 {{ serialTextCount }} / {{ Number(serialRow?.qty) || 0 }}
      </div>
      <template #footer>
        <el-button @click="serialDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSerials">确定</el-button>
      </template>
    </el-dialog>

    <!-- 单成品「物料」弹窗：增删改该成品的子件（同一批 lines，关闭即反映到总用料表） -->
    <el-dialog v-model="matDlgVisible" :title="((matDlgProduct && (matDlgProduct.item_name || matDlgProduct.item_code)) || '成品') + ' · 物料'" width="920px" top="6vh" append-to-body>
      <div v-if="!isView" class="mat-dlg-toolbar">
        <el-button v-if="showBinCol" size="small" @click="binDlgVisible = true"><el-icon><Plus /></el-icon>新增库位</el-button>
        <span class="mat-dlg-hint">末行空行直接选物料即可 · 成品数量 {{ matDlgProduct && matDlgProduct.qty }} · 子件 {{ matDlgRows.filter(r => r.item_code).length }} 项（改数量即为该成品的实际用量）</span>
      </div>
      <el-table v-col-width="'scm_DocForm_5'" :data="matDlgRows" border size="small" show-summary :summary-method="asSummary" max-height="60vh" style="width:100%" @cell-click="handleCellClick" class="compact-data-table">
        <el-table-column label="序号" width="52" align="center"><template #default="{ $index }">{{ $index + 1 }}</template></el-table-column>
        <el-table-column label="编号" min-width="150" prop="item_code">
          <template #default="{ row }">
            <template v-if="isView"><span>{{ row.item_code }}</span></template>
            <template v-else>
              <ItemPicker v-if="isEditing(row, 'item_code')" v-model="row.item_code" :warehouse-code="lineStockWarehouse(row)" auto-open :focus-search="itemPickerFocusSearch" :browsable="false" :default-stock-only="isAssembly || isOutbound" @pick="(item:any) => { onItemPick(row, item); stopEdit() }" />
              <div v-else class="editable-cell">{{ row.item_code || '点击选择物料' }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="160" prop="item_name" show-overflow-tooltip />
        <el-table-column label="规格" min-width="100" prop="spec" show-overflow-tooltip />
        <el-table-column label="出库仓" width="140" prop="warehouse_code">
          <template #default="{ row }">
            <template v-if="isView">{{ whName(row.warehouse_code) }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'warehouse_code')" v-model="row.warehouse_code" placeholder="覆盖头部仓库" filterable clearable size="small" style="width:100%" @change="stopEdit" @visible-change="v => !v && stopEdit()" v-focus>
                <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" :disabled="(w as any).enabled === 0" />
              </el-select>
              <div v-else class="editable-cell">{{ whName(row.warehouse_code) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="110" align="right" prop="qty">
          <template #default="{ row }">
            <template v-if="isView">{{ row.qty }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'qty')" v-model="row.qty" :min="0" :precision="dec.qty" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.qty }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showBatchCols" label="批号" width="120" prop="batch_no">
          <template #default="{ row }">
            <template v-if="isView">{{ row.batch_no }}</template>
            <template v-else>
              <el-input v-if="isEditing(row, 'batch_no')" v-model="row.batch_no" size="small" placeholder="留空按单号" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.batch_no }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="showBinCol" label="库位" width="120" prop="bin_no">
          <template #default="{ row }">
            <template v-if="isView">{{ row.bin_no }}</template>
            <template v-else>
              <el-select v-if="isEditing(row, 'bin_no')" v-model="row.bin_no" filterable clearable size="small" style="width:100%" @change="stopEdit" v-focus>
                <el-option v-for="b in binsForWh(row.warehouse_code)" :key="b.code" :label="b.code + ' ' + (b.name || '')" :value="b.code" />
              </el-select>
              <div v-else class="editable-cell">{{ row.bin_no }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="损耗%" width="88" align="right" prop="scrap_rate">
          <template #default="{ row }">
            <template v-if="isView">{{ row.scrap_rate }}</template>
            <template v-else>
              <el-input-number v-if="isEditing(row, 'scrap_rate')" v-model="row.scrap_rate" :min="0" :max="100" :precision="2" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.scrap_rate }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="110" prop="remark">
          <template #default="{ row }">
            <template v-if="isView">{{ row.remark }}</template>
            <template v-else>
              <el-input v-if="isEditing(row, 'remark')" v-model="row.remark" size="small" @blur="stopEdit" v-focus />
              <div v-else class="editable-cell">{{ row.remark }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column v-for="f in bodyFieldDefs" :key="'matbf_' + f.field_key" :label="f.field_name" min-width="130">
          <template #default="{ row }">
            <template v-if="isView">{{ lineFieldText(row, f) }}</template>
            <template v-else>
              <el-input-number v-if="f.field_type === 'number'" v-model="ensureLineFv(row)[f.field_key]" :controls="false" size="small" style="width:100%" />
              <el-date-picker v-else-if="f.field_type === 'date'" v-model="ensureLineFv(row)[f.field_key]" type="date" value-format="YYYY-MM-DD" size="small" style="width:100%" />
              <el-select v-else-if="f.field_type === 'select'" v-model="ensureLineFv(row)[f.field_key]" clearable size="small" style="width:100%">
                <el-option v-for="opt in parseFieldOptions(f.options_json)" :key="opt" :label="opt" :value="opt" />
              </el-select>
              <el-input v-else-if="f.field_type === 'textarea'" v-model="ensureLineFv(row)[f.field_key]" type="textarea" :rows="1" size="small" />
              <el-input v-else v-model="ensureLineFv(row)[f.field_key]" size="small" />
            </template>
          </template>
        </el-table-column>
        <el-table-column v-if="!isView" label="" width="44" align="center">
          <template #default="{ row }"><el-button link type="danger" size="small" @click="removeLine(row)">删</el-button></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button type="primary" @click="matDlgVisible = false">完成</el-button>
      </template>
    </el-dialog>

    <!-- 组装单：成品有多个 BOM 时，选对应 BOM 展开 -->
    <el-dialog v-model="bomDlgVisible" :title="'选择 BOM · ' + ((bomDlgRow && (bomDlgRow.item_name || bomDlgRow.item_code)) || '成品')" width="520px" append-to-body>
      <div class="mat-dlg-hint" style="margin-bottom:8px">该成品有多个 BOM，请选择本次组装采用的 BOM：</div>
      <el-table v-col-width="'scm_DocForm_6'" :data="bomDlgOptions" border size="small" highlight-current-row style="width:100%" @row-click="(r:any) => pickBom(r.id)">
        <el-table-column label="BOM编码" prop="code" width="150" />
        <el-table-column label="BOM名称" prop="name" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default="{ row }"><el-button link type="primary" size="small" @click.stop="pickBom(row.id)">选用</el-button></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="bomDlgVisible = false">取消</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { shouldShowCurrencyHeader } from '@/utils/scmCurrencyHeader'
import { todayStr } from '@/utils/format'
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, nextTick, defineAsyncComponent, onErrorCaptured } from 'vue'
import { useGlStartDate } from '@/composables/useGlStartDate'
const { isBeforeGlStart } = useGlStartDate()
/** 单据日期不得早于总账开账日期；期初入库（IS）录的就是开账前库存，不限 */
const disableDocDate = (d: Date) => form.value.doc_type !== 'IS' && isBeforeGlStart(d)
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowDown, Plus, Connection, Goods, Printer, Setting } from '@element-plus/icons-vue'
import { scmApi, SOURCE_TYPES, type ScmDocType, type ScmDocFieldDef, type ScmPaymentSource, type ScmPaymentOpenReturn, type ScmAuxRequiredField } from '@/api/scm'
import { cashierApi, type CashierAccount } from '@/api/cashier'
import { LINE_OPT_COLS, HEADER_OPT_COLS, type ColMeta } from '@/config/scmColumns'
import { useAutoBlankRow } from '@/composables/useAutoBlankRow'
import { useScopedColumnWidth } from '@/composables/useColumnWidthMemory'
import { resetColWidth } from '@/directives/colWidth'
import { hasPermission } from '@/utils/permission'
import { PUSH_MAP, pushTarget, isPushProgressDoc, docGeneratesVoucher, paymentVoucherByCashier, canGenerateDownstream, canShowStandardPushAction, downstreamActionLabel, normalizePushProgress } from '@/utils/scmDoc'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useScmDecimalsStore } from '@/stores/scmDecimals'
import { resolveDefaultWarehouse } from '@/utils/scmDefaultWarehouse'
import { confirmAuditDefaultWarehouses } from '@/utils/scmAuditDefaultWarehouseConfirm'
import { genScmVoucher } from '@/utils/scmVoucherAux'
import { buildSalesDispatchLines } from '@/utils/scmSalesDispatch'
import { buildMultiSourceRemainingLines, commonSourceHeaderValue, sourceFieldValues } from '@/utils/scmMultiSource'
import { useTabsStore } from '@/stores/tabs'
import {
  createScmDocEditSnapshot,
  canEditScmDocument,
  isScmDocumentFormRoute,
  readScmDocNavContext,
  scmDownstreamMrpRoute,
  scmDocNavContextToListQuery,
} from '@/utils/scmDocNavigation'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, mergeHiddenColumnVisibility, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

// 仅在用户真正打开选择器/弹窗或查看已有单据时加载，避免空白新增单首屏解析整套重组件。
const ItemPicker = defineAsyncComponent(() => import('@/components/scm/ItemPicker.vue'))
const ItemBatchPicker = defineAsyncComponent(() => import('@/components/scm/ItemBatchPicker.vue'))
const SourceDocPicker = defineAsyncComponent(() => import('@/components/scm/SourceDocPicker.vue'))
const PartnerDialog = defineAsyncComponent(() => import('@/components/scm/PartnerDialog.vue'))
const WarehouseDialog = defineAsyncComponent(() => import('@/components/scm/WarehouseDialog.vue'))
const BinDialog = defineAsyncComponent(() => import('@/components/scm/BinDialog.vue'))
const AuxItemDialog = defineAsyncComponent(() => import('@/components/base/AuxItemDialog.vue'))
const DocNavPager = defineAsyncComponent(() => import('@/components/scm/DocNavPager.vue'))
const ScmPushMenu = defineAsyncComponent(() => import('@/components/scm/ScmPushMenu.vue'))

const route = useRoute()
const router = useRouter()
const systemParams = useSystemParamsStore()
systemParams.load()

const formRenderError = ref<Error | null>(null)
onErrorCaptured((err, _instance, info) => {
  console.error('DocForm error captured:', err, info)
  // 只有渲染 / 初始化阶段的错误才替换成错误页；按钮事件里的接口失败（带 response）不能清空整张单据
  if ((err as any)?.response || /event handler/i.test(String(info || ''))) return false
  formRenderError.value = err as Error
  // return false to prevent this error from bubbling up and crashing the entire RouterView
  return false
})
const tabsStore = useTabsStore()
// 本组件实例挂载时被赋予的标签 key（Layout.vue 用 :key="tabsStore.activeKey" 驱动 keep-alive）。
// 挂载即意味着此刻自己就是激活标签，故创建时的 activeKey 就是"我"的身份，全生命周期不变——
// 用它来判断下面几个监听全局 route 的 watcher 触发时，是不是真的因为「我」被激活/路由变化，
// 而不是同时打开的另一个供应链单据标签（不同 doc_type/不同单据）跳转时，被误伤连带触发。
const myTabKey = tabsStore.activeKey

// 路由模式判断
const isNew  = computed(() => route.name === 'ScmDocNew')
const isView = computed(() => route.name === 'ScmDocView')
const editId = computed(() => isNew.value ? null : (route.params.id as string))
const initDocType = computed(() => (route.query.doc_type as string) || '')
const initPlanId = computed(() => String(route.query.plan_id || '').trim())
const initSourceDocIds = computed(() => {
  const raw = route.query.source_doc_ids
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',')
  const ids = values.map(value => String(value || '').trim()).filter(Boolean)
  const single = String(route.query.source_doc_id || '').trim()
  return Array.from(new Set(ids.length ? ids : (single ? [single] : [])))
})
const docNavContext = computed(() => readScmDocNavContext(route.query))

const types       = ref<ScmDocType[]>([])
const warehouses  = ref<any[]>([])
const allPartners = ref<any[]>([])
const persons     = ref<any[]>([])  // 业务员（人员核算档案）
const depts       = ref<any[]>([])  // 部门（部门核算档案）
const personCatId = ref('')         // 人员核算 类别id
const deptCatId   = ref('')         // 部门核算 类别id
const settleTypes = ref<any[]>([])  // 结算方式（出纳结算字典）
const cashierAccounts = ref<CashierAccount[]>([]) // 收付款实际使用的现金/银行末级科目
const currencyOptions = ref<string[]>(['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'])  // 币别字典（scm:currencies 可覆盖）
// 多币种双轨：账套币种表（名称 / 本位币）；本位币单据汇率恒 1，外币单据带出记账汇率
const currencyMeta = ref<{ base: string; list: Array<{ code: string; name: string; is_base: number }> }>({ base: 'RMB', list: [] })
const normCurrency = (c: unknown) => { const code = String(c || '').trim().toUpperCase(); return code === 'CNY' ? 'RMB' : code }
const isForeignCurrency = computed(() => { const c = normCurrency(form.value.currency); return !!c && c !== normCurrency(currencyMeta.value.base) })
const currencySymbol = computed(() => isForeignCurrency.value ? `${normCurrency(form.value.currency)} ` : '¥')
function currencyLabel(code: string) { const m = currencyMeta.value.list.find(c => normCurrency(c.code) === normCurrency(code)); return m?.name ? `${code} ${m.name}` : code }
async function loadCurrencyMeta() {
  try {
    const r = await scmApi.getCurrencies()
    if (r.code === 0) {
      currencyMeta.value = r.data
      const codes = r.data.list.map(c => c.code)
      if (codes.length) currencyOptions.value = Array.from(new Set(['CNY', ...codes.filter(c => normCurrency(c) !== 'RMB'), ...currencyOptions.value.filter(c => codes.includes(c))]))
    }
  } catch { /* 无币种表时沿用字典 */ }
}
async function onCurrencyChange() {
  if (isView.value) return
  if (isPaymentDoc.value && form.value.partner_code) void loadPaymentSources(false)   // 币别变了，源单要按新币别重列
  if (!isForeignCurrency.value) { form.value.exchange_rate = 1; return }
  try {
    const r = await scmApi.getCurrencyRate(form.value.currency, form.value.doc_date)
    if (r.code === 0 && Number(r.data.rate) > 0) form.value.exchange_rate = Number(r.data.rate)
  } catch { /* 取不到汇率则保留手填 */ }
}
const ioCategoryOptions = ref<string[]>([])   // 收发类别字典（scm:io_categories）
// 第五份反馈：其他入库 / 其他出库内置收发类别（生产领用、成品入库带生产成本科目，见进销存凭证设置），再并上字典
const BUILTIN_IO_CATEGORIES: Record<string, string[]> = { OI: ['成品入库', '盘盈', '其他入库'], OO: ['生产领用', '盘亏', '报废', '其他出库'] }
const ioCategoryChoices = computed(() => {
  const builtin = BUILTIN_IO_CATEGORIES[form.value.doc_type] || []
  return [...new Set([...builtin, ...ioCategoryOptions.value])]
})
const transportOptions  = ref<string[]>([])   // 运输方式字典（scm:transport_methods）
const bins        = ref<any[]>([])  // 库位档案（参考用）
const partnerSearch = ref('')
const boms        = ref<any[]>([])
const productionPlans = ref<any[]>([])
// 已生成凭证（详情接口带出）：表头按钮显示「凭证 记-001」，点击打开凭证查询
const docVoucher = ref<{ id: string; voucher_no: string; year: number; period: number; status: string; voucher_type_name?: string | null } | null>(null)
const docVoucherLabel = computed(() => {
  const v = docVoucher.value
  if (!v) return ''
  const no = String(v.voucher_no || '')
  const type = String(v.voucher_type_name || '').slice(0, 1)
  return type && !no.includes('-') ? `${type}-${no}` : no
})
const planExecutionInfo = ref({ planned_qty: 0, executed_qty: 0, max_allowed_qty: 0, overrun_remaining: 0 })
// 领料 / 委外发料 / 退料：来源工单取不到任何用料（未选 BOM 或 BOM 无主件）
const planNoMaterial = ref(false)
const selectedBom = ref('')
const saving      = ref(false)
const auditing    = ref(false)

const isProduction = computed(() => ['PL','PF','PB','PJ','AS','DS'].includes(form.value.doc_type))
// FIX-212：退料(PJ)/不良品入库(PS) 同样必须关联工单——无工单的退料按 0 成本回冲原料仓、不良品不写报废数不冲在制
const isPlanControlledDoc = computed(() => ['PL', 'PB', 'PF', 'WO', 'WI', 'PJ', 'PS', 'OP'].includes(form.value.doc_type))
const isOpOutsource = computed(() => form.value.doc_type === 'OP')   // 工序委外：自制工单的某道工序发外加工
const showPlanOverrunInfo = computed(() => isNew.value && isPlanControlledDoc.value && !!form.value.plan_id)
function isProductionPlanCompleted(plan: any): boolean {
  const planQty = Number(plan.total_plan_qty ?? plan.plan_qty) || 0
  const finishedQty = Number(plan.total_finished_qty ?? plan.finished_qty) || 0
  return planQty > 0 && finishedQty >= planQty - 1e-6
}
const availableProductionPlans = computed(() => {
  const outsource = ['WO', 'WI'].includes(form.value.doc_type)
  return productionPlans.value.filter((plan: any) => {
    const matchesType = plan.status === 'released' && (plan.plan_type === 'outsource') === outsource
    const isCurrentPlan = !!form.value.plan_id && String(plan.id) === String(form.value.plan_id)
    return matchesType && (isCurrentPlan || !isProductionPlanCompleted(plan))
  })
})
const isAssembly   = computed(() => form.value.doc_type === 'AS')  // 组装单：成品行+子件行模式
// 组装单加工方式：委托加工(entrust，加工费计成本、挂应付) / 受托加工(contract，加工费挂应收)；空 = 自行组装
const asNeedsPartner = computed(() => isAssembly.value && ['entrust', 'contract'].includes(form.value.process_mode))
/** 成品行加工费 = 数量 × 加工单价（不含税） */
const asProcessAmount = (row: any) => round2((Number(row.qty) || 0) * (Number(row.process_fee) || 0))
/** 成品行加工费税额 = 加工费 × 税率（行税率为空取表头税率；后端保存时按同一口径重算） */
const asProcessTax = (row: any) => round2(asProcessAmount(row) * effTax(row) / 100)
/** 含税加工单价 = 加工单价 × (1 + 税率) */
const asFeeWithTax = (row: any) => round4((Number(row.process_fee) || 0) * (1 + effTax(row) / 100))
/** 改加工单价 / 税率：同步含税单价与税额 */
function asRecalcFeeTax(row: any) {
  row.price_with_tax = asFeeWithTax(row) || null
  row.tax_amount = asProcessTax(row) || null
}
/** 改含税单价：反算不含税加工单价 */
function asRecalcFeeFromTaxPrice(row: any) {
  const tr = effTax(row)
  const pwt = Number(row.price_with_tax) || 0
  row.process_fee = tr > 0 ? round4(pwt / (1 + tr / 100)) : pwt
  row.tax_amount = asProcessTax(row) || null
}
/** 客供仓：只记数量与往来，不计成本 */
const isCustomerSuppliedWh = (code?: string) => !!code && warehouses.value.some((w: any) => w.code === code && Number(w.is_customer_supplied) === 1)
function onProcessModeChange() {
  // 切换方向后原往来单位可能角色不符（客户 ↔ 供应商），清空让用户重选
  const p = allPartners.value.find((x: any) => x.code === form.value.partner_code)
  if (p && !partnerInScope(p)) { form.value.partner_code = ''; partnerSearch.value = '' }
}
const isInvoice    = computed(() => ['RP','RS'].includes(form.value.doc_type))
const isTransfer   = computed(() => form.value.doc_type === 'TR')
const isCount      = computed(() => form.value.doc_type === 'CK')
const isShipment   = computed(() => form.value.doc_type === 'SO')
const isPurchaseReturn = computed(() => form.value.doc_type === 'PR')  // 采购退货：出库扣库存，仓库必填
const isMr         = computed(() => form.value.doc_type === 'MR')
const isPaymentDoc = computed(() => ['PAY', 'RCV'].includes(form.value.doc_type))
const isReceivePayment = computed(() => form.value.doc_type === 'RCV')
const isAdvancePaymentMode = computed(() => isNew.value && isPaymentDoc.value && route.query.payment_mode === 'advance')
const paymentPartnerLabel = computed(() => isPaymentDoc.value ? (isReceivePayment.value ? '客户' : '供应商')
  : asNeedsPartner.value ? (form.value.process_mode === 'contract' ? '客户' : '加工厂')
  : (isCustomerDoc.value ? '客户' : '往来单位'))
// 成本类入库单：完工入库(PF)/委外入库(WI)——成本由审核时按工单归集生成，落在 unit_cost/total_amount，
// 不走 price/amount（录入进价）管线，故单价/金额列与合计需改读成本口径。
const isCostInbound = computed(() => ['PF', 'WI'].includes(form.value.doc_type))
// 已审核完工/委外入库查看态支持双击明细行，原位展开该成品的成本计算来源。
const costLineExpandEnabled = computed(() => isView.value && isCostInbound.value && form.value.status === 'audited')
const costDetailLoading = ref(false)
const costDetailLoaded = ref(false)
const costLineDetails = ref<any[]>([])
const expandedCostRows = ref<Set<any>>(new Set())

function costDetailFor(row: any): any {
  if (!row || row.__summary) return null
  return costLineDetails.value.find((detail: any) =>
    Number(detail.seq) === Number(row.seq)
    || (!row.seq && detail.item_code === row.item_code)
  ) || null
}

async function loadCostLineDetails() {
  if (costDetailLoaded.value || costDetailLoading.value || !editId.value) return
  costDetailLoading.value = true
  try {
    const r = await scmApi.getDocCostDetail(editId.value)
    if (r.code === 0 && r.data?.applicable) {
      costLineDetails.value = r.data.lines || []
      costDetailLoaded.value = true
    } else {
      ElMessage.warning('当前单据暂无可展开的成本计算来源')
    }
  } finally {
    costDetailLoading.value = false
  }
}

function handleCostExpandChange(row: any, expandedRows: any[]) {
  expandedCostRows.value = new Set(expandedRows || [])
  if (costLineExpandEnabled.value && expandedCostRows.value.has(row) && !costDetailFor(row)) {
    void loadCostLineDetails()
  }
}
// 当前单据类型对象（含 direction/affects_stock）
const docTypeObj = computed(() => types.value.find(x => x.code === form.value.doc_type))
// 出库/耗库类：direction=out 的减库存单据（领料PL/补料PB/委外发货WO/其他出库OO/销售出库SO/采购退货PR）
// + 调拨(TR，按调出仓)；组装子件(AS)在子件选择器单独判定 → 物料默认只看有库存
/** 采购询价 / 订单选物料默认「采购」来源（选择器里可切回全部，搜不到时自动放开） */
const lineDefaultSource = computed(() => (['PQ', 'PO'].includes(form.value.doc_type) ? 'purchase' : ''))
const isOutbound = computed(() => (docTypeObj.value?.direction === 'out' && !!docTypeObj.value?.affects_stock) || isTransfer.value)
// 物料选择器取库存用的仓库：调拨按「调出仓」(表头，行仓是调入仓不能用)，其余行仓优先、回退表头
function lineStockWarehouse(row: any): string {
  if (isTransfer.value) return (form.value.warehouse_code || '') as string
  return (row?.warehouse_code || form.value.warehouse_code || '') as string
}
function openStockLedger(row: any) {
  if (!row?.item_code) return
  const query: Record<string, string> = { item_code: String(row.item_code), full_history: '1' }
  const warehouseCode = lineStockWarehouse(row)
  if (warehouseCode) query.warehouse_code = warehouseCode
  router.push({ name: 'ScmStockLedger', query })
}
// 双击批量选择器取库存仓库（同上口径，取触发行）
const batchPickerWarehouse = computed(() => lineStockWarehouse(lines.value[batchPickerRowIndex.value]))
// 销售类单据：往来单位（客户）必填（销售报价、销售订单、销售出库）
const isCustomerDoc = computed(() => ['SQ', 'SOa', 'SO', 'SR'].includes(form.value.doc_type))
// 与后端 scmDocumentControls.ts 的 PARTNER_REQUIRED_DOC_TYPES 保持一致
const PARTNER_REQUIRED_TYPES = ['PQ', 'PO', 'PI', 'PR', 'SQ', 'SOa', 'SO', 'SR']
const partnerRequired = computed(() => PARTNER_REQUIRED_TYPES.includes(form.value.doc_type) || asNeedsPartner.value)
const isSalesOrderOrDispatch = computed(() => ['SOa', 'SO'].includes(form.value.doc_type))

// 采购/销售类单据：支持「查询实时库存」（含订单/入出库/退货/发票）
const isPurchaseOrSale = computed(() => ['PQ','PO','PI','PR','RP','SQ','SOa','SO','SR','RS'].includes(form.value.doc_type))
// 币别 / 记账汇率：采购、销售类单据一律可选外币，其余类型按字段配置；「隐藏字段」可关闭
const showCurrency = computed(() => shouldShowCurrencyHeader(form.value.doc_type, headerCols.value, headerHidden.value))
// 领料/补料/委外发货同为库存消耗单据，复用销售订单的实时库存查询和逐行展示。
const supportsRealtimeStock = computed(() =>
  isPurchaseOrSale.value || ['PL', 'PB', 'WO'].includes(form.value.doc_type))
// 收发类别（其他出入库/盘点/调拨）；运输方式（销售/采购出入库与退货）
const showIoCategory = computed(() => ['OI','OO','TR','CK'].includes(form.value.doc_type))
const showTransport  = computed(() => ['SO','SR','PI','PR'].includes(form.value.doc_type))

// ── 取价口径（多级售价/价格政策） ──────────────────────────────────────
const SALE_DOCS = ['SQ', 'SOa', 'SO', 'SR', 'RS']
const PURCHASE_DOCS = ['PQ', 'PO', 'PI', 'PR', 'RP']
const priceMode = computed<'sale' | 'purchase' | 'cost'>(() =>
  SALE_DOCS.includes(form.value.doc_type) ? 'sale'
    : PURCHASE_DOCS.includes(form.value.doc_type) ? 'purchase' : 'cost')
// 成本类出库单：生产领用PL / 补料PB / 委外发货WO——领料成本由审核时按「移动平均成本」出库计算、
// 落在 unit_cost，行 price 不参与；草稿期无成本（与完工入库同一模型）。
// 注：其他出库OO/调拨TR 用户可能自录成本，暂不纳入，避免改动其展示。
const isCostOutbound = computed(() => ['PL', 'PB', 'WO'].includes(form.value.doc_type))
// 成本类单据（入库 PF/WI + 出库 PL/PB/WO/OO）：单价/金额/合计按 unit_cost 口径展示，成本在审核时定
const isCostDoc = computed(() => isCostInbound.value || isCostOutbound.value)
// 成本合计 = Σ(成本单价 × 数量)：PF/WI 审核已写 total_amount，出库单未写，统一按行 unit_cost 汇总，两者一致
const costTotalAmount = computed(() => round2(lines.value.reduce((s, l) => s + (Number(l.unit_cost) || 0) * (Number(l.qty) || 0), 0)))
// 往来单位适用范围：销售类→客户、采购类→供应商、其他→全部（双向/未分类两类都可）
const partnerScope = computed<'customer' | 'supplier' | 'all'>(() =>
  isPaymentDoc.value ? (isReceivePayment.value ? 'customer' : 'supplier')
    : asNeedsPartner.value ? (form.value.process_mode === 'contract' ? 'customer' : 'supplier')
    : priceMode.value === 'sale' ? 'customer' : priceMode.value === 'purchase' ? 'supplier' : 'all')
function partnerInScope(p: any): boolean {
  if (partnerScope.value === 'all') return true
  const t = String(p?.partner_type || '').trim().toLowerCase()
  if (!t || t === 'both' || t === '双向' || t === '3') return true   // 双向/未分类：客户、供应商均可
  return partnerScope.value === 'customer'
    ? /customer|客户|^1$/.test(t)
    : /supplier|供应|^2$/.test(t)
}
// 当前往来单位（用于销售取价等级）
const currentPartner = computed(() => allPartners.value.find((p: any) => p.code === form.value.partner_code))
// 按价格等级取售价（缺该档则回退一级售价）
function salePriceByLevel(item: any, level: any): number {
  const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 1
  const p = lv === 3 ? item.sale_price3 : lv === 2 ? item.sale_price2 : item.sale_price
  return Number(p) || Number(item.sale_price) || 0
}
// 开单按单据类型取价：销售→按客户等级售价；采购→进价；其他→参考成本
function pickItemPrice(item: any): number {
  if (priceMode.value === 'sale') return salePriceByLevel(item, currentPartner.value?.price_level)
  if (priceMode.value === 'purchase') return Number(item.purchase_price) || Number(item.ref_cost) || 0
  return Number(item.ref_cost) || Number(item.purchase_price) || 0
}
const stockShown = ref(false)
const stockLoading = ref(false)
const stockByWh = ref<Record<string, Record<string, number>>>({})
const stockTotal = ref<Record<string, number>>({})
async function loadRealtimeStock() {
  stockLoading.value = true
  try {
    const r = await scmApi.getStock()
    const byWh: Record<string, Record<string, number>> = {}
    const total: Record<string, number> = {}
    for (const s of (r.code === 0 ? (r.data || []) : []) as any[]) {
      const item = s.item_code; const wh = s.warehouse_code || ''; const qty = Number(s.qty) || 0
      if (!byWh[item]) byWh[item] = {}
      byWh[item][wh] = (byWh[item][wh] || 0) + qty
      total[item] = (total[item] || 0) + qty
    }
    stockByWh.value = byWh
    stockTotal.value = total
    stockShown.value = true
  } finally {
    stockLoading.value = false
  }
}
const stockNum = (v: number) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
function stockText(row: any): string {
  if (!row?.item_code) return '—'
  const total = stockTotal.value[row.item_code] || 0
  const wh = row.warehouse_code || form.value.warehouse_code
  if (wh) {
    const whQty = stockByWh.value[row.item_code]?.[wh] || 0
    return `本仓 ${stockNum(whQty)} / 合计 ${stockNum(total)}`
  }
  return `合计 ${stockNum(total)}`
}
// 自制/组装来源：无供应商（缺料单供应商列显示「—」）
const noSupplierSrc = (st?: string) => st === 'self' || st === 'assembly'
// 缺料单行供应商候选：委外行→委外厂，其余→供应商/双向
function rowSupplierOptions(row: any) {
  if (row?.source_type === 'outsource') return allPartners.value.filter((p: any) => p.enabled !== 0 && p.is_outsource === 1)
  return allPartners.value.filter((p: any) => {
    const t = String(p.partner_type || '')
    return p.enabled !== 0 && (!t || /supplier|供应|both|2/i.test(t))
  })
}

// ── 单据类型字段配置（差异化表单）──
const parseCfg = (s?: string): string[] => { try { return s ? JSON.parse(s) : [] } catch { return [] } }
const typeConfig = computed(() => {
  const t = types.value.find(x => x.code === form.value.doc_type)
  return {
    header: parseCfg(t?.header_fields),
    line: parseCfg(t?.line_fields),
    required: parseCfg(t?.required_fields),
  }
})
// 表头字段块：有配置用配置，否则兜底显示往来单位+仓库（兼容未知类型）
const headerCols = computed<Set<string>>(() => new Set(typeConfig.value.header.length ? typeConfig.value.header : ['partner', 'warehouse']))
// 标准表头字段是否显示：类型配置允许 且 未被列方案隐藏（表头 target=header）
const hcol = (k: string) => headerCols.value.has(k) && !headerHidden.value.has(k)
// 明细列：有配置用配置，否则按旧逻辑兜底（发票类带税率税额）
const lineCols = computed<Set<string>>(() => {
  const s = typeConfig.value.line.length
    ? new Set(typeConfig.value.line)
    : new Set(['item', 'warehouse', 'qty', 'price'])
  if (isInvoice.value) { s.add('tax_rate'); s.add('tax_amount') }
  // 采购 / 销售类单据往来按价税合计挂账：含税单价、税率、税额、价税合计必须默认可见，
  // 否则表体只显示不含税金额，与往来余额、收付款金额对不上（客户反馈）。仍可用列方案隐藏。
  if (isPurchaseOrSale.value) {
    s.add('price_with_tax')
    s.add('tax_rate')
    s.add('tax_amount')
  }
  // 委外入库加工费按税前单价维护，税率/税额必须可见且可调整。
  if (form.value.doc_type === 'WI') {
    s.add('process_fee')
    s.add('tax_rate')
    s.add('tax_amount')
    // 加工费由采购在委外计划中定，入库多由仓库操作：无「委外加工单价修改」权限时不显示加工单价 / 税率 / 税额 / 价税合计
    //（客户测试 20261011「此外不能显示出来」；保存时后端按计划价写入）
    if (!canEditOutsourcePrice.value) for (const k of ['process_fee', 'tax_rate', 'tax_amount', 'price_with_tax']) s.delete(k)
  }
  return s
})
const col = (k: string) => lineCols.value.has(k)
// 批次列：配置开启 或 行内存在批次管理物料时显示
const showBatchCols = computed(() => col('batch_no') || lines.value.some((l: any) => l._batch))
// 序列号列：行内存在序列号管理物料时显示
const showSerialCols = computed(() => lines.value.some((l: any) => l._serial))
// 库位列：系统中已建库位档案时显示（参考用）
const showBinCol = computed(() => bins.value.length > 0)
const binsForWh = (wh: string) => bins.value.filter((b: any) => b.warehouse_code === (wh || form.value.warehouse_code))
// 仓库编码 → 名称（显示用；档案缺名回退编码）
const whName = (code: string) => { if (!code) return ''; const w = warehouses.value.find((x: any) => x.code === code); return w ? (w.name || code) : code }

// ── 列方案（管理员建方案分配用户；有 scm:colscheme 权限者可临时调整，无权限锁定）──
const canColScheme = computed(() => hasPermission('scm:colscheme'))
function outsourcePriceLocked(row: any) {
  return form.value.doc_type === 'WI' && !canEditOutsourcePrice.value && !!row?.item_code && !!planPriceMap.value[row.item_code]
}
/** 有权限的人改过加工单价时，提示与计划单价不同 */
function outsourcePriceDiff(row: any) {
  const p = form.value.doc_type === 'WI' && row?.item_code ? planPriceMap.value[row.item_code] : undefined
  return !!p && (Number(row.process_fee) || 0) !== p.fee
}
function outsourcePriceTitle(row: any) {
  if (outsourcePriceLocked(row)) return '加工单价取委外计划，无「委外加工单价修改」权限不能修改'
  if (outsourcePriceDiff(row)) return `与委外计划加工单价 ${planPriceMap.value[row.item_code].fee} 不同`
  return ''
}
// 「配置」下拉合并「列设置」+「字段设置」+「方案管理」，两个 popover 由 visible 显式控制
const configBtnRef = ref<HTMLElement | null>(null)
const colSettingVisible = ref(false)
const fieldSettingVisible = ref(false)
/** 配置按钮可见：有 scm:colscheme 权限，且至少有一个子项可用（列设置非收付款单 / 字段设置有可选项） */
const showConfigBtn = computed(() =>
  canColScheme.value && (!isPaymentDoc.value || hasFieldSettingOpts.value)
)
function onConfigCommand(cmd: string) {
  if (cmd === 'schemes') {
    router.push('/scm/col-schemes')
    return
  }
  if (cmd === 'fielddefs') {
    router.push('/scm/doc-field-defs')
    return
  }
  // cols / fields：先关闭另一个，下一个 tick 再打开目标 popover（互斥显示，且等 dropdown 关闭）
  colSettingVisible.value = false
  fieldSettingVisible.value = false
  nextTick(() => {
    if (cmd === 'cols') colSettingVisible.value = true
    else if (cmd === 'fields') fieldSettingVisible.value = true
  })
}
/** 被隐藏的明细列 key 集合：初始来自分配给当前用户的方案，有权限者可在 popover 内临时增减 */
const lineHidden = ref<Set<string>>(new Set())
const lineColShown = (key: string) => !lineHidden.value.has(key)
/** 表头 / 表尾 被隐藏字段 key 集合（初始来自列方案 target=header/footer，有权限者可在「字段设置」浮层临时增减） */
const headerHidden = ref<Set<string>>(new Set())
const footerHidden = ref<Set<string>>(new Set())
/** 每个可选列在当前单据类型下是否"本就会出现"（方案只能在可用列里做隐藏） */
function lineColAvailable(key: string): boolean {
  switch (key) {
    case 'realtime_stock': return true   // 点「查询实时库存」后才渲染，但设置里始终可见，便于预先设为隐藏
    case 'price_with_tax': return col('price_with_tax')
    case 'discount_rate':  return col('discount_rate')
    case 'tax_rate':       return col('tax_rate')
    case 'tax_amount':
    case 'gross_amount':   return col('tax_amount')
    case 'batch_no':
    case 'produce_date':   return showBatchCols.value
    case 'expire_date':    return showBatchCols.value || col('expire_date')
    case 'bin_no':         return showBinCol.value
    case 'scrap_rate':     return col('scrap_rate')
    case 'process_fee':    return col('process_fee')
    case 'remark':         return true
    default: return false
  }
}
async function loadLineColScheme() {
  const dt = form.value.doc_type
  if (!dt) return
  try {
    const res = await scmApi.getMyColScheme({ target: 'line', doc_type: dt })
    if (res.code === 0) lineHidden.value = new Set(res.data.hidden_cols || [])
  } catch { /* 无方案则全显示 */ }
}
/** 加载当前用户在该单据类型下的「表头 / 表尾」列方案（隐藏字段 key 集合） */
async function loadHeaderFooterColScheme() {
  const dt = form.value.doc_type
  if (!dt) { headerHidden.value = new Set(); footerHidden.value = new Set(); return }
  try {
    const [h, f] = await Promise.all([
      scmApi.getMyColScheme({ target: 'header', doc_type: dt }),
      scmApi.getMyColScheme({ target: 'footer', doc_type: dt }),
    ])
    headerHidden.value = new Set(h.code === 0 ? (h.data.hidden_cols || []) : [])
    footerHidden.value = new Set(f.code === 0 ? (f.data.hidden_cols || []) : [])
  } catch { headerHidden.value = new Set(); footerHidden.value = new Set() }
}

const DOC_TITLE: Record<string, string> = {
  IS:'期初入库', PI:'采购入库', PR:'采购退货', SO:'销售出库', SR:'销售退货',
  OI:'其他入库', OO:'其他出库', TR:'调拨单', CK:'盘点单',
  PL:'生产领用', PF:'完工入库', PS:'不良品入库', PB:'补料单', PJ:'退料单',
  WO:'委外发货', WI:'委外入库', AS:'组装单', DS:'拆卸单',
  PO:'采购订单', PQ:'采购询价', SQ:'销售报价', SOa:'销售订单',
  RP:'采购发票', RS:'销售发票', PAY:'付款单', RCV:'收款单', MR:'缺料单',
}

const saveAsTitle = computed(() => {
  const typeName = isAdvancePaymentMode.value ? (isReceivePayment.value ? '预收款单' : '预付款单') : (DOC_TITLE[form.value.doc_type] || form.value.doc_type || '单据')
  return [typeName, form.value.doc_no].filter(Boolean).join(' ')
})
const saveAsFooter = computed(() => [
  form.value.maker ? `制单：${form.value.maker}` : '',
  form.value.auditor ? `审核：${form.value.auditor}` : '',
  form.value.status ? `状态：${form.value.status === 'audited' ? '已审核' : '草稿'}` : '',
].filter(Boolean).join('　'))

const pageTitle = computed(() => {
  if (isAdvancePaymentMode.value) return `新增${isReceivePayment.value ? '预收款单' : '预付款单'}`
  const typeName = DOC_TITLE[form.value.doc_type] || form.value.doc_type || '单据'
  if (isNew.value) return `新增${typeName}`
  if (isView.value) return `查看${typeName}`
  return `编辑${typeName}`
})

// 明细表最大高度：动态计算（视口底 − 表格顶 − 底部预留），内容少时 max-height 让表格自动收缩、
// 水平滚动条贴近合计行；内容多时表格内部滚动，不超出视口。
const linesTableRef = ref<any>(null)
const tableMaxHeight = ref<number>(420)
function calcTableMaxHeight() {
  const el = linesTableRef.value?.$el as HTMLElement | undefined
  if (!el) return
  const top = el.getBoundingClientRect().top
  tableMaxHeight.value = Math.max(180, Math.floor(window.innerHeight - top - 28))
}
onMounted(() => { nextTick(calcTableMaxHeight); window.addEventListener('resize', calcTableMaxHeight) })
onBeforeUnmount(() => window.removeEventListener('resize', calcTableMaxHeight))

const form = ref<Record<string, any>>({
  doc_type: '', doc_no: '', doc_date: todayStr(),
  warehouse_code: '', partner_code: '', operator: '', remark: '', status: 'draft', bom_id: '', source_doc_id: '', plan_id: '',
  biz_person: '', dept_code: '', payment_type: '', settle_account: '', invoice_type: '', invoice_no: '', invoice_date: '',
  contract_no: '', currency: 'CNY', exchange_rate: 1, discount_rate: null, expect_date: '', credit_days: null,
  io_category: '', transport_method: '', tax_rate: null, process_mode: '', field_values: {},
})
// ── 委外加工单价管控（客户测试 20261011）：加工单价在委外计划中制定，入库带出；
//    无「委外加工单价修改」权限时，计划成品行的加工单价 / 税率只读（后端保存时同样强制取计划价）
const canEditOutsourcePrice = computed(() => hasPermission('scm:outsource-price'))
const OUTSOURCE_PRICE_FIELDS = new Set(['process_fee', 'tax_rate', 'tax_amount'])
const planPriceMap = ref<Record<string, { fee: number; rate: number }>>({})
watch(() => [form.value.doc_type, form.value.plan_id] as const, async ([docType, planId]) => {
  planPriceMap.value = {}
  if (docType !== 'WI' || !planId) return
  try {
    const r = await scmApi.getProductionPlan(String(planId))
    if (r.code !== 0 || form.value.plan_id !== planId) return
    const map: Record<string, { fee: number; rate: number }> = {}
    for (const p of (r.data.products || []) as any[]) map[p.item_code] = { fee: Number(p.process_fee) || 0, rate: Number(p.process_tax_rate) || 0 }
    planPriceMap.value = map
  } catch { /* 取不到计划价时不做只读控制，后端仍会兜底 */ }
}, { immediate: true })
// 记录上次由往来单位自动带入的值：切换单位时可更新旧默认值，手工改过的值则保留。
const partnerHeaderDefaults = ref<{ bizPerson?: string; taxRate?: number | null }>({})
const lines = ref<Array<Record<string, any>>>([])
// 工单领料类单据存在可用替代料时才出现「可用替代料」列（纳入列设置，可调序）
const showSubstituteCol = computed(() => isPlanControlledDoc.value && lines.value.some((l: any) => l._substitutes?.length))
type PaymentSourceRow = ScmPaymentSource & {
  selected: boolean
  current_amount: number | null
  payment_remark: string
  invalid?: boolean
}
const paymentSources = ref<PaymentSourceRow[]>([])
const paymentOpenReturns = ref<ScmPaymentOpenReturn[]>([])
const paymentSourceLoading = ref(false)
const advanceAmount = ref(0)
const advanceRemark = ref('')
const paymentPartnerCode = ref('')

// ── 组装单：多成品；子件按成品分行(product_group) → 成本按成品归集 ──
// 展示层：成品表 + 只读「总用料表」（相同物料合并）；单成品物料在弹窗里增删改。
const productLines = computed(() => lines.value.filter(l => l.line_role === 'product'))
const componentLines = computed(() => lines.value.filter(l => l.line_role !== 'product'))
/** 下一个可用成品组号 = 现有成品行最大组号 + 1 */
function nextProductGroup(): number {
  const max = productLines.value.reduce((m, p) => Math.max(m, Number(p.product_group) || 0), 0)
  return max + 1
}
/** 子件「总用料表」：按物料编码聚合；保留来源行，便于在汇总表统一调整出库仓。 */
const mergedMaterials = computed(() => {
  const map = new Map<string, any>()
  for (const c of componentLines.value) {
    if (!c.item_code) continue
    let m = map.get(c.item_code)
    if (!m) { m = { item_code: c.item_code, item_name: c.item_name || '', spec: c.spec || '', unit: c.unit || '', qty: 0, _groups: new Set(), _rows: [] }; map.set(c.item_code, m) }
    m.qty = Math.round((m.qty + (Number(c.qty) || 0)) * 1000) / 1000
    if (c.product_group != null) m._groups.add(c.product_group)
    m._rows.push(c)
  }
  const prodName = (g: any) => { const p = productLines.value.find(x => x.product_group === g); return p ? (p.item_name || p.item_code) : '' }
  return [...map.values()].map(m => {
    const warehouseCodes = [...new Set(m._rows.map((c: any) => c.warehouse_code || form.value.warehouse_code || '').filter(Boolean))]
    return {
      ...m,
      warehouse_code: warehouseCodes.length === 1 ? warehouseCodes[0] : '',
      warehouse_mixed: warehouseCodes.length > 1,
      products: [...m._groups].map(prodName).filter(Boolean).join('、'),
    }
  })
})
/** 汇总行选择仓库时，统一回写所有对应实际子件行；仓库变化后清除可能失效的库位。 */
function setMergedMaterialWarehouse(row: any, warehouseCode: string) {
  for (const component of (row?._rows || [])) {
    if ((component.warehouse_code || '') !== (warehouseCode || '')) component.bin_no = ''
    component.warehouse_code = warehouseCode || ''
  }
}
/** 改成品数量 → 按比例重算本组子件用量（保留仓库/批号/损耗等既有编辑） */
function recomputeGroupQty(p: any, cur: any, old: any) {
  const c0 = Number(cur) || 0, o0 = Number(old) || 0
  if (o0 <= 0 || c0 === o0) return
  const ratio = c0 / o0
  for (const c of componentLines.value) {
    if (c.product_group === p.product_group) c.qty = Math.round((Number(c.qty) || 0) * ratio * 1000) / 1000
  }
}
// 单成品「物料」编辑弹窗
const matDlgVisible = ref(false)
const matDlgGroup = ref<any>(null)
const matDlgProduct = computed(() => productLines.value.find(p => p.product_group === matDlgGroup.value) || null)
const matDlgRows = computed(() => componentLines.value.filter(c => c.product_group === matDlgGroup.value))
function openMatDialog(group: any) { matDlgGroup.value = group; matDlgVisible.value = true }
// 计数排除末尾自动空行（无 item_code）
const asFilledProductCount = computed(() => productLines.value.filter(p => p.item_code).length)
const asFilledComponentCount = computed(() => componentLines.value.filter(c => c.item_code).length)

// ── 明细表末尾自动保留空行（免点「添加行」；空行不入库，各处保存已过滤）──
// 主明细（非组装单）：数组即 lines，直接用 composable
useAutoBlankRow(() => lines.value, newLine, {
  enabled: () => !isView.value && !isAssembly.value && !isPaymentDoc.value,
  filled: row => !!row?.item_code,
})
// 组装单成品表 / 物料弹窗：展示用的是 lines 的「过滤视图」（productLines/matDlgRows 是 computed，
// 不能直接 push），故用专门 watch 把空行 push 进真数组 lines.value。
watch([isAssembly, isView, () => productLines.value], () => {
  if (!isAssembly.value || isView.value) return
  const ps = productLines.value
  if (ps.length === 0 || ps[ps.length - 1].item_code) {
    const l = newLine(); l.line_role = 'product'; l.product_group = nextProductGroup(); l.qty = 1
    lines.value.push(l)
  }
}, { deep: true, immediate: true })
watch([matDlgVisible, isView, () => matDlgRows.value], () => {
  if (!matDlgVisible.value || isView.value) return
  const cs = matDlgRows.value
  if (cs.length === 0 || cs[cs.length - 1].item_code) {
    const l = newLine(); l.line_role = 'component'; l.product_group = matDlgGroup.value
    lines.value.push(l)
  }
}, { deep: true, immediate: true })
/** 组装单每表合计：仅数量列求和 */
function asSummary({ columns, data }: { columns: any[]; data: any[] }): string[] {
  return columns.map((col, i) => {
    if (i === 0) return '合计'
    if (col.property === 'qty') return fmt(data.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0))
    if (col.property === 'process_amount') return fmt(data.reduce((s: number, r: any) => s + (r.item_code ? asProcessAmount(r) : 0), 0))
    if (col.property === 'process_tax') return fmt(data.reduce((s: number, r: any) => s + (r.item_code ? asProcessTax(r) : 0), 0))
    if (col.property === 'process_gross') return fmt(data.reduce((s: number, r: any) => s + (r.item_code ? asProcessAmount(r) + asProcessTax(r) : 0), 0))
    return ''
  })
}
/** 载入/新建后：确保组装单成品/子件有组号（兼容旧单：成品补 1..n；单成品旧单子件归到唯一成品） */
function ensureAsGroups() {
  if (!isAssembly.value) return
  const prods = lines.value.filter(l => l.line_role === 'product')
  if (!prods.length) return
  prods.forEach((p, i) => { if (p.product_group == null) p.product_group = i + 1 })
  if (prods.length === 1) {
    lines.value.filter(l => l.line_role !== 'product').forEach(c => { if (c.product_group == null) c.product_group = prods[0].product_group })
  }
}

// ── 单据表头/表体/表尾自定义字段（按单据类型加载定义；表头/表尾值存 form.field_values，表体值按行存 row.field_values）──
// is_visible===0 的字段不在录入页渲染（定义与历史值保留）。
const docFieldDefs = ref<ScmDocFieldDef[]>([])
const visibleFieldDefs = computed(() => docFieldDefs.value.filter(f => f.is_visible !== 0))
// 全量（仅 is_visible 过滤）—— 供「字段设置」浮层勾选用，未叠加列方案隐藏
const allHeaderFieldDefs = computed(() => visibleFieldDefs.value.filter(f => f.position === 'header' || (f.position !== 'body' && f.position !== 'footer')))
const allFooterFieldDefs = computed(() => visibleFieldDefs.value.filter(f => f.position === 'footer'))
// 实际渲染 —— 再叠加列方案（target=header/footer）的按用户隐藏
const headerFieldDefs = computed(() => allHeaderFieldDefs.value.filter(f => !headerHidden.value.has(f.field_key)))
const bodyFieldDefs = computed(() => visibleFieldDefs.value.filter(f => f.position === 'body'))
const footerFieldDefs = computed(() => allFooterFieldDefs.value.filter(f => !footerHidden.value.has(f.field_key)))

// 该类型单据是否参与下推链路。列配置的 immediate watch 会在 setup 阶段立即读取，
// 必须先于 LINE_CORE_COLUMNS / lineColumnDefaults 初始化，避免暂时性死区。
const showPushCol = computed(() => isPushProgressDoc(form.value.doc_type))

const LINE_CORE_COLUMNS: Array<{ key: string; label: string; available?: () => boolean }> = [
  { key: 'item_code', label: '编号' },
  { key: 'item_name', label: '名称' },
  { key: 'spec', label: '规格' },
  { key: 'sales_order_no', label: '销售订单号', available: () => form.value.doc_type === 'SO' },
  { key: 'purchase_order_no', label: '采购订单号', available: () => form.value.doc_type === 'PI' },
  { key: 'plan_qty', label: '原计划', available: () => showPlanOverrunInfo.value },
  { key: 'executed_qty', label: '已执行', available: () => showPlanOverrunInfo.value },
  { key: 'max_allowed_qty', label: '超量上限', available: () => showPlanOverrunInfo.value },
  { key: 'overrun_remaining', label: '剩余额度', available: () => showPlanOverrunInfo.value },
  { key: 'warehouse_code', label: '仓库' },
  { key: 'qty', label: '数量' },
  { key: 'source_type', label: '来源', available: () => isMr.value },
  { key: 'supplier_code', label: '供应商/委外厂', available: () => isMr.value },
  { key: 'push_qty', label: '已下推数量', available: () => showPushCol.value && isView.value },
  { key: 'push_amount', label: '已下推金额', available: () => showPushCol.value && isView.value },
  { key: 'price', label: '单价', available: () => !isMr.value && !isCostInbound.value },
  { key: 'amount', label: '金额' },
  { key: 'serial_no', label: '序列号', available: () => showSerialCols.value },
  { key: 'unit_cost', label: '成本单价', available: () => isCostDoc.value || form.value.status === 'audited' },
  { key: 'substitutes', label: '可用替代料', available: () => showSubstituteCol.value },
]
const lineColumnStorageKey = computed(() => `scm_doc_line_columns_${localStorage.getItem('accountSetId') || ''}_${form.value.doc_type || 'unknown'}`)
const lineColumnDefaults = computed<ColumnSetting[]>(() => [
  ...LINE_CORE_COLUMNS.filter(column => !column.available || column.available()).map(column => ({ key: column.key, label: column.label, visible: true, required: true })),
  ...LINE_OPT_COLS.filter(column => lineColAvailable(column.key)).map(column => ({ key: column.key, label: column.label, visible: !lineHidden.value.has(column.key) })),
  ...bodyFieldDefs.value.map(field => ({ key: `bf_${field.field_key}`, label: field.field_name, visible: true, required: true, group: '自定义字段' })),
])
const lineColumnSettings = ref<ColumnSetting[]>([])
// 明细表列宽记忆：按账套 + 单据类型隔离，拖动列头后写 localStorage，随列设置「恢复默认」一并还原
const lineWidthStorageKey = computed(() => `scm_doc_line_width_${localStorage.getItem('accountSetId') || ''}_${form.value.doc_type || 'unknown'}`)
const { onDragEnd: onLineColDragEnd, lw, reset: resetLineWidths } = useScopedColumnWidth(lineWidthStorageKey, linesTableRef)

function applyLineColumnOrder() {
  nextTick(() => {
    const table = linesTableRef.value as any
    const store = table?.store
    const columnsRef = store?.states?._columns
    const columns = columnsRef?.value
    if (!Array.isArray(columns) || !columns.length) return
    const rank = new Map(lineColumnSettings.value.map((column, index) => [column.key, index]))
    const keyOf = (column: any) => String(column.columnKey || column.property || '')
    const left = columns.filter((column: any) => column.type === 'expand' || keyOf(column) === '__line_index__')
    const right = columns.filter((column: any) => keyOf(column) === '__line_actions__')
    const managed = columns.filter((column: any) => rank.has(keyOf(column))).sort((a: any, b: any) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0))
    const managedSet = new Set([...left, ...right, ...managed])
    const remaining = columns.filter((column: any) => !managedSet.has(column))
    columnsRef.value = [...left, ...managed, ...remaining, ...right]
    store.updateColumns?.()
    table.doLayout?.()
  })
}

function applyLineColumnVisibility(columns: ColumnSetting[]) {
  const configurable = new Set(LINE_OPT_COLS.map(column => column.key))
  const nextHidden = mergeHiddenColumnVisibility(lineHidden.value, columns, configurable)
  if (nextHidden !== lineHidden.value) lineHidden.value = nextHidden
}

function updateLineColumnSettings(columns: ColumnSetting[]) {
  lineColumnSettings.value = columns
  applyLineColumnVisibility(columns)
  saveColumnSettings(lineColumnStorageKey.value, columns)
  applyLineColumnOrder()
}

function resetLineColumnSettings() {
  resetLineWidths()
  resetColWidth(...[1, 2, 3, 4, 5, 6].map(n => `scm_DocForm_${n}`))
  nextTick(() => linesTableRef.value?.doLayout?.())
  updateLineColumnSettings(lineColumnDefaults.value.map(column => ({ ...column, visible: true })))
}

watch([lineColumnStorageKey, lineColumnDefaults], ([storageKey, defaults]) => {
  const next = loadColumnSettings(storageKey, defaults)
  const currentState = JSON.stringify(lineColumnSettings.value.map(column => [column.key, column.visible]))
  const nextState = JSON.stringify(next.map(column => [column.key, column.visible]))
  if (currentState !== nextState) lineColumnSettings.value = next
  if (canColScheme.value) applyLineColumnVisibility(next)
  applyLineColumnOrder()
}, { immediate: true })

// 表头表单高度变化（单据类型切换 / 表头·表尾自定义字段加载）会改变表格顶部位置，需重算明细表最大高度
watch([() => form.value.doc_type, () => headerFieldDefs.value.length, () => footerFieldDefs.value.length], () => nextTick(calcTableMaxHeight))
function parseFieldOptions(json?: string): string[] {
  if (!json) return []
  try { const a = JSON.parse(json); return Array.isArray(a) ? a : [] } catch { return [] }
}
async function loadDocFieldDefs() {
  const dt = form.value.doc_type
  if (!dt) { docFieldDefs.value = []; return }
  try { const r = await scmApi.getDocFieldDefs(dt); if (r.code === 0) docFieldDefs.value = r.data as ScmDocFieldDef[] } catch { docFieldDefs.value = [] }
}
// 表体自定义字段：确保行上有 field_values 对象（供 v-model 绑定）；查看态取文本
function ensureLineFv(row: any): Record<string, any> {
  if (!row.field_values || typeof row.field_values !== 'object') row.field_values = {}
  return row.field_values
}
function lineFieldText(row: any, f: ScmDocFieldDef): string {
  const v = row.field_values?.[f.field_key]
  return v === undefined || v === null ? '' : String(v)
}

// ── 「字段设置」浮层（有 scm:colscheme 权限者临时调表头/表尾显隐；本地不落库，照搬明细表列设置）──
/** 当前单据类型下「可隐藏的标准表头字段」key 集合（与 hcol 可用性一致） */
const headerStdHideableKeys = computed<Set<string>>(() => {
  const keys = new Set<string>(headerCols.value)  // header_fields 配置的标准字段
  keys.add('operator'); keys.add('remark')        // 始终显示，但允许隐藏
  if (col('tax_rate') || isPurchaseOrSale.value) keys.add('tax_rate')
  if (isPurchaseOrSale.value) keys.add('biz_person')
  return keys
})
/** 表头字段设置浮层可选项：标准可隐藏字段 + 表头自定义字段（全量，未叠加隐藏） */
const fieldSettingHeaderOpts = computed<ColMeta[]>(() => {
  const std = HEADER_OPT_COLS.filter(c => headerStdHideableKeys.value.has(c.key) && !(isPaymentDoc.value && c.key === 'payment'))
  const custom = allHeaderFieldDefs.value.map(f => ({ key: f.field_key, label: f.field_name }))
  return [...std, ...custom]
})
/** 表尾字段设置浮层可选项：表尾自定义字段（全量） */
const fieldSettingFooterOpts = computed<ColMeta[]>(() =>
  allFooterFieldDefs.value.map(f => ({ key: f.field_key, label: f.field_name })))
/** 浮层勾选模型：勾选=显示；改动只更新当前可选字段的隐藏态（本地临时，不落库） */
const headerFieldVisibleKeys = computed<string[]>({
  get: () => fieldSettingHeaderOpts.value.filter(c => !headerHidden.value.has(c.key)).map(c => c.key),
  set: (vis: string[]) => {
    const visSet = new Set(vis)
    const next = new Set(headerHidden.value)
    for (const c of fieldSettingHeaderOpts.value) { visSet.has(c.key) ? next.delete(c.key) : next.add(c.key) }
    headerHidden.value = next
  },
})
const footerFieldVisibleKeys = computed<string[]>({
  get: () => fieldSettingFooterOpts.value.filter(c => !footerHidden.value.has(c.key)).map(c => c.key),
  set: (vis: string[]) => {
    const visSet = new Set(vis)
    const next = new Set(footerHidden.value)
    for (const c of fieldSettingFooterOpts.value) { visSet.has(c.key) ? next.delete(c.key) : next.add(c.key) }
    footerHidden.value = next
  },
})
const hasFieldSettingOpts = computed(() => fieldSettingHeaderOpts.value.length > 0 || fieldSettingFooterOpts.value.length > 0)

// 单据类型确定后（新增取路由、编辑/查看取加载结果）加载当前用户的列方案 + 自定义字段定义。
// 注意：必须在 form 定义之后再注册 watch，否则 immediate 求值时 form 处于 TDZ。
watch(() => form.value.doc_type, loadLineColScheme, { immediate: true })
watch(() => form.value.doc_type, loadHeaderFooterColScheme, { immediate: true })
watch(() => form.value.doc_type, loadDocFieldDefs, { immediate: true })

const sourceDoc = ref<any>(null)
const sourceDocs = ref<any[]>([])
const sourceWarehouse = ref('')
const warehouseManuallySelected = ref(false)
const targetDocs = ref<any[]>([])
const docStatements = ref<Array<{ id: string; stmt_no: string; status: string }>>([])

function syncDefaultWarehouse() {
  if (!isNew.value || !form.value.doc_type || isView.value) return
  form.value.warehouse_code = resolveDefaultWarehouse({
    sourceWarehouse: sourceWarehouse.value,
    headerWarehouse: form.value.warehouse_code,
    manuallySelected: warehouseManuallySelected.value,
    itemWarehouses: lines.value.filter(row => row.item_code).map(row => row._defaultWarehouse),
  })
}

function onWarehouseManualChange() {
  if (isNew.value) warehouseManuallySelected.value = true
}
const sourcePickerVisible = ref(false)

// 下游单据 → 可反向选择的源单选项（用于「选择源单」反向选单）。
// detailSource：self=展开源单自身明细（常规下推/入库单退货）；received=展开订单下钻出的「已入库」明细（采购订单退货）。
// PR 两种来源都是行级严格关联（明细行 source_line_id → 入库行），自动防超退。
interface SourceOption { type: string; detailSource: 'self' | 'received' | 'invoice'; label: string }
const SOURCE_OPTIONS: Record<string, SourceOption[]> = {
  PI:  [{ type: 'PO',  detailSource: 'self', label: '选择源单（采购订单）' }],
  PO:  [{ type: 'PQ',  detailSource: 'self', label: '选择源单（采购询价）' }],
  SO:  [{ type: 'SOa', detailSource: 'self', label: '选择源单（销售订单）' }],
  SOa: [{ type: 'SQ',  detailSource: 'self', label: '选择源单（销售报价）' }],
  // 采购退货：单个「选择源单」按钮（风格同其他单据），弹窗顶部列采购订单、展开下钻其已入库明细。
  PR:  [{ type: 'PO', detailSource: 'received', label: '选择源单（采购订单）' }],
  // 销售退货：与采购退货对称——销售订单下钻已出库明细；另可直接选销售出库单（覆盖合并出库、无订单的出库）。
  // 两种来源均为行级 source_line_id 关联（→ 出库行），后端自动防超退。
  SR:  [
    { type: 'SOa', detailSource: 'received', label: '选择源单（销售订单）' },
    { type: 'SO',  detailSource: 'self',     label: '选择源单（销售出库）' },
  ],
  // 发票选入库 / 出库单（第四份反馈 Q7）：可多张合并开票、可分批开票，剩余量按未开票数量；
  // 账务按行计差额（applyInvoiceByLines），表头 source_doc_id 只作展示。
  RP:  [{ type: 'PI', detailSource: 'invoice', label: '选择源单（采购入库）' }],
  RS:  [{ type: 'SO', detailSource: 'invoice', label: '选择源单（销售出库）' }],
}
// 当前正在选择的源单选项（点击某个「选择源单」按钮时设置）
const activePick = ref<SourceOption | null>(null)
// 可展示的「选择源单」按钮：新增/编辑态；保留原「异类型来源」防混用守卫
// （本单已有来源时，仅保留与已有来源同类型的选项，避免混用入库单/订单两种来源）。
const visibleSourceOptions = computed<SourceOption[]>(() => {
  if (isView.value) return []
  const opts = SOURCE_OPTIONS[form.value.doc_type] || []
  if (!sourceDocs.value.length) return opts
  return opts.filter(o => sourceDocs.value.some(s => s.doc_type === o.type))
})
function openSourcePicker(opt: SourceOption) {
  activePick.value = opt
  // 先挂载选源单组件(v-if=activePick)，下一帧再打开，确保 el-dialog 观察到 false→true
  // 的过渡而触发 @open（首次挂载即 model-value=true 时 @open 不会触发，导致源单不加载）。
  sourcePickerVisible.value = false
  nextTick(() => { sourcePickerVisible.value = true })
}

// 选择源单回调：把源单剩余明细追加到当前明细（支持多对一合并）
function onSourcePick(payload: { lines: any[]; partner_code: string; docs?: Array<{ id: string; doc_no: string; doc_type: string; status: string }>; warehouse_code?: string; tax_rate?: number | null }) {
  const incoming = payload.lines || []
  if (!incoming.length) return
  // 关联条立即显示上游单号（多张源单合并显示）；表头来源取第一张，仅作展示，账务按行
  for (const d of payload.docs || []) {
    if (!sourceDocs.value.some(s => s.id === d.id)) sourceDocs.value.push(d)
  }
  if (isInvoice.value && !(form.value as any).source_doc_id && sourceDocs.value.length) {
    (form.value as any).source_doc_id = sourceDocs.value[0].id
  }
  // 往来单位：表单为空则用源单的
  if (!form.value.partner_code && payload.partner_code) {
    form.value.partner_code = payload.partner_code
    const p = allPartners.value.find(x => x.code === payload.partner_code)
    partnerSearch.value = p ? `${p.code} ${p.name}` : payload.partner_code
    applyPartnerHeaderDefaults(p)
  }
  // 默认带入源单仓库到表头：本单未填仓库且带入明细仓库唯一时，用其作为表头仓库
  // （采购订单退货即带入入库行所在仓；多仓时不强设，保留各行自带仓库）
  const whs = [...new Set(incoming.map(l => l.warehouse_code).filter(Boolean))]
  sourceWarehouse.value = whs.length === 1 ? whs[0] : (payload.warehouse_code || '')
  warehouseManuallySelected.value = false
  if (sourceWarehouse.value) form.value.warehouse_code = sourceWarehouse.value
  // 源单表头税率：本单表头税率为空时带入（FIX-400）
  if (isEmptyHeaderValue(form.value.tax_rate) && payload.tax_rate !== null && payload.tax_rate !== undefined) {
    form.value.tax_rate = payload.tax_rate
    onHeaderTaxChange()
  }
  // 每行补全仓库（用表单仓库兜底）并追加；去掉当前的空行
  const rows = incoming.map(l => ({ ...l, warehouse_code: l.warehouse_code || form.value.warehouse_code }))
  const kept = lines.value.filter(l => l.item_code)
  lines.value = [...kept, ...rows]
  ElMessage.success(`已带入 ${rows.length} 行明细`)
}

// 详情页下推进度与列表 push_progress 同口径，忽略自动空白行。
const detailPushProgress = computed(() => {
  const validLines = lines.value.filter(line => line.item_code && (Number(line.qty) || 0) > 0)
  if (!validLines.length) return 'none' as const
  if (validLines.every(line => (Number(line.pushed_qty) || 0) >= (Number(line.qty) || 0))) return 'full' as const
  if (validLines.some(line => (Number(line.pushed_qty) || 0) > 0)) return 'part' as const
  return normalizePushProgress('none')
})
const canPush = computed(() =>
  isView.value && canShowStandardPushAction(form.value.doc_type)
    && canGenerateDownstream(form.value.status, form.value.doc_type, detailPushProgress.value)
)
// 本单是否已被下游引用（即被锁定）
const isLocked = computed(() => targetDocs.value.length > 0)
const assemblyDraftMrp = computed(() => isAssembly.value && targetDocs.value.some(doc => doc.doc_type === 'MRP' && doc.status === 'draft'))
const activeMrpTarget = computed(() => targetDocs.value.find(doc => doc.doc_type === 'MRP' && ['draft', 'audited'].includes(doc.status)))
function handlePush() {
  const target = PUSH_MAP[form.value.doc_type]
  if (!target) return
  router.push({ name: 'ScmDocNew', query: { doc_type: target, source_doc_id: editId.value } })
}

// 供应商编码 → 展示文本
function supplierLabel(code?: string) {
  if (!code) return ''
  const p = allPartners.value.find((x: any) => x.code === code)
  return p ? `${p.code} ${p.name}` : code
}

// 缺料单（MR）已审核且未完全下推 → 可生成采购订单（按供应商拆单）
const canGenPO = computed(() =>
  isView.value && isMr.value
    && canGenerateDownstream(form.value.status, form.value.doc_type, detailPushProgress.value)
)
// 缺料单按行物料来源自动路由生成下游（采购→PO、委外→委外计划、自制→生产计划）
const genningDownstream = ref(false)
async function handleGenDownstream() {
  if (!editId.value) return
  router.push({ name: 'ScmMrPushPreview', params: { id: editId.value }, query: { from: 'view' } })
}

const genningDoc = ref<'' | 'PO' | 'PQ'>('')
async function handleGenPurchaseDocs(target: 'PO' | 'PQ') {
  if (!editId.value) return
  genningDoc.value = target
  try {
    const res = await scmApi.genPurchaseDocs(editId.value, target)
    if (res.code === 0) {
      const label = target === 'PQ' ? '询价单' : '采购订单'
      ElMessage.success(`已按供应商生成 ${res.data.created} 张${label}`)
      router.push({ name: 'ScmDocList', query: { doc_type: target } })
    }
  } finally {
    genningDoc.value = ''
  }
}

const typeName = (c: string) => DOC_TITLE[c] || c

function viewRelationDoc(id: string) {
  router.push(`/scm/docs/${id}`)
}

const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// 小数位（系统参数 → 供应链 → 小数位设置，按单据类型）：明细数量 / 单价 / 金额的显示与录入位数
const decStore = useScmDecimalsStore()
void decStore.load()
const dec = computed(() => decStore.get(form.value.doc_type))
const qtyCell = (v: any) => (Number(v) ? decStore.qty(v, form.value.doc_type) : '')
const priceCell = (v: any) => (Number(v) ? decStore.price(v, form.value.doc_type) : '')
const amtCell = (v: any) => (Number(v) ? decStore.amount(v, form.value.doc_type) : '')
const amtText = (v: any) => decStore.amount(Number(v) || 0, form.value.doc_type)
// 单元格数字显示：0/null/空 → 空白（不填 0 / 0.00）；否则原值（useFmt=true 走千分位 2 位金额格式）
// 提示条数量：0 也要显示成 0（numCell 对 0 返回空串，提示条会出现「原计划 ；已执行 ；」）
const qtyText = (v: any) => fmt(Number(v) || 0)
function numCell(v: any, useFmt = false): string {
  if (!Number(v)) return ''
  return useFmt ? fmt(Number(v)) : String(v)
}
// 整单折扣（折）系数：N折=合计×N/10；<=0 表示不折扣
const headerDiscountFactor = computed(() => {
  const hd = Number(form.value.discount_rate) || 0
  return hd > 0 ? hd / 10 : 1
})
const totalQty       = computed(() => lines.value.reduce((s, l) => s + (Number(l.qty) || 0), 0))
const paymentSelectedRows = computed(() => paymentSources.value.filter(r => r.selected && Number(r.current_amount) > 0))
const paymentSelectedCount = computed(() => paymentSelectedRows.value.length)
const paymentAmount = computed(() => round2(paymentSelectedRows.value.reduce((s, r) => s + (Number(r.current_amount) || 0), 0) + (Number(advanceAmount.value) || 0)))
const totalAmount    = computed(() => isPaymentDoc.value
  ? paymentAmount.value
  : round2(lines.value.reduce((s, l) => s + (Number(l.amount) || 0), 0) * headerDiscountFactor.value))
// 完工/委外入库单顶部合计取头 total_amount（审核时归集成本，与列表页 DocList 口径一致）；其余单据仍按行金额汇总
const displayTotalAmount = computed(() => isCostDoc.value ? costTotalAmount.value : totalAmount.value)
const totalTaxAmount = computed(() => round2(lines.value.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.tax_amount) || 0), 0) * headerDiscountFactor.value))
// 税额合计（含头部折扣）：落库到 scm_doc.total_tax，供单据列表「价税合计」列使用
const totalTax = computed(() => round2(lines.value.reduce((s, l) => s + (Number(l.tax_amount) || 0), 0) * headerDiscountFactor.value))

const editingCell = ref<{row: any, field: string} | null>(null)
/** 双击物料列时为 true，ItemPicker 聚焦下拉检索框 */
const itemPickerFocusSearch = ref(false)
/** 批量选择器是否可见 */
const batchPickerVisible = ref(false)

// 据现有档案编码自动推下一个号：沿用最大号的前缀与位宽，无则用默认前缀+001
function nextAuxCode(list: any[], defaultPrefix: string): string {
  const parsed = list
    .map(it => String(it.code || '').match(/^(.*?)(\d+)$/))
    .filter(Boolean)
    .map(m => ({ prefix: m![1], num: parseInt(m![2]), width: m![2].length }))
  if (!parsed.length) return `${defaultPrefix}001`
  parsed.sort((a, b) => b.num - a.num)
  const prefix = parsed[0].prefix
  const width = Math.max(parsed[0].width, 3)
  const max = Math.max(...parsed.filter(p => p.prefix === prefix).map(p => p.num))
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}
// 业务员/部门：复用辅助核算「完整表单」AuxItemDialog（含备注）
const auxDlgVisible = ref(false)
const auxDlgType = ref<'person' | 'dept'>('person')
const auxEntityType = computed(() => auxDlgType.value === 'person' ? personCatId.value : deptCatId.value)
const auxEntityName = computed(() => auxDlgType.value === 'person' ? '人员' : '部门')
const auxNameLabel = computed(() => auxDlgType.value === 'person' ? '姓名' : '部门名称')
const auxDefaultCode = ref('')
function openAuxDialog(type: 'person' | 'dept') {
  const catId = type === 'person' ? personCatId.value : deptCatId.value
  if (!catId) return ElMessage.error('辅助核算未启用该类别，请先在「辅助核算」中初始化')
  auxDlgType.value = type
  auxDefaultCode.value = nextAuxCode(type === 'person' ? persons.value : depts.value, type === 'person' ? 'RY' : 'BM')
  auxDlgVisible.value = true
}
async function onAuxSaved(item: any) {
  const catId = auxEntityType.value
  const lr = await scmApi.getAuxItemsByCategory(catId)
  if (lr.code === 0) { if (auxDlgType.value === 'person') persons.value = lr.data || []; else depts.value = lr.data || [] }
  if (auxDlgType.value === 'person') form.value.biz_person = item.name
  else form.value.dept_code = item.code
}

// ── 快捷新增 往来单位/仓库（完整表单弹窗，与档案列表共用）────────
const partnerDlgVisible = ref(false)
async function onPartnerCreated(p: any) {
  const lr = await scmApi.getPartners({}); if (lr.code === 0) allPartners.value = lr.data
  if (p?.code) {
    form.value.partner_code = p.code
    partnerSearch.value = `${p.code} ${p.name || ''}`.trim()
    applyPartnerHeaderDefaults(allPartners.value.find(x => x.code === p.code) || p)
  }
}
const warehouseDlgVisible = ref(false)
async function onWarehouseCreated(w: any) {
  const lr = await scmApi.getWarehouses(); if (lr.code === 0) warehouses.value = lr.data
  if (w?.code) form.value.warehouse_code = w.code
}
const binDlgVisible = ref(false)
async function onBinCreated() {
  const lr = await scmApi.getBins(); if (lr.code === 0) bins.value = (lr.data || []).filter((b: any) => b.enabled !== 0)
}

// 按单据类型推断往来单位默认类型（PartnerDialog 快捷新增用）
function defaultPartnerType(): string {
  if (SALE_DOCS.includes(form.value.doc_type)) return 'customer'
  if (PURCHASE_DOCS.includes(form.value.doc_type) || ['WO', 'WI'].includes(form.value.doc_type)) return 'supplier'
  return 'both'
}

// ── 快捷新增 字典值（收发类别/运输方式/币别） ──────────────
async function quickDict(kind: 'io' | 'transport' | 'currency') {
  const meta = {
    io: { label: '收发类别', key: 'scm:io_categories', opts: ioCategoryOptions, set: (v: string) => form.value.io_category = v },
    transport: { label: '运输方式', key: 'scm:transport_methods', opts: transportOptions, set: (v: string) => form.value.transport_method = v },
    currency: { label: '币别', key: 'scm:currencies', opts: currencyOptions, set: (v: string) => form.value.currency = v },
  }[kind]
  try {
    const { value } = await ElMessageBox.prompt(`输入新${meta.label}`, `新增${meta.label}`, { inputPattern: /\S+/, inputErrorMessage: '不能为空' })
    const v = String(value).trim()
    if (meta.opts.value.includes(v)) { meta.set(v); return ElMessage.info('该值已存在，已选用') }
    const merged = [...meta.opts.value, v]
    await scmApi.saveParams([{ param_key: meta.key, param_value: merged.join(',') }])
    meta.opts.value = merged
    meta.set(v)
    ElMessage.success(`已新增${meta.label}：${v}`)
  } catch { /* 取消 */ }
}

// ── 快捷新增 结算方式（settle_type 表） ────────────────────
async function quickAddSettle() {
  try {
    const { value } = await ElMessageBox.prompt('输入结算方式名称', '新增结算方式', { inputPattern: /\S+/, inputErrorMessage: '不能为空' })
    const name = String(value).trim()
    const code = nextAuxCode(settleTypes.value, 'JS')
    const r = await scmApi.createSettleType({ code, name })
    if (r.code !== 0) throw new Error(r.message)
    const lr = await scmApi.getSettleTypes(); if (lr.code === 0) settleTypes.value = lr.data || []
    form.value.settle_account = name
    ElMessage.success(`已新增结算方式：${name}`)
  } catch (e: any) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e?.response?.data?.message || e.message)
  }
}

// ── 序列号录入 ────────────────────────────────────────────
const serialDialogVisible = ref(false)
const serialRow = ref<any>(null)
const serialText = ref('')
const parseSerialText = (t: string) => t.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
const serialTextCount = computed(() => parseSerialText(serialText.value).length)
const serialCount = (row: any) => Array.isArray(row.serial_nos) ? row.serial_nos.length : parseSerialText(String(row.serial_nos || '')).length
function openSerialDialog(row: any) {
  serialRow.value = row
  const cur = Array.isArray(row.serial_nos) ? row.serial_nos : parseSerialText(String(row.serial_nos || ''))
  serialText.value = cur.join('\n')
  serialDialogVisible.value = true
}
function confirmSerials() {
  const arr = parseSerialText(serialText.value)
  const dup = arr.filter((s, i) => arr.indexOf(s) !== i)
  if (dup.length) return ElMessage.warning(`序列号重复：${[...new Set(dup)].join(', ')}`)
  if (serialRow.value) serialRow.value.serial_nos = arr
  serialDialogVisible.value = false
}
/** 触发批量选择的行索引（-1 表示追加到末尾） */
const batchPickerRowIndex = ref(-1)
const vFocus = {
  mounted: (el: HTMLElement) => {
    nextTick(() => {
      const input = (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement | null
      if (input) {
        input.focus()
        input.select()
      }
    })
  }
}

// 按「行对象」判定当前编辑单元格（而非行索引），使拆成多张表后仍能正确定位
function isEditing(row: any, field: string) {
  if (OUTSOURCE_PRICE_FIELDS.has(field) && outsourcePriceLocked(row)) return false
  return editingCell.value?.row === row && editingCell.value?.field === field
}

function handleCellClick(row: any, column: any) {
  if (isView.value || !row || row.__summary) return
  const field = column.property
  if (field === 'item_code') {
    itemPickerFocusSearch.value = false
    editingCell.value = { row, field }
    return
  }
  if (['warehouse_code', 'qty', 'price', 'price_with_tax', 'discount_rate', 'tax_rate', 'tax_amount', 'gross_amount', 'batch_no', 'produce_date', 'expire_date', 'bin_no', 'scrap_rate', 'process_fee', 'remark', 'supplier_code', 'source_type'].includes(field)) {
    // 价税合计为派生缓存字段，进入编辑前先补初值，避免输入框为空
    if (field === 'gross_amount' && row.gross_amount == null) row.gross_amount = round2(grossOf(row))
    editingCell.value = { row, field }
  }
}

function handleCellDblClick(row: any, column: any) {
  if (!row || row.__summary) return
  if (isView.value) {
    if (!costLineExpandEnabled.value) return
    void (async () => {
      await loadCostLineDetails()
      if (!costDetailFor(row)) {
        ElMessage.warning(`未找到物料 ${row.item_code || ''} 的成本计算来源`)
        return
      }
      const expanded = expandedCostRows.value.has(row)
      linesTableRef.value?.toggleRowExpansion(row, !expanded)
    })()
    return
  }
  if (column.property !== 'item_code') return
  // 双击：打开全页面批量选择器
  stopEdit()
  batchPickerRowIndex.value = lines.value.indexOf(row)
  batchPickerVisible.value = true
}

/** 批量选择器确认回调：在触发行位置插入选中物料行 */
function onBatchPickConfirm(items: any[]) {
  if (!items.length) return
  const rowIndex = batchPickerRowIndex.value
  const newLines = items.map(item => ({
    item_code: item.code,
    item_name: item.name || '',
    spec: item.spec || '',
    supplier_code: item.supplier_code || '',
    source_type: item.source_type || 'purchase',
    item_supplier: item.supplier_code || '',
    warehouse_code: form.value.warehouse_code,
    qty: 0,
    price: pickItemPrice(item),
    amount: 0,
    tax_rate: null,
    tax_amount: 0,
    remark: '',
    price_with_tax: 0, discount_rate: 0, batch_no: '', produce_date: '', expire_date: '', bin_no: '', scrap_rate: 0, process_fee: 0, field_values: {},
    _sp: [Number(item.sale_price) || 0, Number(item.sale_price2) || 0, Number(item.sale_price3) || 0],
    _moq: Number(item.min_order_qty) || 0,
    _batch: Number(item.batch_flag) || 0,
    _batchMode: item.batch_out_mode || 'fifo',
    _serial: Number(item.serial_flag) || 0,
  }))
  if (rowIndex >= 0 && rowIndex < lines.value.length) {
    const currentRow = lines.value[rowIndex]
    // 若触发行是空行（无物料），用第一个替换它，其余插入后面
    if (!currentRow.item_code) {
      Object.assign(currentRow, newLines[0])
      recalcRow(currentRow)
      lines.value.splice(rowIndex + 1, 0, ...newLines.slice(1))
    } else {
      // 触发行有内容，在其后插入所有选中行
      lines.value.splice(rowIndex + 1, 0, ...newLines)
    }
  } else {
    // 追加到末尾
    lines.value.push(...newLines)
  }
  ElMessage.success(`已添加 ${items.length} 行物料`)
}

function stopEdit() {
  editingCell.value = null
  itemPickerFocusSearch.value = false
}

// 基础数据（类型/仓库/往来单位/业务员/部门/结算方式）仅需加载一次
async function loadMeta() {
  const [ts, ws, ps] = await Promise.all([scmApi.getDocTypes(), scmApi.getWarehouses(), scmApi.getPartners({})])
  if (ts.code === 0) types.value = ts.data
  if (ws.code === 0) warehouses.value = ws.data
  if (ps.code === 0) allPartners.value = ps.data
  scmApi.getProductionPlans().then(r => { if (r.code === 0) productionPlans.value = r.data || [] }).catch(() => {})
  void loadCurrencyMeta()
  // 复用财务辅助核算：业务员=人员、部门（aux_items.type 存类别id，需先解析类别）；失败不阻塞开单
  scmApi.getAuxCategories().then(async r => {
    if (r.code !== 0) return
    const cats = r.data || []
    personCatId.value = cats.find((c: any) => c.code === 'person')?.id || ''
    deptCatId.value = cats.find((c: any) => c.code === 'dept')?.id || ''
    if (personCatId.value) { const pr = await scmApi.getAuxItemsByCategory(personCatId.value); if (pr.code === 0) persons.value = pr.data || [] }
    if (deptCatId.value) { const dr = await scmApi.getAuxItemsByCategory(deptCatId.value); if (dr.code === 0) depts.value = dr.data || [] }
  }).catch(() => {})
  scmApi.getSettleTypes().then(r => { if (r.code === 0) settleTypes.value = r.data || [] }).catch(() => {})
  cashierApi.getAccounts().then(r => { if (r.code === 0) cashierAccounts.value = r.data || [] }).catch(() => {})
  scmApi.getBins().then(r => { if (r.code === 0) bins.value = (r.data || []).filter((b: any) => b.enabled !== 0) }).catch(() => {})
  scmApi.getParams().then(r => {
    if (r.code !== 0) return
    const pv = (k: string) => r.data.find(p => p.param_key === k)?.param_value || ''
    const split = (s: string) => s.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean)
    const cur = split(pv('scm:currencies')); if (cur.length) currencyOptions.value = cur
    ioCategoryOptions.value = split(pv('scm:io_categories'))
    transportOptions.value = split(pv('scm:transport_methods'))
  }).catch(() => {})
}

// 重置为空白表单
function resetForm() {
  form.value = {
    doc_type: '', doc_no: '', doc_date: todayStr(),
    warehouse_code: '', partner_code: '', operator: '', remark: '', status: 'draft', bom_id: '', source_doc_id: '', plan_id: '',
  biz_person: '', dept_code: '', payment_type: '', settle_account: '', invoice_type: '', invoice_no: '', invoice_date: '',
  contract_no: '', currency: 'CNY', exchange_rate: 1, discount_rate: null, expect_date: '', credit_days: null,
  io_category: '', transport_method: '', tax_rate: null, process_mode: '', field_values: {},
  }
  lines.value = []
  paymentSources.value = []
  advanceAmount.value = 0
  advanceRemark.value = ''
  paymentPartnerCode.value = ''
  partnerSearch.value = ''
  selectedBom.value = ''
  editingCell.value = null
  sourceDoc.value = null
  sourceDocs.value = []
  sourceWarehouse.value = ''
  warehouseManuallySelected.value = false
  targetDocs.value = []
  docStatements.value = []
  loadedDocSnapshot.value = ''
  partnerHeaderDefaults.value = {}
}

const loadedDocSnapshot = ref('')

function currentDocEditSnapshot(): string {
  return createScmDocEditSnapshot({
    form: form.value,
    lines: lines.value,
    selectedBom: selectedBom.value,
    paymentSources: paymentSources.value,
    advanceAmount: advanceAmount.value,
    advanceRemark: advanceRemark.value,
  })
}

function markDocSnapshot() {
  loadedDocSnapshot.value = currentDocEditSnapshot()
}

async function confirmDocNavigation(): Promise<boolean> {
  if (isView.value || !loadedDocSnapshot.value || currentDocEditSnapshot() === loadedDocSnapshot.value) return true
  try {
    await ElMessageBox.confirm('当前修改未保存，切换后将放弃修改。是否继续？', '切换单据', {
      type: 'warning',
      confirmButtonText: '放弃修改并切换',
      cancelButtonText: '留在当前单据',
    })
    return true
  } catch {
    return false
  }
}

// 当前路由对应的单据身份键：用于判断 keep-alive 复用时是否需要重新初始化
function currentDocKey() {
  return isNew.value
    ? `new|${initDocType.value}|${initSourceDocIds.value.join(',')}|${initPlanId.value}|${String(route.query.payment_mode || '')}`
    : `${String(route.name)}|${editId.value || ''}`
}
let initedKey = ''
// 离开新增页后置位：下次激活时强制刷新为干净表单（避免复用同一实例时残留上一单数据）
let needReinitOnActivate = false

// ── 开单效率：记忆并带出上一张同类型单据的常用表头字段 ──
// 仓库/运输方式/发票种类/付款方式，按「账套 + 单据类型」隔离存 localStorage，仅新增（非下推）时回填
const DOC_DEFAULT_FIELDS = ['warehouse_code', 'transport_method', 'invoice_type', 'payment_type'] as const
function docDefaultsKey(docType: string) {
  return `scm_doc_defaults_${localStorage.getItem('accountSetId') || ''}_${docType}`
}
function rememberDocDefaults(docType: string) {
  if (!docType) return
  try {
    const data: Record<string, any> = {}
    for (const f of DOC_DEFAULT_FIELDS) data[f] = form.value[f] ?? ''
    localStorage.setItem(docDefaultsKey(docType), JSON.stringify(data))
  } catch { /* localStorage 不可用则忽略 */ }
}
// 只填「当前为空」的字段：下推时源单已带的值保留，其余用记忆补空
function applyLastDocDefaults(docType: string) {
  if (!docType) return
  try {
    const raw = localStorage.getItem(docDefaultsKey(docType))
    if (!raw) return
    const data = JSON.parse(raw)
    // 下推单明细已带源单仓库时，不再用「上一张单据的仓库」覆盖空表头（否则表头仓与订单不一致，FIX-400）
    const pushedWithWarehouse = !!sourceDocs.value.length && lines.value.some((row: any) => row.item_code && row.warehouse_code)
    for (const f of DOC_DEFAULT_FIELDS) {
      if (f === 'warehouse_code' && pushedWithWarehouse) continue
      const cur = form.value[f]
      const isEmpty = cur === undefined || cur === null || cur === ''
      if (isEmpty && data[f] !== undefined && data[f] !== null && data[f] !== '') form.value[f] = data[f]
    }
  } catch { /* 忽略 */ }
}

// 单号规则含业务字段（往来单位 / 仓库 / 部门 / 业务员）时，表头字段变化后刷新单号预览；保存时以服务端取号为准
watch(
  () => [form.value.partner_code, form.value.warehouse_code, form.value.dept_code, (form.value as any).biz_person, form.value.doc_date],
  async () => {
    if (!isNew.value || !form.value.doc_type) return
    try {
      const f = form.value as any
      const r = await scmApi.getDocNextNo(f.doc_type, f.doc_date, {
        partner_code: f.partner_code || undefined, warehouse_code: f.warehouse_code || undefined,
        dept_code: f.dept_code || undefined, biz_person: f.biz_person || undefined,
      })
      if (r.code === 0) form.value.doc_no = r.data.next_no
    } catch { /* 预览失败不影响保存 */ }
  },
)

async function initForm() {
  initedKey = currentDocKey()
  resetForm()
  if (isNew.value) {
    form.value.doc_type = initDocType.value
    lines.value = [newLine()]
    if (form.value.doc_type) {
      try { const r = await scmApi.getDocNextNo(form.value.doc_type, form.value.doc_date); if (r.code === 0) form.value.doc_no = r.data.next_no } catch { }
    }
    if (isPlanControlledDoc.value && initPlanId.value) {
      form.value.plan_id = initPlanId.value
      await onPlanChange(initPlanId.value)
    }
    // 下推：先从源单加载数据（源单值作为这4个字段的优先值）
    if (initSourceDocIds.value.length) {
      form.value.source_doc_id = initSourceDocIds.value.length === 1 ? initSourceDocIds.value[0] : ''
      if (initSourceDocIds.value.length === 1) await loadSourceDoc(initSourceDocIds.value[0])
      else await loadSourceDocs(initSourceDocIds.value)
    }
    // 带出上一张同类型单据的常用字段：新增→全部带；下推→只补源单没带的空白
    if (form.value.doc_type) applyLastDocDefaults(form.value.doc_type)
    // 采购建议等报表「生成采购」带入：?prefill_item=物料&prefill_qty=数量&prefill_supplier=供应商（§5.3）
    await applyQueryPrefill()
  } else if (editId.value) {
    await loadDoc(editId.value)
  }
}

/** 按路由 query 预填首行物料/数量/供应商（仅新增单、且未从源单/工单带入行时生效） */
async function applyQueryPrefill() {
  const itemCode = String(route.query.prefill_item || '').trim()
  if (!itemCode || !isNew.value) return
  const qty = Number(route.query.prefill_qty) || 0
  const supplier = String(route.query.prefill_supplier || '').trim()
  try {
    const r = await scmApi.getItems({ keyword: itemCode, page: 1, page_size: 20 })
    const item = (((r.data as any)?.list || r.data || []) as any[]).find(it => it.code === itemCode)
    if (item) {
      const row = lines.value[0]?.item_code ? newLine() : lines.value[0]
      if (!lines.value.includes(row)) lines.value.push(row)
      onItemPick(row, item)
      if (qty > 0) { row.qty = qty; recalcRow(row) }
    }
  } catch { /* 物料查不到就留空行，由用户手选 */ }
  if (supplier && !form.value.partner_code) {
    form.value.partner_code = supplier
    const p = allPartners.value.find((x: any) => x.code === supplier)
    partnerSearch.value = p ? `${p.code} ${p.name || ''}`.trim() : supplier
  }
}

onMounted(async () => {
  // 单据正文/空白新增单始终优先渲染；全量往来单位等基础资料在后台并行补齐。
  // 新增单不应为了下拉选项而阻塞表头和第一条空白明细出现。
  const metaTask = loadMeta()
  await initForm()
  void metaTask.then(() => {
    // 预填的供应商在基础资料到位后补全显示名
    const p = form.value.partner_code ? allPartners.value.find((x: any) => x.code === form.value.partner_code) : null
    if (p && partnerSearch.value === p.code) partnerSearch.value = `${p.code} ${p.name || ''}`.trim()
  }).catch(() => {})
})

// 新增页复用同一路由组件；直接在预收款/预付款入口间切换时不会触发重新挂载，
// 须按查询参数身份重新初始化，避免沿用上一张单据的往来单位、账户和金额。
watch(
  () => [route.name, route.params.id, route.query.doc_type, route.query.source_doc_id, route.query.source_doc_ids, route.query.plan_id, route.query.payment_mode],
  async () => {
    if (tabsStore.activeKey !== myTabKey) return
    if (!isScmDocumentFormRoute(route.name)) return
    if (currentDocKey() !== initedKey) await initForm()
  }
)

// keep-alive 会按缓存键复用同一组件实例（onMounted 不再重跑）。
// 复用时若不重新初始化，会出现 doc_type/明细等沿用上一单的数据：
//  · 下推/切换不同单据类型 → 单据身份键变化 → 重新初始化
//  · 新增页离开后再次进入（保存/取消/切菜单）→ needReinitOnActivate → 刷新为干净表单
onActivated(() => {
  if (!isScmDocumentFormRoute(route.name)) return
  if (needReinitOnActivate) { needReinitOnActivate = false; initForm(); return }
  if (currentDocKey() !== initedKey) initForm()
  // 标签可能被 afterEach 重置为通用名，重激活时按当前单据改回「类型 + 单号」
  nextTick(updateTabTitle)
  nextTick(calcTableMaxHeight)
})

// 标签名改成「类型 + 单号」，区分多张查看/编辑单据页（新增页仍用「新增XX」）
function updateTabTitle() {
  const dt = form.value.doc_type
  if (!dt || isNew.value) return
  const name = `${isView.value ? '' : '编辑·'}${DOC_TITLE[dt] || dt} ${form.value.doc_no || ''}`.trim()
  tabsStore.setTitle(route.fullPath, name)
}

// 离开新增页时标记：下次回到新增页应是一张全新单据，而非残留的上一单。
// 注意 onDeactivated 触发时路由已切走，不能用 isNew.value 判断；
// 改用本实例初始化时记录的 initedKey（新增页以 "new|" 开头）。
onDeactivated(() => {
  if (initedKey.startsWith('new|')) needReinitOnActivate = true
})

async function loadDoc(id: string) {
  costDetailLoaded.value = false
  costLineDetails.value = []
  expandedCostRows.value = new Set()
  const res = await scmApi.getDoc(id)
  if (res.code !== 0) return
  const d = res.data as any
  if (d.doc_type === 'MRP') {
    await router.replace(scmDownstreamMrpRoute(id, d.status, route.query))
    return
  }
  // 直链、历史标签和所有外部入口统一按真实单据状态与当前业务域权限归一化。
  const expectedRoute = canEditScmDocument(d.doc_type, d.status) ? 'ScmDocEdit' : 'ScmDocView'
  if (route.name !== expectedRoute) {
    await router.replace({ name: expectedRoute, params: { id }, query: route.query })
  }
  docVoucher.value = d.voucher || null
  form.value = {
    doc_type: d.doc_type, doc_no: d.doc_no, doc_date: d.doc_date,
    warehouse_code: d.warehouse_code || '', partner_code: d.partner_code || '',
    operator: d.operator || '', remark: d.remark || '', status: d.status,
    maker: d.maker || '', auditor: d.auditor || '', audited_at: d.audited_at || '',
    voucher_id: d.voucher_id || '', external_voucher: Number(d.external_voucher) || 0, total_amount: Number(d.total_amount) || 0,
    bom_id: d.bom_id || '', source_doc_id: d.source_doc_id || '', plan_id: d.plan_id || '',
    biz_person: d.biz_person || '', dept_code: d.dept_code || '', payment_type: d.payment_type || '',
    settle_account: d.settle_account || '', invoice_type: d.invoice_type || '', invoice_no: d.invoice_no || '',
    invoice_date: d.invoice_date || '', contract_no: d.contract_no || '', currency: d.currency || 'CNY',
    exchange_rate: d.exchange_rate ?? 1, discount_rate: d.discount_rate || 0, expect_date: d.expect_date || '', credit_days: d.credit_days || 0,
    io_category: d.io_category || '', transport_method: d.transport_method || '', tax_rate: Number(d.tax_rate) || 0,
    process_mode: d.process_mode || '',
    field_values: (d.field_values && typeof d.field_values === 'object') ? d.field_values : {},
  }
  partnerHeaderDefaults.value = {}
  sourceDoc.value = d.source_doc || null
  // 行级来源(source_docs)优先；无行级来源时回退表头单据级来源(参照带入，如采购订单退货)。
  // 注意空数组为真值，不能直接用 `d.source_docs || ...` 否则表头来源永不显示。
  sourceDocs.value = (d.source_docs && d.source_docs.length) ? d.source_docs : (d.source_doc ? [d.source_doc] : [])
  targetDocs.value = d.target_docs || []
  docStatements.value = d.statements || []
  updateTabTitle()
  if (d.bom_id) selectedBom.value = d.bom_id
  if (d.partner_code) {
    const p = allPartners.value.find(x => x.code === d.partner_code)
    partnerSearch.value = p ? `${p.code} ${p.name}` : d.partner_code
  }
  lines.value = (d.lines || []).map((l: any) => ({
    id: l.id, seq: l.seq, source_line_id: l.source_line_id || undefined,
    sales_order_no: l.sales_order_no || '',
    purchase_order_no: l.purchase_order_no || '',
    item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '',
    warehouse_code: l.warehouse_code || '', qty: l.qty || null, pushed_qty: l.pushed_qty || 0,
    price: l.price || null, amount: l.amount || null, unit_cost: l.unit_cost || null,
    // 行税率 0% 是明确值，不能当空（原 `|| null` 让 0% 行重新打开后显示成表头税率，FIX-400）
    tax_rate: l.tax_rate === null || l.tax_rate === undefined || l.tax_rate === '' ? null : Number(l.tax_rate), tax_amount: l.tax_amount || null, remark: l.remark || '',
    // 历史单据含税列曾默认隐藏，含税单价可能未落库：按 单价 ×（1 + 行税率 / 表头税率）补出显示值
    price_with_tax: l.price_with_tax || fillPriceWithTax(l, d.tax_rate), discount_rate: l.discount_rate || null, batch_no: l.batch_no || '',
    produce_date: l.produce_date || '', expire_date: l.expire_date || '', bin_no: l.bin_no || '', scrap_rate: l.scrap_rate || null, process_fee: l.process_fee || null,
    supplier_code: l.supplier_code || '', source_type: l.source_type || 'purchase', item_supplier: l.item_supplier || '',
    line_role: l.line_role || null,
    product_group: (l.product_group === undefined || l.product_group === null) ? null : Number(l.product_group),
    arap_source_log_id: l.arap_source_log_id || null,
    arap_source_doc_id: l.arap_source_doc_id || '',
    arap_source_doc_type: l.arap_source_doc_type || '',
    arap_source_doc_no: l.arap_source_doc_no || '',
    arap_source_doc_date: l.arap_source_doc_date || '',
    arap_source_amount: Number(l.arap_source_amount) || 0,
    arap_source_settled_amount: Number(l.arap_source_settled_amount) || 0,
    arap_source_open_amount: Number(l.arap_source_open_amount) || 0,
    field_values: (() => { try { return l.field_values && typeof l.field_values === 'object' ? l.field_values : (l.field_values ? JSON.parse(l.field_values) : {}) } catch { return {} } })(),
    serial_nos: l.serial_nos ? (() => { try { return JSON.parse(l.serial_nos) } catch { return parseSerialText(String(l.serial_nos)) } })() : [],
    // 序列号行：以物料档案 serial_flag 为准（后端返回 item_serial_flag）。
    // 旧逻辑用 serial_nos 是否非空推断，但空序列号存为字符串 "[]"（恒真）→ 误判每行都要录序列号。
    _batch: (l.batch_no || l.produce_date || l.expire_date) ? 1 : 0,
    _serial: Number(l.item_serial_flag) || 0,
  }))
  if (isPaymentDoc.value) {
    const savedLines = lines.value
    paymentSources.value = savedLines.filter(l => l.arap_source_log_id).map(l => ({
      arap_source_log_id: l.arap_source_log_id,
      source_doc_id: l.arap_source_doc_id,
      source_doc_type: l.arap_source_doc_type,
      source_doc_no: l.arap_source_doc_no,
      source_doc_date: l.arap_source_doc_date,
      source_amount: Number(l.arap_source_amount) || 0,
      settled_amount: Number(l.arap_source_settled_amount) || 0,
      open_amount: Number(l.arap_source_open_amount) || 0,
      selected: true,
      current_amount: Number(l.amount) || 0,
      payment_remark: l.remark || '',
      invalid: !l.arap_source_doc_no,
    })) as PaymentSourceRow[]
    const advances = savedLines.filter(l => !l.arap_source_log_id && Number(l.amount) > 0)
    advanceAmount.value = round2(advances.reduce((s, l) => s + (Number(l.amount) || 0), 0))
    advanceRemark.value = advances.map(l => String(l.remark || '').trim()).filter(Boolean).join('；')
    paymentPartnerCode.value = d.partner_code || ''
    lines.value = []
    if (!isView.value) await loadPaymentSources(true)
  }
  ensureAsGroups()  // 组装单：兼容旧单补组号
  markDocSnapshot()
}

// 监听 editId，如果跳转到关联的同类型单据页，需要重新初始化数据。
// 注意：editId 取自全局 route.params.id；keep-alive 缓存的本组件在“非单据路由”
// （如生产计划编辑 /scm/production-plans/:id/edit）下也会触发该 watch，
// 必须校验当前路由确属单据表单页，否则会误用他类页面的 id 调 GET /scm/docs/:id 导致 404。
watch([() => route.name, editId], () => {
  if (tabsStore.activeKey !== myTabKey) return
  if (editId.value && isScmDocumentFormRoute(route.name) && currentDocKey() !== initedKey) {
    void initForm()
  }
})

// 从源单加载数据（订单下推）
async function loadSourceDoc(sourceId: string) {
  const isSalesDispatch = form.value.doc_type === 'SO'
  const res = isSalesDispatch
    ? await scmApi.getDocAvailability(sourceId)
    : await scmApi.getDoc(sourceId)
  if (res.code !== 0) return
  const sourceData = res.data as any
  const s = isSalesDispatch ? sourceData.doc : sourceData
  // 新建下游单时即展示上游来源（关联条），让下游单据知道来源
  sourceDoc.value = { id: s.id, doc_no: s.doc_no, doc_type: s.doc_type, status: s.status }
  sourceDocs.value = [sourceDoc.value]
  // 复制源单头部信息（仓库/运输方式/发票种类/付款方式以源单为准，源单有值才带）
  form.value.partner_code = s.partner_code || ''
  form.value.warehouse_code = s.warehouse_code || ''
  sourceWarehouse.value = s.warehouse_code || ''
  form.value.remark = s.remark || ''
  form.value.operator = s.operator || ''
  form.value.biz_person = s.biz_person || ''
  form.value.tax_rate = s.tax_rate === null || s.tax_rate === undefined || s.tax_rate === '' ? null : Number(s.tax_rate)
  partnerHeaderDefaults.value = {}
  if (s.transport_method) form.value.transport_method = s.transport_method
  if (s.invoice_type) form.value.invoice_type = s.invoice_type
  if (s.payment_type) form.value.payment_type = s.payment_type
  if (isSalesDispatch) form.value.field_values.external_order_no = sourceFieldValues([s], 'external_order_no')
  if (s.partner_code) {
    const p = allPartners.value.find(x => x.code === s.partner_code)
    partnerSearch.value = p ? `${p.code} ${p.name}` : s.partner_code
    applyPartnerHeaderDefaults(p)
  }
  // 复制源单明细行：按「剩余可下推数量 = 数量 - 已下推」预填，已下推完的行跳过
  const sourceLines = isSalesDispatch ? sourceData.lines : s.lines
  if (sourceLines && sourceLines.length) {
    if (isSalesDispatch) {
      const rows = buildSalesDispatchLines(sourceLines, form.value.warehouse_code)
      lines.value = rows.length ? rows : [newLine()]
      if (!rows.length) {
        ElMessage.warning('销售订单已无正常未发数量，未生成出库明细')
      } else if (sourceLines.some((row: any) => {
        const remaining = Number(row.base_remaining ?? row.remain) || 0
        return remaining > 0.000001 && (Number(row.ship_qty) || 0) + 0.000001 < remaining
      })) {
        ElMessage.warning('已按订单剩余量带入；当前库存不足，可先保存草稿，审核前请补足库存')
      }
      return
    }
    const rows = sourceLines
      .map((l: any) => ({ l, remain: (Number(l.qty) || 0) - (Number(l.pushed_qty) || 0) }))
      .filter(({ remain }: any) => remain > 0)
      .map(({ l, remain }: any) => {
        const price = Number(l.price) || 0
        const taxRate = l.tax_rate === null || l.tax_rate === undefined || l.tax_rate === '' ? null : Number(l.tax_rate)
        const taxAmount = taxRate === null ? null : Math.round(remain * price * taxRate) / 100
        return {
          item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '',
          warehouse_code: l.warehouse_code || form.value.warehouse_code,
          _defaultWarehouse: l.warehouse_code || form.value.warehouse_code || '',
          qty: remain, price: price || null, amount: Math.round(remain * price * 100) / 100 || null, unit_cost: l.unit_cost || null,
          price_with_tax: Number(l.price_with_tax) || null,
          tax_rate: taxRate, tax_amount: taxAmount, remark: l.remark || '',
          field_values: (l.field_values && typeof l.field_values === 'object') ? { ...l.field_values } : {},
          source_line_id: l.id,
          purchase_order_no: form.value.doc_type === 'PI' ? s.doc_no : undefined,
        }
      })
    // 若源单已全部下推完，至少保留一空行避免空表格
    lines.value = rows.length ? rows : [newLine()]
    settleSourceHeaderWarehouse()
  }
}

/**
 * 下推后锁定表头仓库（FIX-400）：源单表头没填仓库、但明细仓库一致时，用明细仓库作表头；
 * 并记为「源单仓库」，避免之后删行 / 选物料时 syncDefaultWarehouse 把表头仓库清空。
 */
function settleSourceHeaderWarehouse() {
  if (!form.value.warehouse_code) {
    const whs = [...new Set(lines.value.map((row: any) => row.warehouse_code).filter(Boolean))]
    if (whs.length === 1) form.value.warehouse_code = whs[0]
  }
  sourceWarehouse.value = form.value.warehouse_code || ''
}

async function loadSourceDocs(sourceIds: string[]) {
  if (!sourceIds.length) return
  const isSalesDispatch = form.value.doc_type === 'SO'
  let docs: any[] = []
  let availabilityLines: any[] = []
  if (isSalesDispatch) {
    const res = await scmApi.getBatchDocAvailability(sourceIds)
    if (res.code !== 0) return
    docs = res.data.docs || []
    availabilityLines = res.data.lines || []
  } else {
    const results = await Promise.all(sourceIds.map(id => scmApi.getDoc(id)))
    docs = results.filter(result => result.code === 0).map(result => result.data)
  }
  if (!docs.length) return

  sourceDocs.value = docs.map(doc => ({ id: doc.id, doc_no: doc.doc_no, doc_type: doc.doc_type, status: doc.status }))
  sourceDoc.value = sourceDocs.value[0] || null
  form.value.source_doc_id = ''
  const headerFields = [
    'partner_code', 'warehouse_code', 'remark', 'operator', 'biz_person', 'tax_rate',
    'transport_method', 'invoice_type', 'payment_type', 'currency', 'exchange_rate',
    'settle_account', 'dest_warehouse_code',
  ]
  for (const field of headerFields) form.value[field] = commonSourceHeaderValue(docs, field)
  if (isSalesDispatch) form.value.field_values.external_order_no = sourceFieldValues(docs, 'external_order_no')
  sourceWarehouse.value = form.value.warehouse_code || ''
  partnerHeaderDefaults.value = {}
  if (form.value.partner_code) {
    const partner = allPartners.value.find(item => item.code === form.value.partner_code)
    partnerSearch.value = partner ? `${partner.code} ${partner.name}` : form.value.partner_code
    applyPartnerHeaderDefaults(partner)
  }

  if (isSalesDispatch) {
    const rows = buildSalesDispatchLines(availabilityLines, form.value.warehouse_code)
    lines.value = rows.length ? rows : [newLine()]
    if (!rows.length) {
      ElMessage.warning('选中订单已无正常未发数量，未生成出库明细')
    } else if (availabilityLines.some((row: any) => {
      const remaining = Number(row.base_remaining ?? row.remain) || 0
      return remaining > 0.000001 && (Number(row.ship_qty) || 0) + 0.000001 < remaining
    })) {
      ElMessage.warning('已按订单剩余量带入；部分明细库存不足，可先保存草稿，审核前请补足库存')
    }
    return
  }
  const rows = buildMultiSourceRemainingLines(docs).map(row => ({
    ...row,
    warehouse_code: row.warehouse_code || form.value.warehouse_code,
    _defaultWarehouse: row.warehouse_code || form.value.warehouse_code || '',
    field_values: row.field_values && typeof row.field_values === 'object' ? { ...row.field_values } : {},
    purchase_order_no: form.value.doc_type === 'PI' ? row.source_doc_no : row.purchase_order_no,
  }))
  lines.value = rows.length ? rows : [newLine()]
  settleSourceHeaderWarehouse()
  if (!rows.length) ElMessage.warning('选中单据已全部下推，未生成下游明细')
}

watch(() => form.value.doc_type, () => {
  if (isProduction.value) scmApi.getBoms().then(r => { if (r.code === 0) boms.value = r.data })
})

function newLine(): Record<string, any> {
  // 数字字段默认 null（未填留空，不显示 0/0.00）；计算/保存均以 Number(x)||0 兜底
  return { item_code: '', item_name: '', spec: '', warehouse_code: form.value.warehouse_code, qty: null, price: null, amount: null, tax_rate: null, tax_amount: null, remark: '',
    price_with_tax: null, discount_rate: null, batch_no: '', expire_date: '', scrap_rate: null, process_fee: null, field_values: {} }
}
/** 按行对象删除（兼容单表与组装单两表；至少保留一行）。行加减改由「末尾自动空行」处理，不再需要「添加行」按钮。 */
function removeLine(row: any) {
  const i = lines.value.indexOf(row)
  if (i >= 0 && lines.value.length > 1) lines.value.splice(i, 1)
  syncDefaultWarehouse()
}
/** 组装单：删除成品行时连带删除其组下的子件行 */
function removeAsProduct(row: any) {
  const g = row.product_group
  lines.value = lines.value.filter(l => l !== row && !(l.line_role !== 'product' && g != null && l.product_group === g))
}

const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 10000) / 10000
// 含税单价兜底：行税率为空时取表头税率；无税率时含税单价即单价
function fillPriceWithTax(line: any, headerTaxRate: any): number | null {
  const price = Number(line?.price) || 0
  if (!price) return null
  const rowRate = line?.tax_rate
  const tr = (rowRate === null || rowRate === undefined || rowRate === '') ? (Number(headerTaxRate) || 0) : (Number(rowRate) || 0)
  return round4(price * (1 + tr / 100))
}
// 价税合计 = 不含税金额 + 税额；优先取缓存字段，未初始化时即时计算兜底
const grossOf = (row: any) => Number(row.gross_amount != null ? row.gross_amount : (Number(row.amount) || 0) + (Number(row.tax_amount) || 0))

// 合计行：作为表体最后一行（让水平滚动条落在合计行下方）。__summary 标记，不可编辑、不参与保存。
// 数量/金额/税额/价税合计/加工费 汇总；其余数字字段留空；税率置 0（effTax→空）。
const summaryRow = computed<Record<string, any>>(() => {
  const sum = (f: (r: any) => number) => lines.value.reduce((s, r) => s + (Number(f(r)) || 0), 0)
  return {
    __summary: true, item_code: '合计', item_name: '', spec: '', warehouse_code: '',
    qty: sum(r => r.qty) || null,
    // 成本类入库单(PF/WI)按 unit_cost×qty 汇总（行 amount 恒 0），与金额列/顶部合计口径一致
    amount: (isCostDoc.value ? sum(r => (Number(r.unit_cost) || 0) * (Number(r.qty) || 0)) : sum(r => r.amount)) || null,
    tax_rate: 0,
    tax_amount: sum(r => r.tax_amount) || null,
    gross_amount: lines.value.reduce((s, r) => s + grossOf(r), 0) || null,
    process_fee: sum(r => r.process_fee) || null,
    pushed_qty: Math.round(sum(r => r.pushed_qty) * 1e6) / 1e6,
    pushed_amount: Math.round(sum(r => r.pushed_amount) * 100) / 100,
    price: null, price_with_tax: null, discount_rate: null, scrap_rate: null,
  }
})
const tableRows = computed(() => [...lines.value, summaryRow.value])
const lineRowClass = ({ row }: { row: any }) => {
  if (row.__summary) return 'doc-line-summary'
  return costLineExpandEnabled.value ? 'doc-cost-expandable' : ''
}
// 行有效税率：行税率为空(null/'')时回退表头税率（表头兜底，与仓库一致）
function effTax(row: any): number {
  const v = row?.tax_rate
  return (v === null || v === undefined || v === '') ? (Number(form.value.tax_rate) || 0) : (Number(v) || 0)
}

async function onPlanChange(planId: string) {
  planExecutionInfo.value = { planned_qty: 0, executed_qty: 0, max_allowed_qty: 0, overrun_remaining: 0 }
  planNoMaterial.value = false
  if (!planId) { lines.value = [newLine()]; return }
  const result = await scmApi.getProductionPlan(planId)
  if (result.code !== 0) return
  const plan = result.data.plan || {}
  const products = result.data.products || []
  const isReturn = form.value.doc_type === 'PJ'      // 退料：候选行 = 已领用料，上限 = 已领量
  const isDefect = form.value.doc_type === 'PS'      // 不良品入库：候选行 = 成品，数量由用户填
  const issue = ['PL', 'PB', 'WO'].includes(form.value.doc_type) || isReturn
  const action = issue ? result.data.action_state?.issue : result.data.action_state?.finish
  if (isOpOutsource.value) {
    // 工序委外：每个成品一行，数量 = 计划数，备注带出工艺路线里标记「委外」的工序名，加工费单价由用户填
    const rows: any[] = []
    for (const product of products) {
      let ops = ''
      try {
        const rt = await scmApi.getRoutings({ item_code: product.item_code })
        const head = (rt.code === 0 ? rt.data : []).find((r: any) => r.status === 'active') || (rt.code === 0 ? rt.data[0] : null)
        if (head) {
          const detail = await scmApi.getRouting(head.id)
          ops = (detail.code === 0 ? detail.data.lines : []).filter((l: any) => Number(l.is_outsource)).map((l: any) => l.process_name).filter(Boolean).join('、')
        }
      } catch { /* 无工艺路线则留空 */ }
      rows.push({ ...newLine(), item_code: product.item_code, item_name: product.item_name || '', spec: product.spec || '',
        qty: Number(product.plan_qty) || null, remark: ops ? `工序：${ops}` : '', plan_qty: Number(product.plan_qty) || 0 })
    }
    lines.value = rows.length ? rows : [newLine()]
    return
  }
  if (plan.supplier_code) {
    form.value.partner_code = plan.supplier_code
    const partner = allPartners.value.find((row: any) => row.code === plan.supplier_code)
    partnerSearch.value = partner ? `${partner.code} ${partner.name}` : plan.supplier_code
  }
  if (issue) {
    const suggestion = await scmApi.getIssueSuggestion(planId)
    const sourceRows = suggestion.data?.lines || []
    planNoMaterial.value = !sourceRows.length
    const plannedQty = sourceRows.reduce((sum: number, row: any) => sum + (Number(row.need) || 0), 0)
    const factor = plannedQty > 0 ? (Number(action?.max_allowed_qty) || plannedQty) / plannedQty : 1
    const mappedRows = sourceRows.map((row: any) => ({
      ...newLine(), item_code: row.item_code, item_name: row.item_name || '', unit: row.unit || '',
      warehouse_code: row.warehouse_code || plan.yl_warehouse || '', qty: isReturn ? null : (Number(row.suggest) || null),
      _substitutes: Array.isArray(row.substitutes) ? row.substitutes : [],   // C-1 替代料：主料缺料时的同组替代料在库量（不落库）
      plan_qty: Number(row.need) || 0, executed_qty: Number(row.issued) || 0,
      max_allowed_qty: isReturn ? (Number(row.issued) || 0) : (Number(row.need) || 0) * factor,
      overrun_remaining: isReturn ? (Number(row.issued) || 0) : Math.max(0, (Number(row.need) || 0) * factor - (Number(row.issued) || 0)),
    }))
    const positiveRows = isReturn ? mappedRows.filter((row: any) => Number(row.executed_qty) > 0) : mappedRows.filter((row: any) => Number(row.qty) > 0)
    const rows = positiveRows.length ? positiveRows : mappedRows
    planExecutionInfo.value = {
      planned_qty: plannedQty,
      executed_qty: sourceRows.reduce((sum: number, row: any) => sum + (Number(row.issued) || 0), 0),
      max_allowed_qty: Number(action?.max_allowed_qty) || plannedQty,
      overrun_remaining: Number(action?.overrun_remaining) || 0,
    }
    form.value.warehouse_code = plan.yl_warehouse || rows[0]?.warehouse_code || ''
    lines.value = rows.length ? rows : [newLine()]
  } else {
    const plannedQty = products.reduce((sum: number, product: any) => sum + (Number(product.plan_qty) || 0), 0)
    const factor = plannedQty > 0 ? (Number(action?.max_allowed_qty) || plannedQty) / plannedQty : 1
    const mappedRows = products.map((product: any) => ({
      ...newLine(), item_code: product.item_code, item_name: product.item_name || '', spec: product.spec || '',
      warehouse_code: product.fp_warehouse || plan.fp_warehouse || '',
      // 剩余可完工 = 计划 − 已完工 − 已报废（与后端口径一致，FIX-211）；不良品入库数量由用户填写
      qty: isDefect ? null : (Math.max(0, (Number(product.plan_qty) || 0) - (Number(product.finished_qty) || 0) - (Number(product.scrap_qty) || 0)) || null),
      plan_qty: Number(product.plan_qty) || 0, executed_qty: (Number(product.finished_qty) || 0) + (Number(product.scrap_qty) || 0),
      max_allowed_qty: (Number(product.plan_qty) || 0) * factor,
      overrun_remaining: Math.max(0, (Number(product.plan_qty) || 0) * factor - (Number(product.finished_qty) || 0) - (Number(product.scrap_qty) || 0)),
      process_fee: form.value.doc_type === 'WI' ? (Number(product.process_fee) || 0) : null,
      tax_rate: form.value.doc_type === 'WI' ? (Number(product.process_tax_rate) || 0) : null,
    }))
    const positiveRows = isDefect ? mappedRows : mappedRows.filter((row: any) => Number(row.qty) > 0)
    const rows = positiveRows.length ? positiveRows : mappedRows
    planExecutionInfo.value = {
      planned_qty: plannedQty,
      executed_qty: products.reduce((sum: number, product: any) => sum + (Number(product.finished_qty) || 0), 0),
      max_allowed_qty: Number(action?.max_allowed_qty) || plannedQty,
      overrun_remaining: Number(action?.overrun_remaining) || 0,
    }
    form.value.warehouse_code = plan.fp_warehouse || rows[0]?.warehouse_code || ''
    // 委外入库表头税率：各成品加工税率一致时带到表头（FIX-400）
    if (form.value.doc_type === 'WI' && rows.length) {
      const rates = [...new Set(rows.map((row: any) => Number(row.tax_rate) || 0))]
      if (rates.length === 1) form.value.tax_rate = rates[0]
    }
    lines.value = rows.length ? rows : [newLine()]
  }
}
function planLineMax(row: any): number | undefined {
  if (!showPlanOverrunInfo.value || row?.__summary) return undefined
  const value = Number(row?.overrun_remaining)
  return Number.isFinite(value) ? Math.max(0, value) : undefined
}
function isEmptyHeaderValue(value: unknown) {
  return value === null || value === undefined || value === ''
}
/** 往来单位档案的业务员、默认税率带入采购/销售单据表头，不覆盖用户已手工改写的值。 */
function applyPartnerHeaderDefaults(partner?: any) {
  if (!isPurchaseOrSale.value || !partner) return

  const last = partnerHeaderDefaults.value
  const bizPerson = String(partner.salesman || '')
  const rawTaxRate = partner.tax_rate
  const taxRate = isEmptyHeaderValue(rawTaxRate) ? null : (Number(rawTaxRate) || 0)

  if (isEmptyHeaderValue(form.value.biz_person) || (last.bizPerson !== undefined && form.value.biz_person === last.bizPerson)) {
    form.value.biz_person = bizPerson
  }
  if (isEmptyHeaderValue(form.value.tax_rate) || (last.taxRate !== undefined && Number(form.value.tax_rate) === Number(last.taxRate))) {
    form.value.tax_rate = taxRate
    onHeaderTaxChange()
  }
  partnerHeaderDefaults.value = { bizPerson, taxRate }
}
// 只算金额/税额（不改单价、含税单价），与后端 calcLine 一致
function applyAmounts(row: any) {
  const qty = Number(row.qty) || 0
  if (isAssembly.value && row.line_role === 'product' && asNeedsPartner.value) {
    asRecalcFeeTax(row)
    return
  }
  if (form.value.doc_type === 'WI') {
    const fee = Number(row.process_fee) || 0
    const tr = effTax(row)
    row.amount = null
    row.discount_amount = null
    row.tax_amount = tr > 0 ? (round2(qty * fee * tr / 100) || null) : null
    row.price_with_tax = round4(fee * (1 + tr / 100)) || null
    row.gross_amount = round2(qty * fee + (Number(row.tax_amount) || 0)) || null
    return
  }
  const price = Number(row.price) || 0
  const dr = Number(row.discount_rate) || 0
  const gross = qty * price
  // 折扣口径（中国式「折」）：dr 为折率，N折=原价×N/10；dr<=0 表示不折扣（原价）
  const factor = dr > 0 ? dr / 10 : 1
  // 计算结果为 0 一律归 null（显示/输入框留空，不填 0）
  row.amount = round2(gross * factor) || null
  row.discount_amount = round2(gross - (Number(row.amount) || 0)) || null
  const tr = effTax(row)
  row.tax_amount = tr > 0 ? (round2((Number(row.amount) || 0) * tr / 100) || null) : null
  // 同步价税合计缓存，供展示列与「价税合计反算」共用
  row.gross_amount = round2((Number(row.amount) || 0) + (Number(row.tax_amount) || 0)) || null
}
// 编辑 数量/单价/折扣：同步含税单价 + 金额
function recalcRow(row: any) {
  const tr = effTax(row)
  row.price_with_tax = round4((Number(row.price) || 0) * (1 + tr / 100)) || null
  applyAmounts(row)
}
// 编辑 税率：重算含税单价与税额
function recalcTax(row: any) {
  const tr = effTax(row)
  row.price_with_tax = round4((Number(row.price) || 0) * (1 + tr / 100)) || null
  applyAmounts(row)
}
// 编辑 含税单价：反算不含税单价
function recalcFromTaxPrice(row: any) {
  const tr = effTax(row)
  const pwt = Number(row.price_with_tax) || 0
  row.price = tr > 0 ? round4(pwt / (1 + tr / 100)) : pwt
  applyAmounts(row)
}
// 表头税率变化：未单独设税率的行随之重算税额
function onHeaderTaxChange() {
  lines.value.forEach((l: any) => recalcTax(l))
}
// 编辑 价税合计：按 数量/税率/折扣 倒挤 不含税单价、金额、税额、含税单价
function recalcFromGross(row: any) {
  const qty = Number(row.qty) || 0
  // 行税率为空时取表头税率（与 effTax 一致），否则表头 13% 的单据反算会按 0 税率算
  const tr = effTax(row)
  const dr = Number(row.discount_rate) || 0
  const factor = dr > 0 ? dr / 10 : 1
  const gross = Number(row.gross_amount) || 0
  // 价税合计 = 不含税金额 × (1 + 税率) ⇒ 反推金额与税额
  const amount = tr > 0 ? round2(gross / (1 + tr / 100)) : round2(gross)
  row.amount = amount
  row.tax_amount = round2(gross - amount)
  // 金额 = 数量 × 单价 × 折率 ⇒ 反推单价（数量/折率为 0 时无法反推，保留原单价）
  if (qty > 0 && factor > 0) {
    row.price = round4(amount / (qty * factor))
    row.price_with_tax = tr > 0 ? round4(row.price * (1 + tr / 100)) : row.price
    row.discount_amount = round2(qty * row.price - amount)
  }
  // 回写缓存，保持与展示列一致（不调 applyAmounts，避免四舍五入回算导致跳动）
  row.gross_amount = round2((Number(row.amount) || 0) + (Number(row.tax_amount) || 0))
}
function onItemPick(row: any, item: any) {
  row.item_code = item.code
  row.item_name = item.name || ''
  row.spec = item.spec || ''
  // 缺料单等按行带供应商/来源的单据：选物料即按物料档案默认值回填（仅补空）
  if (!row.supplier_code) row.supplier_code = item.supplier_code || ''
  if (!row.source_type) row.source_type = item.source_type || 'purchase'
  row.item_supplier = item.supplier_code || ''
  row._sp = [Number(item.sale_price) || 0, Number(item.sale_price2) || 0, Number(item.sale_price3) || 0]
  row._moq = Number(item.min_order_qty) || 0
  row._batch = Number(item.batch_flag) || 0
  row._batchMode = item.batch_out_mode || 'fifo'
  row._serial = Number(item.serial_flag) || 0
  row._defaultWarehouse = item.default_warehouse_code || ''
  row.price = row.price || pickItemPrice(item)
  row.warehouse_code = row.warehouse_code || form.value.warehouse_code
  syncDefaultWarehouse()
  recalcRow(row)
}

// 往来单位 autocomplete
function queryPartners(query: string, cb: (s: any[]) => void) {
  const q = query.trim().toLowerCase()
  cb(allPartners.value
    // 销售类只显示客户、采购类只显示供应商（含双向/未分类）；过滤停用；参数开启时过滤未审核
    .filter(p => partnerInScope(p) && p.enabled !== 0 && (!systemParams.masterAuditRequired || p.audit_status === 'audited') && (!q || p.code.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q)))
    .slice(0, 20)
    .map(p => ({ ...p, value: p.id, label: `${p.code} ${p.name}`, code: p.code, name: p.name }))
  )
}

// ── 预收 / 预付冲抵：往来单位尚有未核销的收付款 / 退货时，提示并一键核销到源单 ──
const partnerAdvanceItems = ref<Array<{ id: string; doc_no: string; doc_date: string; currency: string; open_amount: number }>>([])
const advanceOffsetting = ref(false)
const partnerAdvanceTotal = computed(() => round2(partnerAdvanceItems.value.reduce((s, r) => s + (Number(r.open_amount) || 0), 0)))
const showAdvanceOffset = computed(() => isPaymentDoc.value && !isAdvancePaymentMode.value && !isView.value
  && !!form.value.partner_code && partnerAdvanceTotal.value > 0.005 && paymentSources.value.some(r => !r.invalid && Number(r.open_amount) > 0.005))
async function loadPartnerAdvance() {
  partnerAdvanceItems.value = []
  if (!isPaymentDoc.value || isAdvancePaymentMode.value || isView.value || !form.value.partner_code) return
  try {
    const r = await scmApi.getArapOpenItems({ partner_code: form.value.partner_code, side: isReceivePayment.value ? 'ar' : 'ap' })
    if (r.code !== 0) return
    // 编辑已保存的收付款单时，排除本单自己的收付款行（草稿不入往来台账，此处只是防御）
    partnerAdvanceItems.value = (r.data.out_items || [])
      .filter((i: any) => i.doc_no !== form.value.doc_no)
      .map((i: any) => ({ id: i.id, doc_no: i.doc_no, doc_date: i.doc_date, currency: i.currency || '', open_amount: Number(i.open_amount) || 0 }))
  } catch { /* 预收提示失败不影响收付款录入 */ }
}
async function offsetWithAdvance() {
  // 源单已按本单币别过滤；预收只取同币别（本位币 CNY / RMB / 空视为同一种），核销须同币别
  const curKey = (c?: string | null) => (!c || ['CNY', 'RMB'].includes(String(c).toUpperCase())) ? 'BASE' : String(c).toUpperCase()
  const sameCur = (c: string) => curKey(c) === curKey(form.value.currency)
  const targets = (paymentSelectedRows.value.length ? paymentSelectedRows.value : paymentSources.value)
    .filter(r => !r.invalid && Number(r.open_amount) > 0.005)
  const outs = partnerAdvanceItems.value.filter(o => o.open_amount > 0.005 && sameCur(o.currency))
  // 贪心配对：按源单顺序（到期日 / 日期）逐张用最早的预收冲抵
  const matches: Array<{ in_log_id: string; out_log_id: string; amount: number }> = []
  const left = outs.map(o => ({ id: o.id, left: o.open_amount }))
  let j = 0
  for (const t of targets) {
    let need = round2(Number(t.open_amount) || 0)
    while (need > 0.005 && j < left.length) {
      const m = round2(Math.min(need, left[j].left))
      if (m > 0.005) { matches.push({ in_log_id: t.arap_source_log_id, out_log_id: left[j].id, amount: m }); need = round2(need - m); left[j].left = round2(left[j].left - m) }
      if (left[j].left <= 0.005) j++
    }
  }
  const total = round2(matches.reduce((s, m) => s + m.amount, 0))
  if (!matches.length) return ElMessage.warning('没有可冲抵的同币别源单')
  const docNos = [...new Set(matches.map(m => targets.find(t => t.arap_source_log_id === m.in_log_id)?.source_doc_no).filter(Boolean))]
  try {
    await ElMessageBox.confirm(
      `将用${isReceivePayment.value ? '预收款' : '预付款'}冲抵 ${docNos.join('、')} 共 ${fmt(total)}，生成核销单。冲抵后源单只需按剩余金额${isReceivePayment.value ? '收款' : '付款'}。继续？`,
      '预收预付冲抵', { type: 'warning' })
  } catch { return }
  advanceOffsetting.value = true
  try {
    const r = await scmApi.verifyArap({ partner_code: form.value.partner_code, matches })
    ElMessage.success(`已冲抵 ${fmt(total)}，核销单 ${r.data.verify_no}`)
    // 已被冲平的源单从列表移除；部分冲抵的源单，已填的本次金额超出新余额时压到新余额
    const offsetByLog = new Map<string, number>()
    for (const m of matches) offsetByLog.set(m.in_log_id, round2((offsetByLog.get(m.in_log_id) || 0) + m.amount))
    const settled = new Set(targets.filter(t => (offsetByLog.get(t.arap_source_log_id) || 0) >= round2(Number(t.open_amount) || 0) - 0.005).map(t => t.arap_source_log_id))
    paymentSources.value = paymentSources.value.filter(row => !settled.has(row.arap_source_log_id))
    await loadPaymentSources(true)
    for (const row of paymentSources.value) {
      if (!offsetByLog.has(row.arap_source_log_id) || !row.selected) continue
      const open = Number(row.open_amount) || 0
      if (Number(row.current_amount) > open) row.current_amount = open
      row.invalid = false
    }
  } catch (e: any) {
    // 请求拦截器已提示失败原因
    console.warn('预收冲抵失败：', e?.response?.data?.message || e?.message || e)
  } finally { advanceOffsetting.value = false }
}

async function loadPaymentOpenReturns() {
  paymentOpenReturns.value = []
  if (!isPaymentDoc.value || isAdvancePaymentMode.value || isView.value || !form.value.partner_code) return
  try {
    const r = await scmApi.getPaymentOpenReturns({
      partner_code: form.value.partner_code,
      payment_doc_type: form.value.doc_type as 'RCV' | 'PAY',
      currency: form.value.currency || undefined,
    })
    if (r.code === 0) paymentOpenReturns.value = r.data || []
  } catch { /* 退货列示失败不影响收付款录入 */ }
}

async function loadPaymentSources(preserveSelected = false) {
  if (!isPaymentDoc.value || isAdvancePaymentMode.value || !form.value.partner_code) {
    paymentSources.value = []
    paymentOpenReturns.value = []
    partnerAdvanceItems.value = []
    return
  }
  void loadPartnerAdvance()
  void loadPaymentOpenReturns()
  const saved = preserveSelected
    ? new Map(paymentSources.value.filter(r => r.selected).map(r => [r.arap_source_log_id, r]))
    : new Map<string, PaymentSourceRow>()
  paymentSourceLoading.value = true
  try {
    const r = await scmApi.getPaymentSources({
      partner_code: form.value.partner_code,
      payment_doc_type: form.value.doc_type as 'RCV' | 'PAY',
      currency: form.value.currency || undefined,   // 多币种：只列同币别源单
    })
    if (r.code !== 0) return
    const merged = (r.data || []).map(src => {
      const old = saved.get(src.arap_source_log_id)
      return {
        ...src,
        selected: !!old,
        current_amount: old?.current_amount ?? null,
        payment_remark: old?.payment_remark || '',
        invalid: !!old && Number(old.current_amount) > Number(src.open_amount) + 0.005,
      } as PaymentSourceRow
    })
    const known = new Set(merged.map(row => row.arap_source_log_id))
    for (const old of saved.values()) {
      if (!known.has(old.arap_source_log_id)) merged.push({ ...old, invalid: true })
    }
    paymentSources.value = merged
  } finally {
    paymentSourceLoading.value = false
  }
}

function onPaymentAccountChange(value: unknown) {
  if (!isPaymentDoc.value) return
  const accountCode = String(value || '')
  if (!accountCode) {
    form.value.payment_type = ''
    return
  }
  const account = cashierAccounts.value.find(item => item.code === accountCode)
  // 现金科目对应现金方式，银行科目对应转账；接口只返回现金/银行末级科目。
  form.value.payment_type = account
    ? (Number(account.is_cash) === 1 ? 'cash' : 'transfer')
    : (form.value.payment_type || 'transfer')
}

function onPaymentSourceChecked(row: PaymentSourceRow) {
  if (row.selected) {
    if (!(Number(row.current_amount) > 0) || Number(row.current_amount) > Number(row.open_amount)) {
      row.current_amount = round2(Number(row.open_amount) || 0)
    }
  } else {
    row.current_amount = null
    row.invalid = false
  }
}

function validatePaymentSourceAmount(row: PaymentSourceRow) {
  const amount = round2(Number(row.current_amount) || 0)
  const open = round2(Number(row.open_amount) || 0)
  if (amount > open) {
    row.current_amount = open
    ElMessage.warning(`本次金额不能超过未结算余额 ${fmt(open)}`)
  } else if (amount <= 0) {
    row.current_amount = null
    row.selected = false
  } else {
    row.current_amount = amount
    row.invalid = false
  }
}

function clearPaymentSelection() {
  paymentSources.value = []
  advanceAmount.value = 0
  advanceRemark.value = ''
}

function onPartnerClear() {
  form.value.partner_code = ''
  partnerSearch.value = ''
  paymentPartnerCode.value = ''
  if (isPaymentDoc.value) clearPaymentSelection()
}

async function onPartnerSelect(item: any) {
  if (isPaymentDoc.value) {
    const oldCode = paymentPartnerCode.value
    const hasAmount = paymentSelectedRows.value.length > 0 || Number(advanceAmount.value) > 0
    if (oldCode && oldCode !== item.code && hasAmount) {
      try {
        await ElMessageBox.confirm('切换往来单位将清空已选择的源单和预收预付金额，是否继续？', '切换往来单位', { type: 'warning' })
      } catch {
        const old = allPartners.value.find(p => p.code === oldCode)
        form.value.partner_code = oldCode
        partnerSearch.value = old ? `${old.code} ${old.name}` : oldCode
        return
      }
    }
    if (oldCode !== item.code) clearPaymentSelection()
  }
  form.value.partner_code = item.code
  partnerSearch.value = `${item.code} ${item.name}`
  if (isPaymentDoc.value) {
    paymentPartnerCode.value = item.code
    await loadPaymentSources(false)
    return
  }
  applyPartnerHeaderDefaults(item)
  // 销售单切换客户：若已有可重新取价的物料行，询问是否按新客户价格等级重新取价
  if (priceMode.value === 'sale') {
    const level = Number(item.price_level) || 1
    const pricedRows = lines.value.filter(l => l.item_code && Array.isArray(l._sp))
    if (pricedRows.length) {
      try {
        await ElMessageBox.confirm(`是否按客户「${item.name}」的 ${level} 级售价重新取价？（会覆盖已填单价）`, '价格等级', {
          confirmButtonText: '重新取价', cancelButtonText: '保持不变', type: 'info',
        })
        for (const row of pricedRows) {
          if (Array.isArray(row._sp)) {
            row.price = salePriceByLevel({ sale_price: row._sp[0], sale_price2: row._sp[1], sale_price3: row._sp[2] }, level)
            recalcRow(row)
          }
        }
        ElMessage.success(`已按 ${level} 级售价重新取价`)
      } catch { /* 用户选择保持不变 */ }
    }
  }
}

// 往来单位输入框文本与已选编码同步守卫：
// el-autocomplete 的 v-model 绑的是「显示文本」(partnerSearch)，真正的编码 form.partner_code
// 只在「下拉选中」(onPartnerSelect) 时写、「点 × 清除」(@clear) 时清。
// 若用户手工删改文本（没点 × 也没重新选），编码会残留旧值 → 选源单/保存仍按旧往来单位过滤。
// 这里监听文本，一旦与「当前已选编码对应的显示值」不一致，立即清空编码，避免脏值。
watch(partnerSearch, (val) => {
  const code = form.value.partner_code
  if (!code) return
  const p = allPartners.value.find(x => x.code === code)
  const label = p ? `${p.code} ${p.name}` : code  // 与各处设置 partnerSearch 的口径一致（档案缺失时回退裸编码）
  if (val !== label) {
    form.value.partner_code = ''
    if (isPaymentDoc.value) {
      paymentPartnerCode.value = ''
      clearPaymentSelection()
    }
  }
})

async function handleBomExplode() {
  if (!selectedBom.value) return
  const res = await scmApi.explodeBom(selectedBom.value, totalQty.value || 1)
  if (res.code === 0)
    lines.value = (res.data.lines || []).map((l: any) => ({
      item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '', warehouse_code: form.value.warehouse_code,
      qty: l.total_qty, price: 0, amount: 0, tax_rate: null, tax_amount: 0, remark: '',
      price_with_tax: 0, discount_rate: 0, batch_no: '', expire_date: '', scrap_rate: Number(l.scrap_rate) || 0, process_fee: 0,
    }))
}

// 组装单：在成品表选中成品 → 按其 BOM 展开子件。
// 成品仅 1 个 BOM → 直接展开；多个 BOM → 弹框选；无 BOM → 不展开（可点「物料」手工加）。
function onPickAsProduct(row: any, item: any) {
  if (!isAssembly.value || row.line_role !== 'product' || !item?.code) return
  const bomsForItem = boms.value.filter((b: any) => b.item_code === item.code && b.status !== 'inactive')
  if (bomsForItem.length === 0) {
    ElMessage.info('该成品暂无 BOM，可点成品行「物料」手工添加子件')
  } else if (bomsForItem.length === 1) {
    applyBomExplode(row, bomsForItem[0].id)
  } else {
    bomDlgOptions.value = bomsForItem
    bomDlgRow.value = row
    bomDlgVisible.value = true
  }
}
/** 把某成品行按指定 BOM 展开为其子件（替换本组旧子件），成品行与子件同 product_group。 */
async function applyBomExplode(row: any, bomId: string) {
  if (row.product_group == null) row.product_group = nextProductGroup()
  if (!(Number(row.qty) > 0)) row.qty = 1
  const qty = Number(row.qty) || 1
  const res = await scmApi.explodeBom(bomId, qty)
  if (res.code !== 0) return
  const g = row.product_group
  // 去掉本组旧子件，追加新子件
  lines.value = lines.value.filter(l => !(l.line_role !== 'product' && l.product_group === g))
  const comps = (res.data.lines || []).map((l: any) => ({
    item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '', warehouse_code: form.value.warehouse_code,
    qty: l.total_qty, price: 0, amount: 0, tax_rate: null, tax_amount: 0, remark: '', line_role: 'component', product_group: g,
    price_with_tax: 0, discount_rate: 0, batch_no: '', expire_date: '', scrap_rate: Number(l.scrap_rate) || 0, process_fee: 0, field_values: {},
  }))
  lines.value.push(...comps)
}
// 成品多 BOM 时的「选 BOM」弹窗
const bomDlgVisible = ref(false)
const bomDlgOptions = ref<any[]>([])
const bomDlgRow = ref<any>(null)
function pickBom(bomId: string) {
  if (bomDlgRow.value) applyBomExplode(bomDlgRow.value, bomId)
  bomDlgVisible.value = false
}

// ── 凭证科目挂了辅助核算 → 单据往来单位 / 部门 / 业务员必填（保存只提醒，审核时后端拦截） ──
const auxRequired = ref<ScmAuxRequiredField[]>([])
const auxReqSources = computed(() => new Set(auxRequired.value.map(f => f.source)))
/** 审核被拦截后标红的字段 */
const auxErrorSources = ref<Set<string>>(new Set())
function auxSourceValue(source: string): string {
  if (source === 'partner') return String(form.value.partner_code || '').trim()
  if (source === 'dept') return String(form.value.dept_code || '').trim()
  return String(form.value.biz_person || '').trim()
}
const auxMissing = computed(() => auxRequired.value.filter(f => !auxSourceValue(f.source)))
function auxFieldError(source: string): string {
  if (!auxErrorSources.value.has(source) || auxSourceValue(source)) return ''
  const f = auxRequired.value.find(x => x.source === source)
  return f ? `凭证科目 ${f.accounts[0] || ''} 要求填写${f.label}` : '请填写'
}
function auxRequirementLines(): Array<Record<string, any>> {
  if (isPaymentDoc.value) return [{ qty: 1, price: 1, amount: 1 }]
  return lines.value
    .filter(l => l.item_code && Number(l.qty) > 0)
    .map(l => ({ item_code: l.item_code, qty: Number(l.qty), price: Number(l.price) || 0, amount: Number(l.amount) || 0,
      tax_amount: Number(l.tax_amount) || 0, unit_cost: l.unit_cost ?? null, line_role: l.line_role || null }))
}
let auxReqTimer: ReturnType<typeof setTimeout> | null = null
let auxReqSeq = 0
async function refreshAuxRequirements() {
  const seq = ++auxReqSeq
  if (!form.value.doc_type || form.value.status === 'audited') { auxRequired.value = []; return }
  try {
    const r = await scmApi.auxRequirements({
      doc_type: form.value.doc_type, partner_code: form.value.partner_code || '', dept_code: form.value.dept_code || '',
      biz_person: form.value.biz_person || '', settle_account: form.value.settle_account || '',
      source_doc_id: initSourceDocIds.value.length === 1 ? initSourceDocIds.value[0] : (form.value as any).source_doc_id || null,
      bom_id: selectedBom.value || null, lines: auxRequirementLines(),
    })
    if (seq === auxReqSeq) auxRequired.value = r.data?.required || []
  } catch { /* 提醒接口失败不影响录入 */ }
}
function scheduleAuxRequirements() {
  if (auxReqTimer) clearTimeout(auxReqTimer)
  auxReqTimer = setTimeout(refreshAuxRequirements, 400)
}
watch(
  [() => form.value.doc_type, () => form.value.partner_code, () => form.value.settle_account, () => form.value.status,
    () => lines.value.map(l => `${l.item_code || ''}:${Number(l.qty) > 0 ? 1 : 0}:${l.line_role || ''}`).join('|')],
  scheduleAuxRequirements,
  { immediate: true },
)
/** 审核被 SCM_AUX_REQUIRED 拦截：标红对应字段 */
function markAuxRequiredError(e: any): boolean {
  const body = e?.response?.data
  if (body?.reason !== 'SCM_AUX_REQUIRED') return false
  const fields: ScmAuxRequiredField[] = Array.isArray(body?.data?.fields) ? body.data.fields : []
  for (const f of fields) if (!auxRequired.value.some(x => x.source === f.source)) auxRequired.value = [...auxRequired.value, f]
  auxErrorSources.value = new Set(fields.map(f => f.source))
  return true
}
/** 保存前提醒：缺必填辅助字段时确认，仍可保存 */
async function confirmAuxMissingBeforeSave(thenAudit: boolean): Promise<boolean> {
  await refreshAuxRequirements()
  const missing = auxMissing.value
  if (!missing.length) return true
  const tip = missing.map(f => `• ${f.label}：科目 ${f.accounts.slice(0, 3).join('、')} 挂了「${f.categoryNames.join('、')}」辅助核算`).join('\n')
  auxErrorSources.value = new Set(missing.map(f => f.source))
  try {
    await ElMessageBox.confirm(
      `以下字段未填写，${thenAudit ? '本次审核会被拦截' : '审核时会被拦截'}（凭证辅助核算无法填写）：\n${tip}\n\n仍要保存吗？`,
      '关键字段未填写',
      { confirmButtonText: '仍要保存', cancelButtonText: '返回填写', type: 'warning' },
    )
    return true
  } catch { return false }
}

async function handleSave(thenAudit = false) {
  if (!form.value.doc_type || !form.value.doc_date) return ElMessage.warning('类型和日期不能为空')
  if (isPlanControlledDoc.value && !form.value.plan_id) return ElMessage.warning('请先选择已审核来源工单')
  if (isPaymentDoc.value && !form.value.partner_code) return ElMessage.warning(`${isReceivePayment.value ? '收款单' : '付款单'}必须指定往来单位`)
  if (isPaymentDoc.value && !form.value.settle_account) return ElMessage.warning(`请选择${isReceivePayment.value ? '收款' : '付款'}账户`)
  if (isPaymentDoc.value) onPaymentAccountChange(form.value.settle_account)
  if (isPaymentDoc.value && (Number(advanceAmount.value) < 0 || paymentSources.value.some(l => Number(l.current_amount) < 0))) return ElMessage.warning('收付款金额不能为负数')
  if (isAdvancePaymentMode.value && !(Number(advanceAmount.value) > 0)) return ElMessage.warning(`请填写大于零的${isReceivePayment.value ? '预收款' : '预付款'}金额`)
  if (isPaymentDoc.value) {
    const invalid = paymentSources.value.find(l => l.selected && (l.invalid || !l.arap_source_log_id))
    if (invalid) return ElMessage.warning(`源单 ${invalid.source_doc_no || ''} 已失效或余额已变化，请取消勾选或刷新后重试`)
    const over = paymentSources.value.find(l => l.selected && Number(l.current_amount) > Number(l.open_amount) + 0.005)
    if (over) return ElMessage.warning(`源单 ${over.source_doc_no} 本次金额不能超过未结算余额 ${fmt(over.open_amount)}`)
    const empty = paymentSources.value.find(l => l.selected && !(Number(l.current_amount) > 0))
    if (empty) return ElMessage.warning(`请填写源单 ${empty.source_doc_no} 的本次${isReceivePayment.value ? '收款' : '付款'}金额`)
  }
  if (isTransfer.value && !form.value.warehouse_code) return ElMessage.warning('调拨单须指定调出仓')
  // 销售发货单：审核要扣库存、挂应收，故仓库与客户必填
  if (isShipment.value && !form.value.warehouse_code) return ElMessage.warning('销售出库单必须指定仓库')
  if (partnerRequired.value && !form.value.partner_code) return ElMessage.warning(`${DOC_TITLE[form.value.doc_type] || '当前单据'}必须指定${isCustomerDoc.value ? '客户' : '供应商'}（往来单位）`)
  const paymentLines: Array<Record<string, any>> = isPaymentDoc.value
    ? [
        ...paymentSelectedRows.value.map(l => ({
          item_code: null, qty: 1, price: Number(l.current_amount), amount: Number(l.current_amount),
          remark: l.payment_remark || `${l.source_doc_no} ${isReceivePayment.value ? '收款' : '付款'}`,
          arap_source_log_id: l.arap_source_log_id,
        })),
        ...(Number(advanceAmount.value) > 0 ? [{
          item_code: null, qty: 1, price: Number(advanceAmount.value), amount: Number(advanceAmount.value),
          remark: advanceRemark.value || (isReceivePayment.value ? '预收款' : '预付款'), arap_source_log_id: null,
        }] : []),
      ]
    : []
  const sourceLines: Array<Record<string, any>> = isPaymentDoc.value
    ? paymentLines
    : lines.value.filter(l => l.item_code && Number(l.qty) > 0)
  const cleanLines = sourceLines
    .map(l => ({
      id: l.id || undefined, item_code: l.item_code ?? null,
      warehouse_code: l.warehouse_code || form.value.warehouse_code,
      qty: Number(l.qty), price: Number(l.price) || 0, amount: Number(l.amount) || 0,
      unit_cost: l.unit_cost ?? undefined,
      tax_rate: effTax(l), tax_amount: Number(l.tax_amount) || 0,
      remark: l.remark || '',
      price_with_tax: Number(l.price_with_tax) || 0, discount_rate: Number(l.discount_rate) || 0,
      batch_no: l.batch_no || '', produce_date: l.produce_date || null, expire_date: l.expire_date || null,
      serial_nos: Array.isArray(l.serial_nos) ? l.serial_nos : (l.serial_nos ? parseSerialText(String(l.serial_nos)) : undefined),
      bin_no: l.bin_no || null,
      scrap_rate: Number(l.scrap_rate) || 0, process_fee: Number(l.process_fee) || 0,
      source_line_id: l.source_line_id ?? undefined,
      arap_source_log_id: l.arap_source_log_id ?? null,
      supplier_code: l.supplier_code || null,
      source_type: l.source_type || null,
      line_role: l.line_role || null,
      product_group: (l.product_group === undefined || l.product_group === null || l.product_group === '') ? null : Number(l.product_group),
      field_values: (l.field_values && typeof l.field_values === 'object') ? l.field_values : {},
    }))
  if (!cleanLines.length) return ElMessage.warning(isPaymentDoc.value ? '请至少填写一笔大于零的收付款金额' : '请添加至少一行物料')
  // 组装单成品行模式：有成品行则必须有子件行（出库料）
  if (isAssembly.value && cleanLines.some(l => l.line_role === 'product') && !cleanLines.some(l => l.line_role !== 'product'))
    return ElMessage.warning('组装单需至少一条子件行（出库料）')
  // 组装单「按成品分列」时：每个成品必须有本组子件（否则该成品无成本来源）
  if (isAssembly.value) {
    const prods = cleanLines.filter(l => l.line_role === 'product')
    const comps = cleanLines.filter(l => l.line_role !== 'product')
    if (comps.some(c => !c.warehouse_code)) return ElMessage.warning('组装单子件须指定出库仓（表头仓库或子件仓库）')
    const allGrouped = comps.length > 0 && comps.every(c => c.product_group != null) && prods.every(p => p.product_group != null)
    if (allGrouped) {
      const miss = prods.find(p => !comps.some(c => c.product_group === p.product_group))
      if (miss) return ElMessage.warning(`成品「${miss.item_code}」缺少对应子件行`)
    }
  }
  if (asNeedsPartner.value && !form.value.partner_code)
    return ElMessage.warning(`${form.value.process_mode === 'contract' ? '受托加工请选择客户' : '委托加工请选择加工厂（供应商）'}`)
  if (isTransfer.value && cleanLines.some(l => !l.warehouse_code)) return ElMessage.warning('调拨单每行须指定调入仓')
  // 采购退货扣减库存：每行须有可解析仓库（行仓库 || 表头仓库），否则后端只会报含糊的「库存不足」
  if (isPurchaseReturn.value && cleanLines.some(l => !l.warehouse_code)) return ElMessage.warning('采购退货须指定仓库（表头或明细行），否则无法扣减库存')
  // 序列号物料：序列号个数须等于数量
  const snBad = lines.value.find(l => l.item_code && l._serial && Number(l.qty) > 0 && serialCount(l) !== (Number(l.qty) || 0))
  if (snBad) return ElMessage.warning(`物料 ${snBad.item_code} 需录入 ${Number(snBad.qty) || 0} 个序列号（当前 ${serialCount(snBad)} 个）`)
  // 采购单据：起订量软校验（行数量低于物料最小订货量时确认）
  if (priceMode.value === 'purchase') {
    const below = lines.value.filter(l => l.item_code && Number(l.qty) > 0 && Number(l._moq) > 0 && Number(l.qty) < Number(l._moq))
    if (below.length) {
      const tip = below.slice(0, 5).map(l => `${l.item_code} ${l.item_name || ''}：${l.qty} < 起订量 ${l._moq}`).join('\n')
      try {
        await ElMessageBox.confirm(`以下物料数量低于最小订货量：\n${tip}${below.length > 5 ? `\n……共 ${below.length} 项` : ''}\n仍要保存吗？`, '起订量提示', {
          confirmButtonText: '仍要保存', cancelButtonText: '返回修改', type: 'warning',
        })
      } catch { return }
    }
  }
  if (!(await confirmAuxMissingBeforeSave(thenAudit))) return
  saving.value = true
  try {
    const payload: Record<string, any> = { ...form.value, lines: cleanLines, total_qty: totalQty.value, total_amount: totalAmount.value, total_tax: totalTax.value }
    if (initSourceDocIds.value.length === 1) payload.source_doc_id = initSourceDocIds.value[0]
    else if (initSourceDocIds.value.length > 1) payload.source_doc_id = null
    // 组装/拆卸单：携带 BOM ID
    if (isProduction.value && selectedBom.value) payload.bom_id = selectedBom.value
    let savedId = editId.value || ''
    if (editId.value) {
      await scmApi.updateDoc(editId.value, payload)
    } else {
      const r = await scmApi.createDoc(payload)
      savedId = r.data?.id || ''
    }
    // 记忆本单常用表头字段，供下次新增同类型单据带出
    rememberDocDefaults(form.value.doc_type)
    if (thenAudit && savedId) {
      // 保存并审核：只有审核成功才切换到查看页。审核失败时保留编辑态，
      // 让用户可直接修正明细、库存或业务校验问题，不能误导为还要再点一次审核。
      try {
        const audited = await auditWithItemDefaultWarehouses(savedId)
        if (audited.code !== 0 || audited.data?.status !== 'audited') {
          throw new Error('审核未完成，请检查单据数据后重试')
        }
        form.value.status = audited.data.status
        form.value.total_amount = audited.data.total_amount
        form.value.auditor = audited.data.auditor || ''
        form.value.audited_at = audited.data.audited_at || null
        ElMessage.success('已保存并审核')
        await router.push({ name: 'ScmDocView', params: { id: savedId }, query: route.query })
      } catch (e: any) {
        markAuxRequiredError(e)
        ElMessage.warning('已保存为草稿，但审核失败：' + (e?.response?.data?.message || e?.message || ''))
        // 新增单据已落库：切到该草稿的编辑页。否则仍停在「新增」路由（editId 为空），
        // 再点保存会另建一张草稿，草稿占用计划数，后续报「已完工/报废/占用」（客户反馈）
        if (!editId.value) await router.push({ name: 'ScmDocEdit', params: { id: savedId }, query: route.query })
      }
    } else {
      ElMessage.success('保存成功')
      goBack()
    }
  } catch (e: any) {
    // 保存被后端拒绝（如超计划完工）：请求拦截器已弹出原因，这里吞掉异常，保留用户已录入的内容。
    // 不吞的话异常冒泡到 onErrorCaptured，整张单据被替换成「表单渲染遇到错误」，录入全部丢失。
    markAuxRequiredError(e)
    console.warn('单据保存失败：', e?.response?.data?.message || e?.message || e)
  } finally {
    saving.value = false
  }
}

// 查看页直接审核 / 反审核（与列表行为一致；页面访问已受模块权限控制）
async function auditWithItemDefaultWarehouses(id: string) {
  try {
    return await scmApi.auditDoc(id, {}, { skipErrorToast: true })
  } catch (error: any) {
    const data = error?.response?.data?.data
    if (data?.error_code !== 'DEFAULT_WAREHOUSE_CONFIRMATION_REQUIRED') throw error
    await confirmAuditDefaultWarehouses(data)
    return scmApi.auditDoc(id, { apply_item_default_warehouses: true }, { skipErrorToast: true })
  }
}

async function handleAuditDoc() {
  if (!editId.value) return
  try { await ElMessageBox.confirm('确认审核该单据？审核后将产生库存移动/往来等记账。', '审核确认', { type: 'info' }) } catch { return }
  auditing.value = true
  try {
    await auditWithItemDefaultWarehouses(editId.value)
    ElMessage.success('已审核')
    await loadDoc(editId.value)
  } catch (e: any) {
    markAuxRequiredError(e)
    ElMessage.error(e?.response?.data?.message || e?.message || '审核失败')
  } finally { auditing.value = false }
}
async function handleUnauditDoc() {
  if (!editId.value) return
  try { await ElMessageBox.confirm('确认反审核（将撤销库存移动）？', '反审核确认', { type: 'warning' }) } catch { return }
  auditing.value = true
  try {
    const r: any = await scmApi.unauditDoc(editId.value, { skipErrorToast: true })
    ElMessage.success(r?.data?.notice ? `已反审核，${r.data.notice}` : '已反审核')
    await loadDoc(editId.value)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '反审核失败（可能已被下游单据引用）')
  } finally { auditing.value = false }
}

// 与列表操作列一致：生成凭证 / 生成资产 / 删除 / 查看上下游
async function handleGenVoucher() {
  const id = editId.value
  if (!id) return
  try { await ElMessageBox.confirm('为该单据生成记账凭证？', '提示', { type: 'info' }) } catch { return }
  // 辅助核算对应不上时跳转处理页（提示在 genScmVoucher 内完成）；处理完重试成功后刷新本单据
  await genScmVoucher(id, () => loadDoc(id))
  await loadDoc(id)
}
async function handleDeleteDoc() {
  if (!editId.value) return
  try { await ElMessageBox.confirm(`确认删除单据「${form.value.doc_no}」？`, '提示', { type: 'warning' }) } catch { return }
  try {
    await scmApi.deleteDoc(editId.value, { skipErrorToast: true })
    ElMessage.success('已删除')
    // 删除后当前详情地址已经失效：直接关闭其标签并切到相邻标签，
    // 避免路由或 KeepAlive 再次加载已删除 id，弹出“单据不存在”。
    const currentTab = tabsStore.activeTab
    const nextPath = currentTab ? tabsStore.closeTab(currentTab.key) : null
    void router.replace(nextPath || '/dashboard')
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || e?.message || '删除失败（可能已被下游单据引用）') }
}
function goDownstream() {
  if (editId.value) router.push({ name: 'ScmDocDownstream', params: { id: editId.value } })
}

function goBack() {
  const dt = form.value.doc_type || initDocType.value
  router.push({ name: 'ScmDocList', query: scmDocNavContextToListQuery(docNavContext.value, dt) })
}
function goEdit() {
  router.push({ name: 'ScmDocEdit', params: { id: editId.value }, query: route.query })
}
function goPrint() {
  if (editId.value) router.push(`/scm/docs/${editId.value}/print`)
}
// 完工/委外入库单成本明细页
function goCost() {
  if (editId.value) router.push({ name: 'ScmDocCost', params: { id: editId.value } })
}
</script>

<style scoped>
.sub-hint { color: var(--el-color-warning-dark-2); font-size: 12px; }
.doc-form-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.doc-form-header {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}
/* 窄屏（≤1280）时右侧按钮组会把标题挤成竖排、下推等按钮被推出视口：标题不换行、左右两组允许各自折行 */
.doc-form-header__left { display: flex; align-items: center; gap: 6px; font-size: var(--cw-text-base); flex-wrap: wrap; min-width: 0; }
.doc-form-header__sep { color: var(--el-text-color-placeholder); }
.doc-form-header__title { font-weight: 600; color: var(--el-text-color-primary); white-space: nowrap; }
.doc-form-header__meta { margin-left: 10px; font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.doc-form-header__right { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-left: auto; }
.doc-form-body { flex: 1; overflow: auto; padding: 14px 16px; }
.doc-lines-toolbar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 10px 0 10px;
  /* 独占一行并抬高层级：按钮多时换行而不是压到下方表格表头上，避免与「#/编号」表头重叠糊成一团 */
  position: relative; z-index: 2;
}
.doc-lines-summary-col { display: flex; align-items: center; justify-content: flex-end; min-height: 32px; margin-bottom: 8px; }
.doc-lines-summary { margin-left: auto; text-align: right; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.doc-cost-hint { margin-left: 12px; color: var(--el-color-warning); font-size: 12px; }
.payment-source-panel { margin-top: 2px; }
.payment-source-tip { margin-bottom: 10px; }
.payment-return-block { margin-top: 10px; }
.payment-return-block__title { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--el-text-color-primary); }
.payment-return-block__hint { margin-left: 8px; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.payment-advance-row {
  display: grid; grid-template-columns: 110px minmax(260px, 1fr) 180px minmax(220px, 1fr);
  align-items: center; gap: 12px; margin-top: 12px; padding: 12px 14px;
  border: 1px solid var(--el-border-color-light); border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-extra-light);
}
.payment-advance-row__title { font-weight: 600; color: var(--el-text-color-primary); }
.payment-advance-row__hint { color: var(--el-text-color-secondary); font-size: 12px; }
.payment-advance-row__amount { width: 180px; justify-self: end; }
.payment-advance-row__value { text-align: right; font-weight: 600; color: var(--el-color-primary); }
.payment-advance-row__remark { min-width: 220px; }
.doc-form-footer { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--el-border-color); }
.rt-stock { color: var(--el-color-primary); font-size: 12px; }
.line-col-setting__hd {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px; font-size: var(--cw-text-base); font-weight: 600;
}
.line-col-setting__group { display: flex; flex-direction: column; gap: 2px; }
.line-col-setting__empty { color: var(--el-text-color-placeholder); font-size: 12px; padding: 6px 0; }

.compact-data-table :deep(.el-table__cell) {
  padding: 0;
}
/* 组装单成品/子件分组 */
.as-group { margin-top: 10px; }
.as-group__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.as-group__title { font-weight: 600; font-size: var(--cw-text-base); }
.as-group__title.is-product { color: var(--el-color-success); }
.as-group__title.is-component { color: var(--el-color-info); }
.as-fee-hint { margin-left: 2px; font-size: 11px; font-weight: normal; color: var(--el-text-color-secondary); }
.as-group__count { font-size: 12px; color: var(--el-text-color-secondary); }
.as-group__hint { font-size: 12px; color: var(--el-text-color-placeholder); }
.as-empty { text-align: center; color: var(--el-text-color-placeholder); font-size: var(--cw-text-base); padding: 12px 0; border: 1px dashed var(--el-border-color-lighter); border-top: none; }
.mat-dlg-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mat-dlg-hint { font-size: 12px; color: var(--el-text-color-secondary); }
/* 合计行（表体最后一行）：加粗 + 浅底，水平滚动条落在其下方 */
.compact-data-table :deep(.doc-line-summary .el-table__expand-icon) { visibility: hidden; }
.compact-data-table :deep(.doc-cost-expandable > td.el-table__cell) { cursor: pointer; }
.cost-source-panel { padding: 10px 14px 14px 56px; background: var(--el-fill-color-lighter); }
.cost-source-panel__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.cost-source-panel__formula { margin-left: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.cost-source-panel__segments { display: flex; flex-wrap: wrap; gap: 14px; font-size: var(--cw-text-base); color: var(--el-text-color-regular); }
.cost-source-table { width: 100%; }
.compact-data-table :deep(.cell) {
  padding: 0 4px;
  line-height: 28px;
}
.doc-line-actions {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 8px;
  white-space: nowrap;
  width: 100%;
}
.doc-line-actions :deep(.el-button + .el-button) { margin-left: 0; }
.editable-cell {
  min-height: 28px;
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.editable-cell.is-locked { cursor: not-allowed; color: var(--el-text-color-secondary); }
.editable-cell.price-diff { background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.editable-cell:hover {
  background-color: var(--el-fill-color-light);
}
.doc-relation-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 8px 12px;
  background-color: var(--el-color-info-light-9);
  border: 1px dashed var(--el-border-color);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  font-size: var(--cw-text-base);
  gap: 16px;
}
.relation-item {
  display: inline-flex;
  align-items: center;
}
.relation-label {
  font-weight: 600;
  color: var(--el-text-color-regular);
}
/* 下游锁定提示：内联到关联条右侧，与下游单据链接同一行（节省垂直空间） */
.relation-lock-tip {
  margin-left: auto;
  padding-left: 12px;
  border-left: 1px solid var(--el-border-color);
  color: var(--el-color-warning);
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  cursor: help;
}
.target-doc-item {
  margin-right: 12px;
}
.text-success { color: var(--el-color-success); font-weight: 600; }
.text-warning { color: var(--el-color-warning); font-weight: 600; }
.text-danger { color: var(--el-color-danger); }
.text-muted { color: var(--el-text-color-placeholder); }
</style>
