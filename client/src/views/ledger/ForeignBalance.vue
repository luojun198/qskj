<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>外币余额表</h3>
      <div class="filter-row">
        <el-date-picker
          v-model="filters.start_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="开始日期"
          class="filter-ctl--md"
          @change="fetchData"
        />
        <el-date-picker
          v-model="filters.end_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束日期"
          class="filter-ctl--md"
          @change="fetchData"
        />
        <el-input
          v-model="filters.account_code"
          placeholder="科目编码"
          clearable
          class="filter-ctl--sm"
          @clear="fetchData"
          @keyup.enter="fetchData"
        />
        <el-select
          v-model="filters.currency_code"
          clearable
          placeholder="全部币种"
          class="filter-ctl--sm"
          @change="fetchData"
        >
          <el-option
            v-for="c in currencies"
            :key="c.code"
            :label="`${c.code} ${c.name}`"
            :value="c.code"
          />
        </el-select>
        <el-divider direction="vertical" />
        <el-checkbox-group v-model="filters.filter_types" size="small" @change="fetchData">
          <el-checkbox value="init_balance">有期初</el-checkbox>
          <el-checkbox value="has_amount">有发生额</el-checkbox>
          <el-checkbox value="has_balance">有余额</el-checkbox>
        </el-checkbox-group>
        <el-divider direction="vertical" />
        <el-checkbox v-model="filters.include_unposted" @change="fetchData"
          >统计未记账凭证</el-checkbox
        >
        <el-divider direction="vertical" />
        <el-button type="primary" @click="fetchData"
          ><el-icon><Search /></el-icon>查询</el-button
        >
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain :disabled="list.length === 0" @click="exportData"
          ><el-icon><Download /></el-icon>导出 Excel</el-button
        >
        <el-button plain :disabled="loading || list.length === 0" @click="printPage">
          <el-icon><Printer /></el-icon>打印
        </el-button>
      </div>
    </div>

    <AccountScopeAlert />

    <div v-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>

    <div
      v-else
      v-loading="loading"
      ref="tableContainerRef"
      class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
    >
      <el-table
        ref="tableRef"
        :height="tableHeight"
        :data="list"
        :style="{ width: `${ledgerTableWidth}px` }"
        :fit="false"
        stripe
        border
        size="small"
        class="compact-data-table"
        highlight-current-row
        show-summary
        :summary-method="getSummaries"
        @header-dragend="handleHeaderDragEnd"
        @row-dblclick="handleRowDblClick"
      >
        <el-table-column
          column-key="account_code"
          prop="account_code"
          label="科目编码"
          :width="colWidth('account_code', 110)"
          fixed
        />
        <el-table-column
          column-key="account_name"
          prop="account_name"
          label="科目名称"
          :width="colWidth('account_name', 150)"
          fixed
        />
        <el-table-column
          column-key="currency_code"
          prop="currency_code"
          label="币种"
          :width="colWidth('currency_code', 70)"
          align="center"
        />
        <el-table-column
          column-key="exchange_rate"
          label="汇率"
          :width="colWidth('exchange_rate', 90)"
          align="right"
        >
          <template #default="{ row }">{{ rateText(row.currency_code) }}</template>
        </el-table-column>

        <el-table-column label="期初余额" align="center">
          <el-table-column
            column-key="init_direction"
            label="方向"
            :width="colWidth('init_direction', 50)"
            align="center"
          >
            <template #default="{ row }">{{ balDir(row.init_balance, row.direction) }}</template>
          </el-table-column>
          <el-table-column
            column-key="foreign_init_balance"
            label="原币"
            :width="colWidth('foreign_init_balance', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(Math.abs(row.foreign_init_balance || 0)) }}</template>
          </el-table-column>
          <el-table-column
            column-key="init_balance"
            label="本位币"
            :width="colWidth('init_balance', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(Math.abs(row.init_balance || 0)) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="本期发生额" align="center">
          <el-table-column
            column-key="foreign_current_debit"
            label="借方原币"
            :width="colWidth('foreign_current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(row.foreign_current_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="current_debit"
            label="借方本位币"
            :width="colWidth('current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.current_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="foreign_current_credit"
            label="贷方原币"
            :width="colWidth('foreign_current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(row.foreign_current_credit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="current_credit"
            label="贷方本位币"
            :width="colWidth('current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.current_credit) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="本年累计发生额" align="center">
          <el-table-column
            column-key="foreign_year_debit"
            label="借方原币"
            :width="colWidth('foreign_year_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(row.foreign_year_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="year_debit"
            label="借方本位币"
            :width="colWidth('year_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.year_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="foreign_year_credit"
            label="贷方原币"
            :width="colWidth('foreign_year_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(row.foreign_year_credit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="year_credit"
            label="贷方本位币"
            :width="colWidth('year_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.year_credit) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="期末余额" align="center">
          <el-table-column
            column-key="end_direction"
            label="方向"
            :width="colWidth('end_direction', 50)"
            align="center"
          >
            <template #default="{ row }">{{ balDir(row.end_balance, row.direction) }}</template>
          </el-table-column>
          <el-table-column
            column-key="foreign_end_balance"
            label="原币"
            :width="colWidth('foreign_end_balance', 120)"
            align="right"
          >
            <template #default="{ row }">{{ fx(Math.abs(row.foreign_end_balance || 0)) }}</template>
          </el-table-column>
          <el-table-column
            column-key="end_balance"
            label="本位币"
            :width="colWidth('end_balance', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(Math.abs(row.end_balance || 0)) }}</template>
          </el-table-column>
        </el-table-column>

        <template #empty>
          <EmptyState
            type="data"
            description="暂无数据。请先在「会计科目」里给科目勾选「外币」并选择核算币种。"
          />
        </template>
      </el-table>
    </div>

    <!-- 多币种时表尾只能给本位币合计，原币按币种单列一行 -->
    <div v-if="showCurrencySubtotals" class="fx-subtotals">
      <div class="fx-subtotals__title">各币种小计</div>
      <el-table :data="currencySubtotals" border size="small" class="compact-data-table">
        <el-table-column prop="currency" label="币种" width="80" align="center" />
        <el-table-column label="汇率" width="90" align="right">
          <template #default="{ row }">{{ rateText(row.currency) }}</template>
        </el-table-column>
        <el-table-column label="期初原币" width="130" align="right">
          <template #default="{ row }">{{ fx(Math.abs(row.foreign_init_balance)) }}</template>
        </el-table-column>
        <el-table-column label="期初本位币" width="130" align="right">
          <template #default="{ row }">{{ amt(Math.abs(row.init_balance)) }}</template>
        </el-table-column>
        <el-table-column label="本期借方原币" width="130" align="right">
          <template #default="{ row }">{{ fx(row.foreign_current_debit) }}</template>
        </el-table-column>
        <el-table-column label="本期贷方原币" width="130" align="right">
          <template #default="{ row }">{{ fx(row.foreign_current_credit) }}</template>
        </el-table-column>
        <el-table-column label="期末原币" width="130" align="right">
          <template #default="{ row }">{{ fx(Math.abs(row.foreign_end_balance)) }}</template>
        </el-table-column>
        <el-table-column label="期末本位币" min-width="130" align="right">
          <template #default="{ row }">{{ amt(Math.abs(row.end_balance)) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:foreign-balance"
      title="外币余额表"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
      :show-font-size="true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import type { TableColumnCtx } from 'element-plus'
import request from '@/api/request'
import { getCurrencies, type Currency } from '@/api/currency'
import { useDrillDownNavigate } from '@/composables/useDrillDownNavigate'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { formatAmount } from '@/utils/format'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import {
  buildForeignBalanceExportColumns,
  buildForeignBalanceExportSummaryValues,
  buildForeignBalanceSubtotalRows,
  type ForeignBalanceTotals,
} from '@/utils/ledgerExportBuilders'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import EmptyState from '@/components/EmptyState.vue'
import { useUserStore } from '@/stores/user'
import { useRacedQuery } from '@/composables/useRacedQuery'

/**
 * 外币余额表。
 *
 * 只列 `is_foreign = 1` 的科目，每个金额段成对显示原币与本位币。
 * 与科目余额表的差别：**不做父科目汇总、也不提供科目级次按钮** —— 不同币种的原币相加
 * 没有业务含义，后端按 `is_foreign` 平铺返回（与库存数量金额表同一处理）。
 */

const { drillDown } = useDrillDownNavigate()
const { accountSetName } = storeToRefs(useUserStore())

const list = ref<any[]>([])
/** 按币种分桶的合计，来自后端 summary */
const totals = ref<Record<string, ForeignBalanceTotals> | null>(null)
/** 各币种期末汇率，来自后端 rates（与期末调汇同一条回退链） */
const rates = ref<Record<string, number>>({})
const currencies = ref<Currency[]>([])
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const initialLoaded = ref(false)
const hideZero = ref(true)

const year = new Date().getFullYear()
const filters = ref<any>({
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  account_code: '',
  currency_code: '',
  filter_types: ['init_balance', 'has_amount', 'has_balance'],
  include_unposted: true,
})
const { clearFilters } = useFilterClear([filters])

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  fetchData()
}

const ledgerColumnDefs = computed(() => [
  { key: 'account_code', fallback: 110 },
  { key: 'account_name', fallback: 150 },
  { key: 'currency_code', fallback: 70 },
  { key: 'exchange_rate', fallback: 90 },
  { key: 'init_direction', fallback: 50 },
  { key: 'foreign_init_balance', fallback: 120 },
  { key: 'init_balance', fallback: 120 },
  { key: 'foreign_current_debit', fallback: 120 },
  { key: 'current_debit', fallback: 120 },
  { key: 'foreign_current_credit', fallback: 120 },
  { key: 'current_credit', fallback: 120 },
  { key: 'foreign_year_debit', fallback: 120 },
  { key: 'year_debit', fallback: 120 },
  { key: 'foreign_year_credit', fallback: 120 },
  { key: 'year_credit', fallback: 120 },
  { key: 'end_direction', fallback: 50 },
  { key: 'foreign_end_balance', fallback: 120 },
  { key: 'end_balance', fallback: 120 },
])

const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_foreign_balance', ledgerColumnDefs, {
    afterLayout: relayoutAfterData,
  })

const printDateLabel = computed(
  () => `日期：${filters.value.start_date || ''} 至 ${filters.value.end_date || ''}`
)

// ========== 展示格式 ==========

/** 原币金额：2 位小数，0 时按「隐藏零值」留空 */
function fx(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (!n) return hideZero.value ? '' : '0.00'
  return Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function amt(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (!n) return hideZero.value ? '' : formatAmount(0)
  return formatAmount(n)
}

function rateText(currencyCode: string | null | undefined): string {
  const rate = rates.value[String(currencyCode || '').toUpperCase()]
  return rate ? Number(rate).toFixed(4) : ''
}

function balDir(balance: number, acctDir: string): string {
  if (!balance) return ''
  const onDebitSide = balance > 0 ? acctDir === 'debit' : acctDir !== 'debit'
  return onDebitSide ? '借' : '贷'
}

// ========== 合计 ==========

const currencyKeys = computed(() => Object.keys(totals.value || {}))
/** 单一币种时原币才可相加；多币种的原币合计没有业务含义 */
const singleCurrencyTotals = computed<ForeignBalanceTotals | null>(() => {
  const t = totals.value
  if (!t) return null
  const keys = currencyKeys.value
  return keys.length === 1 ? t[keys[0]] : null
})

/** 多币种时才展示按币种小计；单币种的小计与表尾合计完全相同 */
const showCurrencySubtotals = computed(() => currencyKeys.value.length > 1)
const currencySubtotals = computed(() =>
  currencyKeys.value.map(key => ({ currency: key, ...(totals.value as any)[key] }))
)

function sumOf(field: keyof ForeignBalanceTotals): number {
  const t = totals.value
  if (!t) return 0
  return currencyKeys.value.reduce((sum, key) => sum + (Number(t[key][field]) || 0), 0)
}

function summaryDirection(net: number): string {
  if (Math.abs(net) < 0.005) return '平'
  return net > 0 ? '借' : '贷'
}

function resolveSummaryColumnKey(column: TableColumnCtx<any>): string {
  if (column.columnKey != null && column.columnKey !== '') return String(column.columnKey)
  if (column.property) return String(column.property)
  return column.label ? String(column.label) : ''
}

function getSummaries(param: { columns: TableColumnCtx<any>[] }) {
  const one = singleCurrencyTotals.value
  const fxSum = (field: keyof ForeignBalanceTotals, abs = false) => {
    if (!one) return ''
    const n = Number(one[field]) || 0
    return fx(abs ? Math.abs(n) : n)
  }
  const initNet = sumOf('init_balance')
  const endNet = sumOf('end_balance')

  return param.columns.map(column => {
    switch (resolveSummaryColumnKey(column)) {
      case 'account_code':
        return '合计'
      case 'currency_code':
        return one ? currencyKeys.value[0] : currencyKeys.value.length > 1 ? '多币种' : ''
      case 'init_direction':
        return summaryDirection(initNet)
      case 'foreign_init_balance':
        return fxSum('foreign_init_balance', true)
      case 'init_balance':
        return formatAmount(Math.abs(initNet))
      case 'foreign_current_debit':
        return fxSum('foreign_current_debit')
      case 'current_debit':
        return formatAmount(sumOf('current_debit'))
      case 'foreign_current_credit':
        return fxSum('foreign_current_credit')
      case 'current_credit':
        return formatAmount(sumOf('current_credit'))
      case 'foreign_year_debit':
        return fxSum('foreign_year_debit')
      case 'year_debit':
        return formatAmount(sumOf('year_debit'))
      case 'foreign_year_credit':
        return fxSum('foreign_year_credit')
      case 'year_credit':
        return formatAmount(sumOf('year_credit'))
      case 'end_direction':
        return summaryDirection(endNet)
      case 'foreign_end_balance':
        return fxSum('foreign_end_balance', true)
      case 'end_balance':
        return formatAmount(Math.abs(endNet))
      default:
        return ''
    }
  })
}

// ========== 取数 ==========

async function fetchData() {
  {
    const params: any = {}
    if (filters.value.start_date) params.start_date = filters.value.start_date
    if (filters.value.end_date) params.end_date = filters.value.end_date
    if (filters.value.account_code) params.account_code = filters.value.account_code
    if (filters.value.currency_code) params.currency_code = filters.value.currency_code
    if (filters.value.filter_types?.length) {
      params.filter_types = filters.value.filter_types.join(',')
    }
    if (filters.value.include_unposted) params.include_unposted = 'true'

    const res = await raced.run(() => request.get('/ledger/foreign-balance', { params }))
    if (!res) return
    list.value = (res as any).data || []
    totals.value = ((res as any).summary || null) as Record<string, ForeignBalanceTotals> | null
    rates.value = ((res as any).rates || {}) as Record<string, number>
    initialLoaded.value = true
    await afterTableLayout()
  }
}

// ========== 导出 / 打印 ==========

async function exportData() {
  const dateRange =
    filters.value.start_date && filters.value.end_date
      ? `${filters.value.start_date}_${filters.value.end_date}`
      : new Date().toISOString().split('T')[0]

  await exportStyledTable({
    fileName: `外币余额表_${dateRange}.xlsx`,
    sheetName: '外币余额表',
    title: '外币余额表',
    subtitle: printDateLabel.value,
    columns: buildForeignBalanceExportColumns(colWidth, hideZero.value),
    rows: list.value.map(row => ({
      ...row,
      exchange_rate: rates.value[String(row.currency_code || '').toUpperCase()] || 0,
    })),
    subtotalRows: buildForeignBalanceSubtotalRows(totals.value, rates.value),
    summaryValues: buildForeignBalanceExportSummaryValues(totals.value),
  })
}

const hiprintVisible = ref(false)

function printPage() {
  if (!loading.value && list.value.length > 0) hiprintVisible.value = true
}

function buildPrintHtml(ctx?: { fontSize?: number }): string {
  const one = singleCurrencyTotals.value
  const fxFooter = (field: keyof ForeignBalanceTotals, abs = false) => {
    if (!one) return ''
    const n = Number(one[field]) || 0
    return fx(abs ? Math.abs(n) : n)
  }
  const initNet = sumOf('init_balance')
  const endNet = sumOf('end_balance')

  return buildTablePrintHtml<any>({
    title: '外币余额表',
    subtitle: [`账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`],
    rows: list.value,
    monochrome: true,
    fitToPage: true,
    fontSize: ctx?.fontSize ?? 11,
    headerRows: [
      [
        { label: '科目编码', rowspan: 2, width: '8%' },
        { label: '科目名称', rowspan: 2, width: '12%' },
        { label: '币种', rowspan: 2, width: '4%' },
        { label: '汇率', rowspan: 2, width: '5%' },
        { label: '期初余额', colspan: 3 },
        { label: '本期发生额', colspan: 4 },
        { label: '本年累计发生额', colspan: 4 },
        { label: '期末余额', colspan: 3 },
      ],
      [
        { label: '方向', width: '3%' },
        { label: '原币', width: '6%' },
        { label: '本位币', width: '6%' },
        { label: '借方原币', width: '5.5%' },
        { label: '借方本位币', width: '5.5%' },
        { label: '贷方原币', width: '5.5%' },
        { label: '贷方本位币', width: '5.5%' },
        { label: '借方原币', width: '5.5%' },
        { label: '借方本位币', width: '5.5%' },
        { label: '贷方原币', width: '5.5%' },
        { label: '贷方本位币', width: '5.5%' },
        { label: '方向', width: '3%' },
        { label: '原币', width: '6%' },
        { label: '本位币', width: '6%' },
      ],
    ],
    columns: [
      { label: '科目编码', width: '8%', align: 'left', render: r => r.account_code || '' },
      { label: '科目名称', width: '12%', align: 'left', render: r => r.account_name || '' },
      { label: '币种', width: '4%', align: 'center', render: r => r.currency_code || '' },
      { label: '汇率', width: '5%', align: 'right', render: r => rateText(r.currency_code) },
      {
        label: '期初方向',
        width: '3%',
        align: 'center',
        render: r => balDir(r.init_balance, r.direction),
      },
      {
        label: '期初原币',
        width: '6%',
        align: 'right',
        render: r => fx(Math.abs(r.foreign_init_balance || 0)),
      },
      {
        label: '期初本位币',
        width: '6%',
        align: 'right',
        render: r => amt(Math.abs(r.init_balance || 0)),
      },
      { label: '本期借方原币', width: '5.5%', align: 'right', render: r => fx(r.foreign_current_debit) },
      { label: '本期借方本位币', width: '5.5%', align: 'right', render: r => amt(r.current_debit) },
      { label: '本期贷方原币', width: '5.5%', align: 'right', render: r => fx(r.foreign_current_credit) },
      { label: '本期贷方本位币', width: '5.5%', align: 'right', render: r => amt(r.current_credit) },
      { label: '累计借方原币', width: '5.5%', align: 'right', render: r => fx(r.foreign_year_debit) },
      { label: '累计借方本位币', width: '5.5%', align: 'right', render: r => amt(r.year_debit) },
      { label: '累计贷方原币', width: '5.5%', align: 'right', render: r => fx(r.foreign_year_credit) },
      { label: '累计贷方本位币', width: '5.5%', align: 'right', render: r => amt(r.year_credit) },
      {
        label: '期末方向',
        width: '3%',
        align: 'center',
        render: r => balDir(r.end_balance, r.direction),
      },
      {
        label: '期末原币',
        width: '6%',
        align: 'right',
        render: r => fx(Math.abs(r.foreign_end_balance || 0)),
      },
      {
        label: '期末本位币',
        width: '6%',
        align: 'right',
        render: r => amt(Math.abs(r.end_balance || 0)),
      },
    ],
    footerSubtotals: buildForeignBalanceSubtotalRows(totals.value, rates.value).map(row =>
      row.map(v => String(v ?? ''))
    ),
    footer: [
      '合计',
      '',
      one ? currencyKeys.value[0] : currencyKeys.value.length > 1 ? '多币种' : '',
      '',
      summaryDirection(initNet),
      fxFooter('foreign_init_balance', true),
      formatAmount(Math.abs(initNet)),
      fxFooter('foreign_current_debit'),
      formatAmount(sumOf('current_debit')),
      fxFooter('foreign_current_credit'),
      formatAmount(sumOf('current_credit')),
      fxFooter('foreign_year_debit'),
      formatAmount(sumOf('year_debit')),
      fxFooter('foreign_year_credit'),
      formatAmount(sumOf('year_credit')),
      summaryDirection(endNet),
      fxFooter('foreign_end_balance', true),
      formatAmount(Math.abs(endNet)),
    ],
  })
}

// ========== 下钻 ==========

function handleRowDblClick(row: any) {
  const query: any = {}
  if (row.account_id) query.account_id = row.account_id
  else if (row.account_code) query.account_code = row.account_code
  if (filters.value.start_date) query.start_date = filters.value.start_date
  if (filters.value.end_date) query.end_date = filters.value.end_date
  query.book = Number(row.is_quantity) === 1 ? 'quantity-foreign' : 'foreign'
  const currency = filters.value.currency_code || row.currency_code
  if (currency) query.currency_code = String(currency).toUpperCase()

  drillDown('/ledger/foreign-detail', query, '外币余额表', {
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
    account_code: filters.value.account_code || '',
    currency_code: filters.value.currency_code || '',
  })
}

onMounted(async () => {
  try {
    const res = await getCurrencies()
    currencies.value = (res.data || []).filter((c: Currency) => !c.is_base)
  } catch {
    currencies.value = []
  }
  await fetchData()
})
</script>

<style scoped>
.page {
  padding: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.fx-subtotals {
  margin-top: 8px;
}

.fx-subtotals__title {
  font-size: var(--cw-text-base, 13px);
  font-weight: 600;
  margin-bottom: 4px;
}

.skeleton-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}
.skeleton-row {
  height: 36px;
  border-radius: 4px;
}
</style>
