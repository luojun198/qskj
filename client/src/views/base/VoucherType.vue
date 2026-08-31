<template>
  <div class="page voucher-type-page">
    <div class="page-header voucher-type-header">
      <div class="voucher-type-title">
        <h3>凭证类型</h3>
        <span>{{ list.length }} 个类型</span>
      </div>
      <el-button type="primary" size="small" @click="openDialog('add')">新增类型</el-button>
    </div>
    <el-table
      ref="tableRef"
      :data="list"
      stripe
      border
      size="small"
      height="100%"
      class="voucher-type-table"
      :row-style="{ height: '30px' }"
      :cell-style="{ padding: '0' }"
      :header-cell-style="{ padding: '4px 0' }"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="code" label="编码" :width="colWidth('code', 120)">
        <template #default="{ row }">
          <span class="voucher-type-code">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="类型名称" :width="colWidth('name', 220)">
        <template #default="{ row }">
          <span class="voucher-type-name">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 112)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDialog('edit', row)"
            >编辑</el-button
          >
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="450px">
      <div v-if="dialogType === 'edit' && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="100px">
        <el-form-item label="编码" required
          ><el-input v-model="form.code" :disabled="dialogType === 'edit'"
        /></el-form-item>
        <el-form-item label="类型名称" required><el-input v-model="form.name" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import request from '@/api/request'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useBaseDataStore } from '@/stores/baseData'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('base_voucher_type')
const list = ref<any[]>([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const dialogTitle = computed(() => (dialogType.value === 'add' ? '新增凭证类型' : '编辑凭证类型'))

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  if (list.value.length === 0 || dialogType.value === 'add') return null
  const idx = list.value.findIndex(r => r.id === form.value.id)
  return {
    current: idx + 1,
    total: list.value.length,
    isFirst: idx <= 0,
    isLast: idx >= list.value.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  if (list.value.length === 0) return
  
  let targetIdx = 0
  const currentIdx = list.value.findIndex(r => r.id === form.value.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = list.value.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(list.value.length - 1, currentIdx + 1)
  
  if (list.value[targetIdx]) {
    openDialog('edit', list.value[targetIdx])
  }
}

const form = ref<any>({})

async function fetchData() {
  const r = await request.get<any[]>('/base/voucher-types')
  list.value = r.data
}

function openDialog(t: string, row?: any) {
  dialogType.value = t
  form.value = t === 'add' ? { code: '', name: '' } : { ...row }
  dialogVisible.value = true
}

async function handleSave() {
  try {
    const payload = {
      ...form.value,
      description: '',
    }
    if (dialogType.value === 'add') {
      await request.post('/base/voucher-types', payload)
      showSuccess('凭证类型新增成功')
    } else {
      await request.put(`/base/voucher-types/${form.value.id}`, payload)
      showSuccess('凭证类型修改成功')
    }
    useBaseDataStore().invalidate()
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    showOperationError(dialogType.value === 'add' ? '新增凭证类型' : '修改凭证类型', error)
  }
}

async function handleDelete(row: any) {
  const confirmed = await useDeleteConfirm(`凭证类型「${row.name}」`)
  if (!confirmed) return

  try {
    await request.delete(`/base/voucher-types/${row.id}`)
    useBaseDataStore().invalidate()
    showSuccess('删除成功')
    fetchData()
  } catch (error) {
    showOperationError('删除凭证类型', error)
  }
}

onMounted(fetchData)
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

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.page-header h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.voucher-type-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.voucher-type-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.voucher-type-table {
  flex: 1;
  min-height: 0;
  border-radius: 6px;
  overflow: hidden;
}

.voucher-type-code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  color: var(--el-color-primary);
  font-weight: 600;
}

.voucher-type-name {
  color: var(--el-text-color-primary);
  font-weight: 500;
}

:deep(.voucher-type-table .el-table__cell) {
  padding: 2px 0 !important;
}

:deep(.voucher-type-table th.el-table__cell) {
  padding: 5px 0 !important;
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary);
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

:deep(.voucher-type-table .el-table__row) {
  height: 30px;
}

:deep(.voucher-type-table .cell) {
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.voucher-type-table .el-button--small) {
  height: 22px;
  padding: 0 4px;
}
</style>
