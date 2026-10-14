<template>
  <div class="page sdr-page">
    <div class="filter-row">
      <span class="title">对账明细表</span>
      <el-radio-group v-model="filters.direction" size="small" @change="load">
        <el-radio-button value="ap">应付（供应商）</el-radio-button>
        <el-radio-button value="ar">应收（客户）</el-radio-button>
      </el-radio-group>
      <el-select v-model="filters.partner_code" filterable clearable placeholder="全部往来单位" size="small" style="width:220px" @change="load">
        <el-option v-for="p in partners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="load" />
      <el-select v-model="filters.status" clearable placeholder="全部状态" size="small" style="width:110px" @change="load">
        <el-option label="已对账" value="reconciled" /><el-option label="对账中" value="pending" /><el-option label="未对账" value="unreconciled" />
      </el-select>
      <el-button size="small" type="primary" plain :loading="loading" @click="load">查询</el-button>
      <el-button size="small" type="success" plain :disabled="!rows.length" @click="exportExcel">另存</el-button>
      <span class="summary">
        合计 <b>{{ fmtAmount(summary.total) }}</b>　已对账 {{ fmtAmount(summary.reconciled) }}　对账中 {{ fmtAmount(summary.pending) }}　未对账 <b class="warn">{{ fmtAmount(summary.unreconciled) }}</b>
      </span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%">
      <el-table-column type="index" label="序号" width="54" align="center" />
      <el-table-column label="往来单位" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
      </el-table-column>
      <el-table-column label="类别" width="96"><template #default="{ row }">{{ statementCatLabel(row.src_doc_type) }}</template></el-table-column>
      <el-table-column label="单据号" width="145">
        <template #default="{ row }"><el-link type="primary" :underline="false" @click="openDoc(row)">{{ row.src_doc_no }}</el-link></template>
      </el-table-column>
      <el-table-column label="日期" prop="src_doc_date" width="100" />
      <el-table-column label="物料编码" prop="item_code" width="110" show-overflow-tooltip />
      <el-table-column label="物料名称" prop="item_name" min-width="140" show-overflow-tooltip />
      <el-table-column label="规格" prop="spec" width="90" show-overflow-tooltip />
      <el-table-column label="单位" prop="unit" width="56" align="center" />
      <el-table-column label="数量" width="86" align="right"><template #default="{ row }">{{ row.qty == null ? '' : fmtQty(row.qty * row.sign) }}</template></el-table-column>
      <el-table-column label="价税合计" width="116" align="right">
        <template #default="{ row }"><span :class="{ neg: row.signed_amount < 0 }">{{ fmtAmount(row.signed_amount) }}</span></template>
      </el-table-column>
      <el-table-column label="对账状态" width="86" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain" :type="row.recon_status === 'reconciled' ? 'success' : row.recon_status === 'pending' ? 'warning' : 'info'">
            {{ RECON_STATUS_LABEL[row.recon_status] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="对账单号" width="140">
        <template #default="{ row }">
          <el-link v-if="row.statement_id" type="primary" :underline="false" @click="openStatement(row)">{{ row.stmt_no }}</el-link>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { scmApi, type ScmPartner, type ScmStatementLine } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { todayStr } from '@/utils/format'
import { statementCatLabel, RECON_STATUS_LABEL, fmtAmount, fmtQty } from '@/utils/statementDoc'

const route = useRoute()
const router = useRouter()
const today = todayStr()
const filters = reactive({ direction: (route.query.direction === 'ar' ? 'ar' : 'ap') as 'ar' | 'ap', partner_code: '', status: '' })
const dateRange = ref<string[] | null>([`${today.slice(0, 7)}-01`, today])
const partners = ref<ScmPartner[]>([])
const rows = ref<ScmStatementLine[]>([])
const summary = ref({ total: 0, reconciled: 0, pending: 0, unreconciled: 0 })
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getStatementDetailReport({
      direction: filters.direction, partner_code: filters.partner_code || undefined, status: filters.status || undefined,
      date_from: dateRange.value?.[0], date_to: dateRange.value?.[1],
    })
    rows.value = r.data.list
    summary.value = r.data.summary
  } catch { /* 拦截器已提示 */ } finally { loading.value = false }
}
function openDoc(row: ScmStatementLine) { router.push(scmDocumentRoute(row.src_doc_id, row.src_doc_type, 'audited')) }
function openStatement(row: ScmStatementLine) { router.push({ name: 'ScmStatementForm', params: { id: String(row.statement_id) } }) }

async function exportExcel() {
  const title = '对账明细表'
  await exportStyledTable({
    fileName: `${title}_${todayStr()}.xlsx`,
    sheetName: title,
    title,
    subtitle: `${filters.direction === 'ar' ? '应收' : '应付'}　期间：${dateRange.value?.[0] || '起始'} ~ ${dateRange.value?.[1] || '至今'}`,
    rows: rows.value,
    stripe: true,
    summaryValues: ['', '', '', '', '', '', '', '', '', Number(summary.value.total.toFixed(2)), '', ''],
    columns: [
      { label: '往来单位', width: 180, value: (r: any) => `${r.partner_code} ${r.partner_name || ''}` },
      { label: '类别', width: 90, value: (r: any) => statementCatLabel(r.src_doc_type) },
      { label: '单据号', width: 130, value: (r: any) => r.src_doc_no },
      { label: '日期', width: 90, value: (r: any) => r.src_doc_date },
      { label: '物料编码', width: 110, value: (r: any) => r.item_code || '' },
      { label: '物料名称', width: 150, value: (r: any) => r.item_name || '' },
      { label: '规格', width: 90, value: (r: any) => r.spec || '' },
      { label: '单位', width: 50, align: 'center', value: (r: any) => r.unit || '' },
      { label: '数量', width: 80, align: 'right', type: 'number', value: (r: any) => (r.qty == null ? '' : r.qty * r.sign) },
      { label: '价税合计', width: 110, align: 'right', type: 'amount', value: (r: any) => r.signed_amount },
      { label: '对账状态', width: 80, align: 'center', value: (r: any) => RECON_STATUS_LABEL[r.recon_status] || '' },
      { label: '对账单号', width: 130, value: (r: any) => r.stmt_no || '' },
    ],
  })
}

onMounted(async () => {
  const p = await scmApi.getPartners({})
  if (p.code === 0) partners.value = p.data as ScmPartner[]
  await load()
})
</script>

<style scoped>
.sdr-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .summary { margin-left: auto; font-size: 12px; color: var(--el-text-color-regular); }
.warn { color: var(--el-color-warning); }
.neg { color: var(--el-color-danger); }
</style>
