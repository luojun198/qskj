<template>
  <div class="page mrp-list-page">
    <div class="page-header">
      <div>
        <h2>MRP 计算单</h2>
        <div class="sub">选择销售订单、生产计划、组装单或委外计划，保存多层 BOM 净需求计算快照。</div>
      </div>
      <el-button type="primary" :loading="openingNew" @click="openNew"><el-icon><Plus /></el-icon>新增计算单</el-button>
    </div>
    <div class="filters">
      <el-input v-model="filters.keyword" placeholder="单号或备注" clearable style="width:220px" @keyup.enter="load" />
      <el-select v-model="filters.status" clearable placeholder="全部状态" style="width:130px" @change="load">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-button :loading="loading" @click="load"><el-icon><Search /></el-icon>查询</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" border stripe height="100%" @row-dblclick="openView">
      <el-table-column label="计算单号" prop="doc_no" min-width="170" fixed="left" />
      <el-table-column label="日期" prop="doc_date" width="110" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }"><el-tag :type="row.status === 'audited' ? 'success' : 'info'" size="small">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="来源单据" prop="source_count" width="100" align="right" />
      <el-table-column label="结果行" prop="result_count" width="90" align="right" />
      <el-table-column label="净需求" width="120" align="right"><template #default="{ row }">{{ fmt(row.net_qty) }}</template></el-table-column>
      <el-table-column label="建议量" width="120" align="right"><template #default="{ row }">{{ fmt(row.total_qty) }}</template></el-table-column>
      <el-table-column label="下推状态" width="120" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.shortage_doc_id" type="info" size="small">历史缺料单</el-tag>
          <el-tag v-else-if="row.push_progress === 'full'" type="success" size="small">已完成</el-tag>
          <el-tag v-else-if="row.push_progress === 'part'" type="warning" size="small">部分下推</el-tag>
          <el-tag v-else type="info" size="small">未下推</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="历史缺料单" min-width="160">
        <template #default="{ row }"><el-button v-if="row.shortage_doc_id" link type="primary" @click.stop="openMr(row)">{{ row.shortage_doc_no }}</el-button><span v-else>-</span></template>
      </el-table-column>
      <el-table-column label="制单人" prop="maker" width="110" />
      <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openView(row)">查看</el-button>
          <el-button v-if="row.status === 'draft'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'draft'" link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDocumentRoute, scmDownstreamDocRoute } from '@/utils/scmDocNavigation'

const router = useRouter()
const loading = ref(false)
const openingNew = ref(false)
const rows = ref<any[]>([])
const filters = reactive({ keyword: '', status: '' })
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
async function load() { loading.value = true; try { const r = await scmApi.getMrpDocs(filters); if (r.code === 0) rows.value = r.data || [] } finally { loading.value = false } }
function openView(row: any) { router.push(scmDocumentRoute(row.id, 'MRP', row.status)) }
function openEdit(row: any) { router.push(scmDocumentRoute(row.id, 'MRP', row.status)) }
function openMr(row: any) { router.push(scmDownstreamDocRoute(row.shortage_doc_id, row.shortage_doc_status)) }
async function remove(row: any) {
  await ElMessageBox.confirm(`确认删除 MRP 计算单 ${row.doc_no}？删除后来源需求会释放。`, '删除确认', { type: 'warning' })
  const r = await scmApi.deleteMrpDoc(row.id); if (r.code === 0) { ElMessage.success('已删除'); load() }
}
async function openNew() {
  openingNew.value = true
  await nextTick()
  try {
    await router.push({ name: 'ScmMrpNew' })
  } finally {
    openingNew.value = false
  }
}

onMounted(() => {
  void import('@/views/scm/MrpForm.vue')
  load()
})
</script>

<style scoped>
.mrp-list-page{display:flex;flex-direction:column;height:100%;padding:14px 18px;gap:12px}.page-header{display:flex;align-items:center;justify-content:space-between}.page-header h2{margin:0;font-size:15px;font-weight:600}.sub{margin-top:4px;color:var(--el-text-color-secondary);font-size:13px}.filters{display:flex;gap:8px}
</style>
