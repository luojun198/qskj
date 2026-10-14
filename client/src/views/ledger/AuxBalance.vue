<template>
  <div class="page page-ledger page-ledger-aux">
    <div class="page-header">
      <div class="header-left">
        <h3>{{ pageTitle }}</h3>
        <div class="filter-hint">
          <span class="filter-hint-label">当前筛选：</span>
          <span class="filter-hint-text">{{ filterHintText }}</span>
        </div>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="drawerVisible = true">
          <el-icon><Filter /></el-icon>
          筛选
        </el-button>
        <el-divider direction="vertical" />
        <el-button plain :loading="loadingAll" @click="handleLoadAll">全部加载</el-button>
        <el-button
          plain
          :loading="exportProgress.visible"
          :disabled="exportProgress.visible"
          @click="exportData"
        >
          <el-icon><Download /></el-icon>
          另存
        </el-button>
        <el-button plain :disabled="loadingAll || list.length === 0" @click="printPage">
          <el-icon><Printer /></el-icon>
          打印
        </el-button>
      </div>
    </div>
    <AccountScopeAlert />

    <div
      v-if="loadProgress.total > 0 && loadProgress.loaded < loadProgress.total"
      class="load-progress-bar"
    >
      <div class="load-progress-bar__head">
        <span class="load-progress-bar__title">
          {{ loading ? '正在加载辅助项目余额' : '后台继续加载剩余数据' }}
        </span>
        <span class="load-progress-bar__count">
          项目 {{ loadProgress.loaded.toLocaleString() }} /
          {{ loadProgress.total.toLocaleString() }} （{{ loadProgressPercent }}%） · 已载入明细
          {{ allRows.length.toLocaleString() }} 条
        </span>
      </div>
      <el-progress :percentage="loadProgressPercent" :stroke-width="16" :show-text="false" />
      <p class="load-progress-bar__tip">
        首批数据加载完成后可先浏览；全部加载完成前列表条数与表尾合计可能尚未最终一致。
        <template v-if="summaryLoading">表尾合计计算中…</template>
      </p>
    </div>

    <!-- 筛选抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      title="筛选条件"
      direction="rtl"
      size="480px"
      :close-on-click-modal="false"
    >
      <div class="drawer-content">
        <div class="filter-item">
          <label>辅助类别</label>
          <el-select
            v-model="filters.aux_category_ids"
            multiple
            filterable
            clearable
            placeholder="选择辅助类别（可多选）"
            style="width: 100%"
            @change="onAuxCategoryChange"
          >
            <el-option
              v-for="cat in auxCategories"
              :key="cat.id"
              :label="cat.name"
              :value="cat.id"
            />
          </el-select>
        </div>

        <div class="filter-item">
          <label>辅助项目</label>
          <el-input
            v-if="filters.aux_category_ids.length > 0"
            v-model="auxItemSearchKeyword"
            placeholder="快速检索项目（编码/名称）"
            clearable
            style="margin-bottom: 8px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <div
            v-loading="auxItemsLoading || auxItemSearching"
            class="checkbox-list"
            v-if="filters.aux_category_ids.length > 0 && !auxItemsLoading"
          >
            <template v-for="cat in filteredCategoryItems" :key="cat.id">
              <div class="category-group" v-if="cat.needsSearch">
                <div class="category-header">
                  <div class="category-label">{{ cat.name }}</div>
                </div>
                <div class="empty-hint">
                  共 {{ cat.totalCount.toLocaleString() }} 个项目，请输入上方关键词检索后勾选
                </div>
              </div>
              <div class="category-group" v-else-if="cat.items.length > 0">
                <div class="category-header">
                  <div class="category-label">{{ cat.name }}</div>
                  <div class="category-actions">
                    <el-button link size="small" @click="selectCategoryItems(cat.id)"
                      >全选</el-button
                    >
                    <el-button link size="small" @click="invertCategorySelection(cat.id)"
                      >反选</el-button
                    >
                    <el-button link size="small" @click="clearCategorySelection(cat.id)"
                      >清空</el-button
                    >
                  </div>
                </div>
                <div
                  class="category-items cw-grouped-checkbox-items cw-grouped-checkbox-items--stack"
                >
                  <el-checkbox
                    v-for="item in cat.items"
                    :key="item.id"
                    v-model="itemCheckMap[item.id]"
                    @change="onItemCheckChange"
                  >
                    {{ item.code }} {{ item.name }}
                  </el-checkbox>
                </div>
                <div v-if="cat.truncated" class="empty-hint">
                  匹配结果较多，仅显示前 {{ AUX_FILTER_SEARCH_LIMIT }} 项，请输入更精确的关键词
                </div>
              </div>
              <div class="category-group" v-else>
                <div class="category-header">
                  <div class="category-label">{{ cat.name }}</div>
                </div>
                <div class="empty-hint">无匹配项目</div>
              </div>
            </template>
          </div>
          <div v-else-if="!auxItemsLoading" class="empty-hint">
            {{
              filters.aux_category_ids && filters.aux_category_ids.length > 0
                ? '该类别下暂无项目'
                : '请先选择辅助类别'
            }}
          </div>
        </div>

        <div class="filter-item">
          <label>日期范围</label>
          <div class="date-range">
            <el-date-picker
              v-model="filters.start_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="开始日期"
              style="width: 48%"
            />
            <span class="date-separator">至</span>
            <el-date-picker
              v-model="filters.end_date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="结束日期"
              style="width: 48%"
            />
          </div>
        </div>

        <div class="filter-item">
          <label>科目编码</label>
          <el-input v-model="filters.account_code" placeholder="科目编码" clearable />
        </div>

        <div v-if="isForeign" class="filter-item">
          <label>币种</label>
          <el-select
            v-model="filters.currency_code"
            clearable
            filterable
            placeholder="全部外币"
            style="width: 100%"
          >
            <el-option
              v-for="c in currencies"
              :key="c.code"
              :label="`${c.code} ${c.name}`"
              :value="c.code"
            />
          </el-select>
        </div>

        <div class="filter-item">
          <el-checkbox v-model="filters.include_unposted"> 统计未记账凭证 </el-checkbox>
        </div>
      </div>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="resetFilters">清空</el-button>
          <el-button type="primary" @click="handleQuery">查询</el-button>
        </div>
      </template>
    </el-drawer>

    <div
      v-loading="loading"
      ref="tableContainerRef"
      class="table-summary-scroll table-summary-scroll--wide table-summary-scroll--flow"
    >
      <el-table
        :key="auxTableColumnKey"
        ref="tableRef"
        :height="tableHeight"
        :data="list"
        :style="{ width: `${auxTableWidth}px` }"
        :fit="false"
        stripe
        border
        size="small"
        class="compact-data-table"
        highlight-current-row
        show-summary
        :summary-method="getSummaries"
        @header-dragend="onDragEnd"
        @row-dblclick="handleRowDblClick"
      >
        <!-- 科目编码列（宽表横向滚动，不使用 fixed 以免与滚动层/列宽拖拽冲突） -->
        <el-table-column
          column-key="account_code"
          prop="account_code"
          label="科目编码"
          :width="colWidth('account_code', 140)"
        >
          <template #default="{ row }">
            {{ row.account_code }}
          </template>
        </el-table-column>

        <!-- 科目名称列 -->
        <el-table-column
          column-key="account_name"
          prop="account_name"
          label="科目名称"
          :width="colWidth('account_name', 150)"
        >
          <template #default="{ row }">
            {{ row.account_name }}
          </template>
        </el-table-column>

        <!-- 动态辅助类别列：只在明细行显示 -->
        <template v-for="cat in activeCategoryColumns" :key="cat.code">
          <el-table-column
            :column-key="cat.code"
            :label="cat.name"
            :width="colWidth(cat.code, 140)"
          >
            <template #default="{ row }">
              <span v-if="row.category_code === cat.code">
                {{ row.aux_name }}
              </span>
            </template>
          </el-table-column>
        </template>

        <!-- 外币模式：币种 + 期末汇率 -->
        <el-table-column
          v-if="isForeign"
          column-key="currency_code"
          prop="currency_code"
          label="币种"
          :width="colWidth('currency_code', 70)"
          align="center"
        />
        <el-table-column
          v-if="isForeign"
          column-key="exchange_rate"
          label="汇率"
          :width="colWidth('exchange_rate', 90)"
          align="right"
        >
          <template #default="{ row }">{{ rateText(row.currency_code) }}</template>
        </el-table-column>

        <!-- 固定余额列（外币模式下每段追加「原币」列，本位币列改名） -->
        <el-table-column label="期初余额" align="center">
          <el-table-column
            column-key="init_direction"
            label="方向"
            :width="colWidth('init_direction', 60)"
            align="center"
          >
            <template #default="{ row }">
              {{
                formatInitBalanceDirection({
                  init_balance: row.init_balance,
                  direction: row.direction || row.account_direction || 'debit',
                })
              }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isForeign"
            column-key="foreign_init_balance"
            prop="foreign_init_balance"
            label="原币"
            :width="colWidth('foreign_init_balance', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatForeignAmount(Math.abs(row.foreign_init_balance || 0)) }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isQuantity"
            column-key="qty_init_balance"
            prop="qty_init_balance"
            label="数量"
            :width="colWidth('qty_init_balance', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatQuantityValue(row.qty_init_balance) }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="init_balance"
            prop="init_balance"
            :label="isForeign ? '本位币' : isQuantity ? '金额' : '余额'"
            :width="colWidth('init_balance', 130)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatAmount(Math.abs(row.init_balance)) }}
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="本期发生额" align="center">
          <el-table-column
            v-if="isForeign"
            column-key="foreign_current_debit"
            prop="foreign_current_debit"
            label="借方原币"
            :width="colWidth('foreign_current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatForeignAmount(row.foreign_current_debit) }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isQuantity"
            column-key="qty_current_debit"
            prop="qty_current_debit"
            label="借方数量"
            :width="colWidth('qty_current_debit', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatQuantityValue(row.qty_current_debit) }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="current_debit"
            prop="current_debit"
            :label="isForeign ? '借方本位币' : isQuantity ? '借方金额' : '借方'"
            :width="colWidth('current_debit', 130)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatAmount(row.current_debit) }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isForeign"
            column-key="foreign_current_credit"
            prop="foreign_current_credit"
            label="贷方原币"
            :width="colWidth('foreign_current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatForeignAmount(row.foreign_current_credit) }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isQuantity"
            column-key="qty_current_credit"
            prop="qty_current_credit"
            label="贷方数量"
            :width="colWidth('qty_current_credit', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatQuantityValue(row.qty_current_credit) }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="current_credit"
            prop="current_credit"
            :label="isForeign ? '贷方本位币' : isQuantity ? '贷方金额' : '贷方'"
            :width="colWidth('current_credit', 130)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatAmount(row.current_credit) }}
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="期末余额" align="center">
          <el-table-column
            column-key="end_direction"
            label="方向"
            :width="colWidth('end_direction', 60)"
            align="center"
          >
            <template #default="{ row }">
              {{
                formatEndBalanceDirection({
                  end_balance: row.end_balance,
                  direction: row.direction || row.account_direction || 'debit',
                })
              }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isForeign"
            column-key="foreign_end_balance"
            prop="foreign_end_balance"
            label="原币"
            :width="colWidth('foreign_end_balance', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatForeignAmount(Math.abs(row.foreign_end_balance || 0)) }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="isQuantity"
            column-key="qty_end_balance"
            prop="qty_end_balance"
            label="数量"
            :width="colWidth('qty_end_balance', 120)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatQuantityValue(row.qty_end_balance) }}
            </template>
          </el-table-column>
          <el-table-column
            column-key="end_balance"
            prop="end_balance"
            :label="isForeign ? '本位币' : isQuantity ? '金额' : '余额'"
            :width="colWidth('end_balance', 130)"
            align="right"
          >
            <template #default="{ row }">
              {{ formatAmount(Math.abs(row.end_balance)) }}
            </template>
          </el-table-column>
        </el-table-column>
      </el-table>
    </div>

    <!-- 分页（须在 table-summary-scroll 外，否则 overflow:hidden 会裁切） -->
    <div v-if="hasQueried" class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100, 200, 500]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <ExportProgressOverlay
      :visible="exportProgress.visible"
      :title="exportProgress.title"
      :message="exportProgress.message"
      :percent="exportProgress.percentDisplay"
    />

    <HiprintDialog
      v-model="hiprintVisible"
      template-type="ledger"
      :template-key="
        isForeign
          ? 'ledger:aux-foreign-balance'
          : isQuantity
            ? 'ledger:aux-quantity-balance'
            : 'ledger:aux-balance'
      "
      :title="pageTitle"
      :get-print-html="buildPrintHtml"
      default-paper="A4"
      default-orientation="landscape"
      :use-templates="false"
    />
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { ref, shallowRef, computed, onMounted, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useDrillDownNavigate } from '@/composables/useDrillDownNavigate'
import { Filter, Search, Download, Printer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import type { TableColumnCtx } from 'element-plus'
import { formatAmount } from '@/utils/format'
import { useConfirm } from '@/composables/useConfirm'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import { filterAuxCategoriesForAccount } from '@/utils/accountCashFlow'
import { useAuxWideTable } from '@/composables/useColumnWidthMemory'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { exportStyledTableViaServer, type ExportColumnDef } from '@/utils/exportStyledExcel'
import {
  buildAuxBalanceExportSummaryValues,
  buildAuxForeignBalanceExportSummaryValues,
  buildAuxForeignBalanceSubtotalRows,
  type AuxForeignTotals,
} from '@/utils/ledgerExportBuilders'
import {
  formatSignedBalanceAmount,
  formatInitBalanceDirection,
  formatEndBalanceDirection,
} from '@/utils/exportLedgerHelpers'
import { yieldToMain } from '@/utils/asyncChunk'
import { fetchAuxItemsPage } from '@/composables/useAuxItemsPage'
import { useDebounce } from '@/composables/useDebounceThrottle'
import { useExportProgress } from '@/composables/useExportProgress'
import ExportProgressOverlay from '@/components/export/ExportProgressOverlay.vue'
import HiprintDialog from '@/components/print/HiprintDialog.vue'
import { buildTablePrintHtml } from '@/utils/printTemplateHiprint'
import { useUserStore } from '@/stores/user'
import { getCurrencies, type Currency } from '@/api/currency'
import { useRacedQuery } from '@/composables/useRacedQuery'

/**
 * foreign=true 时为「辅助项目外币余额表」：只统计外币核算科目，
 * 在同一张表上追加币种列与原币期初/发生/期末，本位币列保留。
 *
 * quantity=true 时为「辅助项目库存数量金额表」：只统计数量核算科目，
 * 在同一张表上追加数量期初/发生/结余列，金额列保留。两者互斥。
 */
const props = withDefaults(defineProps<{ foreign?: boolean; quantity?: boolean }>(), {
  foreign: false,
  quantity: false,
})
const isForeign = computed(() => !!props.foreign)
const isQuantity = computed(() => !props.foreign && !!props.quantity)
const pageTitle = computed(() =>
  isForeign.value
    ? '辅助项目外币余额表'
    : isQuantity.value
      ? '辅助项目库存数量金额表'
      : '辅助项目余额表'
)

/** 数量展示：6 位小数，0 留空（与库存数量金额表一致） */
function formatQuantityValue(value: number | null | undefined) {
  const n = Number(value) || 0
  return n ? Math.abs(n).toFixed(6) : ''
}

const exportProgress = useExportProgress(`正在导出${pageTitle.value}`)
const { accountSetName } = storeToRefs(useUserStore())
const hiprintVisible = ref(false)
const currencies = ref<Currency[]>([])

/** 原币金额展示：与本位币一致保留两位小数 */
function formatForeignAmount(value: number | null | undefined) {
  return formatAmount(Number(value) || 0)
}

/** 各币种期末汇率，来自后端 rates（与外币余额表、期末调汇同一条回退链） */
const foreignRates = ref<Record<string, number>>({})

function rateText(currencyCode: string | null | undefined): string {
  const rate = foreignRates.value[String(currencyCode || '').toUpperCase()]
  return rate ? Number(rate).toFixed(4) : ''
}

/** 大类别检索时最多渲染的匹配项数，避免一次性渲染海量复选框卡死 */
const AUX_FILTER_SEARCH_LIMIT = 200
/** 单类别加载到内存做客户端过滤的项目上限（超过则改用服务端检索） */
const AUX_FILTER_CLIENT_LOAD_LIMIT = 500

const { drillDown } = useDrillDownNavigate()
const {
  containerRef: tableContainerRef,
  tableHeight,
  relayoutAfterData,
} = useFillHeightTable({ flow: true })
const list = ref<any[]>([])
const allRows = shallowRef<any[]>([])
const total = ref(0)
const grandTotals = ref<{
  init_balance: number
  current_debit: number
  current_credit: number
  end_balance: number
  qty_init_balance?: number
  qty_current_debit?: number
  qty_current_credit?: number
  qty_end_balance?: number
} | null>(null)
/** 外币模式：按币种分列的原币合计（不同币种不能相加） */
const foreignTotals = ref<Record<string, AuxForeignTotals> | null>(null)
/** 表尾原币合计：结果只含一个币种时才可直接显示，多币种留空 */
const singleCurrencyForeignTotals = computed<AuxForeignTotals | null>(() => {
  const totals = foreignTotals.value
  if (!totals) return null
  const keys = Object.keys(totals)
  return keys.length === 1 ? totals[keys[0]] : null
})
const currentPage = ref(1)
const pageSize = ref(50)
const hasQueried = ref(false)
const clientSidePagination = ref(false)
const loadProgress = ref({ loaded: 0, total: 0 })
const summaryLoading = ref(false)
const LOAD_ALL_PAGE_SIZE = 1000
// FIX-157：请求序号防竞态，loading 由 raced 统一维护
const raced = useRacedQuery()
const loading = raced.loading

const loadProgressPercent = computed(() => {
  const { loaded, total: t } = loadProgress.value
  if (!t) return 0
  return Math.min(100, Math.round((loaded / t) * 100))
})

const loadingAll = ref(false)
const auxCategories = ref<any[]>([])
const drawerVisible = ref(false)
const itemCheckMap = ref<Record<string, boolean>>({})
const auxItemsMap = ref<Record<string, any[]>>({})
const categoryFields = ref<
  Record<string, { name: string; fields: { field_key: string; field_name: string }[] }>
>({})
const auxItemSearchKeyword = ref('')
const auxItemsLoading = ref(false)
/** 每个类别的项目总数（用于判断是否走服务端检索） */
const auxItemTotals = ref<Record<string, number>>({})
/** 大类别服务端检索结果（按关键词） */
const auxItemSearchResults = ref<Record<string, any[]>>({})
/** 检索结果是否被截断（命中数超过渲染上限） */
const auxItemSearchTruncated = ref<Record<string, boolean>>({})
/** 服务端检索中标志 */
const auxItemSearching = ref(false)
/** 防抖后的检索关键词：客户端过滤与服务端检索都基于它 */
const debouncedAuxKeyword = useDebounce(auxItemSearchKeyword, 300)

const year = new Date().getFullYear()

const filters = ref<any>({
  aux_category_ids: [],
  aux_ids: [],
  start_date: `${year}-01-01`,
  end_date: `${year}-12-31`,
  account_code: '',
  currency_code: '',
  include_unposted: true,
})

// 筛选摘要（打印副标题等复用）
const filterSummaryText = computed(() => buildAuxBalanceFilterParts().join('；'))

const filterHintText = computed(() => {
  if (!filters.value.aux_category_ids?.length) {
    return '未设置筛选条件，请点击右侧「筛选」'
  }
  return filterSummaryText.value
})

function buildAuxBalanceFilterParts(): string[] {
  const parts: string[] = []
  const catIds = filters.value.aux_category_ids as string[] | undefined
  if (catIds?.length) {
    const catNames = catIds
      .map(id => auxCategories.value.find(c => c.id === id)?.name)
      .filter(Boolean) as string[]
    if (catNames.length) {
      const label =
        catNames.length <= 3
          ? catNames.join('、')
          : `${catNames.slice(0, 3).join('、')} 等 ${catNames.length} 类`
      parts.push(`类别：${label}`)
    }
  }
  const auxIds = filters.value.aux_ids as string[] | undefined
  if (auxIds?.length) {
    parts.push(`项目：已选 ${auxIds.length} 个`)
  } else if (catIds?.length) {
    parts.push('项目：未选择')
  }
  if (filters.value.start_date || filters.value.end_date) {
    parts.push(`日期：${filters.value.start_date || '…'} 至 ${filters.value.end_date || '…'}`)
  }
  if (filters.value.account_code) {
    parts.push(`科目：${filters.value.account_code}`)
  }
  if (isForeign.value) {
    parts.push(`币种：${filters.value.currency_code || '全部外币'}`)
  }
  parts.push(filters.value.include_unposted ? '含未记账凭证' : '仅已记账凭证')
  return parts
}

// 根据搜索关键词过滤的项目列表
// 小类别（≤ AUX_FILTER_CLIENT_LOAD_LIMIT）：内存客户端过滤；
// 大类别（> 上限）：未输入关键词时提示「请检索」，输入后用服务端检索结果（已截断到 AUX_FILTER_SEARCH_LIMIT）。
const filteredCategoryItems = computed(() => {
  const keyword = debouncedAuxKeyword.value.trim().toLowerCase()
  const catIds: string[] = filters.value.aux_category_ids || []
  return catIds.map((catId: string) => {
    const cat = auxCategories.value.find(c => c.id === catId)
    const name = cat ? cat.name : catId
    const totalCount = auxItemTotals.value[catId] ?? (auxItemsMap.value[catId]?.length || 0)
    const isLarge = totalCount > AUX_FILTER_CLIENT_LOAD_LIMIT

    if (isLarge) {
      if (!keyword) {
        return { id: catId, name, items: [], totalCount, needsSearch: true, truncated: false }
      }
      const items = auxItemSearchResults.value[catId] || []
      return {
        id: catId,
        name,
        items,
        totalCount,
        needsSearch: false,
        truncated: !!auxItemSearchTruncated.value[catId],
      }
    }

    const loaded = auxItemsMap.value[catId] || []
    const items = keyword
      ? loaded.filter((item: any) => {
          const code = (item.code || '').toLowerCase()
          const itemName = (item.name || '').toLowerCase()
          return code.includes(keyword) || itemName.includes(keyword)
        })
      : loaded
    return { id: catId, name, items, totalCount, needsSearch: false, truncated: false }
  })
})

// 当前查询结果中实际出现的类别，按选择顺序排列，用于动态列
const activeCategoryColumns = computed(() => {
  // 按用户选择的类别顺序排列
  const selectedCatIds = filters.value.aux_category_ids as string[]
  const result: { code: string; name: string }[] = []
  for (const catId of selectedCatIds) {
    const cat = auxCategories.value.find(c => c.id === catId)
    if (!cat) continue
    result.push({
      code: cat.code,
      name: cat.name,
    })
  }
  return result
})

/** 动态辅助列变化时重建表格，替代反复 doLayout */
const auxTableColumnKey = computed(
  () => activeCategoryColumns.value.map(c => c.code).join('|') || 'none'
)

/** 列宽合计（fit=false 不含 gutter，外框与最后一列对齐） */
const auxColumnDefs = computed(() => {
  const defs: Array<{ key: string; fallback: number }> = [
    { key: 'account_code', fallback: 140 },
    { key: 'account_name', fallback: 150 },
  ]
  for (const cat of activeCategoryColumns.value) {
    defs.push({ key: cat.code, fallback: 140 })
  }
  if (isForeign.value) {
    defs.push(
      { key: 'currency_code', fallback: 70 },
      { key: 'exchange_rate', fallback: 90 },
      { key: 'init_direction', fallback: 60 },
      { key: 'foreign_init_balance', fallback: 120 },
      { key: 'init_balance', fallback: 130 },
      { key: 'foreign_current_debit', fallback: 120 },
      { key: 'current_debit', fallback: 130 },
      { key: 'foreign_current_credit', fallback: 120 },
      { key: 'current_credit', fallback: 130 },
      { key: 'end_direction', fallback: 60 },
      { key: 'foreign_end_balance', fallback: 120 },
      { key: 'end_balance', fallback: 130 }
    )
    return defs
  }
  if (isQuantity.value) {
    defs.push(
      { key: 'init_direction', fallback: 60 },
      { key: 'qty_init_balance', fallback: 120 },
      { key: 'init_balance', fallback: 130 },
      { key: 'qty_current_debit', fallback: 120 },
      { key: 'current_debit', fallback: 130 },
      { key: 'qty_current_credit', fallback: 120 },
      { key: 'current_credit', fallback: 130 },
      { key: 'end_direction', fallback: 60 },
      { key: 'qty_end_balance', fallback: 120 },
      { key: 'end_balance', fallback: 130 }
    )
    return defs
  }
  defs.push(
    { key: 'init_direction', fallback: 60 },
    { key: 'init_balance', fallback: 130 },
    { key: 'current_debit', fallback: 130 },
    { key: 'current_credit', fallback: 130 },
    { key: 'end_direction', fallback: 60 },
    { key: 'end_balance', fallback: 130 }
  )
  return defs
})

const {
  tableRef,
  colWidth,
  tableWidth: auxTableWidth,
  onDragEnd,
  afterTableLayout,
} = useAuxWideTable(
  isForeign.value
    ? 'ledger_aux_foreign_balance'
    : isQuantity.value
      ? 'ledger_aux_quantity_balance'
      : 'ledger_aux_balance',
  auxColumnDefs,
  {
    columnKey: auxTableColumnKey,
    afterLayout: relayoutAfterData,
  }
)

function getSummaries(param: { columns: TableColumnCtx<any>[]; data: any[] }) {
  const { columns } = param
  const totals = grandTotals.value
  if (!totals) {
    return columns.map((_, index) => (index === 0 ? '合计' : ''))
  }
  const fx = singleCurrencyForeignTotals.value

  return columns.map((col, index) => {
    if (index === 0) return '合计'
    const key = String(col.columnKey ?? col.property ?? '')
    if (key === 'init_direction') {
      return totals.init_balance === 0 ? '' : totals.init_balance > 0 ? '借' : '贷'
    }
    if (key === 'init_balance') {
      return formatAmount(Math.abs(totals.init_balance))
    }
    if (key === 'current_debit') {
      return formatAmount(totals.current_debit || 0)
    }
    if (key === 'current_credit') {
      return formatAmount(totals.current_credit || 0)
    }
    if (key === 'end_direction') {
      return totals.end_balance === 0 ? '' : totals.end_balance > 0 ? '借' : '贷'
    }
    if (key === 'end_balance') {
      return formatAmount(Math.abs(totals.end_balance))
    }
    if (key === 'currency_code') {
      return fx ? Object.keys(foreignTotals.value || {})[0] || '' : foreignTotals.value ? '多币种' : ''
    }
    if (key === 'foreign_init_balance') {
      return fx ? formatForeignAmount(Math.abs(fx.foreign_init_balance)) : ''
    }
    if (key === 'foreign_current_debit') {
      return fx ? formatForeignAmount(fx.foreign_current_debit) : ''
    }
    if (key === 'foreign_current_credit') {
      return fx ? formatForeignAmount(fx.foreign_current_credit) : ''
    }
    if (key === 'foreign_end_balance') {
      return fx ? formatForeignAmount(Math.abs(fx.foreign_end_balance)) : ''
    }
    // 数量合计：不同科目的计量单位可能不同，仍按后端返回的总量展示，供核对用
    if (key === 'qty_init_balance') {
      return formatQuantityValue(totals.qty_init_balance)
    }
    if (key === 'qty_current_debit') {
      return formatQuantityValue(totals.qty_current_debit)
    }
    if (key === 'qty_current_credit') {
      return formatQuantityValue(totals.qty_current_credit)
    }
    if (key === 'qty_end_balance') {
      return formatQuantityValue(totals.qty_end_balance)
    }
    return ''
  })
}

watch(grandTotals, () => {
  nextTick(() => {
    tableRef.value?.doLayout?.()
  })
})

async function fetchAuxCategories() {
  try {
    const res = await request.get<any[]>('/base/aux-categories')
    // 现金流量项目本质是凭证级标签而非辅助核算项目，不应出现在辅助账簿筛选项中
    auxCategories.value = filterAuxCategoriesForAccount(res.data || [])
  } catch (error) {
    console.error('加载辅助类别失败:', error)
  }
}

async function fetchAuxItems() {
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    auxItemsMap.value = {}
    auxItemTotals.value = {}
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
    return
  }
  auxItemsLoading.value = true
  try {
    const map: Record<string, any[]> = {}
    const totals: Record<string, number> = {}
    for (const categoryId of filters.value.aux_category_ids) {
      // 只取首页（最多 AUX_FILTER_CLIENT_LOAD_LIMIT 条）+ 总数。
      // 小类别一次性载入做客户端过滤；大类别仅凭总数提示「请检索」，输入关键词后走服务端检索。
      const { items, total } = await fetchAuxItemsPage({
        category_id: categoryId,
        status: 'active',
        page: 1,
        pageSize: AUX_FILTER_CLIENT_LOAD_LIMIT,
      })
      totals[categoryId] = total
      map[categoryId] = total > AUX_FILTER_CLIENT_LOAD_LIMIT ? [] : items
      await yieldToMain()
    }
    auxItemsMap.value = map
    auxItemTotals.value = totals
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
  } catch (error) {
    console.error('加载辅助项目失败:', error)
    ElMessage.error('加载辅助项目失败')
  } finally {
    auxItemsLoading.value = false
  }
}

/** 大类别：按关键词到服务端检索匹配项目（防抖触发，结果有上限） */
async function searchLargeCategoryItems(keyword: string) {
  const catIds: string[] = filters.value.aux_category_ids || []
  const largeCatIds = catIds.filter(
    id => (auxItemTotals.value[id] ?? 0) > AUX_FILTER_CLIENT_LOAD_LIMIT
  )
  if (!keyword || largeCatIds.length === 0) {
    auxItemSearchResults.value = {}
    auxItemSearchTruncated.value = {}
    return
  }
  auxItemSearching.value = true
  try {
    const results: Record<string, any[]> = {}
    const truncated: Record<string, boolean> = {}
    for (const categoryId of largeCatIds) {
      const { items, total } = await fetchAuxItemsPage({
        category_id: categoryId,
        keyword,
        status: 'active',
        page: 1,
        pageSize: AUX_FILTER_SEARCH_LIMIT,
      })
      results[categoryId] = items
      truncated[categoryId] = total > items.length
      await yieldToMain()
    }
    auxItemSearchResults.value = results
    auxItemSearchTruncated.value = truncated
  } catch (error) {
    console.error('检索辅助项目失败:', error)
  } finally {
    auxItemSearching.value = false
  }
}

watch(debouncedAuxKeyword, kw => {
  void searchLargeCategoryItems(String(kw || '').trim())
})

function buildQueryParams(extra: Record<string, unknown> = {}) {
  const params: Record<string, unknown> = {
    aux_category_ids: filters.value.aux_category_ids.join(','),
    ...extra,
  }
  if (filters.value.aux_ids && filters.value.aux_ids.length > 0) {
    params.aux_ids = filters.value.aux_ids.join(',')
  }
  if (filters.value.start_date) params.start_date = filters.value.start_date
  if (filters.value.end_date) params.end_date = filters.value.end_date
  if (filters.value.account_code) params.account_code = filters.value.account_code
  if (filters.value.include_unposted) params.include_unposted = true
  if (isForeign.value) {
    params.with_foreign = true
    if (filters.value.currency_code) params.currency_code = filters.value.currency_code
  }
  if (isQuantity.value) {
    params.with_quantity = true
  }
  return params
}

function updateClientPageSlice() {
  const start = (currentPage.value - 1) * pageSize.value
  list.value = allRows.value.slice(start, start + pageSize.value)
  total.value = allRows.value.length
}

async function fetchDataServerPage() {
  clientSidePagination.value = false
  allRows.value = []
  try {
    const params = buildQueryParams({
      page: currentPage.value,
      pageSize: pageSize.value,
    })
    const res: any = await raced.run(() => request.post<any>('/ledger/aux-balance', params))
    if (!res) return
    list.value = res.data || []
    total.value = res.total ?? 0
    grandTotals.value = res.totals || null
    foreignTotals.value = res.foreign_totals || null
    foreignRates.value = res.rates || {}
    hasQueried.value = true
    if (res.categoryFields) {
      categoryFields.value = res.categoryFields
    }
    await afterTableLayout()
  } catch (error: any) {
    console.error('查询辅助项目余额表失败:', error)
    const msg = error?.response?.data?.error || error?.message || '查询失败'
    ElMessage.error(msg)
  }
}

async function fetchData() {
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) return

  const MAX_AUX_ITEMS = 500000
  if (filters.value.aux_ids && filters.value.aux_ids.length > MAX_AUX_ITEMS) {
    ElMessage.warning(`最多只能选择 ${MAX_AUX_ITEMS} 个辅助项目，请缩小筛选范围`)
    return
  }

  // 无论项目数量多少都只请求当前页；服务端使用 SQLite 临时结果表聚合并分页。
  // 评审 P2：旧的前端分批加载函数从未被调用，已删除。
  await fetchDataServerPage()
}

async function exportData() {
  if (!hasQueried.value) {
    ElMessage.warning('请先查询后再导出')
    return
  }

  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) {
    ElMessage.warning('请先选择辅助类别')
    return
  }

  const EXPORT_WARNING_THRESHOLD = 5000

  if (total.value > EXPORT_WARNING_THRESHOLD) {
    const confirmed = await useConfirm({
      title: '数据量较大',
      message: `当前共 ${total.value.toLocaleString()} 条明细，将由服务端生成 Excel，可能需要较长时间，是否继续？`,
      confirmButtonText: '继续导出',
      cancelButtonText: '取消',
    })
    if (!confirmed) return
  }

  exportProgress.start()

  let exportRows = clientSidePagination.value && allRows.value.length > 0 ? allRows.value : []
  let exportTotals = grandTotals.value
  let exportForeignTotals = foreignTotals.value

  try {
    if (exportRows.length === 0) {
      const collected: any[] = []
      let page = 1
      let serverTotal = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res: any = await request.post<any>(
          '/ledger/aux-balance',
          buildQueryParams({ page, pageSize: LOAD_ALL_PAGE_SIZE, skip_summary: page > 1 })
        )
        const batch = res.data || []
        collected.push(...batch)
        if (page === 1) {
          serverTotal = (res as any).total ?? batch.length
          exportTotals = (res as any).totals as typeof grandTotals.value
          exportForeignTotals = ((res as any).foreign_totals || null) as typeof foreignTotals.value
        }
        exportProgress.setFetchProgress(collected.length, serverTotal)
        if (batch.length === 0 || collected.length >= serverTotal) break
        page++
        await yieldToMain()
      }
      exportRows = collected
    } else {
      exportProgress.setFetchProgress(exportRows.length, exportRows.length, '明细已加载，准备导出…')
    }

    if (exportRows.length === 0) {
      ElMessage.warning('没有可导出的数据')
      return
    }

    const columns: ExportColumnDef<any>[] = [
      {
        label: '科目编码',
        width: colWidth('account_code', 140),
        value: row => row.account_code,
      },
      {
        label: '科目名称',
        width: colWidth('account_name', 150),
        value: row => row.account_name,
      },
    ]

    for (const cat of activeCategoryColumns.value) {
      columns.push({
        label: cat.name,
        width: colWidth(cat.code, 140),
        value: row => (row.category_code === cat.code ? row.aux_name || row.aux_code || '' : ''),
      })
    }

    const foreign = isForeign.value
    if (foreign) {
      columns.push({
        label: '币种',
        width: colWidth('currency_code', 70),
        align: 'center',
        value: row => row.currency_code || '',
      })
      columns.push({
        label: '汇率',
        width: colWidth('exchange_rate', 90),
        align: 'right',
        value: row => rateText(row.currency_code),
      })
    }

    const initChildren: ExportColumnDef<any>[] = [
      {
        label: '方向',
        width: colWidth('init_direction', 60),
        align: 'center',
        value: row =>
          formatInitBalanceDirection({
            init_balance: row.init_balance,
            direction: row.direction || row.account_direction || 'debit',
          }),
      },
    ]
    if (foreign) {
      initChildren.push({
        label: '原币',
        width: colWidth('foreign_init_balance', 120),
        align: 'right',
        type: 'amount',
        value: row => formatSignedBalanceAmount(row.foreign_init_balance || 0, false),
      })
    }
    initChildren.push({
      label: foreign ? '本位币' : '余额',
      width: colWidth('init_balance', 130),
      align: 'right',
      type: 'amount',
      value: row => formatSignedBalanceAmount(row.init_balance, false),
    })

    const currentChildren: ExportColumnDef<any>[] = []
    if (foreign) {
      currentChildren.push({
        label: '借方原币',
        width: colWidth('foreign_current_debit', 120),
        align: 'right',
        type: 'amount',
        value: row => row.foreign_current_debit || 0,
      })
    }
    currentChildren.push({
      label: foreign ? '借方本位币' : '借方',
      width: colWidth('current_debit', 130),
      align: 'right',
      type: 'amount',
      value: row => row.current_debit || 0,
    })
    if (foreign) {
      currentChildren.push({
        label: '贷方原币',
        width: colWidth('foreign_current_credit', 120),
        align: 'right',
        type: 'amount',
        value: row => row.foreign_current_credit || 0,
      })
    }
    currentChildren.push({
      label: foreign ? '贷方本位币' : '贷方',
      width: colWidth('current_credit', 130),
      align: 'right',
      type: 'amount',
      value: row => row.current_credit || 0,
    })

    const endChildren: ExportColumnDef<any>[] = [
      {
        label: '方向',
        width: colWidth('end_direction', 60),
        align: 'center',
        value: row =>
          formatEndBalanceDirection({
            end_balance: row.end_balance,
            direction: row.direction || row.account_direction || 'debit',
          }),
      },
    ]
    if (foreign) {
      endChildren.push({
        label: '原币',
        width: colWidth('foreign_end_balance', 120),
        align: 'right',
        type: 'amount',
        value: row => formatSignedBalanceAmount(row.foreign_end_balance || 0, false),
      })
    }
    endChildren.push({
      label: foreign ? '本位币' : '余额',
      width: colWidth('end_balance', 130),
      align: 'right',
      type: 'amount',
      value: row => formatSignedBalanceAmount(row.end_balance, false),
    })

    columns.push(
      { label: '期初余额', children: initChildren },
      { label: '本期发生额', children: currentChildren },
      { label: '期末余额', children: endChildren }
    )

    const summaryValues = foreign
      ? buildAuxForeignBalanceExportSummaryValues(
          activeCategoryColumns.value.length,
          exportTotals,
          exportForeignTotals
        )
      : buildAuxBalanceExportSummaryValues(activeCategoryColumns.value.length, exportTotals)
    // 多币种时原币不能相加，合计行只给本位币，原币按币种各出一行小计
    const subtotalRows = foreign
      ? buildAuxForeignBalanceSubtotalRows(
          activeCategoryColumns.value.length,
          exportForeignTotals,
          foreignRates.value
        )
      : []

    const dateRange =
      filters.value.start_date && filters.value.end_date
        ? `${filters.value.start_date}_${filters.value.end_date}`
        : todayStr()

    await exportStyledTableViaServer({
      fileName: `${pageTitle.value}_${dateRange}.xlsx`,
      sheetName: pageTitle.value,
      title: pageTitle.value,
      subtitle: filterSummaryText.value,
      columns,
      rows: exportRows,
      subtotalRows,
      summaryValues,
      onProgress: info => exportProgress.report(info),
    })

    ElMessage.success('导出完成，文件已开始下载')
  } catch (error: any) {
    console.error(`导出${pageTitle.value}失败:`, error)
    ElMessage.error(error?.response?.data?.error || error?.message || '导出失败')
  } finally {
    exportProgress.finish()
  }
}

// ===================== 打印（HiprintDialog 预览）=====================
/** 打印数据源：客户端分页取全量 allRows，否则取当前已加载 list */
const printRows = computed(() =>
  clientSidePagination.value && allRows.value.length > 0 ? allRows.value : list.value
)

function printPage() {
  if (!hasQueried.value) {
    ElMessage.warning('请先查询后再打印')
    return
  }
  if (printRows.value.length === 0) {
    ElMessage.warning('没有可打印的数据')
    return
  }
  hiprintVisible.value = true
}

function buildPrintHtml(): string {
  const cats = activeCategoryColumns.value
  type PrintCol = { label: string; align: 'left' | 'center' | 'right'; render: (r: any) => string }
  const columns: PrintCol[] = [
    { label: '科目编码', align: 'left', render: r => r.account_code || '' },
    { label: '科目名称', align: 'left', render: r => r.account_name || '' },
  ]
  for (const cat of cats) {
    columns.push({
      label: cat.name,
      align: 'left',
      render: r => (r.category_code === cat.code ? r.aux_name || r.aux_code || '' : ''),
    })
  }
  const foreign = isForeign.value
  if (foreign) {
    columns.push({ label: '币种', align: 'center', render: r => r.currency_code || '' })
    columns.push({ label: '汇率', align: 'right', render: r => rateText(r.currency_code) })
  }

  const fxAmount = (v: number | undefined, abs = false) => {
    const n = Number(v) || 0
    return n ? formatForeignAmount(abs ? Math.abs(n) : n) : ''
  }

  // 每段的二级表头标签；外币模式下多出「原币」列并把本位币列改名
  const initSubLabels: string[] = ['方向']
  const currentSubLabels: string[] = []
  const endSubLabels: string[] = ['方向']

  columns.push({
    label: '期初方向',
    align: 'center',
    render: r =>
      formatInitBalanceDirection({
        init_balance: r.init_balance,
        direction: r.direction || r.account_direction || 'debit',
      }),
  })
  if (foreign) {
    initSubLabels.push('原币')
    columns.push({
      label: '期初原币',
      align: 'right',
      render: r => fxAmount(r.foreign_init_balance, true),
    })
  }
  initSubLabels.push(foreign ? '本位币' : '余额')
  columns.push({
    label: '期初余额',
    align: 'right',
    render: r => (r.init_balance ? formatAmount(Math.abs(r.init_balance)) : ''),
  })

  if (foreign) {
    currentSubLabels.push('借方原币')
    columns.push({
      label: '本期借方原币',
      align: 'right',
      render: r => fxAmount(r.foreign_current_debit),
    })
  }
  currentSubLabels.push(foreign ? '借方本位币' : '借方')
  columns.push({
    label: '本期借方',
    align: 'right',
    render: r => (r.current_debit ? formatAmount(r.current_debit) : ''),
  })
  if (foreign) {
    currentSubLabels.push('贷方原币')
    columns.push({
      label: '本期贷方原币',
      align: 'right',
      render: r => fxAmount(r.foreign_current_credit),
    })
  }
  currentSubLabels.push(foreign ? '贷方本位币' : '贷方')
  columns.push({
    label: '本期贷方',
    align: 'right',
    render: r => (r.current_credit ? formatAmount(r.current_credit) : ''),
  })

  columns.push({
    label: '期末方向',
    align: 'center',
    render: r =>
      formatEndBalanceDirection({
        end_balance: r.end_balance,
        direction: r.direction || r.account_direction || 'debit',
      }),
  })
  if (foreign) {
    endSubLabels.push('原币')
    columns.push({
      label: '期末原币',
      align: 'right',
      render: r => fxAmount(r.foreign_end_balance, true),
    })
  }
  endSubLabels.push(foreign ? '本位币' : '余额')
  columns.push({
    label: '期末余额',
    align: 'right',
    render: r => (r.end_balance ? formatAmount(Math.abs(r.end_balance)) : ''),
  })

  // 两级表头：科目 rowspan2 + 各辅助列 rowspan2（+ 币种）+ 期初/本期/期末 colspan
  const headerRow1: { label: string; rowspan?: number; colspan?: number }[] = [
    { label: '科目编码', rowspan: 2 },
    { label: '科目名称', rowspan: 2 },
  ]
  for (const cat of cats) headerRow1.push({ label: cat.name, rowspan: 2 })
  if (foreign) {
    headerRow1.push({ label: '币种', rowspan: 2 }, { label: '汇率', rowspan: 2 })
  }
  headerRow1.push(
    { label: '期初余额', colspan: initSubLabels.length },
    { label: '本期发生额', colspan: currentSubLabels.length },
    { label: '期末余额', colspan: endSubLabels.length }
  )
  const headerRow2: { label: string }[] = [
    ...initSubLabels,
    ...currentSubLabels,
    ...endSubLabels,
  ].map(label => ({ label }))

  const totals = grandTotals.value
  const fx = singleCurrencyForeignTotals.value
  const initNet = totals ? totals.init_balance : 0
  const endNet = totals ? totals.end_balance : 0
  const footer: string[] = ['合计', '', ...cats.map(() => '')]
  if (foreign) {
    footer.push(fx ? Object.keys(foreignTotals.value || {})[0] || '' : foreignTotals.value ? '多币种' : '')
    footer.push(fx ? rateText(Object.keys(foreignTotals.value || {})[0]) : '')
  }
  footer.push(initNet > 0 ? '借' : initNet < 0 ? '贷' : '')
  if (foreign) footer.push(fx ? fxAmount(fx.foreign_init_balance, true) : '')
  footer.push(initNet ? formatAmount(Math.abs(initNet)) : '')
  if (foreign) footer.push(fx ? fxAmount(fx.foreign_current_debit) : '')
  footer.push(totals ? formatAmount(totals.current_debit || 0) : '')
  if (foreign) footer.push(fx ? fxAmount(fx.foreign_current_credit) : '')
  footer.push(totals ? formatAmount(totals.current_credit || 0) : '')
  footer.push(endNet > 0 ? '借' : endNet < 0 ? '贷' : '')
  if (foreign) footer.push(fx ? fxAmount(fx.foreign_end_balance, true) : '')
  footer.push(endNet ? formatAmount(Math.abs(endNet)) : '')

  const footerSubtotals = foreign
    ? buildAuxForeignBalanceSubtotalRows(
        cats.length,
        foreignTotals.value,
        foreignRates.value
      ).map(row => row.map(v => String(v ?? '')))
    : []

  return buildTablePrintHtml<any>({
    title: pageTitle.value,
    subtitle: `账套：${accountSetName.value || '未命名账套'}　${filterSummaryText.value}`,
    rows: printRows.value,
    monochrome: true,
    fitToPage: true,
    headerRows: [headerRow1, headerRow2],
    columns,
    footer,
    footerSubtotals,
  })
}

function resolveCategoryId(categoryCode: string) {
  const cat = auxCategories.value.find((c: any) => c.code === categoryCode)
  return cat?.id || categoryCode
}

function handleRowDblClick(row: any) {
  const query: Record<string, string> = {
    aux_category_ids: resolveCategoryId(row.category_code),
    aux_ids: row.aux_id,
    account_code: row.account_code,
  }
  if (filters.value.start_date) query.start_date = filters.value.start_date
  if (filters.value.end_date) query.end_date = filters.value.end_date
  drillDown('/ledger/aux-detail', query, pageTitle.value)
}

/** 每页条数切换 */
function handleSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  if (clientSidePagination.value) {
    updateClientPageSlice()
  } else {
    fetchData()
  }
}

/** 页码切换 */
function handlePageChange(page: number) {
  currentPage.value = page
  if (clientSidePagination.value) {
    updateClientPageSlice()
  } else {
    fetchData()
  }
}

// 查询按钮点击
function handleQuery() {
  syncFiltersFromCheckMap()
  drawerVisible.value = false
  currentPage.value = 1
  fetchData()
}

/** 选中全部辅助类别，查询类别下所有项目（不传 aux_ids） */
async function handleLoadAll() {
  loadingAll.value = true
  try {
    if (auxCategories.value.length === 0) {
      await fetchAuxCategories()
    }
    if (auxCategories.value.length === 0) {
      ElMessage.warning('暂无辅助类别')
      return
    }
    filters.value.aux_category_ids = auxCategories.value.map((c: any) => c.id)
    auxItemsMap.value = {}
    await fetchAuxItems()
    filters.value.aux_ids = []
    itemCheckMap.value = {}
    currentPage.value = 1
    pageSize.value = 50
    await fetchData()
    ElMessage.success(
      clientSidePagination.value
        ? `已加载 ${total.value.toLocaleString()} 条明细，请使用下方分页浏览`
        : `已选中全部辅助类别，共 ${total.value} 条明细`
    )
  } catch (error: any) {
    console.error('全部加载失败:', error)
    ElMessage.error(error?.message || '全部加载失败')
  } finally {
    loadingAll.value = false
  }
}

// 重置筛选条件并查询全部
function resetFilters() {
  filters.value = {
    aux_category_ids: [],
    aux_ids: [],
    start_date: '',
    end_date: '',
    account_code: '',
    currency_code: '',
    include_unposted: true,
  }
  itemCheckMap.value = {}
  currentPage.value = 1
  drawerVisible.value = false
  handleQuery()
}

/** 全选/反选/清空：仅作用于当前列表可见项（大类别即检索命中的项），避免一次性勾选海量项目 */
function getCategoryItemsForBulkAction(categoryId: string) {
  const cat = filteredCategoryItems.value.find((c: { id: string }) => c.id === categoryId)
  return cat?.items || []
}

// 全选某个类别的项目
function selectCategoryItems(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach((item: { id: string }) => {
    itemCheckMap.value[item.id] = true
  })
  syncFiltersFromCheckMap()
}

// 反选某个类别的项目
function invertCategorySelection(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach((item: { id: string }) => {
    itemCheckMap.value[item.id] = !itemCheckMap.value[item.id]
  })
  syncFiltersFromCheckMap()
}

// 清空某个类别的选择
function clearCategorySelection(categoryId: string) {
  getCategoryItemsForBulkAction(categoryId).forEach((item: { id: string }) => {
    itemCheckMap.value[item.id] = false
  })
  syncFiltersFromCheckMap()
}

// 单个项目勾选变化
function onItemCheckChange() {
  syncFiltersFromCheckMap()
}

// 从 checkMap 同步到 filters.aux_ids
function syncFiltersFromCheckMap() {
  filters.value.aux_ids = Object.keys(itemCheckMap.value).filter(id => itemCheckMap.value[id])
}

async function onAuxCategoryChange() {
  filters.value.aux_ids = []
  itemCheckMap.value = {}
  auxItemSearchKeyword.value = ''
  list.value = []
  allRows.value = []
  total.value = 0
  grandTotals.value = null
  foreignTotals.value = null
  foreignRates.value = {}
  currentPage.value = 1
  hasQueried.value = false
  clientSidePagination.value = false
  loadProgress.value = { loaded: 0, total: 0 }
  categoryFields.value = {}
  if (!filters.value.aux_category_ids || filters.value.aux_category_ids.length === 0) return
  await fetchAuxItems()
}

async function fetchCurrencies() {
  try {
    const res = await getCurrencies()
    currencies.value = (res.data || []).filter((c: Currency) => !c.is_base)
  } catch (error) {
    console.error('加载币种失败:', error)
    currencies.value = []
  }
}

onMounted(async () => {
  await fetchAuxCategories()
  if (isForeign.value) {
    await fetchCurrencies()
  }
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
  margin-bottom: var(--block-gap);
  padding: var(--filter-row-pad);
  background-color: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.header-left h3 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
  font-weight: 600;
}

.filter-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 6px 12px;
  background-color: #f5f7fa;
  border-radius: 4px;
  font-size: var(--cw-text-base);
  line-height: 1.5;
  color: #606266;
}

.filter-hint-label {
  flex-shrink: 0;
  color: #303133;
  font-weight: 500;
}

.filter-hint-text {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.header-right {
  display: flex;
  gap: 8px;
}

/* 抽屉内容样式 */
.drawer-content {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-item label {
  font-size: var(--cw-text-base);
  font-weight: 500;
  color: #303133;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-separator {
  color: #909399;
  font-size: var(--cw-text-base);
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #e4e7ed;
}

.filter-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.batch-actions {
  display: flex;
  gap: 4px;
}

.checkbox-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.category-label {
  font-size: var(--cw-text-base);
  font-weight: 600;
  color: #606266;
}

.category-actions {
  display: flex;
  gap: 4px;
}

.empty-hint {
  padding: 12px;
  text-align: center;
  color: #909399;
  font-size: var(--cw-text-base);
  background-color: #f5f7fa;
  border-radius: 4px;
}

.load-progress-bar {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 6px;
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
</style>
