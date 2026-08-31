<template>
  <el-dialog
    v-model="visible"
    title="批量打印凭证"
    width="90%"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <!-- 筛选条件 -->
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
          <el-button type="primary" :loading="loading" @click="handleQuery">查询预览</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-select v-model="selectedTemplateId" placeholder="选择打印模版" style="width: 200px">
        <el-option
          v-for="tpl in templates"
          :key="tpl.id"
          :label="tpl.name"
          :value="tpl.id"
        />
      </el-select>
      <span v-if="voucherDataList.length > 0" class="result-info">
        共 {{ voucherDataList.length }} 张凭证，{{ paginatedDataList.length }} 页
      </span>
      <span v-else-if="queried && !loading" class="result-info result-empty">
        未找到符合条件的凭证
      </span>
    </div>

    <!-- 预览区域 -->
    <div class="preview-area">
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载中...</span>
      </div>
      <div v-else-if="error" class="error-state">
        <el-icon><WarningFilled /></el-icon>
        <span>{{ error }}</span>
      </div>
      <div v-else-if="!queried" class="empty-state">
        请设置筛选条件后点击"查询预览"
      </div>
      <div v-else-if="currentTemplate && paginatedDataList.length > 0" class="preview-list">
        <PrintPreview
          v-for="(data, index) in paginatedDataList"
          :key="index"
          :template="currentTemplate"
          :voucher-data="data"
          class="preview-item"
        />
      </div>
    </div>

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button
        type="primary"
        :disabled="paginatedDataList.length === 0"
        @click="handlePrint"
      >
        打印（{{ paginatedDataList.length }} 页）
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import PrintPreview from './PrintPreview.vue'
import type { PrintTemplate, VoucherPrintData } from '@/types/print'
import { getDataRowsPerPage, normalizePrintTemplate, openPrintWindow } from '@/utils/printTemplate'
import request from '@/api/request'
import { useUserStore } from '@/stores/user'

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
  set: (val) => emit('update:modelValue', val),
})

const userStore = useUserStore()

// 筛选表单
const filterForm = ref({
  dateRange: [] as string[],
  voucherTypeIds: [] as string[],
  voucherNoStart: '',
  voucherNoEnd: '',
})

// 状态
const loading = ref(false)
const error = ref('')
const queried = ref(false)
const voucherTypes = ref<any[]>([])
const templates = ref<PrintTemplate[]>([])
const selectedTemplateId = ref<string>()
const voucherDataList = ref<VoucherPrintData[]>([])

const currentTemplate = computed(() => {
  const tpl = templates.value.find((t) => t.id === selectedTemplateId.value)
  return tpl ? normalizePrintTemplate(tpl) : undefined
})

// 分页展开
const paginatedDataList = computed<VoucherPrintData[]>(() => {
  const tpl = currentTemplate.value
  if (!tpl || voucherDataList.value.length === 0) return []

  const rowsPerPage = getDataRowsPerPage(tpl)
  const result: VoucherPrintData[] = []

  for (const voucher of voucherDataList.value) {
    const entries = voucher.entries || []
    if (entries.length <= rowsPerPage) {
      result.push({
        ...voucher,
        pageIndex: 1,
        totalPages: 1,
        pageEntries: entries,
        pageDebit: voucher.total_debit,
        pageCredit: voucher.total_credit,
      })
    } else {
      const totalPages = Math.ceil(entries.length / rowsPerPage)
      for (let page = 0; page < totalPages; page++) {
        const start = page * rowsPerPage
        const pageEntries = entries.slice(start, start + rowsPerPage)
        const pageDebit = pageEntries.reduce((sum, e) => sum + (e.debit || 0), 0)
        const pageCredit = pageEntries.reduce((sum, e) => sum + (e.credit || 0), 0)
        result.push({
          ...voucher,
          pageIndex: page + 1,
          totalPages,
          pageEntries,
          pageDebit,
          pageCredit,
        })
      }
    }
  }

  return result
})

// 加载凭证类型
async function loadVoucherTypes() {
  try {
    const res = await request.get<any[]>('/base/voucher-types')
    voucherTypes.value = res.data || []
  } catch {
    voucherTypes.value = []
  }
}

// 加载打印模版
async function loadTemplates() {
  try {
    const res = await request.get('/base/print-templates', {
      params: { account_set_id: userStore.accountSetId },
    })
    templates.value = ((res.data as PrintTemplate[]) || []).map(normalizePrintTemplate)
    const defaultTpl = templates.value.find((t) => t.is_default)
    if (defaultTpl) {
      selectedTemplateId.value = defaultTpl.id
    } else if (templates.value.length > 0) {
      selectedTemplateId.value = templates.value[0].id
    }
  } catch {
    templates.value = []
  }
}

// 凭证号自动补全：用户输入纯数字时，根据已选凭证类型自动拼接前缀并补零
function formatVoucherNo(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  // 已包含 '-'，认为是完整格式，原样返回
  if (trimmed.includes('-')) return trimmed
  // 纯数字 + 选了唯一凭证类型 → 自动补前缀和补零
  if (/^\d+$/.test(trimmed) && filterForm.value.voucherTypeIds.length === 1) {
    const type = voucherTypes.value.find(t => t.id === filterForm.value.voucherTypeIds[0])
    if (type) {
      const prefix = type.name.charAt(0)
      return `${prefix}-${trimmed.padStart(3, '0')}`
    }
  }
  return trimmed
}

// 查询预览
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

// 打印
async function handlePrint() {
  if (!currentTemplate.value) {
    ElMessage.warning('请选择打印模版')
    return
  }
  if (paginatedDataList.value.length === 0) {
    ElMessage.warning('没有可打印的凭证')
    return
  }

  await nextTick()
  try {
    openPrintWindow({
      itemSelector: '.preview-item',
      title: '批量打印凭证',
      expandSelector: '.preview-area',
    })
  } catch {
    ElMessage.warning('未找到可打印的内容，请稍后重试')
  }
}

// 关闭
function handleClose() {
  visible.value = false
}

// 获取当月日期区间 [yyyy-MM-01, yyyy-MM-末日]
function getCurrentMonthRange(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() // 0-based
  const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDate = new Date(year, month + 1, 0).getDate()
  const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`
  return [firstDay, lastDay]
}

// 对话框打开时初始化
watch(
  () => props.modelValue,
  async (val) => {
    if (val) {
      // 日期区间：优先用外部传入，否则默认当月
      filterForm.value.dateRange = props.defaultDateRange?.length === 2
        ? [...props.defaultDateRange]
        : getCurrentMonthRange()
      // 凭证类型：优先用外部传入
      filterForm.value.voucherTypeIds = props.defaultVoucherTypeIds?.length
        ? [...props.defaultVoucherTypeIds]
        : []
      // 凭证号范围：单类型时设默认 1~999，多类型时不设（避免中文前缀凭证号被排除）
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
      loadTemplates()
      // 加载凭证类型后，若外部未传入则默认选中"记账"类型
      await loadVoucherTypes()
      if (!props.defaultVoucherTypeIds?.length && voucherTypes.value.length > 0) {
        const jizhang = voucherTypes.value.find(t => t.name.includes('记账'))
        if (jizhang) {
          filterForm.value.voucherTypeIds = [jizhang.id]
        }
      }
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.filter-section {
  padding: 0 0 12px;
  border-bottom: 1px solid #e0e0e0;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
}

.result-info {
  color: #606266;
  font-size: 14px;
}

.result-empty {
  color: #909399;
}

.preview-area {
  height: 50vh;
  overflow: auto;
  background-color: #f0f0f0;
  border-radius: 4px;
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  color: #909399;
}

.error-state {
  color: #f56c6c;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.preview-item {
  page-break-after: always;
}

.preview-item:last-child {
  page-break-after: auto;
}

@media print {
  .filter-section,
  .toolbar {
    display: none !important;
  }

  /* 隐藏对话框背景遮罩 */
  :deep(.el-overlay) {
    background: transparent !important;
  }

  /* 隐藏对话框装饰元素 */
  :deep(.el-dialog__header),
  :deep(.el-dialog__headerbtn),
  :deep(.el-dialog__footer),
  :deep(.el-dialog__close) {
    display: none !important;
  }

  /* 对话框本身去掉边距 */
  :deep(.el-dialog) {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
  }

  /* 对话框内容 */
  :deep(.el-dialog__body) {
    padding: 0 !important;
    margin: 0 !important;
  }

  .preview-area {
    height: auto !important;
    overflow: visible !important;
    background-color: #fff !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  .preview-item {
    page-break-after: always;
  }

  .preview-item:last-child {
    page-break-after: auto;
  }
}
</style>

<!-- 全局打印样式：确保 Element Plus teleport 元素也能匹配 -->
<style>
@media print {
  .el-overlay,
  .el-dialog__wrapper {
    background: transparent !important;
  }

  .el-dialog__header,
  .el-dialog__headerbtn,
  .el-dialog__footer,
  .el-dialog__close {
    display: none !important;
  }

  .el-dialog {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
  }

  .el-dialog__body {
    padding: 0 !important;
    margin: 0 !important;
  }
}
</style>
