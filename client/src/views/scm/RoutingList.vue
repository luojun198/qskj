<template>
  <div class="page rt-page">
    <div class="filter-row">
      <span class="title">工艺路线</span>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增</el-button>
      <span class="hint">定义成品的工序/工作中心/标准工时，供报工时选择工序、完工默认数取末道工序、标准成本与工时统计取标准工时；同一成品只允许一条「启用」路线</span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="编码" prop="code" width="140" />
      <el-table-column label="名称" prop="name" min-width="150" show-overflow-tooltip />
      <el-table-column label="成品" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.item_code }} {{ row.item_name || '' }}</template>
      </el-table-column>
      <el-table-column label="工序数" width="80" align="right"><template #default="{ row }">{{ row.process_count ?? '' }}</template></el-table-column>
      <el-table-column label="标准总工时" width="100" align="right"><template #default="{ row }">{{ Number(row.std_hours_total) || 0 }}</template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'

const router = useRouter()
const rows = ref<any[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try { const r = await scmApi.getRoutings(); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function openAdd() { router.push({ name: 'ScmRoutingNew' }) }
function openEdit(row: any) { router.push({ name: 'ScmRoutingEdit', params: { id: row.id } }) }
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除工艺路线「${row.code}」？`, '提示', { type: 'warning' })
  await scmApi.deleteRouting(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
// 从编辑页返回时刷新列表（keep-alive 下 onMounted 不会重跑）
onActivated(load)
</script>

<style scoped>
.rt-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 10px; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
