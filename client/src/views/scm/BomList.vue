<template>
  <div class="page scm-bom-page">
    
    <div class="filter-row" style="margin-bottom: 8px;">
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增BOM</el-button>
    </div>

    <div class="page-body">
      <el-table ref="tableRef" :data="list" v-loading="loading" border stripe size="small" height="100%" @header-dragend="onDragEnd">
        <el-table-column label="BOM编码" prop="code" :width="cw('code', 140)" />
        <el-table-column label="BOM名称" prop="name" min-width="150" :width="widths.name" />
        <el-table-column label="成品物料" prop="item_code" :width="cw('item_code', 130)" />
        <el-table-column label="物料名称" prop="item_name" :width="cw('item_name', 150)" />
        <el-table-column label="规格" prop="spec" :width="cw('spec', 120)" show-overflow-tooltip />
        <el-table-column label="状态" prop="status" :width="cw('status', 80)" />
        <el-table-column label="操作" column-key="操作" :width="cw('操作', 170)" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" size="small" @click="openTree(row)">展开</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef, colWidth, onDragEnd, widths } = useListColumnWidth('scm_bom')
function cw(key: string, fallback: number) { return colWidth(key, fallback) }

const router = useRouter()
const list = ref<any[]>([]); const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getBoms()
    if (r.code === 0) list.value = r.data
  } finally {
    loading.value = false
  }
}

onMounted(load)
// 从「新增/编辑BOM」全页面返回时刷新列表（keep-alive 复用，不会重跑 onMounted）
onActivated(() => {
  load()
})

function openAdd() {
  router.push('/scm/boms/new')
}

function openEdit(row: any) {
  router.push(`/scm/boms/${row.id}/edit`)
}

function openTree(row: any) {
  router.push(`/scm/boms/${row.id}/tree`)
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm('确认删除该 BOM 吗？', '提示', { type: 'warning' })
    const r = await scmApi.deleteBom(row.id)
    if (r.code === 0) {
      ElMessage.success('已删除')
      load()
    }
  } catch (e) {
    // cancel
  }
}
</script>

<style scoped>
.scm-bom-page { display: flex; flex-direction: column; height: 100%; }
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}

.page-body { flex: 1; overflow: hidden; padding: 12px 16px; }
</style>
