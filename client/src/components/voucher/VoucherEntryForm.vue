<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="1180px"
    top="2vh"
    class="voucher-dialog"
    destroy-on-close
    @close="handleClose"
    @keydown="onVoucherDialogKeydown"
  >
    <div class="paper-voucher">
      <div class="voucher-paper-header">
        <div class="voucher-paper-title">记 账 凭 证</div>
        <div class="voucher-paper-meta">
          <div class="meta-item">
            <span class="meta-label">凭证类型</span>
            <el-select
              v-model="form.voucher_type_id"
              placeholder="凭证类型"
              class="meta-control"
              size="small"
              clearable
              :disabled="isReadonly"
            >
              <el-option v-for="t in voucherTypes" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
          </div>
          <div v-if="mode === 'edit'" class="meta-item">
            <span class="meta-label">凭证编号</span>
            <el-input
              v-model="form.voucher_no"
              placeholder="凭证编号"
              class="meta-control"
              size="small"
              @blur="handleVoucherNoBlur"
            />
          </div>
          <div v-else-if="mode === 'view'" class="meta-item meta-readonly">
            <span class="meta-label">凭证编号</span>
            <span class="meta-text">{{ form.voucher_no || '-' }}</span>
          </div>
          <div v-else class="meta-item meta-readonly">
            <span class="meta-label">凭证编号</span>
            <span
              class="meta-text"
              :style="!form.voucher_no ? 'color: #c0c4cc; font-weight: normal' : ''"
              >{{ form.voucher_no || '保存后自动生成' }}</span
            >
          </div>
          <div class="meta-item">
            <span class="meta-label">日期</span>
            <el-date-picker
              v-model="form.voucher_date"
              type="date"
              value-format="YYYY-MM-DD"
              class="meta-control"
              size="small"
              :disabled="isReadonly"
              :disabled-date="disabledVoucherDate"
            />
          </div>
          <div v-if="voucherDateWarning" class="voucher-date-warning">
            <el-alert :title="voucherDateWarning" type="warning" :closable="false" show-icon />
          </div>
          <div class="meta-item meta-readonly">
            <span class="meta-label">分录数</span>
            <span class="meta-text">{{ form.entries.length }}</span>
          </div>
          <div class="meta-item">
            <AccountDisplayModeSwitch />
          </div>
        </div>
      </div>

      <div v-if="!isReadonly" class="voucher-top-actions">
        <div class="navigation-controls">
          <DialogNavigation
            v-if="navigationInfo"
            :current="navigationInfo.current"
            :total="navigationInfo.total"
            :is-first="navigationInfo.isFirst"
            :is-last="navigationInfo.isLast"
            @navigate="val => emit('navigate', val)"
          />
          <span v-else class="navigation-info"> 未选择凭证 </span>
        </div>

        <!-- 当前选中科目的余额显示（含辅助核算各类目余额） -->
        <div
          v-if="currentEntryBalance || currentEntryAuxBalances.length > 0"
          class="account-balance-display-wrap"
        >
          <div
            v-if="currentEntryBalance"
            class="account-balance-display account-balance-display--drillable"
            title="双击查看科目明细账"
            @dblclick="handleBalanceDisplayDblclick"
          >
            <span class="balance-account"
              >{{
                getSuggestionLabel({
                  id: currentEntryBalance.id,
                  code: currentEntryBalance.code,
                  name: currentEntryBalance.name,
                })
              }}</span
            >
            <span class="balance-label">科目余额：</span>
            <span
              :class="
                currentEntryBalance.isSameSide ? 'balance-amount-same' : 'balance-amount-opposite'
              "
            >
              {{ currentEntryBalance.direction === 'debit' ? '借' : '贷' }}
              {{ formatMoney(currentEntryBalance.end_balance) }}
            </span>
          </div>
          <div
            v-for="aux in currentEntryAuxBalances"
            :key="`${aux.category_code}-${aux.item_id}`"
            class="account-balance-display aux-balance-chip"
          >
            <span class="balance-label">{{ aux.category_name }}：</span>
            <span class="balance-aux-item">{{ aux.item_name }}</span>
            <span :class="aux.isSameSide ? 'balance-amount-same' : 'balance-amount-opposite'">
              {{ aux.direction === 'debit' ? '借' : '贷' }} {{ formatMoney(aux.end_balance) }}
            </span>
          </div>
        </div>
      </div>

      <div class="voucher-table-wrap">
        <el-table
          :data="form.entries"
          border
          size="small"
          show-summary
          :summary-method="getSummary"
          highlight-current-row
          class="voucher-table paper-table"
          :class="{ 'voucher-table--readonly': isReadonly }"
          @current-change="handleCurrentEntryChange"
          @row-click="handleRowClick"
          @row-dblclick="handleRowDblclick"
        >
          <el-table-column label="摘要" min-width="200">
            <template #default="{ row, $index }">
              <div class="entry-row" @click="isReadonly && setCurrentEntry(row)">
                <el-input
                  v-if="!isReadonly"
                  v-model="row.summary"
                  placeholder="摘要"
                  size="small"
                  @focus="setCurrentEntry(row)"
                  @keydown.enter="moveToAccount(row, $event)"
                />
                <span v-else class="entry-readonly-text">{{ row.summary || '-' }}</span>
                <el-button
                  v-if="!isReadonly && $index === 0"
                  link
                  type="primary"
                  size="small"
                  @click="emit('ai-summary')"
                  >AI</el-button
                >
              </div>
            </template>
          </el-table-column>

          <el-table-column
            label="会计科目"
            :min-width="accountDisplayMode === 'full' ? 320 : 240"
          >
            <template #default="{ row }">
              <div v-if="isReadonly" class="entry-account-readonly" @click="setCurrentEntry(row)">
                <span class="entry-readonly-text" :title="getAccountDisplay(row)">{{
                  getAccountDisplay(row)
                }}</span>
                <template v-if="getEntryAuxCategories(row).length">
                  <span
                    v-for="cat in getEntryAuxCategories(row)"
                    :key="cat.id"
                    class="entry-aux-tag"
                    title="双击查看辅助项目明细账"
                    @click.stop="setCurrentEntry(row)"
                    @dblclick.stop="handleAuxTagDblclick(row, cat, $event)"
                  >
                    [{{ cat.name }}: {{ getAuxItemName(cat, row) }}]
                  </span>
                </template>
              </div>
              <div
                v-else-if="isLockedCashRow(row)"
                class="entry-account-readonly entry-account-locked"
                title="出纳生成的凭证：现金/银行科目已锁定，只能修改对方（挂账）科目"
                @click="setCurrentEntry(row)"
              >
                <span class="entry-readonly-text" :title="getAccountDisplay(row)">{{
                  getAccountDisplay(row)
                }}</span>
                <el-tag size="small" type="info" effect="plain" style="margin-left: 6px">
                  现金科目·锁定
                </el-tag>
              </div>
              <div v-else style="width: 100%" @dblclick="emit('quickCreateAccount', row)">
                <el-autocomplete
                  :ref="(el: any) => setAccountAutocompleteRef(row, el)"
                  :model-value="getAccountInput(row)"
                  :fetch-suggestions="
                    (queryString, cb) => queryAccountSuggestions(row, queryString, cb)
                  "
                  placeholder="输入科目编码或名称"
                  style="width: 100%"
                  clearable
                  @update:model-value="val => onAccountInputChange(row, val)"
                  @select="item => handleAccountSelect(row, item)"
                  @focus="onAccountAutoFocus(row)"
                  @keydown.enter="onAccountEnter(row, $event)"
                  @keydown.tab="onAccountTab(row, $event)"
                  @keydown.delete="onAccountDelete(row, $event)"
                  @keydown.up="onAccountArrowKey(row, $event, 'up')"
                  @keydown.down="onAccountArrowKey(row, $event, 'down')"
                >
                  <template #default="{ item }">
                    <div
                      class="account-suggestion-item"
                      :class="{ 'is-parent-account': item.isParent }"
                      :style="{ cursor: item.isParent ? 'not-allowed' : 'pointer' }"
                      @mousedown="onAccountSuggestionPointer(item, $event)"
                      @click="onAccountSuggestionPointer(item, $event)"
                    >
                      <span
                        :style="{
                          color: item.isParent ? '#c0c4cc' : '#303133',
                          fontStyle: item.isParent ? 'italic' : 'normal',
                        }"
                      >
                        {{ getSuggestionLabel(item) }}
                      </span>
                      <template v-if="item.auxNames?.length && !item.isParent">
                        <span
                          v-for="name in item.auxNames"
                          :key="name"
                          style="color: #409eff; margin-left: 8px"
                          >[{{ name }}]</span
                        >
                      </template>
                      <span
                        v-if="item.isParent"
                        style="color: #c0c4cc; font-size: 11px; margin-left: 4px"
                      >
                        (父科目)
                      </span>
                    </div>
                  </template>
                </el-autocomplete>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="借方金额" width="148" align="right">
            <template #default="{ row }">
              <div
                v-if="isReadonly"
                class="entry-readonly-amount"
                :class="{ 'is-foreign': isForeignRow(row) || isQuantityRow(row) }"
                :title="amountCellTitle(row, 'debit')"
                @click="onReadonlyAmountClick(row, 'debit', $event)"
              >
                <div v-if="row.debit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.debit_amount) < 0 }">{{
                    formatMoney(row.debit_amount)
                  }}</span>
                  <span v-if="row.foreign_amount" class="foreign-amount-inline">
                    {{ row.currency_code || '原币' }} {{ formatMoney(Number(row.foreign_amount) || 0) }}
                  </span>
                  <span v-else-if="row.quantity" class="foreign-amount-inline">
                    {{ quantityInlineText(row) }}
                  </span>
                </div>
              </div>
              <!-- 外币科目：本位币只读，点击 / 聚焦弹出气泡录入原币与汇率 -->
              <div
                v-else-if="isForeignRow(row)"
                class="foreign-amount-cell"
                :class="{
                  'is-active': isForeignPopoverFor(row, 'debit'),
                  'is-disabled': isLockedCashRow(row),
                }"
                :tabindex="isLockedCashRow(row) ? -1 : 0"
                :title="amountCellTitle(row, 'debit')"
                @focus="onForeignCellFocus(row, 'debit', $event)"
                @click="onForeignCellFocus(row, 'debit', $event)"
                @keydown="onForeignCellKeydown(row, 'debit', $event)"
              >
                <div v-if="row.debit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.debit_amount) < 0 }">{{
                    formatMoney(row.debit_amount)
                  }}</span>
                  <span v-if="row.foreign_amount" class="foreign-amount-inline">
                    {{ row.currency_code }} {{ formatMoney(Number(row.foreign_amount) || 0) }}
                  </span>
                </div>
              </div>
              <!-- 数量核算科目：金额只读，点击 / 聚焦弹出气泡录入数量与单价/金额 -->
              <div
                v-else-if="isQuantityRow(row)"
                class="foreign-amount-cell"
                :class="{
                  'is-active': isQuantityPopoverFor(row, 'debit'),
                  'is-disabled': isLockedCashRow(row),
                }"
                :tabindex="isLockedCashRow(row) ? -1 : 0"
                :title="amountCellTitle(row, 'debit')"
                @focus="onQuantityCellFocus(row, 'debit', $event)"
                @click="onQuantityCellFocus(row, 'debit', $event)"
                @keydown="onQuantityCellKeydown(row, 'debit', $event)"
              >
                <div v-if="row.debit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.debit_amount) < 0 }">{{
                    formatMoney(row.debit_amount)
                  }}</span>
                  <span v-if="row.quantity" class="foreign-amount-inline">
                    {{ quantityInlineText(row) }}
                  </span>
                </div>
              </div>
              <template v-else>
                <el-input-number
                  v-model="row.debit_amount"
                  :precision="2"
                  :controls="false"
                  :class="{ 'entry-amount-red': Number(row.debit_amount) < 0 }"
                  :disabled="isLockedCashRow(row)"
                  size="small"
                  class="amount-input"
                  @focus="setCurrentEntry(row)"
                  @change="onAmountChange(row, 'debit')"
                  @keydown.enter="onDebitEnter(row, $event)"
                  @keydown="onDebitKeydown(row, $event)"
                />
              </template>
            </template>
          </el-table-column>

          <el-table-column label="贷方金额" width="148" align="right">
            <template #default="{ row }">
              <div
                v-if="isReadonly"
                class="entry-readonly-amount"
                :class="{ 'is-foreign': isForeignRow(row) || isQuantityRow(row) }"
                :title="amountCellTitle(row, 'credit')"
                @click="onReadonlyAmountClick(row, 'credit', $event)"
              >
                <div v-if="row.credit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.credit_amount) < 0 }">{{
                    formatMoney(row.credit_amount)
                  }}</span>
                  <span v-if="row.foreign_amount" class="foreign-amount-inline">
                    {{ row.currency_code || '原币' }} {{ formatMoney(Number(row.foreign_amount) || 0) }}
                  </span>
                  <span v-else-if="row.quantity" class="foreign-amount-inline">
                    {{ quantityInlineText(row) }}
                  </span>
                </div>
              </div>
              <div
                v-else-if="isForeignRow(row)"
                class="foreign-amount-cell"
                :class="{
                  'is-active': isForeignPopoverFor(row, 'credit'),
                  'is-disabled': isLockedCashRow(row),
                }"
                :tabindex="isLockedCashRow(row) ? -1 : 0"
                :title="amountCellTitle(row, 'credit')"
                @focus="onForeignCellFocus(row, 'credit', $event)"
                @click="onForeignCellFocus(row, 'credit', $event)"
                @keydown="onForeignCellKeydown(row, 'credit', $event)"
              >
                <div v-if="row.credit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.credit_amount) < 0 }">{{
                    formatMoney(row.credit_amount)
                  }}</span>
                  <span v-if="row.foreign_amount" class="foreign-amount-inline">
                    {{ row.currency_code }} {{ formatMoney(Number(row.foreign_amount) || 0) }}
                  </span>
                </div>
              </div>
              <!-- 数量核算科目：金额只读，点击 / 聚焦弹出气泡录入数量与单价/金额 -->
              <div
                v-else-if="isQuantityRow(row)"
                class="foreign-amount-cell"
                :class="{
                  'is-active': isQuantityPopoverFor(row, 'credit'),
                  'is-disabled': isLockedCashRow(row),
                }"
                :tabindex="isLockedCashRow(row) ? -1 : 0"
                :title="amountCellTitle(row, 'credit')"
                @focus="onQuantityCellFocus(row, 'credit', $event)"
                @click="onQuantityCellFocus(row, 'credit', $event)"
                @keydown="onQuantityCellKeydown(row, 'credit', $event)"
              >
                <div v-if="row.credit_amount" class="amount-line">
                  <span :class="{ 'entry-amount-red': Number(row.credit_amount) < 0 }">{{
                    formatMoney(row.credit_amount)
                  }}</span>
                  <span v-if="row.quantity" class="foreign-amount-inline">
                    {{ quantityInlineText(row) }}
                  </span>
                </div>
              </div>
              <template v-else>
                <el-input-number
                  v-model="row.credit_amount"
                  :precision="2"
                  :controls="false"
                  :class="{ 'entry-amount-red': Number(row.credit_amount) < 0 }"
                  :disabled="isLockedCashRow(row)"
                  size="small"
                  class="amount-input"
                  @focus="setCurrentEntry(row)"
                  @change="onAmountChange(row, 'credit')"
                  @keydown.enter="onCreditEnter(row, $event)"
                  @keydown="onCreditKeydown(row, $event)"
                />
              </template>
            </template>
          </el-table-column>

          <el-table-column v-if="!isReadonly" label="操作" width="72" fixed="right">
            <template #default="{ row, $index }">
              <el-button
                link
                type="danger"
                size="small"
                :disabled="form.entries.length <= 2 || isLockedCashRow(row)"
                @click="removeEntry($index, row)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="voucher-paper-toolbar">
        <el-button v-if="!isReadonly" size="small" @click="addEntry">+ 添加分录</el-button>
        <div class="voucher-balance" :class="{ balanced: isBalanced, unbalanced: !isBalanced }">
          借方合计：{{ formatMoney(totalDebit) }}
          <span class="divider">|</span>
          贷方合计：{{ formatMoney(totalCredit) }}
          <span class="divider">|</span>
          {{
            isBalanced
              ? '借贷平衡 ✓'
              : `借贷不平衡，差额 ${formatMoney(Math.abs(totalDebit - totalCredit))}`
          }}
        </div>
      </div>

      <div
        v-if="currentEntry && showCashFlowForCurrentEntry"
        class="voucher-aux-panel voucher-cash-flow-panel"
      >
        <div class="voucher-aux-header">
          <span>现金流量项目</span>
          <span v-if="cashFlowRequired" class="cash-flow-required-tag">必填</span>
        </div>
        <div class="voucher-aux-rows">
          <div class="voucher-aux-row">
            <span class="voucher-aux-row-label">项目</span>
            <span v-if="isReadonly" class="voucher-aux-readonly-value">
              {{ getCashFlowDisplay(currentEntry) }}
            </span>
            <el-select
              v-else
              v-model="currentEntry.cash_flow_code"
              data-voucher-focus="cash-flow"
              filterable
              clearable
              placeholder="请选择现金流量项目"
              style="width: 320px"
              @change="onCashFlowCodeChange"
              @keydown="e => onVoucherFieldKeydown(currentEntry, { kind: 'cash_flow' }, e)"
            >
              <el-option
                v-for="item in cashFlowItems"
                :key="item.code"
                :label="`${item.code} ${item.name}`"
                :value="item.code"
              />
            </el-select>
          </div>
        </div>
      </div>

      <!-- 外币录入气泡：挂在触发的借/贷金额格上 -->
      <el-popover
        :visible="foreignPopover.visible"
        :virtual-ref="foreignPopover.triggerEl"
        virtual-triggering
        placement="bottom-end"
        :width="300"
        :show-arrow="true"
        :teleported="true"
        :persistent="false"
        popper-class="voucher-foreign-popover"
      >
        <div class="foreign-popover" @keydown.esc.stop.prevent="cancelForeignPopover">
          <div class="foreign-popover-header">
            <span>外币录入</span>
            <span class="foreign-popover-currency">{{ foreignPopover.currencyCode || '-' }}</span>
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">方向</span>
            <el-radio-group
              v-model="foreignPopover.side"
              size="small"
              :disabled="foreignPopover.readonly"
            >
              <el-radio-button value="debit">借方</el-radio-button>
              <el-radio-button value="credit">贷方</el-radio-button>
            </el-radio-group>
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">原币金额</span>
            <el-input-number
              ref="foreignAmountInputRef"
              v-model="foreignPopover.foreignAmount"
              :precision="2"
              :step="0.01"
              :controls="false"
              :disabled="foreignPopover.readonly"
              size="small"
              class="foreign-popover-input"
              placeholder="= 自动平衡"
              @keydown="onForeignAmountKeydown"
            />
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">汇率</span>
            <el-input-number
              ref="foreignRateInputRef"
              v-model="foreignPopover.rate"
              :min="0"
              :precision="6"
              :step="0.0001"
              :controls="false"
              :disabled="foreignPopover.readonly"
              size="small"
              class="foreign-popover-input"
              @keydown="onForeignRateKeydown"
            />
          </div>
          <div class="foreign-popover-row foreign-popover-total">
            <span class="foreign-popover-label">折合本位币</span>
            <span class="foreign-popover-base">{{ formatMoney(foreignPopoverBase) }}</span>
          </div>
          <div class="foreign-popover-actions">
            <el-button size="small" @click="cancelForeignPopover">
              {{ foreignPopover.readonly ? '关闭' : '取消' }}
            </el-button>
            <el-button
              v-if="!foreignPopover.readonly"
              size="small"
              type="primary"
              @click="confirmForeignPopover"
            >
              确定
            </el-button>
          </div>
        </div>
      </el-popover>

      <!-- 数量录入气泡：数量必填，单价与金额二选一，另一个自动反算 -->
      <el-popover
        :visible="quantityPopover.visible"
        :virtual-ref="quantityPopover.triggerEl"
        virtual-triggering
        placement="bottom-end"
        :width="300"
        :show-arrow="true"
        :teleported="true"
        :persistent="false"
        popper-class="voucher-foreign-popover voucher-quantity-popover"
      >
        <div class="foreign-popover" @keydown.esc.stop.prevent="cancelQuantityPopover">
          <div class="foreign-popover-header">
            <span>数量录入</span>
            <span class="foreign-popover-currency">{{ quantityPopover.unit || '-' }}</span>
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">方向</span>
            <el-radio-group
              v-model="quantityPopover.side"
              size="small"
              :disabled="quantityPopover.readonly"
            >
              <el-radio-button value="debit">借方</el-radio-button>
              <el-radio-button value="credit">贷方</el-radio-button>
            </el-radio-group>
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">数量</span>
            <el-input-number
              ref="quantityInputRef"
              v-model="quantityPopover.quantity"
              :precision="6"
              :step="1"
              :controls="false"
              :disabled="quantityPopover.readonly"
              size="small"
              class="foreign-popover-input"
              placeholder="必填"
              @change="onQuantityFieldChange('quantity')"
              @keydown="onQuantityKeydown($event, 'quantity')"
            />
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">单价</span>
            <el-input-number
              ref="unitPriceInputRef"
              v-model="quantityPopover.unitPrice"
              :precision="4"
              :step="0.0001"
              :controls="false"
              :disabled="quantityPopover.readonly"
              size="small"
              class="foreign-popover-input"
              placeholder="与金额二选一"
              @change="onQuantityFieldChange('unitPrice')"
              @keydown="onQuantityKeydown($event, 'unitPrice')"
            />
          </div>
          <div class="foreign-popover-row">
            <span class="foreign-popover-label">金额</span>
            <el-input-number
              ref="quantityAmountInputRef"
              v-model="quantityPopover.amount"
              :precision="2"
              :step="0.01"
              :controls="false"
              :disabled="quantityPopover.readonly"
              size="small"
              class="foreign-popover-input"
              placeholder="与单价二选一"
              @change="onQuantityFieldChange('amount')"
              @keydown="onQuantityKeydown($event, 'amount')"
            />
          </div>
          <div class="foreign-popover-actions">
            <el-button size="small" @click="cancelQuantityPopover">
              {{ quantityPopover.readonly ? '关闭' : '取消' }}
            </el-button>
            <el-button
              v-if="!quantityPopover.readonly"
              size="small"
              type="primary"
              @click="confirmQuantityPopover"
            >
              确定
            </el-button>
          </div>
        </div>
      </el-popover>

      <div v-if="currentEntry && filteredAuxCategories.length > 0" class="voucher-aux-panel">
        <div class="voucher-aux-header">
          <span>当前分录辅助核算</span>
          <span class="voucher-aux-summary">
            {{ currentEntry.summary || '未填写摘要' }} /
            {{ currentEntry.account_name || '未选择科目' }}
          </span>
          <el-button link size="small" @click="emit('clear-current-entry')">收起</el-button>
        </div>

        <div class="voucher-aux-rows">
          <div v-for="cat in filteredAuxCategories" :key="cat.id" class="voucher-aux-row">
            <span class="voucher-aux-row-label">{{ cat.name }}</span>
            <span
              v-if="isReadonly"
              class="voucher-aux-readonly-value voucher-aux-readonly-link"
              title="双击查看辅助项目明细账"
              @dblclick="handleAuxTagDblclick(currentEntry, cat, $event)"
            >
              {{ getAuxItemName(cat, currentEntry) }}
            </span>
            <el-select
              v-else
              v-model="currentEntry[`_${cat.code}_id`]"
              :data-voucher-focus="`aux-select-${cat.code}`"
              remote
              filterable
              remote-show-suffix
              clearable
              :placeholder="`请选择${cat.name}`"
              style="width: 200px"
              :loading="isAuxSelectLoading(cat.id)"
              :remote-method="(q: string) => searchAuxItems(cat.id, q)"
              @visible-change="(v: boolean) => v && onAuxDropdownOpen(cat.id)"
              @change="(id: string) => onAuxItemChange(cat, id)"
              @keydown="
                e =>
                  onVoucherFieldKeydown(currentEntry, { kind: 'aux_select', catCode: cat.code }, e)
              "
            >
              <el-option
                v-for="item in getAuxOptions(cat.id)"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
            <el-button
              v-if="!isReadonly"
              size="small"
              type="primary"
              plain
              @click="openAddAuxItemDialog(cat)"
              >+ 新建</el-button
            >
            <!-- 凭证录入显示的自定义字段 -->
            <template v-if="currentEntry[`_${cat.code}_id`] && getVoucherFields(cat).length > 0">
              <div
                v-for="field in getVoucherFields(cat)"
                :key="field.field_key"
                class="voucher-aux-row-field"
              >
                <span class="voucher-aux-field-name">
                  {{ field.field_name }}
                  <span v-if="field.required_in_voucher" style="color: #f56c6c">*</span>
                </span>
                <span v-if="isReadonly" class="voucher-aux-readonly-value">
                  {{ getAuxFieldDisplayValue(cat, field, currentEntry) }}
                </span>
                <el-input
                  v-else-if="field.field_type === 'text'"
                  v-model="currentEntry[`_${cat.code}_fv_${field.field_key}`]"
                  :data-voucher-focus="`aux-field-${cat.code}-${field.field_key}`"
                  style="width: 140px"
                  @keydown="
                    e =>
                      onVoucherFieldKeydown(
                        currentEntry,
                        { kind: 'aux_field', catCode: cat.code, fieldKey: field.field_key },
                        e
                      )
                  "
                />
                <el-input-number
                  v-else-if="field.field_type === 'number'"
                  v-model="currentEntry[`_${cat.code}_fv_${field.field_key}`]"
                  :data-voucher-focus="`aux-field-${cat.code}-${field.field_key}`"
                  :controls="false"
                  style="width: 140px"
                  @keydown="
                    e =>
                      onVoucherFieldKeydown(
                        currentEntry,
                        { kind: 'aux_field', catCode: cat.code, fieldKey: field.field_key },
                        e
                      )
                  "
                />
                <el-date-picker
                  v-else-if="field.field_type === 'date'"
                  v-model="currentEntry[`_${cat.code}_fv_${field.field_key}`]"
                  :data-voucher-focus="`aux-field-${cat.code}-${field.field_key}`"
                  type="date"
                  value-format="YYYY-MM-DD"
                  style="width: 160px"
                  @keydown="
                    e =>
                      onVoucherFieldKeydown(
                        currentEntry,
                        { kind: 'aux_field', catCode: cat.code, fieldKey: field.field_key },
                        e
                      )
                  "
                />
                <el-select
                  v-else-if="field.field_type === 'select'"
                  v-model="currentEntry[`_${cat.code}_fv_${field.field_key}`]"
                  :data-voucher-focus="`aux-field-${cat.code}-${field.field_key}`"
                  clearable
                  style="width: 140px"
                  @keydown="
                    e =>
                      onVoucherFieldKeydown(
                        currentEntry,
                        { kind: 'aux_field', catCode: cat.code, fieldKey: field.field_key },
                        e
                      )
                  "
                >
                  <el-option
                    v-for="opt in parseFieldOpts(field.options_json)"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- 新建辅助项目弹窗 -->
      <el-dialog
        v-model="addAuxItemDialogVisible"
        :title="`新建${addAuxItemCat?.name || '辅助项目'}`"
        width="420px"
        append-to-body
        @keydown.enter.prevent="submitAddAuxItem"
      >
        <el-form label-width="80px">
          <el-form-item label="名称" required>
            <el-input
              v-model="addAuxItemName"
              :placeholder="`请输入${addAuxItemCat?.name || ''}名称`"
            />
          </el-form-item>
          <!-- 档案必填的自定义字段 -->
          <template v-for="field in addAuxItemRequiredFields" :key="field.field_key">
            <el-form-item :label="field.field_name" required>
              <el-input
                v-if="field.field_type === 'text'"
                v-model="addAuxItemFieldValues[field.field_key]"
                :placeholder="`请输入${field.field_name}`"
              />
              <el-input-number
                v-else-if="field.field_type === 'number'"
                v-model="addAuxItemFieldValues[field.field_key]"
                :controls="false"
                style="width: 100%"
              />
              <el-date-picker
                v-else-if="field.field_type === 'date'"
                v-model="addAuxItemFieldValues[field.field_key]"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
              <el-select
                v-else-if="field.field_type === 'select'"
                v-model="addAuxItemFieldValues[field.field_key]"
                clearable
                style="width: 100%"
              >
                <el-option
                  v-for="opt in parseFieldOpts(field.options_json)"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
            </el-form-item>
          </template>
        </el-form>
        <template #footer>
          <el-button @click="addAuxItemDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="addAuxItemLoading" @click="submitAddAuxItem"
            >确定</el-button
          >
        </template>
      </el-dialog>

      <div class="voucher-paper-remark">
        <span class="remark-label">附注</span>
        <el-input
          v-model="form.remark"
          placeholder="凭证备注"
          size="small"
          :disabled="isReadonly"
        />
      </div>

      <div class="voucher-attachments-container">
        <div class="attachment-inline">
          <el-icon><Document /></el-icon>
          <span class="attachment-label">附件</span>
          <el-tooltip v-if="!isReadonly" content="Ctrl+F" placement="top">
            <el-button size="small" type="primary" plain @click="triggerFileInput">
              <el-icon><Upload /></el-icon>
              上传
            </el-button>
          </el-tooltip>
          <template v-if="attachments.length > 0">
            <el-tag
              v-for="file in attachments"
              :key="file.id"
              :closable="!isReadonly"
              :disable-transitions="false"
              class="attachment-tag"
              @close="handleFileDelete(file)"
              @click="handleAttachmentClick(file)"
            >
              {{ file.original_name }}
            </el-tag>
          </template>
        </div>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept="*"
          style="display: none"
          @change="onFileInputChange"
        />
      </div>

      <!-- 图片预览对话框 -->
      <el-dialog
        v-model="previewVisible"
        :title="previewAttachment?.original_name"
        width="80%"
        :before-close="closePreview"
      >
        <div class="preview-content">
          <img
            v-if="previewAttachment"
            :src="buildFileUrl(previewAttachment.file_path)"
            style="max-width: 100%; max-height: 70vh; display: block; margin: 0 auto"
            @error="handlePreviewError"
          />
        </div>
        <template #footer>
          <el-button @click="closePreview">关闭</el-button>
          <el-button
            type="primary"
            @click="previewAttachment && handleFileDownload(previewAttachment)"
          >
            <el-icon><Download /></el-icon>
            下载
          </el-button>
        </template>
      </el-dialog>

      <div class="voucher-paper-signatures">
        <div class="signature-item">
          <span>制单</span><em>{{ props.form.maker_name || '' }}</em>
        </div>
        <div class="signature-item">
          <span>审核</span><em>{{ props.form.auditor_name || '' }}</em>
        </div>
        <div class="signature-item"><span>出纳</span><em></em></div>
      </div>
    </div>

    <div v-if="props.duplicateWarnings.length > 0" class="duplicate-warnings">
      <el-alert
        v-for="(warn, idx) in props.duplicateWarnings"
        :key="idx"
        :title="warn"
        type="warning"
        show-icon
        :closable="false"
      />
    </div>

    <template #footer>
      <div class="dialog-footer-enhanced">
        <div v-if="!isReadonly" class="action-controls">
          <el-button plain size="small" @click="emit('import-template')">
            <el-icon><Document /></el-icon>
            引模版
          </el-button>
          <el-button plain size="small" @click="emit('turn-template')">
            <el-icon><Collection /></el-icon>
            转模版
          </el-button>
        </div>
        <div class="submit-controls">
          <el-button @click="handleClose">{{ isReadonly ? '关闭' : '取消' }}</el-button>
          <el-tooltip
            v-if="(props.mode === 'edit' || props.mode === 'view') && props.form.id"
            content="打印当前凭证"
            placement="top"
          >
            <el-button type="info" plain @click="emit('print')">
              <el-icon><Printer /></el-icon>
              打印
            </el-button>
          </el-tooltip>
          <template v-if="!isReadonly">
            <el-tooltip content="Ctrl+S 保存；Ctrl+Enter 保存并新增" placement="top">
              <el-button type="primary" :loading="props.submitLoading" @click="emit('submit')">
                保存凭证 (Ctrl+S)
              </el-button>
            </el-tooltip>
            <el-tooltip content="Ctrl+Enter" placement="top">
              <el-button
                type="success"
                :loading="props.submitLoading"
                @click="emit('submit-and-add')"
              >
                保存并新增 (Ctrl+Enter)
              </el-button>
            </el-tooltip>
          </template>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { VoucherForm, VoucherEntry } from '@/composables/useVoucherForm'
import { useKeyboardShortcuts, commonShortcuts } from '@/composables/useKeyboardShortcuts'
import { showSuccess, showError, showWarning } from '@/composables/useMessage'
import { buildEntryKey, useVoucherModalReturnStore } from '@/stores/voucherModalReturn'
import request from '@/api/request'
import { Document, Upload, Download, Printer, Collection } from '@element-plus/icons-vue'
import { formatAmount } from '@/utils/format'
import { accountNeedsCashFlowItem, isAuxCategoryExcludedFromAccount } from '@/utils/accountCashFlow'
import { formatAccountFullPath } from '@/utils/accountPathDisplay'
import { accountDisplayMode } from '@/utils/accountDisplayPreference'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

interface NavigationInfo {
  current: number
  total: number
  isFirst: boolean
  isLast: boolean
}

interface Props {
  modelValue: boolean
  mode: 'add' | 'edit' | 'insert' | 'view'
  form: VoucherForm
  currentEntry: VoucherEntry | null
  voucherTypes: any[]
  accounts: any[]
  auxCategories: any[]
  totalDebit: number
  totalCredit: number
  isBalanced: boolean
  currentEntryAuxCategories: any[]
  isParentAccount: (id: string) => boolean
  getAuxItemNames: (acc: any) => string[]
  getAuxOptions: (catId: string) => any[]
  isAuxSelectLoading: (catId: string) => boolean
  searchAuxItems: (catId: string, keyword: string) => void
  onAuxDropdownOpen: (catId: string) => void
  resolveAuxItemName: (
    catId: string,
    catCode: string,
    itemId: string,
    entry: VoucherEntry | null
  ) => string
  fetchNextAuxCode: (catId: string) => Promise<string>
  ensureSelectedForEntry: (entry: VoucherEntry | null) => void | Promise<void>
  onAccountChange: (entry: any) => void
  onAmountChange: (entry: any, side: 'debit' | 'credit') => void
  addEntry: () => void
  removeEntry: (index: number, row: VoucherEntry) => void
  setCurrentEntry: (row: VoucherEntry | null) => void
  attachments?: any[]
  updateAttachments?: (attachments: any[]) => void
  submitLoading?: boolean
  navigationInfo?: NavigationInfo | null
  enableCashFlow?: boolean
  cashFlowItems?: Array<{ code: string; name: string }>
  enableForeignCurrency?: boolean
  resolveExchangeRate?: (currencyCode: string) => number | Promise<number>
  accountSetStartDate?: string
  duplicateWarnings?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  submitLoading: false,
  navigationInfo: null,
  enableCashFlow: false,
  cashFlowItems: () => [],
  enableForeignCurrency: false,
  resolveExchangeRate: undefined,
  accountSetStartDate: '',
  duplicateWarnings: () => [],
})

const router = useRouter()
const route = useRoute()
const voucherModalReturnStore = useVoucherModalReturnStore()

const isReadonly = computed(() => props.mode === 'view')

// 出纳生成的凭证（source='cashier'）在编辑时：现金/银行分录锁定，只能改对方（挂账）科目
const isCashierEdit = computed(() => props.mode === 'edit' && props.form?.source === 'cashier')

/** 该分录是否为「出纳凭证里被锁定的现金/银行分录」 */
function isLockedCashRow(row: any): boolean {
  if (!isCashierEdit.value || !row?.account_id) return false
  const acc = props.accounts.find(a => a.id === row.account_id)
  return !!acc && (Number(acc.is_cash) === 1 || Number(acc.is_bank) === 1)
}

const dialogTitle = computed(() => {
  switch (props.mode) {
    case 'add':
      return '新增记账凭证'
    case 'insert':
      return '插入凭证'
    case 'view':
      return '查看记账凭证'
    default:
      return '编辑记账凭证'
  }
})

function disabledVoucherDate(date: Date): boolean {
  const now = new Date()
  const maxDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return date > maxDate
}

const voucherDateWarning = computed(() => {
  const d = props.form.voucher_date
  if (!d) return ''
  const dateObj = new Date(d)
  if (isNaN(dateObj.getTime())) return ''
  const now = new Date()
  const maxDate = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  if (dateObj > maxDate) {
    return `凭证日期不能超过当月（${maxDate.toISOString().slice(0, 10)}）`
  }
  if (props.accountSetStartDate && d < props.accountSetStartDate) {
    return `凭证日期（${d}）不能早于账套启用日期（${props.accountSetStartDate}）`
  }
  return ''
})

const filteredAuxCategories = computed(() =>
  props.currentEntryAuxCategories.filter(cat => !isAuxCategoryExcludedFromAccount(cat.code))
)

const currentEntryAccount = computed(() => {
  if (!props.currentEntry?.account_id) return null
  return props.accounts.find(a => a.id === props.currentEntry!.account_id) || null
})

const showCashFlowForCurrentEntry = computed(() => {
  const acc = currentEntryAccount.value
  if (!acc) return false
  return accountNeedsCashFlowItem(acc)
})

// ========== 外币录入气泡 ==========

/** 分录科目是否为外币科目（账套开启外币核算 且 科目 is_foreign=1） */
function isForeignRow(row: any): boolean {
  if (!props.enableForeignCurrency || !row?.account_id) return false
  const acc = props.accounts.find(a => a.id === row.account_id) as any
  return !!acc && Number(acc.is_foreign) === 1
}

const foreignPopover = reactive({
  visible: false,
  readonly: false,
  row: null as any,
  side: 'debit' as 'debit' | 'credit',
  currencyCode: '' as string,
  foreignAmount: null as number | null,
  rate: null as number | null,
  triggerEl: null as HTMLElement | null,
})
const foreignAmountInputRef = ref<any>(null)
const foreignRateInputRef = ref<any>(null)
/** 取消后把焦点还给触发格时，不要因 focus 事件再次弹出 */
let suppressForeignFocusOpen = false

const foreignPopoverBase = computed(() => {
  const foreign = Number(foreignPopover.foreignAmount) || 0
  const rate = Number(foreignPopover.rate) || 0
  if (!foreign || !(rate > 0)) return 0
  return Math.round(foreign * rate * 100) / 100
})

/** 金额格悬停提示：原币 × 汇率 = 本位币（单行显示时汇率不再直接展示） */
function foreignTitle(row: any, side: 'debit' | 'credit'): string {
  const base = side === 'debit' ? row?.debit_amount : row?.credit_amount
  if (!base || !row?.foreign_amount) return ''
  const rate = Number(row.exchange_rate) > 0 ? row.exchange_rate : '-'
  return `${row.currency_code || '原币'} ${formatMoney(Number(row.foreign_amount) || 0)} × 汇率 ${rate} = ${formatMoney(base)}`
}

function isForeignPopoverFor(row: any, side: 'debit' | 'credit'): boolean {
  return foreignPopover.visible && foreignPopover.row === row && foreignPopover.side === side
}

function focusForeignInput(which: 'amount' | 'rate') {
  nextTick(() => {
    const comp = which === 'amount' ? foreignAmountInputRef.value : foreignRateInputRef.value
    const input = (comp?.$el as HTMLElement | undefined)?.querySelector('input') as
      | HTMLInputElement
      | null
      | undefined
    if (input) {
      input.focus()
      input.select()
    }
  })
}

async function openForeignPopover(
  row: any,
  side: 'debit' | 'credit',
  triggerEl: HTMLElement | null,
  readonly = false
) {
  if (!row) return
  if (foreignPopover.visible && foreignPopover.row === row && foreignPopover.side === side) return
  props.setCurrentEntry(row)
  if (!readonly) await ensureForeignDefaults(row)
  // 已有金额时，以已录方向为准
  const existingSide: 'debit' | 'credit' | null = row.debit_amount
    ? 'debit'
    : row.credit_amount
      ? 'credit'
      : null
  foreignPopover.row = row
  foreignPopover.side = existingSide || side
  foreignPopover.readonly = readonly
  foreignPopover.currencyCode = row.currency_code || ''
  foreignPopover.foreignAmount =
    row.foreign_amount != null && row.foreign_amount !== '' ? Number(row.foreign_amount) : null
  foreignPopover.rate = Number(row.exchange_rate) > 0 ? Number(row.exchange_rate) : null
  foreignPopover.triggerEl = triggerEl
  foreignPopover.visible = true
  if (!readonly) focusForeignInput('amount')
}

let suppressForeignFocusTimer: ReturnType<typeof setTimeout> | null = null

function closeForeignPopover() {
  foreignPopover.visible = false
  foreignPopover.row = null
  foreignPopover.triggerEl = null
  // el-popover 关闭时 focus-trap 会把焦点还给触发格，短时间内忽略由此产生的 focus，避免气泡被重新弹出
  suppressForeignFocusOpen = true
  if (suppressForeignFocusTimer) clearTimeout(suppressForeignFocusTimer)
  suppressForeignFocusTimer = setTimeout(() => {
    suppressForeignFocusOpen = false
    suppressForeignFocusTimer = null
  }, 300)
}

function cancelForeignPopover() {
  const row = foreignPopover.row
  const side = foreignPopover.side
  closeForeignPopover()
  // 焦点回到触发格，避免丢焦
  if (row && !isReadonly.value) {
    nextTick(() => {
      const el = findForeignCellEl(row, side)
      el?.focus()
    })
  }
}

/** 确定：原币 × 汇率 → 本位币回填到所选方向，并跳到下一行 */
function confirmForeignPopover() {
  const row = foreignPopover.row
  if (!row) return
  const foreign = Number(foreignPopover.foreignAmount)
  const rate = Number(foreignPopover.rate)
  if (!Number.isFinite(foreign) || foreign === 0) {
    showWarning('请输入原币金额')
    focusForeignInput('amount')
    return
  }
  if (!(rate > 0)) {
    showWarning('请输入大于 0 的汇率')
    focusForeignInput('rate')
    return
  }
  const base = Math.round(foreign * rate * 100) / 100
  const side = foreignPopover.side
  row.currency_code = foreignPopover.currencyCode || row.currency_code || null
  row.foreign_amount = foreign
  row.exchange_rate = rate
  if (side === 'debit') {
    row.debit_amount = base
    row.credit_amount = null
  } else {
    row.credit_amount = base
    row.debit_amount = null
  }
  row.direction = side
  row.amount = base
  props.onAmountChange(row, side)
  closeForeignPopover()
  moveToNextRow(row)
}

function findForeignCellEl(row: any, side: 'debit' | 'credit'): HTMLElement | null {
  const tableEl = document.querySelector('.voucher-table')
  if (!tableEl) return null
  const rowIdx = props.form.entries.indexOf(row)
  if (rowIdx === -1) return null
  const tr = tableEl.querySelectorAll('.el-table__body-wrapper tbody tr')[rowIdx]
  const cell = tr?.querySelectorAll('td')[side === 'debit' ? 2 : 3]
  return (cell?.querySelector('.foreign-amount-cell') as HTMLElement | null) || null
}

function onForeignCellFocus(row: any, side: 'debit' | 'credit', event: Event) {
  if (isLockedCashRow(row)) return
  if (event.type === 'focus' && suppressForeignFocusOpen) return
  const el = (event.currentTarget as HTMLElement | null) || findForeignCellEl(row, side)
  void openForeignPopover(row, side, el)
}

function onForeignCellKeydown(row: any, side: 'debit' | 'credit', event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    stopEnterBubble(event)
    const el = (event.currentTarget as HTMLElement | null) || findForeignCellEl(row, side)
    void openForeignPopover(row, side, el)
  }
}

function onReadonlyAmountClick(row: any, side: 'debit' | 'credit', event: MouseEvent) {
  props.setCurrentEntry(row)
  if (isForeignRow(row) || row?.foreign_amount) {
    void openForeignPopover(row, side, event.currentTarget as HTMLElement, true)
    return
  }
  if (isQuantityRow(row) || row?.quantity) {
    openQuantityPopover(row, side, event.currentTarget as HTMLElement, true)
  }
}

/** 原币金额：Enter → 汇率；= → 用当前汇率把借贷差额折成原币 */
function onForeignAmountKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    stopEnterBubble(event)
    syncForeignInput(event, 'amount')
    focusForeignInput('rate')
    return
  }
  if (event.key === '=') {
    event.preventDefault()
    const row = foreignPopover.row
    const rate = Number(foreignPopover.rate) || 0
    if (!row || !(rate > 0)) return
    const otherDebit = props.totalDebit - (Number(row.debit_amount) || 0)
    const otherCredit = props.totalCredit - (Number(row.credit_amount) || 0)
    const diff = +(otherCredit - otherDebit).toFixed(2)
    if (diff === 0) return
    foreignPopover.side = diff > 0 ? 'debit' : 'credit'
    foreignPopover.foreignAmount = Math.round((Math.abs(diff) / rate) * 100) / 100
  }
}

function onForeignRateKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    stopEnterBubble(event)
    syncForeignInput(event, 'rate')
    confirmForeignPopover()
  }
}

/** el-input-number 在 Enter 时未必已触发 change，直接读取输入框原始值 */
function syncForeignInput(event: KeyboardEvent, which: 'amount' | 'rate') {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  const raw = String(input.value || '')
    .replace(/,/g, '')
    .trim()
  if (!raw) return
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  if (which === 'amount') foreignPopover.foreignAmount = n
  else foreignPopover.rate = n
}

/** 点击气泡与触发格以外的地方时关闭气泡 */
function onDocumentMousedownForForeign(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  const insidePopover = !!target.closest('.voucher-foreign-popover')
  if (foreignPopover.visible) {
    if (
      !insidePopover &&
      !(foreignPopover.triggerEl && foreignPopover.triggerEl.contains(target))
    ) {
      closeForeignPopover()
    }
  }
  if (quantityPopover.visible) {
    if (
      !insidePopover &&
      !(quantityPopover.triggerEl && quantityPopover.triggerEl.contains(target))
    ) {
      closeQuantityPopover()
    }
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedownForForeign, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedownForForeign, true)
})

// 科目变更为非外币科目、或弹窗关闭时收起气泡
watch(
  () => [props.modelValue, props.currentEntry?.account_id] as const,
  () => {
    if (foreignPopover.visible && foreignPopover.row && !isForeignRow(foreignPopover.row)) {
      closeForeignPopover()
    }
    if (!props.modelValue && foreignPopover.visible) closeForeignPopover()
    if (!props.modelValue && quantityPopover.visible) closeQuantityPopover()
  }
)

async function ensureForeignDefaults(entry: any) {
  if (!props.enableForeignCurrency || !entry?.account_id) return
  const acc = props.accounts.find(a => a.id === entry.account_id) as any
  if (!acc || Number(acc.is_foreign) !== 1) {
    entry.currency_code = null
    entry.exchange_rate = null
    entry.foreign_amount = null
    return
  }
  entry.currency_code = acc.currency_code || entry.currency_code || null
  if (!(Number(entry.exchange_rate) > 0) && entry.currency_code && props.resolveExchangeRate) {
    const rate = await props.resolveExchangeRate(entry.currency_code)
    if (Number(rate) > 0) entry.exchange_rate = Number(rate)
  }
}

// ========== 数量录入气泡 ==========

/** 分录科目是否为数量核算科目（科目 is_quantity=1；无账套级总开关） */
function isQuantityRow(row: any): boolean {
  if (!row?.account_id) return false
  const acc = props.accounts.find(a => a.id === row.account_id) as any
  return !!acc && Number(acc.is_quantity) === 1
}

function quantityUnitOf(row: any): string {
  const acc = props.accounts.find(a => a.id === row?.account_id) as any
  return String(row?.unit || acc?.quantity_unit || '')
}

/** 金额格小字副行：`10 个 × 11.1000` */
function quantityInlineText(row: any): string {
  const qty = Number(row?.quantity) || 0
  if (!qty) return ''
  const unit = quantityUnitOf(row)
  const price = Number(row?.unit_price) || 0
  const qtyText = formatQuantity(qty)
  return price ? `${qtyText}${unit} × ${formatUnitPrice(price)}` : `${qtyText}${unit}`
}

function formatQuantity(value: number): string {
  // 去掉无意义的末尾 0（10.000000 → 10），保留最多 6 位小数
  return String(Number(Number(value).toFixed(6)))
}

function formatUnitPrice(value: number): string {
  return Number(value).toFixed(4)
}

/** 金额格 hover 提示：外币优先，其次数量 */
function amountCellTitle(row: any, side: 'debit' | 'credit'): string {
  const fx = foreignTitle(row, side)
  if (fx) return fx
  const base = side === 'debit' ? row?.debit_amount : row?.credit_amount
  const qty = Number(row?.quantity) || 0
  if (!base || !qty) return ''
  const price = Number(row?.unit_price) || 0
  const unit = quantityUnitOf(row)
  return price
    ? `${formatQuantity(qty)}${unit} × 单价 ${formatUnitPrice(price)} = ${formatMoney(base)}`
    : `${formatQuantity(qty)}${unit} = ${formatMoney(base)}`
}

const quantityPopover = reactive({
  visible: false,
  readonly: false,
  row: null as any,
  side: 'debit' as 'debit' | 'credit',
  unit: '' as string,
  quantity: null as number | null,
  unitPrice: null as number | null,
  amount: null as number | null,
  triggerEl: null as HTMLElement | null,
})
const quantityInputRef = ref<any>(null)
const unitPriceInputRef = ref<any>(null)
const quantityAmountInputRef = ref<any>(null)
/** 取消后把焦点还给触发格时，不要因 focus 事件再次弹出 */
let suppressQuantityFocusOpen = false
let suppressQuantityFocusTimer: ReturnType<typeof setTimeout> | null = null

function isQuantityPopoverFor(row: any, side: 'debit' | 'credit'): boolean {
  return quantityPopover.visible && quantityPopover.row === row && quantityPopover.side === side
}

function focusQuantityInput(which: 'quantity' | 'unitPrice' | 'amount') {
  nextTick(() => {
    const comp =
      which === 'quantity'
        ? quantityInputRef.value
        : which === 'unitPrice'
          ? unitPriceInputRef.value
          : quantityAmountInputRef.value
    const input = (comp?.$el as HTMLElement | undefined)?.querySelector('input') as
      | HTMLInputElement
      | null
      | undefined
    if (input) {
      input.focus()
      input.select()
    }
  })
}

/**
 * 数量 / 单价 / 金额三者联算：数量恒为输入项，单价与金额二选一，改哪个就反算另一个。
 *   改数量或单价 → 金额 = 数量 × 单价
 *   改金额       → 单价 = 金额 ÷ 数量
 */
function onQuantityFieldChange(field: 'quantity' | 'unitPrice' | 'amount') {
  const qty = Number(quantityPopover.quantity) || 0
  if (field === 'amount') {
    const amount = Number(quantityPopover.amount) || 0
    if (qty && amount) {
      quantityPopover.unitPrice = Math.round((amount / qty) * 10000) / 10000
    }
    return
  }
  const price = Number(quantityPopover.unitPrice) || 0
  if (qty && price) {
    quantityPopover.amount = Math.round(qty * price * 100) / 100
  } else if (field === 'quantity' && qty && Number(quantityPopover.amount)) {
    // 只改了数量、单价还空着：以已录金额为准反算单价
    quantityPopover.unitPrice =
      Math.round(((Number(quantityPopover.amount) || 0) / qty) * 10000) / 10000
  }
}

function onQuantityKeydown(event: KeyboardEvent, field: 'quantity' | 'unitPrice' | 'amount') {
  if (event.key !== 'Enter') return
  stopEnterBubble(event)
  onQuantityFieldChange(field)
  if (field === 'quantity') {
    focusQuantityInput('unitPrice')
  } else if (field === 'unitPrice') {
    focusQuantityInput('amount')
  } else {
    confirmQuantityPopover()
  }
}

function openQuantityPopover(
  row: any,
  side: 'debit' | 'credit',
  triggerEl: HTMLElement | null,
  readonly = false
) {
  if (!row) return
  if (quantityPopover.visible && quantityPopover.row === row && quantityPopover.side === side) return
  props.setCurrentEntry(row)
  if (!readonly) ensureQuantityDefaults(row)
  // 已有金额时，以已录方向为准
  const existingSide: 'debit' | 'credit' | null = row.debit_amount
    ? 'debit'
    : row.credit_amount
      ? 'credit'
      : null
  quantityPopover.row = row
  quantityPopover.side = existingSide || side
  quantityPopover.readonly = readonly
  quantityPopover.unit = quantityUnitOf(row)
  quantityPopover.quantity =
    row.quantity != null && row.quantity !== '' ? Number(row.quantity) : null
  quantityPopover.unitPrice =
    Number(row.unit_price) > 0 ? Number(row.unit_price) : null
  quantityPopover.amount =
    Number(row.debit_amount) || Number(row.credit_amount) || null
  quantityPopover.triggerEl = triggerEl
  quantityPopover.visible = true
  if (!readonly) focusQuantityInput('quantity')
}

function closeQuantityPopover() {
  quantityPopover.visible = false
  quantityPopover.row = null
  quantityPopover.triggerEl = null
  suppressQuantityFocusOpen = true
  if (suppressQuantityFocusTimer) clearTimeout(suppressQuantityFocusTimer)
  suppressQuantityFocusTimer = setTimeout(() => {
    suppressQuantityFocusOpen = false
    suppressQuantityFocusTimer = null
  }, 300)
}

function cancelQuantityPopover() {
  const row = quantityPopover.row
  const side = quantityPopover.side
  closeQuantityPopover()
  if (row && !isReadonly.value) {
    nextTick(() => {
      findQuantityCellEl(row, side)?.focus()
    })
  }
}

/** 确定：数量必填，单价与金额至少一个；回填分录并跳到下一行 */
function confirmQuantityPopover() {
  const row = quantityPopover.row
  if (!row) return
  const qty = Number(quantityPopover.quantity)
  if (!Number.isFinite(qty) || qty === 0) {
    showWarning('请输入数量')
    focusQuantityInput('quantity')
    return
  }
  const price = Number(quantityPopover.unitPrice) || 0
  let amount = Number(quantityPopover.amount) || 0
  if (!price && !amount) {
    showWarning('请输入单价或金额')
    focusQuantityInput('unitPrice')
    return
  }
  if (!amount) amount = Math.round(qty * price * 100) / 100
  const unitPrice = price || Math.round((amount / qty) * 10000) / 10000

  const side = quantityPopover.side
  row.quantity = qty
  row.unit_price = unitPrice
  row.unit = quantityPopover.unit || null
  if (side === 'debit') {
    row.debit_amount = amount
    row.credit_amount = null
  } else {
    row.credit_amount = amount
    row.debit_amount = null
  }
  row.direction = side
  row.amount = amount
  props.onAmountChange(row, side)
  closeQuantityPopover()
  moveToNextRow(row)
}

function findQuantityCellEl(row: any, side: 'debit' | 'credit'): HTMLElement | null {
  const tableEl = document.querySelector('.voucher-table')
  if (!tableEl) return null
  const rowIdx = props.form.entries.indexOf(row)
  if (rowIdx === -1) return null
  const tr = tableEl.querySelectorAll('.el-table__body-wrapper tbody tr')[rowIdx]
  const cell = tr?.querySelectorAll('td')[side === 'debit' ? 2 : 3]
  return (cell?.querySelector('.foreign-amount-cell') as HTMLElement | null) || null
}

function onQuantityCellFocus(row: any, side: 'debit' | 'credit', event: Event) {
  if (isLockedCashRow(row)) return
  if (event.type === 'focus' && suppressQuantityFocusOpen) return
  const el = (event.currentTarget as HTMLElement | null) || findQuantityCellEl(row, side)
  openQuantityPopover(row, side, el)
}

function onQuantityCellKeydown(row: any, side: 'debit' | 'credit', event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    stopEnterBubble(event)
    const el = (event.currentTarget as HTMLElement | null) || findQuantityCellEl(row, side)
    openQuantityPopover(row, side, el)
  }
}

/** 切换科目后同步数量字段：非数量科目清空，数量科目带出科目单位 */
function ensureQuantityDefaults(entry: any) {
  if (!entry?.account_id) return
  const acc = props.accounts.find(a => a.id === entry.account_id) as any
  if (!acc || Number(acc.is_quantity) !== 1) {
    entry.quantity = null
    entry.unit_price = null
    entry.unit = null
    return
  }
  entry.unit = acc.quantity_unit || entry.unit || null
}

// 现金/银行标志决定控件是否显示；账套开关只决定是否必填。
const cashFlowRequired = computed(
  () => props.enableCashFlow && showCashFlowForCurrentEntry.value
)

function onCashFlowCodeChange(code: string) {
  if (!props.currentEntry) return
  const item = props.cashFlowItems.find(cf => cf.code === code)
  props.currentEntry.cash_flow_name = item?.name || ''
}

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'ai-summary': []
  submit: []
  'submit-and-add': []
  'update:attachments': [attachments: any[]]
  'queue-upload': [files: File[]]
  'remove-queued-upload': [fileKey: string]
  navigate: [direction: 'first' | 'previous' | 'next' | 'last']
  'clear-current-entry': []
  'add-aux-item': [item: { id: string; name: string; type: string }, catCode: string]
  print: []
  quickCreateAccount: [row: any]
  'turn-template': []
  'import-template': []
}>()

// Attachments data
const attachments = ref(props.attachments || [])

// File input ref
const fileInput = ref<HTMLInputElement>()

// Preview state
const previewVisible = ref(false)
const previewAttachment = ref<any>(null)

// 记录原始凭证号（用于检测是否修改）
const originalVoucherNo = ref('')
watch(
  () => props.form.id,
  newId => {
    if (newId && props.mode === 'edit') {
      originalVoucherNo.value = props.form.voucher_no
    }
  },
  { immediate: true }
)

// 凭证号失焦时，如果修改了则调用后端更新
async function handleVoucherNoBlur() {
  if (props.mode !== 'edit' || !props.form.id) return
  const newNo = props.form.voucher_no?.trim()
  if (!newNo || newNo === originalVoucherNo.value) return

  try {
    await request.put(`/voucher/vouchers/${props.form.id}/number`, {
      voucher_no: newNo,
      voucher_type_id: props.form.voucher_type_id,
    })
    originalVoucherNo.value = newNo
    showSuccess('凭证编号已更新')
  } catch (error: any) {
    showError(error.response?.data?.message || '凭证编号更新失败')
    // 恢复原值
    props.form.voucher_no = originalVoucherNo.value
  }
}

// Watch for attachments update
watch(
  () => props.attachments,
  newVal => {
    attachments.value = newVal || []
  },
  { deep: true }
)

// 凭证类型或日期变化时，实时计算下一个凭证号
let voucherNoTimer: ReturnType<typeof setTimeout> | null = null
function fetchNextVoucherNo() {
  if (voucherNoTimer) clearTimeout(voucherNoTimer)
  voucherNoTimer = setTimeout(async () => {
    if (!props.form.voucher_date) return
    try {
      const res = await request.get<{ voucher_no: string }>('/voucher/next-voucher-no', {
        params: {
          voucher_type_id: props.form.voucher_type_id || undefined,
          voucher_date: props.form.voucher_date,
        },
      })
      if (res.data?.voucher_no) {
        props.form.voucher_no = res.data.voucher_no
      }
    } catch {
      // ignore
    }
  }, 300)
}

// watch 凭证类型变化
watch(
  () => props.form.voucher_type_id,
  () => fetchNextVoucherNo()
)
// watch 日期变化
watch(
  () => props.form.voucher_date,
  () => fetchNextVoucherNo()
)

// Handle file upload
async function handleFileUpload(files: File[]) {
  if (!props.form.id) {
    const queuedAttachments = files.map(file => {
      const fileKey = `${file.name}_${file.size}_${file.lastModified}`
      return {
        id: `pending-${fileKey}`,
        filename: file.name,
        original_name: file.name,
        file_path: '',
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        created_at: new Date().toISOString(),
        temp_file_key: fileKey,
      }
    })

    attachments.value = [...attachments.value, ...queuedAttachments]
    emit('update:attachments', attachments.value)
    emit('queue-upload', files)
    showSuccess(`已添加 ${files.length} 个待上传附件，保存凭证后自动上传`)
    return
  }

  for (const file of files) {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await request.post<any[]>(
        `/voucher/vouchers/${props.form.id}/attachments`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      )

      // 更新附件列表
      const uploaded = Array.isArray(response.data) ? response.data : []
      attachments.value = [...attachments.value, ...uploaded]
      emit('update:attachments', attachments.value)
      showSuccess(`附件 "${file.name}" 上传成功`)
    } catch (error) {
      showError(`附件 "${file.name}" 上传失败`)
      console.error('File upload error:', error)
    }
  }
}

// Handle file delete
async function handleFileDelete(file: any) {
  try {
    if (!props.form.id || String(file.id || '').startsWith('pending-')) {
      attachments.value = attachments.value.filter(att => att.id !== file.id)
      emit('update:attachments', attachments.value)
      if (file.temp_file_key) {
        emit('remove-queued-upload', file.temp_file_key)
      }
      showSuccess('已移除待上传附件')
      return
    }

    await request.delete(`/voucher/vouchers/${props.form.id}/attachments/${file.id}`)

    // 更新附件列表
    attachments.value = attachments.value.filter(att => att.id !== file.id)
    emit('update:attachments', attachments.value)
    showSuccess('附件删除成功')
  } catch (error) {
    showError('附件删除失败')
    console.error('File delete error:', error)
  }
}

// Handle file download
function handleFileDownload(file: any) {
  const url = buildFileUrl(file.file_path)
  const link = document.createElement('a')
  link.href = url
  link.download = file.original_name
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Trigger file input
function triggerFileInput() {
  fileInput.value?.click()
}

// Handle file input change
function onFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  if (files.length > 0) {
    handleFileUpload(files)
  }
  target.value = ''
}

// Preview helpers
function isImage(mimeType?: string) {
  return mimeType?.startsWith('image/') || false
}

// Build full URL for static file
function buildFileUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('http')) return filePath
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}${filePath.startsWith('/') ? filePath : '/' + filePath}`
}

// Handle attachment click: image -> preview, others -> download
function handleAttachmentClick(file: any) {
  if (isImage(file.mime_type)) {
    previewAttachment.value = file
    previewVisible.value = true
  } else {
    handleFileDownload(file)
  }
}

function closePreview() {
  previewVisible.value = false
  previewAttachment.value = null
}

function handlePreviewError() {
  showError('图片加载失败')
  closePreview()
}

const visible = ref(props.modelValue)

watch(
  () => props.modelValue,
  val => {
    visible.value = val
  }
)

watch(visible, val => {
  emit('update:modelValue', val)
})

function handleCurrentEntryChange(row: VoucherEntry | null) {
  if (row) {
    props.setCurrentEntry(row)
  } else {
    // 点击已选中行时 el-table 会传 null，清除当前分录和高亮
    props.setCurrentEntry(null)
    nextTick(() => {
      const tableEl = document.querySelector('.voucher-table')
      if (tableEl) {
        const rows = tableEl.querySelectorAll('.el-table__body-wrapper tbody tr')
        rows.forEach(tr => tr.classList.remove('current-row'))
      }
    })
  }
}

function handleRowClick(row: VoucherEntry) {
  if (isReadonly.value) {
    props.setCurrentEntry(row)
  }
}

/** 按当前开关取科目展示文本；全路径模式下查不到科目时回落到分录快照，避免历史凭证显示 '-' */
function getAccountDisplay(row: VoucherEntry): string {
  if (accountDisplayMode.value === 'full') {
    const acc =
      props.accounts.find(a => a.id === row.account_id) ||
      (row.account_code ? props.accounts.find(a => a.code === row.account_code) : null)
    if (acc) return formatAccountFullPath(acc.code, acc.id, props.accounts, acc.name)
  }
  if (row.account_code || row.account_name) {
    return `${row.account_code || ''} ${row.account_name || ''}`.trim()
  }
  const acc = props.accounts.find(a => a.id === row.account_id)
  return acc ? `${acc.code} ${acc.name}` : '-'
}

/**
 * 科目单元格/输入框/候选项统一的展示文本，跟随「科目显示」开关。
 * 传 accounts 里的科目对象，或任何带 id/code/name 的对象均可。
 */
function accountInputText(acc: any): string {
  if (!acc) return ''
  if (accountDisplayMode.value === 'full') {
    return formatAccountFullPath(acc.code, acc.id, props.accounts, acc.name)
  }
  return `${acc.code || ''} ${acc.name || ''}`.trim()
}

/** autocomplete 下拉候选项的展示文本（父科目分组标题维持「编码 名称」不变） */
function getSuggestionLabel(item: any): string {
  if (item?.isParent) return `${item?.code || ''} ${item?.name || ''}`.trim()
  return accountInputText(item)
}

function getAuxItemName(cat: any, entry: VoucherEntry | null): string {
  if (!entry) return '-'
  const itemId = entry[`_${cat.code}_id`]
  if (!itemId) return '-'
  return props.resolveAuxItemName(cat.id, cat.code, itemId, entry)
}

function onAuxItemChange(cat: any, itemId: string) {
  if (!props.currentEntry) return
  if (!itemId) {
    props.currentEntry[`_${cat.code}_name`] = ''
    return
  }
  const item = props.getAuxOptions(cat.id).find(i => i.id === itemId)
  props.currentEntry[`_${cat.code}_name`] = item?.name || props.currentEntry[`_${cat.code}_name`] || ''
}

function getAuxFieldDisplayValue(cat: any, field: any, entry: VoucherEntry | null): string {
  if (!entry) return '-'
  const val = entry[`_${cat.code}_fv_${field.field_key}`]
  if (val == null || val === '') return '-'
  return String(val)
}

function getCashFlowDisplay(entry: VoucherEntry | null): string {
  if (!entry?.cash_flow_code) return '-'
  const item = props.cashFlowItems.find(cf => cf.code === entry.cash_flow_code)
  if (item) return `${item.code} ${item.name}`
  return entry.cash_flow_name || entry.cash_flow_code
}

function getAuxItemId(cat: any, entry: VoucherEntry | null): string {
  if (!entry) return ''
  const itemId = entry[`_${cat.code}_id`]
  return itemId ? String(itemId) : ''
}

function resolveEntryAccountCode(entry: VoucherEntry): string {
  if (entry.account_code) return entry.account_code
  const acc = props.accounts.find(a => a.id === entry.account_id)
  return acc?.code || ''
}

function resolveEntryAccountId(entry: VoucherEntry): string {
  if (entry.account_id) return String(entry.account_id)
  const code = resolveEntryAccountCode(entry)
  if (!code) return ''
  const acc = props.accounts.find(a => a.code === code)
  return acc?.id ? String(acc.id) : ''
}

function buildVoucherYearDateRange(): { start_date: string; end_date: string } {
  const voucherDate = props.form.voucher_date
  if (voucherDate) {
    const year = voucherDate.slice(0, 4)
    return { start_date: `${year}-01-01`, end_date: `${year}-12-31` }
  }
  const year = new Date().getFullYear()
  return { start_date: `${year}-01-01`, end_date: `${year}-12-31` }
}

function saveDrillDownContext(entry: VoucherEntry) {
  if (!props.form.id) return
  const entryIndex = props.form.entries.indexOf(entry)
  const currentEntryKey = buildEntryKey(entry, entryIndex >= 0 ? entryIndex : undefined)
  voucherModalReturnStore.saveBeforeDrillDown({
    voucherId: String(props.form.id),
    sourcePath: route.path,
    mode: props.mode === 'view' ? 'view' : 'edit',
    currentEntryKey: currentEntryKey || undefined,
  })
}

function navigateToAccountDetail(entry: VoucherEntry) {
  const accountId = resolveEntryAccountId(entry)
  const accountCode = resolveEntryAccountCode(entry)
  if (!accountId && !accountCode) {
    showWarning('该分录未选择科目')
    return
  }

  saveDrillDownContext(entry)
  const { start_date, end_date } = buildVoucherYearDateRange()
  const query: Record<string, string> = { start_date, end_date, from: 'voucher' }
  if (accountId) query.account_id = accountId
  else query.account_code = accountCode

  handleClose()
  router.push({ path: '/ledger/detail', query })
}

function handleRowDblclick(row: VoucherEntry) {
  if (!isReadonly.value) return
  navigateToAccountDetail(row)
}

function handleBalanceDisplayDblclick() {
  if (!props.currentEntry) return
  navigateToAccountDetail(props.currentEntry)
}

function navigateToAuxDetail(entry: VoucherEntry, cat: any) {
  const auxId = getAuxItemId(cat, entry)
  const accountCode = resolveEntryAccountCode(entry)
  if (!auxId) {
    showWarning('该分录未选择辅助项目')
    return
  }
  if (!accountCode) {
    showWarning('无法识别科目编码')
    return
  }

  saveDrillDownContext(entry)
  const { start_date, end_date } = buildVoucherYearDateRange()
  handleClose()
  router.push({
    path: '/ledger/aux-detail',
    query: {
      aux_category_ids: String(cat.id),
      aux_ids: auxId,
      account_code: accountCode,
      start_date,
      end_date,
      from: 'voucher',
    },
  })
}

function handleAuxTagDblclick(entry: VoucherEntry | null, cat: any, event: MouseEvent) {
  event.stopPropagation()
  if (!entry) return
  navigateToAuxDetail(entry, cat)
}

function getSummary() {
  return [
    '',
    '',
    `借: ${formatMoney(props.totalDebit)}`,
    `贷: ${formatMoney(props.totalCredit)}`,
    '',
  ]
}

function formatMoney(val: number) {
  return formatAmount(val || 0)
}

function handleClose() {
  visible.value = false
}

// ========== 当前选中科目的余额查询 ==========
// 不考虑记账因素，直接从 init_balances（期初）+ 所有凭证分录实时汇总

const currentEntryBalance = ref<{
  id: string
  code: string
  name: string
  direction: string
  end_balance: number
  isSameSide: boolean
} | null>(null)

const currentEntryAuxBalances = ref<
  {
    category_code: string
    category_name: string
    item_id: string
    item_name: string
    direction: string
    end_balance: number
    isSameSide: boolean
  }[]
>([])

let balanceFetchTimer: ReturnType<typeof setTimeout> | null = null

function getBalanceQueryParams() {
  const voucherDate = props.form.voucher_date
  const d = voucherDate ? new Date(voucherDate) : new Date()
  return {
    year: d.getFullYear(),
    period: d.getMonth() + 1,
  }
}

function buildAuxBalanceSelections(): string {
  const entry = props.currentEntry
  if (!entry) return ''
  const parts: string[] = []
  for (const cat of props.currentEntryAuxCategories) {
    const itemId = entry[`_${cat.code}_id`]
    if (itemId) {
      parts.push(`${cat.code}:${itemId}`)
    }
  }
  return parts.join(',')
}

async function fetchCurrentEntryBalance() {
  if (!props.currentEntry?.account_id) {
    currentEntryBalance.value = null
    currentEntryAuxBalances.value = []
    return
  }
  const acc = props.accounts.find(a => a.id === props.currentEntry!.account_id)
  if (!acc) {
    currentEntryBalance.value = null
    currentEntryAuxBalances.value = []
    return
  }

  const queryParams = getBalanceQueryParams()

  try {
    const res = await request.get<any>(`/base/accounts/${acc.id}/realtime-balance`, {
      params: queryParams,
    })
    const data = res.data
    if (data && data.end_balance !== undefined) {
      const endBalance = data.end_balance || 0
      const balanceDirection =
        endBalance >= 0 ? data.direction : data.direction === 'debit' ? 'credit' : 'debit'
      const isSameSide = balanceDirection === acc.direction
      currentEntryBalance.value = {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        direction: balanceDirection,
        end_balance: Math.abs(endBalance),
        isSameSide,
      }
    } else {
      currentEntryBalance.value = null
    }
  } catch {
    currentEntryBalance.value = null
  }

  const selections = buildAuxBalanceSelections()
  if (!selections) {
    currentEntryAuxBalances.value = []
    return
  }

  try {
    const auxRes = await request.get<any[]>(`/base/accounts/${acc.id}/realtime-aux-balances`, {
      params: { ...queryParams, selections },
    })
    const catNameMap = new Map(props.currentEntryAuxCategories.map(c => [c.code, c.name]))
    currentEntryAuxBalances.value = (auxRes.data || []).map((row: any) => {
      const endBalance = row.end_balance || 0
      const balanceDirection =
        endBalance >= 0 ? row.direction : row.direction === 'debit' ? 'credit' : 'debit'
      return {
        category_code: row.category_code,
        category_name: catNameMap.get(row.category_code) || row.category_code,
        item_id: row.item_id,
        item_name: row.item_name || '',
        direction: balanceDirection,
        end_balance: Math.abs(endBalance),
        isSameSide: row.is_same_side ?? balanceDirection === acc.direction,
      }
    })
  } catch {
    currentEntryAuxBalances.value = []
  }
}

function getAuxBalanceWatchDeps(): unknown[] {
  const entry = props.currentEntry
  const auxIds = props.currentEntryAuxCategories.map(cat =>
    entry ? entry[`_${cat.code}_id`] : null
  )
  return [
    entry?.account_id,
    entry?.debit_amount,
    entry?.credit_amount,
    props.form.voucher_date,
    ...auxIds,
  ]
}

// 监听当前分录及辅助项目变化，防抖查询余额
watch(
  getAuxBalanceWatchDeps,
  () => {
    if (balanceFetchTimer) clearTimeout(balanceFetchTimer)
    balanceFetchTimer = setTimeout(fetchCurrentEntryBalance, 300)
  },
  { immediate: true }
)

watch(
  () => [props.currentEntry, props.currentEntryAuxCategories] as const,
  () => {
    if (props.currentEntry) {
      void props.ensureSelectedForEntry(props.currentEntry)
    }
  },
  { immediate: true }
)

// ========== 新建辅助项目 ==========

const addAuxItemDialogVisible = ref(false)
const addAuxItemCat = ref<any>(null)
const addAuxItemCode = ref('')
const addAuxItemName = ref('')
const addAuxItemFieldValues = ref<Record<string, any>>({})
const addAuxItemLoading = ref(false)

const addAuxItemRequiredFields = computed(() => {
  if (!addAuxItemCat.value?.fields) return []
  return addAuxItemCat.value.fields.filter((f: any) => f.is_enabled !== 0 && f.required_in_archive)
})

async function openAddAuxItemDialog(cat: any) {
  addAuxItemCat.value = cat
  addAuxItemCode.value = await props.fetchNextAuxCode(cat.id)
  addAuxItemName.value = ''
  addAuxItemFieldValues.value = {}
  addAuxItemDialogVisible.value = true
}

async function submitAddAuxItem() {
  const code = addAuxItemCode.value.trim()
  const name = addAuxItemName.value.trim()
  if (!name) {
    showError('名称不能为空')
    return
  }
  // 校验档案必填字段
  for (const field of addAuxItemRequiredFields.value) {
    const val = addAuxItemFieldValues.value[field.field_key]
    if (val === undefined || val === null || String(val).trim() === '') {
      showError(`"${field.field_name}" 为必填字段`)
      return
    }
  }
  const cat = addAuxItemCat.value
  if (!cat) return
  addAuxItemLoading.value = true
  try {
    const res = await request.post<any>('/base/aux-items', {
      code,
      name,
      type: cat.id,
      field_values: addAuxItemFieldValues.value,
    })
    const newItem = { id: res.data.id, name, code, type: cat.id }
    emit('add-aux-item', newItem, cat.code)
    addAuxItemDialogVisible.value = false
    showSuccess(`已新建${cat.name}：${name}`)
  } catch (e: any) {
    showError(e?.response?.data?.message || '新建失败')
  } finally {
    addAuxItemLoading.value = false
  }
}

// ========== 辅助核算自定义字段（凭证录入） ==========

function getVoucherFields(cat: any) {
  return (cat.fields || []).filter(
    (f: any) => f.is_enabled !== 0 && !!f.show_in_voucher
  )
}

function parseFieldOpts(optionsJson: string | null): string[] {
  if (!optionsJson) return []
  try {
    const arr = JSON.parse(optionsJson)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// ========== 回车 / Tab 智能导航 ==========

type VoucherFocusStep =
  | { kind: 'cash_flow' }
  | { kind: 'aux_select'; catCode: string }
  | { kind: 'aux_field'; catCode: string; fieldKey: string }
  | { kind: 'amount'; side: 'debit' | 'credit' }

function getAuxCategoryIdsForAccount(acc: any): string[] {
  if (!acc?.aux_types) return []
  try {
    const parsed = typeof acc.aux_types === 'string' ? JSON.parse(acc.aux_types) : acc.aux_types
    let ids: string[] = []
    if (Array.isArray(parsed)) ids = parsed
    else if (parsed && typeof parsed === 'object') ids = Object.keys(parsed)
    return ids
      .map(id => String(id))
      .filter(id => {
        const cat = props.auxCategories.find(c => String(c.id) === id)
        return cat && !isAuxCategoryExcludedFromAccount(cat.code)
      })
  } catch {
    return []
  }
}

function getEntryAuxCategories(row: VoucherEntry) {
  const acc = props.accounts.find(a => a.id === row.account_id)
  if (!acc?.is_aux) return []
  const linkedIds = new Set(getAuxCategoryIdsForAccount(acc))
  return props.auxCategories.filter(cat => linkedIds.has(String(cat.id)))
}

function buildVoucherFocusSteps(row: VoucherEntry): VoucherFocusStep[] {
  const steps: VoucherFocusStep[] = []
  const acc = props.accounts.find(a => a.id === row.account_id)
  if (!acc) {
    return [{ kind: 'amount', side: 'debit' }]
  }

  if (accountNeedsCashFlowItem(acc)) {
    steps.push({ kind: 'cash_flow' })
  }

  for (const cat of getEntryAuxCategories(row)) {
    steps.push({ kind: 'aux_select', catCode: cat.code })
    if (row[`_${cat.code}_id`]) {
      for (const field of getVoucherFields(cat)) {
        steps.push({ kind: 'aux_field', catCode: cat.code, fieldKey: field.field_key })
      }
    }
  }

  steps.push({ kind: 'amount', side: acc.direction === 'credit' ? 'credit' : 'debit' })
  return steps
}

function focusStepEquals(a: VoucherFocusStep, b: VoucherFocusStep): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'cash_flow' && b.kind === 'cash_flow') return true
  if (a.kind === 'aux_select' && b.kind === 'aux_select') return a.catCode === b.catCode
  if (a.kind === 'aux_field' && b.kind === 'aux_field') {
    return a.catCode === b.catCode && a.fieldKey === b.fieldKey
  }
  return false
}

function focusStepSelector(step: VoucherFocusStep): string {
  if (step.kind === 'cash_flow') return '[data-voucher-focus="cash-flow"]'
  if (step.kind === 'aux_select') return `[data-voucher-focus="aux-select-${step.catCode}"]`
  if (step.kind === 'aux_field') {
    return `[data-voucher-focus="aux-field-${step.catCode}-${step.fieldKey}"]`
  }
  return ''
}

function isSelectDropdownOpen(): boolean {
  const poppers = document.querySelectorAll('.el-select-dropdown')
  for (const popper of poppers) {
    const el = popper as HTMLElement
    if (el.offsetParent !== null && el.clientHeight > 0) return true
  }
  return false
}

function focusVoucherField(step: VoucherFocusStep): boolean {
  const selector = focusStepSelector(step)
  if (!selector) return false
  const host = document.querySelector(selector)
  if (!host) return false
  const input =
    (host.querySelector('input:not([type="hidden"])') as HTMLInputElement | HTMLElement | null) ||
    (host.querySelector('.el-select__wrapper') as HTMLElement | null)
  if (!input) return false
  ;(input as HTMLElement).focus()
  if (input instanceof HTMLInputElement && typeof input.select === 'function') {
    input.select()
  }
  return true
}

function focusAmountForRow(row: VoucherEntry, side: 'debit' | 'credit') {
  focusCellInput(row, side === 'debit' ? 2 : 3)
}

function advanceVoucherFocus(row: VoucherEntry, fromStep: VoucherFocusStep | null) {
  props.setCurrentEntry(row)
  const run = () => {
    const steps = buildVoucherFocusSteps(row)
    const startIdx = fromStep ? steps.findIndex(s => focusStepEquals(s, fromStep)) : -1
    for (let i = startIdx + 1; i < steps.length; i++) {
      const step = steps[i]
      if (step.kind === 'aux_field' && !row[`_${step.catCode}_id`]) continue
      if (step.kind === 'amount') {
        focusAmountForRow(row, step.side)
        return
      }
      if (focusVoucherField(step)) return
    }
    const acc = props.accounts.find(a => a.id === row.account_id)
    focusAmountForRow(row, acc?.direction === 'credit' ? 'credit' : 'debit')
  }
  // 从科目进入时需等待辅助核算面板渲染
  if (fromStep === null) {
    nextTick(() => nextTick(run))
  } else {
    nextTick(run)
  }
}

function stopEnterBubble(event?: KeyboardEvent) {
  if (!event) return
  event.preventDefault()
  event.stopPropagation()
}

function onVoucherFieldKeydown(
  row: VoucherEntry | null,
  step: VoucherFocusStep,
  event: KeyboardEvent
) {
  if (!row) return
  if (event.key !== 'Enter' && event.key !== 'Tab') return
  if (event.key === 'Enter' && isSelectDropdownOpen()) return
  stopEnterBubble(event)
  advanceVoucherFocus(row, step)
}

// 摘要回车 → 跳到科目
function moveToAccount(row: VoucherEntry, event?: KeyboardEvent) {
  stopEnterBubble(event)
  focusCellInput(row, 1) // 第2列：会计科目
}

// 科目回车 / Tab → 依次经过现金流量、辅助项目，最后到金额
function onAccountEnter(row: VoucherEntry, event?: KeyboardEvent) {
  stopEnterBubble(event)
  if (!row.account_id) return
  const acc = props.accounts.find(a => a.id === row.account_id)
  if (!acc) return
  advanceVoucherFocus(row, null)
}

function onAccountTab(row: VoucherEntry, event: KeyboardEvent) {
  if (!row.account_id) return
  if (isSelectDropdownOpen()) return
  event.preventDefault()
  advanceVoucherFocus(row, null)
}

// 借方金额回车 → 跳到下一行
function onDebitEnter(row: VoucherEntry, event?: KeyboardEvent) {
  stopEnterBubble(event)
  syncInputAmount(row, event, 'debit')
  moveToNextRow(row)
}

// 贷方金额回车 → 跳到下一行
function onCreditEnter(row: VoucherEntry, event?: KeyboardEvent) {
  stopEnterBubble(event)
  syncInputAmount(row, event, 'credit')
  moveToNextRow(row)
}

function syncInputAmount(
  row: VoucherEntry,
  event: KeyboardEvent | undefined,
  side: 'debit' | 'credit'
) {
  const input = event?.target as HTMLInputElement | null
  if (!input) return
  const rawValue = String(input.value || '')
    .replace(/,/g, '')
    .trim()
  if (!rawValue) {
    if (side === 'debit') {
      row.debit_amount = null
    } else {
      row.credit_amount = null
    }
    return
  }
  const amount = Number(rawValue)
  if (!Number.isFinite(amount)) return

  if (side === 'debit') {
    row.debit_amount = amount
    props.onAmountChange(row, 'debit')
  } else {
    row.credit_amount = amount
    props.onAmountChange(row, 'credit')
  }
}

// ============= 借方金额快捷键 =============

function onDebitKeydown(row: VoucherEntry, event: KeyboardEvent) {
  const key = event.key
  if (key === '=') {
    event.preventDefault()
    // = → 自动平衡：计算使借贷平衡所需的差额填入当前行借方
    const otherDebit = props.totalDebit - (row.debit_amount || 0)
    const diff = +(props.totalCredit - otherDebit).toFixed(2)
    if (diff !== 0) {
      row.debit_amount = diff
      props.onAmountChange(row, 'debit')
    }
  } else if (key === ' ') {
    event.preventDefault()
    // 空格 → 互换方向：当前借方金额移到贷方，清空借方
    const debit = row.debit_amount || 0
    if (debit !== 0) {
      row.credit_amount = debit
      row.debit_amount = null
      props.onAmountChange(row, 'credit')
    }
  }
}

// ============= 贷方金额快捷键 =============

function onCreditKeydown(row: VoucherEntry, event: KeyboardEvent) {
  const key = event.key
  if (key === '=') {
    event.preventDefault()
    // = → 自动平衡：计算使借贷平衡所需的差额填入当前行贷方
    const otherCredit = props.totalCredit - (row.credit_amount || 0)
    const diff = +(props.totalDebit - otherCredit).toFixed(2)
    if (diff !== 0) {
      row.credit_amount = diff
      props.onAmountChange(row, 'credit')
    }
  } else if (key === ' ') {
    event.preventDefault()
    // 空格 → 互换方向：当前贷方金额移到借方，清空贷方
    const credit = row.credit_amount || 0
    if (credit !== 0) {
      row.debit_amount = credit
      row.credit_amount = null
      props.onAmountChange(row, 'debit')
    }
  }
}

// 跳到下一行，并把试算平衡差额自动填入下一条空分录
function moveToNextRow(currentRow: VoucherEntry) {
  const idx = props.form.entries.indexOf(currentRow)
  if (idx === -1) return

  // 如果不是最后一行，跳到下一行
  if (idx < props.form.entries.length - 1) {
    const nextRow = props.form.entries[idx + 1]
    // 复制摘要
    if (!nextRow.summary && currentRow.summary) {
      nextRow.summary = currentRow.summary
    }
    const balanced = autoBalanceNextRow(nextRow)
    focusCellInput(nextRow, balanced ? 1 : 0)
    return
  }

  // 是最后一行，新增分录并在新行自动补齐差额
  props.addEntry()
  const newRow = props.form.entries[props.form.entries.length - 1]
  // 复制摘要
  if (currentRow.summary) {
    newRow.summary = currentRow.summary
  }
  const balanced = autoBalanceNextRow(newRow)
  // 延迟聚焦，等 DOM 更新
  nextTick(() => {
    focusCellInput(newRow, balanced ? 1 : 0)
  })
}

function getCurrentEntryTotals() {
  return props.form.entries.reduce(
    (totals, entry) => {
      totals.debit += Number(entry.debit_amount || 0)
      totals.credit += Number(entry.credit_amount || 0)
      return totals
    },
    { debit: 0, credit: 0 }
  )
}

// 自动平衡：把当前借贷差额填入下一条空分录，等同于在金额栏按 =
function autoBalanceNextRow(row: VoucherEntry) {
  if ((row.debit_amount || 0) !== 0 || (row.credit_amount || 0) !== 0) {
    return false
  }

  const { debit, credit } = getCurrentEntryTotals()
  const diff = +Math.abs(debit - credit).toFixed(2)
  if (diff < 0.005) return false

  if (debit > credit) {
    row.credit_amount = diff
    props.onAmountChange(row, 'credit')
    return true
  }

  if (credit > debit) {
    row.debit_amount = diff
    props.onAmountChange(row, 'debit')
    return true
  }

  return false
}

// 聚焦表格指定单元格内的 input
function focusCellInput(row: VoucherEntry, colIndex: number) {
  nextTick(() => {
    const tableEl = document.querySelector('.voucher-table')
    if (!tableEl) return
    const rowIdx = props.form.entries.indexOf(row)
    if (rowIdx === -1) return
    // el-table 的行顺序
    const rows = tableEl.querySelectorAll('.el-table__body-wrapper tbody tr')
    const tr = rows[rowIdx]
    if (!tr) return
    const cells = tr.querySelectorAll('td')
    const cell = cells[colIndex]
    if (!cell) return
    const input = cell.querySelector('input') as HTMLInputElement | null
    if (input) {
      input.focus()
      input.select()
      return
    }
    // 外币 / 数量科目的金额格没有 input，聚焦只读格即会弹出对应气泡
    const foreignCell = cell.querySelector('.foreign-amount-cell') as HTMLElement | null
    if (foreignCell) foreignCell.focus()
  })
}

// ========== 会计科目智能输入（重做：基于 el-autocomplete） ==========
type AccountInputState = {
  input: string
}

type AccountSuggestion = {
  value: string
  id: string
  code: string
  name: string
  isParent: boolean
  disabled: boolean
  auxNames: string[]
}

const accountRowKeyMap = new WeakMap<object, string>()
const accountInputStateMap = ref<Record<string, AccountInputState>>({})
let accountInputSeed = 0

// 当 accounts 数据变化时，刷新已有但为空的 input state
watch(
  () => props.accounts,
  () => {
    for (const row of props.form.entries) {
      if (!row.account_id) continue
      const key = getAccountRowKey(row)
      const state = accountInputStateMap.value[key]
      if (state && !state.input) {
        const acc = props.accounts.find(a => a.id === row.account_id)
        if (acc) {
          state.input = accountInputText(acc)
        }
      }
    }
  },
  { deep: true }
)

// 当 form.entries 变化时（加载新凭证），重新初始化科目输入缓存
watch(
  () => props.form.entries,
  () => {
    // 清空旧缓存
    accountInputStateMap.value = {}
    // 为每个有 account_id 的行预填科目信息
    nextTick(() => {
      for (const row of props.form.entries) {
        if (!row.account_id) continue
        const key = getAccountRowKey(row)
        const acc = props.accounts.find(a => a.id === row.account_id)
        if (acc) {
          accountInputStateMap.value[key] = { input: accountInputText(acc) }
        }
      }
    })
  }
)

// 切换「科目显示」开关时，刷新已缓存的科目输入框文本
watch(accountDisplayMode, () => {
  for (const row of props.form.entries) {
    if (!row.account_id) continue
    const state = accountInputStateMap.value[getAccountRowKey(row)]
    if (!state) continue
    const acc = props.accounts.find(a => a.id === row.account_id)
    if (acc) state.input = accountInputText(acc)
  }
})

function getAccountRowKey(row: any): string {
  const rowObject = row as object
  let key = accountRowKeyMap.get(rowObject)
  if (!key) {
    accountInputSeed += 1
    key = `voucher-account-${accountInputSeed}`
    accountRowKeyMap.set(rowObject, key)
  }
  return key
}

function ensureAccountInputState(row: any): AccountInputState {
  const key = getAccountRowKey(row)
  let state = accountInputStateMap.value[key]
  if (!state) {
    const acc = row.account_id ? props.accounts.find(a => a.id === row.account_id) : null
    state = {
      input: acc ? accountInputText(acc) : '',
    }
    accountInputStateMap.value[key] = state
  }
  return state
}

function getAccountInput(row: any): string {
  const key = getAccountRowKey(row)
  return accountInputStateMap.value[key]?.input ?? ''
}

function buildAccountSuggestion(acc: any): AccountSuggestion {
  const isParent = props.isParentAccount(acc.id)
  return {
    value: accountInputText(acc),
    id: acc.id,
    code: acc.code,
    name: acc.name,
    isParent,
    disabled: false, // 父科目不进入列表，所以 disabled 无需设置
    auxNames: props.getAuxItemNames(acc) || [],
  }
}

function buildParentHeader(acc: any): AccountSuggestion {
  return {
    value: `__parent__${acc.id}`, // 特殊前缀，select 时识别并忽略
    id: acc.id,
    code: acc.code,
    name: acc.name,
    isParent: true,
    disabled: false,
    auxNames: [],
  }
}

function queryAccountSuggestions(
  row: any,
  queryString: string,
  cb: (items: AccountSuggestion[]) => void
) {
  const state = ensureAccountInputState(row)
  const query = (queryString || state.input || '').trim().toLowerCase()

  // 只取叶子科目（父科目不参与键盘导航）
  const leafAccounts = props.accounts.filter(a => !props.isParentAccount(a.id))
  // 父科目单独列出，用于分组标题显示
  const parentAccounts = props.accounts.filter(a => props.isParentAccount(a.id))

  if (!query) {
    // 空查询时，也显示父科目作为分组标题
    const result: AccountSuggestion[] = []
    const addedParents = new Set<string>()

    for (const leaf of leafAccounts) {
      // 找到该叶子科目的直接父科目
      const parent = parentAccounts.find(
        p => String(leaf.code || '').startsWith(String(p.code || '')) && leaf.id !== p.id
      )
      if (parent && !addedParents.has(parent.id)) {
        result.push(buildParentHeader(parent))
        addedParents.add(parent.id)
      }
      result.push(buildAccountSuggestion(leaf))
    }

    cb(result)
    return
  }

  // 匹配叶子科目
  const matchedLeaf = leafAccounts.filter(a => {
    const code = String(a.code || '').toLowerCase()
    const name = String(a.name || '').toLowerCase()
    return code.includes(query) || name.includes(query)
  })

  // 匹配父科目（只作为标题显示）
  const matchedParent = parentAccounts.filter(a => {
    const code = String(a.code || '').toLowerCase()
    const name = String(a.name || '').toLowerCase()
    return code.includes(query) || name.includes(query)
  })

  // 如果匹配到父科目，把其下所有叶子子科目也加入结果（去重）
  if (matchedParent.length > 0) {
    const matchedLeafIds = new Set(matchedLeaf.map(a => a.id))
    for (const parent of matchedParent) {
      const parentCode = String(parent.code || '')
      for (const leaf of leafAccounts) {
        if (!matchedLeafIds.has(leaf.id) && String(leaf.code || '').startsWith(parentCode)) {
          matchedLeaf.push(leaf)
          matchedLeafIds.add(leaf.id)
        }
      }
    }
  }

  matchedLeaf.sort((a, b) => {
    const aCode = String(a.code || '').toLowerCase()
    const bCode = String(b.code || '').toLowerCase()
    const aName = String(a.name || '').toLowerCase()
    const bName = String(b.name || '').toLowerCase()

    const aCodeStarts = aCode.startsWith(query) ? 0 : 1
    const bCodeStarts = bCode.startsWith(query) ? 0 : 1
    if (aCodeStarts !== bCodeStarts) return aCodeStarts - bCodeStarts

    const aNameStarts = aName.startsWith(query) ? 0 : 1
    const bNameStarts = bName.startsWith(query) ? 0 : 1
    if (aNameStarts !== bNameStarts) return aNameStarts - bNameStarts

    return aCode.localeCompare(bCode, 'zh-CN')
  })

  // 合并：父科目标题 + 叶子科目，父科目标题插在对应叶子科目前面
  const result: AccountSuggestion[] = []
  const addedParents = new Set<string>()

  for (const leaf of matchedLeaf) {
    // 找到该叶子科目的直接父科目（优先从匹配的父科目中找，再从全部父科目中找）
    const parent = parentAccounts.find(
      p => String(leaf.code || '').startsWith(String(p.code || '')) && leaf.id !== p.id
    )
    if (parent && !addedParents.has(parent.id)) {
      result.push(buildParentHeader(parent))
      addedParents.add(parent.id)
    }
    result.push(buildAccountSuggestion(leaf))
  }

  // 如果只匹配到父科目（没有叶子科目匹配），也显示父科目标题
  for (const parent of matchedParent) {
    if (!addedParents.has(parent.id)) {
      result.push(buildParentHeader(parent))
    }
  }

  cb(result)
}

function onAccountInputChange(row: any, val: string | number) {
  const state = ensureAccountInputState(row)
  state.input = String(val || '')

  const trimmed = state.input.trim()
  const selectedAcc = row.account_id ? props.accounts.find(a => a.id === row.account_id) : null
  const selectedDisplay = accountInputText(selectedAcc)

  // 一旦用户开始编辑已选科目（输入值不再等于完整显示值），先解除选中状态，允许自由回退/继续输入
  if (row.account_id && trimmed !== selectedDisplay) {
    row.account_id = null
    row.account_code = ''
    row.account_name = ''
  }

  if (!trimmed) {
    row.account_id = null
    row.account_code = ''
    row.account_name = ''
    return
  }

  // 仅在“完全等于科目代码”时自动选中
  const exactCode = props.accounts.find(
    a => String(a.code || '') === trimmed && !props.isParentAccount(a.id)
  )
  if (exactCode) {
    applySelectedAccount(row, exactCode)
    return
  }

  // 仅在“完全等于科目名称且唯一”时自动选中
  const exactNameMatches = props.accounts.filter(
    a => String(a.name || '') === trimmed && !props.isParentAccount(a.id)
  )
  if (exactNameMatches.length === 1) {
    applySelectedAccount(row, exactNameMatches[0])
  }
}

function handleAccountSelect(row: any, item: any) {
  // 父科目标题项不可选 - 多重检查确保父科目无法被选中
  if (!item) return
  if (item.isParent) return
  if (String(item.value).startsWith('__parent__')) return

  const acc = props.accounts.find(a => a.id === item.id)
  if (!acc) return
  if (props.isParentAccount(acc.id)) return

  applySelectedAccount(row, acc)
}

/** 阻止父科目标题行把点击/mousedown 冒泡到 el-autocomplete 的 li，避免误选中父科目 */
function onAccountSuggestionPointer(item: any, e: MouseEvent) {
  if (!item?.isParent && !String(item?.value || '').startsWith('__parent__')) return
  e.preventDefault()
  e.stopPropagation()
}

function applySelectedAccount(row: any, acc: any) {
  const state = ensureAccountInputState(row)
  row.account_id = acc.id
  state.input = accountInputText(acc)
  props.onAccountChange(row)
  props.setCurrentEntry(row)
  void ensureForeignDefaults(row)
  ensureQuantityDefaults(row)
}

function onAccountAutoFocus(row: any) {
  props.setCurrentEntry(row)
  const state = ensureAccountInputState(row)
  if (row.account_id && !state.input) {
    const acc = props.accounts.find(a => a.id === row.account_id)
    if (acc) {
      state.input = accountInputText(acc)
    }
  }
}

// Del 键清除科目选择
function onAccountDelete(row: any, event: KeyboardEvent) {
  // 只有在已选择科目时才处理 Del 键
  if (!row.account_id) return

  event.preventDefault()
  event.stopPropagation()

  // 清除科目选择
  row.account_id = null
  row.account_code = ''
  row.account_name = ''

  // 清除输入状态
  const state = ensureAccountInputState(row)
  state.input = ''

  // 触发科目变化处理
  props.onAccountChange(row)
}

// 每行 autocomplete 实例的引用（用于读取暴露的 highlightedIndex / suggestions / highlight）
const accountAutocompleteRefs = new Map<string, any>()

function setAccountAutocompleteRef(row: any, instance: any) {
  const key = getAccountRowKey(row)
  if (instance) {
    accountAutocompleteRefs.set(key, instance)
  } else {
    accountAutocompleteRefs.delete(key)
  }
}

// 上下键导航时跳过父科目（保留父科目作为分组标题显示，仅在键盘导航时跳过）
function onAccountArrowKey(row: any, _event: KeyboardEvent, direction: 'up' | 'down') {
  // 不阻止默认行为，让 Element Plus 先正常移动 highlightedIndex；
  // 之后在 nextTick 中检查当前高亮项，如果是父科目则继续推进
  const key = getAccountRowKey(row)
  const instance = accountAutocompleteRefs.get(key)
  if (!instance) return

  nextTick(() => skipParentInHighlight(instance, direction))
}

function skipParentInHighlight(instance: any, direction: 'up' | 'down', remaining = 50) {
  if (remaining <= 0) return

  const idx = instance.highlightedIndex as number
  const suggestions = (instance.suggestions || []) as any[]
  if (!Array.isArray(suggestions) || suggestions.length === 0) return
  if (idx < 0 || idx >= suggestions.length) return

  const item = suggestions[idx]
  const isParent = !!item?.isParent || String(item?.value || '').startsWith('__parent__')
  if (!isParent) return

  const nextIdx = direction === 'down' ? idx + 1 : idx - 1
  // 边界处理：到顶/到底都没有非父项时，保持现状不再递归
  if (nextIdx < 0 || nextIdx >= suggestions.length) return

  if (typeof instance.highlight === 'function') {
    instance.highlight(nextIdx)
  }

  nextTick(() => skipParentInHighlight(instance, direction, remaining - 1))
}

function onVoucherDialogKeydown(e: KeyboardEvent) {
  if (!visible.value || props.submitLoading) return
  if (e.key !== 'Enter') return

  // 仅 Ctrl+Enter / Cmd+Enter 保存并新增；普通 Enter 不再触发保存，避免录入时误保存
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    e.stopPropagation()
    emit('submit-and-add')
  }
}

// 键盘快捷键
useKeyboardShortcuts([
  commonShortcuts.save(() => {
    if (visible.value && !isReadonly.value) {
      emit('submit')
    }
  }),
  commonShortcuts.search(() => {
    if (visible.value && !isReadonly.value) {
      triggerFileInput()
    }
  }),
  commonShortcuts.close(() => {
    if (visible.value) {
      handleClose()
    }
  }),
])
</script>

<style scoped>
.paper-voucher {
  border: 1px solid #dcdfe6;
  background: #fffdf7;
  padding: 10px 12px;
}

.voucher-paper-header {
  border-bottom: 2px solid #303133;
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.voucher-paper-title {
  font-size: 20px;
  letter-spacing: 6px;
  text-align: center;
  font-weight: 700;
  color: #303133;
  margin-bottom: 8px;
}

.voucher-paper-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-label {
  width: auto;
  white-space: nowrap;
  color: #606266;
  font-size: 12px;
  flex-shrink: 0;
}

.meta-control {
  flex: 1;
  min-width: 0;
}

.meta-readonly {
  padding: 0 6px;
  border: 1px solid #dcdfe6;
  min-height: 26px;
  background: #fff;
  flex: 1;
  min-width: 0;
}

.meta-text {
  font-weight: 600;
  color: #303133;
  font-size: 12px;
}

.voucher-top-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.account-balance-display-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.account-balance-display {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 2px 8px;
  background: #f5f7fa;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
}

.account-balance-display--drillable {
  cursor: pointer;
}

.account-balance-display--drillable:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.aux-balance-chip {
  background: #ecf5ff;
  border-color: #c6e2ff;
}

.balance-aux-item {
  color: #606266;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.balance-account {
  color: #606266;
  font-weight: 500;
}

.balance-label {
  color: #909399;
}

.balance-amount-same {
  color: #67c23a;
  font-weight: 700;
}

.balance-amount-opposite {
  color: #f56c6c;
  font-weight: 700;
}

.voucher-table-wrap {
  margin-bottom: 8px;
}

.paper-table :deep(.el-table__header-wrapper th) {
  background: #f8f1df;
  color: #303133;
  font-size: 12px;
}

.paper-table :deep(.el-table__header .el-table__cell) {
  padding: 3px 0 !important;
}

.paper-table :deep(.el-table__body .el-table__cell) {
  padding: 2px 0 !important;
}

.paper-table :deep(.el-table__body .el-table__row) {
  height: 30px;
}

.paper-table :deep(.cell) {
  padding: 0 !important;
  line-height: 24px;
  font-size: 12px;
}

.paper-table :deep(.el-table__header .cell) {
  padding: 0 6px !important;
}

.paper-table :deep(.el-input),
.paper-table :deep(.el-autocomplete),
.paper-table :deep(.el-input-number) {
  width: 100%;
}

.paper-table :deep(.el-input__wrapper) {
  min-height: 26px !important;
  padding: 0 6px !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

.paper-table :deep(.el-input__inner) {
  height: 24px !important;
  line-height: 24px !important;
  font-size: 12px;
}

.paper-table :deep(.amount-input) {
  width: 100% !important;
}

.paper-table :deep(.amount-input .el-input__wrapper) {
  padding: 0 4px !important;
}

.paper-table :deep(.el-table__footer) {
  font-weight: bold;
  font-size: 12px;
}

.paper-table :deep(.el-table__footer .el-table__cell) {
  padding: 4px 0 !important;
}

.entry-row {
  display: flex;
  gap: 2px;
  align-items: center;
}

.entry-row :deep(.el-button.is-link) {
  padding: 0 4px;
  font-size: 12px;
}

.voucher-paper-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.voucher-balance {
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 12px;
}

.voucher-balance.balanced {
  color: #67c23a;
  background: #f0f9eb;
}

.voucher-balance.unbalanced {
  color: #f56c6c;
  background: #fef0f0;
}

.divider {
  margin: 0 10px;
  color: #909399;
}

.voucher-aux-panel {
  margin-bottom: 8px;
  border: 1px solid #e4e7ed;
  background: #fff;
  padding: 8px 10px;
}

.voucher-aux-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  font-weight: 600;
  font-size: 12px;
}

.voucher-aux-summary {
  font-size: 12px;
  color: #606266;
  font-weight: 400;
}

.voucher-aux-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.voucher-aux-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.voucher-aux-row-label {
  color: #606266;
  font-size: 12px;
  font-weight: 500;
  min-width: 52px;
  flex-shrink: 0;
}

.voucher-aux-row-field {
  display: flex;
  align-items: center;
  gap: 4px;
}

.voucher-aux-field-name {
  color: #909399;
  font-size: 12px;
  white-space: nowrap;
}

.voucher-aux-readonly-value {
  color: #303133;
  font-size: var(--cw-text-base);
  min-width: 120px;
  padding: 4px 8px;
  background: #f5f7fa;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
}

.entry-readonly-text {
  display: block;
  padding: 4px 8px;
  color: #303133;
  font-size: var(--cw-text-base);
  line-height: 1.5;
  cursor: pointer;
}

.entry-account-readonly {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 4px 8px;
  cursor: pointer;
}

.entry-aux-tag {
  color: #409eff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.entry-aux-tag:hover {
  text-decoration: underline;
}

.voucher-aux-readonly-link {
  cursor: pointer;
}

.voucher-aux-readonly-link:hover {
  color: #409eff;
  border-color: #c6e2ff;
  background: #ecf5ff;
}

.entry-readonly-amount {
  min-height: 24px;
  padding: 4px 8px;
  cursor: pointer;
  text-align: right;
}

/* 红字（负数）金额：会计惯例用红色标示冲红分录 */
.entry-amount-red {
  color: #d03050;
  font-weight: 600;
}

/* 需 !important：Element Plus 主题覆盖层对 .el-input__inner 的颜色规则优先级更高 */
.el-input-number.entry-amount-red :deep(.el-input__inner) {
  color: #d03050 !important;
  font-weight: 600;
}

.voucher-table--readonly :deep(.el-table__body tr) {
  cursor: pointer;
}

.voucher-paper-remark {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.remark-label {
  width: 40px;
  color: #606266;
  flex-shrink: 0;
  font-size: 12px;
}

.voucher-paper-signatures {
  display: flex;
  justify-content: space-between;
  border-top: 1px dashed #c0c4cc;
  padding-top: 8px;
}

.signature-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #606266;
}

.signature-item span {
  font-size: 12px;
  white-space: nowrap;
}

.signature-item em {
  font-style: normal;
  font-size: 12px;
  min-width: 72px;
  border-bottom: 1px solid #909399;
  padding: 0 4px 1px;
  text-align: center;
  display: inline-block;
  line-height: 18px;
  height: 18px;
}

.voucher-attachments-container {
  margin-bottom: 8px;
}

.attachment-inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #606266;
}

.attachment-tag {
  cursor: pointer;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-content {
  text-align: center;
}

.dialog-footer-enhanced {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dialog-footer-enhanced :deep(.el-button) {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.navigation-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.navigation-info {
  font-size: 12px;
  color: #606266;
  white-space: nowrap;
}

.action-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.submit-controls {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.meta-control :deep(.el-input__wrapper),
.meta-control :deep(.el-select__wrapper) {
  min-height: 26px !important;
}

.account-suggestion-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  min-height: 22px;
  font-size: 12px;
}

.account-suggestion-item.is-parent-account {
  user-select: none;
}

:deep(.el-table__body-wrapper) {
  overflow: visible !important;
}

:deep(.el-table__body-wrapper .el-scrollbar__bar) {
  display: none !important;
}

:deep(.el-table__body-wrapper .el-scrollbar__wrap) {
  overflow: visible !important;
}

:deep(.el-table__body-wrapper .el-table__body) {
  overflow: visible !important;
}

:deep(.el-autocomplete-suggestion li) {
  white-space: normal;
  line-height: 1.5;
}

.cash-flow-required-tag {
  margin-left: 8px;
  color: #f56c6c;
  font-size: 12px;
}

.voucher-cash-flow-panel {
  margin-bottom: 8px;
}

/* 金额 + 原币 同一行：本位币在右，原币小字紧跟其后，超长省略 */
.amount-line {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
}
.amount-line > span:first-child {
  flex-shrink: 0;
}
.foreign-amount-inline {
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* 外币科目金额格：只读展示，聚焦 / 点击弹出外币气泡 */
.foreign-amount-cell {
  height: 28px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;
  cursor: pointer;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
  outline: none;
  line-height: 1;
  min-width: 0;
}
.foreign-amount-cell .amount-line {
  width: 100%;
}
.foreign-amount-cell:hover,
.foreign-amount-cell:focus,
.foreign-amount-cell.is-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.foreign-amount-cell.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.entry-readonly-amount.is-foreign {
  text-decoration: underline dotted var(--el-color-primary-light-5);
}

.voucher-date-warning {
  margin-top: 6px;
  grid-column: 1 / -1;
}

.duplicate-warnings {
  margin-top: 8px;
}

.duplicate-warnings .el-alert {
  margin-bottom: 4px;
}

.duplicate-warnings .el-alert:last-child {
  margin-bottom: 0;
}
</style>

<!-- 外币气泡通过 teleport 挂到 body，需要非 scoped 样式 -->
<style>
.voucher-foreign-popover.el-popover {
  padding: 10px 12px;
}
.voucher-foreign-popover .foreign-popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}
.voucher-foreign-popover .foreign-popover-currency {
  font-size: 12px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  padding: 0 6px;
  border-radius: 3px;
}
.voucher-foreign-popover .foreign-popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.voucher-foreign-popover .foreign-popover-label {
  width: 72px;
  flex: 0 0 72px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.voucher-foreign-popover .foreign-popover-input {
  flex: 1;
}
.voucher-foreign-popover .foreign-popover-input .el-input__inner {
  text-align: right;
}
.voucher-foreign-popover .foreign-popover-total {
  border-top: 1px dashed var(--el-border-color-lighter);
  padding-top: 8px;
}
.voucher-foreign-popover .foreign-popover-base {
  flex: 1;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.voucher-foreign-popover .foreign-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
