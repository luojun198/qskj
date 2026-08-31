<template>
  <div class="page mrp-form-page" v-loading="loading">
    <div class="form-header">
      <div class="header-left">
        <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="sep">/</span><b>{{ isNew ? '新增 MRP 计算单' : (doc.doc_no || 'MRP 计算单') }}</b>
        <el-tag v-if="!isNew" :type="doc.status === 'audited' ? 'success' : 'info'" size="small">{{ doc.status === 'audited' ? '已审核' : '草稿' }}</el-tag>
      </div>
      <div class="header-actions">
        <template v-if="editable">
          <el-button @click="save(false)" :loading="saving">保存</el-button>
          <el-button v-if="isNew || adjustmentsDirty" type="primary" @click="calculate" :loading="calculating"><el-icon><Refresh /></el-icon>{{ isNew ? '保存并计算' : '保存并重新计算' }}</el-button>
          <el-button v-if="!isNew" type="success" @click="audit">审核</el-button>
        </template>
        <template v-else>
          <el-button plain @click="openTrace">上下游</el-button>
          <el-tag v-if="!shortageDoc && pushProgress === 'full'" type="success" effect="plain">已下推完成</el-tag>
          <el-button v-if="!shortageDoc && lines.length && pushProgress !== 'full'" type="primary" @click="openPushPreview">
            {{ pushProgress === 'part' ? '继续下推' : '预览并下推' }}
          </el-button>
          <el-button v-if="shortageDoc" type="primary" plain @click="openShortage">查看历史缺料单 {{ shortageDoc.doc_no }}</el-button>
          <el-button v-if="!shortageDoc && pushProgress === 'none'" type="warning" plain @click="unaudit">反审核</el-button>
        </template>
      </div>
    </div>

    <el-alert v-if="doc.field_values?.has_cycle" type="error" :closable="false" show-icon>
      BOM 循环：{{ (doc.field_values.cycles || []).map((c:any[]) => c.join(' → ')).join('；') }}
    </el-alert>
    <el-alert v-else-if="doc.status === 'audited' && !lines.length" type="success" :closable="false" show-icon title="本计算单无净缺口，无需下推" />
    <el-alert v-if="shortageDoc" type="info" :closable="false" show-icon title="该计算单已进入历史 MRP→缺料单流程，请继续从历史缺料单下推，系统不会重复建立直接下游。" />
    <el-alert v-if="doc.field_values?.warnings?.length" type="warning" :closable="false" show-icon>
      {{ doc.field_values.warnings.join('；') }}
    </el-alert>

    <el-card shadow="never" class="head-card">
      <el-form :model="doc" inline label-width="90px">
        <el-form-item label="计算日期"><el-date-picker v-model="doc.doc_date" value-format="YYYY-MM-DD" :disabled="!editable" /></el-form-item>
        <el-form-item label="安全库存"><el-switch v-model="includeSafetyStock" :disabled="!editable" active-text="纳入" inactive-text="不纳入" /></el-form-item>
        <el-form-item label="追加调整"><el-checkbox v-model="showAdjustments" :disabled="!editable">启用</el-checkbox></el-form-item>
        <el-form-item v-if="showAdjustments" label="需求放大"><el-input-number v-model="demandMultiplier" :disabled="!editable" :min="0" :max="1000" :precision="2" controls-position="right" @change="markAdjustmentsDirty" /><span class="unit-suffix">%</span></el-form-item>
        <el-form-item label="备注" class="remark-item"><el-input v-model="doc.remark" :disabled="!editable" maxlength="200" /></el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="source-card">
      <template #header><div class="card-title"><b>需求来源</b><span>仅提交来源 ID，物料和数量由服务端重新读取</span></div></template>
      <div v-if="isNew && editable" class="source-toolbar">
        <el-radio-group v-model="sourceKind" size="small" @change="loadOptions">
          <el-radio-button value="sales_order">销售订单</el-radio-button><el-radio-button value="production_plan">生产计划</el-radio-button>
          <el-radio-button value="assembly">组装单</el-radio-button><el-radio-button value="outsource_plan">委外计划</el-radio-button>
        </el-radio-group>
        <el-input v-model="sourceKeyword" placeholder="搜索单号" clearable style="width:190px" @keyup.enter="loadOptions" />
        <el-button :loading="optionsLoading" @click="loadOptions">查询</el-button>
      </div>
      <el-table v-if="isNew && editable" :data="sourceOptions" border size="small" max-height="210" class="option-table">
        <el-table-column label="选择" width="70" align="center"><template #default="{ row }"><el-checkbox :model-value="hasRef(row.kind,row.id)" :disabled="!row.eligible && !hasRef(row.kind,row.id)" @change="toggleRef(row,$event)" /></template></el-table-column>
        <el-table-column label="单号" prop="source_no" min-width="160" /><el-table-column label="日期" prop="doc_date" width="110" />
        <el-table-column label="数量" width="100" align="right"><template #default="{ row }">{{ fmt(row.total_qty) }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.eligible ? 'success' : 'info'" size="small">{{ row.eligible ? '可选择' : row.reason }}</el-tag></template></el-table-column>
      </el-table>
      <el-table v-if="sourceSummaries.length" data-testid="source-summary-table" :data="sourceSummaries" border stripe size="small" max-height="220" class="source-summary-table">
        <el-table-column label="来源类型" width="100"><template #default="{ row }">{{ kindLabel(row.kind) }}</template></el-table-column>
        <el-table-column label="来源单号" min-width="160"><template #default="{ row }"><el-button link type="primary" @click="openSourceSummary(row)">{{ row.source_no }}</el-button></template></el-table-column>
      </el-table>
      <div v-if="isNew && (editable || !sourceSummaries.length)" class="selected-title">已选来源（{{ sourceRefs.length }}）</div>
      <div v-if="isNew && (editable || !sourceSummaries.length)" class="selected-list">
        <el-tag v-for="ref in sourceRefs" :key="ref.kind+ref.id" :closable="editable" class="source-tag" @click="openSource(ref)" @close.stop="removeRef(ref)">{{ kindLabel(ref.kind) }} · {{ sourceLabel(ref) }}</el-tag>
        <el-empty v-if="!sourceRefs.length" description="尚未选择来源单据" :image-size="50" />
      </div>
    </el-card>

    <el-card v-if="sources.length" shadow="never" class="demand-card">
      <template #header><div class="card-title"><b>需求明细</b><span>来源单冻结到本次 MRP 的原始需求</span></div></template>
      <el-table data-testid="source-demand-table" :data="sources" border stripe size="small" max-height="240">
        <el-table-column label="来源单号" min-width="150"><template #default="{ row }"><el-button link type="primary" @click="openSource({ kind: row.source_kind, id: row.source_id })">{{ row.source_no }}</el-button></template></el-table-column>
        <el-table-column label="来源行" width="75" align="center"><template #default="{ row }">{{ row.source_line_seq || '-' }}</template></el-table-column>
        <el-table-column label="物料编码" prop="item_code" min-width="120" />
        <el-table-column label="物料名称" prop="item_name" min-width="140" />
        <el-table-column label="规格" prop="spec" min-width="110" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="70" />
        <el-table-column label="原始需求" width="105" align="right"><template #default="{ row }">{{ fmt(row.demand_qty) }}</template></el-table-column>
        <el-table-column v-if="showAdjustments" label="比例后需求" width="110" align="right"><template #default="{ row }">{{ fmt(sourceProjection(row).multiplied_qty) }}</template></el-table-column>
        <el-table-column v-if="showAdjustments" label="固定追加" width="130" align="right"><template #default="{ row }"><el-input-number v-model="row.extra_qty" :disabled="!editable" :min="0" :precision="0" :step="1" :controls="false" style="width:100%" @change="normalizeExtraQty(row)" /></template></el-table-column>
        <el-table-column label="最终需求" width="105" align="right"><template #default="{ row }"><b>{{ fmt(sourceProjection(row).final_demand_qty) }}</b></template></el-table-column>
        <el-table-column label="已分配净需求" width="120" align="right"><template #default="{ row }">{{ fmt(row.allocated_net_qty) }}</template></el-table-column>
        <el-table-column label="需求日期" prop="need_date" width="110" />
        <el-table-column label="优先级" prop="priority" width="75" align="center" />
      </el-table>
    </el-card>

    <el-card v-if="showAdjustments && targetRows.length" shadow="never" class="target-card">
      <template #header><div class="card-title"><b>物料目标需求量</b><span>填写后覆盖该物料按比例和固定追加汇总出的需求量</span></div></template>
      <el-table :data="targetRows" border stripe size="small" max-height="220">
        <el-table-column label="物料编码" prop="item_code" min-width="130" />
        <el-table-column label="物料名称" prop="item_name" min-width="150" />
        <el-table-column label="最终需求合计" width="130" align="right"><template #default="{ row }">{{ fmt(row.final_qty) }}</template></el-table-column>
        <el-table-column label="目标需求量" width="160" align="right"><template #default="{ row }"><el-input-number v-model="itemTargetQty[row.item_code]" :disabled="!editable" :min="0" :precision="0" :step="1" :controls="false" placeholder="不覆盖" style="width:100%" @change="markTargetDirty(row.item_code)" /></template></el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="result-card">
      <template #header><div class="card-title"><b>净需求结果</b><span v-if="doc.field_values?.calculated_at">计算时间：{{ doc.field_values.calculated_at }}</span></div></template>
      <el-table :data="lines" border stripe size="small" height="100%">
        <el-table-column label="层级" width="65" align="center"><template #default="{ row }">L{{ row.field_values.level }}</template></el-table-column>
        <el-table-column label="物料" min-width="190"><template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template></el-table-column>
        <el-table-column label="父件" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ (row.field_values.parent_item_codes || []).join('、') || '-' }}</template></el-table-column>
        <el-table-column label="毛需求" width="100" align="right"><template #default="{ row }">{{ fmt(row.field_values.gross_req) }}</template></el-table-column>
        <el-table-column label="库存" width="90" align="right"><template #default="{ row }">{{ fmt(row.field_values.on_hand) }}</template></el-table-column>
        <el-table-column label="其他占用" width="95" align="right"><template #default="{ row }">{{ fmt(row.field_values.other_reserved) }}</template></el-table-column>
        <el-table-column label="在途" width="90" align="right"><template #default="{ row }">{{ fmt(row.field_values.in_transit) }}</template></el-table-column>
        <el-table-column label="MRP覆盖" width="95" align="right"><template #default="{ row }">{{ fmt(row.field_values.other_mrp_supply) }}</template></el-table-column>
        <el-table-column label="安全库存" width="95" align="right"><template #default="{ row }">{{ fmt(row.field_values.safety_stock) }}</template></el-table-column>
        <el-table-column label="净需求" width="105" align="right"><template #default="{ row }"><b class="net">{{ fmt(row.field_values.net_req) }}</b></template></el-table-column>
        <el-table-column label="建议量" width="105" align="right"><template #default="{ row }">{{ fmt(row.qty) }}</template></el-table-column>
        <el-table-column label="来源" width="85"><template #default="{ row }">{{ sourceTypeLabel(row.source_type) }}</template></el-table-column>
        <el-table-column label="BOM/提示" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.field_values.bom_code || row.remark || '-' }}</template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh } from '@element-plus/icons-vue'
import { scmApi, type MrpResultLine, type MrpSourceDetail, type MrpSourceKind, type MrpSourceOption, type MrpSourceRef, type MrpSourceSummary } from '@/api/scm'
import { canEditScmDocument, isScmMrpFormRoute, readScmDocNavContext, scmDocNavContextToListQuery, scmDocumentRoute, scmDownstreamDocRoute } from '@/utils/scmDocNavigation'
import { useStateRecovery } from '@/composables/useStateRecovery'
import { useTabsStore } from '@/stores/tabs'

const route=useRoute(), router=useRouter()
const { recoverStateError } = useStateRecovery()
const tabsStore = useTabsStore()
// 本实例挂载时的标签 key 全生命周期不变；MRP 新增页在同一路径下按 query 复用同一标签，
// 下面这个监听全局 route 的 watcher 只应在"我自己这个标签被激活/路由变化"时生效，
// 避免同时打开另一张 MRP 单据标签时，被对方的路由跳转误伤触发（详见 FIX-067 同类问题）。
const myTabKey = tabsStore.activeKey
const isNew=computed(()=>route.name==='ScmMrpNew'), isView=computed(()=>route.name==='ScmMrpView')
const editable=computed(()=>isNew.value || (!isView.value && doc.value.status==='draft'))
const loading=ref(false), saving=ref(false), calculating=ref(false), optionsLoading=ref(false)
const doc=ref<any>({ doc_date:new Date().toISOString().slice(0,10), status:'draft', remark:'', field_values:{} })
const includeSafetyStock=ref(true), showAdjustments=ref(false), demandMultiplier=ref(100), adjustmentsDirty=ref(false), itemTargetQty=ref<Record<string,number>>({}), sourceRefs=ref<MrpSourceRef[]>([]), sourceSummaries=ref<MrpSourceSummary[]>([]), sources=ref<Array<MrpSourceDetail & { extra_qty: number }>>([]), lines=ref<MrpResultLine[]>([])
const shortageDoc=ref<any>(null), sourceKind=ref<MrpSourceKind>('sales_order'), sourceKeyword=ref(''), sourceOptions=ref<MrpSourceOption[]>([])
const selectedLabels=ref(new Map<string,string>())
const pushProgress=computed<'none'|'part'|'full'>(()=>doc.value.push_progress||'none')
const fmt=(v:any)=>(Number(v)||0).toLocaleString('zh-CN',{maximumFractionDigits:6})
type SourceProjection={multiplied_qty:number;target_allocated_qty:number;final_demand_qty:number}
const sourceProjections=computed(()=>{
  const rows=sources.value.map((source,index)=>({ source,index,multiplied_qty:Math.ceil((Number(source.demand_qty)||0)*(Number(demandMultiplier.value)||0)/100),extra_qty:Math.max(0,Math.round(Number(source.extra_qty)||0)),target_allocated_qty:0,final_demand_qty:0 }))
  const groups=new Map<string,typeof rows>()
  for(const row of rows){const group=groups.get(row.source.item_code)||[];group.push(row);groups.set(row.source.item_code,group)}
  for(const [itemCode,group] of groups){
    const target=Number(itemTargetQty.value[itemCode])||0
    const total=group.reduce((sum,row)=>sum+row.multiplied_qty+row.extra_qty,0)
    if(target>0){
      const shares=group.map(row=>{const exact=total>0?target*(row.multiplied_qty+row.extra_qty)/total:target/group.length;const allocated=Math.floor(exact);return {row,allocated,remainder:exact-allocated}}).sort((a,b)=>b.remainder-a.remainder||a.row.index-b.row.index)
      let remain=target-shares.reduce((sum,share)=>sum+share.allocated,0)
      for(let index=0;index<remain;index++) shares[index%shares.length].allocated++
      for(const share of shares){share.row.target_allocated_qty=share.allocated;share.row.final_demand_qty=share.allocated}
    }else for(const row of group) row.final_demand_qty=row.multiplied_qty+row.extra_qty
  }
  return new Map(rows.map(row=>[String(row.source.id),row]))
})
function sourceProjection(source:MrpSourceDetail):SourceProjection{return sourceProjections.value.get(String(source.id))||{multiplied_qty:0,target_allocated_qty:0,final_demand_qty:0}}
const targetRows=computed(()=>{
  const rows=new Map<string,{item_code:string;item_name:string;final_qty:number}>()
  for(const source of sources.value){
    const current=rows.get(source.item_code)||{item_code:source.item_code,item_name:source.item_name||'',final_qty:0}
    current.final_qty+=sourceProjection(source).final_demand_qty
    rows.set(source.item_code,current)
  }
  return [...rows.values()]
})
const kindLabel=(kind:MrpSourceKind)=>({sales_order:'销售订单',production_plan:'生产计划',assembly:'组装单',outsource_plan:'委外计划'}[kind])
const sourceTypeLabel=(v:string)=>({purchase:'采购',self:'自制',outsource:'委外',assembly:'组装'} as any)[v]||v
function markAdjustmentsDirty(){ adjustmentsDirty.value=true }
function normalizeExtraQty(source:MrpSourceDetail & {extra_qty:number}){source.extra_qty=Math.max(0,Math.round(Number(source.extra_qty)||0));markAdjustmentsDirty()}
function markTargetDirty(itemCode:string){
  const value=Math.max(0,Math.round(Number(itemTargetQty.value[itemCode])||0))
  if(value<=0) delete itemTargetQty.value[itemCode]
  else itemTargetQty.value[itemCode]=value
  markAdjustmentsDirty()
}
const refKey=(kind:string,id:string)=>`${kind}:${id}`
const hasRef=(kind:MrpSourceKind,id:string)=>sourceRefs.value.some(r=>r.kind===kind&&r.id===id)
function sourceLabel(ref:MrpSourceRef){ return selectedLabels.value.get(refKey(ref.kind,ref.id)) || ref.id }
function toggleRef(row:MrpSourceOption,checked:any){ if(checked&&!hasRef(row.kind,row.id)){sourceRefs.value.push({kind:row.kind,id:row.id});selectedLabels.value.set(refKey(row.kind,row.id),row.source_no)} else if(!checked) removeRef(row) }
function removeRef(ref:{kind:MrpSourceKind,id:string}){sourceRefs.value=sourceRefs.value.filter(r=>!(r.kind===ref.kind&&r.id===ref.id))}
async function loadOptions(){optionsLoading.value=true;try{const r=await scmApi.getMrpSourceOptions({kind:sourceKind.value,keyword:sourceKeyword.value,exclude_occupied:true,current_mrp_id:isNew.value?undefined:String(route.params.id)});if(r.code===0){sourceOptions.value=r.data||[];for(const row of sourceOptions.value)selectedLabels.value.set(refKey(row.kind,row.id),row.source_no)}}finally{optionsLoading.value=false}}
async function load(){if(!isScmMrpFormRoute(route.name))return;if(isNew.value){const k=route.query.source_kind as MrpSourceKind|undefined;const raw=route.query.source_ids||route.query.source_id||'';const ids=(Array.isArray(raw)?raw:String(raw).split(',')).map(v=>String(v||'').trim()).filter(Boolean);if(k&&ids.length){sourceKind.value=k;sourceRefs.value=Array.from(new Set(ids)).map(id=>({kind:k,id}));if(ids.length>1){await save(false);return}}await loadOptions();return}loading.value=true;try{const r=await scmApi.getMrpDoc(String(route.params.id));if(r.code===0){doc.value=r.data.doc;const expectedRoute=canEditScmDocument('MRP',doc.value.status)?'ScmMrpEdit':'ScmMrpView';if(route.name!==expectedRoute)await router.replace({name:expectedRoute,params:{id:String(route.params.id)},query:route.query});includeSafetyStock.value=doc.value.field_values?.include_safety_stock!==false;demandMultiplier.value=Number(doc.value.field_values?.demand_multiplier) || 100;itemTargetQty.value={...(doc.value.field_values?.item_target_qty||{})};sourceRefs.value=r.data.source_refs||[];sourceSummaries.value=r.data.source_summaries||[];sources.value=(r.data.sources||[]).map((source:any)=>({...source,extra_qty:Number(source.snapshot?.extra_qty)||0}));lines.value=r.data.lines||[];shortageDoc.value=r.data.shortage_doc;adjustmentsDirty.value=false}}catch(error){await recoverStateError(error,{fallbackRoute:{name:'ScmMrp'}})}finally{loading.value=false}}
async function save(show=true){if(!sourceRefs.value.length){ElMessage.warning('请至少选择一张来源单据');return null}saving.value=true;try{if(isNew.value){const r=await scmApi.createMrpDoc({doc_date:doc.value.doc_date,remark:doc.value.remark,include_safety_stock:includeSafetyStock.value,demand_multiplier:demandMultiplier.value,item_target_qty:itemTargetQty.value,sources:sourceRefs.value});if(r.code===0){show&&ElMessage.success('MRP计算单已创建并完成首次计算');await router.replace({name:'ScmMrpEdit',params:{id:r.data.id}});return r.data.id}}else{const r=await scmApi.updateMrpDoc(String(route.params.id),{doc_date:doc.value.doc_date,remark:doc.value.remark,include_safety_stock:includeSafetyStock.value,demand_multiplier:demandMultiplier.value,item_target_qty:itemTargetQty.value,source_adjustments:sources.value.map(source=>({id:String(source.id),extra_qty:Number(source.extra_qty)||0})),sources:sourceRefs.value});if(r.code===0){show&&ElMessage.success('已保存');return String(route.params.id)}}}finally{saving.value=false}return null}
async function calculate(){calculating.value=true;try{const id=await save(false);if(!id)return;if(isNew.value)return;const r=await scmApi.calculateMrpDoc(id);if(r.code===0){ElMessage.success(`计算完成：${r.data.rows} 项净需求`);await load()}}finally{calculating.value=false}}
async function audit(){await ElMessageBox.confirm('审核时将按最新库存、在途和来源状态重新计算并冻结结果，确认继续？','审核MRP',{type:'warning'});const savedId=await save(false);if(!savedId)return;const r=await scmApi.auditMrpDoc(savedId);if(r.code===0){ElMessage.success('审核成功');await router.replace({name:'ScmMrpView',params:{id:savedId}});await load()}}
async function unaudit(){const r=await scmApi.unauditMrpDoc(String(route.params.id));if(r.code===0){ElMessage.success('已反审核');await router.replace({name:'ScmMrpEdit',params:{id:route.params.id}});await load()}}
function openPushPreview(){if(route.params.id)router.push({name:'ScmMrPushPreview',params:{id:route.params.id},query:{from:'mrp'}})}
function openShortage(){if(shortageDoc.value?.id)router.push(scmDownstreamDocRoute(shortageDoc.value.id,shortageDoc.value.status))}
function openTrace(){if(route.params.id)router.push({name:'ScmDocDownstream',params:{id:route.params.id}})}
function goBack(){const context=readScmDocNavContext(route.query);if(context.from_list)router.push({name:'ScmDocList',query:scmDocNavContextToListQuery(context,'MRP')});else router.push({name:'ScmMrp'})}
function openSourceSummary(row:MrpSourceSummary){openSource({kind:row.kind,id:row.id})}
function openSource(ref:MrpSourceRef){
  if(ref.kind==='sales_order'||ref.kind==='assembly')router.push(scmDocumentRoute(ref.id, '', 'draft'))
  else router.push({name:'ScmProductionOrder',params:{id:ref.id}})
}
onMounted(load)
watch(()=>route.fullPath,()=>{if(tabsStore.activeKey!==myTabKey)return;if(isScmMrpFormRoute(route.name))void load()})
</script>

<style scoped>
.mrp-form-page{display:flex;flex-direction:column;height:100%;padding:12px 16px;gap:10px;overflow:auto}.form-header{display:flex;align-items:center;justify-content:space-between}.header-left,.header-actions,.source-toolbar,.card-title{display:flex;align-items:center;gap:8px}.sep{color:var(--el-text-color-secondary)}.head-card :deep(.el-card__body){padding:10px 14px}.head-card :deep(.el-form-item){margin-bottom:0}.remark-item{min-width:360px;flex:1}.source-card :deep(.el-card__body){padding:10px 12px}.card-title{justify-content:space-between}.card-title span{font-size:12px;color:var(--el-text-color-secondary)}.source-toolbar{margin-bottom:8px}.option-table{margin-bottom:8px}.source-summary-table{margin-top:8px}.selected-title{font-size:13px;color:var(--el-text-color-secondary);margin:8px 0 6px}.selected-list{display:flex;gap:6px;flex-wrap:wrap;min-height:32px}.source-tag{cursor:pointer}.selected-list :deep(.el-empty){padding:4px;width:100%}.demand-card :deep(.el-card__body){padding:0}.result-card{flex:1;min-height:260px;display:flex;flex-direction:column}.result-card :deep(.el-card__body){flex:1;min-height:0;padding:0}.net{color:var(--el-color-danger)}
</style>
