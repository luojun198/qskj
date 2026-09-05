<template>
  <div class="page qc-page">
    <div class="filter-row">
      <span class="title">质检管理</span>
      <el-radio-group v-model="qcType" size="small" @change="load">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="IQC">到货检验</el-radio-button>
        <el-radio-button value="IPQC">过程检验</el-radio-button>
        <el-radio-button value="FQC">完工检验</el-radio-button>
      </el-radio-group>
      <el-button type="primary" size="small" @click="openAdd"><el-icon><Plus /></el-icon>新增质检单</el-button>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column label="质检单号" prop="qc_no" width="140" />
      <el-table-column label="类型" width="90" align="center"><template #default="{ row }">{{ qcTypeName(row.qc_type) }}</template></el-table-column>
      <el-table-column label="日期" prop="qc_date" width="110" />
      <el-table-column label="来源单据" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.source_doc_no || '—' }}</template></el-table-column>
      <el-table-column label="供应商" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ row.partner_name || '' }}</template></el-table-column>
      <el-table-column label="判定" width="100" align="center">
        <template #default="{ row }"><el-tag size="small" :type="resultTag(row.result)" effect="plain">{{ resultName(row.result) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="不良合计" width="90" align="right"><template #default="{ row }"><span :class="{ bad: row.defect_total > 0 }">{{ row.defect_total }}</span></template></el-table-column>
      <el-table-column label="检验员" prop="inspector" width="100" />
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="230" align="center">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button link type="success" size="small" @click="audit(row)">审核</el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
          <template v-else>
            <el-button link type="primary" size="small" @click="openEdit(row)">查看</el-button>
            <el-button v-if="row.defect_total > 0" link type="danger" size="small"
              :loading="pushing === row.id" @click="pushDefect(row)">下推不良品</el-button>
            <el-button link type="warning" size="small" @click="unaudit(row)">反审核</el-button>
          </template>
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
const qcType = ref('')
const loading = ref(false)
const pushing = ref('')

const qcTypeName = (t: string) => ({ IQC: '到货检验', IPQC: '过程检验', FQC: '完工检验' } as any)[t] || t
const resultName = (r: string) => ({ pass: '合格', fail: '不合格', concession: '让步接收' } as any)[r] || r
const resultTag = (r: string) => ({ pass: 'success', fail: 'danger', concession: 'warning' } as any)[r] || 'info'

async function load() {
  loading.value = true
  try { const r = await scmApi.getQcDocs({ qc_type: qcType.value || undefined }); if (r.code === 0) rows.value = r.data } finally { loading.value = false }
}
function openAdd() { router.push({ name: 'ScmQcNew', query: qcType.value ? { qc_type: qcType.value } : {} }) }
function openEdit(row: any) { router.push({ name: 'ScmQcEdit', params: { id: row.id } }) }
/** 把不良明细一键下推成不良品入库单(PS)，走 PS 的工单成本上卷口径 */
async function pushDefect(row: any) {
  await ElMessageBox.confirm(`将质检单「${row.qc_no}」的 ${row.defect_total} 件不良品下推成不良品入库单？`, '提示', { type: 'warning' })
  pushing.value = row.id
  try {
    const r = await scmApi.genQcDefectDoc(row.id, {}) as any
    if (r.code !== 0) return ElMessage.error(r.message || '下推失败')
    ElMessage.success(`已生成不良品入库单 ${r.data.doc_no}`)
    router.push({ name: 'ScmDocEdit', params: { id: r.data.id } })
  } finally { pushing.value = '' }
}
async function audit(row: any) { await scmApi.auditQcDoc(row.id); ElMessage.success('已审核'); load() }
async function unaudit(row: any) { await scmApi.unauditQcDoc(row.id); ElMessage.success('已反审核'); load() }
async function del(row: any) {
  await ElMessageBox.confirm(`确认删除质检单「${row.qc_no}」？`, '提示', { type: 'warning' })
  await scmApi.deleteQcDoc(row.id); ElMessage.success('已删除'); load()
}
onMounted(load)
// 从质检单编辑页返回时刷新（keep-alive 下 onMounted 不会重跑）
onActivated(load)
</script>

<style scoped>
.qc-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.bad { color: var(--el-color-danger); font-weight: 600; }
</style>
