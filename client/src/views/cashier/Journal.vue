<template>
  <div class="page page-cashier-journal">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button size="small" plain @click="showColSetting = true"><el-icon><Setting /></el-icon>列设置</el-button>
      <el-button type="primary" size="small" @click="openAddDialog"><el-icon><Plus /></el-icon>录入日记账</el-button>
    </div>
    <!-- 期初/期末余额摘要 -->
    <div v-if="journalResult" class="balance-summary">
      <span>期初余额：<b>{{ fmt(journalResult.opening) }}</b></span>
      <span>本期借方：<b class="debit">{{ fmt(journalResult.totalDebit) }}</b></span>
      <span>本期贷方：<b class="credit">{{ fmt(journalResult.totalCredit) }}</b></span>
      <span>期末余额：<b>{{ fmt(journalResult.closing) }}</b></span>
    </div>

    <!-- 日记账表格 -->
    <div ref="tableContainerRef" class="table-container">
      <el-table
        ref="tableRef"
        :data="rows"
        :height="tableHeight"
        border
        highlight-current-row
        size="small"
        class="compact-data-table"
        @row-dblclick="openEditDialog"
        @header-dragend="onDragEnd"
        @selection-change="val => selectedRows = val"
        @current-change="val => tableRef.currentRow = val"
      >
        <el-table-column type="selection" width="40" align="center" fixed="left" />
        <template v-for="column in orderedVisibleJournalColumns" :key="column.key">
        <el-table-column v-if="column.key === 'biz_date'" column-key="biz_date" label="日期" prop="biz_date" :width="cw('biz_date',100)" />
        <el-table-column v-else-if="column.key === 'seq'" column-key="seq" label="序号" prop="seq" :width="cw('seq',50)" align="center" />
        <el-table-column v-else-if="column.key === 'summary'" column-key="summary" label="摘要" prop="summary" :width="cw('summary',140)" show-overflow-tooltip />
        <el-table-column v-else-if="column.key === 'counter_account'" column-key="counter_account" label="对方科目" :width="cw('counter_account',120)" show-overflow-tooltip>
          <template #default="{ row }">{{ formatCounterAccount(row.counter_account) }}</template>
        </el-table-column>
        <el-table-column
          v-else-if="column.key.startsWith('aux_')"
          :column-key="column.key"
          :label="column.label"
          :width="cw(column.key, 110)"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ getAuxItemName(row.counter_aux_item_id, column.key.slice(4)) }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'settle_type'" column-key="settle_type" label="结算方式" prop="settle_type" :width="cw('settle_type',80)">
          <template #default="{ row }">{{ getSettleTypeName(row.settle_type) }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'bill_no'" column-key="bill_no" label="票据号" prop="bill_no" :width="cw('bill_no',100)" show-overflow-tooltip />
        <el-table-column v-else-if="column.key === 'counter_unit'" column-key="counter_unit" label="对方单位" prop="counter_unit" :width="cw('counter_unit',120)" show-overflow-tooltip />
        <el-table-column v-else-if="column.key === 'debit'" column-key="debit" label="借方(收入)" :width="cw('debit',110)" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'credit'" column-key="credit" label="贷方(支出)" :width="cw('credit',110)" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'balance'" column-key="balance" label="余额" :width="cw('balance',110)" align="right">
          <template #default="{ row }">{{ fmt(row.balance ?? 0) }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'reconciled'" column-key="reconciled" label="对账" :width="cw('reconciled',55)" align="center">
          <template #default="{ row }"><el-icon v-if="row.reconciled" color="#67c23a"><CircleCheck /></el-icon></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'voucher_no'" column-key="voucher_no" label="关联凭证" :width="cw('voucher_no',100)">
          <template #default="{ row }">
            <span v-if="row.voucher_no">{{ row.voucher_year }}-{{ String(row.voucher_month).padStart(2,'0') }} {{ row.voucher_no }}</span>
          </template>
        </el-table-column>
        </template>
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 70)" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click.stop="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 录入/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editRow ? '修改日记账' : '录入日记账'" width="840px" draggable>
      <div v-if="editRow && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="74px" size="small">
        <el-row :gutter="15">
          <el-col :span="6">
            <el-form-item label="日期" required>
              <el-date-picker v-model="form.biz_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="18">
            <el-form-item label="摘要">
              <el-input v-model="form.summary" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="15">
          <el-col :span="12">
            <el-form-item label="对方科目">
              <el-select
                v-model="form.counter_account"
                filterable
                clearable
                placeholder="输入编码或名称检索"
                style="width:100%"
                popper-class="counter-account-popper"
                :filter-method="onCounterFilter"
                @visible-change="onCounterVisibleChange"
                @change="onCounterAccountChange"
              >
                <el-option
                  v-for="a in filteredCounterAccounts"
                  :key="a.code"
                  :label="`${a.code} ${a.name}`"
                  :value="a.isParent ? '' : a.code"
                  :disabled="a.isParent"
                  :class="{ 'parent-option': a.isParent }"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="收入(借)" label-width="70px">
              <el-input-number
                v-model="form.debit"
                :precision="2"
                :min="0"
                :controls="false"
                style="width:100%"
                @change="onDebitChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="支出(贷)" label-width="70px">
              <div style="display: flex; gap: 8px; width: 100%;">
                <el-input-number
                  v-model="form.credit"
                  :precision="2"
                  :min="0"
                  :controls="false"
                  style="flex: 1"
                  @change="onCreditChange"
                />
                <el-button @click="swapFormDebitCredit" title="借贷互换" plain style="padding: 0 6px;">
                  <el-icon><Connection /></el-icon>
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <template v-if="counterAccountAuxCategoryIds.length > 0">
          <el-row :gutter="15">
            <el-col
              v-for="catId in counterAccountAuxCategoryIds"
              :key="catId"
              :span="12"
            >
              <el-form-item :label="getAuxCategoryName(catId)">
                <el-select
                  v-model="counterAuxSelections[catId]"
                  filterable
                  clearable
                  placeholder="选择辅助项目（可选）"
                  style="width:100%"
                  @visible-change="(v: boolean) => v && auxItems.onDropdownOpen(catId)"
                >
                  <el-option
                    v-for="item in auxItems.getAuxOptions(catId)"
                    :key="item.id"
                    :label="`${item.code ?? ''} ${item.name}`"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <el-row :gutter="15">
          <el-col :span="8">
            <el-form-item label="结算方式">
              <div style="display: flex; gap: 4px; width: 100%;">
                <el-select v-model="form.settle_type" clearable style="flex: 1">
                  <el-option v-for="s in settleTypes" :key="s.code" :label="s.name" :value="s.code" />
                </el-select>
                <el-button @click="quickAddSettleType" size="small" type="primary" plain circle style="flex-shrink: 0; align-self: center; margin-top: 1px;">
                  <el-icon><Plus /></el-icon>
                </el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="票据号" label-width="60px">
              <el-input v-model="form.bill_no" />
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item label="对方单位">
              <el-input v-model="form.counter_unit" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="15">
          <el-col :span="12">
            <el-form-item label="开户行">
              <el-input v-model="form.bank_name" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="账号">
              <el-input v-model="form.bank_account" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="附件">
          <VoucherAttachments
            :voucher-id="editRow?.id || ''"
            :attachments="attachments"
            title="出纳附件"
            compact
            hide-preview
            @upload="handleAttachmentUpload"
            @delete="handleAttachmentDelete"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 银行对账面板（双栏对比式） -->
    <el-dialog v-model="showReconcile" title="银行对账" width="960px" draggable :close-on-click-modal="false">
      <!-- 顶部工具栏 -->
      <div class="recon-toolbar">
        <el-date-picker v-model="reconDate[0]" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width:130px" size="small" />
        <el-date-picker v-model="reconDate[1]" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width:130px" size="small" />
        <el-checkbox v-model="useBillNo" size="small">票据号优先</el-checkbox>
        <el-button type="primary" size="small" :loading="reconciling" @click="handleAutoReconcile">自动勾对</el-button>
        <el-button size="small" @click="showAddStatement = !showAddStatement">
          <el-icon><Plus /></el-icon>录入对账单
        </el-button>
        <el-button size="small" plain @click="$router.push('/cashier/bank-reconciliation')">余额调节表</el-button>
        <el-button size="small" plain @click="loadReconDialog" :loading="reconLoading">刷新</el-button>
      </div>

      <!-- 统计汇总条 -->
      <div class="recon-stats">
        <span>日记账：未对 <b>{{ reconJournalStats.unmatched }}条</b> ¥{{ fmtOr0(reconJournalStats.unmatchedAmt) }} ／ 已对 <b>{{ reconJournalStats.matched }}条</b></span>
        <span class="recon-stats-sep">｜</span>
        <span>对账单：未对 <b>{{ reconBankStats.unmatched }}条</b> ／ 已对 <b>{{ reconBankStats.matched }}条</b></span>
        <template v-if="selectedJournalRow && selectedBankRow">
          <span class="recon-stats-sep">｜</span>
          <span class="recon-hint">
            已选日记账 {{ fmt(selectedJournalRow.debit || selectedJournalRow.credit) }} + 对账单 {{ fmt(selectedBankRow.debit || selectedBankRow.credit) }}
            <span v-if="Math.abs((selectedJournalRow.debit - selectedJournalRow.credit) - (selectedBankRow.debit - selectedBankRow.credit)) > 0.005" class="recon-warn">（金额不一致）</span>
          </span>
        </template>
      </div>

      <!-- 快速录入对账单（折叠） -->
      <div v-if="showAddStatement" class="recon-add-form">
        <el-date-picker v-model="addStmtForm.biz_date" type="date" value-format="YYYY-MM-DD" placeholder="日期" style="width:120px" size="small" />
        <el-input-number v-model="addStmtForm.debit" :precision="2" :min="0" placeholder="收入(借)" style="width:120px" size="small" />
        <el-input-number v-model="addStmtForm.credit" :precision="2" :min="0" placeholder="支出(贷)" style="width:120px" size="small" />
        <el-input v-model="addStmtForm.bill_no" placeholder="票据号" style="width:110px" size="small" />
        <div style="display: flex; gap: 4px; align-items: center;">
          <el-select v-model="addStmtForm.settle_type" clearable placeholder="结算方式" style="width:100px" size="small">
            <el-option v-for="s in settleTypes" :key="s.code" :label="s.name" :value="s.code" />
          </el-select>
          <el-button @click="quickAddSettleType" size="small" type="primary" plain circle style="width: 24px; height: 24px; padding: 0;">
            <el-icon><Plus /></el-icon>
          </el-button>
        </div>
        <el-button type="primary" size="small" :loading="addingStatement" @click="handleAddStatement">保存</el-button>
        <el-button size="small" @click="showAddStatement = false">取消</el-button>
      </div>

      <!-- 双栏内容区 -->
      <div class="recon-columns">
        <!-- 左栏：出纳日记账 -->
        <div class="recon-col">
          <div class="recon-col-header">
            <span class="recon-col-title">出纳日记账</span>
            <el-radio-group v-model="reconJournalTab" size="small">
              <el-radio-button label="unmatched">未对</el-radio-button>
              <el-radio-button label="all">全部</el-radio-button>
              <el-radio-button label="matched">已对</el-radio-button>
            </el-radio-group>
          </div>
          <el-table
            :data="filteredJournalRows"
            size="small"
            border
            max-height="340"
            highlight-current-row
            @row-click="handleJournalRowClick"
            :row-class-name="journalRowClass"
          >
            <el-table-column label="日期" prop="biz_date" width="90" />
            <el-table-column label="摘要" prop="summary" min-width="90" show-overflow-tooltip />
            <el-table-column label="借方" prop="debit" width="90" align="right">
              <template #default="{row}"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="贷方" prop="credit" width="90" align="right">
              <template #default="{row}"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="55" align="center">
              <template #default="{row}">
                <el-tag :type="row.reconciled ? 'success' : 'info'" size="small">{{ row.reconciled ? '已对' : '未对' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 右栏：银行对账单 -->
        <div class="recon-col">
          <div class="recon-col-header">
            <span class="recon-col-title">银行对账单</span>
            <el-radio-group v-model="reconBankTab" size="small">
              <el-radio-button label="unmatched">未对</el-radio-button>
              <el-radio-button label="all">全部</el-radio-button>
              <el-radio-button label="matched">已对</el-radio-button>
            </el-radio-group>
          </div>
          <el-table
            :data="filteredBankRows"
            size="small"
            border
            max-height="340"
            highlight-current-row
            @row-click="handleBankRowClick"
            :row-class-name="bankRowClass"
          >
            <el-table-column label="日期" prop="biz_date" width="90" />
            <el-table-column label="票据号" prop="bill_no" min-width="80" show-overflow-tooltip />
            <el-table-column label="借方" prop="debit" width="90" align="right">
              <template #default="{row}"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="贷方" prop="credit" width="90" align="right">
              <template #default="{row}"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="55" align="center">
              <template #default="{row}">
                <el-tag :type="row.matched ? 'success' : 'info'" size="small">{{ row.matched ? '已对' : '未对' }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <!-- 底部操作区 -->
      <div class="recon-actions">
        <template v-if="selectedJournalRow && !selectedJournalRow.reconciled && selectedBankRow && !selectedBankRow.matched">
          <el-button type="primary" size="small" :loading="manualReconciling" @click="handleManualReconcile">
            手动勾对
          </el-button>
          <el-button size="small" @click="selectedJournalRow = null; selectedBankRow = null">取消选择</el-button>
        </template>
        <template v-else-if="pendingCancelRow">
          <span style="font-size:13px;color:#606266">撤销「{{ pendingCancelRow.biz_date }}」的对账？</span>
          <el-button type="danger" size="small" plain :loading="cancelReconciling" @click="handleCancelReconcile">确认撤销</el-button>
          <el-button size="small" @click="pendingCancelRow = null">取消</el-button>
        </template>
        <template v-else>
          <span style="font-size:12px;color:#909399">点击未对账行选中→两侧各选一行后可手动勾对；点击已对账行可撤销</span>
        </template>
      </div>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importVisible" title="导入出纳日记账" width="720px" draggable>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
        请先下载模版，按列填写后上传。导入到当前科目：<b>{{ formatCounterAccount(filters.account_code) }}</b>。
        <br>「日期」必填（格式 YYYY-MM-DD），「借方(收入)」「贷方(支出)」至少填一个。
      </el-alert>
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <el-button plain size="small" @click="downloadImportTemplate">
          <el-icon><Download /></el-icon>下载导入模版（Excel）
        </el-button>
        <el-upload
          :auto-upload="false"
          :limit="1"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleImportFileChange"
        >
          <el-button type="primary" size="small">
            <el-icon><Upload /></el-icon>选择 Excel 文件
          </el-button>
        </el-upload>
        <span v-if="importFileName" style="font-size:12px;color:#606266">已选择：{{ importFileName }}</span>
      </div>

      <template v-if="importRows.length">
        <div style="margin-bottom:6px;font-size:13px">
          共解析 <b>{{ importRows.length }}</b> 条有效记录
          <span v-if="importErrors.length" style="color:#e6a23c">，{{ importErrors.length }} 条存在问题（将跳过）</span>
        </div>
        <el-table :data="importRows.slice(0, 20)" size="small" border max-height="300" class="compact-data-table">
          <el-table-column type="index" label="序号" width="50" align="center" />
          <el-table-column label="日期" prop="biz_date" width="100" />
          <el-table-column label="摘要" prop="summary" min-width="120" show-overflow-tooltip />
          <el-table-column label="结算方式" prop="settle_type" width="80" />
          <el-table-column label="票据号" prop="bill_no" width="90" show-overflow-tooltip />
          <el-table-column label="对方单位" prop="counter_unit" width="110" show-overflow-tooltip />
          <el-table-column label="对方科目" prop="counter_account" width="90" />
          <el-table-column label="借方(收入)" prop="debit" width="100" align="right">
            <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方(支出)" prop="credit" width="100" align="right">
            <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
          </el-table-column>
        </el-table>
        <p v-if="importRows.length > 20" style="font-size:12px;color:#909399;margin:6px 0 0">仅预览前 20 条…</p>
        <el-alert
          v-if="importErrors.length"
          type="warning"
          :closable="false"
          style="margin-top:10px"
          :title="`以下行存在问题，导入时将跳过：${importErrors.slice(0,10).map(e => `第${e.row}行(${e.message})`).join('；')}${importErrors.length > 10 ? ' …' : ''}`"
        />
      </template>

      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importRows.length" @click="confirmImport">
          确认导入 {{ importRows.length ? `（${importRows.length} 条）` : '' }}
        </el-button>
      </template>
    </el-dialog>

    <ColumnSettingsDialog v-model="showColSetting" :columns="colSettings" @update:columns="updateJournalColumns" @reset="resetColSettings" />

    <!-- 缺对方科目：拦截 + 可选挂账弹窗 -->
    <el-dialog v-model="hangupVisible" title="存在未填对方科目的记录" width="660px" draggable>
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px">
        以下 {{ missingRows.length }} 条已对账记录未填写对方科目。可点「返回补全」逐条补全对方科目；
        或指定一个<strong>末级挂账科目</strong>（如其他应收款/其他应付款），对这些记录统一挂账后生成凭证，事后再行调整。
      </el-alert>
      <el-table :data="missingRows" size="small" border max-height="240">
        <el-table-column label="日期" prop="biz_date" width="110" />
        <el-table-column label="摘要" prop="summary" min-width="180" show-overflow-tooltip />
        <el-table-column label="借方(收入)" prop="debit" width="120" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column label="贷方(支出)" prop="credit" width="120" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
      </el-table>
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:13px;white-space:nowrap">挂账科目：</span>
        <el-select
          v-model="hangupAccount"
          filterable
          clearable
          placeholder="选择末级挂账科目"
          style="width:300px"
          popper-class="counter-account-popper"
          :filter-method="onCounterFilter"
          @visible-change="onCounterVisibleChange"
        >
          <el-option
            v-for="a in filteredCounterAccounts"
            :key="a.code"
            :label="`${a.code} ${a.name}`"
            :value="a.isParent ? '' : a.code"
            :disabled="a.isParent"
            :class="{ 'parent-option': a.isParent }"
          />
        </el-select>
        <el-checkbox v-model="rememberHangup">记住为默认挂账科目</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="hangupVisible = false">返回补全</el-button>
        <el-button type="primary" :loading="generating" :disabled="!hangupAccount" @click="confirmHangupGenerate">
          按挂账科目生成
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import type ExcelJS from 'exceljs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Connection, CircleCheck, DocumentAdd, Setting, Delete, Upload, Download } from '@element-plus/icons-vue'
import { cashierApi, type JournalRow, type JournalResult, type SettleType, type BankStatement } from '@/api/cashier'
import request from '@/api/request'
import { useBaseDataStore } from '@/stores/baseData'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'
import VoucherAttachments from '@/components/voucher/VoucherAttachments.vue'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { tableRef: colWidthTableRef, colWidth, onDragEnd } = useListColumnWidth('cashier_journal')
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const tableRef = colWidthTableRef
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const baseData = useBaseDataStore()
const auxItems = useVoucherAuxItems()

const settleAccountMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of settleTypes.value) map.set(s.code, s.name)
  return map
})
function getSettleTypeName(code: string | null) {
  if (!code) return ''
  return settleAccountMap.value.get(code) || code
}

// ── 列设置 ──────────────────────────────────────────────
const COL_VIS_KEY = 'cashier_journal_col_visible'
const DEFAULT_COLS: ColumnSetting[] = [
  { key: 'biz_date', label: '日期', visible: true },
  { key: 'seq', label: '序号', visible: true },
  { key: 'summary', label: '摘要', visible: true },
  { key: 'counter_account', label: '对方科目', visible: true },
  { key: 'settle_type', label: '结算方式', visible: true },
  { key: 'bill_no', label: '票据号', visible: true },
  { key: 'counter_unit', label: '对方单位', visible: true },
  { key: 'debit', label: '借方(收入)', visible: true },
  { key: 'credit', label: '贷方(支出)', visible: true },
  { key: 'balance', label: '余额', visible: true },
  { key: 'reconciled', label: '对账', visible: true },
  { key: 'voucher_no', label: '关联凭证', visible: false },
]
const colSettings = ref<ColumnSetting[]>(loadColumnSettings(COL_VIS_KEY, DEFAULT_COLS))
const orderedVisibleJournalColumns = computed(() => colSettings.value.filter(column => column.visible))
function saveColSettings() { saveColumnSettings(COL_VIS_KEY, colSettings.value) }
function updateJournalColumns(columns: ColumnSetting[]) { colSettings.value = columns; saveColSettings() }
function resetColSettings() {
  colSettings.value = journalDefaultColumns.value.map(c => ({ ...c }))
  saveColSettings()
}
const showColSetting = ref(false)

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number; id: string; parent_id?: string | null }[]>([])

function buildHierarchyList(leafs: typeof accounts.value, all: typeof accounts.value) {
  const resultIds = new Set<string>()
  const resultList: any[] = []
  const idMap = new Map(all.map(a => [a.id, a]))
  const parentIds = new Set(all.filter(a => a.parent_id).map(a => String(a.parent_id)))

  for (const leaf of leafs) {
    let curr: any = leaf
    const path: any[] = []
    while (curr) {
      if (!resultIds.has(curr.id)) {
        resultIds.add(curr.id)
        path.unshift({
          code: curr.code,
          name: curr.name,
          isParent: parentIds.has(String(curr.id))
        })
      }
      curr = curr.parent_id ? idMap.get(curr.parent_id) : null
    }
    resultList.push(...path)
  }
  
  // 严格按编码排序，短的在前，相同长度按字典序，从而保证父子节点自然挨在一起
  return resultList.sort((a, b) => a.code.localeCompare(b.code))
}

const cashierAccounts = computed(() => {
  const all = baseData.accounts
  if (!all.length) return []
  const parentIds = new Set(all.filter(a => a.parent_id).map(a => String(a.parent_id)))
  const leafs = all.filter(a => (a.is_cash === 1 || a.is_bank === 1) && !parentIds.has(String(a.id)) && a.is_enabled !== 0)
  return buildHierarchyList(leafs, all)
})

const cashierAccountFilter = ref('')
const filteredCashierAccounts = computed(() => {
  const q = cashierAccountFilter.value.trim().toLowerCase()
  if (!q) return cashierAccounts.value
  
  const directlyMatched = cashierAccounts.value.filter(
    a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  )
  const matchedIds = new Set(directlyMatched.map(a => a.code))
  const matched = [...directlyMatched]
  
  if (q) {
    for (const a of directlyMatched) {
      if (!a.isParent) {
        // 如果是子科目，带出其直接父科目以便维持层级上下文
        const parent = cashierAccounts.value.find(
          p => p.isParent && a.code.startsWith(p.code) && a.code !== p.code
        )
        if (parent && !matchedIds.has(parent.code)) {
          matched.push(parent)
          matchedIds.add(parent.code)
        }
      } else {
        // 如果命中父科目，带出它所有的子孙科目
        const children = cashierAccounts.value.filter(
          c => c.code.startsWith(a.code) && c.code !== a.code
        )
        for (const child of children) {
          if (!matchedIds.has(child.code)) {
            matched.push(child)
            matchedIds.add(child.code)
          }
        }
      }
    }
  }
  return matched.sort((a, b) => a.code.localeCompare(b.code))
})
function onCashierAccountFilter(val: string) { cashierAccountFilter.value = val }
function onCashierAccountVisibleChange(visible: boolean) { if (!visible) cashierAccountFilter.value = '' }

const settleTypes = ref<SettleType[]>([])
const journalResult = ref<JournalResult | null>(null)
const rows = computed(() => journalResult.value?.rows ?? [])

const firstDay = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
const filters = ref({ account_code: '', start_date: firstDay, end_date: lastDayStr })

const swapping = ref(false)
const selectedRows = ref<JournalRow[]>([])
const dialogVisible = ref(false)
const editRow = ref<JournalRow | null>(null)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = rows.value
  if (allRows.length === 0 || !editRow.value) return null
  const idx = allRows.findIndex(r => r.id === editRow.value?.id)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = rows.value
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex(r => r.id === editRow.value?.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    openEditDialog(allRows[targetIdx])
  }
}

const saving = ref(false)
const form = ref<Partial<JournalRow>>({})
const counterAuxSelections = ref<Record<string, string>>({})
const attachments = ref<any[]>([])
const queuedFiles = ref<File[]>([])

async function fetchAttachments(journalId: string) {
  try {
    const res = await cashierApi.getJournalAttachments(journalId)
    if (res.code === 0) attachments.value = res.data
  } catch { /* ignore */ }
}

async function handleAttachmentUpload(files: File[]) {
  if (editRow.value) {
    // 已有记录：立即上传
    try {
      const res = await cashierApi.uploadJournalAttachments(editRow.value.id, files)
      if (res.code === 0) {
        ElMessage.success(`成功上传 ${files.length} 个附件`)
        fetchAttachments(editRow.value.id)
      }
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '上传失败')
    }
  } else {
    // 新增记录：加入队列
    queuedFiles.value.push(...files)
    // 模拟附件列表展示（仅展示基本信息，无预览/路径）
    const simulated = files.map(f => ({
      id: `temp_${Math.random()}`,
      original_name: f.name,
      file_size: f.size,
      created_at: new Date().toISOString(),
      is_temp: true
    }))
    attachments.value.push(...simulated)
  }
}

async function handleAttachmentDelete(att: any) {
  if (att.is_temp) {
    const idx = attachments.value.findIndex(a => a.id === att.id)
    if (idx >= 0) {
      attachments.value.splice(idx, 1)
      queuedFiles.value.splice(idx, 1)
    }
    return
  }
  
  try {
    await ElMessageBox.confirm(`确定删除附件「${att.original_name}」吗？`, '删除确认', { type: 'warning' })
    const res = await cashierApi.deleteJournalAttachment(editRow.value!.id, att.id)
    if (res.code === 0) {
      ElMessage.success('附件已删除')
      fetchAttachments(editRow.value!.id)
    }
  } catch { /* 取消 */ }
}

/** 对方科目启用的辅助核算类别 ID 列表 */
const counterAccountAuxCategoryIds = computed((): string[] => {
  const code = form.value.counter_account
  if (!code) return []
  const acc = (baseData.accounts as any[]).find(a => a.code === code)
  if (!acc?.is_aux || !acc?.aux_types) return []
  try {
    const parsed = typeof acc.aux_types === 'string' ? JSON.parse(acc.aux_types) : acc.aux_types
    if (Array.isArray(parsed)) return parsed as string[]
    if (parsed && typeof parsed === 'object') return Object.keys(parsed)
  } catch { /* ignore */ }
  return []
})

const auxCategoryMap = computed(() => {
  const map = new Map<string, string>()
  for (const cat of baseData.auxCategories) map.set(String(cat.id), cat.name)
  return map
})
function getAuxCategoryName(catId: string) {
  return auxCategoryMap.value.get(catId) || '辅助项目'
}

/** 从当前所有行中收集出现过的辅助类别 ID（保持顺序） */
const activeAuxCatIds = computed((): string[] => {
  const seen = new Set<string>()
  const order: string[] = []
  for (const row of rows.value) {
    if (!row.counter_aux_item_id) continue
    try {
      const parsed = JSON.parse(row.counter_aux_item_id) as Record<string, string>
      for (const catId of Object.keys(parsed)) {
        if (parsed[catId] && !seen.has(catId)) { seen.add(catId); order.push(catId) }
      }
    } catch { /* ignore */ }
  }
  return order
})

const journalDefaultColumns = computed<ColumnSetting[]>(() => [
  ...DEFAULT_COLS.map(column => ({ ...column })),
  ...activeAuxCatIds.value.map(catId => ({
    key: `aux_${catId}`,
    label: getAuxCategoryName(catId),
    visible: true,
    group: '辅助核算',
  })),
])
watch(activeAuxCatIds, () => {
  colSettings.value = loadColumnSettings(COL_VIS_KEY, journalDefaultColumns.value)
}, { immediate: true })

function getAuxItemName(counter_aux_item_id: string | null | undefined, catId: string): string {
  if (!counter_aux_item_id) return ''
  try {
    const parsed = JSON.parse(counter_aux_item_id) as Record<string, string>
    const itemId = parsed[catId]
    if (!itemId) return ''
    return auxItems.getAuxItemFromCache(catId, itemId)?.name ?? itemId
  } catch { return '' }
}

async function onCounterAccountChange(_code: string | undefined) {
  counterAuxSelections.value = {}
  const catIds = counterAccountAuxCategoryIds.value
  for (const catId of catIds) {
    await auxItems.onDropdownOpen(catId)
  }
}

/** 对方科目候选：全部启用科目，父科目标记不可选（虚拟上级） */
const counterAccounts = computed(() => {
  const all = baseData.accounts
  if (!all.length) return [] as { code: string; name: string; isParent: boolean }[]
  const parentIds = new Set(all.filter(a => a.parent_id).map(a => String(a.parent_id)))
  return all
    .filter(a => a.is_enabled !== 0)
    .map(a => ({
      code: a.code,
      name: a.name,
      isParent: parentIds.has(String(a.id)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
})

const counterFilter = ref('')
const filteredCounterAccounts = computed(() => {
  const q = counterFilter.value.trim().toLowerCase()
  if (!q) return counterAccounts.value
  
  const directlyMatched = counterAccounts.value.filter(
    a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  )
  const matchedIds = new Set(directlyMatched.map(a => a.code))
  const matched = [...directlyMatched]

  if (q) {
    for (const a of directlyMatched) {
      if (!a.isParent) {
        // 如果是子科目，带出其直接父科目以便维持层级上下文
        const parent = counterAccounts.value.find(
          p => p.isParent && a.code.startsWith(p.code) && a.code !== p.code
        )
        if (parent && !matchedIds.has(parent.code)) {
          matched.push(parent)
          matchedIds.add(parent.code)
        }
      } else {
        // 如果命中父科目，带出它所有的子孙科目
        const children = counterAccounts.value.filter(
          c => c.code.startsWith(a.code) && c.code !== a.code
        )
        for (const child of children) {
          if (!matchedIds.has(child.code)) {
            matched.push(child)
            matchedIds.add(child.code)
          }
        }
      }
    }
  }
  return matched.sort((a, b) => a.code.localeCompare(b.code))
})
function onCounterFilter(val: string) { counterFilter.value = val }
function onCounterVisibleChange(visible: boolean) { if (!visible) counterFilter.value = '' }

const counterAccountMap = computed(() => {
  const map = new Map<string, string>()
  for (const a of counterAccounts.value) map.set(a.code, a.name || '')
  return map
})
function formatCounterAccount(code: string | null) {
  if (!code) return ''
  const name = counterAccountMap.value.get(code)
  return name ? `${code} ${name}` : code
}

const showReconcile = ref(false)
const reconciling = ref(false)
const generating = ref(false)
const deletingVouchers = ref(false)
const reconDate = ref<string[]>(['', ''])
const unmatched = ref<BankStatement[]>([]) // 保留兼容性，实际对账弹窗使用 reconBankRows

// ── 双栏对账面板状态 ──────────────────────────────────────
const reconJournalRows = ref<JournalRow[]>([])
const reconBankRows = ref<BankStatement[]>([])
const reconLoading = ref(false)
const reconJournalTab = ref<'all' | 'unmatched' | 'matched'>('unmatched')
const reconBankTab = ref<'all' | 'unmatched' | 'matched'>('unmatched')
const selectedJournalRow = ref<JournalRow | null>(null)
const selectedBankRow = ref<BankStatement | null>(null)
const pendingCancelRow = ref<JournalRow | null>(null)
const showAddStatement = ref(false)
const addingStatement = ref(false)
const addStmtForm = ref({ biz_date: '', debit: 0, credit: 0, bill_no: '', settle_type: '' })
const useBillNo = ref(true)
const manualReconciling = ref(false)
const cancelReconciling = ref(false)

const filteredJournalRows = computed(() => {
  if (reconJournalTab.value === 'unmatched') return reconJournalRows.value.filter(r => !r.reconciled)
  if (reconJournalTab.value === 'matched') return reconJournalRows.value.filter(r => r.reconciled)
  return reconJournalRows.value
})
const filteredBankRows = computed(() => {
  if (reconBankTab.value === 'unmatched') return reconBankRows.value.filter(r => !r.matched)
  if (reconBankTab.value === 'matched') return reconBankRows.value.filter(r => r.matched)
  return reconBankRows.value
})
const reconJournalStats = computed(() => {
  const rows = reconJournalRows.value
  const matched = rows.filter(r => r.reconciled)
  const unmatched = rows.filter(r => !r.reconciled)
  return {
    matched: matched.length,
    unmatched: unmatched.length,
    unmatchedAmt: unmatched.reduce((s, r) => s + r.debit + r.credit, 0),
  }
})
const reconBankStats = computed(() => {
  const rows = reconBankRows.value
  return {
    matched: rows.filter(r => r.matched).length,
    unmatched: rows.filter(r => !r.matched).length,
  }
})
function fmtOr0(v: number) { return v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function journalRowClass({ row }: { row: JournalRow }) {
  if (selectedJournalRow.value?.id === row.id) return 'row-selected'
  if (pendingCancelRow.value?.id === row.id) return 'row-cancel-pending'
  return ''
}
function bankRowClass({ row }: { row: BankStatement }) {
  if (selectedBankRow.value?.id === row.id) return 'row-selected'
  return ''
}

function handleJournalRowClick(row: JournalRow) {
  if (row.reconciled) {
    // 已对账行：触发撤销
    pendingCancelRow.value = pendingCancelRow.value?.id === row.id ? null : row
    selectedJournalRow.value = null
    selectedBankRow.value = null
  } else {
    pendingCancelRow.value = null
    selectedJournalRow.value = selectedJournalRow.value?.id === row.id ? null : row
  }
}
function handleBankRowClick(row: BankStatement) {
  if (!row.matched) {
    pendingCancelRow.value = null
    selectedBankRow.value = selectedBankRow.value?.id === row.id ? null : row
  }
}

async function loadReconDialog() {
  if (!filters.value.account_code) return
  reconLoading.value = true
  try {
    const [jRes, bRes] = await Promise.all([
      cashierApi.getJournal({
        account_code: filters.value.account_code,
        start_date: reconDate.value[0] || undefined,
        end_date: reconDate.value[1] || undefined,
      }),
      cashierApi.getBankStatements({
        account_code: filters.value.account_code,
        start_date: reconDate.value[0] || undefined,
        end_date: reconDate.value[1] || undefined,
      }),
    ])
    if (jRes.code === 0) reconJournalRows.value = jRes.data.rows
    if (bRes.code === 0) reconBankRows.value = bRes.data
    // 同步更新主列表的 unmatched（保持历史兼容）
    unmatched.value = reconBankRows.value
  } finally {
    reconLoading.value = false
  }
}

async function handleManualReconcile() {
  if (!selectedJournalRow.value || !selectedBankRow.value) return
  manualReconciling.value = true
  try {
    const res = await cashierApi.manualReconcile({
      journal_id: selectedJournalRow.value.id,
      bank_statement_id: selectedBankRow.value.id,
    })
    if (res.code === 0) {
      ElMessage.success('手动勾对成功')
      selectedJournalRow.value = null
      selectedBankRow.value = null
      await Promise.all([loadReconDialog(), handleQuery()])
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '手动勾对失败')
  } finally {
    manualReconciling.value = false
  }
}

async function handleCancelReconcile() {
  if (!pendingCancelRow.value) return
  cancelReconciling.value = true
  try {
    const res = await cashierApi.cancelReconcile({ journal_id: pendingCancelRow.value.id })
    if (res.code === 0) {
      ElMessage.success('已撤销对账')
      pendingCancelRow.value = null
      await Promise.all([loadReconDialog(), handleQuery()])
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '撤销失败')
  } finally {
    cancelReconciling.value = false
  }
}

async function handleAddStatement() {
  if (!addStmtForm.value.biz_date) return ElMessage.warning('请填写日期')
  if (!addStmtForm.value.debit && !addStmtForm.value.credit) return ElMessage.warning('收入或支出不能同时为零')
  addingStatement.value = true
  try {
    const res = await cashierApi.createBankStatement({
      account_code: filters.value.account_code,
      biz_date: addStmtForm.value.biz_date,
      debit: addStmtForm.value.debit,
      credit: addStmtForm.value.credit,
      bill_no: addStmtForm.value.bill_no || null,
      settle_type: addStmtForm.value.settle_type || null,
    } as any)
    if (res.code === 0) {
      ElMessage.success('对账单已录入')
      addStmtForm.value = { biz_date: '', debit: 0, credit: 0, bill_no: '', settle_type: '' }
      showAddStatement.value = false
      await loadReconDialog()
    }
  } finally {
    addingStatement.value = false
  }
}

// ── 生成凭证：缺对方科目挂账处理 ──────────────────────────
interface MissingCounterRow { id: string; biz_date: string; summary: string | null; debit: number; credit: number }
const hangupVisible = ref(false)
const missingRows = ref<MissingCounterRow[]>([])
const hangupAccount = ref('')
const rememberHangup = ref(false)
/** 系统参数：出纳默认挂账科目编码 */
const defaultCounterAccount = ref('')
/** 本次生成的会计期间范围（确认后缓存，挂账重试时复用） */
const genPeriod = ref<{ start: string; end: string }>({ start: '', end: '' })
const genSelectedIds = ref<string[]>([])

const now = new Date()
const fmt = (v: number) =>
  v === 0 ? '' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 批量借贷互换 */
async function handleBatchSwap() {
  const checkboxRows = selectedRows.value
  const currentRow = tableRef.value?.getSelectionRows?.().length === 0 ? tableRef.value?.currentRow : null
  
  // 确定目标行
  let targets: JournalRow[] = []
  if (checkboxRows.length > 0) {
    targets = checkboxRows
  } else {
    // 尝试获取单行焦点（注意：getCurrentRow() 在某些版本的 Element Plus 中可能需要直接访问 store 或使用特定方式）
    // 这里我们直接用 tableRef.value 处理，或者通过 highlight-current-row 配合变量记录
    const focused = tableRef.value?.currentRow
    if (focused) targets = [focused]
  }

  if (targets.length === 0) {
    return ElMessage.warning('请先选择要互换借贷的行（勾选或点击单行）')
  }

  // 如果只有一行，则打开弹窗由用户确认并保存（满足用户需求：打开编辑执行互换，等待存盘）
  if (targets.length === 1) {
    const row = targets[0]
    openEditDialog(row)
    // 确保弹窗打开后执行互换
    nextTick(() => {
      swapFormDebitCredit()
    })
    return
  }

  // 如果是多行，则执行批量更新
  try {
    await ElMessageBox.confirm(`确定将选中的 ${targets.length} 条记录进行借贷互换吗？`, '批量操作提示', { type: 'warning' })
  } catch { return }

  swapping.value = true
  try {
    for (const row of targets) {
      await cashierApi.updateJournal(row.id, {
        debit: row.credit || 0,
        credit: row.debit || 0
      })
    }
    ElMessage.success('批量互换成功')
    handleQuery()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    swapping.value = false
  }
}

/** 弹窗内借贷互换 */
function swapFormDebitCredit() {
  const tmp = form.value.debit || 0
  form.value.debit = form.value.credit || 0
  form.value.credit = tmp
}

function onDebitChange(val: number | null) {
  if (val && val > 0) {
    form.value.credit = 0
  }
}

function onCreditChange(val: number | null) {
  if (val && val > 0) {
    form.value.debit = 0
  }
}

onMounted(async () => {
  // 首屏依赖的字典/参数请求一次性并行，避免串行瀑布阻塞挂载
  // （/system/params 之前在 Promise.all 之后才发，多了一次串行往返）
  const [acRes, stRes, , , pRes] = await Promise.all([
    cashierApi.getAccounts(),
    cashierApi.getSettleTypes(),
    baseData.loadAccounts(),
    baseData.loadAuxCategories(),
    // 读取出纳默认挂账科目（缺对方科目时的兜底科目），失败兜底为 null 不影响其余加载
    request.get<any[]>('/system/params').catch(() => null),
  ])
  if (acRes.code === 0) accounts.value = acRes.data
  if (stRes.code === 0) settleTypes.value = stRes.data
  if (pRes && pRes.code === 0) {
    const p = (pRes.data || []).find((x: any) => x.param_key === 'cashier:default_counter_account')
    defaultCounterAccount.value = p?.param_value || ''
  }
  if (accounts.value.length) {
    filters.value.account_code = accounts.value[0].code
    handleQuery()
  }
})

async function handleQuery() {
  if (!filters.value.account_code) return
  const res = await cashierApi.getJournal({
    account_code: filters.value.account_code,
    start_date: filters.value.start_date || undefined,
    end_date: filters.value.end_date || undefined,
  })
  if (res.code === 0) {
    journalResult.value = res.data
    // 预加载所有行的辅助项到缓存
    const auxMap = new Map<string, Set<string>>()
    for (const row of res.data.rows) {
      if (!row.counter_aux_item_id) continue
      try {
        const parsed = JSON.parse(row.counter_aux_item_id) as Record<string, string>
        for (const [catId, itemId] of Object.entries(parsed)) {
          if (itemId) {
            if (!auxMap.has(catId)) auxMap.set(catId, new Set())
            auxMap.get(catId)!.add(itemId)
          }
        }
      } catch { /* ignore */ }
    }
    // 各辅助类别的选中项并行加载，避免逐类别串行等待
    await Promise.all(
      [...auxMap].map(([catId, ids]) => auxItems.ensureSelectedItems(catId, [...ids]))
    )
  }
}

function openAddDialog() {
  editRow.value = null
  form.value = { biz_date: new Date().toISOString().slice(0, 10), debit: 0, credit: 0 }
  counterAuxSelections.value = {}
  attachments.value = []
  queuedFiles.value = []
  dialogVisible.value = true
}

function openEditDialog(row: JournalRow) {
  editRow.value = row
  form.value = { ...row }
  counterAuxSelections.value = {}
  attachments.value = []
  queuedFiles.value = []
  if (row.counter_aux_item_id) {
    try { Object.assign(counterAuxSelections.value, JSON.parse(row.counter_aux_item_id)) } catch { /* ignore */ }
  }
  dialogVisible.value = true
  fetchAttachments(row.id)
  if (row.counter_account) {
    nextTick(async () => {
      for (const catId of counterAccountAuxCategoryIds.value) {
        await auxItems.onDropdownOpen(catId)
      }
    })
  }
}

async function quickAddSettleType() {
  try {
    const { value } = await ElMessageBox.prompt('请输入新结算方式的名称（编码将自动生成）', '快速新增结算方式', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    if (value) {
      const codes = settleTypes.value.map(s => parseInt(s.code, 10)).filter(n => !isNaN(n))
      const maxCode = codes.length > 0 ? Math.max(...codes) : 0
      const newCode = String(maxCode + 1).padStart(2, '0')
      
      const res = await cashierApi.createSettleType({ code: newCode, name: value })
      if (res.code === 0) {
        ElMessage.success('结算方式已增加')
        const stRes = await cashierApi.getSettleTypes()
        if (stRes.code === 0) {
          settleTypes.value = stRes.data
          form.value.settle_type = newCode
        }
      }
    }
  } catch { /* 取消 */ }
}

async function handleSave() {
  if (!form.value.biz_date) return ElMessage.warning('请填写日期')
  if (!form.value.debit && !form.value.credit) return ElMessage.warning('借方或贷方金额不能同时为零')
  if (form.value.debit && form.value.credit) return ElMessage.warning('借方和贷方不能同时有值')
  const selected = Object.fromEntries(Object.entries(counterAuxSelections.value).filter(([, v]) => v))
  const counter_aux_item_id = Object.keys(selected).length > 0 ? JSON.stringify(selected) : null
  saving.value = true
  try {
    let journalId = ''
    if (editRow.value) {
      await cashierApi.updateJournal(editRow.value.id, { ...form.value, counter_aux_item_id })
      journalId = editRow.value.id
    } else {
      const res = await cashierApi.createJournal({ ...form.value, account_code: filters.value.account_code, counter_aux_item_id })
      journalId = (res as any).data?.id
    }

    // 处理待上传附件
    if (journalId && queuedFiles.value.length > 0) {
      await cashierApi.uploadJournalAttachments(journalId, queuedFiles.value)
    }

    dialogVisible.value = false
    handleQuery()
  } finally {
    saving.value = false
  }
}

async function handleDelete(id: string) {
  const row = journalResult.value?.rows.find(r => r.id === id)
  const hasVoucher = row?.voucher_no
  const confirmMsg = hasVoucher
    ? `该记录已生成凭证 <b>${row!.voucher_year}-${String(row!.voucher_month).padStart(2,'0')} ${row!.voucher_no}</b>，删除后凭证将一并删除。确认继续？`
    : '确认删除该条记录？'
  await ElMessageBox.confirm(confirmMsg, '删除确认', { type: 'warning', dangerouslyUseHTMLString: true })
  try {
    const res = await cashierApi.deleteJournal(id)
    const { deletedVoucher } = (res as any).data || {}
    if (deletedVoucher) {
      const statusLabel = deletedVoucher.status === 'audited' ? '已审核' : '未审核'
      ElMessageBox.alert(`出纳记录已删除，同时删除了关联凭证 <b>${deletedVoucher.voucher_no}</b>（${statusLabel}）`, '删除成功', {
        type: 'success', dangerouslyUseHTMLString: true, confirmButtonText: '确定',
      })
    } else {
      ElMessage.success('删除成功')
    }
    handleQuery()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

async function loadUnmatched() {
  // 保留兼容性，实际加载由 loadReconDialog 统一处理
  await loadReconDialog()
}

async function handleAutoReconcile() {
  reconciling.value = true
  try {
    const res = await cashierApi.autoReconcile({
      account_code: filters.value.account_code,
      start_date: reconDate.value[0] || undefined,
      end_date: reconDate.value[1] || undefined,
      use_bill_no: useBillNo.value,
    })
    if (res.code === 0) {
      ElMessage.success(`自动勾对完成，匹配 ${res.data.matched} 条`)
      selectedJournalRow.value = null
      selectedBankRow.value = null
      pendingCancelRow.value = null
      await Promise.all([loadReconDialog(), handleQuery()])
    }
  } finally {
    reconciling.value = false
  }
}

async function handleDeleteCashierVouchers() {
  await ElMessageBox.confirm(
    `将删除当前科目在所选日期范围内、由出纳生成的所有<b>未审核/已审核</b>凭证（已过账凭证跳过）。确认继续？`,
    '批量删除出纳凭证', { type: 'warning', dangerouslyUseHTMLString: true }
  )
  deletingVouchers.value = true
  try {
    const res = await cashierApi.deleteCashierVouchers({
      account_code: filters.value.account_code,
      start_date: filters.value.start_date || undefined,
      end_date: filters.value.end_date || undefined,
    })
    if (res.code === 0) {
      const { deleted, skipped, deletedNos } = res.data
      // 凭证号列表：≤5 张逐一列出，>5 张显示首末号
      let nosStr = ''
      if (deletedNos.length > 0) {
        nosStr = deletedNos.length <= 5
          ? deletedNos.join('、')
          : `${deletedNos[0]} ~ ${deletedNos[deletedNos.length - 1]}`
      }
      const dateRange = [filters.value.start_date, filters.value.end_date].filter(Boolean).join(' 至 ')
      const lines = [
        dateRange ? `日期范围：${dateRange}` : '',
        `已删除 <b>${deleted}</b> 张出纳凭证${nosStr ? `（${nosStr}）` : ''}`,
        skipped > 0 ? `跳过已过账凭证 <b>${skipped}</b> 张` : '',
      ].filter(Boolean).join('<br>')
      await ElMessageBox.alert(lines, '操作完成', { type: 'success', dangerouslyUseHTMLString: true, confirmButtonText: '确定' }).catch(() => {})
      handleQuery()
      // 删除出纳凭证可能造成断号，提示是否重新排号
      await confirmRenumberAfterDelete(res.data.affectedGroups, deleted)
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    deletingVouchers.value = false
  }
}

async function handleGenerateVoucher() {
  // 当前会计期间（当年当月）
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const start = `${y}-${String(m).padStart(2,'0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`

  let msg = `将当前会计期间（${start} 至 ${end}）已对账的出纳记录生成为会计凭证，确定继续？`
  if (selectedRows.value.length > 0) {
    msg = `将选中的 ${selectedRows.value.length} 条记录生成为会计凭证，确定继续？`
  }

  try {
    await ElMessageBox.confirm(msg, '生成凭证', { type: 'info' })
  } catch { return }
  genPeriod.value = { start, end }
  genSelectedIds.value = selectedRows.value.map(r => r.id)
  await runGenerateVoucher()
}

/** 实际调用生成接口；hangupCode 为本批未填对方科目记录的挂账科目（可选） */
async function runGenerateVoucher(hangupCode?: string) {
  generating.value = true
  try {
    const res = await cashierApi.generateVoucher({
      account_code: filters.value.account_code,
      start_date: genPeriod.value.start,
      end_date: genPeriod.value.end,
      hangup_account_code: hangupCode,
      ids: genSelectedIds.value.length > 0 ? genSelectedIds.value : undefined,
    })
    if (res.code === 0) {
      const { syncedCount, voucherNos } = res.data
      // 5 张以内逐一列出，超过则折叠为「类型 首号-末号」
      let msg: string
      if (voucherNos.length <= 5) {
        msg = voucherNos.join('、')
      } else {
        // 按类型前缀分组折叠：「记账 001-010」
        const groups = new Map<string, string[]>()
        for (const n of voucherNos) {
          const dash = n.lastIndexOf('-')
          const prefix = dash > 0 ? n.slice(0, dash) : ''
          const num = dash > 0 ? n.slice(dash + 1) : n
          if (!groups.has(prefix)) groups.set(prefix, [])
          groups.get(prefix)!.push(num)
        }
        msg = [...groups.entries()].map(([prefix, nums]) =>
          prefix ? `${prefix} ${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}-${nums[nums.length - 1]}`
        ).join('、')
      }
      ElMessageBox.alert(`已生成 <b>${syncedCount}</b> 张凭证：<br>${msg}`, '生成凭证成功', {
        dangerouslyUseHTMLString: true, confirmButtonText: '确定', type: 'success',
      })
      hangupVisible.value = false
      handleQuery()
    }
  } catch (err: any) {
    const data = err?.response?.data
    if (data?.missingRows?.length) {
      // 默认拦截：列出未填对方科目的记录，引导补全或指定挂账科目
      missingRows.value = data.missingRows
      hangupAccount.value = defaultCounterAccount.value || ''
      rememberHangup.value = false
      hangupVisible.value = true
    } else {
      ElMessage.error(data?.message || '生成凭证失败')
    }
  } finally {
    generating.value = false
  }
}

/** 挂账对话框：按指定挂账科目对未填记录统一挂账后生成 */
async function confirmHangupGenerate() {
  if (!hangupAccount.value) return ElMessage.warning('请选择挂账科目')
  // 记住为默认挂账科目（持久化系统参数，需 system:account 权限）
  if (rememberHangup.value && hangupAccount.value !== defaultCounterAccount.value) {
    try {
      await request.put('/system/params', {
        params: [{ param_key: 'cashier:default_counter_account', param_value: hangupAccount.value }],
      }, { skipErrorToast: true })
      defaultCounterAccount.value = hangupAccount.value
    } catch {
      ElMessage.warning('将按本次挂账生成，但保存默认挂账科目失败（可能无系统参数权限）')
    }
  }
  await runGenerateVoucher(hangupAccount.value)
}

// ── 导入：Excel 模版下载 + 解析 + 批量导入 ────────────────
const importVisible = ref(false)
const importing = ref(false)
const importFileName = ref('')
const importRows = ref<Partial<JournalRow>[]>([])
const importErrors = ref<{ row: number; message: string }[]>([])

function openImportDialog() {
  if (!filters.value.account_code) return ElMessage.warning('请先选择科目')
  importRows.value = []
  importErrors.value = []
  importFileName.value = ''
  importVisible.value = true
}

async function downloadImportTemplate() {
  const columns: ExportColumnDef<any>[] = [
    { label: '日期', width: 110, value: r => r['日期'] },
    { label: '摘要', width: 160, value: r => r['摘要'] },
    { label: '借方(收入)', width: 110, align: 'right', type: 'amount', value: r => r['借方(收入)'] },
    { label: '贷方(支出)', width: 110, align: 'right', type: 'amount', value: r => r['贷方(支出)'] },
    { label: '结算方式', width: 90, value: r => r['结算方式'] },
    { label: '票据号', width: 110, value: r => r['票据号'] },
    { label: '对方单位', width: 140, value: r => r['对方单位'] },
    { label: '对方科目', width: 110, value: r => r['对方科目'] },
  ]
  const example = [
    { '日期': '2026-06-01', '摘要': '收到货款', '借方(收入)': 10000, '贷方(支出)': '', '结算方式': '转账', '票据号': 'PJ001', '对方单位': '某某公司', '对方科目': '1122' },
    { '日期': '2026-06-02', '摘要': '支付办公费', '借方(收入)': '', '贷方(支出)': 500, '结算方式': '现金', '票据号': '', '对方单位': '', '对方科目': '660201' },
  ]
  await exportStyledTable({ fileName: '出纳日记账导入模版.xlsx', sheetName: '日记账', columns, rows: example })
}

/** 表头列名 → 内部字段（按关键词模糊匹配，容忍模版列名微调） */
function matchImportField(label: string): string | null {
  const s = label.replace(/\s/g, '')
  if (!s) return null
  if (s.includes('日期')) return 'biz_date'
  if (s.includes('摘要')) return 'summary'
  if (s.includes('借') || s.includes('收入')) return 'debit'
  if (s.includes('贷') || s.includes('支出')) return 'credit'
  if (s.includes('结算')) return 'settle_type'
  if (s.includes('票据') || s.includes('票号')) return 'bill_no'
  if (s.includes('对方单位') || s.includes('往来单位')) return 'counter_unit'
  if (s.includes('对方科目') || s.includes('科目')) return 'counter_account'
  if (s.includes('单位')) return 'counter_unit'
  return null
}

function normExcelDate(v: any): string {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return s
}

function cellText(cell: ExcelJS.Cell | null): string {
  if (!cell) return ''
  const v: any = cell.value
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text ?? '').trim()
    if ('richText' in v) return (v.richText as any[]).map(t => t.text).join('').trim()
    if ('result' in v) return String(v.result ?? '').trim()
    if (v instanceof Date) return normExcelDate(v)
  }
  return String(v).trim()
}

function cellNum(cell: ExcelJS.Cell | null): number {
  if (!cell) return 0
  const v: any = cell.value
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && 'result' in v) {
    const n = Number(v.result); return isNaN(n) ? 0 : n
  }
  const n = parseFloat(String(v).replace(/[,，\s¥￥]/g, ''))
  return isNaN(n) ? 0 : n
}

async function handleImportFileChange(file: any) {
  const raw = file.raw
  if (!raw) return
  importFileName.value = file.name
  importRows.value = []
  importErrors.value = []
  try {
    const buf = await raw.arrayBuffer()
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    if (!ws) return ElMessage.error('文件中没有工作表')

    // 在前 5 行中定位表头行
    let headerRowIdx = -1
    const colMap: Record<string, number> = {}
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const tmp: Record<string, number> = {}
      ws.getRow(r).eachCell((cell, col) => {
        const f = matchImportField(cellText(cell))
        if (f && !(f in tmp)) tmp[f] = col
      })
      if ('biz_date' in tmp && ('debit' in tmp || 'credit' in tmp)) {
        headerRowIdx = r; Object.assign(colMap, tmp); break
      }
    }
    if (headerRowIdx < 0) {
      return ElMessage.error('未识别到表头（需包含「日期」与「借方/贷方」列），请使用下载的模版')
    }

    const nameToCode = new Map(settleTypes.value.map(s => [s.name, s.code]))
    const codeSet = new Set(settleTypes.value.map(s => s.code))
    const parsed: Partial<JournalRow>[] = []
    const errs: { row: number; message: string }[] = []

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const get = (f: string) => (colMap[f] ? row.getCell(colMap[f]) : null)
      const biz_date = normExcelDate(get('biz_date')?.value)
      const summary = cellText(get('summary'))
      const debit = cellNum(get('debit'))
      const credit = cellNum(get('credit'))
      let settle_type = cellText(get('settle_type'))
      const bill_no = cellText(get('bill_no'))
      const counter_unit = cellText(get('counter_unit'))
      const counter_account = cellText(get('counter_account'))

      // 完全空白行：跳过且不计入错误
      if (!biz_date && !summary && !debit && !credit && !bill_no && !counter_unit && !counter_account) continue
      // 结算方式：名称转编码（容忍直接填编码）
      if (settle_type && !codeSet.has(settle_type) && nameToCode.has(settle_type)) {
        settle_type = nameToCode.get(settle_type)!
      }
      if (!biz_date) { errs.push({ row: r, message: '日期为空或格式错误' }); continue }
      if (!debit && !credit) { errs.push({ row: r, message: '借贷方金额均为空' }); continue }
      parsed.push({ biz_date, summary, debit, credit, settle_type, bill_no, counter_unit, counter_account })
    }

    importRows.value = parsed
    importErrors.value = errs
    if (!parsed.length && !errs.length) ElMessage.warning('未解析到任何数据行')
    else if (!parsed.length) ElMessage.warning('没有有效记录，请检查文件内容')
  } catch (e) {
    console.error('[出纳导入] 解析失败', e)
    ElMessage.error('文件解析失败，请确认为 Excel(.xlsx) 格式')
  }
}

async function confirmImport() {
  if (!importRows.value.length) return
  importing.value = true
  try {
    const res = await cashierApi.importJournal({
      account_code: filters.value.account_code,
      rows: importRows.value,
    })
    if (res.code === 0) {
      const { inserted, errors } = res.data
      ElMessage.success(`导入成功 ${inserted} 条${errors?.length ? `，${errors.length} 条被跳过` : ''}`)
      importVisible.value = false
      handleQuery()
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

// ── 导出当前日记账为 Excel ────────────────────────────────
async function handleExport() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出')
  const acc = formatCounterAccount(filters.value.account_code)
  const range = [filters.value.start_date, filters.value.end_date].filter(Boolean).join(' 至 ')
  const codeToName = new Map(settleTypes.value.map(s => [s.code, s.name]))
  const columns: ExportColumnDef<any>[] = [
    { label: '日期', width: 100, value: r => r.biz_date },
    { label: '摘要', width: 160, value: r => r.summary || '' },
    { label: '结算方式', width: 90, value: r => (r.settle_type ? codeToName.get(r.settle_type) || r.settle_type : '') },
    { label: '票据号', width: 110, value: r => r.bill_no || '' },
    { label: '对方单位', width: 140, value: r => r.counter_unit || '' },
    { label: '对方科目', width: 150, value: r => formatCounterAccount(r.counter_account) },
    { label: '借方(收入)', width: 120, align: 'right', type: 'amount', value: r => r.debit || '' },
    { label: '贷方(支出)', width: 120, align: 'right', type: 'amount', value: r => r.credit || '' },
    { label: '余额', width: 120, align: 'right', type: 'amount', value: r => r.balance ?? 0 },
    { label: '已对账', width: 70, align: 'center', value: r => (r.reconciled ? '是' : '') },
    { label: '关联凭证', width: 120, value: r => (r.voucher_no ? `${r.voucher_year}-${String(r.voucher_month).padStart(2, '0')} ${r.voucher_no}` : '') },
  ]
  const jr = journalResult.value
  const summaryValues = jr
    ? ['', '', '', '', '', '', jr.totalDebit, jr.totalCredit, jr.closing, '', '']
    : undefined
  await exportStyledTable({
    fileName: `出纳日记账_${filters.value.account_code}_${range || '全部'}.xlsx`,
    sheetName: '出纳日记账',
    title: `出纳日记账　${acc}`,
    subtitle: range ? `日期：${range}　期初：${fmt(jr?.opening ?? 0) || '0.00'}　期末：${fmt(jr?.closing ?? 0) || '0.00'}` : undefined,
    columns,
    rows: rows.value,
    summaryValues,
  })
}

// 打开对账面板时加载对账单
watch(showReconcile, v => {
  if (v) {
    selectedJournalRow.value = null
    selectedBankRow.value = null
    pendingCancelRow.value = null
    showAddStatement.value = false
    loadReconDialog()
  }
})
watch(reconDate, () => { if (showReconcile.value) loadReconDialog() }, { deep: true })
</script>

<style scoped>
.page-cashier-journal { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.balance-summary { display: flex; gap: 24px; padding: 6px 16px; background: var(--el-fill-color-lighter); font-size: 13px; }
.balance-summary b { font-weight: 600; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.table-container { flex: 1; overflow: hidden; padding: 0 16px 8px; }
:deep(.parent-option) { color: #c0c4cc; font-style: italic; }
/* 银行对账面板 */
.recon-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.recon-stats { display: flex; align-items: center; gap: 8px; padding: 5px 8px; background: var(--el-fill-color-lighter); border-radius: 4px; font-size: 12px; margin-bottom: 8px; }
.recon-stats b { font-weight: 600; color: #303133; }
.recon-stats-sep { color: #c0c4cc; }
.recon-hint { color: #409eff; }
.recon-warn { color: #e6a23c; font-weight: 600; }
.recon-add-form { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px; background: var(--el-fill-color-lighter); border-radius: 4px; margin-bottom: 8px; }
.recon-columns { display: flex; gap: 12px; }
.recon-col { flex: 1; min-width: 0; }
.recon-col-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.recon-col-title { font-size: 13px; font-weight: 600; color: #303133; }
.recon-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 0; border-top: 1px solid var(--el-border-color-light); min-height: 40px; }

.journal-attachments-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-light);
}
.journal-attachments-section .section-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 8px;
}
</style>

<style>
/* 对方科目下拉：键盘+鼠标焦点深蓝色（非 scoped，因 el-select popper teleport 到 body，scoped 无效） */
.counter-account-popper .el-select-dropdown__item.selected:not(.is-disabled),
.counter-account-popper .el-select-dropdown__item.is-hovering:not(.is-disabled),
.counter-account-popper .el-select-dropdown__item:hover:not(.is-disabled) {
  background-color: #1d4ed8 !important;
  color: #fff;
}
.counter-account-popper .el-select-dropdown__item.selected .parent-option,
.counter-account-popper .el-select-dropdown__item.is-hovering .parent-option,
.counter-account-popper .el-select-dropdown__item:hover .parent-option {
  color: #93c5fd;
}
/* 对账面板：行选中/撤销待确认 高亮 */
.el-table tr.row-selected td { background-color: #ecf5ff !important; }
.el-table tr.row-cancel-pending td { background-color: #fef0f0 !important; }
</style>
