<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Calendar,
  ArrowDown,
  ArrowUp,
  FolderOpened,
  Star,
  StarFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { VoucherFilters } from '@/composables/useVoucherQuery'
import { cloneVoucherFilters } from '@/composables/useVoucherQuery'
import { useQueryScheme } from '@/composables/useQueryScheme'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'

interface Props {
  filters: VoucherFilters
  layout?: 'inline' | 'grouped'
  enableStatus?: boolean
  enableYearPeriod?: boolean
  enableVoucherType?: boolean
  enableAccount?: boolean
  enableAuxiliary?: boolean
  enableSort?: boolean
  enableQueryScheme?: boolean
  enableOperator?: boolean
  querySchemeKey?: string
  auxCategories?: any[]
  voucherTypes?: any[]
  accounts?: any[]
  auxItemsMap?: Record<string, any[]>
}

const props = withDefaults(defineProps<Props>(), {
  layout: 'inline',
  enableStatus: false,
  enableYearPeriod: false,
  enableVoucherType: false,
  enableAccount: false,
  enableAuxiliary: false,
  enableSort: false,
  enableQueryScheme: false,
  enableOperator: false,
  querySchemeKey: 'voucher-query-schemes',
  auxCategories: () => [],
  voucherTypes: () => [],
  accounts: () => [],
  auxItemsMap: () => ({}),
})

const emit = defineEmits<{
  search: []
  sortChange: [field: string, order: 'asc' | 'desc']
  loadAccounts: []
  loadAuxItems: [categoryId: string]
  searchAuxItems: [categoryId: string, keyword: string]
  applyScheme: [filters: VoucherFilters]
}>()

const showDateDialog = ref(false)
const tempDateRange = ref<string[]>([])
const filterExpanded = ref(false)

// 查询方案管理
const showSchemeDialog = ref(false)
const showSaveSchemeDialog = ref(false)
const schemeName = ref('')
const schemeDescription = ref('')
const schemeSetAsDefault = ref(false)
const schemeOverwriteId = ref<string | null>(null)

const queryScheme = props.enableQueryScheme
  ? useQueryScheme({ storageKey: props.querySchemeKey })
  : null

const years = computed(() => {
  const currentYear = new Date().getFullYear()
  return Array.from({ length: 5 }, (_, i) => currentYear - i)
})

const dateRangeLabel = computed(() => {
  const [start, end] = props.filters.dateRange || []
  if (start && end) return `${start} ~ ${end}`
  if (start) return `${start} 起`
  return '日期范围'
})

const hasScopeGroup = computed(
  () => props.enableStatus || props.enableYearPeriod || props.enableVoucherType
)

const hasAuxGroup = computed(() => props.enableAuxiliary && props.auxCategories.length > 0)

const statusLabels: Record<string, string> = {
  draft: '只录入',
  audited: '已审核',
  posted: '已记账',
}

const activeFilterCount = computed(() => {
  let count = 0
  const f = props.filters
  if (f.keyword?.trim()) count++
  if (f.status) count++
  if (f.dateRange?.length) count++
  if (f.year != null) count++
  if (f.period != null) count++
  if (f.voucherTypeIds?.length) count++
  if (f.accountIds?.length) count++
  if (f.makerName?.trim()) count++
  if (f.auditorName?.trim()) count++
  if (f.posterName?.trim()) count++
  if (f.auxItems) {
    for (const ids of Object.values(f.auxItems)) {
      if (Array.isArray(ids) && ids.length) count++
    }
  }
  if (f.auxFields) {
    for (const val of Object.values(f.auxFields)) {
      if (val != null && val !== '') count++
    }
  }
  return count
})

const collapsedSummary = computed(() => {
  const parts: string[] = []
  const f = props.filters
  if (f.status) parts.push(statusLabels[f.status] || f.status)
  if (f.dateRange?.length === 2 && f.dateRange[0] && f.dateRange[1]) {
    parts.push(`${f.dateRange[0]}~${f.dateRange[1]}`)
  } else if (dateRangeLabel.value !== '日期范围') {
    parts.push(dateRangeLabel.value)
  }
  if (f.year != null) parts.push(`${f.year}年`)
  if (f.period != null) parts.push(`${f.period}月`)
  if (f.voucherTypeIds?.length) parts.push(`类型${f.voucherTypeIds.length}项`)
  if (f.accountIds?.length) parts.push(`科目${f.accountIds.length}项`)
  if (f.makerName?.trim() || f.auditorName?.trim() || f.posterName?.trim()) {
    parts.push('经办人已设')
  }
  const auxCount =
    Object.values(f.auxItems || {}).filter(ids => Array.isArray(ids) && ids.length).length +
    Object.values(f.auxFields || {}).filter(val => val != null && val !== '').length
  if (auxCount > 0) parts.push(`辅助${auxCount}项`)
  if (parts.length === 0) return '更多条件'
  if (parts.length <= 2) return parts.join(' · ')
  return `${parts.slice(0, 2).join(' · ')} 等${parts.length}项`
})

function confirmDateRange() {
  props.filters.dateRange = [...tempDateRange.value]
  showDateDialog.value = false
  emit('search')
}

function clearDateRange() {
  tempDateRange.value = []
  props.filters.dateRange = []
  showDateDialog.value = false
  emit('search')
}

function parseFieldOptions(optionsJson: string | null): string[] {
  if (!optionsJson) return []
  try {
    const parsed = JSON.parse(optionsJson)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function openDateDialog() {
  tempDateRange.value = [...props.filters.dateRange]
  showDateDialog.value = true
}

// 快捷时间选择
function setQuickDate(type: 'today' | 'week' | 'month' | 'quarter' | 'year') {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const date = today.getDate()
  const day = today.getDay()

  let startDate = ''
  let endDate = ''

  switch (type) {
    case 'today':
      startDate = endDate = formatDate(today)
      break
    case 'week':
      // 本周一到今天
      const monday = new Date(today)
      monday.setDate(date - (day === 0 ? 6 : day - 1))
      startDate = formatDate(monday)
      endDate = formatDate(today)
      break
    case 'month':
      // 本月1号到今天
      startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`
      endDate = formatDate(today)
      break
    case 'quarter':
      // 本季度第一天到今天
      const quarterStartMonth = Math.floor(month / 3) * 3
      startDate = `${year}-${String(quarterStartMonth + 1).padStart(2, '0')}-01`
      endDate = formatDate(today)
      break
    case 'year':
      // 本年1月1日到今天
      startDate = `${year}-01-01`
      endDate = formatDate(today)
      break
  }

  props.filters.dateRange = [startDate, endDate]
  emit('search')
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 查询方案相关函数
function handleSaveScheme(overwriteId?: string) {
  schemeOverwriteId.value = overwriteId ?? null
  if (overwriteId && queryScheme) {
    const existing = queryScheme.getScheme(overwriteId)
    if (existing) {
      schemeName.value = existing.name
      schemeDescription.value = existing.description || ''
      schemeSetAsDefault.value = !!existing.isDefault
    }
  } else {
    schemeName.value = ''
    schemeDescription.value = ''
    schemeSetAsDefault.value = false
  }
  showSaveSchemeDialog.value = true
}

function confirmSaveScheme() {
  if (!schemeName.value.trim()) {
    ElMessage.warning('请输入方案名称')
    return
  }
  if (!queryScheme) return

  const snapshot = cloneVoucherFilters(props.filters)
  const trimmedName = schemeName.value.trim()
  const trimmedDesc = schemeDescription.value.trim()

  if (schemeOverwriteId.value) {
    queryScheme.updateScheme(schemeOverwriteId.value, {
      name: trimmedName,
      description: trimmedDesc,
      filters: snapshot,
    })
    if (schemeSetAsDefault.value) {
      queryScheme.setDefaultScheme(schemeOverwriteId.value)
    } else {
      const scheme = queryScheme.getScheme(schemeOverwriteId.value)
      if (scheme?.isDefault) queryScheme.clearDefaultScheme()
    }
    ElMessage.success('查询方案已更新')
  } else {
    const duplicate = queryScheme.schemes.value.find(s => s.name === trimmedName)
    if (duplicate) {
      ElMessage.warning('方案名称已存在，请更换名称或在方案列表中选择「覆盖」')
      return
    }
    const created = queryScheme.addScheme(trimmedName, snapshot, trimmedDesc)
    if (schemeSetAsDefault.value) {
      queryScheme.setDefaultScheme(created.id)
    }
    ElMessage.success('查询方案保存成功')
  }

  showSaveSchemeDialog.value = false
  schemeOverwriteId.value = null
}

function handleLoadScheme(schemeId: string) {
  if (!queryScheme) return

  const filters = queryScheme.applyScheme(schemeId)
  if (filters) {
    emit('applyScheme', filters as VoucherFilters)
    ElMessage.success('已加载查询方案')
  }
}

function handleSchemeCommand(cmd: { action: 'load'; id: string }) {
  if (cmd.action === 'load') handleLoadScheme(cmd.id)
}

function handleDeleteScheme(schemeId: string) {
  if (!queryScheme) return

  ElMessageBox.confirm('确定删除此查询方案吗？', '提示', {
    type: 'warning',
  })
    .then(() => {
      queryScheme.deleteScheme(schemeId)
      ElMessage.success('删除成功')
    })
    .catch(() => {})
}

function handleSetDefault(schemeId: string) {
  if (!queryScheme) return

  const scheme = queryScheme.getScheme(schemeId)
  if (scheme?.isDefault) {
    queryScheme.clearDefaultScheme()
    ElMessage.success('已取消默认方案')
  } else {
    queryScheme.setDefaultScheme(schemeId)
    ElMessage.success('已设为默认方案')
  }
}
</script>

<template>
  <el-card class="voucher-filter-card" shadow="never">
    <!-- 分组布局（可折叠，默认收起） -->
    <div v-if="layout === 'grouped'" class="filter-panel-wrap">
      <div class="filter-bar-compact">
        <el-button class="filter-toggle-btn" text @click="filterExpanded = !filterExpanded">
          <el-icon>
            <ArrowDown v-if="!filterExpanded" />
            <ArrowUp v-else />
          </el-icon>
          {{ filterExpanded ? '收起' : '筛选' }}
          <el-badge
            v-if="activeFilterCount > 0"
            class="filter-active-badge"
            :value="activeFilterCount"
            :max="99"
          />
        </el-button>
        <el-input
          v-model="filters.keyword"
          class="filter-keyword-inline"
          size="small"
          placeholder="凭证号 / 摘要 / 金额 / 科目 / 辅助"
          clearable
          @keyup.enter="emit('search')"
        />
        <span
          v-if="!filterExpanded && collapsedSummary !== '更多条件'"
          class="filter-summary-text"
          :title="collapsedSummary"
        >
          {{ collapsedSummary }}
        </span>
        <div class="filter-bar-actions">
          <template v-if="enableQueryScheme">
            <el-button size="small" plain @click="handleSaveScheme()">
              <el-icon><FolderOpened /></el-icon>
              保存方案
            </el-button>
            <el-dropdown trigger="click" @command="handleSchemeCommand">
              <el-button size="small" plain>
                我的方案
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="!queryScheme?.schemes.value.length" disabled>
                    暂无保存的方案
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-for="scheme in queryScheme?.schemes.value || []"
                    :key="scheme.id"
                    :command="{ action: 'load', id: scheme.id }"
                  >
                    <div class="filter-scheme-item">
                      <span class="filter-scheme-item-name">
                        <el-icon v-if="scheme.isDefault" class="filter-scheme-star">
                          <StarFilled />
                        </el-icon>
                        {{ scheme.name }}
                      </span>
                      <div class="filter-scheme-item-actions">
                        <el-button
                          link
                          size="small"
                          title="覆盖保存"
                          @click.stop="handleSaveScheme(scheme.id)"
                        >
                          覆盖
                        </el-button>
                        <el-button
                          link
                          size="small"
                          :title="scheme.isDefault ? '取消默认' : '设为默认'"
                          @click.stop="handleSetDefault(scheme.id)"
                        >
                          <el-icon :style="{ color: scheme.isDefault ? '#f59e0b' : '#909399' }">
                            <component :is="scheme.isDefault ? StarFilled : Star" />
                          </el-icon>
                        </el-button>
                        <el-button
                          link
                          type="danger"
                          size="small"
                          @click.stop="handleDeleteScheme(scheme.id)"
                        >
                          删
                        </el-button>
                      </div>
                    </div>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <el-button type="primary" size="small" @click="emit('search')">查询</el-button>
          <slot name="actions" />
        </div>
      </div>

      <el-collapse-transition>
        <div v-show="filterExpanded" class="filter-panel-expanded">
          <div v-if="hasScopeGroup" class="filter-group-row">
            <span class="filter-group-label">范围</span>
            <div class="filter-group-body">
              <el-select
                v-if="enableStatus"
                v-model="filters.status"
                placeholder="凭证状态"
                class="filter-control filter-control--sm"
                size="small"
                clearable
                @change="emit('search')"
              >
                <el-option label="全部状态" value="" />
                <el-option label="只录入" value="draft" />
                <el-option label="已审核" value="audited" />
                <el-option label="已记账" value="posted" />
              </el-select>

              <el-button class="filter-date-btn" size="small" @click="openDateDialog">
                <el-icon><Calendar /></el-icon>
                {{ dateRangeLabel }}
              </el-button>

              <el-dropdown trigger="click" @command="(cmd: 'today' | 'week' | 'month' | 'quarter' | 'year') => setQuickDate(cmd)">
                <el-button size="small">快捷日期</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="today">今天</el-dropdown-item>
                    <el-dropdown-item command="week">本周</el-dropdown-item>
                    <el-dropdown-item command="month">本月</el-dropdown-item>
                    <el-dropdown-item command="quarter">本季</el-dropdown-item>
                    <el-dropdown-item command="year">本年</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>

              <template v-if="enableYearPeriod">
                <el-select
                  v-model="filters.year"
                  placeholder="会计年度"
                  class="filter-control filter-control--xs"
                  size="small"
                  clearable
                  @change="emit('search')"
                >
                  <el-option label="全部年份" :value="null as any" />
                  <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
                </el-select>
                <el-select
                  v-model="filters.period"
                  placeholder="会计期间"
                  class="filter-control filter-control--xs"
                  size="small"
                  clearable
                  @change="emit('search')"
                >
                  <el-option label="全部月份" :value="null as any" />
                  <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
                </el-select>
              </template>

              <el-select
                v-if="enableVoucherType"
                v-model="filters.voucherTypeIds"
                placeholder="凭证类型"
                class="filter-control filter-control--md"
                size="small"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                @change="emit('search')"
              >
                <el-option label="全部类型" value="" />
                <el-option
                  v-for="vt in voucherTypes"
                  :key="vt.id"
                  :label="vt.name"
                  :value="vt.id"
                />
              </el-select>
            </div>
          </div>

          <div v-if="enableAccount || enableOperator" class="filter-group-row">
            <span class="filter-group-label">{{ enableAccount && enableOperator ? '科目/人' : enableAccount ? '科目' : '经办' }}</span>
            <div class="filter-group-body">
              <el-select
                v-if="enableAccount"
                v-model="filters.accountIds"
                placeholder="选择科目（可多选）"
                class="filter-control filter-control--lg"
                :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
                size="small"
                multiple
                collapse-tags
                collapse-tags-tooltip
                clearable
                filterable
                @focus="emit('loadAccounts')"
                @change="emit('search')"
              >
                <el-option
                  v-for="acc in accounts"
                  :key="acc.id"
                  :label="`${acc.code} ${acc.name}`"
                  :value="acc.id"
                />
              </el-select>
              <template v-if="enableOperator">
                <el-input
                  v-model="filters.makerName"
                  placeholder="制单人"
                  class="filter-control filter-control--xs"
                  size="small"
                  clearable
                  @change="emit('search')"
                />
                <el-input
                  v-model="filters.auditorName"
                  placeholder="审核人"
                  class="filter-control filter-control--xs"
                  size="small"
                  clearable
                  @change="emit('search')"
                />
                <el-input
                  v-model="filters.posterName"
                  placeholder="记账人"
                  class="filter-control filter-control--xs"
                  size="small"
                  clearable
                  @change="emit('search')"
                />
              </template>
            </div>
          </div>

          <div v-if="hasAuxGroup" class="filter-group-row">
            <span class="filter-group-label">辅助</span>
            <div class="filter-group-body filter-group-body--wrap">
              <template v-for="cat in auxCategories" :key="cat.id">
                <el-select
                  v-model="filters.auxItems[cat.id]"
                  :placeholder="cat.name"
                  class="filter-control filter-control--sm"
                  size="small"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  clearable
                  filterable
                  remote
                  :remote-method="(q: string) => emit('searchAuxItems', cat.id, q)"
                  @focus="emit('loadAuxItems', cat.id)"
                  @change="emit('search')"
                >
                  <el-option
                    v-for="item in auxItemsMap[cat.id] || []"
                    :key="item.id"
                    :label="item.name"
                    :value="item.id"
                  />
                </el-select>
                <template v-for="field in cat.fields || []" :key="field.id">
                  <el-input
                    v-if="field.field_type === 'text' || field.field_type === 'number'"
                    v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
                    :placeholder="field.field_name"
                    class="filter-control filter-control--sm"
                    size="small"
                    clearable
                    @change="emit('search')"
                  />
                  <el-select
                    v-else-if="field.field_type === 'select'"
                    v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
                    :placeholder="field.field_name"
                    class="filter-control filter-control--sm"
                    size="small"
                    clearable
                    @change="emit('search')"
                  >
                    <el-option
                      v-for="opt in parseFieldOptions(field.options_json)"
                      :key="opt"
                      :label="opt"
                      :value="opt"
                    />
                  </el-select>
                  <el-date-picker
                    v-else-if="field.field_type === 'date'"
                    v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
                    type="date"
                    :placeholder="field.field_name"
                    value-format="YYYY-MM-DD"
                    class="filter-control filter-control--sm"
                    size="small"
                    clearable
                    @change="emit('search')"
                  />
                </template>
              </template>
            </div>
          </div>

          <div v-if="enableSort" class="filter-group-row">
            <span class="filter-group-label">排序</span>
            <div class="filter-group-body">
              <el-select
                v-model="filters.sortField"
                placeholder="排序字段"
                class="filter-control filter-control--sort"
                size="small"
                @change="emit('sortChange', filters.sortField, filters.sortOrder)"
              >
                <el-option label="凭证日期" value="voucher_date" />
                <el-option label="凭证号" value="voucher_no" />
                <el-option label="借方金额" value="debit_amount" />
                <el-option label="贷方金额" value="credit_amount" />
                <el-option label="创建时间" value="created_at" />
              </el-select>
              <el-select
                v-model="filters.sortOrder"
                placeholder="排序方式"
                class="filter-control filter-control--xs"
                size="small"
                @change="emit('sortChange', filters.sortField, filters.sortOrder)"
              >
                <el-option label="升序" value="asc" />
                <el-option label="降序" value="desc" />
              </el-select>
            </div>
          </div>
        </div>
      </el-collapse-transition>

      <div
        v-if="
          !filterExpanded &&
          enableQueryScheme &&
          queryScheme &&
          queryScheme.schemes.value.length > 0
        "
        class="filter-quick-tags"
      >
        <el-tag
          v-for="scheme in queryScheme.schemes.value.slice(0, 4)"
          :key="scheme.id"
          :type="scheme.isDefault ? 'warning' : 'info'"
          size="small"
          class="filter-quick-tag"
          @click="handleLoadScheme(scheme.id)"
        >
          {{ scheme.name }}
        </el-tag>
      </div>
    </div>

    <!-- 单行布局（兼容旧页） -->
    <div v-else class="filter-row">
      <el-input
        v-model="filters.keyword"
        placeholder="凭证号/摘要/金额/制单人/记账人/科目/辅助核算"
        style="width: 360px"
        clearable
        @keyup.enter="emit('search')"
      />
      <el-select
        v-if="enableStatus"
        v-model="filters.status"
        placeholder="状态"
        style="width: 120px"
        @change="emit('search')"
      >
        <el-option label="全部" value="" />
        <el-option label="只录入" value="draft" />
        <el-option label="已审核" value="audited" />
        <el-option label="已记账" value="posted" />
      </el-select>
      <el-button :icon="Calendar" circle @click="openDateDialog" />
      <template v-if="enableYearPeriod">
        <el-select
          v-model="filters.year"
          placeholder="年度"
          style="width: 100px"
          clearable
          @change="emit('search')"
        >
          <el-option label="全部年份" :value="null as any" />
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select
          v-model="filters.period"
          placeholder="月份"
          style="width: 100px"
          clearable
          @change="emit('search')"
        >
          <el-option label="全部月份" :value="null as any" />
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
      </template>
      <el-select
        v-if="enableVoucherType"
        v-model="filters.voucherTypeIds"
        placeholder="凭证类型"
        style="width: 180px"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        @change="emit('search')"
      >
        <el-option label="全部类型" value="" />
        <el-option v-for="vt in voucherTypes" :key="vt.id" :label="vt.name" :value="vt.id" />
      </el-select>
      <el-select
        v-if="enableAccount"
        v-model="filters.accountIds"
        placeholder="科目"
        style="width: 180px"
        :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        filterable
        @focus="emit('loadAccounts')"
        @change="emit('search')"
      >
        <el-option
          v-for="acc in accounts"
          :key="acc.id"
          :label="`${acc.code} ${acc.name}`"
          :value="acc.id"
        />
      </el-select>
      <template v-if="enableAuxiliary">
        <template v-for="cat in auxCategories" :key="cat.id">
          <el-select
            v-model="filters.auxItems[cat.id]"
            :placeholder="cat.name"
            style="width: 150px"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            filterable
            remote
            :remote-method="(q: string) => emit('searchAuxItems', cat.id, q)"
            @focus="emit('loadAuxItems', cat.id)"
            @change="emit('search')"
          >
            <el-option
              v-for="item in auxItemsMap[cat.id] || []"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
          <template v-for="field in cat.fields || []" :key="field.id">
            <el-input
              v-if="field.field_type === 'text' || field.field_type === 'number'"
              v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
              :placeholder="field.field_name"
              style="width: 150px"
              clearable
              @change="emit('search')"
            />
            <el-select
              v-else-if="field.field_type === 'select'"
              v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
              :placeholder="field.field_name"
              style="width: 150px"
              clearable
              @change="emit('search')"
            >
              <el-option
                v-for="opt in parseFieldOptions(field.options_json)"
                :key="opt"
                :label="opt"
                :value="opt"
              />
            </el-select>
            <el-date-picker
              v-else-if="field.field_type === 'date'"
              v-model="filters.auxFields[`${cat.id}_${field.field_key}`]"
              type="date"
              :placeholder="field.field_name"
              value-format="YYYY-MM-DD"
              style="width: 150px"
              clearable
              @change="emit('search')"
            />
          </template>
        </template>
      </template>
      <template v-if="enableSort">
        <el-select
          v-model="filters.sortField"
          placeholder="排序字段"
          style="width: 130px"
          @change="emit('sortChange', filters.sortField, filters.sortOrder)"
        >
          <el-option label="凭证日期" value="voucher_date" />
          <el-option label="凭证号" value="voucher_no" />
          <el-option label="借方金额" value="debit_amount" />
          <el-option label="贷方金额" value="credit_amount" />
          <el-option label="创建时间" value="created_at" />
        </el-select>
        <el-select
          v-model="filters.sortOrder"
          placeholder="排序方式"
          style="width: 100px"
          @change="emit('sortChange', filters.sortField, filters.sortOrder)"
        >
          <el-option label="升序" value="asc" />
          <el-option label="降序" value="desc" />
        </el-select>
      </template>
      <el-button type="primary" @click="emit('search')">查询</el-button>
      <div v-if="$slots.actions" class="voucher-filter-actions">
        <slot name="actions" />
      </div>
    </div>
  </el-card>

  <el-dialog v-model="showDateDialog" title="选择日期范围" width="300px">
    <el-form label-width="80px">
      <el-form-item label="开始日期">
        <el-date-picker
          v-model="tempDateRange[0]"
          type="date"
          placeholder="选择开始日期"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="结束日期">
        <el-date-picker
          v-model="tempDateRange[1]"
          type="date"
          placeholder="选择结束日期"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="showDateDialog = false">取消</el-button>
      <el-button @click="clearDateRange">清空</el-button>
      <el-button type="primary" @click="confirmDateRange">确定</el-button>
    </template>
  </el-dialog>

  <!-- 保存查询方案对话框 -->
  <el-dialog
    v-model="showSaveSchemeDialog"
    :title="schemeOverwriteId ? '覆盖查询方案' : '保存查询方案'"
    width="500px"
  >
    <el-form label-width="100px">
      <el-form-item label="方案名称" required>
        <el-input
          v-model="schemeName"
          placeholder="如：本月费用凭证"
          maxlength="50"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="方案说明">
        <el-input
          v-model="schemeDescription"
          type="textarea"
          :rows="3"
          placeholder="可选，描述此方案的用途"
          maxlength="200"
          show-word-limit
        />
      </el-form-item>
      <el-form-item label="默认方案">
        <el-checkbox v-model="schemeSetAsDefault">设为默认方案（置顶显示，便于快速加载）</el-checkbox>
      </el-form-item>
      <el-alert type="info" :closable="false" show-icon>
        <template #default>
          <div style="font-size: 13px; line-height: 1.6">
            <p style="margin: 0">将保存当前所有筛选条件，包括：</p>
            <ul style="margin: 4px 0 0 0; padding-left: 20px">
              <li>关键词、状态、日期范围、年度/期间</li>
              <li>凭证类型、科目、经办人</li>
              <li>辅助核算项目、排序方式</li>
            </ul>
          </div>
        </template>
      </el-alert>
    </el-form>
    <template #footer>
      <el-button @click="showSaveSchemeDialog = false">取消</el-button>
      <el-button type="primary" @click="confirmSaveScheme">
        {{ schemeOverwriteId ? '覆盖保存' : '保存' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.voucher-filter-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.filter-panel-wrap {
  width: 100%;
}

.filter-bar-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}

.filter-toggle-btn {
  flex-shrink: 0;
  padding: 0 4px !important;
  height: 26px !important;
  font-size: 12px !important;
  color: #48484a !important;
  font-weight: 600;
}

.filter-toggle-btn .el-icon {
  margin-right: 2px;
}

.filter-active-badge {
  margin-left: 4px;
}

.filter-active-badge :deep(.el-badge__content) {
  height: 16px;
  line-height: 16px;
  padding: 0 5px;
  font-size: 11px;
}

.filter-keyword-inline {
  flex: 1;
  min-width: 140px;
  max-width: 360px;
}

.filter-keyword-inline :deep(.el-input__wrapper) {
  min-height: 26px !important;
}

.filter-summary-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-bar-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.filter-bar-actions :deep(.el-button) {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

.filter-panel-expanded {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.filter-group-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 0;
}

.filter-group-label {
  flex-shrink: 0;
  width: 44px;
  font-size: 11px;
  font-weight: 600;
  color: #6e6e73;
  line-height: 26px;
  text-align: right;
}

.filter-group-body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.filter-group-body--wrap {
  row-gap: 4px;
}

.filter-control--xs {
  width: 96px;
}

.filter-control--sm {
  width: 112px;
}

.filter-control--md {
  width: 140px;
}

.filter-control--lg {
  width: 220px;
  max-width: 100%;
}

.filter-control--sort {
  width: 112px;
}

.filter-date-btn {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  min-width: 120px;
  max-width: 160px;
}

.filter-scheme-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 220px;
  gap: 8px;
}

.filter-scheme-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-scheme-star {
  color: #f59e0b;
  margin-right: 4px;
  vertical-align: middle;
}

.filter-scheme-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
}

.filter-quick-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
  flex-wrap: wrap;
}

.filter-quick-tag {
  cursor: pointer;
}
</style>
