<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="90%"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="print-dialog-content">
      <!-- 工具栏 -->
      <div class="toolbar">
        <el-select v-model="selectedTemplateId" placeholder="选择打印模版" style="width: 200px">
          <el-option v-for="tpl in templates" :key="tpl.id" :label="tpl.name" :value="tpl.id" />
        </el-select>
        <el-button type="primary" @click="handlePrint">打印</el-button>
        <el-button type="warning" :disabled="!selectedTemplateId" @click="openDesigner"
          >编辑模版</el-button
        >
        <el-button @click="handleClose">取消</el-button>
      </div>

      <!-- 预览区域 -->
      <div class="preview-area">
        <div v-if="loading" class="loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else-if="error" class="error">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ error }}</span>
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
    </div>
  </el-dialog>

  <!-- 模版设计器对话框 -->
  <el-dialog
    v-model="designerVisible"
    title="编辑打印模版"
    width="95%"
    :close-on-click-modal="false"
    destroy-on-close
    append-to-body
  >
    <TemplateDesigner
      v-if="designerVisible"
      :template-id="selectedTemplateId"
      @save="handleTemplateSaved"
      @cancel="designerVisible = false"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import PrintPreview from './PrintPreview.vue'
import TemplateDesigner from './TemplateDesigner.vue'
import type { PrintTemplate, VoucherPrintData } from '@/types/print'
import { getDataRowsPerPage, normalizePrintTemplate, openPrintWindow } from '@/utils/printTemplate'
import request from '@/api/request'
import { useUserStore } from '@/stores/user'

interface Props {
  modelValue: boolean
  voucherIds?: Array<string | number>
  mode?: 'single' | 'batch'
  autoPrint?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'single',
  voucherIds: () => [],
  autoPrint: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val),
})

const dialogTitle = computed(() => {
  if (props.mode === 'batch') {
    return `批量打印凭证（共 ${props.voucherIds.length} 张）`
  }
  return '打印凭证'
})

const loading = ref(false)
const error = ref('')
const templates = ref<PrintTemplate[]>([])
const selectedTemplateId = ref<string>()
const voucherDataList = ref<VoucherPrintData[]>([])
const userStore = useUserStore()

const currentTemplate = computed(() => {
  const tpl = templates.value.find(t => t.id === selectedTemplateId.value)
  return tpl ? normalizePrintTemplate(tpl) : undefined
})

// 将凭证数据按模版行数分页展开
const paginatedDataList = computed<VoucherPrintData[]>(() => {
  const tpl = currentTemplate.value
  if (!tpl || voucherDataList.value.length === 0) return []

  const rowsPerPage = getDataRowsPerPage(tpl)
  const result: VoucherPrintData[] = []

  for (const voucher of voucherDataList.value) {
    const entries = voucher.entries || []
    if (entries.length <= rowsPerPage) {
      // 不需要分页，单页即可
      result.push({
        ...voucher,
        pageIndex: 1,
        totalPages: 1,
        pageEntries: entries,
        pageDebit: voucher.total_debit,
        pageCredit: voucher.total_credit,
      })
    } else {
      // 需要分页
      const totalPages = Math.ceil(entries.length / rowsPerPage)
      for (let page = 0; page < totalPages; page++) {
        const start = page * rowsPerPage
        const pageEntries = entries.slice(start, start + rowsPerPage)
        // 当前页小计
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

// 加载打印模版列表
const loadTemplates = async () => {
  try {
    const response = await request.get('/base/print-templates', {
      params: { account_set_id: userStore.accountSetId },
    })

    templates.value = ((response.data as PrintTemplate[]) || []).map(normalizePrintTemplate)

    // 选择默认模版
    const defaultTemplate = templates.value.find(t => t.is_default)
    if (defaultTemplate) {
      selectedTemplateId.value = defaultTemplate.id
    } else if (templates.value.length > 0) {
      selectedTemplateId.value = templates.value[0].id
    }
  } catch (err: any) {
    console.error('加载模版失败:', err)
    error.value = err.response?.data?.message || err.message || '加载模版失败'
  }
}

// 加载凭证打印数据
const loadVoucherData = async () => {
  if (props.voucherIds.length === 0) {
    return
  }

  loading.value = true
  error.value = ''

  try {
    if (props.mode === 'single' && props.voucherIds.length === 1) {
      // 单张打印
      const response = await request.get(`/voucher/print-data/${props.voucherIds[0]}`)
      voucherDataList.value = [response.data as VoucherPrintData]
    } else {
      // 批量打印
      const response = await request.post('/voucher/print-data/batch', {
        voucher_ids: props.voucherIds,
      })
      voucherDataList.value = (response.data as VoucherPrintData[]) || []
    }
  } catch (err: any) {
    error.value = err.response?.data?.message || err.message || '加载凭证数据失败'
    voucherDataList.value = []
  } finally {
    loading.value = false
  }
}

// 打印
const handlePrint = async () => {
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
      itemSelector: '.print-dialog-content .preview-item',
      title: '打印凭证',
      expandSelector: '.print-dialog-content .preview-area',
    })
  } catch {
    ElMessage.warning('未找到可打印的内容，请稍后重试')
  }
}

// 关闭对话框
const handleClose = () => {
  visible.value = false
}

// 模版设计器
const designerVisible = ref(false)

const openDesigner = () => {
  if (!selectedTemplateId.value) {
    ElMessage.warning('请先选择模版')
    return
  }
  designerVisible.value = true
}

const handleTemplateSaved = async () => {
  designerVisible.value = false
  await loadTemplates()
  ElMessage.success('模版已更新')
}

// 监听对话框打开
watch(
  () => props.modelValue,
  async val => {
    if (val) {
      await loadTemplates()
      await loadVoucherData()
      if (props.autoPrint) {
        await nextTick()
        handlePrint()
        visible.value = false
      }
    } else {
      voucherDataList.value = []
      error.value = ''
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.print-dialog-content {
  display: flex;
  flex-direction: column;
  height: 70vh;
}

.toolbar {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid #e0e0e0;
  background-color: #f5f5f5;
}

.preview-area {
  flex: 1;
  overflow: auto;
  padding: 20px;
  background-color: #f0f0f0;
}

.loading,
.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 10px;
  color: #666;
}

.error {
  color: #f56c6c;
}

.preview-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.preview-item {
  page-break-after: always;
}

.preview-item:last-child {
  page-break-after: auto;
}

@media print {
  /* 隐藏整个对话框容器，只显示内容 */
  :deep(.el-overlay),
  :deep(.el-dialog__wrapper) {
    background: transparent !important;
  }

  /* 隐藏对话框的所有装饰元素 */
  :deep(.el-dialog__header),
  :deep(.el-dialog__headerbtn),
  :deep(.el-dialog__footer),
  :deep(.el-dialog__close) {
    display: none !important;
  }

  /* 对话框本身去除所有边框、阴影、边距 */
  :deep(.el-dialog) {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: 100% !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
  }

  /* 对话框内容区域 */
  :deep(.el-dialog__body) {
    padding: 0 !important;
    margin: 0 !important;
  }

  /* 打印对话框内容容器 */
  .print-dialog-content {
    height: auto !important;
    border: none !important;
  }

  /* 隐藏工具栏 */
  .toolbar {
    display: none !important;
  }

  /* 预览区域 */
  .preview-area {
    padding: 0 !important;
    margin: 0 !important;
    background-color: #fff !important;
    overflow: visible !important;
  }

  /* 分页设置 */
  .preview-item {
    page-break-after: always;
  }

  .preview-item:last-child {
    page-break-after: auto;
  }
}
</style>

<!-- 全局打印样式（非 scoped，确保 Element Plus teleport 元素也能匹配） -->
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
