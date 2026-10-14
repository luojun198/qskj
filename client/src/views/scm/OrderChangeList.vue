<template>
  <div class="page ocl-page">
    <div class="filter-row">
      <span class="title">{{ title }}</span>
      <el-input v-model="filters.keyword" clearable placeholder="变更单号 / 订单号 / 往来单位 / 原因" size="small" style="width:240px" @keyup.enter="query" @clear="query" />
      <el-select v-if="!fixedType" v-model="filters.doc_type" clearable placeholder="订单类型" size="small" style="width:120px" @change="query">
        <el-option label="采购订单" value="PO" /><el-option label="销售订单" value="SOa" />
      </el-select>
      <el-select v-model="filters.status" clearable placeholder="状态" size="small" style="width:100px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-button size="small" type="primary" plain :loading="loading" @click="query">查询</el-button>
      <SaveAsButton :handler="exportAll" />
      <span class="hint">变更单从「已审核订单 → 变更」发起；审核后写回订单并留痕，不可反审核</span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" @row-dblclick="open">
      <el-table-column label="变更单号" width="160"><template #default="{ row }"><el-link type="primary" :underline="false" @click="open(row)">{{ row.change_no }}</el-link></template></el-table-column>
      <el-table-column label="日期" prop="change_date" width="105" />
      <el-table-column label="订单" width="170">
        <template #default="{ row }">
          <span class="text-muted">{{ row.doc_type === 'PO' ? '采购' : '销售' }}</span>
          <el-link type="primary" :underline="false" style="margin-left:4px" @click="openOrder(row)">{{ row.doc_no }}</el-link>
        </template>
      </el-table-column>
      <el-table-column label="往来单位" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.partner_name || row.partner_code }}</template></el-table-column>
      <el-table-column label="原因" prop="reason" min-width="150" show-overflow-tooltip />
      <el-table-column label="变更内容" min-width="300" show-overflow-tooltip><template #default="{ row }">{{ row.diff_summary }}{{ row.diff_count > 4 ? ` … 共 ${row.diff_count} 项` : '' }}</template></el-table-column>
      <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status_label }}</el-tag></template></el-table-column>
      <el-table-column label="制单 / 审核" width="150" show-overflow-tooltip><template #default="{ row }">{{ row.maker }}{{ row.auditor ? ' / ' + row.auditor : '' }}</template></el-table-column>
      <el-table-column label="操作" width="130" align="center">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button link type="success" size="small" @click="audit(row)">审核</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
          <el-button v-else link type="primary" size="small" @click="open(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" small @change="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi } from '@/api/scm'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { exportDateStamp } from '@/utils/exportElTable'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'

const route = useRoute()
const router = useRouter()
const fixedType = computed(() => String(route.query.doc_type || ''))
const title = computed(() => (fixedType.value === 'PO' ? '采购订单变更单' : fixedType.value === 'SOa' ? '销售订单变更单' : '订单变更单'))
const filters = reactive({ keyword: '', status: '', doc_type: '' })
const dateRange = ref<string[] | null>(null)
const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getOrderChanges({
      doc_type: fixedType.value || filters.doc_type || undefined, doc_id: String(route.query.doc_id || '') || undefined,
      status: filters.status || undefined, keyword: filters.keyword || undefined,
      start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: page.value, page_size: pageSize.value,
    })
    rows.value = r.data.list; total.value = r.data.total
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }

/** 另存：按当前筛选导出全部（不只当前页） */
async function exportAll() {
  const all: any[] = []
  for (let p = 1; ; p++) {
    const r = await scmApi.getOrderChanges({
      doc_type: fixedType.value || filters.doc_type || undefined, doc_id: String(route.query.doc_id || '') || undefined,
      status: filters.status || undefined, keyword: filters.keyword || undefined,
      start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], page: p, page_size: 200,
    })
    all.push(...r.data.list)
    if (!r.data.list.length || all.length >= r.data.total) break
  }
  await exportStyledTable({
    fileName: `${title.value}_${exportDateStamp()}.xlsx`, title: title.value,
    columns: [
      { label: '变更单号', value: (r: any) => r.change_no },
      { label: '日期', value: (r: any) => r.change_date },
      { label: '订单类型', value: (r: any) => (r.doc_type === 'PO' ? '采购订单' : '销售订单') },
      { label: '订单号', value: (r: any) => r.doc_no },
      { label: '往来单位', value: (r: any) => r.partner_name || r.partner_code },
      { label: '原因', value: (r: any) => r.reason },
      { label: '变更内容', value: (r: any) => r.diff_summary },
      { label: '状态', value: (r: any) => r.status_label },
      { label: '制单', value: (r: any) => r.maker },
      { label: '审核', value: (r: any) => r.auditor },
    ],
    rows: all,
  })
}
function open(row: any) { router.push({ name: 'ScmOrderChangeForm', params: { id: row.id } }) }
function openOrder(row: any) { router.push(scmDocumentRoute(row.doc_id, row.doc_type, 'audited')) }
async function audit(row: any) {
  try { await ElMessageBox.confirm(`审核变更单「${row.change_no}」后立即写回订单 ${row.doc_no}，不可反审核。继续？`, '审核', { type: 'warning' }) } catch { return }
  try { await scmApi.auditOrderChange(row.id); ElMessage.success('变更已生效'); load() } catch { /* 拦截器已提示 */ }
}
async function del(row: any) {
  try { await ElMessageBox.confirm(`删除草稿变更单「${row.change_no}」？`, '提示', { type: 'warning' }) } catch { return }
  try { await scmApi.deleteOrderChange(row.id); ElMessage.success('已删除'); load() } catch { /* 拦截器已提示 */ }
}
onMounted(load)
onActivated(load)
</script>

<style scoped>
.ocl-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .hint { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
.text-muted { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
