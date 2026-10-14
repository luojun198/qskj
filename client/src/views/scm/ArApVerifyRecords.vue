<template>
  <div class="page vr-page">
    <div class="filter-row">
      <span class="title">核销单记录</span>
      <el-input v-model="filters.keyword" clearable placeholder="核销单号 / 往来单位 / 单据号" size="small" style="width:210px" @keyup.enter="query" @clear="query" />
      <el-select v-model="filters.partner_code" filterable clearable placeholder="往来单位" size="small" style="width:200px" @change="query">
        <el-option v-for="p in partners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-select v-model="filters.side" clearable placeholder="业务类型" size="small" style="width:110px" @change="query">
        <el-option label="应收核销" value="ar" /><el-option label="应付核销" value="ap" />
      </el-select>
      <el-select v-model="filters.gen_mode" clearable placeholder="生成方式" size="small" style="width:110px" @change="query">
        <el-option label="手动核销" value="manual" /><el-option label="收付款自动" value="auto" />
      </el-select>
      <el-button size="small" type="primary" plain :loading="loading" @click="query">查询</el-button>
      <span class="spacer" />
      <el-button size="small" type="primary" @click="router.push({ name: 'ScmArApVerify' })">新增核销</el-button>
      <el-button v-if="canDelete" size="small" type="danger" plain :disabled="!selection.length" @click="removeSelected">删除</el-button>
      <el-button size="small" :disabled="!rows.length" :loading="exporting" @click="exportExcel">另存</el-button>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" show-summary :summary-method="summary"
      @selection-change="(r: ArapVerifyRecord[]) => (selection = r)" @row-dblclick="open">
      <el-table-column type="selection" width="40" :selectable="(row: ArapVerifyRecord) => canDelete && row.gen_mode === 'manual'" />
      <el-table-column label="单据日期" prop="verify_date" width="105" />
      <el-table-column label="核销单号" width="140">
        <template #default="{ row }"><el-link type="primary" :underline="false" @click="open(row)">{{ row.verify_no }}</el-link></template>
      </el-table-column>
      <el-table-column label="业务类型" prop="biz_type" width="120" />
      <el-table-column label="往来单位" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name }}</template>
      </el-table-column>
      <el-table-column label="核销方单据" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ row.out_doc_nos.split(',').join('、') }}</template>
      </el-table-column>
      <el-table-column label="被核销单据" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ row.in_doc_nos.split(',').join('、') }}</template>
      </el-table-column>
      <el-table-column label="核销金额" prop="total_amount" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
      </el-table-column>
      <el-table-column label="制单人" prop="created_by" width="90" show-overflow-tooltip />
      <el-table-column label="生成方式" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="row.gen_mode === 'auto' ? 'info' : 'success'">{{ row.gen_mode === 'auto' ? '收付款自动' : '手动核销' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="open(row)">查看</el-button>
          <el-button v-if="canDelete && row.gen_mode === 'manual'" link type="danger" size="small" @click="removeOne(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="footer-row">
      <span class="hint">「收付款自动」由收付款单选源单审核时生成，需反审核对应收付款单撤销；删除手动核销单即取消核销，两侧单据恢复为未核销。</span>
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20, 50, 100, 200]" layout="total, sizes, prev, pager, next" small @change="load" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ArapVerifyRecord, type ScmPartner } from '@/api/scm'
import { hasPermission } from '@/utils/permission'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'

const route = useRoute()
const router = useRouter()
const canDelete = computed(() => hasPermission('scm:verify-delete'))
const partners = ref<ScmPartner[]>([])
const filters = reactive({ keyword: '', partner_code: String(route.query.partner_code || ''), side: '', gen_mode: '' })
// 应收应付主页的镜像链接带 ?side=ar|ap 预置业务类型；仅在 URL 值变化时套用，不覆盖用户手动筛选
let appliedQuerySide = ''
function applyQuerySide() {
  const q = String(route.query.side || '')
  if (q === appliedQuerySide) return
  appliedQuerySide = q
  if (q === 'ar' || q === 'ap') filters.side = q
}
applyQuerySide()
const dateRange = ref<string[] | null>(null)
const rows = ref<ArapVerifyRecord[]>([])
const total = ref(0)
const totalAmount = ref(0)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(false)
const exporting = ref(false)
const selection = ref<ArapVerifyRecord[]>([])

const fmt = (v: number) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const params = () => ({ ...filters, date_from: dateRange.value?.[0], date_to: dateRange.value?.[1] })

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getArapVerifyRecords({ ...params(), page: page.value, page_size: pageSize.value })
    if (r.code === 0) { rows.value = r.data.list; total.value = r.data.total; totalAmount.value = r.data.total_amount }
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function open(row: ArapVerifyRecord) { router.push({ name: 'ScmArApVerifyRecord', params: { verifyNo: row.verify_no } }) }

// 合计行：核销金额取全部筛选结果（非仅本页）
function summary({ columns }: { columns: any[] }) {
  return columns.map((c, i) => (i === 1 ? '合计' : c.property === 'total_amount' ? fmt(totalAmount.value) : ''))
}

async function cancelMany(list: ArapVerifyRecord[]) {
  const failed: string[] = []
  for (const row of list) {
    try {
      await scmApi.cancelArapVerify(row.verify_no, { skipErrorToast: true })
    } catch (e: any) {
      failed.push(`${row.verify_no}：${e?.response?.data?.message || e?.message || '删除失败'}`)
    }
  }
  if (failed.length) ElMessage.error({ message: failed.join('；'), duration: 6000 })
  else ElMessage.success(`已删除 ${list.length} 张核销单`)
  selection.value = []
  await load()
}
async function removeOne(row: ArapVerifyRecord) {
  try {
    await ElMessageBox.confirm(`删除核销单「${row.verify_no}」（${row.biz_type} ${fmt(row.total_amount)}）？删除后两侧单据恢复为未核销。`, '删除核销单', { type: 'warning' })
  } catch { return }
  await cancelMany([row])
}
async function removeSelected() {
  const list = selection.value.filter(r => r.gen_mode === 'manual')
  if (!list.length) return
  try {
    await ElMessageBox.confirm(`删除选中的 ${list.length} 张核销单：${list.map(r => r.verify_no).join('、')}？删除后两侧单据恢复为未核销。`, '删除核销单', { type: 'warning' })
  } catch { return }
  await cancelMany(list)
}

async function exportExcel() {
  exporting.value = true
  try {
    // 导出全部筛选结果，不止当前页
    const r = await scmApi.getArapVerifyRecords({ ...params(), page: 1, page_size: 500 })
    if (r.code !== 0) return
    const columns: ExportColumnDef<ArapVerifyRecord>[] = [
      { label: '单据日期', width: 12, value: row => row.verify_date },
      { label: '核销单号', width: 16, value: row => row.verify_no },
      { label: '业务类型', width: 14, value: row => row.biz_type },
      { label: '往来单位', width: 30, value: row => `${row.partner_code} ${row.partner_name}` },
      { label: '核销方单据', width: 24, value: row => row.out_doc_nos.split(',').join('、') },
      { label: '被核销单据', width: 24, value: row => row.in_doc_nos.split(',').join('、') },
      { label: '核销金额', width: 14, type: 'amount', align: 'right', value: row => row.total_amount },
      { label: '制单人', width: 10, value: row => row.created_by },
      { label: '生成方式', width: 12, value: row => (row.gen_mode === 'auto' ? '收付款自动' : '手动核销') },
    ]
    await exportStyledTable({
      fileName: '核销单记录',
      title: '核销单记录',
      subtitle: dateRange.value ? `${dateRange.value[0]} 至 ${dateRange.value[1]}` : undefined,
      columns,
      rows: r.data.list,
      summaryValues: ['', '', '', '', '', '', r.data.total_amount, '', ''],
    })
    if (r.data.total > r.data.list.length) ElMessage.warning(`结果共 ${r.data.total} 张，仅导出前 ${r.data.list.length} 张，请缩小筛选范围`)
  } finally { exporting.value = false }
}

onMounted(async () => {
  const r = await scmApi.getPartners({})
  if (r.code === 0) partners.value = r.data as ScmPartner[]
  await load()
})
onActivated(() => {
  applyQuerySide()
  load()
})
</script>

<style scoped>
.vr-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .spacer { flex: 1; }
.footer-row { display: flex; align-items: center; gap: 12px; }
.footer-row .hint { flex: 1; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
