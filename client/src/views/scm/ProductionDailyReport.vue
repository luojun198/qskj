<template>
  <div class="page rpt-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>生产日报</b></div>
      <span class="report-header__note">自制工单按日期汇总：净领料（领料 + 补料 − 退料）、报工（合格 / 不良 / 工时 / 人工 / 制费）、完工入库、不良品入库；只统计已审核单据与报工</span>
    </div>
    <div class="toolbar">
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" size="small" style="width:240px" />
      <el-input v-model="deptCode" clearable placeholder="部门编码" size="small" style="width:120px" @keyup.enter="load" />
      <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      <FilterClearButton size="small" @clear="clear" />
      <el-button type="success" plain size="small" :loading="exporting" @click="exportExcel">另存</el-button>
    </div>
    <div class="summary-grid">
      <div><span>活动工单</span><b>{{ summary.plans_active || 0 }}</b></div>
      <div><span>净领料</span><b>{{ num(summary.issue_qty) }}</b><i>{{ money(summary.issue_amount) }}</i></div>
      <div><span>报工 合格 / 不良</span><b>{{ num(summary.report_qty) }} / {{ num(summary.report_scrap) }}</b><i>工时 {{ num(summary.work_hours) }}</i></div>
      <div><span>人工 / 制费</span><b>{{ money(summary.labor_amount) }}</b><i>{{ money(summary.overhead_amount) }}</i></div>
      <div><span>完工入库</span><b>{{ num(summary.finish_qty) }}</b><i>{{ money(summary.finish_amount) }}</i></div>
      <div><span>不良品入库</span><b>{{ num(summary.defect_qty) }}</b><i>{{ money(summary.defect_amount) }}</i></div>
    </div>
    <div class="rpt-table">
      <el-table v-loading="loading" :data="rows" border stripe height="100%" show-summary :summary-method="sumRow">
        <el-table-column prop="date" label="日期" width="110" fixed="left" />
        <el-table-column label="活动工单" width="90" align="right"><template #default="{ row }">{{ row.plans_active }}</template></el-table-column>
        <el-table-column label="领料" align="center">
          <el-table-column label="净领料数量" width="105" align="right"><template #default="{ row }">{{ cell(row.issue_qty) }}</template></el-table-column>
          <el-table-column label="净领料金额" width="110" align="right"><template #default="{ row }">{{ cellMoney(row.issue_amount) }}</template></el-table-column>
        </el-table-column>
        <el-table-column label="报工" align="center">
          <el-table-column label="单数" width="70" align="right"><template #default="{ row }">{{ row.report_count || '' }}</template></el-table-column>
          <el-table-column label="合格" width="90" align="right"><template #default="{ row }">{{ cell(row.report_qty) }}</template></el-table-column>
          <el-table-column label="不良" width="80" align="right"><template #default="{ row }">{{ cell(row.report_scrap) }}</template></el-table-column>
          <el-table-column label="工时" width="85" align="right"><template #default="{ row }">{{ cell(row.work_hours) }}</template></el-table-column>
          <el-table-column label="人工" width="100" align="right"><template #default="{ row }">{{ cellMoney(row.labor_amount) }}</template></el-table-column>
          <el-table-column label="制费" width="100" align="right"><template #default="{ row }">{{ cellMoney(row.overhead_amount) }}</template></el-table-column>
        </el-table-column>
        <el-table-column label="完工入库" align="center">
          <el-table-column label="数量" width="90" align="right"><template #default="{ row }">{{ cell(row.finish_qty) }}</template></el-table-column>
          <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ cellMoney(row.finish_amount) }}</template></el-table-column>
        </el-table-column>
        <el-table-column label="不良品入库" align="center">
          <el-table-column label="数量" width="90" align="right"><template #default="{ row }">{{ cell(row.defect_qty) }}</template></el-table-column>
          <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ cellMoney(row.defect_amount) }}</template></el-table-column>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import FilterClearButton from '@/components/common/FilterClearButton.vue'

const router = useRouter()
const now = new Date(); const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const dateRange = ref<string[] | null>([first, today])
const deptCode = ref('')
const rows = ref<any[]>([]); const summary = ref<Record<string, any>>({})
const loading = ref(false); const exporting = ref(false)
const num = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const money = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cell = (v: any) => Number(v) ? num(v) : ''
const cellMoney = (v: any) => Number(v) ? money(v) : ''
const params = () => ({ start_date: dateRange.value?.[0], end_date: dateRange.value?.[1], dept_code: deptCode.value || undefined })
function sumRow() {
  const s = summary.value
  return ['合计', String(s.plans_active || 0), num(s.issue_qty), money(s.issue_amount), String(s.report_count || 0), num(s.report_qty), num(s.report_scrap), num(s.work_hours), money(s.labor_amount), money(s.overhead_amount), num(s.finish_qty), money(s.finish_amount), num(s.defect_qty), money(s.defect_amount)]
}
async function load() {
  loading.value = true
  try { const r = await scmApi.getProductionDaily(params()); if (r.code === 0) { rows.value = r.data.rows; summary.value = r.data.summary } } finally { loading.value = false }
}
function clear() { deptCode.value = ''; dateRange.value = [first, today]; load() }
async function exportExcel() {
  exporting.value = true
  try { const blob = await scmApi.exportProductionDaily(params()); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '生产日报.xlsx'; a.click(); URL.revokeObjectURL(url) } finally { exporting.value = false }
}
onMounted(load)
</script>

<style scoped>
.rpt-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px;gap:16px}.report-header__left{display:flex;align-items:center;gap:8px;flex:none}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.summary-grid{display:flex;flex-wrap:wrap;gap:6px}.summary-grid>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px;background:var(--el-bg-color)}.summary-grid span{font-size:12px;color:var(--el-text-color-secondary)}.summary-grid b{font-size:14px}.summary-grid i{font-style:normal;font-size:12px;color:var(--el-text-color-secondary)}.rpt-table{flex:1;min-height:220px}
</style>
