<template>
  <div class="page scm-cat-page">
    <div class="cat-bar">
      <span class="cat-title">库位档案</span>
      <el-select v-model="filterWh" filterable placeholder="按仓库筛选" size="small" style="width:180px" @change="load" :empty-values="[null, undefined]">
        <el-option label="全部仓库" value="" />
        <el-option v-for="w in warehouses" :key="w.code" :value="w.code" :label="w.name || w.code" />
      </el-select>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增库位</el-button>
      <el-button size="small" :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      <span class="cat-hint">共 {{ rows.length }} 个库位（参考用，不参与库存结存）</span>
    </div>
    <div class="cat-body">
      <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
        <el-table-column type="index" label="序号" width="48" align="center" />
        <el-table-column label="仓库" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code }}</template>
        </el-table-column>
        <el-table-column label="库位编码" prop="code" width="150" />
        <el-table-column label="库位名称" prop="name" min-width="180" show-overflow-tooltip />
        <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.enabled === 0 ? 'info' : 'success'" size="small">{{ row.enabled === 0 ? '停用' : '启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <BinDialog v-model="dialogVisible" :row="editRow" :default-warehouse="filterWh" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import BinDialog from '@/components/scm/BinDialog.vue'

const rows = ref<any[]>([])
const warehouses = ref<any[]>([])
const loading = ref(false)
const filterWh = ref('')
const dialogVisible = ref(false)
const editRow = ref<any | null>(null)

async function load() {
  loading.value = true
  try { const r = await scmApi.getBins(filterWh.value || undefined); if (r.code === 0) rows.value = r.data || [] }
  finally { loading.value = false }
}
function openAdd() { editRow.value = null; dialogVisible.value = true }
function openEdit(row: any) { editRow.value = row; dialogVisible.value = true }

async function onDelete(row: any) {
  try { await ElMessageBox.confirm(`确认删除库位「${row.name}」？`, '提示', { type: 'warning' }) } catch { return }
  try { const r = await scmApi.deleteBin(row.id); if (r.code === 0) { ElMessage.success('已删除'); load() } else ElMessage.error(r.message || '删除失败') }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '删除失败') }
}
onMounted(async () => {
  try { const w = await scmApi.getWarehouses(); if (w.code === 0) warehouses.value = w.data || [] } catch {}
  load()
})
</script>

<style scoped>
.scm-cat-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); }
.cat-bar { display: flex; align-items: center; gap: 10px; margin-bottom: var(--block-gap); flex-wrap: wrap; }
.cat-title { font-size: var(--cw-text-lg); font-weight: 600; margin-right: 4px; }
.cat-hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.cat-body { flex: 1; min-height: 0; }
</style>
