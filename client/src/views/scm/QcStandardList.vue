<template>
  <div class="page qc-std-page">
    <div class="filter-row">
      <el-input v-model="keyword" clearable placeholder="物料编号/名称/标准名称" size="small" style="width:220px" @keyup.enter="load" />
      <el-select v-model="qcType" clearable placeholder="检验类型" size="small" style="width:130px" @change="load">
        <el-option label="到货检验(IQC)" value="IQC" /><el-option label="过程检验(IPQC)" value="IPQC" /><el-option label="完工检验(FQC)" value="FQC" />
      </el-select>
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <el-button type="primary" size="small" @click="router.push('/scm/qc-standards/new')"><el-icon><Plus /></el-icon>新增检验标准</el-button>
      <span class="hint">检验标准 = 检验项（数值上下限 / 判定型，关键项）+ 抽样方案（全检 / 比例 / 固定数）+ 允收不良数；质检单选物料后自动载入，逐项填实测值后自动判定</span>
    </div>
    <div class="page-body">
      <el-table :data="list" v-loading="loading" border stripe size="small" height="100%" @row-dblclick="edit">
        <el-table-column label="物料" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.item_code }} {{ row.item_name || '' }}<span v-if="row.spec" class="text-muted">（{{ row.spec }}）</span></template>
        </el-table-column>
        <el-table-column label="检验类型" width="110" align="center">
          <template #default="{ row }"><el-tag size="small" effect="plain" :type="row.qc_type ? 'primary' : 'info'">{{ typeLabel(row.qc_type) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="标准名称" prop="name" min-width="140" show-overflow-tooltip />
        <el-table-column label="抽样方案" width="150">
          <template #default="{ row }">{{ samplingLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="允收不良数" prop="accept_defects" width="100" align="right" />
        <el-table-column label="检验项数" prop="item_count" width="90" align="right" />
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }"><el-tag size="small" :type="row.is_enabled ? 'success' : 'info'" effect="plain">{{ row.is_enabled ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'

const router = useRouter()
const list = ref<any[]>([]); const loading = ref(false)
const keyword = ref(''); const qcType = ref('')
const typeLabel = (t: string) => ({ IQC: '到货检验', IPQC: '过程检验', FQC: '完工检验' } as Record<string, string>)[t] || '通用'
const samplingLabel = (r: any) => r.sampling_mode === 'percent' ? `按比例 ${r.sampling_value}%（最少 ${r.min_sample}）` : r.sampling_mode === 'fixed' ? `固定 ${r.sampling_value} 件` : '全检'

async function load() {
  loading.value = true
  try { const r = await scmApi.getQcStandards({ keyword: keyword.value || undefined, qc_type: qcType.value || undefined }); if (r.code === 0) list.value = r.data } finally { loading.value = false }
}
function edit(row: any) { router.push(`/scm/qc-standards/${row.id}/edit`) }
async function remove(row: any) {
  try { await ElMessageBox.confirm(`删除物料 ${row.item_code} 的${typeLabel(row.qc_type)}检验标准？已录入的质检单结果不受影响。`, '删除', { type: 'warning' }) } catch { return }
  const r = await scmApi.deleteQcStandard(row.id)
  if (r.code === 0) { ElMessage.success('已删除'); load() }
}
onMounted(load)
onActivated(load)
</script>

<style scoped>
.qc-std-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.hint { font-size: 12px; color: var(--el-text-color-secondary); }
.page-body { flex: 1; min-height: 0; }
</style>
