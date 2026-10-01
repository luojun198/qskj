<template>
  <div class="page">
    <div v-if="showVoucherAuditReturn" class="voucher-audit-return-zone">
      <button type="button" class="voucher-audit-return-btn" @click="returnToVoucherAudit">
        <span class="voucher-audit-return-btn__icon-wrap" aria-hidden="true">
          <el-icon class="voucher-audit-return-btn__icon"><Back /></el-icon>
        </span>
        <span class="voucher-audit-return-btn__content">
          <span class="voucher-audit-return-btn__eyebrow">凭证记账未完成</span>
          <span class="voucher-audit-return-btn__title">返回凭证管理</span>
          <span class="voucher-audit-return-btn__desc">{{ voucherAuditReturnHint }}</span>
        </span>
        <span class="voucher-audit-return-btn__action">
          <span>立即返回</span>
          <el-icon><ArrowRight /></el-icon>
        </span>
      </button>
    </div>

    <div class="page-header">
      <div class="header-left">
        <el-select v-model="selectedYear" class="year-select" size="small" @change="onYearChange">
          <el-option
            v-for="y in years"
            :key="y"
            :label="y === bookStartYear ? `${y}年（建账年度）` : `${y}年`"
            :value="y"
          />
        </el-select>
        <el-tag v-if="isMidYear" type="warning" size="small" effect="plain">
          年中开账 · 第{{ startMonth }}期
        </el-tag>
        <el-tag v-if="bookStartYear && !isBookStartYear" type="info" size="small" effect="plain">
          建账年度 {{ bookStartYear }} 年 · 本年「年初」= {{ selectedYear - 1 }} 年年末结转
        </el-tag>
      </div>

      <div class="toolbar">
        <div class="toolbar-track">
          <div class="toolbar-nav">
            <el-button-group>
              <el-button plain size="small" title="全部收拢 (Ctrl+\)" @click="collapseAll">
                <el-icon><Fold /></el-icon>
                顶层
              </el-button>
              <el-button plain size="small" title="上一级 (Ctrl+↑)" @click="goUpLevel">
                <el-icon><Top /></el-icon>
                上级
              </el-button>
              <el-button plain size="small" title="下一级 (Ctrl+↓)" @click="goDownLevel">
                <el-icon><Bottom /></el-icon>
                下级
              </el-button>
              <el-button plain size="small" title="全部展开 (Ctrl+Shift+\)" @click="expandAll">
                <el-icon><Expand /></el-icon>
                底层
              </el-button>
            </el-button-group>
          </div>

          <div class="toolbar-actions">
            <el-input
              v-model="keyword"
              placeholder="科目编码 / 名称"
              class="search-input"
              size="small"
              clearable
              @input="onSearchInput"
              @clear="onSearchClear"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button
              :type="filterAuxOnly ? 'warning' : 'default'"
              :plain="!filterAuxOnly"
              size="small"
              @click="toggleAuxFilter"
            >
              <el-icon><Filter /></el-icon>
              辅助期初
            </el-button>
            <el-checkbox v-model="showZeroValue" size="small" class="zero-filter-checkbox">
              零值显示
            </el-checkbox>

            <el-divider direction="vertical" class="toolbar-divider" />

            <el-button type="info" plain size="small" @click="fetchData">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
            <el-button type="success" size="small" @click="checkBalance">
              <el-icon><CircleCheck /></el-icon>
              校验平衡
            </el-button>

            <el-divider direction="vertical" class="toolbar-divider" />

            <el-button plain size="small" :disabled="locked" @click="downloadTemplate">
              <el-icon><Download /></el-icon>
              模板
            </el-button>
            <el-button size="small" :disabled="locked" @click="openImportDialog">
              <el-icon><Upload /></el-icon>
              导入
            </el-button>
            <el-button type="danger" plain size="small" :disabled="locked" @click="openClearDialog">
              <el-icon><Delete /></el-icon>
              清理
            </el-button>

            <el-divider direction="vertical" class="toolbar-divider" />

            <el-button plain size="small" :disabled="list.length === 0" @click="exportData">
              <el-icon><Download /></el-icon>
              导出
            </el-button>

            <el-button plain size="small" :disabled="list.length === 0" @click="printPage">
              <el-icon><Printer /></el-icon>
              打印
            </el-button>

            <el-divider direction="vertical" class="toolbar-divider" />

            <el-button
              type="primary"
              size="small"
              :disabled="locked"
              :loading="saving"
              @click="saveAll"
            >
              <el-icon><DocumentChecked /></el-icon>
              保存全部
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <AccountScopeAlert :accounts-count="list.length" />

    <EmptyState
      v-if="isScopeBlocked && initDataLoaded"
      type="account"
      :description="scopeEmptyDescription"
      class="init-balance-scope-empty"
    />

    <template v-else>
      <div class="table-wrap">
        <div class="balance-check-bar">
          <div
            :class="[
              'balance-check-row',
              locked ? 'is-locked' : '',
              !locked && balanceCheck && balanceCheck.balanced && balanceCheck.auxCategoryConsistent
                ? 'is-ok'
                : '',
              !locked &&
              balanceCheck &&
              (!balanceCheck.balanced || !balanceCheck.auxCategoryConsistent)
                ? 'has-error'
                : '',
            ]"
          >
            <span
              v-if="locked"
              class="balance-check-segment balance-check-segment--lock"
              :title="lockReason"
            >
              <span class="balance-check-icon">⚠️</span>
              {{ lockReason }}
            </span>

            <span v-if="locked" class="balance-check-divider">|</span>

            <span class="balance-check-segment">
              <span class="balance-check-icon">{{
                balanceCheck ? (balanceCheck.balanced ? '✅' : '⚠️') : '📋'
              }}</span>
              借贷平衡：借 {{ formatMoney(balanceCheck?.totalDebit || 0) }} / 贷
              {{ formatMoney(balanceCheck?.totalCredit || 0) }}
              <template v-if="balanceCheck">
                — {{ balanceCheck.balanced ? '平衡' : '不平衡' }}
                <template v-if="!balanceCheck.balanced">
                  ，差额
                  {{
                    formatMoney(
                      Math.abs((balanceCheck.totalDebit || 0) - (balanceCheck.totalCredit || 0))
                    )
                  }}
                </template>
              </template>
              <template v-else> — 点击「校验平衡」</template>
            </span>

            <span class="balance-check-divider">|</span>

            <span class="balance-check-segment">
              <span class="balance-check-icon">{{
                balanceCheck ? (balanceCheck.auxCategoryConsistent ? '✅' : '⚠️') : '📋'
              }}</span>
              辅助类目：
              <template v-if="!balanceCheck">点击「校验平衡」</template>
              <template v-else-if="balanceCheck.auxCategoryConsistent"
                >各科目不同辅助类目合计一致</template
              >
              <el-tooltip
                v-else
                placement="bottom"
                :disabled="!balanceCheck.auxCategoryMismatches?.length"
              >
                <template #content>
                  <div v-for="item in balanceCheck.auxCategoryMismatches" :key="item.account_id">
                    {{ formatAuxMismatchSummary(item) }}
                  </div>
                </template>
                <span class="aux-mismatch-inline">
                  {{ balanceCheck.auxCategoryMismatches?.length || 0 }} 个科目不一致（悬停查看明细）
                </span>
              </el-tooltip>
            </span>
          </div>
        </div>

        <div
          ref="tableContainerRef"
          class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
        >
          <el-table
            ref="tableRef"
            :height="tableHeight"
            :data="displayData"
            :fit="false"
            stripe
            border
            size="small"
            highlight-current-row
            :row-style="{ height: '30px' }"
            :cell-style="{ padding: '0' }"
            :header-cell-style="{ padding: '4px 0' }"
            row-key="id"
            :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
            :expand-row-keys="expandedKeys"
            :class="['balance-table', 'compact-data-table', summaryBalanceClass]"
            show-summary
            :summary-method="getSummaries"
            @current-change="handleCurrentRowChange"
            @expand-change="handleExpandChange"
            @row-dblclick="handleRowDblClick"
          >
            <el-table-column prop="code" label="编码" width="124" fixed>
              <template #default="{ row }">
                <span
                  :style="{
                    paddingLeft: `${((row._depth || row.level || 1) - 1) * 14}px`,
                    display: 'inline-block',
                  }"
                  class="account-code"
                  >{{ row.code }}</span
                >
              </template>
            </el-table-column>
            <el-table-column prop="name" label="科目" fixed min-width="180">
              <template #default="{ row }">
                <span
                  :style="{
                    paddingLeft: `${((row._depth || row.level || 1) - 1) * 14}px`,
                    display: 'inline-block',
                  }"
                  class="account-name"
                  >{{ row.name }}</span
                >
              </template>
            </el-table-column>
            <el-table-column prop="direction" label="方向" width="60" align="center">
              <template #default="{ row }">
                <el-tag
                  :type="row.direction === 'debit' ? 'primary' : 'warning'"
                  size="small"
                  effect="plain"
                  >{{ row.direction === 'debit' ? '借' : '贷' }}</el-tag
                >
              </template>
            </el-table-column>

            <!-- 年初借方 -->
            <el-table-column
              label="年初借"
              width="122"
              align="right"
              class-name="col-opening-debit"
            >
              <template #default="{ row }">
                <template v-if="parentIdSet.has(row.id)">
                  <span class="computed-value" style="cursor: default">{{
                    formatAmount(row.opening_debit || 0)
                  }}</span>
                </template>
                <template v-else-if="isAuxLeafAccount(row)">
                  <span class="computed-value" :title="auxCellTitle(row)">{{
                    formatAmount(row.opening_debit || 0)
                  }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="editingCell?.rowId !== row.id || editingCell?.field !== 'opening_debit'"
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'opening_debit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'opening_debit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_opening_debit'),
                    }"
                    @click="!locked && startEdit(row, 'opening_debit')"
                    >{{ formatAmount(row.opening_debit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'opening_debit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'opening_debit')"
                    @keydown="handleCellKeydown($event, row, 'opening_debit')"
                  />
                </template>
              </template>
            </el-table-column>
            <!-- 年初贷方 -->
            <el-table-column
              label="年初贷"
              width="122"
              align="right"
              class-name="col-opening-credit"
            >
              <template #default="{ row }">
                <template v-if="parentIdSet.has(row.id)">
                  <span class="computed-value" style="cursor: default">{{
                    formatAmount(row.opening_credit || 0)
                  }}</span>
                </template>
                <template v-else-if="isAuxLeafAccount(row)">
                  <span class="computed-value" :title="auxCellTitle(row)">{{
                    formatAmount(row.opening_credit || 0)
                  }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="editingCell?.rowId !== row.id || editingCell?.field !== 'opening_credit'"
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'opening_credit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'opening_credit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_opening_credit'),
                    }"
                    @click="!locked && startEdit(row, 'opening_credit')"
                    >{{ formatAmount(row.opening_credit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'opening_credit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'opening_credit')"
                    @keydown="handleCellKeydown($event, row, 'opening_credit')"
                  />
                </template>
              </template>
            </el-table-column>

            <el-table-column
              v-if="enableForeignCurrency"
              label="原币年初"
              width="110"
              align="right"
            >
              <template #default="{ row }">
                <span v-if="row.is_foreign" class="computed-value" :title="row.currency_code || ''">
                  {{
                    formatAmount(
                      row.foreign_opening_debit ||
                        row.foreign_opening_credit ||
                        row.foreign_init_balance ||
                        0
                    )
                  }}
                </span>
              </template>
            </el-table-column>

            <!-- 期初数量：仅数量核算科目可录，与年初借/贷同一套行内编辑 -->
            <el-table-column
              v-if="showQuantityColumns"
              label="数量借"
              width="120"
              align="right"
            >
              <template #default="{ row }">
                <template v-if="!row.is_quantity" />
                <template v-else-if="parentIdSet.has(row.id) || isAuxLeafAccount(row)">
                  <span class="computed-value" style="cursor: default">{{
                    formatQuantity(row.qty_opening_debit || 0)
                  }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="
                      editingCell?.rowId !== row.id || editingCell?.field !== 'qty_opening_debit'
                    "
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'qty_opening_debit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'qty_opening_debit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_qty_opening_debit'),
                    }"
                    @click="!locked && startEdit(row, 'qty_opening_debit')"
                    >{{ formatQuantity(row.qty_opening_debit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'qty_opening_debit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'qty_opening_debit')"
                    @keydown="handleCellKeydown($event, row, 'qty_opening_debit')"
                  />
                </template>
              </template>
            </el-table-column>
            <el-table-column
              v-if="showQuantityColumns"
              label="数量贷"
              width="120"
              align="right"
            >
              <template #default="{ row }">
                <template v-if="!row.is_quantity" />
                <template v-else-if="parentIdSet.has(row.id) || isAuxLeafAccount(row)">
                  <span class="computed-value" style="cursor: default">{{
                    formatQuantity(row.qty_opening_credit || 0)
                  }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="
                      editingCell?.rowId !== row.id || editingCell?.field !== 'qty_opening_credit'
                    "
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'qty_opening_credit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'qty_opening_credit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_qty_opening_credit'),
                    }"
                    @click="!locked && startEdit(row, 'qty_opening_credit')"
                    >{{ formatQuantity(row.qty_opening_credit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'qty_opening_credit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'qty_opening_credit')"
                    @keydown="handleCellKeydown($event, row, 'qty_opening_credit')"
                  />
                </template>
              </template>
            </el-table-column>

            <!-- 帐前发生额（年中开账时显示） -->
            <el-table-column
              v-if="isMidYear"
              label="账前借"
              width="122"
              align="right"
              class-name="col-pre-book-debit"
            >
              <template #default="{ row }">
                <template v-if="parentIdSet.has(row.id)">
                  <span class="computed-value" style="cursor: default">{{
                    formatAmount(row.pre_book_debit || 0)
                  }}</span>
                </template>
                <template v-else-if="isAuxLeafAccount(row)">
                  <span class="computed-value">{{ formatAmount(row.pre_book_debit || 0) }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="editingCell?.rowId !== row.id || editingCell?.field !== 'pre_book_debit'"
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'pre_book_debit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'pre_book_debit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_pre_book_debit'),
                    }"
                    @click="!locked && startEdit(row, 'pre_book_debit')"
                    >{{ formatAmount(row.pre_book_debit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'pre_book_debit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'pre_book_debit')"
                    @keydown="handleCellKeydown($event, row, 'pre_book_debit')"
                  />
                </template>
              </template>
            </el-table-column>
            <el-table-column
              v-if="isMidYear"
              label="账前贷"
              width="122"
              align="right"
              class-name="col-pre-book-credit"
            >
              <template #default="{ row }">
                <template v-if="parentIdSet.has(row.id)">
                  <span class="computed-value" style="cursor: default">{{
                    formatAmount(row.pre_book_credit || 0)
                  }}</span>
                </template>
                <template v-else-if="isAuxLeafAccount(row)">
                  <span class="computed-value">{{ formatAmount(row.pre_book_credit || 0) }}</span>
                </template>
                <template v-else>
                  <span
                    v-if="editingCell?.rowId !== row.id || editingCell?.field !== 'pre_book_credit'"
                    class="editable-cell"
                    :class="{
                      'cell-active':
                        currentRow?.id === row.id &&
                        activeField === 'pre_book_credit' &&
                        editingCell?.rowId !== row.id,
                      'cell-dirty': isCellDirty(row, 'pre_book_credit'),
                      'cell-unsaved': unsavedSet.has(row.id + '_pre_book_credit'),
                    }"
                    @click="!locked && startEdit(row, 'pre_book_credit')"
                    >{{ formatAmount(row.pre_book_credit || 0) }}</span
                  >
                  <input
                    v-else
                    :ref="el => setEditInputRef(row.id, 'pre_book_credit', el)"
                    v-model="editValue"
                    type="text"
                    class="cell-input"
                    inputmode="decimal"
                    @blur="onEditInputBlur(row, 'pre_book_credit')"
                    @keydown="handleCellKeydown($event, row, 'pre_book_credit')"
                  />
                </template>
              </template>
            </el-table-column>

            <!-- 期末余额 -->
            <el-table-column label="余向" width="54" align="center" class-name="col-balance-dir">
              <template #default="{ row }">
                <template v-if="getBalanceDisplay(row)">
                  <el-tag
                    :type="getBalanceDisplay(row)!.dir === '借' ? 'primary' : 'danger'"
                    size="small"
                    effect="dark"
                    >{{ getBalanceDisplay(row)!.dir }}</el-tag
                  >
                </template>
              </template>
            </el-table-column>
            <el-table-column label="余额" width="128" align="right" class-name="col-balance-amount">
              <template #default="{ row }">
                <template v-if="getBalanceDisplay(row)">
                  <span
                    :class="
                      getBalanceDisplay(row)!.dir === '借' ? 'balance-debit' : 'balance-credit'
                    "
                    >¥{{ formatAmount(getBalanceDisplay(row)!.amount) }}</span
                  >
                </template>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right" align="center">
              <template #default="{ row }">
                <el-button
                  v-if="isAuxLeafAccount(row)"
                  type="warning"
                  plain
                  size="small"
                  @click="openAuxDrawer(row)"
                >
                  <el-icon><Filter /></el-icon>
                  辅助期初
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </template>

    <!-- 导入对话框 -->
    <el-dialog
      v-model="importDialogVisible"
      title="导入期初余额"
      width="960px"
      class="spreadsheet-import-dialog"
      @closed="resetImportDialog"
    >
      <div class="import-tips">
        <p>
          1. 请先
          <el-link type="primary" @click="downloadTemplate">下载导入模板</el-link
          >，按模板格式填写数据
        </p>
        <p>2. 按<strong>科目编码或名称</strong>匹配（优先编码），已有数据将被覆盖</p>
        <p>3. 年初借方/贷方只能填一侧{{ isMidYear ? '；账前借方/贷方为年中开账时填写' : '' }}</p>
        <p>4. 已启用辅助核算的科目请进入「辅助期初」全页录入，本页 Excel 导入将自动跳过此类科目</p>
      </div>
      <el-upload
        ref="importUploadRef"
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
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx / .xls 格式</div>
        </template>
      </el-upload>

      <div v-if="importParsing" class="import-parsing">
        <el-progress :percentage="importParseProgress" :stroke-width="16" />
        <p class="import-parsing__text">{{ importParseMessage }}</p>
      </div>

      <div v-if="importPreview.length > 0" class="import-preview">
        <SpreadsheetImportSummaryAlert
          :summary="importSummary"
          :issue-count="importIssueCount"
          @view-issues="openImportIssuesDialog"
        />
        <el-table :data="importPreview.slice(0, 15)" stripe border size="small" max-height="280">
          <el-table-column prop="rowIndex" label="行号" width="60" />
          <el-table-column prop="code" label="科目编码" width="100" />
          <el-table-column prop="name" label="科目名称" min-width="140" />
          <el-table-column prop="opening_debit" label="年初借方" width="110" align="right">
            <template #default="{ row }">{{ formatAmount(row.opening_debit || 0) }}</template>
          </el-table-column>
          <el-table-column prop="opening_credit" label="年初贷方" width="110" align="right">
            <template #default="{ row }">{{ formatAmount(row.opening_credit || 0) }}</template>
          </el-table-column>
          <el-table-column
            v-if="showImportPreBookColumns"
            prop="pre_book_debit"
            label="帐前借方"
            width="110"
            align="right"
          >
            <template #default="{ row }">{{ formatAmount(row.pre_book_debit || 0) }}</template>
          </el-table-column>
          <el-table-column
            v-if="showImportPreBookColumns"
            prop="pre_book_credit"
            label="帐前贷方"
            width="110"
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
        <el-button v-if="importIssueCount > 0" @click="openImportIssuesDialog">
          查看异常说明
        </el-button>
        <el-button
          type="primary"
          :disabled="importMatched === 0"
          :loading="importing"
          @click="handleImport"
        >
          确认导入（{{ importMatched }} 条）
        </el-button>
      </template>
    </el-dialog>

    <SpreadsheetImportIssuesDialog
      v-model:visible="importIssuesDialogVisible"
      :issues="importIssues"
      :loading="importIssuesLoading"
      :total-count="importIssueCount > 0 ? importIssueCount : null"
      intro="以下行未能通过校验，不会写入期初余额。同类问题已合并展示；请按说明修正模板后重新上传。"
    />

    <el-dialog
      v-model="clearDialogVisible"
      title="批量清理期初"
      width="520px"
      @open="loadClearPreview"
    >
      <el-alert type="warning" show-icon :closable="false" style="margin-bottom: 16px">
        清理后数据不可恢复，请确认导错后再操作。已有已审核/已记账凭证的年度无法清理。
      </el-alert>
      <el-radio-group v-model="clearMode" class="clear-mode-group" @change="loadClearPreview">
        <el-radio value="direct_all">
          清空全部科目期初
          <span class="clear-count">（{{ clearPreview.directAll }} 条）</span>
        </el-radio>
        <el-radio value="aux_all">
          清空全部辅助期初明细
          <span class="clear-count">（{{ clearPreview.auxAll }} 条）</span>
        </el-radio>
        <el-radio value="direct_filtered" :disabled="filteredDirectClearCount === 0">
          清空当前筛选结果的科目期初
          <span class="clear-count">（{{ clearPreview.directFiltered }} 条）</span>
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="clearDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="clearing"
          :disabled="currentClearCount === 0"
          @click="confirmBatchClear"
        >
          确认清理（{{ currentClearCount }} 条）
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
      template-key="base:init-balance"
      title="期初余额"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  Upload,
  Download,
  Refresh,
  Search,
  Filter,
  Fold,
  Expand,
  Top,
  Bottom,
  CircleCheck,
  DocumentChecked,
  Delete,
  Back,
  ArrowRight,
  Printer,
} from '@element-plus/icons-vue'
import request from '@/api/request'
import { useAsyncBatchTask } from '@/composables/useAsyncBatchTask'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import EmptyState from '@/components/EmptyState.vue'
import SpreadsheetImportSummaryAlert from '@/components/common/SpreadsheetImportSummaryAlert.vue'
import SpreadsheetImportIssuesDialog from '@/components/common/SpreadsheetImportIssuesDialog.vue'
import {
  buildInitBalanceImportSummary,
  buildInitBalanceNameMap,
  collectInitBalanceImportIssues,
  describeInitBalanceRowIssue,
  parseInitBalanceImportRowsAsync,
  type InitBalanceImportRow,
} from '@/utils/initBalanceImport'
import { aggregateImportIssuesAsync } from '@/utils/spreadsheetImportReport'
import { yieldToMain } from '@/utils/asyncChunk'
import { useAccountScopeHint } from '@/composables/useAccountScopeHint'
import { showSuccess, showError, showOperationError } from '@/composables/useMessage'
import { useVoucherAuditReturnStore } from '@/stores/voucherAuditReturn'
import { useConfirm } from '@/composables/useConfirm'
import { formatAmount } from '@/utils/format'
import { formatAuxMismatchSummary } from '@/utils/balanceCheckAlert'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { normalizeOpeningDebitCredit } from '@/utils/initBalanceOpening'
import { normalizeImportCode } from '@/utils/textNormalize'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { buildInitBalanceExportColumns } from '@/utils/ledgerExportBuilders'
import type { TableColumnCtx, UploadFile } from 'element-plus'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { useUserStore } from '@/stores/user'
import { useSystemParamsStore } from '@/stores/systemParams'

const router = useRouter()
const route = useRoute()
const voucherAuditReturnStore = useVoucherAuditReturnStore()

const showVoucherAuditReturn = computed(
  () => route.query.from === 'voucher-audit' && Boolean(voucherAuditReturnStore.peek())
)

const voucherAuditReturnHint = computed(() => {
  const ctx = voucherAuditReturnStore.peek()
  if (!ctx) return '已保留筛选、分页与勾选状态'
  if (ctx.selectAllMode) return '已保留「全选所有页」的批量记账选择'
  if (ctx.selectedVoucherIds.length > 0) {
    return `已保留 ${ctx.selectedVoucherIds.length} 张凭证勾选，期初配平后可继续记账`
  }
  return '已保留筛选与分页条件，期初配平后可继续记账'
})

function returnToVoucherAudit() {
  router.push({ name: 'VoucherAudit', query: { restoreAudit: '1' } })
}

function applyInitBalanceEntryYear() {
  const qYear = Number(route.query.year)
  if (qYear) {
    selectedYear.value = qYear
    return
  }
  const ctx = voucherAuditReturnStore.peek()
  if (route.query.from === 'voucher-audit' && ctx?.targetYear) {
    selectedYear.value = ctx.targetYear
  }
}
const { taskProgressVisible, currentTaskId, currentTaskType, startAsyncTask } = useAsyncBatchTask()

const list = ref<any[]>([])
const initDataLoaded = ref(false)
const listCount = computed(() => list.value.length)
const { isBlocked: isScopeBlocked, emptyDescription: scopeEmptyDescription } = useAccountScopeHint({
  accountsCount: listCount,
})
const balanceCheck = ref<any>(null)
const isMidYear = ref(false)
const startMonth = ref(1)
const systemParamsStore = useSystemParamsStore()
const enableForeignCurrency = computed(() => systemParamsStore.enableForeignCurrency)
const saving = ref(false)
const locked = ref(false)
const lockReason = ref('')
const keyword = ref('')
const filterAuxOnly = ref(false)
/** 勾选后显示全零科目；默认不勾选，仅显示有期初/账前金额的科目 */
const showZeroValue = ref(true)
const tableRef = ref<any>(null)
const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })

const expandedSet = ref<Set<string>>(new Set())
const expandedKeys = computed(() => [...expandedSet.value].map(String))
const currentRow = ref<any>(null)
const activeField = ref<BalanceField>('opening_debit')

// 年度选择
const currentYear = new Date().getFullYear()
const selectedYear = ref(currentYear)
/** 建账年度：来自账套建账日期，0 表示未取到 */
const bookStartYear = computed(() => systemParamsStore.startYear)
const isBookStartYear = computed(
  () => bookStartYear.value > 0 && selectedYear.value === bookStartYear.value
)
/**
 * 年度下拉：下限取建账年度（取不到时回退近 10 年），上限取系统年度与当前会计年度的较大者。
 * 原实现固定为「今年往前 10 年」，早于 10 年前建账的账套（如 2016 年建账）选不到建账年度，
 * 只能看到之后年度的年初余额（即上年年末结转），容易误以为期初数不对。
 */
const years = computed(() => {
  const start = bookStartYear.value
  const maxYear = Math.max(currentYear, systemParamsStore.currentYear, selectedYear.value, start)
  const minYear = start > 0 ? Math.min(start, maxYear) : maxYear - 9
  const arr: number[] = []
  for (let y = maxYear; y >= minYear; y--) arr.push(y)
  return arr
})

// 导入相关
const importDialogVisible = ref(false)
const importPreview = ref<InitBalanceImportRow[]>([])
const importUploadRef = ref<any>(null)
const importing = ref(false)
const importIssuesDialogVisible = ref(false)
const importBlankSkipped = ref(0)
const importTemplateWarning = ref<string | null>(null)
const importParsing = ref(false)
const importParseProgress = ref(0)
const importParseMessage = ref('')
const importIssues = ref<ReturnType<typeof collectInitBalanceImportIssues>>([])
const importIssuesLoading = ref(false)
let importIssuesBuildToken = 0
const clearDialogVisible = ref(false)
const clearing = ref(false)
const clearMode = ref<'direct_all' | 'aux_all' | 'direct_filtered'>('direct_all')
const clearPreview = ref({ directAll: 0, auxAll: 0, directFiltered: 0 })
const importMatched = computed(() => importPreview.value.filter(r => r.matched).length)
const importIssueCount = computed(() => importPreview.value.filter(r => !r.matched).length)
const importSummary = computed(() =>
  buildInitBalanceImportSummary({
    contentRowCount: importPreview.value.length,
    validCount: importMatched.value,
    issueCount: importIssueCount.value,
    blankSkipped: importBlankSkipped.value,
    templateWarning: importTemplateWarning.value,
  })
)
const showImportPreBookColumns = computed(
  () =>
    isMidYear.value ||
    importPreview.value.some(
      r => Math.abs(r.pre_book_debit || 0) > 0.000001 || Math.abs(r.pre_book_credit || 0) > 0.000001
    )
)

function formatMoney(val: number) {
  return '¥' + formatAmount(val || 0)
}

// 计算期末余额
function calcBalance(row: any) {
  const od = row.opening_debit || 0
  const oc = row.opening_credit || 0
  const pd = row.pre_book_debit || 0
  const pc = row.pre_book_credit || 0
  return od - oc + (pd - pc)
}

function getBalanceDisplay(row: any): { dir: '借' | '贷'; amount: number } | null {
  const net =
    (row.opening_debit || 0) +
    (row.pre_book_debit || 0) -
    (row.opening_credit || 0) -
    (row.pre_book_credit || 0)
  const abs = Math.abs(net)
  if (abs < 0.005) return null
  return { dir: net > 0 ? '借' : '贷', amount: abs }
}

/** 合计行参与累加的科目：树形取顶层（已含下级汇总），搜索列表取叶节点 */
function getSummaryRows(data: any[]): any[] {
  if (!data?.length) return []
  if (keyword.value) {
    return data.filter(row => !parentIdSet.value.has(row.id))
  }
  return data
}

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns, data } = param
  const summaryRows = getSummaryRows(data)

  let totalOpeningDebit = 0
  let totalOpeningCredit = 0
  let totalPreBookDebit = 0
  let totalPreBookCredit = 0
  for (const row of summaryRows) {
    totalOpeningDebit += row.opening_debit || 0
    totalOpeningCredit += row.opening_credit || 0
    totalPreBookDebit += row.pre_book_debit || 0
    totalPreBookCredit += row.pre_book_credit || 0
  }

  const net = totalOpeningDebit + totalPreBookDebit - totalOpeningCredit - totalPreBookCredit
  const absNet = Math.abs(net)
  const balanceDir = absNet < 0.005 ? '平' : net > 0 ? '借' : '贷'
  summaryBalanceDir.value = balanceDir

  const sums: string[] = []
  columns.forEach((column, index) => {
    if (index === 0) {
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

const summaryBalanceDir = ref<'借' | '贷' | '平' | null>(null)

const summaryBalanceClass = computed(() => {
  const dir = summaryBalanceDir.value
  if (!dir || dir === '平') return ''
  return dir === '借' ? 'summary-balance-debit' : 'summary-balance-credit'
})

// ===================== 行内编辑 =====================

type BalanceField =
  | 'opening_debit'
  | 'opening_credit'
  | 'pre_book_debit'
  | 'pre_book_credit'
  | 'qty_opening_debit'
  | 'qty_opening_credit'

/** 数量字段保留 6 位小数，金额字段保留 2 位 */
const QUANTITY_FIELDS: BalanceField[] = ['qty_opening_debit', 'qty_opening_credit']
function isQuantityField(field: BalanceField): boolean {
  return QUANTITY_FIELDS.includes(field)
}

/** 数量展示：6 位小数，0 显示空串（与库存数量金额表一致） */
function formatQuantity(value: number | null | undefined): string {
  const n = Number(value) || 0
  return n ? Math.abs(n).toFixed(6) : ''
}

interface EditingCell {
  rowId: string
  field: BalanceField
}

const FIELDS: BalanceField[] = [
  'opening_debit',
  'opening_credit',
  'qty_opening_debit',
  'qty_opening_credit',
  'pre_book_debit',
  'pre_book_credit',
]

/** 列表里存在数量核算科目时才显示数量两列 */
const showQuantityColumns = computed(() => list.value.some((row: any) => row.is_quantity))

const editingCell = ref<EditingCell | null>(null)
const editValue = ref('')
const unsavedSet = ref<Set<string>>(new Set())
const editInputRefs = ref<Record<string, HTMLInputElement | null>>({})
/** 方向键/Tab 切换单元格时抑制 blur 触发的 commit，避免刚进入编辑又被清掉 */
const isKeyboardNavigating = ref(false)

function setEditInputRef(rowId: string, field: string, el: any) {
  const key = rowId + '_' + field
  if (el) {
    editInputRefs.value[key] = el as HTMLInputElement
  } else {
    delete editInputRefs.value[key]
  }
}

function isCellDirty(row: any, field: BalanceField): boolean {
  const val = Number(editValue.value)
  return !isNaN(val) && val !== (row[field] || 0)
}

function focusEditInput(rowId: string, field: BalanceField, attempt = 0) {
  const key = rowId + '_' + field
  const inp = editInputRefs.value[key]
  if (inp) {
    inp.focus()
    inp.select()
    inp.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    return
  }
  if (attempt < 5) {
    nextTick(() => focusEditInput(rowId, field, attempt + 1))
  }
}

function onEditInputBlur(row: any, field: BalanceField) {
  if (isKeyboardNavigating.value) return
  if (
    !editingCell.value ||
    editingCell.value.rowId !== row.id ||
    editingCell.value.field !== field
  ) {
    return
  }
  commitEdit()
}

function startEdit(row: any, field: BalanceField) {
  if (locked.value || parentIdSet.value.has(row.id) || isAuxLeafAccount(row)) return
  activeField.value = field
  currentRow.value = row
  tableRef.value?.setCurrentRow(row)
  editingCell.value = { rowId: row.id, field }
  editValue.value = String(row[field] || 0)
  nextTick(() => focusEditInput(row.id, field))
}

function commitEdit() {
  if (!editingCell.value) return
  const { rowId, field } = editingCell.value
  const val = parseFloat(editValue.value)
  const numVal = isNaN(val)
    ? 0
    : isQuantityField(field)
      ? Math.round(val * 1e6) / 1e6
      : Math.round(val * 100) / 100

  const row = list.value.find(r => r.id === rowId)
  if (row) {
    const prevVal = row[field] || 0
    const fieldsToPersist: BalanceField[] = []

    if (field === 'opening_debit') {
      row.opening_debit = numVal
      if (numVal > 0.005 && (row.opening_credit || 0) > 0.005) {
        row.opening_credit = 0
        fieldsToPersist.push('opening_debit', 'opening_credit')
      } else if (prevVal !== numVal) {
        fieldsToPersist.push('opening_debit')
      }
    } else if (field === 'opening_credit') {
      row.opening_credit = numVal
      if (numVal > 0.005 && (row.opening_debit || 0) > 0.005) {
        row.opening_debit = 0
        fieldsToPersist.push('opening_credit', 'opening_debit')
      } else if (prevVal !== numVal) {
        fieldsToPersist.push('opening_credit')
      }
    } else if (field === 'qty_opening_debit') {
      row.qty_opening_debit = numVal
      if (Math.abs(numVal) > 1e-9 && Math.abs(row.qty_opening_credit || 0) > 1e-9) {
        row.qty_opening_credit = 0
        fieldsToPersist.push('qty_opening_debit', 'qty_opening_credit')
      } else if (prevVal !== numVal) {
        fieldsToPersist.push('qty_opening_debit')
      }
    } else if (field === 'qty_opening_credit') {
      row.qty_opening_credit = numVal
      if (Math.abs(numVal) > 1e-9 && Math.abs(row.qty_opening_debit || 0) > 1e-9) {
        row.qty_opening_debit = 0
        fieldsToPersist.push('qty_opening_credit', 'qty_opening_debit')
      } else if (prevVal !== numVal) {
        fieldsToPersist.push('qty_opening_credit')
      }
    } else if (prevVal !== numVal) {
      row[field] = numVal
      fieldsToPersist.push(field)
    }

    if (fieldsToPersist.length > 0) {
      row.balanceValue = calcBalance(row)
      const nextUnsaved = new Set(unsavedSet.value)
      for (const f of fieldsToPersist) {
        nextUnsaved.add(rowId + '_' + f)
      }
      unsavedSet.value = nextUnsaved
      recalcParentTotals()
      void persistRowCells(row, fieldsToPersist)
    }
  }

  editingCell.value = null
  editValue.value = ''
}

async function persistRowCells(row: any, fields: BalanceField[]) {
  const unique = [...new Set(fields)]
  for (const field of unique) {
    await saveCell(row, field)
  }
}

function cancelEdit() {
  editingCell.value = null
  editValue.value = ''
}

function getVisibleFields(): BalanceField[] {
  // 按 FIELDS 的列顺序过滤，保证方向键/Tab 的移动顺序与表格列顺序一致
  return FIELDS.filter(field => {
    if (isQuantityField(field)) return showQuantityColumns.value
    if (field === 'pre_book_debit' || field === 'pre_book_credit') return isMidYear.value
    return true
  })
}

function navigateByKeyboard(
  row: any,
  field: BalanceField,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  isKeyboardNavigating.value = true
  commitEdit()
  navigateFromCell(row, field, direction)
  nextTick(() => {
    isKeyboardNavigating.value = false
  })
}

function handleCellKeydown(e: KeyboardEvent, row: any, field: BalanceField) {
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

async function saveCell(row: any, field: BalanceField) {
  try {
    const opening = normalizeOpeningDebitCredit(row.opening_debit || 0, row.opening_credit || 0)
    row.opening_debit = opening.opening_debit
    row.opening_credit = opening.opening_credit
    await request.post('/base/init-balances', {
      account_id: row.id,
      direction: row.direction,
      year: selectedYear.value,
      opening_debit: opening.opening_debit,
      opening_credit: opening.opening_credit,
      pre_book_debit: row.pre_book_debit || 0,
      pre_book_credit: row.pre_book_credit || 0,
      qty_opening_debit: row.qty_opening_debit || 0,
      qty_opening_credit: row.qty_opening_credit || 0,
      qty_pre_book_debit: row.qty_pre_book_debit || 0,
      qty_pre_book_credit: row.qty_pre_book_credit || 0,
    })
    unsavedSet.value = new Set([...unsavedSet.value].filter(k => k !== row.id + '_' + field))
  } catch {
    // 静默失败，保留 unsaved 标记
  }
}

function getFlatNodes(): any[] {
  return flattenRows(treeData.value)
}

function recalcParentTotals() {
  const allNodes = getFlatNodes()
  const nodeMap = new Map<string, any>()
  for (const node of allNodes) {
    nodeMap.set(node.id, node)
  }

  function sumChildren(node: any) {
    if (!node.children || node.children.length === 0) {
      return
    }
    let od = 0,
      oc = 0,
      pd = 0,
      pc = 0,
      qod = 0,
      qoc = 0
    for (const child of node.children) {
      sumChildren(child)
      od += child.opening_debit || 0
      oc += child.opening_credit || 0
      pd += child.pre_book_debit || 0
      pc += child.pre_book_credit || 0
      qod += child.qty_opening_debit || 0
      qoc += child.qty_opening_credit || 0
    }
    node.opening_debit = od
    node.opening_credit = oc
    node.pre_book_debit = pd
    node.pre_book_credit = pc
    node.qty_opening_debit = qod
    node.qty_opening_credit = qoc
    node.balanceValue = calcBalance(node)

    const listItem = list.value.find(item => item.id === node.id)
    if (listItem) {
      listItem.opening_debit = od
      listItem.opening_credit = oc
      listItem.pre_book_debit = pd
      listItem.pre_book_credit = pc
      listItem.qty_opening_debit = qod
      listItem.qty_opening_credit = qoc
      listItem.balanceValue = node.balanceValue
    }
  }

  for (const root of treeData.value) {
    sumChildren(root)
  }
}

function onYearChange() {
  balanceCheck.value = null
  fetchData()
  checkCanEdit()
}

// ===================== 科目树形结构 =====================

function flattenRows(nodes: any[], result?: any[]): any[] {
  const arr = result ?? []
  for (const node of nodes) {
    arr.push(node)
    if (node.children?.length) flattenRows(node.children, arr)
  }
  return arr
}

function addDepth(nodes: any[], depth: number = 1): any[] {
  return nodes.map(node => ({
    ...node,
    _depth: depth,
    children: node.children?.length ? addDepth(node.children, depth + 1) : [],
  }))
}

const treeData = computed(() => {
  const map: Record<string, any> = {}
  const roots: any[] = []
  const seen = new Set<string>()
  for (const item of list.value) {
    if (!item.id || seen.has(item.id)) continue
    seen.add(item.id)
    map[item.id] = { ...item, children: [] }
  }
  const pushed = new Set<string>()
  for (const item of list.value) {
    if (!item.id || pushed.has(item.id)) continue
    if (!map[item.id]) continue
    pushed.add(item.id)
    if (item.parent_id && map[item.parent_id]) {
      map[item.parent_id].children.push(map[item.id])
    } else {
      roots.push(map[item.id])
    }
  }
  return addDepth(roots)
})

const parentIdSet = computed(() => {
  const set = new Set<string>()
  for (const item of list.value) {
    if (item.parent_id) set.add(item.parent_id)
  }
  return set
})

function isAuxLeafAccount(row: any) {
  return !!(row.aux_readonly || row.has_aux) && !parentIdSet.value.has(row.id)
}

function filterTreeForAux(nodes: any[]): any[] {
  const result: any[] = []
  for (const node of nodes) {
    const children = node.children?.length ? filterTreeForAux(node.children) : []
    if (isAuxLeafAccount(node) || children.length > 0) {
      result.push({ ...node, children })
    }
  }
  return result
}

function rowHasAmount(row: any): boolean {
  return (
    (row.opening_debit || 0) > 0.005 ||
    (row.opening_credit || 0) > 0.005 ||
    (row.pre_book_debit || 0) > 0.005 ||
    (row.pre_book_credit || 0) > 0.005
  )
}

function filterTreeHideZero(nodes: any[]): any[] {
  const result: any[] = []
  for (const node of nodes) {
    const children = node.children?.length ? filterTreeHideZero(node.children) : []
    if (rowHasAmount(node) || children.length > 0) {
      result.push({ ...node, children })
    }
  }
  return result
}

function toggleAuxFilter() {
  filterAuxOnly.value = !filterAuxOnly.value
  if (filterAuxOnly.value && !keyword.value) {
    nextTick(() => {
      const filtered = filterTreeForAux(treeData.value)
      const all = flattenRows(filtered)
      expandedSet.value = new Set(all.filter(r => r.children?.length).map(r => r.id))
    })
  }
}

function auxCellTitle(row: any) {
  const count = row.aux_detail_count || 0
  return count > 0
    ? `已由 ${count} 条辅助期初汇总，请点击「辅助期初」修改`
    : '请点击「辅助期初」录入'
}

function openAuxDrawer(row: any) {
  router.push({
    name: 'InitBalanceAux',
    query: {
      account_id: row.id,
      year: String(selectedYear.value),
      mid_year: isMidYear.value ? '1' : '0',
    },
  })
}

const displayData = computed(() => {
  let data: any[]
  if (keyword.value) {
    if (filterAuxOnly.value) {
      data = list.value.filter(r => isAuxLeafAccount(r))
    } else {
      data = list.value
    }
  } else if (filterAuxOnly.value) {
    data = filterTreeForAux(treeData.value)
  } else {
    data = treeData.value
  }
  if (!showZeroValue.value) {
    data = keyword.value ? (data as any[]).filter(rowHasAmount) : filterTreeHideZero(data as any[])
  }
  return data
})

function handleCurrentRowChange(row: any) {
  currentRow.value = row
}

function flattenVisibleRows(nodes: any[], result: any[] = []): any[] {
  for (const node of nodes) {
    result.push(node)
    if (node.children?.length && expandedSet.value.has(node.id)) {
      flattenVisibleRows(node.children, result)
    }
  }
  return result
}

function getTableVisibleRows(): any[] {
  if (keyword.value) {
    const data = displayData.value
    return Array.isArray(data) ? (data as any[]) : []
  }
  return flattenVisibleRows(displayData.value as any[])
}

function isEditableBalanceRow(row: any): boolean {
  return !!row && !parentIdSet.value.has(row.id) && !isAuxLeafAccount(row)
}

function getEditableVisibleRows(): any[] {
  return getTableVisibleRows().filter(isEditableBalanceRow)
}

function scrollCurrentRowIntoView() {
  nextTick(() => {
    tableRef.value?.$el
      ?.querySelector('.el-table__row.current-row')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function resolveNavigationAnchor(): { row: any; field: BalanceField } | null {
  const editableRows = getEditableVisibleRows()
  const visibleFields = getVisibleFields()
  if (editableRows.length === 0) return null

  const field = (
    activeField.value && visibleFields.includes(activeField.value)
      ? activeField.value
      : visibleFields[0]
  ) as BalanceField

  if (currentRow.value && isEditableBalanceRow(currentRow.value)) {
    return { row: currentRow.value, field }
  }

  const visible = getTableVisibleRows()
  const pos = currentRow.value?.id ? visible.findIndex(r => r.id === currentRow.value.id) : -1

  if (pos >= 0) {
    for (let i = pos; i < visible.length; i++) {
      if (isEditableBalanceRow(visible[i])) return { row: visible[i], field }
    }
    for (let i = pos - 1; i >= 0; i--) {
      if (isEditableBalanceRow(visible[i])) return { row: visible[i], field }
    }
  }

  return { row: editableRows[0], field }
}

function navigateToBalanceCell(row: any, field: BalanceField) {
  if (!row) return
  if (!locked.value && isEditableBalanceRow(row)) {
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
  row: any,
  field: BalanceField,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  const visibleFields = getVisibleFields()
  const editableRows = getEditableVisibleRows()
  if (editableRows.length === 0) return

  let rowIdx = editableRows.findIndex(r => r.id === row.id)
  let fieldIdx = visibleFields.indexOf(field)
  if (fieldIdx < 0) fieldIdx = 0
  if (rowIdx < 0) {
    navigateToBalanceCell(editableRows[0], visibleFields[fieldIdx])
    return
  }

  let nextRowIdx = rowIdx
  let nextFieldIdx = fieldIdx

  switch (direction) {
    case 'up':
      nextRowIdx = Math.max(0, rowIdx - 1)
      break
    case 'down':
      nextRowIdx = Math.min(editableRows.length - 1, rowIdx + 1)
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
        nextRowIdx = Math.min(editableRows.length - 1, rowIdx + 1)
        nextFieldIdx = 0
      }
      break
  }

  navigateToBalanceCell(editableRows[nextRowIdx], visibleFields[nextFieldIdx])
}

function moveCursor(delta: number) {
  const editableRows = getEditableVisibleRows()
  if (editableRows.length === 0) return
  const visibleFields = getVisibleFields()
  const field = (
    activeField.value && visibleFields.includes(activeField.value)
      ? activeField.value
      : visibleFields[0]
  ) as BalanceField

  if (currentRow.value && isEditableBalanceRow(currentRow.value)) {
    const idx = editableRows.findIndex(r => r.id === currentRow.value.id)
    const nextIdx = Math.max(0, Math.min(editableRows.length - 1, idx + delta))
    navigateToBalanceCell(editableRows[nextIdx], field)
    return
  }

  const visible = getTableVisibleRows()
  const pos = currentRow.value?.id
    ? visible.findIndex(r => r.id === currentRow.value.id)
    : delta > 0
      ? -1
      : visible.length
  const step = delta > 0 ? 1 : -1
  for (let i = pos + step; i >= 0 && i < visible.length; i += step) {
    if (isEditableBalanceRow(visible[i])) {
      navigateToBalanceCell(visible[i], field)
      return
    }
  }
  navigateToBalanceCell(editableRows[delta > 0 ? 0 : editableRows.length - 1], field)
}

function moveCursorHorizontal(delta: number) {
  const anchor = resolveNavigationAnchor()
  if (!anchor) return
  navigateFromCell(anchor.row, anchor.field, delta > 0 ? 'right' : 'left')
}

function toggleCurrentRowExpand() {
  const row = currentRow.value
  if (!row?.children?.length) return
  commitEdit()
  const next = new Set(expandedSet.value)
  if (next.has(row.id)) {
    next.delete(row.id)
  } else {
    next.add(row.id)
  }
  expandedSet.value = next
}

function handleExpandChange(row: any, expanded: boolean) {
  commitEdit()
  if (expanded) {
    expandedSet.value.add(row.id)
  } else {
    expandedSet.value.delete(row.id)
  }
}

function handleRowDblClick(row: any) {
  if (!row?.children?.length) return
  commitEdit()
  const nextExpandedSet = new Set(expandedSet.value)
  if (nextExpandedSet.has(row.id)) {
    nextExpandedSet.delete(row.id)
  } else {
    nextExpandedSet.add(row.id)
  }
  expandedSet.value = nextExpandedSet
}

function expandAll() {
  const all = flattenRows(treeData.value)
  expandedSet.value = new Set(all.filter(r => r.children?.length).map(r => r.id))
}

function collapseAll() {
  expandedSet.value = new Set()
}

function goUpLevel() {
  if (expandedSet.value.size === 0) return
  const flat = flattenRows(treeData.value)
  const expandedNodes = flat.filter(r => expandedSet.value.has(r.id))
  if (expandedNodes.length === 0) return
  const maxDepth = Math.max(...expandedNodes.map(r => r._depth || 1))
  const toCollapse = expandedNodes.filter(r => (r._depth || 1) === maxDepth)
  toCollapse.forEach(r => expandedSet.value.delete(r.id))
}

function goDownLevel() {
  const flat = flattenRows(treeData.value)
  if (expandedSet.value.size === 0) {
    const topLevel = treeData.value.filter(r => r.children?.length)
    topLevel.forEach(r => expandedSet.value.add(r.id))
    return
  }
  const expandedNodes = flat.filter(r => expandedSet.value.has(r.id))
  const maxDepth = Math.max(...expandedNodes.map(r => r._depth || 1))
  const toExpand = flat.filter(r => {
    if (!r.children?.length) return false
    if (expandedSet.value.has(r.id)) return false
    return (r._depth || 1) === maxDepth + 1 && r.parent_id && expandedSet.value.has(r.parent_id)
  })
  toExpand.forEach(r => expandedSet.value.add(r.id))
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    fetchData()
  }, 300)
}

function onSearchClear() {
  if (searchTimer) clearTimeout(searchTimer)
  keyword.value = ''
  fetchData()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === '\\') {
    e.preventDefault()
    commitEdit()
    collapseAll()
    return
  }
  if (e.ctrlKey && e.shiftKey && e.key === '\\') {
    e.preventDefault()
    commitEdit()
    expandAll()
    return
  }
  if (e.ctrlKey && e.key === 'ArrowUp') {
    e.preventDefault()
    commitEdit()
    goUpLevel()
    return
  }
  if (e.ctrlKey && e.key === 'ArrowDown') {
    e.preventDefault()
    commitEdit()
    goDownLevel()
    return
  }

  // 无修饰键的方向键/回车：行光标导航（input 焦点时跳过，由 handleCellKeydown 接管）
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
    toggleCurrentRowExpand()
    return
  }
}

async function fetchData() {
  try {
    const params: any = { year: selectedYear.value }
    if (keyword.value) params.keyword = keyword.value
    const res = await request.get<any[]>('/base/init-balances', { params })
    isMidYear.value = (res as any).isMidYear || false
    startMonth.value = (res as any).startMonth || 1
    list.value = res.data.map((r: any) => {
      const opening = normalizeOpeningDebitCredit(r.opening_debit || 0, r.opening_credit || 0)
      r.opening_debit = opening.opening_debit
      r.opening_credit = opening.opening_credit
      r.pre_book_debit = r.pre_book_debit || 0
      r.pre_book_credit = r.pre_book_credit || 0
      r.balanceValue = calcBalance(r)
      return r
    })
    await nextTick()
    recalcParentTotals()
    initDataLoaded.value = true
    await relayoutAfterData()
  } catch (error) {
    showOperationError('获取期初余额', error)
    initDataLoaded.value = true
  }
}

async function checkCanEdit() {
  try {
    const res = (await request.get('/base/init-balances/can-edit', {
      params: { year: selectedYear.value },
    })) as any
    locked.value = !res.canEdit
    lockReason.value = res.reason || ''
  } catch {
    // 接口失败时不锁定
    locked.value = false
  }
}

async function checkBalance() {
  commitEdit()
  recalcParentTotals()
  await nextTick()
  const flatNodes = getFlatNodes()
  const leafNodes = flatNodes.filter(n => !parentIdSet.value.has(n.id))
  let totalDebit = 0
  let totalCredit = 0
  for (const n of leafNodes) {
    totalDebit += (n.opening_debit || 0) + (n.pre_book_debit || 0)
    totalCredit += (n.opening_credit || 0) + (n.pre_book_credit || 0)
  }
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01

  let auxCategoryConsistent = true
  let auxCategoryMismatches: any[] = []
  try {
    const res = (await request.get('/base/init-balances/check', {
      params: { year: selectedYear.value },
    })) as any
    auxCategoryConsistent = res.auxCategoryConsistent ?? true
    auxCategoryMismatches = res.auxCategoryMismatches || []
  } catch {
    auxCategoryConsistent = true
    auxCategoryMismatches = []
  }

  balanceCheck.value = {
    balanced,
    totalDebit,
    totalCredit,
    auxCategoryConsistent,
    auxCategoryMismatches,
  }
}

async function saveAll() {
  if (locked.value) return
  saving.value = true
  try {
    commitEdit()
    recalcParentTotals()
    await nextTick()
    const flatNodes = getFlatNodes()
    const items = flatNodes
      .filter(r => !parentIdSet.value.has(r.id))
      .filter(r => !isAuxLeafAccount(r))
      .filter(
        r =>
          (r.opening_debit || 0) !== 0 ||
          (r.opening_credit || 0) !== 0 ||
          (r.pre_book_debit || 0) !== 0 ||
          (r.pre_book_credit || 0) !== 0
      )
      .map(r => {
        const opening = normalizeOpeningDebitCredit(r.opening_debit || 0, r.opening_credit || 0)
        return {
          account_id: r.id,
          direction: r.direction,
          opening_debit: opening.opening_debit,
          opening_credit: opening.opening_credit,
          pre_book_debit: r.pre_book_debit || 0,
          pre_book_credit: r.pre_book_credit || 0,
        }
      })

    if (items.length === 0) {
      showError('没有需要保存的数据')
      return
    }

    await startAsyncTask('init-balance-import', () =>
      request.post('/base/init-balances/batch-async', {
        year: selectedYear.value,
        items,
      })
    )
  } catch (error) {
    showOperationError('保存期初余额', error)
  } finally {
    saving.value = false
  }
}

const filteredDirectClearAccountIds = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return list.value
    .filter(r => !parentIdSet.value.has(r.id))
    .filter(r => !isAuxLeafAccount(r))
    .filter(r => {
      if (!kw) return true
      return String(r.code).toLowerCase().includes(kw) || String(r.name).toLowerCase().includes(kw)
    })
    .map(r => r.id)
})

const filteredDirectClearCount = computed(() => clearPreview.value.directFiltered)

const currentClearCount = computed(() => {
  if (clearMode.value === 'aux_all') return clearPreview.value.auxAll
  if (clearMode.value === 'direct_filtered') return clearPreview.value.directFiltered
  return clearPreview.value.directAll
})

function openClearDialog() {
  clearMode.value = 'direct_all'
  clearDialogVisible.value = true
}

async function loadClearPreview() {
  try {
    const [directAllRes, auxAllRes, filteredRes] = await Promise.all([
      request.get('/base/init-balances/clear-preview', {
        params: { year: selectedYear.value, mode: 'direct' },
      }) as Promise<any>,
      request.get('/base/init-balances/clear-preview', {
        params: { year: selectedYear.value, mode: 'aux' },
      }) as Promise<any>,
      // 筛选结果的科目数量可能上千，account_ids 放在 URL 上会超出请求头长度限制，
      // 导致连接被重置（前端表现为 Network Error），因此改用 POST 走请求体
      filteredDirectClearAccountIds.value.length
        ? (request.post('/base/init-balances/clear-preview', {
            year: selectedYear.value,
            mode: 'direct',
            account_ids: filteredDirectClearAccountIds.value,
          }) as Promise<any>)
        : Promise.resolve({ data: { count: 0 } }),
    ])
    clearPreview.value = {
      directAll: directAllRes.data?.count || 0,
      auxAll: auxAllRes.data?.count || 0,
      directFiltered: filteredRes.data?.count || 0,
    }
  } catch (error) {
    showOperationError('获取清理预览', error)
  }
}

async function confirmBatchClear() {
  const count = currentClearCount.value
  if (count <= 0) {
    showError('没有可清理的数据')
    return
  }

  const scopeLabel =
    clearMode.value === 'aux_all'
      ? '全部辅助期初明细'
      : clearMode.value === 'direct_filtered'
        ? '当前筛选结果的科目期初'
        : '全部科目期初'

  const confirmed = await useConfirm({
    title: '批量清理确认',
    message: `确定要清理 ${selectedYear.value} 年的「${scopeLabel}」吗？共 ${count} 条记录，此操作不可恢复。`,
    type: 'warning',
    confirmButtonText: '确认清理',
    cancelButtonText: '取消',
  })
  if (!confirmed) return

  clearing.value = true
  try {
    const payload: Record<string, unknown> = {
      year: selectedYear.value,
      mode: clearMode.value === 'aux_all' ? 'aux' : 'direct',
    }
    if (clearMode.value === 'direct_filtered') {
      payload.account_ids = filteredDirectClearAccountIds.value
    }
    await startAsyncTask('init-balance-clear', () =>
      request.post('/base/init-balances/batch-clear-async', payload)
    )
    clearDialogVisible.value = false
  } catch (error) {
    showOperationError('批量清理期初', error)
  } finally {
    clearing.value = false
  }
}

// ===================== 导入导出 =====================

function buildInitBalanceExportRows(leafNodes: any[]) {
  return leafNodes.map(r => {
    const row: Record<string, string | number> = {
      科目编码: r.code,
      科目名称: r.name,
      方向: r.direction === 'debit' ? '借' : '贷',
      年初借方: r.opening_debit || 0,
      年初贷方: r.opening_credit || 0,
    }
    if (isMidYear.value) {
      row['帐前借方'] = r.pre_book_debit || 0
      row['帐前贷方'] = r.pre_book_credit || 0
    }
    return row
  })
}

async function exportData() {
  commitEdit()
  recalcParentTotals()
  await nextTick()

  const leafNodes = getFlatNodes().filter(n => !parentIdSet.value.has(n.id))
  if (leafNodes.length === 0) {
    showError('没有可导出的数据')
    return
  }

  const rows = leafNodes
  await exportStyledTable({
    fileName: `期初余额_${selectedYear.value}年.xlsx`,
    sheetName: '期初余额',
    title: '期初余额',
    subtitle: `${selectedYear.value}年`,
    columns: buildInitBalanceExportColumns(isMidYear.value),
    rows,
  })
  showSuccess(`已导出 ${rows.length} 条期初余额`)
}

// ===================== 打印（HiprintDialog 预览）=====================
const { accountSetName } = storeToRefs(useUserStore())
const hiprintVisible = ref(false)

async function printPage() {
  commitEdit()
  recalcParentTotals()
  await nextTick()
  const leafNodes = getFlatNodes().filter(n => !parentIdSet.value.has(n.id))
  if (leafNodes.length === 0) {
    showError('没有可打印的数据')
    return
  }
  hiprintVisible.value = true
}

function buildPrintHtml(): string {
  const leafNodes = getFlatNodes().filter(n => !parentIdSet.value.has(n.id))
  type PrintCol = { label: string; align: 'left' | 'center' | 'right'; render: (r: any) => string }
  const columns: PrintCol[] = [
    {
      label: '编码',
      align: 'left',
      render: r => '　'.repeat(Math.max(0, (r._depth || r.level || 1) - 1)) + (r.code || ''),
    },
    {
      label: '科目',
      align: 'left',
      render: r => '　'.repeat(Math.max(0, (r._depth || r.level || 1) - 1)) + (r.name || ''),
    },
    { label: '方向', align: 'center', render: r => (r.direction === 'debit' ? '借' : '贷') },
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
    { label: '余向', align: 'center', render: r => getBalanceDisplay(r)?.dir || '' },
    {
      label: '余额',
      align: 'right',
      render: r => {
        const b = getBalanceDisplay(r)
        return b ? formatAmount(b.amount) : ''
      },
    }
  )

  // 合计：取顶层节点（已含下级汇总）
  const summaryRows = getSummaryRows(getFlatNodes())
  let tOD = 0,
    tOC = 0,
    tPD = 0,
    tPC = 0
  for (const row of summaryRows) {
    tOD += row.opening_debit || 0
    tOC += row.opening_credit || 0
    tPD += row.pre_book_debit || 0
    tPC += row.pre_book_credit || 0
  }
  const net = tOD + tPD - tOC - tPC
  const footer: string[] = [
    '合计',
    '',
    '',
    formatAmount(tOD),
    formatAmount(tOC),
    ...(isMidYear.value ? [formatAmount(tPD), formatAmount(tPC)] : []),
    Math.abs(net) < 0.005 ? '平' : net > 0 ? '借' : '贷',
    Math.abs(net) < 0.005 ? '' : formatAmount(Math.abs(net)),
  ]

  return buildTablePrintHtml<any>({
    title: '期初余额',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${selectedYear.value}年${isMidYear.value ? ` · 年中开账第${startMonth.value}期` : ''}`,
    rows: leafNodes,
    monochrome: true,
    fitToPage: true,
    columns,
    footer,
  })
}

async function downloadTemplate() {
  const { utils, writeFile } = await import('xlsx')

  const baseColumns: Record<string, any> = {
    科目编码: '1001',
    科目名称: '库存现金',
    方向: '借',
    年初借方: 10000,
    年初贷方: 0,
  }
  if (isMidYear.value) {
    baseColumns['帐前借方'] = 5000
    baseColumns['帐前贷方'] = 0
  }

  const row2: Record<string, any> = {
    科目编码: '1002',
    科目名称: '银行存款',
    方向: '借',
    年初借方: 50000,
    年初贷方: 0,
  }
  if (isMidYear.value) {
    row2['帐前借方'] = 20000
    row2['帐前贷方'] = 0
  }

  const templateData = [baseColumns, row2]
  const ws = utils.json_to_sheet(templateData)

  // 设置列宽
  ws['!cols'] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 6 },
    { wch: 14 },
    { wch: 14 },
    ...(isMidYear.value ? [{ wch: 14 }, { wch: 14 }] : []),
  ]

  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, '期初余额模板')
  writeFile(wb, `期初余额导入模板_${selectedYear.value}年.xlsx`)
}

function resetImportDialog() {
  importPreview.value = []
  importBlankSkipped.value = 0
  importTemplateWarning.value = null
  importIssuesDialogVisible.value = false
  importIssues.value = []
  importParsing.value = false
  importParseProgress.value = 0
  importParseMessage.value = ''
  importing.value = false
  importUploadRef.value?.clearFiles()
}

async function refreshImportIssuesAsync() {
  const token = ++importIssuesBuildToken
  importIssuesLoading.value = true
  importIssues.value = []
  try {
    await nextTick()
    await yieldToMain()
    importIssues.value = await aggregateImportIssuesAsync(
      importPreview.value,
      describeInitBalanceRowIssue
    )
  } finally {
    if (token === importIssuesBuildToken) importIssuesLoading.value = false
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
    importParseMessage.value = '正在解析工作表…'
    const { utils, read } = await import('xlsx')
    const workbook = read(arrayBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    await yieldToMain()
    importParseMessage.value = '正在校验导入数据…'
    const rawData: Record<string, unknown>[] = utils.sheet_to_json(sheet, { defval: '' })

    if (rawData.length === 0) {
      showError('文件中没有数据')
      resetImportDialog()
      return
    }

    const codeMap = new Map(
      list.value.map(a => [normalizeImportCode(String(a.code)), a] as [string, typeof a])
    )
    const nameMap = buildInitBalanceNameMap(list.value)
    const { rows, blankSkipped, templateWarning } = await parseInitBalanceImportRowsAsync(
      rawData,
      codeMap,
      nameMap,
      isAuxLeafAccount,
      isMidYear.value,
      {
        onProgress: pct => {
          importParseProgress.value = pct
        },
      }
    )
    importBlankSkipped.value = blankSkipped
    importTemplateWarning.value = templateWarning
    importPreview.value = rows
    importIssues.value = []
    if (rows.length > 0 && rows.every(r => !r.matched) && rows.some(r => r.error)) {
      void openImportIssuesDialog()
    }
  } catch (error) {
    showError('文件解析失败，请检查文件格式')
    console.error('Import parse error:', error)
    resetImportDialog()
  } finally {
    importParsing.value = false
    importParseMessage.value = ''
  }
}

async function handleImport() {
  const matched = importPreview.value.filter(r => r.matched)
  if (matched.length === 0) {
    if (importIssueCount.value > 0) void openImportIssuesDialog()
    return
  }
  importing.value = true
  const skipped = importPreview.value.length - matched.length

  try {
    const items = matched.map(r => {
      const opening = normalizeOpeningDebitCredit(r.opening_debit, r.opening_credit)
      return {
        account_id: r.account_id,
        direction: r.direction,
        opening_debit: opening.opening_debit,
        opening_credit: opening.opening_credit,
        pre_book_debit: r.pre_book_debit,
        pre_book_credit: r.pre_book_credit,
      }
    })

    await startAsyncTask('init-balance-import', () =>
      request.post('/base/init-balances/batch-async', {
        year: selectedYear.value,
        items,
      })
    )
    if (skipped > 0) {
      showSuccess(`已提交 ${matched.length} 条期初导入，另有 ${skipped} 行未通过校验已跳过`)
    }
    closeImportDialog()
  } catch (error) {
    showOperationError('导入期初余额', error)
    importUploadRef.value?.clearFiles()
  } finally {
    importing.value = false
  }
}

async function handleTaskCompleted() {
  await fetchData()
  await checkBalance()
}

onMounted(() => {
  applyInitBalanceEntryYear()
  void systemParamsStore.load().then(() => {
    // 参数加载后若默认年度落在账套区间之外（如系统年份晚于账套最新会计年度），
    // 自动落到账套的当前会计年度，避免打开就是一片空白
    if (route.query.year) return
    const list = years.value
    if (list.length === 0 || list.includes(selectedYear.value)) return
    const target = Math.min(Math.max(systemParamsStore.currentYear, list[list.length - 1]), list[0])
    if (target === selectedYear.value) return
    selectedYear.value = target
    onYearChange()
  })
  fetchData()
  checkCanEdit()
  window.addEventListener('keydown', handleKeydown)
})
onActivated(() => {
  applyInitBalanceEntryYear()
  fetchData()
  checkCanEdit()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.page {
  height: 100%;
  padding: var(--page-pad);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
  box-sizing: border-box;
}
.voucher-audit-return-zone {
  flex-shrink: 0;
  margin-bottom: 10px;
}
.voucher-audit-return-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #b3d8ff;
  border-radius: 10px;
  background: linear-gradient(135deg, #ecf5ff 0%, #f0f9ff 55%, #ffffff 100%);
  box-shadow:
    0 4px 14px rgba(64, 158, 255, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}
.voucher-audit-return-btn:hover {
  transform: translateY(-1px);
  border-color: #79bbff;
  box-shadow:
    0 8px 20px rgba(64, 158, 255, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
}
.voucher-audit-return-btn:active {
  transform: translateY(0);
}
.voucher-audit-return-btn__icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: linear-gradient(145deg, #409eff, #337ecc);
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(64, 158, 255, 0.35);
}
.voucher-audit-return-btn__icon {
  font-size: 22px;
}
.voucher-audit-return-btn__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.voucher-audit-return-btn__eyebrow {
  font-size: var(--cw-text-sm);
  line-height: 1.3;
  color: #e6a23c;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.voucher-audit-return-btn__title {
  font-size: var(--cw-text-xl);
  line-height: 1.25;
  font-weight: 700;
  color: #1f2d3d;
}
.voucher-audit-return-btn__desc {
  font-size: var(--cw-text-base);
  line-height: 1.45;
  color: #606266;
}
.voucher-audit-return-btn__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #409eff;
  color: #fff;
  font-size: var(--cw-text-base);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.35);
  transition: background 0.18s ease;
}
.voucher-audit-return-btn:hover .voucher-audit-return-btn__action {
  background: #337ecc;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 12px;
  margin-bottom: 6px;
  flex-shrink: 0;
  padding: 6px 10px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  min-width: 0;
  overflow: hidden;
}
.header-left {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  flex-shrink: 0;
}
.year-select {
  width: 96px;
}
.toolbar {
  margin-left: auto;
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.toolbar-track {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
}
.toolbar-nav,
.toolbar-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.toolbar-actions {
  justify-content: flex-end;
}
.toolbar-divider {
  height: 20px;
  margin: 0 2px;
  flex-shrink: 0;
}
.search-input {
  width: 150px;
  flex-shrink: 0;
}
.zero-filter-checkbox {
  margin-left: 2px;
  white-space: nowrap;
  flex-shrink: 0;
}
.toolbar :deep(.el-button--small) {
  padding: 5px 8px;
}
.balance-check-bar {
  margin-bottom: 6px;
  flex-shrink: 0;
}
.balance-check-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 10px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  background: #f4f4f5;
  border: 1px solid #e4e7ed;
  color: #606266;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.balance-check-segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}
.balance-check-row.is-locked {
  background: #fdf6ec;
  border-color: #faecd8;
  color: #e6a23c;
}
.balance-check-row.is-ok {
  background: #f0f9eb;
  border-color: #c2e7b0;
  color: #67c23a;
}
.balance-check-row.has-error {
  background: #fef0f0;
  border-color: #fbc4c4;
  color: #f56c6c;
}
.balance-check-segment--lock {
  max-width: 42%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.balance-check-divider {
  color: #c0c4cc;
  font-weight: 400;
  flex-shrink: 0;
}
.aux-mismatch-inline {
  cursor: help;
  text-decoration: underline dotted;
}
.balance-check-icon {
  font-size: var(--cw-text-base);
  flex-shrink: 0;
}
.balance-debit {
  font-weight: 600;
  color: #409eff;
}
.balance-credit {
  font-weight: 600;
  color: #f56c6c;
}
.computed-value {
  font-weight: 600;
  color: #409eff;
  font-size: 12px;
}
.editable-cell {
  display: inline-block;
  width: 100%;
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px;
  text-align: right;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: text;
  font-size: 12px;
  color: #303133;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.editable-cell:hover {
  border-color: #c0c4cc;
  background: #f5f7fa;
}
.editable-cell.cell-unsaved {
  color: #e6a23c;
}
.editable-cell.cell-dirty {
  color: #409eff;
}
.editable-cell.cell-active {
  border-color: #409eff;
  background: #ecf5ff;
}
.cell-input {
  width: 100%;
  height: 24px;
  padding: 0 6px;
  text-align: right;
  border: 1px solid #409eff;
  border-radius: 4px;
  outline: none;
  font-size: 12px;
  color: #303133;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
  box-sizing: border-box;
}
.import-tips {
  margin-bottom: 16px;
  color: #606266;
  font-size: var(--cw-text-base);
  line-height: 1.8;
}
.import-tips p {
  margin: 0;
}
.import-preview {
  margin-top: 16px;
}
.import-preview-more {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
.import-parsing {
  margin-top: 12px;
}
.import-parsing__text {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
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

.balance-table {
  border-radius: 6px;
}

.account-code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  color: var(--el-color-primary);
  font-weight: 600;
  line-height: 1.2;
}

.account-name {
  color: var(--el-text-color-primary);
  font-weight: 500;
  line-height: 1.2;
}

:deep(.balance-table .el-table__cell) {
  padding: 2px 0 !important;
}

:deep(.balance-table th.el-table__cell) {
  padding: 5px 0 !important;
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary);
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

:deep(.balance-table .el-table__footer-wrapper td.el-table__cell) {
  background: var(--el-fill-color-light) !important;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

:deep(.balance-table .el-table__footer-wrapper td.col-opening-debit .cell),
:deep(.balance-table .el-table__footer-wrapper td.col-opening-credit .cell),
:deep(.balance-table .el-table__footer-wrapper td.col-pre-book-debit .cell),
:deep(.balance-table .el-table__footer-wrapper td.col-pre-book-credit .cell) {
  color: #409eff;
  font-weight: 600;
}

:deep(.balance-table.summary-balance-debit .el-table__footer-wrapper td.col-balance-dir .cell),
:deep(.balance-table.summary-balance-debit .el-table__footer-wrapper td.col-balance-amount .cell) {
  color: #409eff;
  font-weight: 600;
}

:deep(.balance-table.summary-balance-credit .el-table__footer-wrapper td.col-balance-dir .cell),
:deep(.balance-table.summary-balance-credit .el-table__footer-wrapper td.col-balance-amount .cell) {
  color: #f56c6c;
  font-weight: 600;
}

:deep(.balance-table .el-table__row) {
  height: 30px;
}

:deep(.balance-table .cell) {
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.balance-table .el-tag) {
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
}

:deep(.balance-table .el-button--small) {
  height: 22px;
  padding: 0 4px;
}

:deep(.balance-table .el-table__expand-icon) {
  width: 18px;
  height: 18px;
  margin-right: 2px;
}
</style>
