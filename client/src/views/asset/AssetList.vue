<template>
  <div class="page page-asset-list">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button v-permission="'asset:edit'" type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增固定资产</el-button>
      <el-button size="small" :disabled="!selection.length" @click="openPrint('card')">
        打印卡片{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button size="small" :disabled="!selection.length" @click="openPrint('label')">
        打印标签{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <!-- 另存：导出 Excel（与凭证、库存等页面「另存」一致）；有勾选导勾选行，否则按当前筛选导出全部 -->
      <el-button size="small" :loading="exporting" :title="selection.length ? '导出勾选的卡片' : '按当前筛选条件导出全部卡片'" @click="exportExcel">
        另存{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button v-permission="'asset:change'" size="small" :disabled="!selection.length" @click="openBatchChange('dept')">
        批量调拨{{ selection.length ? `（${selection.length}）` : '' }}
      </el-button>
      <el-button v-permission="'asset:change'" size="small" :disabled="!selection.length" @click="openBatchChange('status')">
        批量停启用
      </el-button>
      <el-button v-permission="'asset:edit'" size="small" @click="$router.push('/asset/import')">批量导入</el-button>
      <!-- 新增资产凭证：对勾选的卡片批量生成（客户反馈：卡片界面没有生成凭证按钮；凭证管理只做删除 / 重新生成） -->
      <el-button v-permission="'asset:edit'" size="small" type="warning" plain :disabled="!pendingVoucherCards.length" @click="openGenVoucher"
        :title="selection.length && !pendingVoucherCards.length ? '所选卡片都已生成新增资产凭证' : '对勾选且未生成凭证的卡片生成新增资产凭证'">
        生成凭证{{ pendingVoucherCards.length ? `（${pendingVoucherCards.length}）` : '' }}
      </el-button>
      <!-- 评审 P2：filters 与后端筛选参数早已接好，但页面没有控件，筛选形同虚设 -->
      <el-divider direction="vertical" />
      <el-input v-model="filters.keyword" size="small" clearable placeholder="编号 / 名称" style="width:160px"
        @keyup.enter="onFilterChange" @clear="onFilterChange" />
      <el-select v-model="filters.category_code" size="small" placeholder="资产类别" style="width:130px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部资产类别" value="" />
        <el-option v-for="c in dicts.category" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.status_code" size="small" placeholder="使用状态" style="width:128px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部使用状态" value="" />
        <el-option v-for="c in dicts.status" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.dept_code" size="small" placeholder="使用部门" style="width:130px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部使用部门" value="" />
        <el-option v-for="c in dicts.dept" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <!-- 第七份反馈：增加查询条件 -->
      <el-select v-model="filters.purpose_code" size="small" placeholder="用途" style="width:118px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部用途" value="" />
        <el-option v-for="c in dicts.purpose" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.depr_method" size="small" placeholder="折旧方法" style="width:128px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部折旧方法" value="" />
        <el-option v-for="(label, val) in DEPR_METHODS" :key="val" :label="label" :value="val" />
      </el-select>
      <el-select v-model="filters.disposed" size="small" style="width:118px" @change="onFilterChange" :empty-values="[null, undefined]">
        <el-option label="全部卡片" value="" />
        <el-option label="在用（未处置）" value="0" />
        <el-option label="已处置" value="1" />
      </el-select>
      <el-date-picker v-model="filters.acquire_range" type="daterange" size="small" value-format="YYYY-MM-DD"
        start-placeholder="购置日期起" end-placeholder="购置日期止" range-separator="至" style="width:230px" @change="onFilterChange" />
      <el-button size="small" type="primary" plain @click="onFilterChange"><el-icon><Search /></el-icon>查询</el-button>
      <el-button size="small" :icon="Setting" @click="columnDialogVisible = true">列设置</el-button>
    </div>
    <div ref="tableContainerRef" class="table-container">
      <el-table ref="tableRef" :data="list" :height="tableHeight" border stripe size="small" class="compact-data-table"
        highlight-current-row @row-dblclick="openEdit" @header-dragend="onDragEnd"
        @selection-change="rows => (selection = rows)">
        <el-table-column type="selection" width="42" />
        <!-- 第七份反馈：列表列参照润衡「能多不能少」，卡片字段都可在「列设置」里勾选显示 / 隐藏、调整顺序 -->
        <el-table-column
          v-for="col in visibleDataColumns"
          :key="col.key"
          :column-key="col.key"
          :label="col.label"
          :width="cw(col.key, ASSET_COL_DEFS[col.key]?.width || 100)"
          :align="ASSET_COL_DEFS[col.key]?.align || 'left'"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-tag v-if="col.key === 'status_code'" :type="statusTagType(row.status_code)" size="small">{{ row.status_name || row.status_code }}</el-tag>
            <template v-else>{{ assetCellText(row, col.key) }}</template>
          </template>
        </el-table-column>
        <!-- 新增资产凭证：参照金蝶卡片列表，凭证号可点开，可删除（只删凭证，卡片保留，可重新生成） -->
        <el-table-column v-if="columnVisible('purchase_voucher')" label="新增资产凭证" :width="cw('purchase_voucher', 150)" align="center">
          <template #default="{ row }">
            <template v-if="(row as any).purchase_voucher">
              <el-link type="primary" :underline="false" @click.stop="openPurchaseVoucher(row)">{{ purchaseVoucherLabel(row) }}</el-link>
              <el-link v-permission="'asset:edit'" type="danger" :underline="false" style="margin-left:8px" @click.stop="deletePurchaseVoucher(row)">删除</el-link>
            </template>
            <el-link v-else v-permission="'asset:edit'" type="primary" :underline="false" @click.stop="$router.push({ path: '/asset/vouchers/regenerate', query: { kind: 'purchase', ref: row.id } })">生成</el-link>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="cw('actions', 190)" align="center" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="success" size="small" @click.stop="$router.push(`/asset/detail/${row.id}`)">明细</el-button>
              <el-button v-permission="'asset:edit'" link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
              <el-button v-if="!row.scrap_date" v-permission="'asset:change'" link type="primary" size="small" @click.stop="$router.push(`/asset/change?assetId=${row.id}`)">变动</el-button>
              <el-button v-if="!row.scrap_date" v-permission="'asset:dispose'" link type="warning" size="small" @click.stop="openDispose(row)">处置</el-button>
              <el-button v-if="row.scrap_date" v-permission="'asset:dispose'" link type="success" size="small" @click.stop="handleCancelDispose(row)">撤销处置</el-button>
              <el-button v-permission="'asset:edit'" link type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="table-footer">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="handleQuery"
      />
    </div>

    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettings" @update:columns="updateColumns" @reset="resetColumns" />

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editId ? '编辑固定资产' : '新增固定资产'" width="800px" draggable :close-on-click-modal="false">
      <div v-if="editId && navigationInfo" style="margin-bottom: 8px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 6px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="100px" size="small" class="asset-form" @keydown.ctrl.enter.prevent="!editId && !saving && handleSave(true)">
        <div class="form-sector">
          <div class="form-sector-title">资产基本信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="资产编号" required>
                <el-input v-model="form.asset_no" :disabled="!!editId" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产名称" required>
                <el-input v-model="form.asset_name" />
              </el-form-item>
            </el-col>
            <!-- v169 第七份反馈：参照润衡卡片补充 -->
            <el-col :span="12">
              <el-form-item label="规格型号">
                <el-input v-model="form.spec" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="参考编号">
                <el-input v-model="form.ref_no" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产类别" required>
                <el-select v-model="form.category_code" clearable style="width:100%"
                  @change="onCategoryChange">
                  <el-option v-for="c in dicts.category" :key="c.code" :label="c.name" :value="c.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="资产状态">
                <el-select v-model="form.status_code" clearable style="width:100%">
                  <el-option v-for="s in dicts.status" :key="s.code" :label="s.name" :value="s.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="使用部门">
                <el-select v-model="form.dept_code" clearable style="width:100%">
                  <el-option v-for="d in dicts.dept" :key="d.code" :label="d.name" :value="d.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="用途" required>
                <el-select v-model="form.purpose_code" clearable style="width:100%">
                  <el-option v-for="p in dicts.purpose" :key="p.code" :label="p.name" :value="p.code" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">财务与折旧信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="原值" required>
                <el-input-number v-model="form.original_value" :precision="2" :min="0" :disabled="!!valueLockReason" style="width:100%" @change="onOriginalValueChange" />
                <span v-if="valueLockReason" class="tip-text">{{ valueLockReason }}，原值请通过「资产变动 → 原值变动」调整</span>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="折旧方法" required>
                <el-select v-model="form.depr_method" clearable style="width:100%">
                  <el-option v-for="(label, val) in DEPR_METHODS" :key="val" :label="label" :value="val" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="购置日期">
                <el-date-picker v-model="form.acquire_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="起折日期" required>
                <el-date-picker v-model="form.start_depr_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="期初累计折旧">
                <el-input-number v-model="form.accum_depr" :precision="2" :min="0" :disabled="!!valueLockReason" style="width:100%" @change="onAccumDeprChange" />
                <span v-if="valueLockReason" class="tip-text">累计折旧由计提 / 反折旧维护</span>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="已计提月份">
                <el-input-number v-model="form.depr_months_done" :min="0" :precision="0" :disabled="!!editId" style="width:100%" @change="onDeprMonthsChange" />
                <span v-if="editId" class="tip-text">已提月数由折旧计提维护，不能手工修改</span>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="使用总月数" :required="form.depr_method !== '2'">
                <el-input-number v-model="form.use_months" :min="1" :precision="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="残值率">
                <!-- 口径提示放进悬停提示，避免在输入框下折出第二行 -->
                <el-input-number v-model="form.salvage_rate" :precision="4" :step="0.01" :min="0" :max="0.9999" style="width:100%" title="小数口径，0.05 表示 5%" placeholder="0.05 = 5%" @change="calcSalvage" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="预计净残值">
                <el-input-number v-model="form.salvage_value" :precision="2" :min="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="12" v-if="form.depr_method === '2'">
              <el-form-item label="总工作量" required>
                <el-input-number v-model="form.total_workload" :min="0.01" :precision="2" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="24" v-if="!editId">
              <div class="voucher-gen-area">
                <el-form-item label="生成购置凭证">
                  <el-switch v-model="(form as any).generate_voucher" />
                  <span v-if="(form as any).generate_voucher" class="sector-tip">借：固定资产 / 贷：资金来源</span>
                  <div v-if="(form as any).generate_voucher && legacyAssetHint" class="legacy-asset-warn">{{ legacyAssetHint }}</div>
                </el-form-item>
                <el-form-item v-if="(form as any).generate_voucher" label="贷方(资金)">
                  <AccountSelect v-model="(form as any).credit_account" placeholder="默认 1001 银行存款" search-keyword="银行存款" />
                </el-form-item>
              </div>
            </el-col>
          </el-row>
        </div>

        <div class="form-sector">
          <div class="form-sector-title">附属管理信息</div>
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="卡片号">
                <el-input v-model="form.card_no" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="数量">
                <el-input-number v-model="form.qty" :min="1" :precision="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="计量单位">
                <el-input v-model="form.unit" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="使用人">
                <el-input v-model="form.user_name" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="保管人">
                <el-input v-model="form.keeper" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="存放地点">
                <el-input v-model="form.install_place" />
              </el-form-item>
            </el-col>
            <el-col :span="16">
              <el-form-item label="制造厂家">
                <el-input v-model="form.manufacturer" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="制造日期">
                <el-date-picker v-model="form.manufacture_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button v-if="!editId" :loading="saving" @click="handleSave(true)">保存并新增 (Ctrl+Enter)</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave()">确认保存</el-button>
      </template>
    </el-dialog>

    <!-- 资产处置弹窗 -->
    <el-dialog v-model="disposeVisible" title="资产处置" width="560px" draggable :close-on-click-modal="false">
      <div class="dispose-info" v-if="disposeAsset">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="资产编号">{{ disposeAsset.asset_no }}</el-descriptions-item>
          <el-descriptions-item label="资产名称">{{ disposeAsset.asset_name }}</el-descriptions-item>
          <el-descriptions-item label="原值">¥{{ fmtAmt(disposeAsset.original_value) }}</el-descriptions-item>
          <el-descriptions-item label="累计折旧">¥{{ fmtAmt(disposeAsset.accum_depr) }}</el-descriptions-item>
          <el-descriptions-item label="净值" :span="2">
            <b>¥{{ fmtAmt(disposeAsset.net_value) }}</b>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <el-form :model="disposeForm" label-width="100px" size="small" style="margin-top:14px">
        <el-form-item label="减少方式">
          <el-select v-model="disposeForm.change_type_code" clearable style="width:100%">
            <el-option v-for="c in disposeTypes" :key="c.code" :label="c.name" :value="c.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置日期" required>
          <el-date-picker v-model="disposeForm.scrap_date" type="date" value-format="YYYY-MM-DD" style="width:100%" :disabled-date="disableFutureMonth" />
        </el-form-item>
        <el-form-item label="处置原因">
          <el-input v-model="disposeForm.scrap_reason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="处置收入">
          <el-input-number v-model="disposeForm.disposal_income" :precision="2" :min="0" style="width:100%" />
        </el-form-item>
        <el-form-item label="处置费用">
          <el-input-number v-model="disposeForm.disposal_expense" :precision="2" :min="0" style="width:100%" />
        </el-form-item>
        <el-form-item label="生成凭证">
          <el-switch v-model="disposeForm.generate_voucher" />
          <span class="tip-text" v-if="disposeForm.generate_voucher">自动生成固定资产清理凭证</span>
        </el-form-item>
        <el-divider v-if="disposeForm.generate_voucher" />
        <el-form-item v-if="disposeForm.generate_voucher" label="清理科目">
          <el-input v-model="disposeForm.clearing_account" placeholder="1606" style="width:140px" />
        </el-form-item>
      </el-form>
      <!-- 处置预览 -->
      <div v-if="disposeAsset" class="dispose-preview">
        <span>净值：<b>¥{{ fmtAmt(disposeAsset.net_value) }}</b></span>
        <el-divider direction="vertical" />
        <span>处置损益：<b :class="disposePreviewGainLoss >= 0 ? 'incr' : 'decr'">
          {{ disposePreviewGainLoss >= 0 ? '+' : '' }}¥{{ fmtAmt(Math.abs(disposePreviewGainLoss)) }}
        </b></span>
      </div>
      <template #footer>
        <el-button @click="disposeVisible = false">取消</el-button>
        <el-button type="warning" :loading="disposing" @click="handleDispose">确认处置</el-button>
      </template>
    </el-dialog>

    <!-- 批量变动：只支持不涉及逐条金额的类型（部门调拨 / 使用状态） -->
    <el-dialog
      v-model="batchVisible"
      :title="batchKind === 'dept' ? '批量部门调拨' : '批量变更使用状态'"
      width="520px"
      draggable
      :close-on-click-modal="false"
    >
      <el-alert
        type="info"
        :closable="false"
        show-icon
        :title="`将对已勾选的 ${selection.length} 张卡片执行同一变动；任一张失败则整批回滚。`"
        style="margin-bottom: 12px"
      />
      <el-form :model="batchForm" label-width="100px" size="small">
        <el-form-item label="变动日期" required>
          <el-date-picker
            v-model="batchForm.change_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            :disabled-date="disableFutureMonth"
          />
        </el-form-item>
        <el-form-item v-if="batchKind === 'dept'" label="调入部门" required>
          <el-select v-model="batchForm.dept_code" style="width: 100%" placeholder="选择调入部门">
            <el-option
              v-for="d in dicts.dept"
              :key="d.code"
              :label="`${d.code} ${d.name}`"
              :value="d.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="变更为" required>
          <el-select v-model="batchForm.status_code" style="width: 100%" placeholder="选择使用状态">
            <el-option
              v-for="st in dicts.status.filter(x => x.code !== '04')"
              :key="st.code"
              :label="`${st.name}${st.depreciable ? '' : '（不计提折旧）'}`"
              :value="st.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchSubmitting" @click="submitBatchChange">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 资产卡片 / 标签打印 -->
    <!-- 批量生成新增资产凭证：只需选贷方（资金来源）科目，属单字段轻量输入 -->
    <el-dialog v-model="genVoucherVisible" title="生成新增资产凭证" width="460px" append-to-body>
      <div class="gen-voucher-tip">
        将为 {{ pendingVoucherCards.length }} 张卡片各生成一张新增资产凭证：借 固定资产（按类别科目）/ 贷 资金来源科目。
        <span v-if="selection.length > pendingVoucherCards.length">已有凭证的 {{ selection.length - pendingVoucherCards.length }} 张将跳过。</span>
      </div>
      <el-form label-width="96px" size="small">
        <el-form-item label="贷方科目">
          <AccountSelect v-model="genVoucherCredit" placeholder="资金来源，如 1002 银行存款" search-keyword="银行存款" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="genVoucherVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="genVoucherRunning" :disabled="!genVoucherCredit" @click="runGenVoucher">生成</el-button>
      </template>
    </el-dialog>
    <HiprintDialog
      v-model="printVisible"
      template-type="report"
      :template-key="printMode === 'card' ? 'asset:card' : 'asset:label'"
      :title="printMode === 'card' ? '打印资产卡片' : '打印资产标签'"
      :get-print-html="() => printHtml"
      :raw-html-preview="true"
      default-paper="A4"
      :default-orientation="printMode === 'card' ? 'portrait' : 'portrait'"
    />
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'

/** P1-20：变动 / 处置 / 盘点日期不得晚于当前期间（自然月或已结账下一期，与后端同口径） */
function disableFutureMonth(date: Date): boolean {
  // 同时禁选总账开账日期之前的日子（后端同样拦截）
  return isAfterWritablePeriod(date) || isBeforeGlStart(date)
}
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useGlStartDate } from '@/composables/useGlStartDate'
const { isBeforeGlStart, isAfterWritablePeriod } = useGlStartDate()
import { useRouter } from 'vue-router'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { Search, Plus, Setting } from '@element-plus/icons-vue'
import { fixedAssetApi, type AssetCard, type AssetDicts, DEPR_METHODS } from '@/api/fixedAsset'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildQrMap, buildAssetCardHtml, buildAssetLabelHtml } from '@/utils/assetCardPrint'
import AccountSelect from '@/components/base/AccountSelect.vue'
import DialogNavigation from '@/components/common/DialogNavigation.vue'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { tableRef: colWidthTableRef, colWidth, onDragEnd } = useListColumnWidth('asset_list')
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const tableRef = colWidthTableRef
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<AssetCard[]>([])
const routerInstance = useRouter()
const selection = ref<AssetCard[]>([])
// ── 批量生成新增资产凭证 ──
const pendingVoucherCards = computed(() => selection.value.filter((c: any) => !c.purchase_voucher && !c.purchase_voucher_id))
const genVoucherVisible = ref(false)
const genVoucherCredit = ref('')
const genVoucherRunning = ref(false)
function openGenVoucher() {
  if (!pendingVoucherCards.value.length) return
  // 默认取首张卡片录入时填的资金来源科目
  genVoucherCredit.value = String((pendingVoucherCards.value[0] as any).credit_account || genVoucherCredit.value || '')
  genVoucherVisible.value = true
}
async function runGenVoucher() {
  const cards = [...pendingVoucherCards.value]
  genVoucherRunning.value = true
  const ok: string[] = []
  const failed: string[] = []
  try {
    for (const c of cards as any[]) {
      try {
        const r = await fixedAssetApi.regenerateAssetVoucher({ kind: 'purchase', ref_id: c.id, credit_account: genVoucherCredit.value }, { skipErrorToast: true })
        if (r.code === 0) ok.push(`${c.asset_no} → ${r.data.voucherNo}`)
        else failed.push(`${c.asset_no}：${(r as any).message || '生成失败'}`)
      } catch (e: any) {
        failed.push(`${c.asset_no}：${e?.response?.data?.message || e?.message || '生成失败'}`)
      }
    }
  } finally { genVoucherRunning.value = false }
  genVoucherVisible.value = false
  if (failed.length) {
    ElNotification({ type: ok.length ? 'warning' : 'error', title: `生成凭证：成功 ${ok.length} 张，失败 ${failed.length} 张`, message: failed.join('\n'), duration: 0 })
  } else {
    ElMessage.success(`已生成 ${ok.length} 张新增资产凭证`)
  }
  await handleQuery()
}

// ── 卡片 / 标签打印 ──────────────────────────────────────
const printVisible = ref(false)
const printMode = ref<'card' | 'label'>('card')
const printHtml = ref('')

/**
 * 二维码需要异步渲染成 data URI，因此先把 HTML 备好再打开打印对话框，
 * HiprintDialog 的 getPrintHtml 是同步接口，直接返回已备好的字符串。
 */
// ── 批量变动 ──────────────────────────────────────────────
const batchVisible = ref(false)
const batchSubmitting = ref(false)
const batchKind = ref<'dept' | 'status'>('dept')
const batchForm = reactive({
  change_date: todayStr(),
  dept_code: '',
  status_code: '',
  remark: '',
})

function openBatchChange(kind: 'dept' | 'status') {
  if (!selection.value.length) return ElMessage.warning('请先勾选要变动的资产')
  batchKind.value = kind
  batchForm.change_date = todayStr()
  batchForm.dept_code = ''
  batchForm.status_code = ''
  batchForm.remark = ''
  batchVisible.value = true
}

async function submitBatchChange() {
  if (!batchForm.change_date) return ElMessage.warning('请选择变动日期')
  const payload =
    batchKind.value === 'dept'
      ? { dept_code: batchForm.dept_code }
      : { status_code: batchForm.status_code }
  if (!Object.values(payload)[0]) {
    return ElMessage.warning(batchKind.value === 'dept' ? '请选择调入部门' : '请选择使用状态')
  }

  batchSubmitting.value = true
  try {
    const res = await fixedAssetApi.batchChange({
      asset_ids: selection.value.map(a => a.id),
      kind: batchKind.value,
      change_date: batchForm.change_date,
      payload,
      remark: batchForm.remark || null,
    })
    ElMessage.success(`批量变动成功，共 ${res.data.successCount} 张卡片`)
    batchVisible.value = false
    handleQuery()
  } finally {
    batchSubmitting.value = false
  }
}

async function openPrint(mode: 'card' | 'label') {
  if (!selection.value.length) return ElMessage.warning('请先勾选要打印的资产')
  printMode.value = mode
  const assets = selection.value
  const qrMap = await buildQrMap(assets, mode === 'card' ? 180 : 140)
  printHtml.value =
    mode === 'card' ? buildAssetCardHtml(assets, qrMap) : buildAssetLabelHtml(assets, qrMap)
  printVisible.value = true
}
const dicts = ref<AssetDicts>({ category: [], status: [], purpose: [], dept: [] } as any)
const filters = reactive({
  keyword: '', category_code: '', status_code: '', dept_code: '',
  purpose_code: '', depr_method: '', disposed: '', acquire_range: null as [string, string] | null,
})
/** 列表 / 导出共用的查询参数 */
function cardQueryParams() {
  return {
    keyword: filters.keyword || undefined,
    category_code: filters.category_code || undefined,
    status_code: filters.status_code || undefined,
    dept_code: filters.dept_code || undefined,
    purpose_code: filters.purpose_code || undefined,
    depr_method: filters.depr_method || undefined,
    disposed: filters.disposed || undefined,
    acquire_from: filters.acquire_range?.[0] || undefined,
    acquire_to: filters.acquire_range?.[1] || undefined,
  }
}

// ── 列设置（第七份反馈：卡片上的字段都能显示在列表，哪些显示由列设置控制）──
type ColKind = 'text' | 'amount' | 'number' | 'rate'
interface AssetColDef { label: string; width: number; align?: 'left' | 'right' | 'center'; kind?: ColKind; required?: boolean; visible?: boolean }
const ASSET_COL_DEFS: Record<string, AssetColDef> = {
  asset_no: { label: '资产编号', width: 120, required: true, visible: true },
  asset_name: { label: '资产名称', width: 150, required: true, visible: true },
  spec: { label: '规格型号', width: 130, visible: true },
  ref_no: { label: '参考编号', width: 100 },
  card_no: { label: '卡片号', width: 100 },
  category_name: { label: '类别', width: 100, visible: true },
  status_code: { label: '状态', width: 80, visible: true },
  dept_name: { label: '使用部门', width: 110, visible: true },
  purpose_name: { label: '用途', width: 90, visible: true },
  depr_method: { label: '折旧方法', width: 110, visible: true },
  use_months: { label: '使用总月数', width: 90, align: 'center', kind: 'number', visible: true },
  depr_months_done: { label: '已提月数', width: 80, align: 'center', kind: 'number', visible: true },
  remain_months: { label: '剩余月数', width: 80, align: 'center', kind: 'number' },
  original_value: { label: '原值', width: 110, align: 'right', kind: 'amount', visible: true },
  accum_depr: { label: '累计折旧', width: 110, align: 'right', kind: 'amount', visible: true },
  net_value: { label: '净值', width: 110, align: 'right', kind: 'amount', visible: true },
  last_month_depr: { label: '月折旧额', width: 100, align: 'right', kind: 'amount', visible: true },
  salvage_rate: { label: '残值率', width: 80, align: 'right', kind: 'rate' },
  salvage_value: { label: '预计净残值', width: 100, align: 'right', kind: 'amount' },
  impairment_amount: { label: '减值准备', width: 100, align: 'right', kind: 'amount' },
  total_workload: { label: '总工作量', width: 90, align: 'right', kind: 'number' },
  workload_done: { label: '已完成工作量', width: 100, align: 'right', kind: 'number' },
  acquire_date: { label: '购置日期', width: 105, visible: true },
  start_depr_date: { label: '起折日期', width: 105 },
  qty: { label: '数量', width: 70, align: 'right', kind: 'number' },
  unit: { label: '计量单位', width: 80 },
  user_name: { label: '使用人', width: 90, visible: true },
  keeper: { label: '保管人', width: 90 },
  install_place: { label: '存放地点', width: 120 },
  manufacturer: { label: '制造厂家', width: 140 },
  manufacture_date: { label: '制造日期', width: 105 },
  foreign_value: { label: '外币原值', width: 100, align: 'right', kind: 'amount' },
  scrap_date: { label: '处置日期', width: 105 },
  remark: { label: '备注', width: 150 },
  purchase_voucher: { label: '新增资产凭证', width: 150, visible: true },
}
const STORAGE_KEY_COLS = 'asset_list_columns_v1'
const defaultColumnSettings = (): ColumnSetting[] =>
  Object.entries(ASSET_COL_DEFS).map(([key, d]) => ({ key, label: d.label, visible: !!d.visible || !!d.required, required: d.required }))
const columnDialogVisible = ref(false)
const columnSettings = ref<ColumnSetting[]>(loadColumnSettings(STORAGE_KEY_COLS, defaultColumnSettings()))
function updateColumns(columns: ColumnSetting[]) {
  columnSettings.value = columns
  saveColumnSettings(STORAGE_KEY_COLS, columns)
}
function resetColumns() { updateColumns(defaultColumnSettings()) }
function columnVisible(key: string) { return columnSettings.value.some(c => c.key === key && c.visible) }
/** 数据列（「新增资产凭证」带链接按钮，单独渲染，固定在操作列前） */
const visibleDataColumns = computed(() => columnSettings.value.filter(c => c.visible && c.key !== 'purchase_voucher'))

function assetCellValue(row: any, key: string): unknown {
  if (key === 'remain_months') {
    if (row.use_months == null || row.depr_method === '2') return null
    return Math.max(0, Number(row.use_months) - Number(row.depr_months_done || 0))
  }
  if (key === 'depr_method') return (DEPR_METHODS as Record<string, string>)[row.depr_method] || row.depr_method || ''
  if (key === 'status_code') return row.status_name || row.status_code || ''
  if (key === 'foreign_value' && !row.is_foreign) return null
  return row[key]
}
function assetCellText(row: any, key: string): string {
  const v = assetCellValue(row, key)
  if (v === null || v === undefined || v === '') return ''
  const kind = ASSET_COL_DEFS[key]?.kind
  if (kind === 'amount') return fmtAmt(Number(v) || 0)
  if (kind === 'rate') return `${Math.round(Number(v) * 10000) / 100}%`
  return String(v)
}
const pagination = reactive({ page: 1, page_size: 20, total: 0 })

const dialogVisible = ref(false)
const editId = ref<string | null>(null)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = list.value
  if (allRows.length === 0 || !editId.value) return null
  const idx = allRows.findIndex(r => r.id === editId.value)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = list.value
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex(r => r.id === editId.value)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    openEdit(allRows[targetIdx])
  }
}

const saving = ref(false)
const form = ref<Partial<AssetCard>>({})

const fmtAmt = (v: number) =>
  v == null || v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusTagType = (code: string | null) => {
  const map: Record<string, string> = { '01': 'success', '02': 'warning', '03': 'info', '04': 'danger' }
  return (map[code ?? ''] ?? 'info') as any
}

// 从资产变动 / 导入 / 明细页返回时刷新列表
useReloadOnActivated(() => { handleQuery() })
onMounted(async () => {
  // 字典与列表无依赖关系，并行加载减少首屏等待
  const [dictRes] = await Promise.all([
    fixedAssetApi.getDicts(),
    handleQuery(),
  ])
  if (dictRes.code === 0) dicts.value = dictRes.data
})

/** 改筛选条件后回到第 1 页再查 */
function onFilterChange() {
  pagination.page = 1
  handleQuery()
}

// ── 新增资产凭证列 ──
function purchaseVoucherLabel(row: any) {
  const v = row.purchase_voucher
  if (!v) return ''
  const no = String(v.voucher_no || '')
  const type = String(v.voucher_type_name || '').slice(0, 1)
  return `${v.year}${String(v.period).padStart(2, '0')} ${type && !no.includes('-') ? `${type}-${no}` : no}`
}
function openPurchaseVoucher(row: any) {
  const v = row.purchase_voucher
  if (!v) return
  routerInstance.push({ path: '/voucher/query', query: { voucher_id: v.id, year: v.year, period: v.period, keyword: row.asset_no } })
}
async function deletePurchaseVoucher(row: any) {
  const v = row.purchase_voucher
  if (!v) return
  try {
    await ElMessageBox.confirm(`删除资产「${row.asset_no} ${row.asset_name}」的新增资产凭证 ${purchaseVoucherLabel(row)}？卡片保留，之后可点「生成」重新生成。`, '删除凭证', { type: 'warning' })
  } catch { return }
  try {
    const r = await fixedAssetApi.deleteAssetVoucher({ kind: 'purchase', ref_id: row.id })
    if (r.code === 0) { ElMessage.success('凭证已删除'); await handleQuery() }
  } catch { /* 请求拦截器已提示原因（如凭证已审核 / 已过账） */ }
}

async function handleQuery() {
  const res = await fixedAssetApi.getCards({
    ...cardQueryParams(),
    page: pagination.page,
    page_size: pagination.page_size,
  })
  if (res.code === 0) {
    const maxPage = Math.max(1, Math.ceil(res.data.total / pagination.page_size))
    if (res.data.list.length === 0 && res.data.total > 0 && pagination.page > maxPage) {
      pagination.page = maxPage
      await handleQuery()
      return
    }
    list.value = res.data.list
    pagination.total = res.data.total
  }
}

// ── 另存（导出 Excel）──
const exporting = ref(false)
const EXPORT_PAGE_SIZE = 1000
async function exportExcel() {
  exporting.value = true
  try {
    let rows: AssetCard[] = selection.value.length ? [...selection.value] : []
    if (!rows.length) {
      // 无勾选：按当前筛选条件循环翻页取全部（列表接口一次只返回一页）
      for (let page = 1; ; page++) {
        const res = await fixedAssetApi.getCards({
          ...cardQueryParams(),
          page,
          page_size: EXPORT_PAGE_SIZE,
        })
        if (res.code !== 0) return
        rows.push(...res.data.list)
        if (rows.length >= res.data.total || !res.data.list.length) break
      }
    }
    if (!rows.length) return ElMessage.warning('没有可导出的资产卡片')
    // 导出列跟随列设置（顺序、显隐与列表一致）
    const exportCols = columnSettings.value.filter(c => c.visible)
    const columns: ExportColumnDef[] = exportCols.map(c => {
      const d = ASSET_COL_DEFS[c.key]
      const label = d?.label || c.label
      if (c.key === 'purchase_voucher') {
        return { label, width: 16, type: 'text', align: 'left', value: (r: any) => purchaseVoucherLabel(r) }
      }
      if (d?.kind === 'amount' || d?.kind === 'number') {
        return {
          label, width: d.kind === 'amount' ? 14 : 10, type: d.kind, align: 'right',
          value: (r: any) => { const v = assetCellValue(r, c.key); return v == null || v === '' ? '' : Number(v) || 0 },
        }
      }
      return { label, width: Math.max(10, Math.round((d?.width || 100) / 8)), type: 'text', align: 'left', value: (r: any) => assetCellText(r, c.key) }
    })
    const SUM_KEYS = new Set(['original_value', 'accum_depr', 'net_value', 'last_month_depr', 'salvage_value', 'impairment_amount'])
    const summaryValues = exportCols.map((c, idx) =>
      idx === 0 ? '合计' : SUM_KEYS.has(c.key) ? Math.round(rows.reduce((t, r) => t + (Number((r as any)[c.key]) || 0), 0) * 100) / 100 : '')
    await exportStyledTable({
      fileName: '资产卡片',
      title: '资产卡片',
      subtitle: selection.value.length ? `勾选 ${rows.length} 张` : `共 ${rows.length} 张`,
      columns,
      rows,
      summaryValues,
    })
  } finally { exporting.value = false }
}

async function openAdd() {
  editId.value = null
  valueLockReason.value = null
  await resetAddForm()
  dialogVisible.value = true
}

/** 保存并新增时沿用的字段：同一批资产通常类别、用途、部门、折旧设置都一样，只需改编号 / 名称 / 原值 */
const CARRY_OVER_KEYS = [
  'category_code', 'purpose_code', 'dept_code', 'status_code', 'acquire_date', 'start_depr_date',
  'depr_method', 'use_months', 'use_years', 'salvage_rate', 'generate_voucher', 'credit_account',
] as const

async function resetAddForm(carry?: Record<string, any>) {
  form.value = {
    original_value: 0,
    // AS-P0-1：残值率统一小数口径（0.05 表示 5%），与服务端/导入一致
    salvage_rate: 0.05,
    salvage_value: 0,
    qty: 1,
    depr_method: '1',
    accum_depr: 0,
    depr_months_done: 0,
    generate_voucher: false,
    credit_account: '1001',
  } as any
  if (carry) {
    for (const k of CARRY_OVER_KEYS) if (carry[k] !== undefined) (form.value as any)[k] = carry[k]
  }
  // 自动生成资产编号（可手动修改）
  try {
    const res = await fixedAssetApi.getNextAssetNo()
    if (res.code === 0 && !form.value.asset_no) form.value.asset_no = res.data.next_no
  } catch { /* 忽略，留空让用户手填 */ }
}

/** 评审 P1-2：有财务痕迹的卡片原值 / 累计折旧只读（后端同样拦截） */
const valueLockReason = ref<string | null>(null)

async function openEdit(row: AssetCard) {
  editId.value = row.id
  form.value = { ...row }
  valueLockReason.value = null
  dialogVisible.value = true
  try {
    const res = await fixedAssetApi.getCard(row.id)
    if (res.code === 0 && editId.value === row.id) valueLockReason.value = res.data.value_lock_reason ?? null
  } catch { /* 取不到时不锁，后端仍会拦截 */ }
}

function onOriginalValueChange() {
  calcSalvage()
}

function onDeprMonthsChange() {
  if (!form.value.original_value || !form.value.use_months) return
  const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
  form.value.accum_depr = Math.round(monthly * (form.value.depr_months_done || 0) * 100) / 100
}

function onAccumDeprChange() {
  if (!form.value.original_value || !form.value.use_months) return
  const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
  if (monthly > 0) {
    form.value.depr_months_done = Math.round((form.value.accum_depr || 0) / monthly)
  }
}

/** 自动估算已提月份和累计折旧（仅限录入新资产时参考） */
function autoEstimateInitialDepr() {
  if (!form.value.start_depr_date || !form.value.original_value || !form.value.use_months) return
  
  const start = new Date(form.value.start_depr_date)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  
  if (months > 0) {
    const validMonths = Math.min(months, form.value.use_months)
    form.value.depr_months_done = validMonths
    
    // 粗略估算累计折旧 (直线法)
    const monthly = (form.value.original_value - (form.value.salvage_value || 0)) / form.value.use_months
    form.value.accum_depr = Math.round(monthly * validMonths * 100) / 100
  }
}

// 监听日期和年限变化尝试自动填充
watch(() => form.value.start_depr_date, () => {
  if (!editId.value) autoEstimateInitialDepr()
})
watch(() => form.value.use_months, () => {
  if (!editId.value) autoEstimateInitialDepr()
})

function onCategoryChange(code: string) {
  const cat = dicts.value.category.find(c => c.code === code)
  if (cat?.salvage_rate != null) {
    form.value.salvage_rate = cat.salvage_rate
    calcSalvage()
  }
}

function calcSalvage() {
  const ov = form.value.original_value ?? 0
  // AS-P0-1：残值率为小数口径，直接参与计算（不再 ÷100）
  const rate = form.value.salvage_rate ?? 0
  form.value.salvage_value = Math.round(ov * rate * 100) / 100
}

/** 新增卡片已有期初累计折旧 / 已提月数：属于以前购入的老资产，购置分录通常早已入账 */
const legacyAssetHint = computed(() => {
  if (editId.value) return ''
  const accum = Number(form.value.accum_depr) || 0
  const months = Number(form.value.depr_months_done) || 0
  if (accum <= 0 && months <= 0) return ''
  const parts: string[] = []
  if (accum > 0) parts.push(`期初累计折旧 ${accum.toFixed(2)} 元`)
  if (months > 0) parts.push(`已计提 ${months} 个月`)
  return `该卡片已有${parts.join('、')}，属于以前购入的资产，购置分录通常已在以前期间入账，一般不应再生成购置凭证，以免重复记账。`
})

async function handleSave(keepOpen = false) {
  if (!form.value.asset_no || !form.value.asset_name) return ElMessage.warning('请填写资产编号和名称')
  if (!form.value.category_code) return ElMessage.warning('请选择资产类别')
  if (!form.value.purpose_code) return ElMessage.warning('请选择资产用途')
  if (!form.value.start_depr_date) return ElMessage.warning('请选择起折日期')
  if (!form.value.original_value) return ElMessage.warning('资产原值不能为空')
  if (!form.value.depr_method) return ElMessage.warning('请选择折旧方法')
  
  // 动态校验：根据折旧方法判断必填项
  if (form.value.depr_method === '2') {
    if (!form.value.total_workload) return ElMessage.warning('使用工作量法时，总工作量不能为空')
  } else {
    if (!form.value.use_months) return ElMessage.warning('请填写预计使用月数')
  }

  if (!editId.value && (form.value as any).generate_voucher && legacyAssetHint.value) {
    try {
      await ElMessageBox.confirm(legacyAssetHint.value, '可能重复入账', {
        type: 'warning',
        confirmButtonText: '仍然生成',
        cancelButtonText: '取消',
      })
    } catch { return }
  }

  saving.value = true
  try {
    let auxWarnings: string[] = []
    if (editId.value) {
      const res: any = await fixedAssetApi.updateCard(editId.value, form.value)
      auxWarnings = res?.data?.auxWarnings || []
      ElMessage.success('保存成功')
    } else {
      const res = await fixedAssetApi.createCard(form.value)
      const data: any = res?.data || {}
      auxWarnings = data.auxWarnings || []
      if (data.voucher?.voucherNo) {
        ElMessage.success(`保存成功，已生成购置凭证 ${data.voucher.voucherNo}`)
      } else if (data.voucherWarning) {
        ElMessage.warning(`资产已保存，但购置凭证未生成：${data.voucherWarning}`)
      } else {
        ElMessage.success('保存成功')
      }
    }
    // 折旧等凭证科目挂了部门 / 人员辅助核算而卡片未填或对不上：只提醒（生成凭证时会被拦截）
    if (auxWarnings.length) {
      ElNotification({
        type: 'warning',
        title: '卡片辅助核算不全',
        message: `${auxWarnings.join('；')}。不补全的话，该卡片计提折旧等生成凭证时会被拦截。`,
        duration: 10000,
      })
    }
    if (keepOpen && !editId.value) {
      // 保存并新增：保留弹窗，沿用类别 / 用途 / 部门 / 折旧设置，清空编号、名称、原值
      await resetAddForm({ ...form.value })
      handleQuery()
    } else {
      dialogVisible.value = false
      handleQuery()
    }
  } finally {
    saving.value = false
  }
}

async function handleCancelDispose(row: AssetCard) {
  await ElMessageBox.confirm(
    `确认撤销「${row.asset_name}」的处置？将还原资产状态为在用，删除处置流水及处置凭证。`,
    '撤销处置', { type: 'warning', confirmButtonText: '确认撤销', confirmButtonClass: 'el-button--danger' }
  )
  try {
    const res = await fixedAssetApi.cancelDispose(row.id)
    if (res.code === 0) {
      const d = res.data
      ElMessage.success(`已撤销处置：${d.assetNo} 还原为在用${d.deletedVoucherNo ? `，已删除凭证 ${d.deletedVoucherNo}` : ''}`)
      handleQuery()
      // P2-19：删除处置凭证可能断号，提示重新排号
      await confirmRenumberAfterDelete(d.affectedGroups, d.deletedVoucherNo ? 1 : 0)
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '撤销失败')
  }
}

async function handleDelete(row: AssetCard) {
  await ElMessageBox.confirm(`确认删除资产「${row.asset_name}」？`, '提示', { type: 'warning' })
  await fixedAssetApi.deleteCard(row.id)
  ElMessage.success('已删除')
  handleQuery()
}

// ── 处置 ──────────────────────────────────────────────
const disposeVisible = ref(false)
const disposing = ref(false)
const disposeAsset = ref<AssetCard | null>(null)
const disposeTypes = ref<{ code: string; name: string }[]>([])
const disposeForm = ref({
  change_type_code: '',
  scrap_date: '',
  scrap_reason: '',
  disposal_income: 0,
  disposal_expense: 0,
  generate_voucher: false,
  accum_account: '1602',
  clearing_account: '1606',
})

const disposePreviewGainLoss = computed(() => {
  if (!disposeAsset.value) return 0
  return Math.round((disposeForm.value.disposal_income - disposeForm.value.disposal_expense - disposeAsset.value.net_value) * 100) / 100
})

function openDispose(row: AssetCard) {
  disposeAsset.value = row
  const today = todayStr()
  disposeForm.value = {
    change_type_code: '',
    scrap_date: today,
    scrap_reason: '',
    disposal_income: 0,
    disposal_expense: 0,
    generate_voucher: false,
    accum_account: '1602',
    clearing_account: '1606',
  }
  // 加载减少方式
  loadDisposeTypes()
  disposeVisible.value = true
}

async function loadDisposeTypes() {
  if (disposeTypes.value.length) return
  const res = await fixedAssetApi.getDict('change_type')
  if (res.code === 0) {
    disposeTypes.value = (res.data as any[]).filter((d: any) => d.direction === 'decrease')
  }
}

async function handleDispose() {
  if (!disposeAsset.value) return
  if (!disposeForm.value.scrap_date) return ElMessage.warning('请选择处置日期')
  await ElMessageBox.confirm(
    `确认处置资产「${disposeAsset.value.asset_name}」？处置后将标记为已减少，${disposeForm.value.generate_voucher ? '并生成清理凭证。' : '此操作不可撤销。'}`,
    '处置确认', { type: 'warning' }
  )
  disposing.value = true
  try {
    const res = await fixedAssetApi.disposeAsset(disposeAsset.value.id, disposeForm.value)
    if (res.code === 0) {
      disposeVisible.value = false
      ElMessage.success('处置成功')
      const rd: any = res.data
      if (rd.voucher) {
        ElMessage.success(`已生成清理凭证 ${rd.voucher.voucherNo || ''}`)
      }
      handleQuery()
    }
  } finally {
    disposing.value = false
  }
}
</script>

<style scoped>
.gen-voucher-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 12px; line-height: 1.6; }
.page-asset-list { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.table-container { flex: 1; overflow: hidden; padding: 0; }
.table-footer { padding: 4px 0; display: flex; justify-content: flex-end; border-top: 1px solid var(--el-border-color-lighter); }
.dispose-info { margin-bottom: 4px; }
.dispose-preview { display: flex; align-items: center; gap: 4px; padding: 8px 12px; background: var(--el-color-warning-light-9); border-radius: 4px; font-size: var(--cw-text-base); margin-top: 8px; }
.tip-text { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.voucher-gen-area {
  padding: 4px 8px;
  background: var(--ink-50);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}
.voucher-gen-area .el-form-item { margin-bottom: 0 !important; }
.voucher-gen-area .el-form-item + .el-form-item { margin-top: 4px; }
/* 新增 / 编辑资产弹窗：表单行距收紧（本表单无校验提示行，不会被遮挡） */
.asset-form .el-form-item { margin-bottom: 8px !important; }
.sector-tip {
  margin-left: 10px;
  color: var(--mint-700);
  font-size: 12px;
  font-weight: 500;
}
/* 老资产（有期初累计折旧）勾选生成购置凭证时的重复入账提醒 */
.legacy-asset-warn {
  flex-basis: 100%;
  margin-top: 4px;
  line-height: 1.5;
  font-size: 12px;
  color: var(--el-color-warning-dark-2, #b88230);
}
/* 操作列按钮间距由全局 common.css（--cw-op-gap）统一控制 */
.row-actions { display: inline-flex; align-items: center; gap: 0; }
</style>
