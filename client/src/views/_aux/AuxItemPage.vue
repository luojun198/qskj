<template>
  <div class="page">
    <div class="page-header">
      <h3>{{ title }}</h3>
      <div class="page-header-actions">
        <el-input
          v-model="searchKeyword"
          :placeholder="`搜索编码、${nameLabel}...`"
          clearable
          class="search-input filter-ctl--lg"
          prefix-icon="Search"
        />
        <el-button type="primary" @click="openDialog('add')">新增{{ entityName }}</el-button>
      </div>
    </div>
    <div ref="tableContainerRef" class="page-table-fill">
    <el-table
      ref="tableRef"
      :height="tableHeight"
      :data="filteredData"
      stripe
      border
      size="small"
      class="compact-data-table"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="code" label="编码" :width="colWidth('code', 120)">
        <template #default="{ row }">
          <span v-html="highlightText(row.code)"></span>
        </template>
      </el-table-column>
      <el-table-column prop="name" :label="nameLabel" :width="colWidth('name', 160)">
        <template #default="{ row }">
          <span v-html="highlightText(row.name)"></span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" :width="colWidth('status', 80)">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{
            row.status === 'active' ? '进行中' : '已完结'
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" :width="colWidth('remark', 160)" />
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 160)">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDialog('edit', row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="400px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="编码" required><el-input v-model="form.code" /></el-form-item>
        <el-form-item :label="nameLabel" required><el-input v-model="form.name" /></el-form-item>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import request from '@/api/request'
import AuxItemDeleteBlockDialog from '@/components/base/AuxItemDeleteBlockDialog.vue'
import VoucherEntryDialogHost from '@/components/voucher/VoucherEntryDialogHost.vue'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { useDeleteConfirm } from '@/composables/useConfirm'
import { useTableSearch } from '@/composables/useTableSearch'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { useFillHeightTable } from '@/composables/useFillHeightTable'
import { useAuxItemDeleteBlock } from '@/composables/useAuxItemDeleteBlock'

interface Props {
  title: string
  entityType: string
  entityName: string
  nameLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  nameLabel: '名称',
})

const { tableRef, onDragEnd, colWidth } = useListColumnWidth(`aux_item_${props.entityType}`)
const { containerRef: tableContainerRef, tableHeight } = useFillHeightTable()
const entryDialogHostRef = ref<InstanceType<typeof VoucherEntryDialogHost> | null>(null)
const {
  deleteBlockVisible,
  deleteBlockDetail,
  deleteAuxItemWithDialog,
  openBlockedVoucher,
  goInitBalanceAux,
} = useAuxItemDeleteBlock(entryDialogHostRef)
const list = ref<any[]>([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const dialogTitle = computed(() =>
  dialogType.value === 'add' ? `新增${props.entityName}` : `编辑${props.entityName}`
)
const form = ref<any>({ type: props.entityType, status: 'active' })

const { searchKeyword, filteredData, highlightText } = useTableSearch(
  () => list.value,
  ['code', 'name', 'remark']
)

async function fetchData() {
  try {
    const r = await request.get<any[]>('/base/aux-items', { params: { type: props.entityType } })
    list.value = r.data
  } catch (error) {
    showOperationError(`查询${props.entityName}列表`, error)
  }
}

function openDialog(t: string, row?: any) {
  dialogType.value = t
  form.value = t === 'add' ? { type: props.entityType, status: 'active' } : { ...row }
  dialogVisible.value = true
}

async function handleSave() {
  try {
    if (dialogType.value === 'add') {
      await request.post('/base/aux-items', form.value)
      showSuccess(`${props.entityName}新增成功`)
    } else {
      await request.put(`/base/aux-items/${form.value.id}`, form.value)
      showSuccess(`${props.entityName}修改成功`)
    }
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    showOperationError(
      dialogType.value === 'add' ? `新增${props.entityName}` : `修改${props.entityName}`,
      error
    )
  }
}

async function handleDelete(row: any) {
  const confirmed = await useDeleteConfirm(`${props.entityName}「${row.code} ${row.name}」`)
  if (!confirmed) return

  const result = await deleteAuxItemWithDialog(row.id, `删除${props.entityName}`)
  if (result === 'success') {
    showSuccess('删除成功')
    fetchData()
  }
}

onMounted(fetchData)
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
}
</style>
