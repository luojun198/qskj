<template>
  <div :class="['voucher-attachments', { 'is-compact': compact }]">
    <template v-if="compact">
      <div class="compact-attachments-row">
        <el-button
          v-if="canUpload"
          size="small"
          @click="triggerFileInput"
        >
          <el-icon><Upload /></el-icon>
          上传附件
        </el-button>
        <div class="compact-file-list">
          <span class="empty-text" v-if="attachments.length === 0">暂无附件</span>
          <el-tag
            v-for="file in attachments"
            :key="file.id"
            type="info"
            :closable="canDelete(file)"
            @close="deleteAttachment(file)"
            @click="!hidePreview && previewFile(file)"
            :class="{ 'clickable-tag': !hidePreview }"
          >
            <el-icon style="vertical-align: middle; margin-right: 4px;"><Document /></el-icon>
            <span style="vertical-align: middle;" :title="file.original_name">{{ file.original_name }}</span>
          </el-tag>
        </div>
      </div>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="*"
        @change="handleFileUpload"
        style="display: none"
      />
    </template>

    <template v-else>
      <div class="attachment-header">
        <span class="attachment-title">
          <el-icon><Document /></el-icon>
          {{ title }}
          <span class="attachment-count">({{ attachments.length }})</span>
        </span>
        <el-button
          v-if="canUpload"
          type="primary"
          size="small"
          @click="triggerFileInput"
        >
          <el-icon><Upload /></el-icon>
          上传附件
        </el-button>
      </div>

      <input
        ref="fileInput"
        type="file"
        multiple
        accept="*"
        @change="handleFileUpload"
        style="display: none"
      />

      <div v-if="attachments.length > 0" class="attachment-list">
        <div
          v-for="file in attachments"
          :key="file.id"
          class="attachment-item"
        >
          <div class="attachment-info">
            <el-icon :class="getFileIcon(file.mime_type)">
              <Document />
            </el-icon>
            <div class="attachment-details">
              <div class="attachment-name">{{ file.original_name }}</div>
              <div class="attachment-meta">
                <span>{{ formatFileSize(file.file_size) }}</span>
                <span class="attachment-date">{{ formatDate(file.created_at) }}</span>
                <span v-if="file.created_by">{{ file.created_by }}</span>
              </div>
            </div>
          </div>
          <div class="attachment-actions">
            <el-button
              v-if="!hidePreview"
              link
              type="primary"
              @click="previewFile(file)"
              :previewing="previewing === file.id"
            >
              <el-icon><View /></el-icon>
              预览
            </el-button>
            <el-button
              v-if="canDelete(file)"
              link
              type="danger"
              @click="deleteAttachment(file)"
              :loading="deleting === file.id"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </div>
        </div>
      </div>

      <div v-else class="empty-attachments">
        <el-empty description="暂无附件" />
      </div>
    </template>

    <!-- 文件预览对话框 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewAttachment?.original_name"
      width="80%"
      :before-close="closePreview"
    >
      <div v-if="previewing" class="preview-loading">
        <el-skeleton :rows="5" animated />
      </div>
      <div v-else class="preview-content">
        <template v-if="isImage(previewAttachment?.mime_type)">
          <img
            :src="previewAttachment?.file_path"
            style="max-width: 100%; max-height: 600px"
            @error="handlePreviewError"
          />
        </template>
        <template v-else-if="isText(previewAttachment?.mime_type)">
          <pre style="white-space: pre-wrap; max-height: 500px; overflow: auto">{{ previewContent }}</pre>
        </template>
        <template v-else-if="isExcel(previewAttachment?.mime_type, previewAttachment?.original_name)">
          <div class="excel-preview-container" v-html="previewContent"></div>
        </template>
        <template v-else-if="isPdf(previewAttachment?.mime_type)">
          <iframe
            :src="previewAttachment?.file_path"
            style="width: 100%; height: 600px"
            @load="handlePreviewLoaded"
            @error="handlePreviewError"
          />
        </template>
        <template v-else>
          <div class="preview-unsupported">
            <el-icon><Document /></el-icon>
            <h3>不支持预览的文件类型</h3>
            <p>{{ previewAttachment?.mime_type }}</p>
            <el-button type="primary" @click="previewAttachment && downloadFile(previewAttachment)">
              下载文件
            </el-button>
          </div>
        </template>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="closePreview">关闭</el-button>
          <el-button type="primary" @click="previewAttachment && downloadFile(previewAttachment)">
            下载
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 文件预览进度条 -->
    <el-progress
      v-if="previewProgress > 0 && previewProgress < 100"
      :percentage="previewProgress"
      :show-text="false"
      :stroke-width="2"
      class="preview-progress"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Document, Upload, View, Delete, Download } from '@element-plus/icons-vue'
import { showError } from '@/composables/useMessage'

interface Attachment {
  id: string
  filename: string
  original_name: string
  file_path: string
  file_size: number
  mime_type: string
  created_by?: string
  created_at: string
}

interface Props {
  voucherId: string
  attachments: Attachment[]
  title?: string
  canUpload?: boolean
  canDelete?: (attachment: Attachment) => boolean
  compact?: boolean
  hidePreview?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '凭证附件',
  canUpload: true,
  canDelete: () => true,
  compact: false,
  hidePreview: false,
})

const emit = defineEmits<{
  'upload': [files: File[]]
  'delete': [attachment: Attachment]
  'download': [attachment: Attachment]
}>()

const fileInput = ref<HTMLInputElement>()
const previewVisible = ref(false)
const previewing = ref<string | null>(null)
const previewAttachment = ref<Attachment | null>(null)
const previewContent = ref('')
const previewProgress = ref(0)
const deleting = ref<string | null>(null)

// 文件图标
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'file-icon image-icon'
  if (mimeType.includes('pdf')) return 'file-icon pdf-icon'
  if (mimeType.includes('word') || mimeType.includes('document')) return 'file-icon word-icon'
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'file-icon excel-icon'
  if (mimeType.includes('powerpoint')) return 'file-icon ppt-icon'
  if (mimeType.includes('text')) return 'file-icon text-icon'
  return 'file-icon'
}

// 文件类型判断
function isImage(mimeType?: string): boolean {
  return mimeType?.startsWith('image/') || false
}

function isText(mimeType?: string): boolean {
  return mimeType?.startsWith('text/') || mimeType?.includes('json') || false
}

function isPdf(mimeType?: string): boolean {
  return mimeType?.includes('pdf') || false
}

function isExcel(mimeType?: string, filename?: string): boolean {
  return mimeType?.includes('excel') || 
         mimeType?.includes('spreadsheet') || 
         filename?.endsWith('.xlsx') || 
         filename?.endsWith('.xls') || false
}

function isWord(mimeType?: string, filename?: string): boolean {
  return mimeType?.includes('word') || 
         mimeType?.includes('officedocument.wordprocessingml.document') || 
         filename?.endsWith('.docx') || 
         filename?.endsWith('.doc') || false
}

// 触发文件选择
function triggerFileInput() {
  fileInput.value?.click()
}

// 处理文件上传
function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])

  if (files.length === 0) return

  emit('upload', files)
  target.value = '' // 清空input，允许重复上传相同文件
}

// 预览文件
async function previewFile(file: Attachment) {
  if (previewing.value) return

  previewing.value = file.id
  previewVisible.value = true
  previewAttachment.value = file
  previewContent.value = ''

  try {
    if (isText(file.mime_type)) {
      const response = await fetch(file.file_path)
      if (response.ok) {
        previewContent.value = await response.text()
      } else {
        showError('文件读取失败')
      }
    } else if (isExcel(file.mime_type, file.original_name)) {
      const XLSX = await import('xlsx')
      const response = await fetch(file.file_path)
      const arrayBuffer = await response.arrayBuffer()
      const data = new Uint8Array(arrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      // 转换为HTML，并添加一些基础样式
      previewContent.value = XLSX.utils.sheet_to_html(worksheet, { editable: false })
    }
  } catch (error) {
    console.error('Preview error:', error)
    showError('文件预览生成失败')
  }

  previewing.value = null
}

// 处理预览错误
function handlePreviewError() {
  showError('文件加载失败，请尝试下载')
  closePreview()
}

// 处理预览加载完成
function handlePreviewLoaded() {
  // PDF加载完成
}

// 关闭预览
function closePreview() {
  previewVisible.value = false
  previewAttachment.value = null
  previewContent.value = ''
}

// 下载文件
function downloadFile(file: Attachment) {
  emit('download', file)

  // 创建下载链接
  const link = document.createElement('a')
  link.href = file.file_path
  link.download = file.original_name
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 删除附件
async function deleteAttachment(file: Attachment) {
  if (!props.canDelete(file)) return

  try {
    await ElMessageBox.confirm(
      `确定要删除附件 "${file.original_name}" 吗？`,
      '确认删除',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      }
    )

    deleting.value = file.id
    emit('delete', file)
  } catch {
    // 用户取消删除
  } finally {
    deleting.value = null
  }
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 格式化日期
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<style scoped>
.voucher-attachments.is-compact {
  margin-top: 0;
  border: none;
  background: transparent;
}

.compact-attachments-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.compact-file-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.compact-file-list .empty-text {
  font-size: 13px;
  color: #c0c4cc;
}

.compact-file-list .el-tag {
  max-width: 200px;
}

.compact-file-list .el-tag span {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clickable-tag {
  cursor: pointer;
}
.clickable-tag:hover {
  opacity: 0.8;
}

.voucher-attachments:not(.is-compact) {
  margin-top: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fff;
}

.attachment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
}

.attachment-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #303133;
}

.attachment-count {
  color: #909399;
  font-size: 14px;
  font-weight: normal;
}

.attachment-list {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.attachment-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  margin-bottom: 8px;
  transition: all 0.3s;
}

.attachment-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.attachment-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.file-icon {
  font-size: 24px;
}

.image-icon {
  color: #409eff;
}

.pdf-icon {
  color: #f56c6c;
}

.word-icon {
  color: #409eff;
}

.excel-icon {
  color: #67c23a;
}

.ppt-icon {
  color: #e6a23c;
}

.text-icon {
  color: #909399;
}

.attachment-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.attachment-name {
  font-weight: 500;
  color: #303133;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #909399;
}

.attachment-actions {
  display: flex;
  gap: 8px;
}

.empty-attachments {
  padding: 32px;
  text-align: center;
}

.preview-loading {
  padding: 20px;
}

.preview-content {
  text-align: center;
}

.preview-unsupported {
  text-align: center;
  padding: 40px;
}

.preview-unsupported .el-icon {
  font-size: 64px;
  color: #c0c4cc;
  margin-bottom: 16px;
}

.preview-unsupported h3 {
  color: #606266;
  margin: 16px 0;
}

.preview-unsupported p {
  color: #909399;
  margin-bottom: 24px;
}

.preview-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
}

.excel-preview-container {
  max-height: 600px;
  overflow: auto;
  background: #fff;
  padding: 10px;
}
.excel-preview-container :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0 auto;
}
.excel-preview-container :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 4px 8px;
  font-size: 13px;
  min-width: 60px;
}
.excel-preview-container :deep(tr:nth-child(even)) {
  background-color: #fafafa;
}
:deep(.el-empty) {
  color: #c0c4cc;
}
</style>
