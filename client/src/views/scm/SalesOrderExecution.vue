<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>销售订单执行表</b></div>
      <span class="report-header__note">订单 → 库存 / 自制在产 / 委外在产 / 采购在途 → 发货 一张表看齐：未发 = 订单量 − 已发货（扣退货）；在产 = 关联工单（直推或经 MRP）计划 − 完工 − 报废；预计可交 = 关联工单排程 / 计划完工的最晚日。</span>
    </div>
    <div class="toolbar">
      <el-input v-model="filters.keyword" clearable placeholder="订单号 / 客户 / 物料" size="small" style="width:200px" @keyup.enter="query" @clear="query" />
      <el-radio-group v-model="filters.status" size="small" @change="query">
        <el-radio-button value="open">未完成</el-radio-button><el-radio-button value="done">已完成</el-radio-button><el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="订单日期从" end-placeholder="至" size="small" style="width:240px" @change="query" />
      <el-checkbox v-model="onlyOverdue" size="small" @change="query">仅看逾期</el-checkbox>
      <el-button type="primary" size="small" :loading="loading" @click="query">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
      <el-button type="success" plain size="small" :loading="exporting" @click="exportExcel">另存</el-button>
    </div>
    <div class="summary-grid">
      <div><span>订单行</span><b>{{ summary.lines || 0 }}</b></div>
      <div><span>订单量 / 已发 / 未发</span><b>{{ num(summary.order_qty) }} / {{ num(summary.shipped_qty) }} / {{ num(summary.open_qty) }}</b></div>
      <div><span>可发货行</span><b class="ok">{{ summary.ready_lines || 0 }}</b></div>
      <div><span>逾期行</span><b :class="{ warn: summary.overdue_lines > 0 }">{{ summary.overdue_lines || 0 }}</b></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%">
        <el-table-column label="订单号" width="150" fixed="left"><template #default="{ row }"><el-link type="primary" @click="openDoc(row)">{{ row.doc_no }}</el-link></template></el-table-column>
        <el-table-column label="日期" prop="doc_date" width="105" />
        <el-table-column label="交货日期" width="105"><template #default="{ row }"><span :class="{ warn: row.overdue }">{{ row.expect_date || '-' }}</span></template></el-table-column>
        <el-table-column label="客户" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ row.partner_name || row.partner_code }}</template></el-table-column>
        <el-table-column label="物料" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template></el-table-column>
        <el-table-column label="订单量" width="85" align="right"><template #default="{ row }">{{ num(row.order_qty) }}</template></el-table-column>
        <el-table-column label="已发货" width="85" align="right"><template #default="{ row }">{{ num(row.shipped_qty) }}</template></el-table-column>
        <el-table-column label="未发" width="80" align="right"><template #default="{ row }"><b>{{ cell(row.open_qty) }}</b></template></el-table-column>
        <el-table-column label="现有库存" width="90" align="right"><template #default="{ row }"><span :class="{ ok: row.ready }">{{ num(row.on_hand) }}</span></template></el-table-column>
        <el-table-column label="自制在产" width="90" align="right"><template #default="{ row }">{{ cell(row.wip_qty) }}</template></el-table-column>
        <el-table-column label="委外在产" width="90" align="right"><template #default="{ row }">{{ cell(row.outsource_wip_qty) }}</template></el-table-column>
        <el-table-column label="采购在途" width="90" align="right"><template #default="{ row }">{{ cell(row.po_open_qty) }}</template></el-table-column>
        <el-table-column label="预计可交" width="105"><template #default="{ row }"><span :class="{ warn: row.est_ready_date && row.expect_date && row.est_ready_date > row.expect_date }">{{ row.est_ready_date || '' }}</span></template></el-table-column>
        <el-table-column label="关联工单" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ (row.wip_plans || []).join('、') }}</template></el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.open_qty <= 0" size="small" type="success" effect="plain">已完成</el-tag>
            <el-tag v-else-if="row.ready" size="small" type="success">可发货</el-tag>
            <el-tag v-else-if="row.overdue" size="small" type="danger">逾期</el-tag>
            <el-tag v-else size="small" type="warning" effect="plain">待生产/采购</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" small @change="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'
import FilterClearButton from '@/components/common/FilterClearButton.vue'

const router = useRouter()
const filters = ref({ keyword: '', status: 'open' })
const dateRange = ref<string[] | null>(null)
const onlyOverdue = ref(false)
const rows = ref<any[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(50)
const summary = ref<Record<string, number>>({})
const loading = ref(false); const exporting = ref(false)
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const cell = (v: any) => Number(v) ? num(v) : ''
const params = () => ({ ...filters.value, start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], overdue: onlyOverdue.value ? '1' : undefined, page: page.value, page_size: pageSize.value })
async function load() {
  loading.value = true
  try { const r = await scmApi.getSalesOrderExecution(params()); if (r.code === 0) { rows.value = r.data.rows; total.value = r.data.total; summary.value = r.data.summary } } finally { loading.value = false }
}
function query() { page.value = 1; load() }
function clear() { filters.value = { keyword: '', status: 'open' }; dateRange.value = null; onlyOverdue.value = false; query() }
function openDoc(row: any) { router.push(scmDownstreamDocRoute(row.doc_id, 'audited', undefined, 'SOa')) }
async function exportExcel() {
  exporting.value = true
  try { const blob = await scmApi.exportSalesOrderExecution(params()); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '销售订单执行表.xlsx'; a.click(); URL.revokeObjectURL(url) } finally { exporting.value = false }
}
onMounted(load)
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.rpt-table{flex:1;min-height:220px}.warn{color:var(--el-color-danger)}.ok{color:var(--el-color-success)}
</style>
