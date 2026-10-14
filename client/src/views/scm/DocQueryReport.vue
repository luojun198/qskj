<template>
  <div class="page dqr-page">
    <div class="filter-row">
      <span class="title">{{ meta.title }}</span>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始" end-placeholder="结束" size="small" style="width:230px" @change="query" />
      <el-select v-model="filters.partner_code" filterable clearable :placeholder="`全部${meta.partnerLabel}`" size="small" style="width:220px" @change="query">
        <el-option v-for="p in partners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-select v-model="filters.status" clearable placeholder="全部状态" size="small" style="width:100px" @change="query">
        <el-option label="草稿" value="draft" /><el-option label="已审核" value="audited" />
      </el-select>
      <el-input v-model="filters.keyword" clearable placeholder="单号 / 物料 / 上游单号 / 备注" size="small" style="width:220px" @keyup.enter="query" @clear="query" />
      <el-button size="small" type="primary" plain :loading="loading" @click="query">查询</el-button>
      <el-button size="small" type="success" plain :disabled="!rows.length" @click="exportExcel">另存</el-button>
      <span class="summary">
        单据 {{ summary.doc_count }} 张　数量 {{ fmtQty(summary.qty) }}　金额 {{ fmtAmount(summary.amount) }}　税额 {{ fmtAmount(summary.tax_amount) }}　价税合计 <b>{{ fmtAmount(summary.amount_with_tax) }}</b>
      </span>
    </div>
    <el-table :data="rows" v-loading="loading" border stripe size="small" height="100%" :span-method="spanMethod">
      <el-table-column label="单据号" width="145">
        <template #default="{ row }"><el-link type="primary" :underline="false" @click="openDoc(row.doc_id, docType, row.status)">{{ row.doc_no }}</el-link></template>
      </el-table-column>
      <el-table-column label="日期" prop="doc_date" width="100" />
      <el-table-column label="状态" width="72" align="center">
        <template #default="{ row }"><el-tag size="small" effect="plain" :type="row.status === 'audited' ? 'success' : 'info'">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template>
      </el-table-column>
      <el-table-column :label="meta.partnerLabel" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
      </el-table-column>
      <el-table-column :label="meta.sourceLabel" width="145">
        <template #default="{ row }">
          <el-link v-if="row.src_doc_id" type="primary" :underline="false" @click="openDoc(row.src_doc_id, row.src_doc_type, 'audited')">{{ row.src_doc_no }}</el-link>
          <span v-else class="muted">无</span>
        </template>
      </el-table-column>
      <el-table-column label="物料编码" prop="item_code" width="110" show-overflow-tooltip />
      <el-table-column label="物料名称" prop="item_name" min-width="140" show-overflow-tooltip />
      <el-table-column label="规格" prop="spec" width="90" show-overflow-tooltip />
      <el-table-column label="单位" prop="unit" width="56" align="center" />
      <el-table-column v-if="isReturn" label="仓库" width="100" show-overflow-tooltip>
        <template #default="{ row }">{{ row.warehouse_name || row.warehouse_code || '' }}</template>
      </el-table-column>
      <el-table-column label="数量" width="86" align="right"><template #default="{ row }">{{ fmtQty(row.qty) }}</template></el-table-column>
      <el-table-column label="单价" width="90" align="right"><template #default="{ row }">{{ fmtQty(row.price) }}</template></el-table-column>
      <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ fmtAmount(row.amount) }}</template></el-table-column>
      <el-table-column label="税额" width="96" align="right"><template #default="{ row }">{{ fmtAmount(row.tax_amount) }}</template></el-table-column>
      <el-table-column label="价税合计" width="116" align="right"><template #default="{ row }">{{ fmtAmount(row.amount_with_tax) }}</template></el-table-column>
      <el-table-column v-if="isReturn" :label="meta.offsetLabel" width="120" align="right">
        <template #default="{ row }">{{ row.arap_offset == null ? '' : fmtAmount(row.arap_offset) }}</template>
      </el-table-column>
      <el-table-column v-if="isReturn" label="未冲减" width="100" align="right">
        <template #default="{ row }"><span :class="{ warn: Number(row.arap_open) > 0 }">{{ row.arap_open == null ? '' : fmtAmount(row.arap_open) }}</span></template>
      </el-table-column>
      <el-table-column label="凭证号" prop="voucher_no" width="100" />
      <el-table-column label="备注" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.remark || row.doc_remark || '' }}</template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[100, 200, 500]" layout="total, sizes, prev, pager, next" small @change="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { scmApi, type ScmPartner } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { todayStr } from '@/utils/format'
import { fmtAmount, fmtQty } from '@/utils/statementDoc'

const props = defineProps<{ docType: 'PR' | 'SR' | 'RP' | 'RS' }>()
const router = useRouter()

const META: Record<string, { title: string; partnerLabel: string; sourceLabel: string; offsetLabel: string }> = {
  PR: { title: '采购退货查询表', partnerLabel: '供应商', sourceLabel: '上游入库单', offsetLabel: '已冲减应付' },
  SR: { title: '销售退货查询表', partnerLabel: '客户', sourceLabel: '上游出库单', offsetLabel: '已冲减应收' },
  RP: { title: '采购发票查询表', partnerLabel: '供应商', sourceLabel: '源单（入库单）', offsetLabel: '' },
  RS: { title: '销售发票查询表', partnerLabel: '客户', sourceLabel: '源单（出库单）', offsetLabel: '' },
}
const meta = computed(() => META[props.docType])
const isReturn = computed(() => props.docType === 'PR' || props.docType === 'SR')

const today = todayStr()
const dateRange = ref<string[] | null>([`${today.slice(0, 7)}-01`, today])
const filters = reactive({ partner_code: '', status: '', keyword: '' })
const partners = ref<ScmPartner[]>([])
const rows = ref<any[]>([])
const total = ref(0); const page = ref(1); const pageSize = ref(100)
const summary = ref({ doc_count: 0, qty: 0, amount: 0, tax_amount: 0, amount_with_tax: 0 })
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await scmApi.getDocQueryReport({
      doc_type: props.docType, start_date: dateRange.value?.[0], end_date: dateRange.value?.[1],
      partner_code: filters.partner_code || undefined, status: filters.status || undefined, keyword: filters.keyword || undefined,
      page: page.value, page_size: pageSize.value,
    })
    rows.value = r.data.list; total.value = r.data.total; summary.value = r.data.summary
  } catch { /* 拦截器已提示 */ } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function openDoc(id: string, docType: string, status: string) { router.push(scmDocumentRoute(id, docType, status)) }

/** 同一单据的单号 / 日期 / 状态 / 往来单位合并 */
const MERGE = ['单据号', '日期', '状态']
function spanMethod({ row, rowIndex, column }: any) {
  if (!MERGE.includes(column.label) && column.label !== meta.value.partnerLabel) return [1, 1]
  const list = rows.value
  if (rowIndex > 0 && list[rowIndex - 1].doc_id === row.doc_id) return [0, 0]
  let n = 1
  while (rowIndex + n < list.length && list[rowIndex + n].doc_id === row.doc_id) n++
  return [n, 1]
}

async function exportExcel() {
  const cols: any[] = [
    { label: '单据号', width: 130, value: (r: any) => r.doc_no },
    { label: '日期', width: 90, value: (r: any) => r.doc_date },
    { label: '状态', width: 64, value: (r: any) => (r.status === 'audited' ? '已审核' : '草稿') },
    { label: meta.value.partnerLabel, width: 170, value: (r: any) => `${r.partner_code} ${r.partner_name || ''}` },
    { label: meta.value.sourceLabel, width: 130, value: (r: any) => r.src_doc_no || '' },
    { label: '物料编码', width: 110, value: (r: any) => r.item_code || '' },
    { label: '物料名称', width: 150, value: (r: any) => r.item_name || '' },
    { label: '规格', width: 90, value: (r: any) => r.spec || '' },
    { label: '单位', width: 50, align: 'center', value: (r: any) => r.unit || '' },
    { label: '数量', width: 80, align: 'right', type: 'number', value: (r: any) => Number(r.qty) || 0 },
    { label: '单价', width: 80, align: 'right', type: 'number', value: (r: any) => Number(r.price) || 0 },
    { label: '金额', width: 100, align: 'right', type: 'amount', value: (r: any) => r.amount },
    { label: '税额', width: 90, align: 'right', type: 'amount', value: (r: any) => r.tax_amount },
    { label: '价税合计', width: 110, align: 'right', type: 'amount', value: (r: any) => r.amount_with_tax },
  ]
  if (isReturn.value) cols.push({ label: meta.value.offsetLabel, width: 110, align: 'right', type: 'amount', value: (r: any) => r.arap_offset ?? '' })
  cols.push({ label: '凭证号', width: 90, value: (r: any) => r.voucher_no || '' })
  await exportStyledTable({
    fileName: `${meta.value.title}_${todayStr()}.xlsx`,
    sheetName: meta.value.title,
    title: meta.value.title,
    subtitle: `期间：${dateRange.value?.[0] || '起始'} ~ ${dateRange.value?.[1] || '至今'}`,
    rows: rows.value,
    stripe: true,
    columns: cols,
  })
}

onMounted(async () => {
  const p = await scmApi.getPartners({})
  if (p.code === 0) partners.value = p.data as ScmPartner[]
  await load()
})
</script>

<style scoped>
.dqr-page { display: flex; flex-direction: column; height: 100%; padding: var(--page-pad); gap: var(--block-gap); }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-row .title { font-weight: 600; }
.filter-row .summary { margin-left: auto; font-size: 12px; color: var(--el-text-color-regular); }
.muted { color: var(--el-text-color-placeholder); }
.warn { color: var(--el-color-warning); }
</style>
