<template>
  <el-dialog
    v-model="visible"
    title="连续打印凭证"
    width="720px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="filter-section">
      <el-form :inline="true" :model="filterForm" label-width="80px" class="filter-form">
        <el-form-item label="日期区间">
          <el-date-picker
            v-model="filterForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 260px"
          />
        </el-form-item>
        <el-form-item label="凭证类型">
          <el-select
            v-model="filterForm.voucherTypeIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="全部类型"
            style="width: 200px"
            clearable
          >
            <el-option
              v-for="t in voucherTypes"
              :key="t.id"
              :label="t.name"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="凭证号">
          <div style="display: flex; align-items: center; gap: 6px">
            <el-input v-model="filterForm.voucherNoStart" placeholder="如 1 或 记-001" style="width: 120px" clearable />
            <span>至</span>
            <el-input v-model="filterForm.voucherNoEnd" placeholder="如 999 或 记-999" style="width: 120px" clearable />
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleQuery">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="result-box">
      <div v-if="loading" class="result-state">正在查询...</div>
      <div v-else-if="error" class="result-state is-error">{{ error }}</div>
      <div v-else-if="!queried" class="result-state">设置筛选条件后点击查询，再预览打印。</div>
      <div v-else-if="queriedIds.length === 0" class="result-state">未找到符合条件的凭证</div>
      <div v-else class="result-state">
        已找到 <strong>{{ queriedIds.length }}</strong> 张凭证，可预览后打印。
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :disabled="queriedIds.length === 0" @click="openHiprint">
        预览打印
      </el-button>
    </template>
  </el-dialog>

  <VoucherHiprintDialog v-model="hiprintVisible" :voucher-ids="queriedIds" mode="batch" />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { VoucherPrintData } from '@/types/print'
import request from '@/api/request'
import VoucherHiprintDialog from './VoucherHiprintDialog.vue'

interface Props {
  modelValue: boolean
  defaultDateRange?: string[]
  defaultVoucherTypeIds?: string[]
}

const props = withDefaults(defineProps<Props>(), {
  defaultDateRange: () => [],
  defaultVoucherTypeIds: () => [],
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val),
})

const filterForm = ref({
  dateRange: [] as string[],
  voucherTypeIds: [] as string[],
  voucherNoStart: '',
  voucherNoEnd: '',
})

const loading = ref(false)
const error = ref('')
const queried = ref(false)
const voucherTypes = ref<any[]>([])
const voucherDataList = ref<VoucherPrintData[]>([])
const hiprintVisible = ref(false)

const queriedIds = computed(() => voucherDataList.value.map(v => v.id).filter(Boolean))

async function loadVoucherTypes() {
  try {
    const res = await request.get<any[]>('/base/voucher-types')
    voucherTypes.value = res.data || []
  } catch {
    voucherTypes.value = []
  }
}

function formatVoucherNo(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.includes('-')) return trimmed
  if (/^\d+$/.test(trimmed) && filterForm.value.voucherTypeIds.length === 1) {
    const type = voucherTypes.value.find(t => t.id === filterForm.value.voucherTypeIds[0])
    if (type) {
      const prefix = type.name.charAt(0)
      return `${prefix}-${trimmed.padStart(3, '0')}`
    }
  }
  return trimmed
}

async function handleQuery() {
  const { dateRange, voucherTypeIds, voucherNoStart, voucherNoEnd } = filterForm.value
  const hasDate = dateRange && dateRange.length === 2
  const hasType = voucherTypeIds.length > 0
  const hasNo = voucherNoStart || voucherNoEnd

  if (!hasDate && !hasType && !hasNo) {
    ElMessage.warning('请至少设置一个筛选条件')
    return
  }

  loading.value = true
  error.value = ''
  queried.value = true

  try {
    const body: Record<string, any> = {}
    if (hasDate) {
      body.start_date = dateRange[0]
      body.end_date = dateRange[1]
    }
    if (hasType) {
      body.voucher_type_ids = voucherTypeIds
    }
    if (voucherNoStart) {
      body.voucher_no_start = formatVoucherNo(voucherNoStart)
    }
    if (voucherNoEnd) {
      body.voucher_no_end = formatVoucherNo(voucherNoEnd)
    }

    const res = await request.post<VoucherPrintData[]>('/voucher/print-data/batch', body)
    voucherDataList.value = res.data || []
  } catch (err: any) {
    error.value = err.response?.data?.message || err.message || '查询失败'
    voucherDataList.value = []
  } finally {
    loading.value = false
  }
}

function openHiprint() {
  if (queriedIds.value.length === 0) {
    ElMessage.warning('没有可打印的凭证')
    return
  }
  hiprintVisible.value = true
}

function handleClose() {
  visible.value = false
}

function getCurrentMonthRange(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDate = new Date(year, month + 1, 0).getDate()
  const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`
  return [firstDay, lastDay]
}

watch(
  () => props.modelValue,
  async val => {
    if (val) {
      filterForm.value.dateRange = props.defaultDateRange?.length === 2
        ? [...props.defaultDateRange]
        : getCurrentMonthRange()
      filterForm.value.voucherTypeIds = props.defaultVoucherTypeIds?.length
        ? [...props.defaultVoucherTypeIds]
        : []
      if (filterForm.value.voucherTypeIds.length <= 1) {
        filterForm.value.voucherNoStart = '1'
        filterForm.value.voucherNoEnd = '999'
      } else {
        filterForm.value.voucherNoStart = ''
        filterForm.value.voucherNoEnd = ''
      }
      queried.value = false
      voucherDataList.value = []
      error.value = ''
      hiprintVisible.value = false
      await loadVoucherTypes()
      if (!props.defaultVoucherTypeIds?.length && voucherTypes.value.length > 0) {
        const jizhang = voucherTypes.value.find(t => t.name.includes('记账'))
        if (jizhang) {
          filterForm.value.voucherTypeIds = [jizhang.id]
        }
      }
    }
  }
)
</script>

<style scoped>
.filter-section {
  padding: 0 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.result-box {
  min-height: 88px;
  display: flex;
  align-items: center;
  padding: 16px 0 4px;
}

.result-state {
  color: #606266;
  font-size: 14px;
}

.result-state.is-error {
  color: #f56c6c;
}
</style>
