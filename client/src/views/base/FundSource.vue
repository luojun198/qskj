<template>
  <PageListLayout title="资金来源" class="fund-source-page">
    <template v-if="categoryId" #actions>
      <el-input
        v-model="searchKeyword"
        placeholder="搜索编码、名称"
        clearable
        class="search-input"
        size="small"
      />
      <el-button type="primary" size="small" @click="openDialog('add')">新增资金来源</el-button>
    </template>

    <el-alert
      v-if="!categoryId && !loading"
      type="warning"
      show-icon
      :closable="false"
      title="未找到「资金来源」档案类别"
      description="请通过 ACD 导入或联系管理员初始化账套辅助档案后再维护。"
      style="margin-bottom: 12px"
    />

    <el-table
      v-else
      ref="tableRef"
      :data="filteredList"
      stripe
      border
      size="small"
      height="100%"
      v-loading="loading"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="code" label="编码" :width="colWidth('code', 120)" />
      <el-table-column prop="name" label="名称" :width="colWidth('name', 200)" />
      <el-table-column prop="status" label="状态" :width="colWidth('status', 100)">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '进行中' : '已完结' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" :width="colWidth('remark', 160)" />
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 140)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDialog('edit', row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="420px">
      <div v-if="dialogType === 'edit' && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="80px">
        <el-form-item label="编码" required><el-input v-model="form.code" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已完结" value="closed" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <AuxItemDeleteBlockDialog
      v-model="deleteBlockVisible"
      :detail="deleteBlockDetail"
      @open-voucher="openBlockedVoucher"
      @go-init-balance-aux="goInitBalanceAux"
    />
    <VoucherEntryDialogHost ref="entryDialogHostRef" />
  </PageListLayout>
</template>

<script setup lang="ts">
import PageListLayout from '@/components/layout/PageListLayout.vue'
import AuxItemDeleteBlockDialog from '@/components/base/AuxItemDeleteBlockDialog.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/api/request'
import { useSystemParamsStore } from '@/stores/systemParams'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useAuxItemDeleteBlock } from '@/composables/useAuxItemDeleteBlock'
import DialogNavigation from '@/components/common/DialogNavigation.vue'

const { tableRef, onDragEnd, colWidth, relayoutTable } = useListColumnWidth('base_fund_source')
const router = useRouter()
const systemParamsStore = useSystemParamsStore()
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const {
  deleteBlockVisible,
  deleteBlockDetail,
  deleteAuxItemWithDialog,
  openBlockedVoucher,
  goInitBalanceAux,
} = useAuxItemDeleteBlock(entryDialogHostRef)

const categoryId = ref('')
const list = ref<any[]>([])
const loading = ref(false)
const searchKeyword = ref('')
const dialogVisible = ref(false)
const dialogType = ref<'add' | 'edit'>('add')
const form = ref<any>({ status: 'active', remark: '' })

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

const dialogTitle = computed(() =>
  dialogType.value === 'add' ? '新增资金来源' : '编辑资金来源'
)

const filteredList = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    row =>
      String(row.code || '')
        .toLowerCase()
        .includes(kw) ||
      String(row.name || '')
        .toLowerCase()
        .includes(kw)
  )
})

async function resolveCategory() {
  const res = await request.get<any[]>('/base/aux-categories')
  const cat = (res.data || []).find((c: any) => c.code === 'fund_source')
  categoryId.value = cat?.id || ''
}

async function fetchData() {
  if (!categoryId.value) {
    list.value = []
    return
  }
  loading.value = true
  try {
    const res = await request.get<any[]>('/base/aux-items', {
      params: { category_id: categoryId.value },
    })
    list.value = res.data || []
  } catch (error) {
    showOperationError('加载资金来源', error)
  } finally {
    loading.value = false
    await relayoutTable()
  }
}

function openDialog(type: 'add' | 'edit', row?: any) {
  dialogType.value = type
  form.value =
    type === 'add'
      ? { type: categoryId.value, status: 'active', remark: '' }
      : { ...row }
  dialogVisible.value = true
}

async function handleSave() {
  if (!categoryId.value) return
  try {
    if (dialogType.value === 'add') {
      await request.post('/base/aux-items', { ...form.value, type: categoryId.value })
      showSuccess('资金来源新增成功')
    } else {
      await request.put(`/base/aux-items/${form.value.id}`, form.value)
      showSuccess('资金来源修改成功')
    }
    dialogVisible.value = false
    await fetchData()
  } catch (error) {
    showOperationError(dialogType.value === 'add' ? '新增资金来源' : '修改资金来源', error)
  }
}

async function handleDelete(row: any) {
  const confirmed = await useDeleteConfirm(`资金来源「${row.code} ${row.name}」`)
  if (!confirmed) return
  const result = await deleteAuxItemWithDialog(row.id, '删除资金来源')
  if (result === 'success') {
    showSuccess('删除成功')
    await fetchData()
  }
}

onMounted(async () => {
  await systemParamsStore.load()
  if (!systemParamsStore.enableCashFlow) {
    router.replace('/system/param')
    return
  }
  await resolveCategory()
  await fetchData()
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
  margin-bottom: 12px;
}
.page-header h3 {
  margin: 0;
}
.search-input {
  width: 200px;
  margin-right: 8px;
}
</style>
