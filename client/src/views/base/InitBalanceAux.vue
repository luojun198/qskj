<template>
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <el-button link type="primary" size="small" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回期初余额
        </el-button>
        <h3 v-if="currentAccount">
          辅助期初 — {{ currentAccount.code }} {{ currentAccount.name }}
          <el-tag
            :type="currentAccount.direction === 'debit' ? 'primary' : 'warning'"
            size="small"
            style="margin-left: 8px"
          >
            {{ currentAccount.direction === 'debit' ? '借' : '贷' }}
          </el-tag>
        </h3>
        <h3 v-else>辅助期初录入</h3>
      </div>
      <div class="header-actions">
        <el-select
          v-model="year"
          style="width: 112px"
          size="small"
          :disabled="loading"
          @change="onYearChange"
        >
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <span v-if="isMidYear" class="mid-year-hint">（年中开账）</span>
        <el-input
          v-model="keyword"
          placeholder="编号 / 名称 / 自定义字段"
          clearable
          class="search-input"
          size="small"
          :disabled="loading"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-checkbox v-model="showZeroValue" size="small" class="zero-filter-checkbox">
          零值显示
        </el-checkbox>
        <el-button size="small" :disabled="loading" @click="refresh(true)">刷新</el-button>
        <el-button plain size="small" :disabled="loading" @click="downloadTemplate">
          <el-icon><Download /></el-icon>
          下载模板
        </el-button>
        <el-button plain size="small" :disabled="loading || displayTotal === 0" @click="exportData">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
        <el-button plain size="small" :disabled="loading || displayTotal === 0" @click="printPage">
          <el-icon><Printer /></el-icon>
          打印
        </el-button>
        <el-button size="small" :disabled="locked || loading" @click="openImportDialog"
          >导入</el-button
        >
        <el-button
          type="danger"
          plain
          size="small"
          :disabled="locked || loading"
          @click="openClearDialog"
        >
          批量清理
        </el-button>
        <el-button
          type="primary"
          size="small"
          :loading="saving"
          :disabled="locked"
          @click="handleSaveAll"
        >
          保存全部
        </el-button>
      </div>
    </div>

    <el-alert v-if="locked" type="warning" show-icon :closable="false" style="margin-bottom: 12px">
      {{ lockReason }}
    </el-alert>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      <template v-if="useCategoryTabs">
        多辅助类目分标签分别录入，互不交叉组合：每个标签只录该类目下的项目金额。各标签页合计应一致，科目期初余额不会重复累加。
      </template>
      <template v-else> 表格已列出全部辅助项目；点击金额录入，失焦自动保存。 </template>
    </el-alert>

    <div
      v-if="loadProgress.total > 0 && loadProgress.loaded < loadProgress.total"
      class="load-progress-bar"
    >
      <div class="load-progress-bar__head">
        <span class="load-progress-bar__title">
          {{ loading ? '正在加载辅助期初数据' : '后台继续加载剩余数据' }}
        </span>
        <span class="load-progress-bar__count">
          {{ loadProgress.loaded.toLocaleString() }} / {{ loadProgress.total.toLocaleString() }} 条
          （{{ loadProgressPercent }}%）
        </span>
      </div>
      <el-progress :percentage="loadProgressPercent" :stroke-width="16" :show-text="false" />
      <p class="load-progress-bar__tip">
        首批数据加载完成后可先浏览；全部加载完成前列表合计与条数可能尚未最终一致，请勿误判为数据缺失。
      </p>
    </div>

    <div v-loading="loading" class="table-wrap">
      <el-tabs v-if="useCategoryTabs" v-model="activeCategoryId" class="category-tabs">
        <el-tab-pane
          v-for="cat in categories"
          :key="cat.id"
          :name="cat.id"
          :label="categoryTabLabels[cat.id] || cat.name"
        />
      </el-tabs>

      <div
        ref="tableContainerRef"
        class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
      >
        <el-table
          v-if="activeCategory"
          ref="tableRef"
          :height="tableHeight"
          :data="enrichedDisplayRows"
          :fit="false"
          border
          stripe
          size="small"
          highlight-current-row
          :class="['aux-lines-table', 'compact-data-table', summaryBalanceClass]"
          :row-key="row => row.key"
          :row-style="{ height: '30px' }"
          :cell-style="{ padding: '0' }"
          :header-cell-style="{ padding: '4px 0' }"
          show-summary
          :summary-method="getSummaries"
          @current-change="handleCurrentRowChange"
          @sort-change="handleSortChange"
        >
          <el-table-column
            type="index"
            label="序"
            width="44"
            align="center"
            fixed
            :index="rowIndex"
          />
          <el-table-column
            label="编码"
            width="112"
            fixed
            show-overflow-tooltip
            class-name="col-code"
            prop="code"
            sortable="custom"
          >
            <template #default="{ row }">
              {{ row.itemCode }}
            </template>
          </el-table-column>
          <el-table-column
            label="名称"
            min-width="150"
            fixed
            show-overflow-tooltip
            class-name="col-name"
          >
            <template #default="{ row }">
              <span class="current-cat-name">{{ row.itemName }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="年初借"
            width="122"
            align="right"
            class-name="col-opening-debit"
            prop="opening_debit"
            sortable="custom"
          >
            <template #default="{ row }">
              <span
                v-if="editingCell?.rowKey !== row.key || editingCell?.field !== 'opening_debit'"
                class="editable-cell"
                :class="{
                  'cell-active':
                    currentRow?.key === row.key &&
                    activeField === 'opening_debit' &&
                    editingCell?.rowKey !== row.key,
                  'cell-unsaved': unsavedSet.has(row.key + '_opening_debit'),
                }"
                @click="!locked && startEdit(row, 'opening_debit')"
              >
                {{ formatAmount(row.opening_debit || 0) }}
              </span>
              <input
                v-else
                :ref="el => setEditInputRef(row.key, 'opening_debit', el)"
                v-model="editValue"
                type="text"
                class="cell-input"
                inputmode="decimal"
                @blur="onEditInputBlur(row, 'opening_debit')"
                @keydown="handleCellKeydown($event, row, 'opening_debit')"
              />
            </template>
          </el-table-column>
          <el-table-column
            label="年初贷"
            width="122"
            align="right"
            class-name="col-opening-credit"
            prop="opening_credit"
            sortable="custom"
          >
            <template #default="{ row }">
              <span
                v-if="editingCell?.rowKey !== row.key || editingCell?.field !== 'opening_credit'"
                class="editable-cell"
                :class="{
                  'cell-active':
                    currentRow?.key === row.key &&
                    activeField === 'opening_credit' &&
                    editingCell?.rowKey !== row.key,
                  'cell-unsaved': unsavedSet.has(row.key + '_opening_credit'),
                }"
                @click="!locked && startEdit(row, 'opening_credit')"
              >
                {{ formatAmount(row.opening_credit || 0) }}
              </span>
              <input
                v-else
                :ref="el => setEditInputRef(row.key, 'opening_credit', el)"
                v-model="editValue"
                type="text"
                class="cell-input"
                inputmode="decimal"
                @blur="onEditInputBlur(row, 'opening_credit')"
                @keydown="handleCellKeydown($event, row, 'opening_credit')"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="isMidYear"
            label="账前借"
            width="122"
            align="right"
            class-name="col-pre-book-debit"
            prop="pre_book_debit"
            sortable="custom"
          >
            <template #default="{ row }">
              <span
                v-if="editingCell?.rowKey !== row.key || editingCell?.field !== 'pre_book_debit'"
                class="editable-cell"
                :class="{
                  'cell-active':
                    currentRow?.key === row.key &&
                    activeField === 'pre_book_debit' &&
                    editingCell?.rowKey !== row.key,
                  'cell-unsaved': unsavedSet.has(row.key + '_pre_book_debit'),
                }"
                @click="!locked && startEdit(row, 'pre_book_debit')"
              >
                {{ formatAmount(row.pre_book_debit || 0) }}
              </span>
              <input
                v-else
                :ref="el => setEditInputRef(row.key, 'pre_book_debit', el)"
                v-model="editValue"
                type="text"
                class="cell-input"
                inputmode="decimal"
                @blur="onEditInputBlur(row, 'pre_book_debit')"
                @keydown="handleCellKeydown($event, row, 'pre_book_debit')"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="isMidYear"
            label="账前贷"
            width="122"
            align="right"
            class-name="col-pre-book-credit"
            prop="pre_book_credit"
            sortable="custom"
          >
            <template #default="{ row }">
              <span
                v-if="editingCell?.rowKey !== row.key || editingCell?.field !== 'pre_book_credit'"
                class="editable-cell"
                :class="{
                  'cell-active':
                    currentRow?.key === row.key &&
                    activeField === 'pre_book_credit' &&
                    editingCell?.rowKey !== row.key,
                  'cell-unsaved': unsavedSet.has(row.key + '_pre_book_credit'),
                }"
                @click="!locked && startEdit(row, 'pre_book_credit')"
              >
                {{ formatAmount(row.pre_book_credit || 0) }}
              </span>
              <input
                v-else
                :ref="el => setEditInputRef(row.key, 'pre_book_credit', el)"
                v-model="editValue"
                type="text"
                class="cell-input"
                inputmode="decimal"
                @blur="onEditInputBlur(row, 'pre_book_credit')"
                @keydown="handleCellKeydown($event, row, 'pre_book_credit')"
              />
            </template>
          </el-table-column>
          <el-table-column
            label="余向"
            width="54"
            align="center"
            fixed="right"
            class-name="col-balance-dir"
          >
            <template #default="{ row }">
              <template v-if="row.balanceInfo">
                <el-tag
                  :type="row.balanceInfo.dir === '借' ? 'primary' : 'danger'"
                  size="small"
                  effect="dark"
                >
                  {{ row.balanceInfo.dir }}
                </el-tag>
              </template>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column
            label="余额"
            width="128"
            align="right"
            fixed="right"
            class-name="col-balance-amount"
            prop="balance"
            sortable="custom"
          >
            <template #default="{ row }">
              <template v-if="row.balanceInfo">
                <span :class="row.balanceInfo.dir === '借' ? 'balance-debit' : 'balance-credit'">
                  ¥{{ formatAmount(row.balanceInfo.amount) }}
                </span>
              </template>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="64"
            align="center"
            fixed="right"
            class-name="col-actions"
          >
            <template #default="{ row }">
              <el-button
                link
                type="danger"
                size="small"
                :disabled="locked"
                @click="removeLineByKey(row.key)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="footer-bar">
        <span class="sum-hint">
          本标签合计：借方 {{ formatAmount(totals.debit) }} / 贷方 {{ formatAmount(totals.credit) }}
        </span>
        <template v-if="useCategoryTabs && categoryTotals.length > 1">
          <span
            v-for="ct in categoryTotals"
            :key="ct.id"
            class="sum-hint"
            :class="{ 'sum-mismatch': totalsMismatch }"
          >
            {{ ct.name }}期初余额 ¥{{ formatAmount(Math.abs(ct.initBalance)) }}
            {{ ct.initBalance > 0.005 ? '（贷）' : ct.initBalance < -0.005 ? '（借）' : '' }}
          </span>
        </template>
        <span v-if="totalsMismatch" class="incomplete-hint">
          {{ validateCategoryTotalsMatch(true) }}
        </span>
        <span v-if="keyword.trim()" class="sum-hint">（关键字筛选）</span>
      </div>

      <div class="pagination-bar">
        <span class="pagination-text">共 {{ displayTotal }} 条</span>
        <el-select v-model="pageSize" style="width: 96px" size="small" @change="onPageSizeChange">
          <el-option label="20条/页" :value="20" />
          <el-option label="50条/页" :value="50" />
          <el-option label="100条/页" :value="100" />
          <el-option label="200条/页" :value="200" />
        </el-select>
        <el-pagination
          v-model:current-page="page"
          :total="displayTotal"
          :page-size="pageSize"
          layout="prev, pager, next, jumper"
          :pager-count="7"
          @current-change="onPageChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="importDialogVisible"
      title="导入辅助期初"
      width="960px"
      top="6vh"
      class="spreadsheet-import-dialog init-balance-aux-import-dialog"
      @closed="resetImportDialog"
    >
      <div class="import-tips">
        <p>
          1. 请先
          <el-link type="primary" @click="downloadTemplate">下载导入模板</el-link>
          ，各辅助类别填写<strong>项目编码或名称</strong>（优先编码）及金额
        </p>
        <p>2. 同一科目下组合不可重复；导入后请点击「保存全部」或逐格失焦保存</p>
        <p>3. 年初借方/贷方只能填一侧{{ isMidYear ? '；年中开账可填帐前借方/贷方' : '' }}</p>
        <p>4. 若仅填名称且系统中尚无对应核算项目，可勾选下方「联动创建缺失核算项目」</p>
      </div>
      <el-checkbox v-model="autoCreateMissing" class="import-auto-create">
        联动创建缺失核算项目（编码留空时按类别自动生成，规则同【核算项目】导入）
      </el-checkbox>
      <el-upload
        ref="importUploadRef"
        class="import-upload-compact"
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :disabled="importParsing"
        :on-change="onImportFileChange"
        :on-exceed="() => showError('只能上传一个文件')"
        drag
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或<em>点击上传</em></div>
      </el-upload>

      <div v-if="importParsing" class="import-parsing">
        <el-progress :percentage="importParseProgress" :stroke-width="16" />
        <p class="import-parsing__text">{{ importParseMessage }}</p>
      </div>

      <div v-if="importPreview.length > 0" class="import-preview">
        <div
          v-if="
            importPrecheck.missingItems.length > 0 ||
            importPrecheck.ambiguousCount > 0 ||
            importCategoryConsistency
          "
          class="import-precheck"
        >
          <p class="import-precheck-title">导入预检</p>
          <ul class="import-precheck-list">
            <li v-if="importPrecheck.readyCount > 0">
              ✓ {{ importPrecheck.readyCount }} 行已匹配到现有核算项目
            </li>
            <li
              v-if="importPrecheck.missingItemCount > 0"
              :class="{ 'precheck-warn': !autoCreateMissing }"
            >
              {{ autoCreateMissing ? '◆' : '⚠' }}
              {{ importPrecheck.missingItemCount }} 行缺少核算项目（{{
                importPrecheck.missingItems.length
              }}
              个名称）
              <template v-if="autoCreateMissing">，确认导入时将自动创建</template>
              <template v-else>，请勾选联动创建或先在【核算项目】中维护</template>
            </li>
            <li
              v-for="item in importPrecheck.missingItems.slice(0, 8)"
              :key="`${item.categoryId}-${item.name}`"
              class="precheck-detail"
            >
              · {{ item.categoryName }}：「{{ item.name }}」（{{ item.rowCount }} 行）
            </li>
            <li v-if="importPrecheck.missingItems.length > 8" class="precheck-detail">
              · 另有 {{ importPrecheck.missingItems.length - 8 }} 个待创建项目…
            </li>
            <li v-if="importPrecheck.ambiguousCount > 0" class="precheck-error">
              ✕ {{ importPrecheck.ambiguousCount }} 行名称/编码匹配不唯一，请补充编码
            </li>
            <li v-if="importPrecheck.otherIssueCount > 0" class="precheck-error">
              ✕ {{ importPrecheck.otherIssueCount }} 行存在其他校验问题
            </li>
            <li v-if="importCategoryConsistency" class="precheck-error">
              ✕ {{ importCategoryConsistency.message }}
            </li>
          </ul>
        </div>
        <SpreadsheetImportSummaryAlert
          :summary="importSummary"
          :issue-count="importIssueCount"
          @view-issues="openImportIssuesDialog"
        />
        <el-table
          :data="importPreview.slice(0, 15)"
          class="import-preview-table"
          stripe
          border
          size="small"
          max-height="180"
        >
          <el-table-column prop="rowIndex" label="行号" width="60" />
          <el-table-column label="辅助组合" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              {{
                Object.values(row.selection_labels || {}).join(' / ') ||
                Object.values(row.selection || {}).join(',')
              }}
            </template>
          </el-table-column>
          <el-table-column prop="opening_debit" label="年初借方" width="100" align="right">
            <template #default="{ row }">{{ formatAmount(row.opening_debit || 0) }}</template>
          </el-table-column>
          <el-table-column prop="opening_credit" label="年初贷方" width="100" align="right">
            <template #default="{ row }">{{ formatAmount(row.opening_credit || 0) }}</template>
          </el-table-column>
          <el-table-column
            v-if="showImportPreBookColumns"
            prop="pre_book_debit"
            label="帐前借方"
            width="100"
            align="right"
          >
            <template #default="{ row }">{{ formatAmount(row.pre_book_debit || 0) }}</template>
          </el-table-column>
          <el-table-column
            v-if="showImportPreBookColumns"
            prop="pre_book_credit"
            label="帐前贷方"
            width="100"
            align="right"
          >
            <template #default="{ row }">{{ formatAmount(row.pre_book_credit || 0) }}</template>
          </el-table-column>
          <el-table-column prop="matched" label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.matched ? 'success' : 'danger'" size="small">
                {{ row.matched ? '有效' : row.error || '无效' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="importPreview.length > 15" class="import-preview-more">
          预览仅显示前 15 行，共 {{ importPreview.length }} 行；异常明细请点「查看异常说明」
        </div>
      </div>

      <template #footer>
        <el-button @click="closeImportDialog">取消</el-button>
        <el-button
          v-if="importIssueCount > 0 || importCategoryConsistency"
          @click="openImportIssuesDialog"
        >
          查看异常说明
        </el-button>
        <el-button
          type="primary"
          :disabled="importMatchedCount === 0 || !!importCategoryConsistency"
          :loading="importing"
          @click="confirmImport"
        >
          确认导入（{{ importMatchedCount }} 行）
        </el-button>
      </template>
    </el-dialog>

    <SpreadsheetImportIssuesDialog
      v-model:visible="importIssuesDialogVisible"
      :issues="importIssues"
      :loading="importIssuesLoading"
      :total-count="importIssueCount > 0 ? importIssueCount : null"
      intro="以下行未能通过校验，不会写入表格。同类问题已合并展示；请按说明修正模板后重新上传。"
    />

    <el-dialog
      v-model="clearDialogVisible"
      title="批量清理辅助期初"
      width="480px"
      @open="loadClearPreview"
    >
      <el-alert type="warning" show-icon :closable="false" style="margin-bottom: 16px">
        清理后数据不可恢复，请确认导错后再操作。
      </el-alert>
      <el-radio-group v-model="clearScope" class="clear-mode-group" @change="loadClearPreview">
        <el-radio value="account">
          清空当前科目全部辅助期初
          <span class="clear-count">（{{ clearPreview.account }} 条）</span>
        </el-radio>
        <el-radio v-if="useCategoryTabs" value="category" :disabled="clearPreview.category === 0">
          清空当前标签页「{{ activeCategory?.name }}」辅助期初
          <span class="clear-count">（{{ clearPreview.category }} 条）</span>
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="clearDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="clearing"
          :disabled="currentAuxClearCount === 0"
          @click="confirmBatchClear"
        >
          确认清理（{{ currentAuxClearCount }} 条）
        </el-button>
      </template>
    </el-dialog>

    <TaskProgressDialog
      v-model="taskProgressVisible"
      :task-id="currentTaskId"
      :task-type="currentTaskType"
      @completed="handleTaskCompleted"
    />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="base:init-balance-aux"
      title="辅助期初余额"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  onMounted,
  onBeforeUnmount,
  onActivated,
  watch,
  nextTick,
} from 'vue'
import request from '@/api/request'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ArrowLeft, Upload, Search, Download, Printer } from '@element-plus/icons-vue'
import type { TableColumnCtx, UploadFile } from 'element-plus'
import {
  useInitBalanceAux,
  applyOpeningCreditChange,
  applyOpeningDebitChange,
  type AuxImportPreviewRow,
  type AuxItemOption,
  type InitBalanceAuxLine,
} from '@/composables/useInitBalanceAux'
import { formatAmount } from '@/utils/format'
import { showError, showSuccess, showOperationError } from '@/composables/useMessage'
import { useConfirm } from '@/composables/useConfirm'
import { useAsyncBatchTask } from '@/composables/useAsyncBatchTask'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import SpreadsheetImportSummaryAlert from '@/components/common/SpreadsheetImportSummaryAlert.vue'
import SpreadsheetImportIssuesDialog from '@/components/common/SpreadsheetImportIssuesDialog.vue'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useUserStore } from '@/stores/user'
import {
  buildAuxImportSummary,
  buildAuxImportPrecheck,
  buildAuxImportCategoryConsistencyIssue,
  buildMissingAuxItemDrafts,
  aggregateAuxImportIssuesAsync,
  countAuxImportImportable,
  parseAuxImportRowsAsync,
  validateAuxImportCategoryConsistency,
  validateAuxImportTemplateHeaders,
  type AuxImportIssue,
  type AuxImportPrecheckSummary,
} from '@/utils/initBalanceAuxImport'
import {
  buildItemsByCategoryForAuxImport,
  remapAuxImportHeadersIfNeeded,
} from '@/utils/initBalanceAuxImportLookup'
import { yieldToMain } from '@/utils/asyncChunk'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { accountSetName } = storeToRefs(userStore)
const hiprintVisible = ref(false)
const { taskProgressVisible, currentTaskId, currentTaskType, resetTaskDialog } = useAsyncBatchTask()

const {
  loading,
  loadProgress,
  saving,
  locked,
  lockReason,
  currentAccount,
  categories,
  itemsByCategory,
  gridRows,
  displayRows,
  displayTotal,
  keyword,
  showZeroValue,
  page,
  pageSize,
  sortField,
  sortOrder,
  useCategoryTabs,
  activeCategoryId,
  isMidYear,
  combinationStore,
  codeByCategoryId,
  loadDetails,
  removeLineByKey,
  categoryTabLabels,
  categoryTotalsList,
  validateCategoryTotalsMatch,
  save,
  saveLine,
  lineTotals,
  activeCategoryTotals,
  downloadTemplate,
  exportData,
  applyImportPreview,
  createMissingAuxItemsFromDrafts,
  previewBatchClear,
  batchClearAsync,
} = useInitBalanceAux()

const loadProgressPercent = computed(() => {
  const { loaded, total } = loadProgress.value
  if (!total) return 0
  return Math.min(100, Math.round((loaded / total) * 100))
})

function rowIndex(index: number) {
  return (page.value - 1) * pageSize.value + index + 1
}

function onPageChange(p: number) {
  page.value = p
}

function onPageSizeChange() {
  page.value = 1
}

function handleSortChange({ prop, order }: { prop: string; order: string | null }) {
  if (!order) {
    sortField.value = 'code'
    sortOrder.value = 'ascending'
  } else {
    sortField.value = prop
    sortOrder.value = order as 'ascending' | 'descending'
  }
}

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 10 }, (_, i) => currentYear - i)
const year = ref(currentYear)

const EMPTY_IMPORT_PRECHECK: AuxImportPrecheckSummary = {
  readyCount: 0,
  missingItemCount: 0,
  missingItems: [],
  ambiguousCount: 0,
  otherIssueCount: 0,
}

const importDialogVisible = ref(false)
const importIssuesDialogVisible = ref(false)
const importPreview = shallowRef<AuxImportPreviewRow[]>([])
const importRawData = shallowRef<Record<string, unknown>[]>([])
const importParsing = ref(false)
const importParseProgress = ref(0)
const importParseMessage = ref('')
const importBlankSkipped = ref(0)
const importTemplateWarning = ref<string | null>(null)
const importUploadRef = ref<any>(null)
const importing = ref(false)
const autoCreateMissing = ref(false)
const importMatchedCount = ref(0)
const importPrecheck = ref<AuxImportPrecheckSummary>({ ...EMPTY_IMPORT_PRECHECK })
const importIssues = ref<AuxImportIssue[]>([])
const importIssuesLoading = ref(false)
const importIssuesBuildToken = ref(0)
const importItemsByCategory = shallowRef<
  Record<string, import('@/utils/initBalanceAuxImport').AuxImportItemLike[]>
>({})
const clearDialogVisible = ref(false)
const clearing = ref(false)
const clearScope = ref<'account' | 'category'>('account')
const clearPreview = ref({ account: 0, category: 0 })

const accountId = computed(() => String(route.query.account_id || ''))
const totals = computed(() => lineTotals())
const importIssueCount = computed(() => importPreview.value.length - importMatchedCount.value)
const importCategoryConsistency = computed(() => {
  if (categories.value.length <= 1 || importMatchedCount.value === 0) return null
  return validateAuxImportCategoryConsistency({
    categories: categories.value,
    importRows: importPreview.value,
    existingStore: combinationStore.value,
    codeByCategoryId: codeByCategoryId.value,
    autoCreateMissing: autoCreateMissing.value,
  })
})
const importSummary = computed(() =>
  buildAuxImportSummary({
    contentRowCount: importPreview.value.length,
    validCount: importMatchedCount.value,
    issueCount: importIssueCount.value,
    blankSkipped: importBlankSkipped.value,
    templateWarning: importTemplateWarning.value,
    pendingCreateCount: autoCreateMissing.value ? importPrecheck.value.missingItemCount : 0,
    categoryConsistencyMessage: importCategoryConsistency.value?.message || null,
  })
)
const showImportPreBookColumns = computed(
  () =>
    isMidYear.value ||
    importPreview.value.some(
      r => Math.abs(r.pre_book_debit || 0) > 0.000001 || Math.abs(r.pre_book_credit || 0) > 0.000001
    )
)
const categoryTotals = computed(() => categoryTotalsList())
const totalsMismatch = computed(() => !!validateCategoryTotalsMatch(true))

const currentAuxClearCount = computed(() =>
  clearScope.value === 'category' ? clearPreview.value.category : clearPreview.value.account
)

function openClearDialog() {
  clearScope.value = 'account'
  clearDialogVisible.value = true
}

async function loadClearPreview() {
  if (!accountId.value) return
  try {
    const [accountCount, categoryCount] = await Promise.all([
      previewBatchClear('account'),
      useCategoryTabs.value && activeCategoryId.value
        ? previewBatchClear('category', activeCategoryId.value)
        : Promise.resolve(0),
    ])
    clearPreview.value = {
      account: accountCount,
      category: categoryCount,
    }
  } catch (error) {
    showOperationError('获取清理预览', error)
  }
}

async function confirmBatchClear() {
  const count = currentAuxClearCount.value
  if (count <= 0) {
    showError('没有可清理的数据')
    return
  }

  const scopeLabel =
    clearScope.value === 'category'
      ? `当前标签页「${activeCategory.value?.name || ''}」`
      : '当前科目全部'

  const confirmed = await useConfirm({
    title: '批量清理确认',
    message: `确定要清理 ${year.value} 年${scopeLabel}辅助期初吗？共 ${count} 条记录，此操作不可恢复。`,
    type: 'warning',
    confirmButtonText: '确认清理',
    cancelButtonText: '取消',
  })
  if (!confirmed) return

  clearing.value = true
  try {
    const taskId = await batchClearAsync(
      clearScope.value,
      clearScope.value === 'category' ? activeCategoryId.value : undefined
    )
    if (taskId) {
      currentTaskType.value = 'aux-init-clear'
      currentTaskId.value = taskId
      taskProgressVisible.value = true
      clearDialogVisible.value = false
    }
  } finally {
    clearing.value = false
  }
}

async function handleTaskCompleted() {
  const taskId = currentTaskId.value
  const taskType = currentTaskType.value
  if (taskType === 'aux-init-save' && taskId) {
    try {
      const res = (await request.get(`/tasks/${taskId}`)) as any
      if (res.data?.status === 'completed') {
        resetTaskDialog()
        showSuccess(res.data?.message || '辅助期初保存成功')
        goBack()
        return
      }
    } catch {
      /* 失败时留在当前页，用户可查看进度弹窗中的错误信息 */
    }
  }
  if (accountId.value) {
    await loadDetails(accountId.value, year.value)
  }
}

async function dismissStaleTaskDialogIfNeeded() {
  if (!taskProgressVisible.value || !currentTaskId.value) return
  try {
    const res = (await request.get(`/tasks/${currentTaskId.value}`, {
      skipErrorToast: true,
    })) as any
    const status = res.data?.status
    if (status === 'completed' || status === 'failed') {
      resetTaskDialog()
    }
  } catch {
    resetTaskDialog()
  }
}

const activeCategory = computed(
  () => categories.value.find(c => c.id === activeCategoryId.value) || categories.value[0] || null
)

type BalanceInfo = { dir: '借' | '贷'; amount: number }
type EnrichedAuxRow = InitBalanceAuxLine & {
  itemCode: string
  itemName: string
  balanceInfo: BalanceInfo | null
}

const activeCategoryItemMap = computed(() => {
  const catId = activeCategory.value?.id
  if (!catId) return new Map<string, any>()
  return new Map((itemsByCategory.value[catId] || []).map(item => [item.id, item]))
})

const enrichedDisplayRows = computed<EnrichedAuxRow[]>(() => {
  const catId = activeCategory.value?.id
  if (!catId) return []
  const itemMap = activeCategoryItemMap.value
  return displayRows.value.map(row => {
    const item = itemMap.get(row.selection[catId])
    return {
      ...row,
      itemCode: row.display_code || item?.code || '—',
      itemName: row.display_name || item?.name || '—',
      balanceInfo: balanceOf(row),
    }
  })
})

// ===================== 打印（HiprintDialog 预览）=====================
function printPage() {
  if (enrichedDisplayRows.value.length === 0) {
    showError('没有可打印的数据')
    return
  }
  hiprintVisible.value = true
}

function buildPrintHtml(): string {
  const acc = currentAccount.value
  const rows = enrichedDisplayRows.value
  type PrintCol = { label: string; align: 'left' | 'center' | 'right'; render: (r: any) => string }
  const columns: PrintCol[] = [
    { label: '序', align: 'center', render: (r, i) => String(i + 1) },
    { label: '编码', align: 'left', render: r => r.itemCode || '' },
    { label: '名称', align: 'left', render: r => r.itemName || '' },
    {
      label: '年初借',
      align: 'right',
      render: r => (r.opening_debit ? formatAmount(r.opening_debit) : ''),
    },
    {
      label: '年初贷',
      align: 'right',
      render: r => (r.opening_credit ? formatAmount(r.opening_credit) : ''),
    },
  ]
  if (isMidYear.value) {
    columns.push(
      {
        label: '账前借',
        align: 'right',
        render: r => (r.pre_book_debit ? formatAmount(r.pre_book_debit) : ''),
      },
      {
        label: '账前贷',
        align: 'right',
        render: r => (r.pre_book_credit ? formatAmount(r.pre_book_credit) : ''),
      }
    )
  }
  columns.push(
    { label: '余向', align: 'center', render: r => r.balanceInfo?.dir || '' },
    {
      label: '余额',
      align: 'right',
      render: r => (r.balanceInfo ? formatAmount(r.balanceInfo.amount) : ''),
    }
  )

  const t = activeCategoryTotals.value
  const net = t
    ? (t.opening_debit || 0) +
      (t.pre_book_debit || 0) -
      (t.opening_credit || 0) -
      (t.pre_book_credit || 0)
    : 0
  const footer: string[] = [
    '合计',
    '',
    '',
    t ? formatAmount(t.opening_debit || 0) : '',
    t ? formatAmount(t.opening_credit || 0) : '',
    ...(isMidYear.value
      ? [
          t ? formatAmount(t.pre_book_debit || 0) : '',
          t ? formatAmount(t.pre_book_credit || 0) : '',
        ]
      : []),
    Math.abs(net) < 0.005 ? '平' : net > 0 ? '借' : '贷',
    Math.abs(net) < 0.005 ? '' : formatAmount(Math.abs(net)),
  ]

  return buildTablePrintHtml<any>({
    title: acc ? `辅助期初 — ${acc.code} ${acc.name}` : '辅助期初余额',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${year.value}年${isMidYear.value ? ' · 年中开账' : ''}`,
    rows,
    monochrome: true,
    fitToPage: true,
    columns,
    footer,
  })
}

type AmountField = 'opening_debit' | 'opening_credit' | 'pre_book_debit' | 'pre_book_credit'
const AMOUNT_FIELDS: AmountField[] = [
  'opening_debit',
  'opening_credit',
  'pre_book_debit',
  'pre_book_credit',
]

interface EditingCell {
  rowKey: string
  field: AmountField
}

const editingCell = ref<EditingCell | null>(null)
const editValue = ref('')
const unsavedSet = ref<Set<string>>(new Set())
const editInputRefs = ref<Record<string, HTMLInputElement | null>>({})
const savingCell = ref(false)
const tableRef = ref<any>(null)
const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })
const currentRow = ref<InitBalanceAuxLine | null>(null)
const activeField = ref<AmountField>('opening_debit')
const isKeyboardNavigating = ref(false)
let pageActive = true
let lastLoadedKey = ''

function balanceOf(row: InitBalanceAuxLine): BalanceInfo | null {
  const net =
    (row.opening_debit || 0) +
    (row.pre_book_debit || 0) -
    (row.opening_credit || 0) -
    (row.pre_book_credit || 0)
  const abs = Math.abs(net)
  if (abs < 0.005) return null
  return { dir: net > 0 ? '借' : '贷', amount: abs }
}

const summaryBalanceDir = computed<'借' | '贷' | '平'>(() => {
  const t = activeCategoryTotals.value
  const net =
    (t.opening_debit || 0) +
    (t.pre_book_debit || 0) -
    (t.opening_credit || 0) -
    (t.pre_book_credit || 0)
  const absNet = Math.abs(net)
  if (absNet < 0.005) return '平'
  return net > 0 ? '借' : '贷'
})

const summaryBalanceClass = computed(() => {
  const dir = summaryBalanceDir.value
  if (dir === '平') return ''
  return dir === '借' ? 'summary-balance-debit' : 'summary-balance-credit'
})

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns } = param
  const t = activeCategoryTotals.value
  const balanceDir = summaryBalanceDir.value

  const totalOpeningDebit = t.opening_debit || 0
  const totalOpeningCredit = t.opening_credit || 0
  const totalPreBookDebit = t.pre_book_debit || 0
  const totalPreBookCredit = t.pre_book_credit || 0
  const net = totalOpeningDebit + totalPreBookDebit - totalOpeningCredit - totalPreBookCredit
  const absNet = Math.abs(net)

  const sums: string[] = []
  columns.forEach((column, index) => {
    if (column.label === '序' || index === 0) {
      sums[index] = '合计'
      return
    }
    switch (column.label) {
      case '年初借':
        sums[index] = formatAmount(totalOpeningDebit)
        break
      case '年初贷':
        sums[index] = formatAmount(totalOpeningCredit)
        break
      case '账前借':
        sums[index] = formatAmount(totalPreBookDebit)
        break
      case '账前贷':
        sums[index] = formatAmount(totalPreBookCredit)
        break
      case '余向':
        sums[index] = balanceDir
        break
      case '余额':
        sums[index] = absNet < 0.005 ? '' : `¥${formatAmount(absNet)}`
        break
      default:
        sums[index] = ''
    }
  })
  return sums
}

function getVisibleFields(): AmountField[] {
  if (isMidYear.value) return AMOUNT_FIELDS
  return ['opening_debit', 'opening_credit']
}

function setEditInputRef(rowKey: string, field: string, el: any) {
  const key = rowKey + '_' + field
  if (el) editInputRefs.value[key] = el as HTMLInputElement
  else delete editInputRefs.value[key]
}

function findRowByKey(rowKey: string) {
  return displayRows.value.find(r => r.key === rowKey) || gridRows.value.find(r => r.key === rowKey)
}

function focusEditInput(rowKey: string, field: AmountField, attempt = 0) {
  const key = rowKey + '_' + field
  const inp = editInputRefs.value[key]
  if (inp) {
    inp.focus()
    inp.select()
    inp.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    return
  }
  if (attempt < 5) {
    nextTick(() => focusEditInput(rowKey, field, attempt + 1))
  }
}

function handleCurrentRowChange(row: InitBalanceAuxLine | null) {
  currentRow.value = row
}

function startEdit(row: InitBalanceAuxLine, field: AmountField) {
  if (locked.value || savingCell.value) return
  activeField.value = field
  currentRow.value = row
  tableRef.value?.setCurrentRow(row)
  editingCell.value = { rowKey: row.key, field }
  editValue.value = String(row[field] || 0)
  nextTick(() => focusEditInput(row.key, field))
}

function cancelEdit() {
  editingCell.value = null
  editValue.value = ''
}

function applyOpeningExclusive(row: InitBalanceAuxLine, field: AmountField, numVal: number) {
  if (field === 'opening_debit') applyOpeningDebitChange(row, numVal)
  else if (field === 'opening_credit') applyOpeningCreditChange(row, numVal)
  else row[field] = numVal
}

function onEditInputBlur(row: InitBalanceAuxLine, field: AmountField) {
  if (isKeyboardNavigating.value) return
  if (
    !editingCell.value ||
    editingCell.value.rowKey !== row.key ||
    editingCell.value.field !== field
  ) {
    return
  }
  commitEdit()
}

async function persistEdit(row: InitBalanceAuxLine, field: AmountField) {
  savingCell.value = true
  const ok = await saveLine(row)
  savingCell.value = false
  if (ok === null) return
  if (ok) {
    unsavedSet.value.delete(row.key + '_' + field)
  } else {
    unsavedSet.value.add(row.key + '_' + field)
  }
}

function commitEdit() {
  if (!editingCell.value) return
  const { rowKey, field } = editingCell.value
  const row = findRowByKey(rowKey)
  if (!row) {
    editingCell.value = null
    editValue.value = ''
    return
  }

  const val = parseFloat(editValue.value)
  const numVal = isNaN(val) ? 0 : Math.round(val * 100) / 100
  const prev = row[field] || 0

  editingCell.value = null
  editValue.value = ''

  if (prev === numVal) return

  applyOpeningExclusive(row, field, numVal)
  void persistEdit(row, field)
}

function navigateByKeyboard(
  row: InitBalanceAuxLine,
  field: AmountField,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  isKeyboardNavigating.value = true
  commitEdit()
  navigateFromCell(row, field, direction)
  nextTick(() => {
    isKeyboardNavigating.value = false
  })
}

function handleCellKeydown(e: KeyboardEvent, row: InitBalanceAuxLine, field: AmountField) {
  if (e.key === 'Enter') {
    e.preventDefault()
    navigateByKeyboard(row, field, 'down')
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    navigateByKeyboard(row, field, e.shiftKey ? 'left' : 'right')
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    navigateByKeyboard(row, field, 'up')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    navigateByKeyboard(row, field, 'down')
    return
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    navigateByKeyboard(row, field, 'left')
    return
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault()
    navigateByKeyboard(row, field, 'right')
    return
  }
}

function scrollCurrentRowIntoView() {
  nextTick(() => {
    tableRef.value?.$el
      ?.querySelector('.el-table__row.current-row')
      ?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  })
}

function resolveNavigationAnchor(): { row: InitBalanceAuxLine; field: AmountField } | null {
  const rows = displayRows.value
  if (rows.length === 0 || locked.value) return null

  const visibleFields = getVisibleFields()
  const field = (
    activeField.value && visibleFields.includes(activeField.value)
      ? activeField.value
      : visibleFields[0]
  ) as AmountField

  if (currentRow.value) {
    const found = rows.find(r => r.key === currentRow.value!.key)
    if (found) return { row: found, field }
  }

  return { row: rows[0], field }
}

function navigateToCell(row: InitBalanceAuxLine, field: AmountField) {
  if (!row) return
  if (!locked.value) {
    if (editingCell.value) {
      isKeyboardNavigating.value = true
      commitEdit()
    }
    startEdit(row, field)
    if (editingCell.value) {
      nextTick(() => {
        isKeyboardNavigating.value = false
      })
    }
    return
  }
  activeField.value = field
  currentRow.value = row
  tableRef.value?.setCurrentRow(row)
  if (editingCell.value) commitEdit()
  scrollCurrentRowIntoView()
}

function navigateFromCell(
  row: InitBalanceAuxLine,
  field: AmountField,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  const visibleFields = getVisibleFields()
  const rows = displayRows.value
  if (rows.length === 0) return

  let rowIdx = rows.findIndex(r => r.key === row.key)
  let fieldIdx = visibleFields.indexOf(field)
  if (fieldIdx < 0) fieldIdx = 0
  if (rowIdx < 0) {
    navigateToCell(rows[0], visibleFields[fieldIdx])
    return
  }

  let nextRowIdx = rowIdx
  let nextFieldIdx = fieldIdx

  switch (direction) {
    case 'up':
      nextRowIdx = Math.max(0, rowIdx - 1)
      break
    case 'down':
      nextRowIdx = Math.min(rows.length - 1, rowIdx + 1)
      break
    case 'left':
      if (fieldIdx > 0) {
        nextFieldIdx = fieldIdx - 1
      } else {
        nextRowIdx = Math.max(0, rowIdx - 1)
        nextFieldIdx = visibleFields.length - 1
      }
      break
    case 'right':
      if (fieldIdx < visibleFields.length - 1) {
        nextFieldIdx = fieldIdx + 1
      } else {
        nextRowIdx = Math.min(rows.length - 1, rowIdx + 1)
        nextFieldIdx = 0
      }
      break
  }

  navigateToCell(rows[nextRowIdx], visibleFields[nextFieldIdx])
}

function moveCursor(delta: number) {
  const rows = displayRows.value
  if (rows.length === 0 || locked.value) return

  const visibleFields = getVisibleFields()
  const field = (
    activeField.value && visibleFields.includes(activeField.value)
      ? activeField.value
      : visibleFields[0]
  ) as AmountField

  if (currentRow.value) {
    const idx = rows.findIndex(r => r.key === currentRow.value!.key)
    if (idx >= 0) {
      const nextIdx = Math.max(0, Math.min(rows.length - 1, idx + delta))
      navigateToCell(rows[nextIdx], field)
      return
    }
  }

  navigateToCell(rows[delta > 0 ? 0 : rows.length - 1], field)
}

function moveCursorHorizontal(delta: number) {
  const anchor = resolveNavigationAnchor()
  if (!anchor) return
  navigateFromCell(anchor.row, anchor.field, delta > 0 ? 'right' : 'left')
}

function handleKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  if (e.key === 'ArrowUp' && !e.ctrlKey) {
    e.preventDefault()
    moveCursor(-1)
    return
  }
  if (e.key === 'ArrowDown' && !e.ctrlKey) {
    e.preventDefault()
    moveCursor(1)
    return
  }
  if (e.key === 'ArrowLeft' && !e.ctrlKey) {
    e.preventDefault()
    moveCursorHorizontal(-1)
    return
  }
  if (e.key === 'ArrowRight' && !e.ctrlKey) {
    e.preventDefault()
    moveCursorHorizontal(1)
    return
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault()
    const anchor = resolveNavigationAnchor()
    if (anchor && !locked.value) startEdit(anchor.row, anchor.field)
  }
}

function goBack() {
  router.push({
    path: '/base/init-balance',
    query: year.value ? { year: String(year.value) } : undefined,
  })
}

async function refresh(force = false) {
  if (!pageActive || !userStore.token) return
  if (!accountId.value) {
    showError('缺少科目参数')
    goBack()
    return
  }
  const loadKey = `${accountId.value}:${year.value}`
  if (!force && loadKey === lastLoadedKey && combinationStore.value.size > 0) {
    return
  }
  try {
    await loadDetails(accountId.value, year.value)
    lastLoadedKey = loadKey
    await relayoutAfterData()
  } catch {
    // 加载失败时 loadDetails 已提示；切换账套/退出过程中忽略
  }
}

function onYearChange() {
  lastLoadedKey = ''
  router.replace({
    query: {
      account_id: accountId.value,
      year: String(year.value),
      ...(route.query.mid_year ? { mid_year: route.query.mid_year } : {}),
    },
  })
  refresh()
}

async function handleSaveAll() {
  const result = await save()
  if (!result) return
  if (result.taskId) {
    currentTaskType.value = 'aux-init-save'
    currentTaskId.value = result.taskId
    taskProgressVisible.value = true
    return
  }
  if (result.summary) goBack()
}

function resetImportDialog() {
  importPreview.value = []
  importRawData.value = []
  importBlankSkipped.value = 0
  importTemplateWarning.value = null
  importIssuesDialogVisible.value = false
  importIssues.value = []
  importIssuesLoading.value = false
  importIssuesBuildToken.value += 1
  importMatchedCount.value = 0
  importItemsByCategory.value = {}
  importPrecheck.value = { ...EMPTY_IMPORT_PRECHECK }
  importing.value = false
  importParsing.value = false
  importParseProgress.value = 0
  importParseMessage.value = ''
  autoCreateMissing.value = false
  importUploadRef.value?.clearFiles()
}

async function refreshImportIssuesAsync() {
  const token = ++importIssuesBuildToken.value
  importIssuesLoading.value = true
  importIssues.value = []
  try {
    await nextTick()
    await yieldToMain()
    const rowIssues = await aggregateAuxImportIssuesAsync(importPreview.value, categories.value)
    if (token !== importIssuesBuildToken.value) return
    if (importCategoryConsistency.value) {
      importIssues.value = [
        buildAuxImportCategoryConsistencyIssue(importCategoryConsistency.value),
        ...rowIssues,
      ]
    } else {
      importIssues.value = rowIssues
    }
  } finally {
    if (token === importIssuesBuildToken.value) {
      importIssuesLoading.value = false
    }
  }
}

async function openImportIssuesDialog() {
  importIssuesDialogVisible.value = true
  await refreshImportIssuesAsync()
}

function openImportDialog() {
  resetImportDialog()
  importDialogVisible.value = true
}

function closeImportDialog() {
  importDialogVisible.value = false
}

async function onImportFileChange(file: UploadFile) {
  if (!file.raw || importParsing.value) return
  importParsing.value = true
  importParseProgress.value = 0
  importParseMessage.value = '正在读取 Excel 文件…'
  try {
    await nextTick()
    await yieldToMain()
    const arrayBuffer = await file.raw.arrayBuffer()
    await yieldToMain()
    importParseMessage.value = '正在解析工作表（数据量大时请稍候）…'
    const { utils, read } = await import('xlsx')
    const workbook = read(arrayBuffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    await yieldToMain()
    importParseMessage.value = '正在转换行数据…'
    const rawData: Record<string, unknown>[] = utils.sheet_to_json(sheet, { defval: '' })
    if (rawData.length === 0) {
      showError('文件中没有数据，请确认已按模板填写')
      resetImportDialog()
      return
    }
    importRawData.value = remapAuxImportHeadersIfNeeded(rawData, categories.value)
    importTemplateWarning.value = validateAuxImportTemplateHeaders(
      rawData[0] as Record<string, unknown>,
      categories.value
    )
    await reparseImportPreview()
  } catch {
    showError('文件解析失败，请检查格式是否与模板一致')
    resetImportDialog()
  } finally {
    importParsing.value = false
    importParseMessage.value = ''
  }
}

async function reparseImportPreview() {
  if (importRawData.value.length === 0) return
  importParsing.value = true
  importParseProgress.value = 0
  importParseMessage.value = '正在校验导入数据…'
  try {
    await nextTick()
    importParseMessage.value = '正在对照核算项目（按编码批量匹配）…'
    const importItems = await buildItemsByCategoryForAuxImport(
      importRawData.value,
      categories.value,
      itemsByCategory.value,
      {
        onProgress: pct => {
          importParseProgress.value = Math.min(90, Math.floor(pct * 0.9))
        },
      }
    )
    importItemsByCategory.value = importItems
    importParseMessage.value = '正在校验导入数据…'
    const { rows, blankSkipped } = await parseAuxImportRowsAsync(
      importRawData.value,
      categories.value,
      importItems,
      {
        allowPendingCreate: autoCreateMissing.value,
        onProgress: pct => {
          importParseProgress.value = pct
        },
      }
    )
    importBlankSkipped.value = blankSkipped
    importPreview.value = rows
    importMatchedCount.value = countAuxImportImportable(rows, autoCreateMissing.value)
    importPrecheck.value = buildAuxImportPrecheck(rows)
    importIssues.value = []
    importIssuesBuildToken.value += 1
    if (rows.length === 0) {
      showError('未识别到有效数据行，请填写辅助项目编码/名称或金额')
      return
    }
    const issues = rows.length - importMatchedCount.value
    if (issues > 0 && importMatchedCount.value === 0) {
      void openImportIssuesDialog()
    }
  } finally {
    importParsing.value = false
    importParseMessage.value = ''
    importParseProgress.value = 0
  }
}

watch(autoCreateMissing, () => {
  if (importRawData.value.length > 0 && !importParsing.value) {
    void reparseImportPreview()
  }
})

async function confirmImport() {
  importing.value = true
  try {
    if (importCategoryConsistency.value) {
      await openImportIssuesDialog()
      showError(importCategoryConsistency.value.message)
      return
    }

    let preview = importPreview.value
    let importItems = importItemsByCategory.value
    const precheck = importPrecheck.value

    if (autoCreateMissing.value && precheck.missingItems.length > 0) {
      const drafts = buildMissingAuxItemDrafts(
        precheck.missingItems.map(m => ({ categoryId: m.categoryId, name: m.name })),
        itemsByCategory.value
      )
      await createMissingAuxItemsFromDrafts(drafts)
      importItems = await buildItemsByCategoryForAuxImport(
        importRawData.value,
        categories.value,
        itemsByCategory.value
      )
      importItemsByCategory.value = importItems
      const reparsed = await parseAuxImportRowsAsync(
        importRawData.value,
        categories.value,
        importItems,
        {
          allowPendingCreate: false,
        }
      )
      importPreview.value = reparsed.rows
      preview = reparsed.rows.filter(r => r.matched)
    } else {
      preview = preview.filter(r => r.matched)
    }

    if (preview.length === 0) {
      if (importIssueCount.value > 0) {
        await openImportIssuesDialog()
      }
      showError('没有可导入的有效行，请先查看异常说明并修正')
      return
    }

    const { imported, skipped } = applyImportPreview(
      preview,
      importItems as Record<string, AuxItemOption[]>
    )
    if (imported > 0) {
      const createdHint =
        autoCreateMissing.value && precheck.missingItems.length > 0
          ? `，已联动创建 ${precheck.missingItems.length} 个核算项目`
          : ''
      const tip =
        skipped > 0
          ? `已将 ${imported} 行载入表格，另有 ${skipped} 行未通过校验已跳过${createdHint}；请点击「保存全部」写入数据库`
          : `已将 ${imported} 行载入表格${createdHint}，请点击「保存全部」或逐格失焦后写入数据库`
      showSuccess(tip)
      closeImportDialog()
    }
  } catch (error) {
    showOperationError('导入辅助期初', error)
  } finally {
    importing.value = false
  }
}

onMounted(async () => {
  const qYear = Number(route.query.year)
  if (qYear) year.value = qYear
  if (!userStore.token) return
  if (!accountId.value) {
    showError('请先选择科目')
    goBack()
    return
  }
  await refresh()
  window.addEventListener('keydown', handleKeydown)
})

onActivated(async () => {
  pageActive = true
  if (!userStore.token || !accountId.value) return
  await dismissStaleTaskDialogIfNeeded()
  await refresh()
})

watch(taskProgressVisible, visible => {
  if (!visible) {
    currentTaskId.value = ''
  }
})

onBeforeUnmount(() => {
  pageActive = false
  window.removeEventListener('keydown', handleKeydown)
})

watch(
  () => route.query.account_id,
  async id => {
    if (!pageActive || !userStore.token) return
    if (id && String(id) !== accountId.value) {
      lastLoadedKey = ''
      await refresh(true)
    }
  }
)

watch(keyword, () => {
  page.value = 1
})
</script>

<style scoped>
.page {
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
  box-sizing: border-box;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 240px;
}
.header-left h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
}
.header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.search-input {
  width: 210px;
}
.zero-filter-checkbox {
  margin-left: 2px;
  white-space: nowrap;
  flex-shrink: 0;
}
.mid-year-hint {
  color: #e6a23c;
  font-size: 12px;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.load-progress-bar {
  margin-bottom: 10px;
  padding: 10px 12px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 6px;
  flex-shrink: 0;
}
.load-progress-bar__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.load-progress-bar__title {
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: var(--el-color-primary);
}
.load-progress-bar__count {
  font-size: 12px;
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
}
.load-progress-bar__tip {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.table-wrap .table-summary-scroll {
  flex: 1 1 0;
  min-height: 0;
}
.editable-cell {
  display: block;
  width: 100%;
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
  font-size: 12px;
}
.editable-cell:hover {
  background: #ecf5ff;
}
.editable-cell.cell-unsaved {
  color: #e6a23c;
}
.editable-cell.cell-active {
  border: 1px solid #409eff;
  background: #ecf5ff;
}
.cell-input {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  border: 1px solid #409eff;
  border-radius: 4px;
  text-align: right;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}
.text-muted {
  color: #c0c4cc;
}
.footer-bar {
  margin-top: 6px;
  padding: 4px 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}
.sum-hint {
  color: #606266;
  font-size: 12px;
  font-weight: 500;
}
.balance-debit {
  font-weight: 600;
  color: #409eff;
}
.balance-credit {
  font-weight: 600;
  color: #f56c6c;
}
.import-tips {
  margin-bottom: 8px;
  color: #606266;
  font-size: 12px;
  line-height: 1.45;
}
.import-tips p {
  margin: 0;
}
.import-preview {
  margin-top: 10px;
}
.category-tabs {
  margin-bottom: 6px;
  flex-shrink: 0;
}
.category-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.category-tabs :deep(.el-tabs__item) {
  height: 32px;
  line-height: 32px;
  font-size: var(--cw-text-base);
}
.aux-lines-table {
  margin-top: 6px;
  border-radius: 6px;
}
.import-preview-more {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.import-auto-create {
  display: block;
  margin: 4px 0 6px;
}
.import-upload-compact :deep(.el-upload-dragger) {
  padding: 10px 16px;
}
.import-upload-compact :deep(.el-icon--upload) {
  font-size: 32px;
  margin-bottom: 2px;
  color: var(--el-text-color-placeholder);
}
.import-upload-compact :deep(.el-upload__text) {
  font-size: var(--cw-text-base);
  line-height: 1.35;
}
.import-parsing {
  margin-top: 10px;
  padding: 8px 4px 0;
}
.import-parsing__text {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.import-precheck {
  margin-bottom: 8px;
  padding: 8px 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border: 1px solid var(--el-border-color-lighter);
}
.import-precheck-title {
  margin: 0 0 4px;
  font-weight: 600;
  font-size: 12px;
}
.import-precheck-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.45;
}
.import-preview-table :deep(.el-table__cell) {
  padding: 2px 0 !important;
}
.import-preview-table :deep(th.el-table__cell) {
  padding: 4px 0 !important;
}
.import-preview-table :deep(.el-table__row) {
  height: 28px;
}
.import-preview-table :deep(.cell) {
  min-height: 20px;
  line-height: 20px;
  padding: 0 6px !important;
  font-size: 12px;
}
.import-preview-table :deep(.el-tag) {
  height: 20px;
  padding: 0 5px;
  font-size: 12px;
}
.precheck-detail {
  color: var(--el-text-color-secondary);
  list-style: none;
  margin-left: -4px;
}
.precheck-warn {
  color: var(--el-color-warning);
}
.precheck-error {
  color: var(--el-color-danger);
}
.import-summary-alert :deep(.el-alert__content) {
  line-height: 1.55;
}
.import-summary-hint {
  margin: 6px 0 0;
  font-size: var(--cw-text-base);
  color: inherit;
  opacity: 0.92;
}
.import-summary-actions {
  margin: 8px 0 0;
}
.import-issues-intro {
  margin: 0 0 12px;
  font-size: var(--cw-text-base);
  color: #606266;
  line-height: 1.6;
}
.import-issues-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 420px;
  overflow-y: auto;
}
.import-issue-item {
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: #fef0f0;
  border: 1px solid #fde2e2;
}
.import-issue-item:last-child {
  margin-bottom: 0;
}
.import-issue-title {
  font-weight: 600;
  font-size: var(--cw-text-base);
  color: #c45656;
  margin-bottom: 4px;
}
.import-issue-detail {
  font-size: var(--cw-text-base);
  color: #606266;
  line-height: 1.55;
}
.clear-mode-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.clear-count {
  color: #909399;
  font-size: 12px;
}

.current-cat-name {
  font-weight: 500;
  color: #303133;
}
.incomplete-hint {
  color: #e6a23c;
  font-size: 12px;
}
.sum-mismatch {
  color: #f56c6c;
}
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding: 4px 0 0;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.pagination-text {
  color: #606266;
  font-size: 12px;
}

:deep(.aux-lines-table .el-table__cell) {
  padding: 2px 0 !important;
}

:deep(.aux-lines-table th.el-table__cell) {
  padding: 5px 0 !important;
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary);
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

:deep(.aux-lines-table .el-table__footer-wrapper td.el-table__cell) {
  background: var(--el-fill-color-light) !important;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.aux-lines-table.summary-balance-debit .el-table__footer-wrapper td.col-balance-dir .cell),
:deep(
  .aux-lines-table.summary-balance-debit .el-table__footer-wrapper td.col-balance-amount .cell
) {
  color: #409eff;
  font-weight: 600;
}

:deep(.aux-lines-table.summary-balance-credit .el-table__footer-wrapper td.col-balance-dir .cell),
:deep(
  .aux-lines-table.summary-balance-credit .el-table__footer-wrapper td.col-balance-amount .cell
) {
  color: #f56c6c;
  font-weight: 600;
}

:deep(.aux-lines-table .el-table__row) {
  height: 30px;
}

:deep(.aux-lines-table .cell) {
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.aux-lines-table .el-tag) {
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
}

:deep(.aux-lines-table .el-button--small) {
  height: 22px;
  padding: 0 4px;
}
</style>

<style>
.init-balance-aux-import-dialog.el-dialog .el-dialog__body {
  max-height: min(72vh, 620px);
  overflow-y: auto;
  padding-top: 12px;
  padding-bottom: 12px;
}

.init-balance-aux-import-dialog.el-dialog .import-auto-create .el-checkbox__label {
  font-size: 12px;
  line-height: 1.45;
}

.init-balance-aux-import-dialog.el-dialog .import-summary-alert {
  margin-bottom: 8px;
}

.init-balance-aux-import-dialog.el-dialog .import-summary-alert .el-alert {
  padding: 6px 12px;
}
</style>
