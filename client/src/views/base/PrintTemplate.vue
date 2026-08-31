<template>
  <div class="print-template-page">
    <div class="page-header">
      <h2>打印模版管理</h2>
      <div class="header-actions">
        <el-button @click="handleCreate">新增凭证模版（旧）</el-button>
        <el-button type="primary" @click="handleCreateHiprint">新增套打模板</el-button>
      </div>
    </div>
    

    <div class="page-content">
      <el-table
        ref="tableRef"
        :data="templates"
        border
        stripe
        height="100%"
        class="compact-data-table"
        v-loading="loading"
        @header-dragend="onDragEnd"
      >
        <el-table-column prop="name" label="模版名称" :width="colWidth('name', 200)" />
        <el-table-column prop="template_type" label="类型" :width="colWidth('类型', 90)" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="templateTypeTag(row)">{{ templateTypeLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="paper_size" label="纸张规格" :width="colWidth('paper_size', 120)">
          <template #default="{ row }">
            {{ getPaperSizeLabel(row.paper_size) }}
          </template>
        </el-table-column>
        <el-table-column column-key="纸张尺寸" label="纸张尺寸" :width="colWidth('纸张尺寸', 150)">
          <template #default="{ row }">
            {{ row.paper_width }}mm × {{ row.paper_height }}mm
          </template>
        </el-table-column>
        <el-table-column column-key="页边距" label="页边距" :width="colWidth('页边距', 200)">
          <template #default="{ row }">
            上{{ row.margin_top }}mm 下{{ row.margin_bottom }}mm 左{{ row.margin_left }}mm 右{{
              row.margin_right
            }}mm
          </template>
        </el-table-column>
        <el-table-column prop="is_default" label="默认模版" :width="colWidth('is_default', 100)" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_default" type="success">是</el-tag>
            <el-tag v-else type="info">否</el-tag>
          </template>
        </el-table-column>
        <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 220)" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button
              v-if="!row.is_default"
              type="success"
              size="small"
              @click="handleSetDefault(row)"
            >
              设为默认
            </el-button>
            <el-button v-else type="info" size="small" disabled>当前默认</el-button>
            <el-button
              v-if="!row.is_default"
              type="danger"
              size="small"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 设计器对话框 -->
    <el-dialog
      v-model="designerVisible"
      :title="editingTemplate ? '编辑模版' : '新增模版'"
      width="95%"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-if="editingTemplate && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <TemplateDesigner
        :template-id="editingTemplate?.id"
        @save="handleSaveTemplate"
        @cancel="designerVisible = false"
      />
    </el-dialog>

    <!-- 新 hiprint 套打设计器 -->
    <el-dialog
      v-model="hiprintDesignerVisible"
      :title="editingTemplate ? '编辑套打模板' : '新增套打模板'"
      width="95%"
      top="3vh"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <HiprintDesigner
        :template-id="editingTemplate?.id"
        :default-type="newTemplateType"
        @save="handleSaveTemplate"
        @cancel="hiprintDesignerVisible = false"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { PrintTemplate } from '@/types/print'
import { useUserStore } from '@/stores/user'
import request from '@/api/request'
import TemplateDesigner from '@/components/print/TemplateDesigner.vue'
import HiprintDesigner from '@/components/print/HiprintDesigner.vue'
import type { PrintTemplateType } from '@/types/print'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('base_print_template')
const userStore = useUserStore()
const loading = ref(false)
const templates = ref<PrintTemplate[]>([])
const designerVisible = ref(false)
const hiprintDesignerVisible = ref(false)
const newTemplateType = ref<PrintTemplateType>('voucher')
const editingTemplate = ref<PrintTemplate | null>(null)

const TYPE_LABELS: Record<string, string> = { voucher: '凭证', ledger: '账册', report: '报表' }
const templateTypeLabel = (row: PrintTemplate) => TYPE_LABELS[row.template_type || 'voucher'] || '凭证'
const templateTypeTag = (row: PrintTemplate) => {
  const t = row.template_type || 'voucher'
  return t === 'report' ? 'success' : t === 'ledger' ? 'warning' : 'primary'
}
/** 是否 hiprint 套打模板（有 panel.panels） */
const isHiprintTemplate = (row: PrintTemplate) =>
  !!(row.panel && Array.isArray((row.panel as any).panels) && (row.panel as any).panels.length > 0)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  if (templates.value.length === 0 || !editingTemplate.value) return null
  const idx = templates.value.findIndex(t => t.id === editingTemplate.value?.id)
  return {
    current: idx + 1,
    total: templates.value.length,
    isFirst: idx <= 0,
    isLast: idx >= templates.value.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  if (templates.value.length === 0) return
  
  let targetIdx = 0
  const currentIdx = templates.value.findIndex(t => t.id === editingTemplate.value?.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = templates.value.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(templates.value.length - 1, currentIdx + 1)
  
  if (templates.value[targetIdx]) {
    handleEdit(templates.value[targetIdx])
  }
}

// 获取纸张规格标签
const getPaperSizeLabel = (size: string) => {
  const labels: Record<string, string> = {
    custom: '自定义',
    a4: 'A4',
    a5: 'A5',
  }
  return labels[size] || size
}

// 加载模版列表
const loadTemplates = async () => {
  loading.value = true
  try {
    if (!userStore.accountSetId) {
      ElMessage.error('未选择账套')
      return
    }

    const response = await request.get<PrintTemplate[]>('/base/print-templates', {
      params: { account_set_id: userStore.accountSetId },
    } as any)

    templates.value = response.data || []
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载模版列表失败')
  } finally {
    loading.value = false
  }
}

// 设置默认模版
const handleSetDefault = async (template: PrintTemplate) => {
  try {
    await ElMessageBox.confirm(`确定将"${template.name}"设为默认打印模版吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await request.post(`/base/print-templates/default/${template.id}`)

    ElMessage.success('设置成功')
    await loadTemplates()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '设置失败')
    }
  }
}

// 新增旧版凭证模版
const handleCreate = () => {
  editingTemplate.value = null
  designerVisible.value = true
}

// 新增 hiprint 套打模板
const handleCreateHiprint = () => {
  editingTemplate.value = null
  newTemplateType.value = 'voucher'
  hiprintDesignerVisible.value = true
}

// 编辑模版：hiprint 模板走新设计器，旧模板走旧设计器
const handleEdit = (template: PrintTemplate) => {
  editingTemplate.value = template
  if (isHiprintTemplate(template)) {
    hiprintDesignerVisible.value = true
  } else {
    designerVisible.value = true
  }
}

// 保存模版
const handleSaveTemplate = async () => {
  designerVisible.value = false
  hiprintDesignerVisible.value = false
  await loadTemplates()
}

// 删除模版
const handleDelete = async (template: PrintTemplate) => {
  try {
    await ElMessageBox.confirm(`确定删除模版"${template.name}"吗？`, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await request.delete(`/base/print-templates/${template.id}`)

    ElMessage.success('删除成功')
    await loadTemplates()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

onMounted(() => {
  loadTemplates()
})
</script>

<style scoped>
.print-template-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.page-content {
  flex: 1;
  min-height: 0;
  padding: 20px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
