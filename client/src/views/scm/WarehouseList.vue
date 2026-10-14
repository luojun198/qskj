<template>
  <div class="page scm-wh-page">
    <div class="list-toolbar" style="margin-bottom:var(--block-gap)">
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增仓库</el-button>
      <SaveAsButton title="仓库档案" />
    </div>
    <div class="page-table-fill">
      <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="100%" @header-dragend="onDragEnd">
        <el-table-column label="编号" prop="code" :width="cw('code', 120)" />
        <el-table-column label="名称" prop="name" min-width="160" :width="widths.name" />
        <el-table-column label="属性" prop="attr" :width="cw('attr', 100)" />
        <el-table-column label="负责人" prop="keeper" :width="cw('keeper', 120)" />
        <el-table-column label="客供仓" prop="is_customer_supplied" :width="cw('is_customer_supplied', 80)" align="center">
          <template #default="{ row }"><el-tag v-if="Number(row.is_customer_supplied) === 1" size="small" type="warning" effect="plain">客供</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" prop="enabled" :width="cw('enabled', 70)" align="center">
          <template #default="{ row }"><span :class="(row as any).enabled === 0 ? 'text-disabled' : ''">{{ (row as any).enabled === 0 ? '停用' : '启用' }}</span></template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="160" :width="widths.remark" show-overflow-tooltip />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 160)" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="toggleEnable(row)">{{ (row as any).enabled === 0 ? '启用' : '停用' }}</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <WarehouseDialog v-model="dialogVisible" :row="editRow" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { scmApi, type ScmWarehouse } from '@/api/scm'
import WarehouseDialog from '@/components/scm/WarehouseDialog.vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_warehouse')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<ScmWarehouse[]>([])

/** 停用 / 启用：停用后单据录入不能再选该仓库，已有单据与库存不受影响 */
async function toggleEnable(row: any) {
  const enabled = row.enabled === 0
  if (!enabled) {
    try { await ElMessageBox.confirm(`停用仓库「${row.name || row.code}」？停用后单据录入不能再选，已有单据与库存不受影响。`, '停用', { type: 'warning' }) } catch { return }
  }
  await scmApi.batchEnableMaster('warehouses', [row.id], enabled)
  ElMessage.success(enabled ? '已启用' : '已停用')
  load()
}
const loading = ref(false)
async function load() {
  loading.value = true
  try { const res = await scmApi.getWarehouses(); if (res.code === 0) list.value = res.data } finally { loading.value = false }
}

const dialogVisible = ref(false)
const editRow = ref<ScmWarehouse | null>(null)
function openAdd() { editRow.value = null; dialogVisible.value = true }
function openEdit(row: ScmWarehouse) { editRow.value = row; dialogVisible.value = true }

async function handleDelete(row: ScmWarehouse) {
  await ElMessageBox.confirm(`确认删除仓库「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deleteWarehouse(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
</script>

<style scoped>
.text-disabled { color: var(--el-text-color-placeholder); }
.scm-wh-page { padding: var(--page-pad); height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>
