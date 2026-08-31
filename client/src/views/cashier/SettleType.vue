<template>
  <div class="page page-settle-type">
    

    <div class="page-body">
      <div class="toolbar">
        <el-button type="primary" size="small" @click="openAdd">
          <el-icon><Plus /></el-icon> 新增项目
        </el-button>
        <el-button type="warning" size="small" :loading="initializing" @click="handleInit">
          一键预设通用项目
        </el-button>
      </div>

      <el-table
        ref="tableRef"
        :data="settleTypes"
        size="small"
        border
        style="width: 100%; margin-bottom: 16px;"
        maxHeight="calc(100vh - 220px)"
        @header-dragend="onDragEnd"
      >
        <el-table-column prop="code" label="编码" :width="cw('code', 120)" />
        <el-table-column prop="name" label="名称" :width="cw('name', 200)" />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 150)" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editId ? '编辑结算方式' : '新增结算方式'" width="400px" draggable>
      <div v-if="editId && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="80px" size="small">
        <el-form-item label="编码" required>
          <el-input v-model="form.code" :disabled="!!editId" placeholder="如 01" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如 现金" />
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
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { cashierApi, type SettleType } from '@/api/cashier'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, colWidth, onDragEnd } = useListColumnWidth('cashier_settle_type')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const settleTypes = ref<SettleType[]>([])
const dialogVisible = ref(false)
const editId = ref<string | null>(null)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = settleTypes.value
  if (allRows.length === 0 || !editId.value) return null
  const idx = allRows.findIndex(r => r.id === editId.value)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = settleTypes.value
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex(r => r.id === editId.value)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    openEdit(allRows[targetIdx])
  }
}

const saving = ref(false)
const initializing = ref(false)
const form = ref({ code: '', name: '' })

onMounted(loadData)

async function loadData() {
  const res = await cashierApi.getSettleTypes()
  if (res.code === 0) settleTypes.value = res.data
}

function generateNextCode() {
  if (settleTypes.value.length === 0) return '01'
  const codes = settleTypes.value.map(s => parseInt(s.code, 10)).filter(n => !isNaN(n))
  if (codes.length === 0) return '01'
  const max = Math.max(...codes)
  return String(max + 1).padStart(2, '0')
}

function openAdd() {
  editId.value = null
  form.value = { code: generateNextCode(), name: '' }
  dialogVisible.value = true
}

function openEdit(row: any) {
  editId.value = row.id
  form.value = { code: row.code, name: row.name }
  dialogVisible.value = true
}

async function handleDelete(row: any) {
  await ElMessageBox.confirm(`确认删除结算方式「${row.name}」？`, '提示', { type: 'warning' })
  await cashierApi.deleteSettleType(row.id)
  ElMessage.success('已删除')
  loadData()
}

async function handleInit() {
  try {
    await ElMessageBox.confirm('确定要一键预设通用结算方式吗？（仅在列表为空时生效）', '提示', { type: 'info' })
    initializing.value = true
    await cashierApi.initSettleType()
    ElMessage.success('初始化成功')
    loadData()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '初始化失败')
  } finally {
    initializing.value = false
  }
}

async function handleSave() {
  if (!form.value.code || !form.value.name) return ElMessage.warning('请填写完整信息')
  saving.value = true
  try {
    if (editId.value) {
      await cashierApi.updateSettleType(editId.value, form.value)
    } else {
      await cashierApi.createSettleType(form.value as any)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    loadData()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page { padding: 16px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
.toolbar { margin-bottom: 12px; }
</style>
