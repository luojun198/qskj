<template>
  <div class="page cash-flow-items-page">
    <div class="page-header">
      <div class="page-title">
        <h3>现金流量项目</h3>
        <span>{{ list.length }} 项</span>
      </div>
      <div class="page-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索编码、名称"
          clearable
          class="search-input"
          size="small"
        />
        <el-button size="small" @click="router.push('/base/cash-flow-account-map')">科目现金流量项目</el-button>
        <el-button size="small" :loading="initLoading" @click="handleInitDefault">初始化标准项目</el-button>
        <el-button type="primary" size="small" @click="openDialog('add')">新增项目</el-button>
      </div>
    </div>
    <el-table
      ref="tableRef"
      :data="filteredList"
      stripe
      border
      size="small"
      height="100%"
      row-key="id"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="code" label="编码" :width="colWidth('code', 120)" />
      <el-table-column prop="name" label="名称" :width="colWidth('name', 220)" />
      <el-table-column prop="direction" label="流向" :width="colWidth('direction', 100)">
        <template #default="{ row }">
          <el-tag size="small" :type="directionTagType(row.direction)">{{
            directionLabel(row.direction)
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="kind" label="类别" :width="colWidth('kind', 90)">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="row.kind === 'supplement' ? 'warning' : 'info'">{{ row.kind === 'supplement' ? '附表' : '主表' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="parent_code" label="上级编码" :width="colWidth('parent_code', 120)" />
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 140)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDialog('edit', row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <div v-if="dialogType === 'edit' && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="96px">
        <el-form-item label="编码" required>
          <el-input v-model="form.code" :disabled="dialogType === 'edit'" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="流向" required>
          <el-select v-model="form.direction" style="width: 100%">
            <el-option label="流入" value="inflow" />
            <el-option label="流出" value="outflow" />
            <el-option label="中性" value="neutral" />
          </el-select>
        </el-form-item>
        <el-form-item label="上级编码">
          <el-input v-model="form.parent_code" placeholder="留空表示顶级" clearable />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" style="width: 100%" />
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
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useSystemParamsStore } from '@/stores/systemParams'
import {
  getCashFlowItems,
  createCashFlowItem,
  updateCashFlowItem,
  deleteCashFlowItem,
  initDefaultCashFlowItems,
  type CashFlowItem,
} from '@/api/cashFlow'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('base_cash_flow_items')
const router = useRouter()
const userStore = useUserStore()
const systemParamsStore = useSystemParamsStore()

const list = ref<CashFlowItem[]>([])
const searchKeyword = ref('')
const dialogVisible = ref(false)
const dialogType = ref<'add' | 'edit'>('add')
const saving = ref(false)

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  if (filteredList.value.length === 0 || dialogType.value === 'add') return null
  const idx = filteredList.value.findIndex(r => r.id === form.value.id)
  return {
    current: idx + 1,
    total: filteredList.value.length,
    isFirst: idx <= 0,
    isLast: idx >= filteredList.value.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  if (filteredList.value.length === 0) return
  
  let targetIdx = 0
  const currentIdx = filteredList.value.findIndex(r => r.id === form.value.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = filteredList.value.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(filteredList.value.length - 1, currentIdx + 1)
  
  if (filteredList.value[targetIdx]) {
    openDialog('edit', filteredList.value[targetIdx])
  }
}

const initLoading = ref(false)
const form = ref({
  id: '',
  code: '',
  name: '',
  direction: 'inflow' as 'inflow' | 'outflow' | 'neutral',
  parent_code: '',
  sort_order: 0,
})

const dialogTitle = computed(() => (dialogType.value === 'add' ? '新增现金流量项目' : '编辑现金流量项目'))

function directionLabel(direction: string) {
  if (direction === 'inflow') return '流入'
  if (direction === 'outflow') return '流出'
  return '中性'
}

function directionTagType(direction: string) {
  if (direction === 'inflow') return 'success'
  if (direction === 'outflow') return 'danger'
  return 'info'
}

const filteredList = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    row => row.code.toLowerCase().includes(kw) || row.name.toLowerCase().includes(kw)
  )
})

async function fetchData() {
  if (!userStore.accountSetId) return
  try {
    const res = await getCashFlowItems(userStore.accountSetId)
    list.value = res.data || []
  } catch (error) {
    showOperationError('加载现金流量项目', error)
  }
}

function openDialog(type: 'add' | 'edit', row?: CashFlowItem) {
  dialogType.value = type
  if (type === 'add') {
    form.value = {
      id: '',
      code: '',
      name: '',
      direction: 'inflow',
      parent_code: '',
      sort_order: 0,
    }
  } else if (row) {
    form.value = {
      id: row.id,
      code: row.code,
      name: row.name,
      direction: row.direction,
      parent_code: row.parent_code || '',
      sort_order: row.sort_order ?? 0,
    }
  }
  dialogVisible.value = true
}

async function handleSave() {
  if (!userStore.accountSetId) return
  const code = form.value.code.trim()
  const name = form.value.name.trim()
  if (!code || !name) {
    showOperationError('保存', new Error('编码、名称不能为空'))
    return
  }
  saving.value = true
  try {
    const parentCode = form.value.parent_code?.trim() || undefined
    if (dialogType.value === 'add') {
      await createCashFlowItem({
        account_set_id: userStore.accountSetId,
        code,
        name,
        direction: form.value.direction,
        parent_code: parentCode,
        sort_order: form.value.sort_order,
      })
      showSuccess('现金流量项目新增成功')
    } else {
      await updateCashFlowItem(form.value.id, {
        code,
        name,
        direction: form.value.direction,
        parent_code: parentCode || null,
        sort_order: form.value.sort_order,
      })
      showSuccess('现金流量项目修改成功')
    }
    dialogVisible.value = false
    await fetchData()
  } catch (error) {
    showOperationError(dialogType.value === 'add' ? '新增现金流量项目' : '修改现金流量项目', error)
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: CashFlowItem) {
  const confirmed = await useDeleteConfirm(`现金流量项目「${row.code} ${row.name}」`)
  if (!confirmed) return
  try {
    await deleteCashFlowItem(row.id)
    showSuccess('删除成功')
    await fetchData()
  } catch (error) {
    showOperationError('删除现金流量项目', error)
  }
}

async function handleInitDefault() {
  if (!userStore.accountSetId) return
  initLoading.value = true
  try {
    await initDefaultCashFlowItems(userStore.accountSetId)
    showSuccess('已初始化标准现金流量项目')
    await fetchData()
  } catch (error) {
    showOperationError('初始化现金流量项目', error)
  } finally {
    initLoading.value = false
  }
}

onMounted(async () => {
  await systemParamsStore.load()
  if (!systemParamsStore.enableCashFlow) {
    router.replace('/system/param')
    return
  }
  await fetchData()
})
</script>

<style scoped>
.page {
  padding: var(--page-pad);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--block-gap);
}
.page-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.page-title h3 {
  margin: 0;
}
.page-title span {
  color: #909399;
  font-size: var(--cw-text-base);
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search-input {
  width: 200px;
}
</style>
