<template>
  <div class="dq-panel" :class="{ 'dq-panel--compact': compact }">
    <div class="dq-filter">
      <span class="dq-label">会计年度</span>
      <el-input-number v-model="year" size="small" :min="1990" :max="2100" :controls="false" style="width:72px" />
      <span class="dq-label">月份从</span>
      <el-select v-model="monthFrom" size="small" style="width:64px">
        <el-option v-for="m in 12" :key="m" :label="m" :value="m" />
      </el-select>
      <span class="dq-label">到</span>
      <el-select v-model="monthTo" size="small" style="width:64px">
        <el-option v-for="m in 12" :key="m" :label="m" :value="m" />
      </el-select>
      <el-select v-model="filters.category_code" size="small" style="width:128px" :empty-values="[null, undefined]">
        <el-option label="全部资产类别" value="" />
        <el-option v-for="c in dicts.category" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.dept_code" size="small" style="width:128px" :empty-values="[null, undefined]">
        <el-option label="全部使用部门" value="" />
        <el-option v-for="c in dicts.dept" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.purpose_code" size="small" style="width:110px" :empty-values="[null, undefined]">
        <el-option label="全部用途" value="" />
        <el-option v-for="c in dicts.purpose" :key="c.code" :label="c.name" :value="c.code" />
      </el-select>
      <el-select v-model="filters.depr_method" size="small" style="width:128px" :empty-values="[null, undefined]">
        <el-option label="全部折旧方法" value="" />
        <el-option v-for="(label, val) in DEPR_METHODS" :key="val" :label="label" :value="val" />
      </el-select>
      <el-input v-model="filters.keyword" size="small" clearable placeholder="编号 / 名称 / 规格 / 参考编号" style="width:200px" @keyup.enter="search" />
      <el-button size="small" type="primary" :loading="loading" @click="search"><el-icon><Search /></el-icon>搜索</el-button>
      <el-checkbox v-model="hideZero" size="small" @change="search">折旧为零不显示</el-checkbox>
      <el-tag v-if="compact && queried" size="small" effect="plain">
        {{ rangeLabel }} · {{ dataRows.length }} 条 · 合计 {{ fmtAmt(totalDepr) }}
      </el-tag>
      <el-button v-if="compact" size="small" :disabled="!dataRows.length" @click="exportExcel">另存</el-button>
    </div>

    <div ref="tableContainerRef" class="dq-table">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="displayRows"
        :height="compact ? undefined : tableHeight"
        :max-height="compact ? 520 : undefined"
        border
        size="small"
        class="compact-data-table"
        :row-class-name="rowClass"
        @header-dragend="onDragEnd"
      >
        <el-table-column label="序号" column-key="seq" :width="cw('seq', 56)" align="center">
          <template #default="{ row }">{{ row.kind === 'data' ? row.seq : '' }}</template>
        </el-table-column>
        <el-table-column label="年" column-key="year" :width="cw('year', 60)" align="center">
          <template #default="{ row }">{{ row.kind === 'data' ? row.year : '' }}</template>
        </el-table-column>
        <el-table-column label="月" column-key="month" :width="cw('month', 46)" align="center">
          <template #default="{ row }">{{ row.kind === 'data' ? row.month : '' }}</template>
        </el-table-column>
        <el-table-column label="设备编号" column-key="asset_no" :width="cw('asset_no', 110)">
          <template #default="{ row }">{{ row.kind === 'data' ? row.asset_no : '' }}</template>
        </el-table-column>
        <el-table-column label="参考编号" prop="ref_no" :width="cw('ref_no', 90)" show-overflow-tooltip />
        <el-table-column label="名称" column-key="asset_name" :width="cw('asset_name', 150)" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ 'dq-subtotal-label': row.kind !== 'data' }">{{ row.kind === 'data' ? row.asset_name : row.label }}</span>
          </template>
        </el-table-column>
        <el-table-column label="规格型号" prop="spec" :width="cw('spec', 130)" show-overflow-tooltip />
        <el-table-column label="类别" prop="category_name" :width="cw('category_name', 100)" show-overflow-tooltip />
        <el-table-column label="使用部门" prop="dept_name" :width="cw('dept_name', 100)" show-overflow-tooltip />
        <el-table-column label="用途" prop="purpose_name" :width="cw('purpose_name', 80)" show-overflow-tooltip />
        <el-table-column label="折旧方法" column-key="depr_method" :width="cw('depr_method', 100)">
          <template #default="{ row }">{{ row.kind === 'data' ? methodName(row.depr_method) : '' }}</template>
        </el-table-column>
        <el-table-column label="月工作量" column-key="month_workload" :width="cw('month_workload', 90)" align="right">
          <template #default="{ row }">{{ row.month_workload != null && row.month_workload !== '' ? row.month_workload : '' }}</template>
        </el-table-column>
        <el-table-column label="月折旧额" column-key="month_depr" :width="cw('month_depr', 110)" align="right">
          <template #default="{ row }">{{ fmtAmt(row.month_depr) }}</template>
        </el-table-column>
        <el-table-column label="累计折旧" column-key="accum_depr" :width="cw('accum_depr', 110)" align="right">
          <template #default="{ row }">{{ row.kind === 'data' ? fmtAmt(row.accum_depr) : '' }}</template>
        </el-table-column>
        <el-table-column label="凭证号" prop="voucher_no" min-width="90" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { fixedAssetApi, DEPR_METHODS, type AssetDicts, type DeprQueryRow } from '@/api/fixedAsset'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import { buildDeprQueryDisplayRows, type DeprQueryDisplayRow } from './deprQuery'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const params = useSystemParamsStore()
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const { tableRef, colWidth: cw, onDragEnd } = useListColumnWidth('asset_depr_query')

const year = ref(new Date().getFullYear())
const monthFrom = ref(new Date().getMonth() + 1)
const monthTo = ref(new Date().getMonth() + 1)
const hideZero = ref(false)
const filters = reactive({ category_code: '', dept_code: '', purpose_code: '', depr_method: '', keyword: '' })
const dicts = ref<Partial<AssetDicts>>({ category: [], dept: [], purpose: [] })
const dataRows = ref<DeprQueryRow[]>([])
const loading = ref(false)
const queried = ref(false)
const queriedRange = ref({ year: 0, from: 0, to: 0 })

const displayRows = computed<DeprQueryDisplayRow[]>(() => buildDeprQueryDisplayRows(dataRows.value))
const totalDepr = computed(() => Math.round(dataRows.value.reduce((s, r) => s + (Number(r.month_depr) || 0), 0) * 100) / 100)
const rangeLabel = computed(() => {
  const { year: y, from, to } = queriedRange.value
  return from === to ? `${y}年${from}月` : `${y}年${from}月 ~ ${to}月`
})

const fmtAmt = (v: unknown) =>
  v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const methodName = (m: string | null) => (m ? (DEPR_METHODS as Record<string, string>)[m] || m : '')
const rowClass = ({ row }: { row: DeprQueryDisplayRow }) => (row.kind === 'data' ? '' : `dq-row-${row.kind}`)

async function search() {
  if (monthFrom.value > monthTo.value) return ElMessage.warning('起始月份不能晚于截止月份')
  loading.value = true
  try {
    const res = await fixedAssetApi.queryDepr({
      from: year.value * 100 + monthFrom.value,
      to: year.value * 100 + monthTo.value,
      category_code: filters.category_code || undefined,
      dept_code: filters.dept_code || undefined,
      purpose_code: filters.purpose_code || undefined,
      depr_method: filters.depr_method || undefined,
      keyword: filters.keyword || undefined,
      hide_zero: hideZero.value ? '1' : undefined,
    })
    if (res.code === 0) {
      dataRows.value = res.data || []
      queried.value = true
      queriedRange.value = { year: year.value, from: monthFrom.value, to: monthTo.value }
    }
  } finally { loading.value = false }
}

async function exportExcel() {
  const rows = displayRows.value
  const text = (label: string, width: number, get: (r: DeprQueryDisplayRow) => unknown): ExportColumnDef<DeprQueryDisplayRow> =>
    ({ label, width, type: 'text', align: 'left', value: r => { const v = get(r); return v == null ? '' : String(v) }, bold: r => r.kind !== 'data' })
  const title = props.compact ? '折旧明细查询' : '折旧查询'
  const columns: ExportColumnDef<DeprQueryDisplayRow>[] = [
    text('序号', 6, r => (r.kind === 'data' ? r.seq : '')),
    text('年', 6, r => (r.kind === 'data' ? r.year : '')),
    text('月', 5, r => (r.kind === 'data' ? r.month : '')),
    text('设备编号', 12, r => (r.kind === 'data' ? r.asset_no : '')),
    text('参考编号', 12, r => r.ref_no),
    text('名称', 22, r => (r.kind === 'data' ? r.asset_name : r.label)),
    text('规格型号', 18, r => r.spec),
    text('类别', 12, r => r.category_name),
    text('使用部门', 12, r => r.dept_name),
    text('用途', 10, r => r.purpose_name),
    text('折旧方法', 12, r => (r.kind === 'data' ? methodName(r.depr_method) : '')),
    { label: '月工作量', width: 10, type: 'number', align: 'right', value: r => (r.month_workload == null ? '' : Number(r.month_workload)) },
    { label: '月折旧额', width: 14, type: 'amount', align: 'right', value: r => Number(r.month_depr) || 0, bold: r => r.kind !== 'data' },
    { label: '累计折旧', width: 14, type: 'amount', align: 'right', value: r => (r.kind === 'data' ? Number(r.accum_depr) || 0 : '') },
    text('凭证号', 12, r => r.voucher_no),
  ]
  await exportStyledTable({ fileName: `${title}_${rangeLabel.value}`, title, subtitle: rangeLabel.value, columns, rows })
}

onMounted(async () => {
  await params.load()
  year.value = params.currentYear
  monthFrom.value = 1
  monthTo.value = params.currentPeriod
  try {
    const res = await fixedAssetApi.getDicts()
    if (res.code === 0) dicts.value = res.data
  } catch { /* 字典取不到时筛选项为空 */ }
  await search()
})

defineExpose({ exportExcel, queried, rangeLabel, dataRows, totalDepr, fmtAmt })
</script>

<style scoped>
.dq-panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dq-panel--compact { flex: none; }
.dq-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 0; }
.dq-label { font-size: 12px; color: var(--el-text-color-regular); }
.dq-table { flex: 1; min-height: 0; }
.dq-subtotal-label { font-weight: 600; }
:deep(.dq-row-subtotal) td { background: var(--el-fill-color-light) !important; font-weight: 600; color: var(--el-color-primary); }
:deep(.dq-row-total) td { background: var(--el-color-primary-light-9) !important; font-weight: 700; }
</style>
