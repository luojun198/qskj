<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>库存数量金额表</h3>
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
        <el-divider direction="vertical" />
        <el-checkbox v-model="filters.include_unposted" @change="fetchData"
          >统计未记账凭证</el-checkbox
        >
        <el-checkbox v-model="indentAccounts">科目缩格显示</el-checkbox>
        <el-divider direction="vertical" />
        <el-button type="primary" @click="fetchData"
          ><el-icon><Search /></el-icon>查询</el-button
        >
        <FilterClearButton @clear="handleClearFilters" />
        <el-divider direction="vertical" />
        <el-button plain :disabled="list.length === 0" @click="exportData"
          ><el-icon><Download /></el-icon>另存</el-button
        >
        <el-button plain :disabled="loading || list.length === 0" @click="printPage">
          <el-icon><Printer /></el-icon>打印
        </el-button>
      </div>
    </div>

    <el-alert type="warning" :closable="false" class="qty-tips">
      <template #default>
        温馨提示： 1.双击科目可查看该科目明细账； 2.期初或者余额显示红色表示和科目的余额方向不符，请检查；
        3.当科目期初余额、本期借方、贷方发生额都为 0 时，不会在表中显示。
      </template>
    </el-alert>

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
          :width="colWidth('account_code', 110)"
          fixed
        >
          <template #default="{ row }">
            <span :style="indentStyle(row)">{{ row.account_code }}</span>
          </template>
        </el-table-column>
        <el-table-column
          column-key="account_name"
          prop="account_name"
          label="科目名称"
          :width="colWidth('account_name', 150)"
          fixed
        >
          <template #default="{ row }">
            <span :style="indentStyle(row)">{{ row.account_name }}</span>
          </template>
        </el-table-column>
        <el-table-column
          column-key="unit"
          prop="unit"
          label="单位"
          :width="colWidth('unit', 60)"
          align="center"
        />

        <el-table-column label="期初" align="center">
          <el-table-column
            column-key="init_direction"
            label="+/-"
            :width="colWidth('init_direction', 50)"
            align="center"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.init_balance, row) }">{{
                balDir(row.init_balance, row.direction)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="qty_init_balance"
            label="期初数量"
            :width="colWidth('qty_init_balance', 110)"
            align="right"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.init_balance, row) }">{{
                qty(row.qty_init_balance)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="init_balance"
            label="期初金额"
            :width="colWidth('init_balance', 110)"
            align="right"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.init_balance, row) }">{{
                amt(Math.abs(row.init_balance))
              }}</span>
            </template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="本期发生额" align="center">
          <el-table-column
            column-key="qty_current_debit"
            label="本期借方数量"
            :width="colWidth('qty_current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ qty(row.qty_current_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="current_debit"
            label="本期借方金额"
            :width="colWidth('current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.current_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="qty_current_credit"
            label="本期贷方数量"
            :width="colWidth('qty_current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ qty(row.qty_current_credit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="current_credit"
            label="本期贷方金额"
            :width="colWidth('current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.current_credit) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="本年累计发生额" align="center">
          <el-table-column
            column-key="qty_year_debit"
            label="累计借方数量"
            :width="colWidth('qty_year_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ qty(row.qty_year_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="year_debit"
            label="累计借方金额"
            :width="colWidth('year_debit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.year_debit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="qty_year_credit"
            label="累计贷方数量"
            :width="colWidth('qty_year_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ qty(row.qty_year_credit) }}</template>
          </el-table-column>
          <el-table-column
            column-key="year_credit"
            label="累计贷方金额"
            :width="colWidth('year_credit', 120)"
            align="right"
          >
            <template #default="{ row }">{{ amt(row.year_credit) }}</template>
          </el-table-column>
        </el-table-column>

        <el-table-column label="结余" align="center">
          <el-table-column
            column-key="end_direction"
            label="+/-"
            :width="colWidth('end_direction', 50)"
            align="center"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.end_balance, row) }">{{
                balDir(row.end_balance, row.direction)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="qty_end_balance"
            label="结余数量"
            :width="colWidth('qty_end_balance', 110)"
            align="right"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.end_balance, row) }">{{
                qty(row.qty_end_balance)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            column-key="end_unit_price"
            label="结余单价"
            :width="colWidth('end_unit_price', 110)"
            align="right"
          >
            <template #default="{ row }">{{ price(endUnitPrice(row)) }}</template>
          </el-table-column>
          <el-table-column
            column-key="end_balance"
            label="结余金额"
            :width="colWidth('end_balance', 110)"
            align="right"
          >
            <template #default="{ row }">
              <span :class="{ 'qty-mismatch': isDirectionMismatch(row.end_balance, row) }">{{
                amt(Math.abs(row.end_balance))
              }}</span>
            </template>
          </el-table-column>
        </el-table-column>

        <template #empty>
          <EmptyState
            type="data"
            description="暂无数据。请先在「会计科目」里给存货类科目勾选「数量」并填写计量单位。"
          />
        </template>
      </el-table>
    </div>

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:quantity-balance"
      title="库存数量金额表"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
      :show-font-size="true"
    />
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import type { TableColumnCtx } from 'element-plus'
import request from '@/api/request'
import { useDrillDownNavigate } from '@/composables/useDrillDownNavigate'
import { useLedgerWideTable } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { formatAmount } from '@/utils/format'
import { sumBalanceSides } from '@/utils/exportLedgerHelpers'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { buildQuantityBalanceExportColumns } from '@/utils/ledgerExportBuilders'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import EmptyState from '@/components/EmptyState.vue'
import { useUserStore } from '@/stores/user'
import { useRacedQuery } from '@/composables/useRacedQuery'

const { drillDown } = useDrillDownNavigate()
const { accountSetName } = storeToRefs(useUserStore())

const list = ref<any[]>([])
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const initialLoaded = ref(false)
const hideZero = ref(true)
const indentAccounts = ref(false)

const year = new Date().getFullYear()
const filters = ref<any>({
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  account_code: '',
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
  { key: 'unit', fallback: 60 },
  { key: 'init_direction', fallback: 50 },
  { key: 'qty_init_balance', fallback: 110 },
  { key: 'init_balance', fallback: 110 },
  { key: 'qty_current_debit', fallback: 120 },
  { key: 'current_debit', fallback: 120 },
  { key: 'qty_current_credit', fallback: 120 },
  { key: 'current_credit', fallback: 120 },
  { key: 'qty_year_debit', fallback: 120 },
  { key: 'year_debit', fallback: 120 },
  { key: 'qty_year_credit', fallback: 120 },
  { key: 'year_credit', fallback: 120 },
  { key: 'end_direction', fallback: 50 },
  { key: 'qty_end_balance', fallback: 110 },
  { key: 'end_unit_price', fallback: 110 },
  { key: 'end_balance', fallback: 110 },
])

const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_quantity_balance', ledgerColumnDefs, {
    afterLayout: relayoutAfterData,
  })

const printDateLabel = computed(
  () => `日期：${filters.value.start_date || ''} 至 ${filters.value.end_date || ''}`
)

// ========== 展示格式 ==========

/** 数量：最多 6 位小数，0 时按「隐藏零值」留空 */
function qty(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (!n) return hideZero.value ? '' : '0.000000'
  return Math.abs(n).toFixed(6)
}

/** 单价：4 位小数（与参考图 11.1000 一致） */
function price(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (!n) return hideZero.value ? '' : '0.0000'
  return n.toFixed(4)
}

function amt(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (!n) return hideZero.value ? '' : formatAmount(0)
  return formatAmount(n)
}

/** 结余单价 = 结余金额 / 结余数量（除零由此处兜底，故不放进 SQL） */
function endUnitPrice(row: any): number {
  const q = Number(row?.qty_end_balance) || 0
  if (!q) return 0
  return (Number(row?.end_balance) || 0) / q
}

function balDir(balance: number, acctDir: string): string {
  if (!balance) return ''
  const onDebitSide = balance > 0 ? acctDir === 'debit' : acctDir !== 'debit'
  return onDebitSide ? '借' : '贷'
}

/** 余额为负 = 实际方向与科目余额方向相反，参考图要求标红提示检查 */
function isDirectionMismatch(balance: number | null | undefined, _row: any): boolean {
  return (Number(balance) || 0) < 0
}

function indentStyle(row: any) {
  if (!indentAccounts.value) return undefined
  return { paddingLeft: `${Math.max(0, (Number(row.level) || 1) - 1) * 20}px` }
}

// ========== 合计 ==========

function resolveSummaryColumnKey(column: TableColumnCtx<any>): string {
  if (column.columnKey != null && column.columnKey !== '') return String(column.columnKey)
  if (column.property) return String(column.property)
  return column.label ? String(column.label) : ''
}

/**
 * 数量核算科目按 is_quantity 平铺返回、不做父子汇总，故合计直接累加全部行。
 * 数量列不给合计：不同科目计量单位可能不同，加总没有业务含义。
 */
function sumOf(field: string): number {
  return list.value.reduce((sum, row) => sum + (Number(row[field]) || 0), 0)
}

/**
 * FIX-159：余额合计分侧累加（借方性质余额与贷方性质余额各归一侧），再按净额给方向，
 * 与行显示「+/- + 绝对值」口径一致；此前直接带符号相加会把 -100 与 +80 抵成 -20 且无方向
 */
function balanceSideTotal(field: 'init_balance' | 'end_balance') {
  const { debit, credit } = sumBalanceSides(list.value as any[], field)
  const net = debit - credit
  return { amount: Math.abs(net), label: net > 0 ? '借' : net < 0 ? '贷' : '平' }
}

function getSummaries(param: { columns: TableColumnCtx<any>[] }) {
  return param.columns.map(column => {
    switch (resolveSummaryColumnKey(column)) {
      case 'account_code':
        return '合计'
      case 'init_direction':
        return balanceSideTotal('init_balance').label
      case 'end_direction':
        return balanceSideTotal('end_balance').label
      case 'init_balance':
        return formatAmount(balanceSideTotal('init_balance').amount)
      case 'current_debit':
        return formatAmount(sumOf('current_debit'))
      case 'current_credit':
        return formatAmount(sumOf('current_credit'))
      case 'year_debit':
        return formatAmount(sumOf('year_debit'))
      case 'year_credit':
        return formatAmount(sumOf('year_credit'))
      case 'end_balance':
        return formatAmount(balanceSideTotal('end_balance').amount)
      default:
        return ''
    }
  })
}

// ========== 取数 ==========

async function fetchData() {
  const params: any = {}
  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.account_code) params.account_code = filters.value.account_code
  if (filters.value.include_unposted) params.include_unposted = 'true'

  const res = await raced.run(() => request.get<any[]>('/ledger/quantity-balance', { params }))
  if (!res) return
  list.value = res.data || []
  initialLoaded.value = true
  await afterTableLayout()
}

// ========== 导出 / 打印 ==========

async function exportData() {
  const dateRange =
    filters.value.start_date && filters.value.end_date
      ? `${filters.value.start_date}_${filters.value.end_date}`
      : todayStr()

  await exportStyledTable({
    fileName: `库存数量金额表_${dateRange}.xlsx`,
    sheetName: '库存数量金额表',
    title: '库存数量金额表',
    subtitle: printDateLabel.value,
    columns: buildQuantityBalanceExportColumns(colWidth, hideZero.value),
    rows: list.value.map(row => ({ ...row, end_unit_price: endUnitPrice(row) })),
  })
}

const hiprintVisible = ref(false)

function printPage() {
  if (!loading.value && list.value.length > 0) hiprintVisible.value = true
}

function buildPrintHtml(ctx?: { fontSize?: number }): string {
  return buildTablePrintHtml<any>({
    title: '库存数量金额表',
    subtitle: [`账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`],
    rows: list.value,
    monochrome: true,
    fitToPage: true,
    fontSize: ctx?.fontSize ?? 11,
    headerRows: [
      [
        { label: '科目编码', rowspan: 2, width: '8%' },
        { label: '科目名称', rowspan: 2, width: '10%' },
        { label: '单位', rowspan: 2, width: '4%' },
        { label: '期初', colspan: 3 },
        { label: '本期发生额', colspan: 4 },
        { label: '本年累计发生额', colspan: 4 },
        { label: '结余', colspan: 4 },
      ],
      [
        { label: '+/-', width: '3%' },
        { label: '数量', width: '6%' },
        { label: '金额', width: '6%' },
        { label: '借方数量', width: '5.5%' },
        { label: '借方金额', width: '5.5%' },
        { label: '贷方数量', width: '5.5%' },
        { label: '贷方金额', width: '5.5%' },
        { label: '借方数量', width: '5.5%' },
        { label: '借方金额', width: '5.5%' },
        { label: '贷方数量', width: '5.5%' },
        { label: '贷方金额', width: '5.5%' },
        { label: '+/-', width: '3%' },
        { label: '数量', width: '5%' },
        { label: '单价', width: '5%' },
        { label: '金额', width: '6%' },
      ],
    ],
    columns: [
      { label: '科目编码', width: '8%', align: 'left', render: r => r.account_code || '' },
      { label: '科目名称', width: '10%', align: 'left', render: r => r.account_name || '' },
      { label: '单位', width: '4%', align: 'center', render: r => r.unit || '' },
      { label: '期初+/-', width: '3%', align: 'center', render: r => balDir(r.init_balance, r.direction) },
      { label: '期初数量', width: '6%', align: 'right', render: r => qty(r.qty_init_balance) },
      { label: '期初金额', width: '6%', align: 'right', render: r => amt(Math.abs(r.init_balance)) },
      { label: '本期借方数量', width: '5.5%', align: 'right', render: r => qty(r.qty_current_debit) },
      { label: '本期借方金额', width: '5.5%', align: 'right', render: r => amt(r.current_debit) },
      { label: '本期贷方数量', width: '5.5%', align: 'right', render: r => qty(r.qty_current_credit) },
      { label: '本期贷方金额', width: '5.5%', align: 'right', render: r => amt(r.current_credit) },
      { label: '累计借方数量', width: '5.5%', align: 'right', render: r => qty(r.qty_year_debit) },
      { label: '累计借方金额', width: '5.5%', align: 'right', render: r => amt(r.year_debit) },
      { label: '累计贷方数量', width: '5.5%', align: 'right', render: r => qty(r.qty_year_credit) },
      { label: '累计贷方金额', width: '5.5%', align: 'right', render: r => amt(r.year_credit) },
      { label: '结余+/-', width: '3%', align: 'center', render: r => balDir(r.end_balance, r.direction) },
      { label: '结余数量', width: '5%', align: 'right', render: r => qty(r.qty_end_balance) },
      { label: '结余单价', width: '5%', align: 'right', render: r => price(endUnitPrice(r)) },
      { label: '结余金额', width: '6%', align: 'right', render: r => amt(Math.abs(r.end_balance)) },
    ],
    footer: [
      '合计',
      '',
      '',
      balanceSideTotal('init_balance').label,
      '',
      formatAmount(balanceSideTotal('init_balance').amount),
      '',
      formatAmount(sumOf('current_debit')),
      '',
      formatAmount(sumOf('current_credit')),
      '',
      formatAmount(sumOf('year_debit')),
      '',
      formatAmount(sumOf('year_credit')),
      balanceSideTotal('end_balance').label,
      '',
      '',
      formatAmount(balanceSideTotal('end_balance').amount),
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
  query.book = Number(row.is_foreign) === 1 ? 'quantity-foreign' : 'quantity'

  drillDown('/ledger/detail', query, '库存数量金额表', {
    start_date: filters.value.start_date || '',
    end_date: filters.value.end_date || '',
    account_code: filters.value.account_code || '',
  })
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.page {
  padding: var(--page-pad);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.qty-tips {
  margin-bottom: 8px;
}

.qty-mismatch {
  color: var(--el-color-danger);
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
