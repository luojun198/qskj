<template>
  <div class="page scm-item-type-page">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增属性</el-button>
    </div>
    <el-table
      ref="tableRef"
      :data="tableData"
      v-loading="loading"
      border stripe size="small"
      class="item-table"
      height="100%"
      @header-dragend="onDragEnd"
    >
      <el-table-column label="编码" prop="key" :width="cw('key', 120)" />
      <el-table-column label="名称" prop="name" min-width="200" :width="widths.name" />
      <el-table-column label="来源" column-key="source" :width="cw('source', 120)">
        <template #default="{ row }">
          <el-tag :type="row.isSystem ? 'info' : 'success'" size="small">
            {{ row.isSystem ? '系统预设' : '用户定义' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" column-key="操作" :width="cw('操作', 150)" fixed="right">
        <template #default="{ row }">
          <el-button v-if="!row.isSystem" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="!row.isSystem" link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          <span v-else style="color: #999; font-size: 12px">系统属性不可改</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editKey ? '编辑属性' : '新增属性'"
      width="400px"
      draggable
    >
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="请输入属性名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { scmApi, ITEM_TYPES } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_item_type')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editKey = ref<string | null>(null)
const customItemTypes = ref<Record<string, string>>({})
const form = ref({ name: '' })

const tableData = computed(() => {
  const list: any[] = []
  // 系统预设
  Object.entries(ITEM_TYPES).forEach(([k, v]) => {
    list.push({ key: k, name: v, isSystem: true })
  })
  // 用户定义
  Object.entries(customItemTypes.value).forEach(([k, v]) => {
    list.push({ key: k, name: v, isSystem: false })
  })
  return list.sort((a, b) => Number(a.key) - Number(b.key))
})

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getParams()
    const p = r.data.find(i => i.param_key === 'scm:item_types')
    if (p && p.param_value) {
      try { customItemTypes.value = JSON.parse(p.param_value) } catch { customItemTypes.value = {} }
    } else {
      customItemTypes.value = {}
    }
  } catch (err: any) {
    ElMessage.error('加载属性失败：' + err.message)
  } finally {
    loading.value = false
  }
}

function openAdd() {
  editKey.value = null
  form.value = { name: '' }
  dialogVisible.value = true
}

function openEdit(row: any) {
  editKey.value = row.key
  form.value = { name: row.name }
  dialogVisible.value = true
}

async function handleSave() {
  const name = form.value.name.trim()
  if (!name) return ElMessage.warning('请输入名称')

  // 检查重复
  const allNames = tableData.value
    .filter(i => i.key !== editKey.value)
    .map(i => i.name)
  if (allNames.includes(name)) return ElMessage.warning('名称已存在')

  saving.value = true
  try {
    let newTypes = { ...customItemTypes.value }
    if (editKey.value) {
      newTypes[editKey.value] = name
    } else {
      const nextKey = String(Math.max(10, ...Object.keys({ ...ITEM_TYPES, ...customItemTypes.value }).map(Number).filter(n => !isNaN(n))) + 1)
      newTypes[nextKey] = name
    }

    await scmApi.saveParams([{ param_key: 'scm:item_types', param_value: JSON.stringify(newTypes) }])
    customItemTypes.value = newTypes
    ElMessage.success('保存成功')
    dialogVisible.value = false
  } catch (err: any) {
    ElMessage.error('保存失败：' + err.message)
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: any) {
  await ElMessageBox.confirm(`确认删除属性「${row.name}」？已使用该属性的物料档案将保留其原始值。`, '提示', { type: 'warning' })
  
  loading.value = true
  try {
    let newTypes = { ...customItemTypes.value }
    delete newTypes[row.key]
    await scmApi.saveParams([{ param_key: 'scm:item_types', param_value: JSON.stringify(newTypes) }])
    customItemTypes.value = newTypes
    ElMessage.success('已删除')
  } catch (err: any) {
    ElMessage.error('删除失败：' + err.message)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page {
  height: calc(100vh - 60px);
  padding: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.item-title h3 { margin: 0; font-size: 18px; }
.item-title span { font-size: 12px; color: #999; }
.item-table { flex: 1; min-height: 0; border-radius: 4px; }
</style>
