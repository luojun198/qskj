<template>
  <div class="page stl-page">
    <div class="filter-row">
      <span class="title">{{ pageTitle }}</span>
      <!-- 第五份反馈：应收 / 应付对账单分开入口；从菜单带 direction 进来时锁定方向，不再显示切换 -->
      <el-radio-group v-if="!fixedDirection" v-model="filters.direction" size="small" @change="query">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="ar">应收</el-radio-button>
        <el-radio-button value="ap">应付</el-radio-button>
      </el-radio-group>
      <el-input v-model="filters.keyword" clearable placeholder="对账单号 / 往来单位 / 备注" size="small" style="width:220px" @keyup.enter="query" @clear="query" />
      <el-select v-model="filters.status" clearable placeholder="状态" size="small" style="width:100px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-button size="small" type="primary" plain :loading="loading" @click="query">查询</el-button>
      <SaveAsButton :title="pageTitle" />
      <div class="actions">
        <el-button size="small" @click="router.push({ name: 'ScmStatementDetailReport', query: filters.direction ? { direction: filters.direction } : {} })">对账明细表</el-button>
        <el-button size="small" type="primary" @click="router.push({ name: 'ScmStatementNew', query: filters.direction ? { direction: filters.direction } : {} })">
          <el-icon><Plus /></el-icon>新增{{ pageTitle }}
        </el-button>
      </div>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" @row-dblclick="open">
      <el-table-column label="对账单号" width="150">
        <template #default="{ row }"><el-link type="primary" :underline="false" @click="open(row)">{{ row.stmt_no }}</el-link></template>
      </el-table-column>
      <el-table-column label="日期" prop="stmt_date" width="100" />
      <el-table-column v-if="!fixedDirection" label="方向" width="70" align="center">
        <template #default="{ row }">{{ row.direction === 'ar' ? '应收' : '应付' }}</template>
      </el-table-column>
      <el-table-column label="往来单位" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
      </el-table-column>
      <el-table-column label="对账期间" width="190">
        <template #default="{ row }">{{ row.start_date || '期初' }} ~ {{ row.end_date }}</template>
      </el-table-column>
      <el-table-column label="明细行" prop="line_count" width="70" align="right" />
      <el-table-column label="业务金额" width="120" align="right"><template #default="{ row }">{{ fmtAmount(row.doc_amount) }}</template></el-table-column>
      <el-table-column :label="'收付款'" width="110" align="right"><template #default="{ row }">{{ fmtAmount(row.payment_amount) }}</template></el-table-column>
      <el-table-column label="本次对账金额" width="120" align="right"><template #default="{ row }"><b>{{ fmtAmount(row.net_amount) }}</b></template></el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="制单 / 审核" width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.maker }}{{ row.auditor ? ' / ' + row.auditor : '' }}</template>
      </el-table-column>
      <el-table-column label="备注" prop="remark" min-width="120" show-overflow-tooltip />
      <el-table-column label="操作" width="140" align="center" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'draft'">
            <el-button link type="success" size="small" @click="audit(row)">审核</el-button>
            <el-button link type="danger" size="small" @click="del(row)">删除</el-button>
          </template>
          <el-button v-else link type="warning" size="small" @click="unaudit(row)">反审核</el-button>
          <el-button link type="primary" size="small" @click="open(row)">查看</el-button>
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
import { Plus } from '@element-plus/icons-vue'
import { scmApi, type ScmStatement } from '@/api/scm'
import { fmtAmount } from '@/utils/statementDoc'

const route = useRoute()
const router = useRouter()
const fixedDirection = ['ar', 'ap'].includes(String(route.query.direction || '')) ? String(route.query.direction) : ''
const filters = reactive({ keyword: '', status: '', direction: fixedDirection })
const pageTitle = computed(() => (filters.direction === 'ar' ? '应收对账单' : filters.direction === 'ap' ? '应付对账单' : '对账单'))
const dateRange = ref<string[] | null>(null)
const rows = ref<ScmStatement[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getStatements({
      direction: filters.direction || undefined, status: filters.status || undefined, keyword: filters.keyword || undefined,
      date_from: dateRange.value?.[0], date_to: dateRange.value?.[1], page: page.value, page_size: pageSize.value,
    })
    rows.value = r.data.list; total.value = r.data.total
  } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function open(row: ScmStatement) { router.push({ name: 'ScmStatementForm', params: { id: row.id } }) }
async function audit(row: ScmStatement) {
  try { await ElMessageBox.confirm(`审核对账单「${row.stmt_no}」后，其中的源单将被锁定，不能反审核、修改或删除。继续？`, '审核', { type: 'warning' }) } catch { return }
  try { await scmApi.auditStatement(row.id); ElMessage.success('已审核'); load() } catch { /* 拦截器已提示 */ }
}
async function unaudit(row: ScmStatement) {
  try { await ElMessageBox.confirm(`反审核对账单「${row.stmt_no}」？反审核后源单解除锁定。`, '反审核', { type: 'warning' }) } catch { return }
  try { await scmApi.unauditStatement(row.id); ElMessage.success('已反审核'); load() } catch { /* 拦截器已提示 */ }
}
async function del(row: ScmStatement) {
  try { await ElMessageBox.confirm(`删除草稿对账单「${row.stmt_no}」？明细行将释放，可重新对账。`, '提示', { type: 'warning' }) } catch { return }
  try { await scmApi.deleteStatement(row.id); ElMessage.success('已删除'); load() } catch { /* 拦截器已提示 */ }
}
onMounted(load)
onActivated(load)
</script>

<style scoped>
.stl-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .actions { margin-left: auto; display: flex; gap: 8px; }
</style>
