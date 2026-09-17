<template>
  <PageListLayout title="资产领用归还">
    <template #actions>
      <el-button v-permission="'asset:requisition'" type="primary" :icon="Plus" @click="openDialog('out')">登记领用</el-button>
      <el-button v-permission="'asset:requisition'" :icon="Back" @click="openDialog('in')">登记归还</el-button>
    </template>

    <template #filters>
      <el-input
        v-model="filters.keyword"
        placeholder="资产编号 / 名称 / 领用人"
        clearable
        style="width: 230px"
        :prefix-icon="Search"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select
        v-model="filters.action"
        placeholder="操作类型"
        clearable
        style="width: 120px"
        @change="reload"
      >
        <el-option label="领用" value="out" />
        <el-option label="归还" value="in" />
      </el-select>
      <el-select
        v-model="filters.dept_code"
        placeholder="使用部门"
        clearable
        style="width: 150px"
        @change="reload"
      >
        <el-option v-for="d in dicts?.dept || []" :key="d.code" :label="d.name" :value="d.code" />
      </el-select>
      <el-date-picker
        v-model="dateRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="width: 240px"
        @change="reload"
      />
      <el-checkbox v-model="filters.outstanding_only" @change="reload">仅未归还</el-checkbox>
      <el-checkbox v-model="filters.overdue_only" @change="reload">仅逾期</el-checkbox>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <FilterClearButton size="small" @clear="handleClearFilters" />
    </template>

    <div ref="tableContainerRef" class="table-container">
      <el-table v-loading="loading" :data="rows" size="small" border stripe class="compact-data-table" :height="tableHeight">
        <el-table-column label="日期" prop="action_date" width="110" />
        <el-table-column label="类型" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.action === 'out' ? 'warning' : 'success'" size="small">
              {{ actionLabel(row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="资产编号" prop="asset_no" width="120" />
        <el-table-column label="资产名称" prop="asset_name" min-width="150" show-overflow-tooltip />
        <el-table-column label="领用人" prop="user_name" width="100" />
        <el-table-column label="使用部门" prop="dept_name" width="120" />
        <el-table-column label="存放地点" prop="install_place" min-width="130" show-overflow-tooltip />
        <el-table-column label="预计归还" width="130" align="center">
          <template #default="{ row }">
            <span v-if="!row.expect_return_date" class="zero">-</span>
            <el-tag v-else-if="isOverdue(row)" type="danger" size="small">
              {{ row.expect_return_date }} 逾期
            </el-tag>
            <span v-else>{{ row.expect_return_date }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.action === 'out' && row.outstanding" type="warning" size="small">
              未归还
            </el-tag>
            <el-tag v-else-if="row.action === 'out'" type="info" size="small">已归还</el-tag>
            <span v-else class="zero">-</span>
          </template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作人" prop="operator" width="90" />
        <el-table-column label="操作" width="70" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'asset:requisition'" link type="danger" size="small" @click="remove(row)">删除</el-button>
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

  <!-- 领用/归还是单一动作的轻量登记，按界面规则可用弹窗 -->
  <el-dialog
    v-model="dialogVisible"
    :title="form.action === 'out' ? '登记资产领用' : '登记资产归还'"
    width="560px"
    draggable
  >
    <el-form :model="form" label-width="110px" size="small">
      <el-form-item label="资产" required>
        <el-select
          v-model="form.asset_id"
          filterable
          remote
          clearable
          placeholder="按编号或名称搜索"
          :remote-method="searchAssets"
          :loading="assetLoading"
          style="width: 100%"
          @change="onAssetPicked"
        >
          <el-option
            v-for="a in assetOptions"
            :key="a.id"
            :label="`${a.asset_no} ${a.asset_name}`"
            :value="a.id"
          />
        </el-select>
      </el-form-item>

      <el-alert
        v-if="pickedAsset && form.action === 'out' && pickedOutstanding"
        type="warning"
        :closable="false"
        show-icon
        title="该资产已被领用且尚未归还，请先办理归还。"
        style="margin-bottom: 12px"
      />
      <el-alert
        v-if="pickedAsset && form.action === 'in' && !pickedOutstanding"
        type="warning"
        :closable="false"
        show-icon
        title="该资产当前没有未归还的领用记录。"
        style="margin-bottom: 12px"
      />

      <el-form-item :label="form.action === 'out' ? '领用日期' : '归还日期'" required>
        <el-date-picker
          v-model="form.action_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>

      <template v-if="form.action === 'out'">
        <el-form-item label="领用人" required>
          <el-input v-model="form.user_name" placeholder="领用该资产的人员" />
        </el-form-item>
        <el-form-item label="使用部门">
          <el-select v-model="form.dept_code" clearable style="width: 100%" placeholder="留空保持不变">
            <el-option
              v-for="d in dicts?.dept || []"
              :key="d.code"
              :label="`${d.code} ${d.name}`"
              :value="d.code"
            />
          </el-select>
          <div class="field-tip">
            部门发生变化时，会自动记一条「部门调拨」变动流水。
          </div>
        </el-form-item>
        <el-form-item label="预计归还日期">
          <el-date-picker
            v-model="form.expect_return_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="留空表示长期领用"
          />
        </el-form-item>
      </template>

      <el-form-item v-else label="归还成色">
        <el-input
          v-model="form.condition_note"
          type="textarea"
          :rows="2"
          placeholder="外观、功能是否完好，有无损坏"
        />
      </el-form-item>

      <el-form-item label="保管人">
        <el-input v-model="form.keeper" placeholder="留空保持不变" />
      </el-form-item>
      <el-form-item label="存放地点">
        <el-input v-model="form.install_place" placeholder="留空保持不变" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Back } from '@element-plus/icons-vue'
import {
  fixedAssetApi,
  REQUISITION_ACTION_LABELS,
  type RequisitionRow,
  type RequisitionAction,
  type AssetCard,
  type AssetDicts,
} from '@/api/fixedAsset'
import PageListLayout from '@/components/layout/PageListLayout.vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'
import { useFillHeightTable } from '@/composables/useFillHeightTable'

const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()

const rows = ref<RequisitionRow[]>([])
const total = ref(0)
const loading = ref(false)
const dicts = ref<AssetDicts | null>(null)
const dateRange = ref<[string, string] | null>(null)

const filters = reactive({
  keyword: '',
  action: '' as '' | RequisitionAction,
  dept_code: '',
  outstanding_only: false,
  overdue_only: false,
  page: 1,
  page_size: 20,
})
const { clearFilters } = useFilterClear([filters, dateRange], {
  defaults: { page: 1, page_size: 20 }
})

/** 清空筛选条件并恢复默认查询 */
function handleClearFilters() {
  clearFilters()
  reload()
}

// ── 登记弹窗 ────────────────────────────────────────────────

const dialogVisible = ref(false)
const submitting = ref(false)
const assetOptions = ref<AssetCard[]>([])
const assetLoading = ref(false)
const pickedAsset = ref<AssetCard | null>(null)
const pickedOutstanding = ref(false)

const today = () => new Date().toISOString().slice(0, 10)

const form = reactive({
  asset_id: '',
  action: 'out' as RequisitionAction,
  action_date: today(),
  user_name: '',
  dept_code: '',
  keeper: '',
  install_place: '',
  expect_return_date: '',
  condition_note: '',
  remark: '',
})

const actionLabel = (action: RequisitionAction) => REQUISITION_ACTION_LABELS[action]

function isOverdue(row: RequisitionRow) {
  return (
    row.action === 'out' &&
    row.outstanding &&
    !!row.expect_return_date &&
    row.expect_return_date < today()
  )
}

async function load() {
  loading.value = true
  try {
    const res = await fixedAssetApi.listRequisitions({
      keyword: filters.keyword || undefined,
      action: filters.action || undefined,
      dept_code: filters.dept_code || undefined,
      outstanding_only: filters.outstanding_only || undefined,
      overdue_only: filters.overdue_only || undefined,
      date_from: dateRange.value?.[0],
      date_to: dateRange.value?.[1],
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

async function searchAssets(keyword: string) {
  assetLoading.value = true
  try {
    const res = await fixedAssetApi.getCards({ keyword, page: 1, page_size: 30 })
    assetOptions.value = (res.data as any).list || []
  } finally {
    assetLoading.value = false
  }
}

/** 选中资产后预填其现有保管人/地点，并查出当前是否处于未归还状态 */
async function onAssetPicked() {
  pickedAsset.value = assetOptions.value.find(a => a.id === form.asset_id) || null
  pickedOutstanding.value = false
  if (!form.asset_id) return

  form.keeper = pickedAsset.value?.keeper || ''
  form.install_place = pickedAsset.value?.install_place || ''

  const res = await fixedAssetApi.getAssetRequisitions(form.asset_id)
  const last = res.data[0]
  pickedOutstanding.value = !!last && last.action === 'out' && last.outstanding
}

function openDialog(action: RequisitionAction) {
  form.asset_id = ''
  form.action = action
  form.action_date = today()
  form.user_name = ''
  form.dept_code = ''
  form.keeper = ''
  form.install_place = ''
  form.expect_return_date = ''
  form.condition_note = ''
  form.remark = ''
  pickedAsset.value = null
  pickedOutstanding.value = false
  dialogVisible.value = true
  searchAssets('')
}

async function submit() {
  if (!form.asset_id) return ElMessage.warning('请选择资产')
  if (!form.action_date) return ElMessage.warning('请选择日期')
  if (form.action === 'out' && !form.user_name.trim()) {
    return ElMessage.warning('请填写领用人')
  }

  submitting.value = true
  try {
    const res = await fixedAssetApi.createRequisition({
      asset_id: form.asset_id,
      action: form.action,
      action_date: form.action_date,
      user_name: form.user_name || null,
      dept_code: form.dept_code || null,
      keeper: form.keeper || null,
      install_place: form.install_place || null,
      expect_return_date: form.expect_return_date || null,
      condition_note: form.condition_note || null,
      remark: form.remark || null,
    })
    ElMessage.success(
      res.data.deptChangeId
        ? `${REQUISITION_ACTION_LABELS[form.action]}登记成功，已同步记录部门调拨`
        : `${REQUISITION_ACTION_LABELS[form.action]}登记成功`
    )
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function remove(row: RequisitionRow) {
  await ElMessageBox.confirm(
    `确定删除 ${row.asset_no} 在 ${row.action_date} 的${REQUISITION_ACTION_LABELS[row.action]}记录吗？`,
    '删除记录',
    { type: 'warning' }
  )
  await fixedAssetApi.deleteRequisition(row.id)
  ElMessage.success('已删除')
  load()
}

onMounted(async () => {
  const dictRes = await fixedAssetApi.getDicts()
  dicts.value = dictRes.data
  load()
})
</script>

<style scoped>
.table-container {
  flex: 1;
  min-height: 0;
}

.field-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

.zero {
  color: var(--el-text-color-placeholder);
}
</style>
