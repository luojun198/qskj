<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>科目余额表</h3>
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
          v-model="filters.account_level"
          placeholder="科目级次"
          clearable
          class="filter-ctl--xs"
          @change="fetchData"
        >
          <el-option v-for="level in 4" :key="level" :label="`展开到${level}级`" :value="level" />
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
        <el-divider direction="vertical" />
        <el-button plain @click="exportData"
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
          label="科目编码"
          :width="colWidth('account_code', 100)"
        >
          <template #default="{ row }">
            <span :style="{ paddingLeft: (row.level - 1) * 20 + 'px' }">{{
              row.account_code
            }}</span>
          </template>
        </el-table-column>
        <el-table-column
          column-key="account_name"
          prop="account_name"
          label="科目名称"
          :width="colWidth('account_name', 150)"
        >
          <template #default="{ row }">
            <span :style="{ paddingLeft: (row.level - 1) * 20 + 'px' }">{{
              row.account_name
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="期初余额" align="center">
          <el-table-column
            column-key="方向"
            label="方向"
            :width="colWidth('方向', 60)"
            align="center"
          >
            <template #default="{ row }">
              {{
                row.init_balance !== 0
                  ? row.init_balance > 0
                    ? row.direction === 'debit'
                      ? '借'
                      : '贷'
                    : row.direction === 'debit'
                      ? '贷'
                      : '借'
                  : ''
              }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="余额"
            label="余额"
            :width="colWidth('余额', 100)"
            align="right"
          >
            <template #default="{ row }">
              {{
                row.init_balance !== 0
                  ? formatAmount(Math.abs(row.init_balance))
                  : hideZero
                    ? ''
                    : formatAmount(0)
              }}
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="本期发生额" align="center">
          <el-table-column
            column-key="借方"
            label="借方"
            :width="colWidth('借方', 120)"
            align="right"
          >
            <template #default="{ row }">{{
              row.current_debit && row.current_debit > 0
                ? formatAmount(row.current_debit)
                : hideZero
                  ? ''
                  : formatAmount(0)
            }}</template>
          </el-table-column>
          <el-table-column
            column-key="贷方"
            label="贷方"
            :width="colWidth('贷方', 120)"
            align="right"
          >
            <template #default="{ row }">{{
              row.current_credit && row.current_credit > 0
                ? formatAmount(row.current_credit)
                : hideZero
                  ? ''
                  : formatAmount(0)
            }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="本年累计发生额" align="center">
          <el-table-column
            column-key="year_debit"
            label="借方"
            prop="year_debit"
            :width="colWidth('year_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{
              row.year_debit && row.year_debit > 0
                ? formatAmount(row.year_debit)
                : hideZero
                  ? ''
                  : formatAmount(0)
            }}</template>
          </el-table-column>
          <el-table-column
            column-key="year_credit"
            label="贷方"
            prop="year_credit"
            :width="colWidth('year_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{
              row.year_credit && row.year_credit > 0
                ? formatAmount(row.year_credit)
                : hideZero
                  ? ''
                  : formatAmount(0)
            }}</template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="期末余额" align="center">
          <el-table-column
            column-key="end_direction"
            label="方向"
            prop="end_direction"
            :width="colWidth('end_direction', 60)"
            align="center"
          >
            <template #default="{ row }">
              {{
                row.end_balance !== 0
                  ? row.end_balance > 0
                    ? row.direction === 'debit'
                      ? '借'
                      : '贷'
                    : row.direction === 'debit'
                      ? '贷'
                      : '借'
                  : ''
              }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="end_balance"
            label="余额"
            prop="end_balance"
            :width="colWidth('end_balance', 100)"
            align="right"
          >
            <template #default="{ row }">
              {{
                row.end_balance !== 0
                  ? formatAmount(Math.abs(row.end_balance))
                  : hideZero
                    ? ''
                    : formatAmount(0)
              }}
            </template>
          </el-table-column>
        </el-table-column>
        <template #empty>
          <EmptyState type="data" description="暂无数据，请选择期间后查询" />
        </template>
      </el-table>
    </div>

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:general"
      title="科目余额表"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useDrillDownNavigate } from '@/composables/useDrillDownNavigate'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import request from '@/api/request'
import type { TableColumnCtx } from 'element-plus'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { formatAmount } from '@/utils/format'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import {
  buildGeneralLedgerExportColumns,
  buildGeneralLedgerSummaryValues,
} from '@/utils/ledgerExportBuilders'
import { getSummaryAccountRows } from '@/utils/exportLedgerHelpers'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import { useUserStore } from '@/stores/user'

const { drillDown } = useDrillDownNavigate()
const { accountSetName } = storeToRefs(useUserStore())
const list = ref<any[]>([])
const loading = ref(false)
const initialLoaded = ref(false)
const hideZero = ref(true)

const ledgerColumnDefs = computed(() => [
  { key: 'account_code', fallback: 100 },
  { key: 'account_name', fallback: 150 },
  { key: '方向', fallback: 60 },
  { key: '余额', fallback: 100 },
  { key: '借方', fallback: 120 },
  { key: '贷方', fallback: 120 },
  { key: 'year_debit', fallback: 120 },
  { key: 'year_credit', fallback: 120 },
  { key: 'end_direction', fallback: 60 },
  { key: 'end_balance', fallback: 100 },
])

const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_general', ledgerColumnDefs, { afterLayout: relayoutAfterData })

const year = new Date().getFullYear()

const filters = ref<any>({
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  account_code: '',
  account_level: null,
  filter_types: ['init_balance', 'has_amount', 'has_balance'],
  include_unposted: true,
})

const printDateLabel = computed(() => {
  const s = filters.value.start_date || `${year}-01-01`
  const e = filters.value.end_date || `${year}-12-31`
  return `日期：${s} 至 ${e}`
})

// hiprint 套打
const hiprintVisible = ref(false)
function balDir(balance: number, acctDir: string): string {
  if (!balance) return ''
  const dr = balance > 0 ? acctDir === 'debit' : acctDir !== 'debit'
  return dr ? '借' : '贷'
}
function amt(v: number): string {
  return v && v > 0 ? formatAmount(v) : hideZero.value ? '' : formatAmount(0)
}
function buildPrintHtml(): string {
  const summaryRows = getSummaryRows(list.value)
  const initSides = sumBalanceSides(summaryRows, 'init_balance')
  const endSides = sumBalanceSides(summaryRows, 'end_balance')
  const initNet = initSides.debit - initSides.credit
  const endNet = endSides.debit - endSides.credit

  return buildTablePrintHtml<any>({
    title: '科目余额表',
    subtitle: [`账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`],
    rows: list.value,
    monochrome: true,
    fitToPage: true,
    headerRows: [
      [
        { label: '科目编码', rowspan: 2, width: '10%' },
        { label: '科目名称', rowspan: 2, width: '17%' },
        { label: '期初余额', colspan: 2 },
        { label: '本期发生额', colspan: 2 },
        { label: '本年累计发生额', colspan: 2 },
        { label: '期末余额', colspan: 2 },
      ],
      [
        { label: '方向', width: '5%' },
        { label: '余额', width: '10%' },
        { label: '借方', width: '10.5%' },
        { label: '贷方', width: '10.5%' },
        { label: '借方', width: '10.5%' },
        { label: '贷方', width: '10.5%' },
        { label: '方向', width: '5%' },
        { label: '余额', width: '11%' },
      ],
    ],
    columns: [
      {
        label: '科目编码',
        width: '10%',
        align: 'left',
        render: r => '　'.repeat(Math.max(0, (r.level || 1) - 1)) + (r.account_code || ''),
      },
      {
        label: '科目名称',
        width: '17%',
        align: 'left',
        render: r => '　'.repeat(Math.max(0, (r.level || 1) - 1)) + (r.account_name || ''),
      },
      {
        label: '期初方向',
        width: '5%',
        align: 'center',
        render: r => balDir(r.init_balance, r.direction),
      },
      {
        label: '期初余额',
        width: '10%',
        align: 'right',
        render: r =>
          r.init_balance !== 0
            ? formatAmount(Math.abs(r.init_balance))
            : hideZero.value
              ? ''
              : formatAmount(0),
      },
      { label: '本期借方', width: '10.5%', align: 'right', render: r => amt(r.current_debit) },
      { label: '本期贷方', width: '10.5%', align: 'right', render: r => amt(r.current_credit) },
      { label: '本年借方', width: '10.5%', align: 'right', render: r => amt(r.year_debit) },
      { label: '本年贷方', width: '10.5%', align: 'right', render: r => amt(r.year_credit) },
      {
        label: '期末方向',
        width: '5%',
        align: 'center',
        render: r => balDir(r.end_balance, r.direction),
      },
      {
        label: '期末余额',
        width: '11%',
        align: 'right',
        render: r =>
          r.end_balance !== 0
            ? formatAmount(Math.abs(r.end_balance))
            : hideZero.value
              ? ''
              : formatAmount(0),
      },
    ],
    footer: [
      '合计',
      '',
      formatBalanceDirection(initNet),
      formatAmount(Math.abs(initNet)),
      formatAmount(summaryRows.reduce((sum, row) => sum + (row.current_debit || 0), 0)),
      formatAmount(summaryRows.reduce((sum, row) => sum + (row.current_credit || 0), 0)),
      formatAmount(summaryRows.reduce((sum, row) => sum + (row.year_debit || 0), 0)),
      formatAmount(summaryRows.reduce((sum, row) => sum + (row.year_credit || 0), 0)),
      formatBalanceDirection(endNet),
      formatAmount(Math.abs(endNet)),
    ],
  })
}

function printPage() {
  if (!loading.value && list.value.length > 0) hiprintVisible.value = true
}

/** 将带符号余额拆分为借贷方展示金额（与表格行、后端 summary 一致） */
function splitBalanceToDebitCredit(balance: number, direction: string) {
  if (!balance) return { debit: 0, credit: 0 }
  const amount = Math.abs(balance)
  const onDebitSide =
    (balance > 0 && direction === 'debit') || (balance < 0 && direction === 'credit')
  return onDebitSide ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
}

function sumBalanceSides(rows: any[], field: 'init_balance' | 'end_balance') {
  return rows.reduce(
    (acc, row) => {
      const { debit, credit } = splitBalanceToDebitCredit(row[field] || 0, row.direction)
      acc.debit += debit
      acc.credit += credit
      return acc
    },
    { debit: 0, credit: 0 }
  )
}

function resolveSummaryColumnKey(column: TableColumnCtx<any>): string {
  if (column.columnKey != null && column.columnKey !== '') return String(column.columnKey)
  if (column.property) return String(column.property)
  return column.label ? String(column.label) : ''
}

function formatBalanceDirection(netBalance: number): string {
  if (Math.abs(netBalance) < 0.005) return '平'
  return netBalance > 0 ? '借' : '贷'
}

/** 合计行应参与的科目：优先一级科目（已含下级汇总），避免展开深层级时叶节点重复/方向不一致 */
function getSummaryRows(data: any[]) {
  if (!data.length) return []
  const level1Rows = data.filter(row => row.level === 1)
  if (level1Rows.length > 0) return level1Rows
  return data.filter(
    row =>
      !data.some(
        r => r.account_code !== row.account_code && r.account_code.startsWith(row.account_code)
      )
  )
}

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns, data } = param
  const summaryRows = getSummaryRows(data)
  const initSides = sumBalanceSides(summaryRows, 'init_balance')
  const endSides = sumBalanceSides(summaryRows, 'end_balance')
  const initNet = initSides.debit - initSides.credit
  const endNet = endSides.debit - endSides.credit

  return columns.map(column => {
    const key = resolveSummaryColumnKey(column)
    switch (key) {
      case 'account_code':
        return '合计'
      case 'account_name':
        return ''
      case '方向':
        return formatBalanceDirection(initNet)
      case '余额':
        return formatAmount(Math.abs(initNet))
      case '借方':
        return formatAmount(summaryRows.reduce((sum, row) => sum + (row.current_debit || 0), 0))
      case '贷方':
        return formatAmount(summaryRows.reduce((sum, row) => sum + (row.current_credit || 0), 0))
      case 'year_debit':
        return formatAmount(summaryRows.reduce((sum, row) => sum + (row.year_debit || 0), 0))
      case 'year_credit':
        return formatAmount(summaryRows.reduce((sum, row) => sum + (row.year_credit || 0), 0))
      case 'end_direction':
        return formatBalanceDirection(endNet)
      case 'end_balance':
        return formatAmount(Math.abs(endNet))
      default:
        return ''
    }
  })
}

async function fetchData() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.value.start_date) params.start_date = filters.value.start_date
    if (filters.value.end_date) params.end_date = filters.value.end_date
    if (filters.value.account_code) params.account_code = filters.value.account_code
    if (filters.value.account_level) params.account_level = filters.value.account_level
    if (filters.value.filter_types && filters.value.filter_types.length > 0) {
      params.filter_types = filters.value.filter_types.join(',')
    }
    if (filters.value.include_unposted) params.include_unposted = 'true'

    const res = await request.get<any[]>('/ledger/general', { params })
    list.value = res.data
    initialLoaded.value = true
    await afterTableLayout()
  } finally {
    loading.value = false
  }
}

async function exportData() {
  const dateRange =
    filters.value.start_date && filters.value.end_date
      ? `${filters.value.start_date}_${filters.value.end_date}`
      : new Date().toISOString().split('T')[0]
  const summaryRows = getSummaryAccountRows(list.value, filters.value.account_level)

  await exportStyledTable({
    fileName: `科目余额表_${dateRange}.xlsx`,
    sheetName: '科目余额表',
    title: '科目余额表',
    subtitle: printDateLabel.value,
    columns: buildGeneralLedgerExportColumns(colWidth, hideZero.value),
    rows: list.value,
    summaryValues: buildGeneralLedgerSummaryValues(summaryRows, hideZero.value),
  })
}

function handleRowDblClick(row: any) {
  // 双击行跳转到明细账页面
  const query: any = {}
  if (row.account_id) query.account_id = row.account_id
  else if (row.code) query.account_code = row.code

  // 传递当前的日期范围（如果有的话）
  if (filters.value.start_date) query.start_date = filters.value.start_date
  if (filters.value.end_date) query.end_date = filters.value.end_date

  drillDown('/ledger/detail', query, '科目余额表', {
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
    account_code: filters.value.account_code || '',
    account_level: filters.value.account_level ? String(filters.value.account_level) : '',
  })
}

onMounted(() => {
  fetchData()
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
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
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
