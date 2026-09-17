<template>
  <div class="page">
    <div class="page-header">
      <h3>快捷键维护</h3>
      <div class="page-header-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索模块、快捷键、功能..."
          clearable
          style="width: 280px"
          @input="handleSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="warning" @click="handleReset">
          <el-icon><RefreshLeft /></el-icon>
          重置为默认
        </el-button>
      </div>
    </div>
    <el-table
      ref="tableRef"
      :data="filteredShortcuts"
      border
      stripe
      height="100%"
      class="compact-data-table"
      style="width: 100%"
      v-loading="loading"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="module" label="模块" :width="colWidth('module', 150)" />
      <el-table-column prop="action" label="操作" :width="colWidth('action', 120)" />
      <el-table-column column-key="快捷键" label="快捷键" :width="colWidth('快捷键', 180)">
        <template #default="{ row }">
          <el-tag type="primary" size="large">{{ formatShortcut(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="功能说明" :width="colWidth('description', 200)" />
      <el-table-column column-key="状态" label="状态" :width="colWidth('状态', 100)" align="center">
        <template #default="{ row }">
          <el-switch
            v-model="row.is_enabled"
            @change="handleToggleEnabled(row)"
            active-text="启用"
            inactive-text="禁用"
          />
        </template>
      </el-table-column>
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 100)" align="center">
        <template #default="{ row }">
          <el-button type="primary" link @click="handleEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑快捷键"
      width="500px"
      @close="handleDialogClose"
    >
      <div v-if="editForm.id && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="模块">
          <el-input v-model="editForm.module" disabled />
        </el-form-item>
        <el-form-item label="操作">
          <el-input v-model="editForm.action" disabled />
        </el-form-item>
        <el-form-item label="按键" required>
          <el-input
            v-model="editForm.key"
            placeholder="请输入按键（如 s, Escape, Delete）"
            @keydown="(e: Event) => handleKeyCapture(e as KeyboardEvent)"
          >
            <template #append>
              <el-button @click="captureMode = !captureMode">
                {{ captureMode ? '停止录制' : '录制按键' }}
              </el-button>
            </template>
          </el-input>
          <div style="margin-top: 8px; font-size: 12px; color: #909399">
            {{ captureMode ? '请按下要设置的按键...' : '常用按键：s, n, r, f, e, d, Escape, Delete, Space' }}
          </div>
        </el-form-item>
        <el-form-item label="修饰键">
          <el-checkbox v-model="editForm.ctrl">Ctrl</el-checkbox>
          <el-checkbox v-model="editForm.alt" style="margin-left: 20px">Alt</el-checkbox>
          <el-checkbox v-model="editForm.shift" style="margin-left: 20px">Shift</el-checkbox>
        </el-form-item>
        <el-form-item label="预览">
          <el-tag type="primary" size="large">{{ formatShortcut(editForm) }}</el-tag>
        </el-form-item>
        <el-form-item label="功能说明">
          <el-input
            v-model="editForm.description"
            type="textarea"
            :rows="3"
            placeholder="请输入功能说明"
          />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="editForm.is_enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, RefreshLeft } from '@element-plus/icons-vue'
import {
  getKeyboardShortcuts,
  updateKeyboardShortcut,
  resetKeyboardShortcuts,
} from '@/api/keyboardShortcuts'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('base_keyboard_shortcuts')

interface KeyboardShortcut {
  id: number
  module: string
  action: string
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  description: string
  component_path: string
  is_enabled: boolean
  is_custom: boolean
}

const loading = ref(false)
const shortcuts = ref<KeyboardShortcut[]>([])

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = filteredShortcuts.value
  if (allRows.length === 0 || !editForm.value.id) return null
  const idx = allRows.findIndex(r => r.id === editForm.value.id)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = filteredShortcuts.value
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex(r => r.id === editForm.value.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    handleEdit(allRows[targetIdx])
  }
}

const searchKeyword = ref('')
const editDialogVisible = ref(false)
const saving = ref(false)
const captureMode = ref(false)

const editForm = ref<Partial<KeyboardShortcut>>({
  id: 0,
  module: '',
  action: '',
  key: '',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  description: '',
  is_enabled: true,
})

// 格式化快捷键显示
function formatShortcut(shortcut: any) {
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift) parts.push('Shift')

  // 特殊按键显示名称映射
  const keyMap: Record<string, string> = {
    'Escape': 'Esc',
    'Delete': 'Del',
    ' ': 'Space',
  }
  const displayKey = keyMap[shortcut.key] || shortcut.key.toUpperCase()
  parts.push(displayKey)

  return parts.join('+')
}

// 过滤快捷键列表
const filteredShortcuts = computed(() => {
  if (!searchKeyword.value) return shortcuts.value

  const keyword = searchKeyword.value.toLowerCase()
  return shortcuts.value.filter(
    (s) =>
      s.module.toLowerCase().includes(keyword) ||
      s.action.toLowerCase().includes(keyword) ||
      s.description.toLowerCase().includes(keyword) ||
      formatShortcut(s).toLowerCase().includes(keyword)
  )
})

// 获取快捷键列表
async function fetchShortcuts() {
  loading.value = true
  try {
    const res = await getKeyboardShortcuts()
    shortcuts.value = (res.data as KeyboardShortcut[]) || []
  } catch (error: any) {
    ElMessage.error(error.message || '获取快捷键列表失败')
  } finally {
    loading.value = false
  }
}

// 搜索
function handleSearch() {
  // 实时过滤，无需额外操作
}

// 编辑
function handleEdit(row: KeyboardShortcut) {
  editForm.value = {
    id: row.id,
    module: row.module,
    action: row.action,
    key: row.key,
    ctrl: row.ctrl,
    alt: row.alt,
    shift: row.shift,
    meta: row.meta,
    description: row.description,
    is_enabled: row.is_enabled,
  }
  editDialogVisible.value = true
  captureMode.value = false
}

// 按键捕获
function handleKeyCapture(event: KeyboardEvent) {
  if (!captureMode.value) return

  event.preventDefault()
  event.stopPropagation()

  // 忽略单独的修饰键
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    return
  }

  editForm.value.key = event.key
  editForm.value.ctrl = event.ctrlKey || event.metaKey
  editForm.value.alt = event.altKey
  editForm.value.shift = event.shiftKey

  captureMode.value = false
}

// 检查冲突
function checkConflict() {
  const { id, module, key, ctrl, alt, shift } = editForm.value
  return shortcuts.value.some(
    (s) =>
      s.id !== id &&
      s.module === module &&
      s.key === key &&
      s.ctrl === ctrl &&
      s.alt === alt &&
      s.shift === shift &&
      s.is_enabled
  )
}

// 保存
async function handleSave() {
  if (!editForm.value.key || editForm.value.key.trim() === '') {
    ElMessage.warning('请输入按键')
    return
  }

  // 检查冲突
  if (checkConflict()) {
    ElMessage.warning('该模块内已存在相同的快捷键组合，请修改后重试')
    return
  }

  saving.value = true
  try {
    await updateKeyboardShortcut(editForm.value.id!, {
      key: editForm.value.key,
      ctrl: editForm.value.ctrl,
      alt: editForm.value.alt,
      shift: editForm.value.shift,
      meta: editForm.value.meta,
      description: editForm.value.description,
      is_enabled: editForm.value.is_enabled,
    })

    ElMessage.success('快捷键配置已更新，请刷新页面使其生效')
    editDialogVisible.value = false
    await fetchShortcuts()
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// 切换启用状态
async function handleToggleEnabled(row: KeyboardShortcut) {
  try {
    await updateKeyboardShortcut(row.id, {
      key: row.key,
      ctrl: row.ctrl,
      alt: row.alt,
      shift: row.shift,
      meta: row.meta,
      description: row.description,
      is_enabled: row.is_enabled,
    })
    ElMessage.success('状态已更新')
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败')
    // 恢复状态
    row.is_enabled = !row.is_enabled
  }
}

// 重置为默认配置
async function handleReset() {
  try {
    await ElMessageBox.confirm(
      '确定要重置所有快捷键为默认配置吗？此操作不可恢复。',
      '重置确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    loading.value = true
    await resetKeyboardShortcuts()
    ElMessage.success('快捷键配置已重置为默认值')
    await fetchShortcuts()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '重置失败')
    }
  } finally {
    loading.value = false
  }
}

// 对话框关闭
function handleDialogClose() {
  captureMode.value = false
}

onMounted(() => {
  fetchShortcuts()
})
</script>

<style scoped>
.page {
  padding: 16px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
  font-size: var(--cw-text-lg);
  font-weight: 600;
}

.page-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
