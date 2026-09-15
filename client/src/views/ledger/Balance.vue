<template>
  <div class="page page-ledger">
    <div class="page-header">
      <h3>总分类账</h3>
      <div class="filter-row">
        <el-select v-model="filters.year" class="filter-ctl--xs" @change="fetchData">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-input
          v-model="filters.account_code"
          placeholder="科目编码"
          clearable
          class="filter-ctl--sm"
          @clear="fetchData"
          @keyup.enter="fetchData"
        />
        <AccountLevelButtons
          :at-top="levelFilter.atTop.value"
          :at-bottom="levelFilter.atBottom.value"
          @top="levelFilter.goTop"
          @up="levelFilter.goUp"
          @down="levelFilter.goDown"
          @bottom="levelFilter.goBottom"
        />
        <el-divider direction="vertical" />
        <el-checkbox v-model="hideNoActivity">隐藏未发生</el-checkbox>
        <el-divider direction="vertical" />
        <el-checkbox v-model="filters.include_unposted" @change="fetchData">统计未记账凭证</el-checkbox>
        <el-divider direction="vertical" />
        <el-button type="primary" @click="fetchData"><el-icon><Search /></el-icon>查询</el-button>
        <el-divider direction="vertical" />
        <el-button plain @click="exportData"><el-icon><Download /></el-icon>导出 Excel</el-button>
        <el-button plain @click="printPage"><el-icon><Printer /></el-icon>打印</el-button>
        <span class="balance-tag" :class="isBalanced ? 'ok' : 'err'">
          {{ isBalanced ? '借贷平衡' : '借贷不平衡' }}
        </span>
      </div>
    </div>
    <AccountScopeAlert />

    <div v-if="!initialLoaded && loading" class="skeleton-table">
      <div v-for="i in 8" :key="i" class="skeleton skeleton-row" />
    </div>

    <div v-else v-loading="loading" ref="tableContainerRef" class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow">
    <el-table
      :key="displayMonths.join('-') || '0'"
      ref="tableRef"
      :height="tableHeight"
      :data="filteredList"
      :style="{ width: `${ledgerTableWidth}px` }"
      :fit="false"
      stripe
      border
      size="small"
      class="compact-data-table"
      highlight-current-row
      show-summary
      :summary-method="getSummaries"
      :header-cell-style="headerCellStyle"
      @header-dragend="handleHeaderDragEnd"
    >
      <!-- 科目编码（宽表横向滚动，不使用 fixed 以免与滚动层冲突） -->
      <el-table-column
        column-key="account_code"
        prop="account_code"
        label="科目编码"
        :width="colWidth('account_code', 120)"
      >
        <template #default="{ row }">
          <span :style="{ paddingLeft: (row.level - 1) * 16 + 'px' }">
            {{ row.account_code }}
          </span>
        </template>
      </el-table-column>
      <el-table-column
        column-key="account_name"
        prop="account_name"
        label="科目名称"
        :width="colWidth('account_name', 160)"
      >
        <template #default="{ row }">
          <span
            :style="{
              paddingLeft: (row.level - 1) * 16 + 'px',
              fontWeight: row.level === 1 ? 'bold' : 'normal',
            }"
          >
            {{ row.account_name }}
          </span>
        </template>
      </el-table-column>

      <!-- 期初余额 -->
      <el-table-column label="期初余额" align="center">
        <el-table-column
          label="借方"
          :width="colWidth('init_debit', 100)"
          align="right"
          prop="init_debit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(splitBalanceToDebitCredit(row.init_balance, row.direction).debit) }}
          </template>
        </el-table-column>
        <el-table-column
          label="贷方"
          :width="colWidth('init_credit', 100)"
          align="right"
          prop="init_credit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(splitBalanceToDebitCredit(row.init_balance, row.direction).credit) }}
          </template>
        </el-table-column>
      </el-table-column>

      <!-- 已发生月份的发生额（1..lastActiveMonth） -->
      <el-table-column v-for="m in displayMonths" :key="m" :label="m + '月'" align="center">
        <el-table-column
          label="借方"
          :width="colWidth('month' + m + '_debit', 90)"
          align="right"
          :prop="'month' + m + '_debit'"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(row['month' + m + '_debit']) }}
          </template>
        </el-table-column>
        <el-table-column
          label="贷方"
          :width="colWidth('month' + m + '_credit', 90)"
          align="right"
          :prop="'month' + m + '_credit'"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(row['month' + m + '_credit']) }}
          </template>
        </el-table-column>
      </el-table-column>

      <!-- 本年累计 -->
      <el-table-column label="本年累计" align="center">
        <el-table-column
          label="借方"
          :width="colWidth('year_debit', 100)"
          align="right"
          prop="year_debit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(row.year_debit) }}
          </template>
        </el-table-column>
        <el-table-column
          label="贷方"
          :width="colWidth('year_credit', 100)"
          align="right"
          prop="year_credit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(row.year_credit) }}
          </template>
        </el-table-column>
      </el-table-column>

      <!-- 期末余额 -->
      <el-table-column label="期末余额" align="center">
        <el-table-column
          label="借方"
          :width="colWidth('end_debit', 100)"
          align="right"
          prop="end_debit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(splitBalanceToDebitCredit(row.end_balance, row.direction).debit) }}
          </template>
        </el-table-column>
        <el-table-column
          label="贷方"
          :width="colWidth('end_credit', 100)"
          align="right"
          prop="end_credit"
        >
          <template #default="{ row }">
            {{ fmtMonthAmount(splitBalanceToDebitCredit(row.end_balance, row.direction).credit) }}
          </template>
        </el-table-column>
      </el-table-column>
      <template #empty>
        <EmptyState type="data" description="暂无数据，请选择科目和期间后查询" />
      </template>
    </el-table>
    </div>

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      template-key="ledger:balance"
      title="总分类账"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import request from '@/api/request'
import { Printer, Search, Download } from '@element-plus/icons-vue'
import type { TableColumnCtx } from 'element-plus'
import { formatAmount } from '@/utils/format'
import { useLedgerWideTable, type LedgerColDef } from '@/composables/useLedgerWideTable'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import AccountLevelButtons from '@/components/ledger/AccountLevelButtons.vue'
import { useAccountLevelFilter } from '@/composables/useAccountLevelFilter'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { useUserStore } from '@/stores/user'
import {
  buildBalanceSheetExportColumns,
  buildBalanceSheetSummaryValues,
} from '@/utils/ledgerExportBuilders'
import { splitBalanceToDebitCredit, sumBalanceSides } from '@/utils/exportLedgerHelpers'
import { useRacedQuery } from '@/composables/useRacedQuery'

const { containerRef: tableContainerRef, tableHeight, relayoutAfterData } = useFillHeightTable({ flow: true })

const list = ref<any[]>([])
const lastActiveMonth = ref(0)
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading
const initialLoaded = ref(false)
const hideNoActivity = ref(true)
const years = Array.from({ length: new Date().getFullYear() - 2000 + 1 }, (_, i) => new Date().getFullYear() - i)

const filters = ref<any>({
  year: new Date().getFullYear(),
  account_code: '',
  include_unposted: true,
})

/** 数据里出现过的最深级次；按级次过滤后的返回不能代表真实深度，故取累计最大值 */
const deepestLevel = ref(0)
// 顶层 / 上级 / 下级 / 底层：默认底层（不限级次），与科目维护同一套按钮与快捷键
const levelFilter = useAccountLevelFilter({
  getMaxLevel: () => deepestLevel.value,
  onChange: () => fetchData(),
})
const accountLevel = levelFilter.accountLevel

/** 仅展示已有凭证的月份（1..lastActiveMonth） */
const displayMonths = computed(() =>
  lastActiveMonth.value > 0
    ? Array.from({ length: lastActiveMonth.value }, (_, i) => i + 1)
    : []
)

const ledgerColumnDefs = computed((): LedgerColDef[] => {
  const defs: LedgerColDef[] = [
    { key: 'account_code', fallback: 120 },
    { key: 'account_name', fallback: 160 },
    { key: 'init_debit', fallback: 100 },
    { key: 'init_credit', fallback: 100 },
  ]
  for (const m of displayMonths.value) {
    defs.push({ key: `month${m}_debit`, fallback: 90 })
    defs.push({ key: `month${m}_credit`, fallback: 90 })
  }
  defs.push(
    { key: 'year_debit', fallback: 100 },
    { key: 'year_credit', fallback: 100 },
    { key: 'end_debit', fallback: 100 },
    { key: 'end_credit', fallback: 100 }
  )
  return defs
})

const { tableRef, colWidth, ledgerTableWidth, handleHeaderDragEnd, afterTableLayout } =
  useLedgerWideTable('ledger_balance', ledgerColumnDefs, { afterLayout: relayoutAfterData })

const printDateLabel = computed(() => {
  const y = filters.value.year
  if (lastActiveMonth.value > 0) {
    return `日期：${y}年1-${lastActiveMonth.value}月`
  }
  return `日期：${y}年`
})

const { accountSetName } = storeToRefs(useUserStore())

// hiprint 套打
const hiprintVisible = ref(false)

function printPage() {
  // 经 HiprintDialog 预览打印：仅输出表头 + 表格，不含页面导航、筛选栏等无关内容
  if (filteredList.value.length === 0) return
  hiprintVisible.value = true
}

/** 构造总分类账打印 HTML：动态月份列，期初/各月/本年累计/期末 分组两级表头 */
function buildPrintHtml(): string {
  const months = displayMonths.value
  // 列定义（与表格顺序一致：编码、名称、期初借贷、各月借贷、本年借贷、期末借贷）
  type PrintCol = { label: string; align: 'left' | 'center' | 'right'; render: (r: any) => string }
  const columns: PrintCol[] = [
    {
      label: '科目编码',
      align: 'left',
      render: r => '　'.repeat(Math.max(0, (r.level || 1) - 1)) + (r.account_code || ''),
    },
    {
      label: '科目名称',
      align: 'left',
      render: r => '　'.repeat(Math.max(0, (r.level || 1) - 1)) + (r.account_name || ''),
    },
    {
      label: '期初借方',
      align: 'right',
      render: r => fmtMonthAmount(splitBalanceToDebitCredit(r.init_balance, r.direction).debit),
    },
    {
      label: '期初贷方',
      align: 'right',
      render: r => fmtMonthAmount(splitBalanceToDebitCredit(r.init_balance, r.direction).credit),
    },
  ]
  for (const m of months) {
    columns.push({
      label: `${m}月借方`,
      align: 'right',
      render: r => fmtMonthAmount(r['month' + m + '_debit']),
    })
    columns.push({
      label: `${m}月贷方`,
      align: 'right',
      render: r => fmtMonthAmount(r['month' + m + '_credit']),
    })
  }
  columns.push(
    { label: '本年累计借方', align: 'right', render: r => fmtMonthAmount(r.year_debit) },
    { label: '本年累计贷方', align: 'right', render: r => fmtMonthAmount(r.year_credit) },
    {
      label: '期末借方',
      align: 'right',
      render: r => fmtMonthAmount(splitBalanceToDebitCredit(r.end_balance, r.direction).debit),
    },
    {
      label: '期末贷方',
      align: 'right',
      render: r => fmtMonthAmount(splitBalanceToDebitCredit(r.end_balance, r.direction).credit),
    }
  )

  // 两级表头：第一行分组（科目 rowspan2、期初/各月/本年累计/期末 colspan2），第二行借/贷
  const headerRow1: { label: string; rowspan?: number; colspan?: number }[] = [
    { label: '科目编码', rowspan: 2 },
    { label: '科目名称', rowspan: 2 },
    { label: '期初余额', colspan: 2 },
  ]
  for (const m of months) headerRow1.push({ label: `${m}月`, colspan: 2 })
  headerRow1.push({ label: '本年累计', colspan: 2 }, { label: '期末余额', colspan: 2 })

  const headerRow2: { label: string }[] = []
  for (let i = 0; i < columns.length; i++) {
    // 跳过 rowspan 占位（科目编码、科目名称已在第一行合并）
    if (i === 0 || i === 1) continue
    headerRow2.push({ label: columns[i].label.includes('借') ? '借方' : '贷方' })
  }

  return buildTablePrintHtml<any>({
    title: '总分类账',
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${printDateLabel.value}`,
    rows: filteredList.value,
    monochrome: true,
    fitToPage: true,
    headerRows: [headerRow1, headerRow2],
    columns,
  })
}

// 前端筛选：隐藏未发生的科目（科目编码和级次已由后端筛选）
const filteredList = computed(() => {
  if (!hideNoActivity.value) return list.value
  return list.value.filter(r => {
    // 有期初余额 或 有任何月发生额 或 有期末余额
    if (Math.abs(r.init_balance) > 0.005) return true
    if (Math.abs(r.end_balance) > 0.005) return true
    for (let m = 1; m <= 12; m++) {
      if ((r['month' + m + '_debit'] || 0) > 0.005 || (r['month' + m + '_credit'] || 0) > 0.005)
        return true
    }
    return false
  })
})

const isBalanced = computed(() => {
  const data = list.value
  const t = 0.01
  // 叶节点 = 当前数据集里没有任何以本科目编码为前缀的子项；
  // 不依赖具体级次，避免“展开到 3 级但数据最深只到 2 级”时漏掉行。
  const leafData = data.filter(
    row => !data.some(r => r.account_code !== row.account_code && r.account_code.startsWith(row.account_code))
  )
  // 用 sumBalanceSides 按科目方向拆分借贷，反方向（负数）余额会落到另一侧，避免被漏计
  const init = sumBalanceSides(leafData, 'init_balance')
  const end = sumBalanceSides(leafData, 'end_balance')
  const yearDebit = leafData.reduce((s, r) => s + (r.year_debit || 0), 0)
  const yearCredit = leafData.reduce((s, r) => s + (r.year_credit || 0), 0)
  return (
    Math.abs(init.debit - init.credit) < t &&
    Math.abs(yearDebit - yearCredit) < t &&
    Math.abs(end.debit - end.credit) < t
  )
})

function fmt(val: number) {
  if (!val) return ''
  return formatAmount(Math.abs(val))
}

/** 月度发生额：无发生也显示 0.00，保持表格网格 */
function fmtMonthAmount(val: number) {
  return formatAmount(Math.abs(val || 0))
}

function headerCellStyle({ rowIndex }: any) {
  if (rowIndex === 0) {
    return {
      background: '#e8f0fe',
      color: '#303133',
      fontWeight: 'bold',
      textAlign: 'center' as const,
    }
  }
  return {
    background: '#f5f7fa',
    color: '#606266',
    fontWeight: 'normal',
    textAlign: 'center' as const,
  }
}

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns } = param

  // 关键：合计必须只对"叶节点"求和，否则同时计入父科目（已汇总）与子科目时
  // 会重复累加。"叶节点"的统一定义 —— 在当前数据集里没有任何以自己编码为前缀
  // 的下级科目；这样无论是否限定级次、限定到几级、是否存在该级科目，
  // 都能正确取到真正的"最深可见行"，合计始终等于所有一级科目之和。
  // 使用 list.value（全量数据）而非传入的 data（受 hideNoActivity 过滤），
  // 这样隐藏未发生科目时合计仍保持真实总额不变。
  const all = list.value
  const leafData = all.filter(
    r => !all.some(o => o.account_code !== r.account_code && o.account_code.startsWith(r.account_code))
  )

  // 用 sumBalanceSides 按科目方向拆分，反方向（负数）余额落到另一侧，合计不再漏计
  const initSides = sumBalanceSides(leafData, 'init_balance')
  const endSides = sumBalanceSides(leafData, 'end_balance')
  const calcInitDebit = initSides.debit
  const calcInitCredit = initSides.credit
  const calcEndDebit = endSides.debit
  const calcEndCredit = endSides.credit
  const calcYearDebit = leafData.reduce((s, r) => s + (r.year_debit || 0), 0)
  const calcYearCredit = leafData.reduce((s, r) => s + (r.year_credit || 0), 0)

  const sums: string[] = []

  columns.forEach((column, index) => {
    if (index === 0) {
      sums[index] = '合计'
      return
    }
    if (index === 1) {
      sums[index] = ''
      return
    }

    const prop = column.property
    if (!prop) {
      sums[index] = ''
      return
    }

    if (prop === 'init_debit') sums[index] = fmt(calcInitDebit)
    else if (prop === 'init_credit') sums[index] = fmt(calcInitCredit)
    else if (prop === 'end_debit') sums[index] = fmt(calcEndDebit)
    else if (prop === 'end_credit') sums[index] = fmt(calcEndCredit)
    else if (prop === 'year_debit') sums[index] = fmt(calcYearDebit)
    else if (prop === 'year_credit') sums[index] = fmt(calcYearCredit)
    else {
      const match = prop.match(/^month(\d+)_(debit|credit)$/)
      if (match) {
        const m = Number(match[1])
        const type = match[2]
        // 月度合计同样用叶节点，避免父子科目重复累加
        const total = leafData.reduce((s, r) => s + (r[`month${m}_${type}`] || 0), 0)
        sums[index] = fmtMonthAmount(total)
      } else {
        sums[index] = ''
      }
    }
  })

  return sums
}

async function fetchData() {
  {
    const params: any = { year: filters.value.year }
    if (filters.value.account_code) params.account_code = filters.value.account_code
    if (accountLevel.value) params.account_level = accountLevel.value
    if (filters.value.include_unposted) params.include_unposted = 'true'

    const res = await raced.run(() => request.get<any>('/ledger/general-ledger', { params }))
    if (!res) return
    list.value = res.data || []
    deepestLevel.value = Math.max(
      deepestLevel.value,
      ...list.value.map((row: any) => Number(row.level) || 0)
    )
    lastActiveMonth.value = Number((res as { lastActiveMonth?: number }).lastActiveMonth) || 0
    initialLoaded.value = true
    await afterTableLayout()
  }
}

async function exportData() {
  await exportStyledTable({
    fileName: `总分类账_${filters.value.year}.xlsx`,
    sheetName: '总分类账',
    title: '总分类账',
    subtitle: printDateLabel.value,
    columns: buildBalanceSheetExportColumns(colWidth, displayMonths.value),
    rows: filteredList.value,
    summaryValues: buildBalanceSheetSummaryValues(filteredList.value, displayMonths.value),
  })
}

onMounted(async () => {
  await fetchData()
})
</script>

<style scoped>
.page {
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.page-header h2 {
  margin: 0;
}

.balance-tag {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: var(--cw-text-base);
  font-weight: 500;
}
.balance-tag.ok {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.balance-tag.err {
  background: #fef0f0;
  color: #f56c6c;
  border: 1px solid #fbc4c4;
}

.skeleton-table {
  flex: 1;
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

