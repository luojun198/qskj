<template>
  <div class="cashier-report-filter">
    <AccountScopeAlert />

    <!-- 账户级条件：所有出纳报表共用 -->
    <div class="filter-line">
      <el-date-picker v-model="range[0]" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" class="filter-ctl--md" @change="emitRange" />
      <span>至</span>
      <el-date-picker v-model="range[1]" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" class="filter-ctl--md" @change="emitRange" />
      <el-dropdown trigger="click" @command="onQuickRange">
        <el-button plain size="default">快捷日期<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="month">本月</el-dropdown-item>
            <el-dropdown-item command="lastMonth">上月</el-dropdown-item>
            <el-dropdown-item command="quarter">本季</el-dropdown-item>
            <el-dropdown-item command="year">本年</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-select
        :model-value="modelValue.accountCodes"
        multiple collapse-tags collapse-tags-tooltip clearable filterable
        placeholder="科目（可多选，不选=全部）"
        class="filter-ctl--lg"
        @update:model-value="(v: string[]) => patch({ accountCodes: v })"
      >
        <el-option-group v-if="cashAccounts.length" label="现金">
          <el-option v-for="a in cashAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
        <el-option-group v-if="bankAccounts.length" label="银行存款">
          <el-option v-for="a in bankAccounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-option-group>
      </el-select>
      <el-select
        :model-value="modelValue.accountType"
        class="filter-ctl--xs"
        @update:model-value="(v: any) => patch({ accountType: v })"
      >
        <el-option label="全部账户" value="all" />
        <el-option label="现金" value="cash" />
        <el-option label="银行" value="bank" />
      </el-select>
      <el-select
        :model-value="modelValue.currency || baseCurrency"
        class="filter-ctl--sm"
        @update:model-value="(v: string) => patch({ currency: v === baseCurrency ? '' : v })"
      >
        <el-option v-for="c in currencies" :key="c" :label="c" :value="c" />
        <el-option v-if="currencies.length > 1 || allowAllCurrencies" :label="'全部（折本位币）'" :value="ALL_CURRENCIES" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="emit('query')"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton @clear="emit('clear')" />
      <el-button v-if="mode === 'detail'" link type="primary" @click="expanded = !expanded">
        {{ expanded ? '收起' : '更多筛选' }}
        <el-badge v-if="detailCount && !expanded" :value="detailCount" class="more-badge" />
      </el-button>
    </div>

    <!-- 明细级条件：汇总 / 综合查询使用（余额表只应用上面的账户级条件） -->
    <div v-if="mode === 'detail' && expanded" class="filter-panel">
      <div class="filter-line">
        <el-select
          :model-value="modelValue.counterAccounts"
          multiple collapse-tags collapse-tags-tooltip clearable filterable
          placeholder="对方科目"
          class="filter-ctl--lg"
          @update:model-value="(v: string[]) => patch({ counterAccounts: v })"
        >
          <el-option v-for="a in meta.counter_accounts" :key="a.code" :label="`${a.code} ${a.name}（${a.count}）`" :value="a.code" />
        </el-select>
        <el-select
          :model-value="modelValue.settleTypes"
          multiple collapse-tags collapse-tags-tooltip clearable
          placeholder="结算方式"
          class="filter-ctl--md"
          @update:model-value="(v: string[]) => patch({ settleTypes: v })"
        >
          <el-option v-for="t in settleOptions" :key="t.code" :label="t.name" :value="t.code" />
        </el-select>
        <el-select
          :model-value="modelValue.voucherStatus"
          multiple collapse-tags collapse-tags-tooltip clearable
          placeholder="凭证状态"
          class="filter-ctl--md"
          @update:model-value="(v: any) => patch({ voucherStatus: v })"
        >
          <el-option v-for="o in VOUCHER_STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select
          :model-value="modelValue.reconciled"
          clearable placeholder="对账状态" class="filter-ctl--sm"
          @update:model-value="(v: any) => patch({ reconciled: v === '' ? undefined : v })"
        >
          <el-option label="已对账" :value="1" />
          <el-option label="未对账" :value="0" />
        </el-select>
        <el-input :model-value="modelValue.summary" placeholder="摘要" clearable class="filter-ctl--sm" @update:model-value="(v: string) => patch({ summary: v })" @keyup.enter="emit('query')" />
        <el-input :model-value="modelValue.counterUnit" placeholder="对方单位" clearable class="filter-ctl--sm" @update:model-value="(v: string) => patch({ counterUnit: v })" @keyup.enter="emit('query')" />
        <el-input :model-value="modelValue.billNo" placeholder="票据号" clearable class="filter-ctl--sm" @update:model-value="(v: string) => patch({ billNo: v })" @keyup.enter="emit('query')" />
      </div>
      <div class="filter-line">
        <el-select :model-value="modelValue.amountDirection" class="filter-ctl--sm" @update:model-value="(v: any) => patch({ amountDirection: v })">
          <el-option label="收入+支出" value="all" />
          <el-option label="仅收入" value="income" />
          <el-option label="仅支出" value="expense" />
        </el-select>
        <el-input-number :model-value="modelValue.minAmount" :controls="false" :precision="2" :min="0" placeholder="最小金额" class="filter-ctl--sm" @update:model-value="(v: any) => patch({ minAmount: v ?? undefined })" />
        <span>~</span>
        <el-input-number :model-value="modelValue.maxAmount" :controls="false" :precision="2" :min="0" placeholder="最大金额" class="filter-ctl--sm" @update:model-value="(v: any) => patch({ maxAmount: v ?? undefined })" />
      </div>
      <CashierAuxFilter
        :model-value="modelValue.aux"
        :categories="meta.aux_categories"
        @update:model-value="(v: AuxSelection[]) => patch({ aux: v })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ArrowDown, Search } from '@element-plus/icons-vue'
import { cashierApi, type CashierReportFilterMeta } from '@/api/cashier'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import CashierAuxFilter from './CashierAuxFilter.vue'
import {
  ALL_CURRENCIES,
  VOUCHER_STATUS_OPTIONS,
  activeFilterCount,
  quickDateRange,
  type AuxSelection,
  type CashierReportFilterState,
} from '@/utils/cashierReportFilter'

const props = withDefaults(defineProps<{
  modelValue: CashierReportFilterState
  /** balance=只有账户级条件（余额表）；detail=含对方科目 / 结算方式 / 辅助项目等明细条件 */
  mode?: 'balance' | 'detail'
  loading?: boolean
  /** 只有本位币时是否仍显示「全部（折本位币）」项 */
  allowAllCurrencies?: boolean
}>(), { mode: 'detail', loading: false, allowAllCurrencies: false })

const emit = defineEmits<{
  'update:modelValue': [value: CashierReportFilterState]
  query: []
  clear: []
}>()

const accounts = ref<Array<{ code: string; name: string; is_cash: number; is_bank: number }>>([])
const currencies = ref<string[]>(['RMB'])
const settleTypes = ref<Array<{ code: string; name: string }>>([])
const meta = ref<CashierReportFilterMeta>({ aux_categories: [], settle_types: [], counter_accounts: [] })
const expanded = ref(false)

const baseCurrency = computed(() => currencies.value[0] || 'RMB')
const cashAccounts = computed(() => accounts.value.filter(a => a.is_cash))
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))
const settleOptions = computed(() => {
  // 字典里的结算方式 + 流水里出现过但字典已删除的，避免历史数据筛不到
  const known = new Set(settleTypes.value.map(t => t.code))
  const extra = meta.value.settle_types.filter(t => t.code && !known.has(t.code)).map(t => ({ code: t.code, name: t.name }))
  return [...settleTypes.value, ...extra]
})
const detailCount = computed(() => activeFilterCount(props.modelValue) - (props.modelValue.accountCodes.length ? 1 : 0) - (props.modelValue.accountType !== 'all' ? 1 : 0) - (props.modelValue.currency ? 1 : 0))

// 日期用本地数组做双向绑定（el-date-picker 的 v-model 需要可写目标）
const range = ref<[string, string]>(['', ''])
watch(() => props.modelValue.dateRange, v => { range.value = [v?.[0] || '', v?.[1] || ''] }, { immediate: true })

function patch(part: Partial<CashierReportFilterState>) {
  emit('update:modelValue', { ...props.modelValue, ...part })
}
function emitRange() {
  patch({ dateRange: range.value[0] || range.value[1] ? [range.value[0], range.value[1]] : null })
}
function onQuickRange(kind: 'month' | 'lastMonth' | 'quarter' | 'year') {
  patch({ dateRange: quickDateRange(kind) })
  emit('query')
}

// 钻取进来带着明细条件时自动展开
watch(
  () => props.modelValue,
  v => { if (props.mode === 'detail' && detailCount.value > 0) expanded.value = true },
  { immediate: true }
)

onMounted(async () => {
  const [accRes, curRes, stRes, metaRes] = await Promise.all([
    cashierApi.getAccounts().catch(() => null),
    cashierApi.getCurrencies().catch(() => null),
    cashierApi.getSettleTypes().catch(() => null),
    props.mode === 'detail' ? cashierApi.reportFilterMeta().catch(() => null) : Promise.resolve(null),
  ])
  if (accRes?.code === 0) accounts.value = accRes.data as any
  if (curRes?.code === 0 && Array.isArray(curRes.data) && curRes.data.length) currencies.value = curRes.data
  if (stRes?.code === 0) settleTypes.value = stRes.data as any
  if (metaRes?.code === 0) meta.value = metaRes.data
})

/** 供父页面取用（科目名称 / 币种 / 元数据），避免各页面重复请求 */
defineExpose({ accounts, currencies, settleTypes, meta, baseCurrency })
</script>

<style scoped>
.cashier-report-filter { padding: 12px 16px 4px; display: flex; flex-direction: column; gap: 8px; }
.filter-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px dashed var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-extra-light); }
.more-badge { margin-left: 6px; }
</style>
