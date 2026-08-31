<template>
  <div class="page scm-wh-page">
    <div class="list-toolbar" style="margin-bottom:8px">
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增仓库</el-button>
    </div>
    <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" max-height="calc(100vh - 240px)" @header-dragend="onDragEnd">
      <el-table-column label="编号" prop="code" :width="cw('code', 120)" />
      <el-table-column label="名称" prop="name" min-width="160" :width="widths.name" />
      <el-table-column label="属性" prop="attr" :width="cw('attr', 100)" />
      <el-table-column label="负责人" prop="keeper" :width="cw('keeper', 120)" />
      <el-table-column label="备注" prop="remark" min-width="160" :width="widths.remark" show-overflow-tooltip />
      <el-table-column label="操作" column-key="操作" :width="cw('操作', 120)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <WarehouseDialog v-model="dialogVisible" :row="editRow" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { scmApi, type ScmWarehouse } from '@/api/scm'
import WarehouseDialog from '@/components/scm/WarehouseDialog.vue'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_warehouse')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const list = ref<ScmWarehouse[]>([])
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
.scm-wh-page { padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
</style>
