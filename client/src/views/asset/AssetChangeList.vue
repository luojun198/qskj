<template>
  <PageListLayout title="资产变动记录">
    <template #actions>
      <el-button v-permission="'asset:change'" type="primary" :icon="Plus" @click="router.push('/asset/change')">
        登记变动
      </el-button>
      <SaveAsButton title="资产变动记录" size="default" />
    </template>

    <template #filters>
      <el-input
        v-model="filters.keyword"
        placeholder="资产编号 / 名称 / 变动事项"
        clearable
        style="width: 240px"
        :prefix-icon="Search"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select
        v-model="filters.kind"
        placeholder="变动类型"
        clearable
        style="width: 150px"
        @change="reload"
      >
        <el-option
          v-for="(name, code) in ASSET_CHANGE_KIND_LABELS"
          :key="code"
          :label="name"
          :value="code"
        />
      </el-select>
      <el-date-picker
        v-model="period"
        type="month"
        value-format="YYYY-MM"
        placeholder="所属期间"
        clearable
        style="width: 160px"
        @change="reload"
      />
      <el-select
        v-model="filters.dept_code"
        placeholder="使用部门"
        clearable
        style="width: 160px"
        @change="reload"
      >
        <el-option v-for="d in dicts?.dept || []" :key="d.code" :label="d.name" :value="d.code" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
    </template>

    <div ref="tableContainerRef" class="table-container">
      <el-table v-loading="loading" :data="rows" size="small" border stripe :height="tableHeight">
        <el-table-column label="变动日期" prop="change_date" width="110" />
        <el-table-column label="期间" width="90" align="center">
          <template #default="{ row }">
            {{
              row.year && row.period ? `${row.year}-${String(row.period).padStart(2, '0')}` : '-'
            }}
          </template>
        </el-table-column>
        <el-table-column label="资产编号" prop="asset_no" width="120" />
        <el-table-column label="资产名称" prop="asset_name" min-width="140" show-overflow-tooltip />
        <el-table-column label="变动类型" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="kindTagType(row.change_kind)" size="small">
              {{ ASSET_CHANGE_KIND_LABELS[row.change_kind] || row.change_kind || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="变动事项"
          prop="change_item"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column label="变动前" min-width="140" align="right" show-overflow-tooltip>
          <template #default="{ row }">{{ beforeText(row) }}</template>
        </el-table-column>
        <el-table-column label="变动后" min-width="120" align="right" show-overflow-tooltip>
          <template #default="{ row }">{{ afterText(row) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.amount" :class="row.amount > 0 ? 'incr' : 'decr'">
              {{ row.amount > 0 ? '+' : '' }}{{ fmtAmt(row.amount) }}
            </span>
            <span v-else class="zero">-</span>
          </template>
        </el-table-column>
        <el-table-column label="凭证号" width="100" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.voucher_no"
              link
              type="primary"
              size="small"
              @click="openVoucher(row)"
            >
              {{ row.voucher_no }}
            </el-button>
            <span v-else class="zero">-</span>
          </template>
        </el-table-column>
        <el-table-column label="操作人" prop="operator" width="90" />
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canRevoke(row)" v-permission="'asset:change'" link type="danger" size="small" @click="revoke(row)">
              撤销
            </el-button>
            <span v-else class="zero">-</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-pagination
        v-model:current-page="filters.page"
        v-model:page-size="filters.page_size"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="load"
        @size-change="reload"
      />
    </template>
  </PageListLayout>
</template>

<script setup lang="ts">
import { confirmRenumberAfterDelete } from '@/composables/useRenumberPrompt'
import { ref, reactive, onMounted } from 'vue'
import { useReloadOnActivated } from '@/composables/useReloadOnActivated'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import {
  fixedAssetApi,
  DEPR_METHODS,
  ASSET_CHANGE_KIND_LABELS,
  type AssetChangeRow,
  type AssetDicts,
} from '@/api/fixedAsset'
import PageListLayout from '@/components/layout/PageListLayout.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import { useFillHeightTable } from '@/composables/useFillHeightTable'

const router = useRouter()
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()

const rows = ref<AssetChangeRow[]>([])
const total = ref(0)
const loading = ref(false)
const dicts = ref<AssetDicts | null>(null)
const period = ref<string>('')

const filters = reactive({
  keyword: '',
  kind: '',
  dept_code: '',
  page: 1,
  page_size: 20,
})
const { clearFilters } = useFilterClear([filters, period], {
  defaults: { page: 1, page_size: 20 }
})

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  reload()
}

const fmtAmt = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function kindTagType(kind: string) {
  if (kind === 'dispose') return 'danger'
  if (kind === 'impairment') return 'warning'
  if (kind === 'split' || kind === 'legacy') return 'info'
  return 'primary'
}

/**
 * 变动前/后取值：数值型变动读 old_value/new_value，
 * 文本型（部门、状态、折旧方法）读 old_text/new_text 并翻译成可读文案。
 */
function readableText(row: AssetChangeRow, value: string | null): string {
  if (value == null || value === '') return '-'
  if (row.field_key === 'dept_code') {
    return dicts.value?.dept.find(d => d.code === value)?.name || value
  }
  if (row.field_key === 'status_code') {
    return dicts.value?.status.find(s => s.code === value)?.name || value
  }
  if (row.field_key === 'depr_method') {
    return DEPR_METHODS[value] || value
  }
  return value
}

/** 快照字段的中文名（old_text 里存的 JSON 键） */
const SNAPSHOT_LABELS: Record<string, string> = {
  salvage_rate: '残值率',
  salvage_value: '残值',
  use_months: '使用月数',
  dept_code: '部门',
  user_name: '使用人',
  keeper: '保管人',
  install_place: '存放地点',
}

/** old_text 为撤销用的 JSON 快照时解析出对象，否则返回 null */
function parseSnapshot(text: string | null): Record<string, any> | null {
  if (typeof text !== 'string' || !text.startsWith('{')) return null
  try {
    const o = JSON.parse(text)
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

/** 快照 → 中文可读文案，如「部门：财务部；使用人：张三」 */
function snapshotText(snap: Record<string, any>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(snap)) {
    if (v == null || v === '') continue
    const label = SNAPSHOT_LABELS[k] || k
    let val: string = String(v)
    if (k === 'dept_code') val = dicts.value?.dept.find(d => d.code === v)?.name || val
    else if (k === 'salvage_rate') val = `${(Number(v) * 100).toFixed(2).replace(/\.00$/, '')}%`
    else if (k === 'use_months') val = `${v}个月`
    else if (k === 'salvage_value') val = fmtAmt(Number(v))
    parts.push(`${label}：${val}`)
  }
  return parts.length ? parts.join('；') : '-'
}

function beforeText(row: AssetChangeRow): string {
  if (row.old_text != null && row.old_text !== '') {
    const snap = parseSnapshot(row.old_text)
    if (snap) {
      // 原值类变动：快照仅供撤销使用，界面展示变动前原值
      if (row.old_value != null) return fmtAmt(row.old_value)
      return snapshotText(snap)
    }
    return readableText(row, row.old_text)
  }
  return row.old_value != null ? fmtAmt(row.old_value) : '-'
}

function afterText(row: AssetChangeRow): string {
  if (row.new_text != null && row.new_text !== '') return readableText(row, row.new_text)
  return row.new_value != null ? fmtAmt(row.new_value) : '-'
}

/** 与后端 revokeAssetChange 的限制保持一致 */
function canRevoke(row: AssetChangeRow) {
  return !['dispose', 'split', 'legacy'].includes(row.change_kind)
}

async function load() {
  loading.value = true
  try {
    const [year, month] = period.value
      ? period.value.split('-').map(Number)
      : [undefined, undefined]
    const res = await fixedAssetApi.listChanges({
      keyword: filters.keyword || undefined,
      kind: filters.kind || undefined,
      dept_code: filters.dept_code || undefined,
      year,
      period: month,
      page: filters.page,
      page_size: filters.page_size,
    })
    rows.value = res.data.list
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

function reload() {
  filters.page = 1
  load()
}

function openVoucher(row: AssetChangeRow) {
  router.push({ path: '/voucher/query', query: { voucher_id: row.voucher_id } })
}

async function revoke(row: AssetChangeRow) {
  await ElMessageBox.confirm(
    `确定撤销「${row.change_item}」吗？${row.voucher_no ? `关联凭证 ${row.voucher_no} 将一并删除。` : ''}`,
    '撤销变动',
    { type: 'warning' }
  )
  const res = await fixedAssetApi.revokeChange(row.id)
  ElMessage.success(
    res.data.deletedVoucherNo ? `已撤销，凭证 ${res.data.deletedVoucherNo} 已删除` : '已撤销'
  )
  load()
  // P2-19：删除变动凭证可能断号，提示重新排号
  await confirmRenumberAfterDelete(res.data.affectedGroups, res.data.deletedVoucherNo ? 1 : 0)
}

// 从「资产变动」页返回时刷新
useReloadOnActivated(() => { load() })
onMounted(async () => {
  const dictRes = await fixedAssetApi.getDicts()
  dicts.value = dictRes.data
  load()
})
</script>

<style scoped>
.incr {
  color: var(--el-color-success);
  font-weight: 600;
}

.decr {
  color: var(--el-color-danger);
  font-weight: 600;
}

.zero {
  color: var(--el-text-color-placeholder);
}

.table-container {
  flex: 1;
  min-height: 0;
}
</style>
