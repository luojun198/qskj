<template>
  <div class="page page-cashier-journal">
    <div class="filter-row">
      <el-select
        v-model="filters.account_code"
        filterable
        placeholder="选择科目"
        class="filter-ctl--md"
        @change="handleQuery"
      >
        <el-option-group v-if="cashAccounts.length" label="现金科目">
          <el-option v-for="a in cashAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
        <el-option-group v-if="bankAccounts.length" label="银行存款科目">
          <el-option v-for="a in bankAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
      </el-select>
      <!-- FIX-260：币种跟科目走（外币科目按科目核算币种，其余为本位币），不再手选 -->
      <el-tag :type="isForeignAccount ? 'warning' : 'info'" effect="plain" class="currency-tag" :title="isForeignAccount ? '外币科目：金额为原币，另列汇率与本位币金额' : '本位币科目'">
        {{ currencyLabel(accountCurrency) }}
      </el-tag>
      <el-date-picker v-model="filters.start_date" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" class="filter-ctl--md" @change="handleQuery" />
      <span>至</span>
      <el-date-picker v-model="filters.end_date" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" class="filter-ctl--md" @change="handleQuery" />
      <el-button type="primary" @click="handleQuery"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton @clear="handleClearFilters" />
      <el-divider direction="vertical" />
      <el-button plain @click="openImportDialog"><el-icon><Upload /></el-icon>导入</el-button>
      <el-button plain :disabled="!rows.length" @click="handleExport"><el-icon><Download /></el-icon>导出</el-button>
      <el-button plain :loading="swapping" @click="handleBatchSwap"><el-icon><Connection /></el-icon>借贷互换</el-button>
      <el-divider direction="vertical" />
      <el-button plain @click="goReconcile"><el-icon><Connection /></el-icon>出纳对账</el-button>
      <el-button type="success" @click="handleGenerateVoucher"><el-icon><DocumentAdd /></el-icon>生成凭证</el-button>
      <el-button type="danger" plain :loading="deletingVouchers" @click="handleDeleteCashierVouchers"><el-icon><Delete /></el-icon>删除凭证</el-button>
      <el-button plain @click="showColSetting = true"><el-icon><Setting /></el-icon>列设置</el-button>
      <el-button type="primary" @click="openAddDialog"><el-icon><Plus /></el-icon>录入日记账</el-button>
    </div>
    <!-- 评审 P2：币种与科目不一致的存量流水不在本视图内，此前被静默隐藏 -->
    <el-alert
      v-if="journalResult?.otherCurrencyCount"
      type="warning" :closable="false" show-icon style="margin-bottom:8px"
      :title="`本科目在所选区间还有 ${journalResult.otherCurrencyCount} 条流水的币种与科目核算币种（${journalResult.currency || ''}）不一致，未显示也未计入余额。请核对科目币种设置，或删除后按正确币种重新录入。`"
    />

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
        <el-table-column v-else-if="column.key === 'debit'" column-key="debit" :label="amountLabel('借方(收入)')" :width="cw('debit',110)" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'credit'" column-key="credit" :label="amountLabel('贷方(支出)')" :width="cw('credit',110)" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'balance'" column-key="balance" :label="amountLabel('余额')" :width="cw('balance',110)" align="right">
          <template #default="{ row }">{{ fmt(row.balance ?? 0) }}</template>
        </el-table-column>
        <!-- FIX-260：外币科目才显示汇率 / 本位币金额列 -->
        <el-table-column v-else-if="column.key === 'exchange_rate' && isForeignAccount" column-key="exchange_rate" label="汇率" :width="cw('exchange_rate',80)" align="right">
          <template #default="{ row }">{{ fmtRate(row.exchange_rate) }}</template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'base_debit' && isForeignAccount" column-key="base_debit" :label="`借方(${baseCurrency})`" :width="cw('base_debit',110)" align="right">
          <template #default="{ row }"><span v-if="row.base_debit" class="debit">{{ fmt(row.base_debit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'base_credit' && isForeignAccount" column-key="base_credit" :label="`贷方(${baseCurrency})`" :width="cw('base_credit',110)" align="right">
          <template #default="{ row }"><span v-if="row.base_credit" class="credit">{{ fmt(row.base_credit) }}</span></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'reconciled'" column-key="reconciled" label="对账" :width="cw('reconciled',55)" align="center">
          <template #default="{ row }"><el-icon v-if="row.reconciled" color="#67c23a"><CircleCheck /></el-icon></template>
        </el-table-column>
        <el-table-column v-else-if="column.key === 'voucher_no'" column-key="voucher_no" label="凭证" :width="cw('voucher_no',150)">
          <template #default="{ row }">
            <template v-if="row.voucher_no">
              <el-tag type="success" size="small" effect="plain">已生成</el-tag>
              <span style="margin-left:4px;white-space:nowrap">{{ voucherNoLabel(row) }}</span>
              <el-button link type="danger" size="small" style="margin-left:4px" @click.stop="handleRowDeleteVoucher(row)">删凭证</el-button>
            </template>
            <template v-else>
              <el-tag type="info" size="small" effect="plain">未生成</el-tag>
              <el-button link type="primary" size="small" style="margin-left:4px" @click.stop="handleRowGenerate(row)">生成</el-button>
            </template>
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
    <!-- FIX-253：服务端分页；期初 / 合计 / 期末仍是整个区间的口径 -->
    <!-- 底部状态栏：左侧期初 / 本期 / 期末余额摘要，右侧分页（参照金蝶，省去顶部单独一行） -->
    <div v-if="journalResult" class="journal-pagination">
      <div class="balance-summary">
        <span>期初余额：<b>{{ fmt(journalResult.opening) }}</b></span>
        <span>本期借方：<b class="debit">{{ fmt(journalResult.totalDebit) }}</b></span>
        <span>本期贷方：<b class="credit">{{ fmt(journalResult.totalCredit) }}</b></span>
        <span>期末余额：<b>{{ fmt(journalResult.closing) }}</b></span>
        <template v-if="isForeignAccount">
          <el-divider direction="vertical" />
          <span>本位币借方：<b class="debit">{{ fmt(journalResult.totalBaseDebit ?? 0) }}</b></span>
          <span>本位币贷方：<b class="credit">{{ fmt(journalResult.totalBaseCredit ?? 0) }}</b></span>
        </template>
      </div>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[50, 100, 200, 500]"
        :total="journalResult.total ?? rows.length"
        layout="total, sizes, prev, pager, next, jumper"
        small
        @size-change="handleQuery"
        @current-change="handleQuery"
      />
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
      <el-form :model="form" label-width="74px" size="small" @keydown.ctrl.enter.prevent="!editRow && !saving && handleSave(true)">
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
            <el-form-item :label="isForeignAccount ? `收入(${accountCurrency})` : '收入(借)'" label-width="70px">
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
            <el-form-item :label="isForeignAccount ? `支出(${accountCurrency})` : '支出(贷)'" label-width="70px">
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

        <!-- FIX-260：外币科目录入汇率，本位币金额自动折算（只读） -->
        <el-row v-if="isForeignAccount" :gutter="15">
          <el-col :span="12">
            <el-form-item label="汇率" required>
              <div style="display:flex; gap:8px; width:100%; align-items:center">
                <el-input-number
                  v-model="form.exchange_rate"
                  :precision="rateDecimals"
                  :min="0"
                  :controls="false"
                  style="flex:1"
                  @change="rateTouched = true"
                />
                <el-button link type="primary" size="small" :loading="rateLoading" @click="loadDefaultRate(true)">取默认</el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="`收入(${baseCurrency})`" label-width="70px">
              <el-input :model-value="fmt(formBaseAmounts.base_debit)" readonly />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item :label="`支出(${baseCurrency})`" label-width="70px">
              <el-input :model-value="fmt(formBaseAmounts.base_credit)" readonly />
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
        <el-button v-if="!editRow" :loading="saving" @click="handleSave(true)">保存并新增 (Ctrl+Enter)</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave()">保存</el-button>
      </template>
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
        <div style="margin-bottom:6px;font-size: var(--cw-text-base)">
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
          <el-table-column v-if="isForeignAccount" label="汇率" prop="exchange_rate" width="80" align="right">
            <template #default="{ row }">{{ row.exchange_rate ? fmtRate(row.exchange_rate) : '默认' }}</template>
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
          {{ importProgress ? `导入中 ${importProgress.done}/${importProgress.total} 批` : `确认导入${importRows.length ? `（${importRows.length} 条）` : ''}` }}
        </el-button>
      </template>
    </el-dialog>

    <ColumnSettingsDialog v-model="showColSetting" :columns="colSettings" @update:columns="updateJournalColumns" @reset="resetColSettings" />
  </div>
</template>

<script setup lang="ts">
// P2-7：默认日期用本地时间（此前 toISOString 取 UTC，东八区 0~8 点会落到前一天）
import { formatDate } from '@/utils/format'
import { ref, computed, onMounted, onActivated, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type ExcelJS from 'exceljs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Connection, CircleCheck, DocumentAdd, Setting, Delete, Upload, Download } from '@element-plus/icons-vue'
import { cashierApi, type JournalRow, type JournalResult, type SettleType } from '@/api/cashier'
import { getCurrencies as getCurrencyMaster } from '@/api/currency'
import { useBaseDataStore } from '@/stores/baseData'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useVoucherAuxItems } from '@/composables/useVoucherAuxItems'
import { exportStyledTable, exportStyledTableViaSource, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'
import VoucherAttachments from '@/components/voucher/VoucherAttachments.vue'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { loadColumnSettings, saveColumnSettings, type ColumnSetting } from '@/utils/columnSettings'
import { useFilterClear } from '@/composables/useFilterClear'
import { getTypeAbbr } from '@/utils/voucherFlatList'

const { tableRef: colWidthTableRef, colWidth, onDragEnd } = useListColumnWidth('cashier_journal')
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const tableRef = colWidthTableRef
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const baseData = useBaseDataStore()
const auxItems = useVoucherAuxItems()
const router = useRouter()
const route = useRoute()

const settleAccountMap = computed(() => {
  const map = new Map<string, string>()
  for (const s of settleTypes.value) map.set(s.code, s.name)
  return map
})
function getSettleTypeName(code: string | null) {
  if (!code) return ''
  return settleAccountMap.value.get(code) || code
}

/** 凭证类型简称（记/收/付/转），按 journal 行的 voucher_type（凭证类型 id）映射 */
function voucherTypeAbbr(row: JournalRow): string {
  if (row.voucher_type == null) return '记'
  const vt = baseData.voucherTypes.find(t => String(t.id) === String(row.voucher_type))
  return vt ? getTypeAbbr(vt.name) : '记'
}

/** 凭证号展示：后端存的 voucher_no 已含类型前缀（如「结-016」）时原样显示，历史纯数字号才补前缀 */
function voucherNoLabel(row: JournalRow): string {
  const no = String(row.voucher_no ?? '')
  return no.includes('-') ? no : `${voucherTypeAbbr(row)}-${no}`
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
  // FIX-260：外币科目专用列（本位币科目不渲染）
  { key: 'exchange_rate', label: '汇率', visible: true, group: '外币' },
  { key: 'base_debit', label: '借方(本位币)', visible: true, group: '外币' },
  { key: 'base_credit', label: '贷方(本位币)', visible: true, group: '外币' },
  { key: 'reconciled', label: '对账', visible: true },
  { key: 'voucher_no', label: '凭证', visible: true },
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

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number; is_foreign?: number; currency_code?: string | null; id: string; parent_id?: string | null }[]>([])
const cashAccounts = computed(() => accounts.value.filter(a => a.is_cash === 1))
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank === 1 && a.is_cash !== 1))

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
  return buildHierarchyList(leafs as any, all as any)
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
const currencies = ref<string[]>(['RMB'])
/** FIX-260：本位币（后端币种列表第一项） */
const baseCurrency = computed(() => currencies.value[0] || 'RMB')
const currentAccount = computed(() => accounts.value.find(a => a.code === filters.value.account_code))
/** 当前科目的核算币种：外币科目取科目币种，其余为本位币 */
const accountCurrency = computed(() => {
  const a = currentAccount.value
  const code = a && Number(a.is_foreign || 0) === 1 && a.currency_code ? String(a.currency_code).toUpperCase() : ''
  return code && code !== 'CNY' ? code : baseCurrency.value
})
const isForeignAccount = computed(() => accountCurrency.value !== baseCurrency.value)
const CURRENCY_NAMES: Record<string, string> = { RMB: '人民币', CNY: '人民币', USD: '美元', EUR: '欧元', HKD: '港币', JPY: '日元', GBP: '英镑' }
function currencyLabel(code: string) { return CURRENCY_NAMES[code] ? `${code} ${CURRENCY_NAMES[code]}` : code }
function amountLabel(base: string) { return isForeignAccount.value ? `${base} ${accountCurrency.value}` : base }
const rateDecimals = ref(4)
/** 汇率小数位取币种主数据（外币类型页维护），取不到默认 4 */
const currencyDecimals = ref<Record<string, number>>({})
watch(accountCurrency, cur => { rateDecimals.value = currencyDecimals.value[cur] ?? 4 }, { immediate: true })
function fmtRate(v: any) { const n = Number(v); return n > 0 ? n.toFixed(rateDecimals.value) : '' }
const rateTouched = ref(false)
const rateLoading = ref(false)
const formBaseAmounts = computed(() => {
  const r = Number(form.value.exchange_rate) || 0
  const round2 = (n: number) => Math.round(n * r * 100) / 100
  return { base_debit: round2(Number(form.value.debit) || 0), base_credit: round2(Number(form.value.credit) || 0) }
})
/** 外币科目：按业务日期取默认汇率；用户手改过则不覆盖（force=true 强制取默认） */
async function loadDefaultRate(force = false) {
  if (!isForeignAccount.value || !filters.value.account_code) return
  if (rateTouched.value && !force) return
  rateLoading.value = true
  try {
    const res = await cashierApi.getJournalRate({ account_code: filters.value.account_code, biz_date: form.value.biz_date })
    if (res.code === 0 && res.data.rate > 0) { form.value.exchange_rate = res.data.rate; rateTouched.value = false }
  } catch { /* ignore */ } finally { rateLoading.value = false }
}
const journalResult = ref<JournalResult | null>(null)
const rows = computed(() => journalResult.value?.rows ?? [])

const firstDay = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
const filters = ref({ account_code: '', currency: 'RMB', start_date: firstDay, end_date: lastDayStr })
// FIX-253：服务端分页状态；筛选条件一变立即回到第 1 页（sync 保证在 @change 里的 handleQuery 之前生效）
const page = ref(1)
const pageSize = ref(100)
watch(filters, () => { page.value = 1 }, { deep: true, flush: 'sync' })
// FIX-260：币种跟科目走
watch(accountCurrency, cur => { filters.value.currency = cur }, { immediate: true, flush: 'sync' })
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并查询全部（保留科目，清空起止日期） */
function handleClearFilters() {
  const currentAccount = filters.value.account_code || (cashierAccounts.value.find(a => !a.isParent)?.code || '')
  clearFilters()
  filters.value.account_code = currentAccount
  filters.value.currency = accountCurrency.value
  handleQuery()
}

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

const deletingVouchers = ref(false)

/** FIX-262：对账改为「出纳日记账 ↔ 总账已记账分录」，在全页面「出纳对账」中进行 */
function goReconcile() {
  router.push({ path: '/cashier/reconcile', query: filters.value.account_code ? { account_code: filters.value.account_code } : {} })
}

// ── 生成凭证：预览页流转 ──────────────────────────────────
/** 本次生成的会计期间范围（确认后缓存，预览页复用） */
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

function onDebitChange(val: number | null | undefined) {
  if (val && val > 0) {
    form.value.credit = 0
  }
}

function onCreditChange(val: number | null | undefined) {
  if (val && val > 0) {
    form.value.debit = 0
  }
}

/** 生成凭证预览/结果页写入的脏标记：返回本页（keep-alive 激活）时刷新列表，使凭证号等字段同步 */
const JOURNAL_DIRTY_KEY = 'cashier:journal-dirty'
onActivated(() => {
  let dirty = false
  try { dirty = sessionStorage.getItem(JOURNAL_DIRTY_KEY) === '1'; if (dirty) sessionStorage.removeItem(JOURNAL_DIRTY_KEY) } catch { /* ignore */ }
  // 从出纳对账 / 对账单导入带 account_code 回来：切到该科目并刷新（导入会新增日记账）
  const q = String(route.query.account_code || '')
  if (q && q !== filters.value.account_code && accounts.value.some(a => a.code === q)) {
    filters.value.account_code = q
    handleQuery()
    return
  }
  if ((dirty || q) && filters.value.account_code) handleQuery()
})

onMounted(async () => {
  // 首屏依赖的字典/参数请求一次性并行，避免串行瀑布阻塞挂载
  const [acRes, stRes, , , curRes] = await Promise.all([
    cashierApi.getAccounts(),
    cashierApi.getSettleTypes(),
    baseData.loadAccounts(),
    baseData.loadAuxCategories(),
    // 出纳币别（含本位币），失败兜底为 RMB
    cashierApi.getCurrencies().catch(() => null),
    // 凭证类型（「凭证」列显示类型简称用）
    baseData.loadVoucherTypes(),
  ])
  if (acRes.code === 0) accounts.value = acRes.data as any
  // FIX-260：币种主数据的汇率小数位（未启用外币核算时接口可能 403，忽略）
  getCurrencyMaster().then(r => {
    if (r.code === 0 && Array.isArray(r.data)) {
      currencyDecimals.value = Object.fromEntries(r.data.map(c => [String(c.code).toUpperCase(), Number(c.rate_decimals) || 4]))
      rateDecimals.value = currencyDecimals.value[accountCurrency.value] ?? 4
    }
  }).catch(() => {})
  if (stRes.code === 0) settleTypes.value = stRes.data
  if (curRes && curRes.code === 0 && Array.isArray(curRes.data) && curRes.data.length) {
    currencies.value = curRes.data
  }
  // FIX-260：币种跟科目走（本位币由后端排第一位）
  filters.value.currency = accountCurrency.value
  if (accounts.value.length) {
    // 链接带了 account_code（出纳对账 / 对账单导入返回）则优先打开该科目
    const q = String(route.query.account_code || '')
    filters.value.account_code = accounts.value.some(a => a.code === q) ? q : accounts.value[0].code
    handleQuery()
  }
})

async function handleQuery() {
  if (!filters.value.account_code) return
  const res = await cashierApi.getJournal({
    account_code: filters.value.account_code,
    currency: filters.value.currency || undefined,
    start_date: filters.value.start_date || undefined,
    end_date: filters.value.end_date || undefined,
    page: page.value,
    page_size: pageSize.value,
  })
  if (res.code === 0) {
    // 删除 / 筛选后本页可能已越界，回到最后一页重取
    const maxPage = Math.max(1, Math.ceil((res.data.total ?? 0) / pageSize.value))
    if (page.value > maxPage) {
      page.value = maxPage
      return handleQuery()
    }
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
  resetAddForm()
  dialogVisible.value = true
  loadDefaultRate()
}

/** 清空录入表单；「保存并新增」时沿用上一笔的日期，方便连续录同一天的流水 */
function resetAddForm(keepDate?: string) {
  form.value = { biz_date: keepDate || formatDate(new Date()), debit: 0, credit: 0 }
  counterAuxSelections.value = {}
  attachments.value = []
  queuedFiles.value = []
  rateTouched.value = false
}
// FIX-260：新增外币流水时改日期 → 重新取该期间默认汇率（用户手改过则保留）
watch(() => form.value.biz_date, () => { if (dialogVisible.value && !editRow.value) loadDefaultRate() })

function openEditDialog(row: JournalRow) {
  editRow.value = row
  form.value = { ...row }
  rateTouched.value = true
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
      
      const res = await cashierApi.createSettleType({ code: newCode, name: value } as any)
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

async function handleSave(keepOpen = false) {
  if (!form.value.biz_date) return ElMessage.warning('请填写日期')
  if (!form.value.debit && !form.value.credit) return ElMessage.warning('借方或贷方金额不能同时为零')
  if (form.value.debit && form.value.credit) return ElMessage.warning('借方和贷方不能同时有值')
  if (isForeignAccount.value && !(Number(form.value.exchange_rate) > 0)) return ElMessage.warning('请填写大于 0 的汇率')
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

    if (keepOpen && !editRow.value) {
      // 保存并新增：保留弹窗，清空表单（沿用日期），列表在后台刷新
      ElMessage.success('已保存，可继续录入')
      resetAddForm(form.value.biz_date)
      loadDefaultRate()
      handleQuery()
    } else {
      dialogVisible.value = false
      handleQuery()
    }
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

async function handleDeleteCashierVouchers() {
  // 勾选了记录：只删选中行对应的凭证；未勾选：删日期范围内全部出纳凭证
  const byIds = selectedRows.value.length > 0
  const ids = byIds ? selectedRows.value.map(r => r.id) : undefined
  const confirmMsg = byIds
    ? `将删除选中的 ${ids?.length ?? 0} 条记录对应的出纳凭证（已过账凭证跳过），确定继续？`
    : `将删除当前科目在所选日期范围内、由出纳生成的所有未审核/已审核凭证（已过账凭证跳过），确定继续？`
  await ElMessageBox.confirm(confirmMsg, '删除凭证', { type: 'info' })
  deletingVouchers.value = true
  try {
    const res = await cashierApi.deleteCashierVouchers({
      account_code: filters.value.account_code,
      start_date: byIds ? undefined : (filters.value.start_date || undefined),
      end_date: byIds ? undefined : (filters.value.end_date || undefined),
      ids: byIds ? ids : undefined,
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
      const dateRange = byIds ? '选中记录' : [filters.value.start_date, filters.value.end_date].filter(Boolean).join(' 至 ')
      const lines = [
        dateRange ? `范围：${dateRange}` : '',
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
  // 评审 P2：未勾选行时按页面筛选的日期区间生成（与「删除凭证」同口径）；此前固定取当前自然月，
  // 查看 8 月流水点生成，实际生成的是 9 月的。筛选区间两端都为空时才退回当前自然月。
  let start = filters.value.start_date || ''
  let end = filters.value.end_date || ''
  if (!start && !end) {
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    start = `${y}-${String(m).padStart(2,'0')}-01`
    end = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`
  }

  genPeriod.value = { start, end }
  genSelectedIds.value = selectedRows.value.map(r => r.id)
  await openGeneratePreview()
}

/** 行级快捷「生成」：只为该行生成凭证（预览页二次确认后真正生成） */
async function handleRowGenerate(row: JournalRow) {
  const [y, m] = row.biz_date.split('-').map(Number)
  genPeriod.value = {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`,
  }
  genSelectedIds.value = [row.id]
  await openGeneratePreview()
}

/** 行级快捷「删凭证」：只删除该行关联的出纳凭证（已过账由后端跳过并提示） */
async function handleRowDeleteVoucher(row: JournalRow) {
  await ElMessageBox.confirm(
    `将删除该记录对应的出纳凭证（${voucherNoLabel(row)}，已过账凭证跳过）。确认继续？`,
    '删除凭证', { type: 'warning' }
  )
  deletingVouchers.value = true
  try {
    const res = await cashierApi.deleteCashierVouchers({
      account_code: filters.value.account_code,
      ids: [row.id],
    })
    if (res.code === 0) {
      const { deleted, skipped, deletedNos } = res.data
      if (deleted === 0 && skipped > 0) {
        ElMessage.warning(`凭证 ${deletedNos[0] ?? ''} 已过账，已跳过删除`)
      } else {
        ElMessage.success(`已删除凭证 ${deletedNos.join('、')}`)
      }
      handleQuery()
      // 删除可能造成断号，提示是否重新排号
      await confirmRenumberAfterDelete(res.data.affectedGroups, deleted)
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    deletingVouchers.value = false
  }
}

/** 生成凭证：跳转预览页（预览将生成的分录，二次确认后才真正生成） */
async function openGeneratePreview() {
  try {
    sessionStorage.setItem('cashier:voucher-generate-preview', JSON.stringify({
      account_code: filters.value.account_code,
      start_date: genPeriod.value.start,
      end_date: genPeriod.value.end,
      ids: genSelectedIds.value.length > 0 ? genSelectedIds.value : undefined,
    }))
  } catch { /* ignore */ }
  router.push({ name: 'CashierVoucherGeneratePreview' })
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
    ...(isForeignAccount.value ? [{ label: '汇率', width: 90, align: 'right' as const, value: (r: any) => r['汇率'] }] : []),
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
  if (s.includes('汇率')) return 'exchange_rate'
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
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  // 未套日期格式的 Excel 数字型日期（序列号，如 45876）：此前原样返回，落库后闸口与区间查询都失效
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial >= 61 && serial <= 2958465) {
      const dt = new Date(Math.round((serial - 25569) * 86400 * 1000))
      const y = dt.getUTCFullYear(), mm = String(dt.getUTCMonth() + 1).padStart(2, '0'), dd = String(dt.getUTCDate()).padStart(2, '0')
      return `${y}-${mm}-${dd}`
    }
  }
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
      // 评审 P2：模版「汇率」列此前识别了却没读取，外币流水一律按默认汇率入账；留空仍走默认汇率
      const rateCell = get('exchange_rate')
      const exchange_rate = rateCell && cellText(rateCell) !== '' ? cellNum(rateCell) : undefined

      // 完全空白行：跳过且不计入错误
      if (!biz_date && !summary && !debit && !credit && !bill_no && !counter_unit && !counter_account) continue
      // 结算方式：名称转编码（容忍直接填编码）
      if (settle_type && !codeSet.has(settle_type) && nameToCode.has(settle_type)) {
        settle_type = nameToCode.get(settle_type)!
      }
      if (!biz_date) { errs.push({ row: r, message: '日期为空或格式错误' }); continue }
      if (!debit && !credit) { errs.push({ row: r, message: '借贷方金额均为空' }); continue }
      if (exchange_rate !== undefined && !(exchange_rate > 0)) { errs.push({ row: r, message: '汇率必须是大于 0 的数字' }); continue }
      parsed.push({
        biz_date, summary, debit, credit, settle_type, bill_no, counter_unit, counter_account,
        ...(exchange_rate !== undefined ? { exchange_rate } : {}),
      })
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

/** FIX-254：单次提交上限；超过按批提交并显示进度，10 万行不再一个 12MB 请求体一次打给服务端 */
const IMPORT_BATCH_ROWS = 10000
const importProgress = ref<{ done: number; total: number } | null>(null)

async function confirmImport() {
  if (!importRows.value.length) return
  importing.value = true
  importProgress.value = null
  try {
    const all = importRows.value
    let inserted = 0
    const errors: { row: number; message: string }[] = []
    const batches = Math.ceil(all.length / IMPORT_BATCH_ROWS)
    for (let b = 0; b < batches; b++) {
      const offset = b * IMPORT_BATCH_ROWS
      // seq 用全局行号，避免每批从 1 重新计数导致顺序错乱
      const chunk = all.slice(offset, offset + IMPORT_BATCH_ROWS).map((r, i) => ({ ...r, seq: r.seq ?? offset + i + 1 }))
      if (batches > 1) importProgress.value = { done: b, total: batches }
      const res = await cashierApi.importJournal({ account_code: filters.value.account_code, rows: chunk })
      if (res.code !== 0) break
      inserted += res.data.inserted
      for (const e of res.data.errors || []) errors.push({ row: e.row + offset, message: e.message })
    }
    ElMessage.success(`导入成功 ${inserted} 条${errors.length ? `，${errors.length} 条被跳过` : ''}`)
    importVisible.value = false
    handleQuery()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '导入失败')
  } finally {
    importing.value = false
    importProgress.value = null
  }
}

// ── 导出当前日记账为 Excel ────────────────────────────────
async function handleExport() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出')
  // FIX-326：日记账接口已强制分页，导出改由服务端按区间逐天取数、流式生成 xlsx（不再把整个区间拉到浏览器）
  const acc = formatCounterAccount(filters.value.account_code)
  const range = [filters.value.start_date, filters.value.end_date].filter(Boolean).join(' 至 ')
  const columns: ExportColumnDef<any>[] = [
    { key: 'biz_date', label: '日期', width: 100 },
    { key: 'summary', label: '摘要', width: 160 },
    { key: 'settle_type', label: '结算方式', width: 90 },
    { key: 'bill_no', label: '票据号', width: 110 },
    { key: 'counter_unit', label: '对方单位', width: 140 },
    { key: 'counter_account', label: '对方科目', width: 150 },
    { key: 'debit', label: amountLabel('借方(收入)'), width: 120, align: 'right', type: 'amount' },
    { key: 'credit', label: amountLabel('贷方(支出)'), width: 120, align: 'right', type: 'amount' },
    { key: 'balance', label: amountLabel('余额'), width: 120, align: 'right', type: 'amount' },
    // FIX-260：外币科目导出汇率与本位币金额
    ...(isForeignAccount.value
      ? ([
          { key: 'exchange_rate', label: '汇率', width: 90, align: 'right' },
          { key: 'base_debit', label: `借方(${baseCurrency.value})`, width: 120, align: 'right', type: 'amount' },
          { key: 'base_credit', label: `贷方(${baseCurrency.value})`, width: 120, align: 'right', type: 'amount' },
        ] as ExportColumnDef<any>[])
      : []),
    { key: 'reconciled', label: '已对账', width: 70, align: 'center' },
    { key: 'voucher', label: '关联凭证', width: 120 },
  ]
  const jr = journalResult.value
  const summaryValues = jr
    ? ['', '', '', '', '', '', jr.totalDebit, jr.totalCredit, jr.closing,
       ...(isForeignAccount.value ? ['', jr.totalBaseDebit ?? 0, jr.totalBaseCredit ?? 0] : []), '', '']
    : undefined
  await exportStyledTableViaSource({
    fileName: `出纳日记账_${filters.value.account_code}_${range || '全部'}.xlsx`,
    sheetName: '出纳日记账',
    title: `出纳日记账　${acc}`,
    subtitle: range ? `日期：${range}　期初：${fmt(jr?.opening ?? 0) || '0.00'}　期末：${fmt(jr?.closing ?? 0) || '0.00'}` : undefined,
    columns,
    source: {
      type: 'cashierJournal',
      params: {
        account_code: filters.value.account_code,
        currency: filters.value.currency || undefined,
        start_date: filters.value.start_date || undefined,
        end_date: filters.value.end_date || undefined,
      },
    },
    summaryValues,
  })
}

</script>

<style scoped>
.page-cashier-journal { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.balance-summary { display: flex; align-items: center; gap: 18px; min-width: 0; overflow-x: auto; white-space: nowrap; font-size: var(--cw-text-base); }
.balance-summary b { font-weight: 600; }
.currency-tag { height: 28px; line-height: 26px; font-weight: 600; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.table-container { flex: 1; overflow: hidden; }
.journal-pagination { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 4px; }
.journal-pagination .el-pagination { flex-shrink: 0; margin-left: auto; }
:deep(.parent-option) { color: #c0c4cc; font-style: italic; }

.journal-attachments-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-light);
}
.journal-attachments-section .section-title {
  font-size: var(--cw-text-base);
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
</style>
