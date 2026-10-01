<template>
  <div class="page outsource-page">
    <div class="report-header">
      <div class="report-header__left"><el-button link @click="router.back()"><el-icon><ArrowLeft /></el-icon>返回</el-button><span>/</span><b>委外执行及结存表</b></div>
      <span class="report-header__note">理论结存不等同于委外厂实盘库存</span>
    </div>
    <div class="toolbar">
      <el-input v-model="filters.plan_code" clearable placeholder="委外计划号" style="width:150px" />
      <el-select v-model="filters.supplier_code" clearable filterable placeholder="委外厂" style="width:200px"><el-option v-for="p in suppliers" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" /></el-select>
      <el-input v-model="filters.item_code" clearable placeholder="成品编码/名称" style="width:160px" />
      <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" style="width:240px" />
      <el-select v-model="filters.status" clearable placeholder="执行状态" style="width:130px"><el-option v-for="s in ['未入库','部分入库','已完成']" :key="s" :label="s" :value="s" /></el-select>
      <el-button type="primary" :loading="loading" @click="query">查询</el-button><FilterClearButton size="small" @clear="handleClearFilters" /><el-button type="success" plain :loading="exporting" @click="exportExcel">导出Excel</el-button>
    </div>
    <div class="cards"><div><span>委外计划数</span><b>{{ summary.plan_count || 0 }}</b></div><div><span>计划数量</span><b>{{ num(summary.plan_qty) }}</b></div><div><span>已入库</span><b>{{ num(summary.finished_qty) }}</b></div><div><span>未完成</span><b>{{ num(summary.remaining_qty) }}</b></div><div><span>含税加工费</span><b>{{ money(summary.fee_gross) }}</b></div><div><span>未付金额</span><b>{{ money(summary.outstanding_amount) }}</b></div></div>
    <div class="table-wrap"><el-table v-loading="loading" :data="rows" border stripe height="100%" @sort-change="onSortChange">
      <el-table-column label="委外计划号" prop="plan_code" sortable="custom" min-width="160" fixed="left"><template #default="{ row }"><el-link type="primary" @click="openPlan(row)">{{ row.plan_code }}</el-link></template></el-table-column>
      <el-table-column prop="supplier_code" label="委外厂" min-width="150" show-overflow-tooltip sortable="custom"><template #default="{ row }">{{ row.supplier_name }}</template></el-table-column><el-table-column prop="item_code" label="成品编码" width="120" sortable="custom" /><el-table-column prop="item_name" label="成品名称" min-width="150" />
      <el-table-column label="计划数量" prop="plan_qty" sortable="custom" width="110" align="right"><template #default="{row}">{{ num(row.plan_qty) }}</template></el-table-column><el-table-column label="已入库" prop="finished_qty" sortable="custom" width="105" align="right"><template #default="{row}">{{ num(row.finished_qty) }}</template></el-table-column><el-table-column label="未完成" width="95" align="right"><template #default="{row}">{{ num(row.remaining_qty) }}</template></el-table-column>
      <el-table-column label="完成率" prop="completion_rate" sortable="custom" width="105" align="right"><template #default="{row}">{{ row.completion_rate }}%</template></el-table-column><el-table-column label="委外发料" width="100" align="right"><template #default="{row}">{{ num(row.outsource_issue_qty) }}</template></el-table-column><el-table-column label="委外退料" width="100" align="right"><template #default="{row}">{{ num(row.outsource_return_qty) }}</template></el-table-column><el-table-column label="净发料" width="100" align="right"><template #default="{row}">{{ num(row.issued_material_qty) }}</template></el-table-column><el-table-column label="材料成本" width="110" align="right"><template #default="{row}">{{ money(row.issued_material_cost) }}</template></el-table-column>
      <el-table-column prop="theoretical_balance" label="委外厂理论结存" min-width="190" show-overflow-tooltip /><el-table-column label="税前加工费" width="115" align="right"><template #default="{row}">{{ money(row.fee_ex_tax) }}</template></el-table-column><el-table-column label="税额" width="100" align="right"><template #default="{row}">{{ money(row.fee_tax) }}</template></el-table-column><el-table-column label="含税加工费" width="115" align="right"><template #default="{row}">{{ money(row.fee_gross) }}</template></el-table-column>
      <el-table-column label="已付" width="105" align="right"><template #default="{row}">{{ money(row.paid_amount) }}</template></el-table-column><el-table-column label="未付" prop="outstanding_amount" sortable="custom" width="110" align="right"><template #default="{row}">{{ money(row.outstanding_amount) }}</template></el-table-column><el-table-column prop="execution_status" label="执行状态" width="100" fixed="right"><template #default="{row}"><el-tag :type="row.execution_status==='已完成'?'success':row.execution_status==='部分入库'?'warning':'info'" effect="plain">{{ row.execution_status }}</el-tag></template></el-table-column>
    </el-table></div>
    <div class="tip">委外厂理论结存＝已审核委外发料－退料－已完工标准耗用；该数值不是委外厂实盘库存。</div>
    <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20,50,100,200]" layout="total, sizes, prev, pager, next" @change="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'; import { useRouter } from 'vue-router'; import { scmApi } from '@/api/scm'; import { ArrowLeft } from '@element-plus/icons-vue'
import FilterClearButton from '@/components/common/FilterClearButton.vue'; import { useFilterClear } from '@/composables/useFilterClear'
const router=useRouter(); const loading=ref(false),exporting=ref(false),rows=ref<any[]>([]),total=ref(0),page=ref(1),pageSize=ref(50); const suppliers=ref<any[]>([]); const summary=ref<Record<string,number>>({}); const dateRange=ref<[string,string]|[]>([]); const filters=ref({plan_code:'',supplier_code:'',item_code:'',status:''})
const sortField=ref(''),sortOrder=ref<'asc'|'desc'|''>('')
// 后端支持 sort_field/sort_order（§5.3 原前端未接）：表头点击排序走服务端，分页结果才是全局有序
function onSortChange({prop,order}:{prop?:string;order?:string|null}){sortField.value=order?String(prop||''):'';sortOrder.value=order==='ascending'?'asc':order==='descending'?'desc':'';query()}
const params=()=>({...filters.value,start_date:dateRange.value[0]||undefined,end_date:dateRange.value[1]||undefined,sort_field:sortField.value||undefined,sort_order:sortOrder.value||undefined,page:page.value,page_size:pageSize.value}); const num=(v:any)=>(Number(v)||0).toLocaleString('zh-CN',{maximumFractionDigits:6}); const money=(v:any)=>(Number(v)||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
async function load(){loading.value=true;try{const r=await scmApi.getOutsourceExecution(params());if(r.code===0){rows.value=r.data.rows;total.value=r.data.total;summary.value=r.data.summary}}finally{loading.value=false}} function query(){page.value=1;load()} function openPlan(row:any){router.push({name:'ScmProductionOrder',params:{id:row.plan_id}})}
async function exportExcel(){exporting.value=true;try{const blob=await scmApi.exportOutsourceExecution(params());const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='委外执行及结存表.xlsx';a.click();URL.revokeObjectURL(url)}finally{exporting.value=false}}
const { clearFilters } = useFilterClear([filters, dateRange])
/** 清空筛选条件并恢复默认查询 */
function handleClearFilters(){ clearFilters(); page.value = 1; load() }
onMounted(async()=>{const r=await scmApi.getPartners({partner_type:'supplier'});suppliers.value=(r.data||[]).filter((p:any)=>p.is_outsource===1);load()})
</script>
<style scoped>.outsource-page{height:100%;display:flex;flex-direction:column;padding:var(--page-pad);gap:var(--block-gap)}.report-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--el-border-color-lighter);padding-bottom:4px}.report-header__left{display:flex;align-items:center;gap:8px}.report-header__note{font-size:12px;color:var(--el-text-color-secondary)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.cards{display:flex;flex-wrap:wrap;gap:6px}.cards>div{display:flex;align-items:baseline;gap:8px;padding:3px 12px;border:1px solid var(--el-border-color-light);border-radius:6px}.cards span{font-size:12px;color:var(--el-text-color-secondary)}.cards b{font-size:14px}.table-wrap{flex:1;min-height:240px}.tip{font-size:12px;color:var(--el-text-color-secondary)}</style>
