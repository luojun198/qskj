<template>
  <div class="page dt-page">
    <div class="dt-header">
      <div class="dt-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="dt-header__sep">/</span>
        <span class="dt-header__title">{{ isPlanMode ? '计划上下游追溯' : '上下游单据追溯' }}</span>
        <template v-if="isPlanMode">
          <el-tag v-if="plan" size="small" type="info" effect="plain">{{ plan.plan_type === 'outsource' ? '委外计划' : '生产计划' }}</el-tag>
          <el-tag v-if="plan?.code" size="small">{{ plan.code }}</el-tag>
          <el-tag v-if="plan?.status" :type="PLAN_STATUS_TYPE[plan.status] || 'info'" size="small" effect="plain">
            {{ PLAN_STATUS_LABEL[plan.status] || plan.status }}
          </el-tag>
        </template>
        <template v-else>
          <el-tag v-if="doc?.doc_type" size="small" type="info" effect="plain">{{ typeName(doc.doc_type) }}</el-tag>
          <el-tag v-if="doc?.doc_no" size="small">{{ doc.doc_no }}</el-tag>
          <el-tag v-if="doc?.status" :type="doc.status === 'audited' ? 'success' : 'info'" size="small" effect="plain">
            {{ doc.status === 'audited' ? '已审核' : '草稿' }}
          </el-tag>
        </template>
      </div>
      <div class="dt-header__right">
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="dt-body" v-loading="loading">
      <el-empty v-if="!loading && !hasAny" description="该单据暂无上下游关联单据" />

      <template v-else>
        <!-- 上游来源：单据（下推父单）与生产/委外计划（本单挂在某工单名下，如领料/完工单的 plan_id）二者可能同时存在，共享一个方向区带 -->
        <div v-if="hasUpstream" class="dt-zone">
          <div class="dt-zone-bar dt-zone-bar--up">
            <el-icon class="dt-zone-bar__icon"><Top /></el-icon>
            <h3 class="dt-zone-bar__name">上游来源</h3>
            <span class="dt-zone-bar__desc">本单由以下上游单据/计划下推生成</span>
            <span class="dt-zone-bar__count">{{ upstreamCount }} 项</span>
          </div>

        <section v-if="upstreamDocs.length" class="dt-group">
          <el-table :data="upstreamDocs" size="small" border stripe class="dt-table" @row-dblclick="viewDoc">
            <el-table-column type="index" label="序号" width="52" align="center" />
            <el-table-column label="类型" width="84">
              <template #default="{ row }">{{ typeName(row.doc_type) }}</template>
            </el-table-column>
            <el-table-column label="单号" prop="doc_no" min-width="150" show-overflow-tooltip />
            <el-table-column label="往来单位" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.partner_name || row.partner_code || '-' }}</template>
            </el-table-column>
            <el-table-column label="日期" prop="doc_date" width="110" />
            <el-table-column label="数量" width="90" align="right">
              <template #default="{ row }">{{ num(row.total_qty) }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
            </el-table-column>
            <el-table-column label="下推进度" width="100" align="center">
              <template #default="{ row }">
                <el-tag v-if="isPushProgressDoc(row.doc_type)" :type="(row.pushed_qty||0) >= (row.total_qty||0) && (row.total_qty||0) > 0 ? 'success' : ((row.pushed_qty||0) > 0 ? 'warning' : 'info')" size="small">
                  {{ row.pushed_qty || 0 }} / {{ row.total_qty || 0 }}
                </el-tag>
                <span v-else class="dt-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="84" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 'audited' ? 'success' : 'info'" size="small">
                  {{ row.status === 'audited' ? '已审核' : '草稿' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" align="center">
              <template #default="{ row }"><ScmDocActions :row="row" @changed="load" /></template>
            </el-table-column>
          </el-table>
        </section>

        <!-- 上游生产/委外计划：本单挂在某工单名下（领料/完工/委外发货入库等的 scm_doc.plan_id） -->
        <section v-if="upstreamOutsourcePlans.length" class="dt-group">
          <div class="dt-group__header">
            <h3>委外计划</h3>
            <span>{{ upstreamOutsourcePlans.length }} 条</span>
          </div>
          <el-table :data="upstreamOutsourcePlans" size="small" border stripe class="dt-table">
            <el-table-column type="index" label="序号" width="48" align="center" />
            <el-table-column label="计划号" prop="code" min-width="160" show-overflow-tooltip />
            <el-table-column label="编号" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_code }}</template>
            </el-table-column>
            <el-table-column label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_name || '' }}</template>
            </el-table-column>
            <el-table-column label="规格" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '' }}</template>
            </el-table-column>
            <el-table-column label="数量" prop="plan_qty" width="100" align="right" />
            <el-table-column label="委外厂" prop="supplier_code" width="120" show-overflow-tooltip />
            <el-table-column label="状态" prop="status" width="90" align="center" />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }"><el-link type="primary" :underline="false" @click="openOrder(row)">工单</el-link></template>
            </el-table-column>
          </el-table>
        </section>
        <section v-if="upstreamSelfPlans.length" class="dt-group">
          <div class="dt-group__header">
            <h3>生产计划</h3>
            <span>{{ upstreamSelfPlans.length }} 条</span>
          </div>
          <el-table :data="upstreamSelfPlans" size="small" border stripe class="dt-table">
            <el-table-column type="index" label="序号" width="48" align="center" />
            <el-table-column label="计划号" prop="code" min-width="160" show-overflow-tooltip />
            <el-table-column label="编号" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_code }}</template>
            </el-table-column>
            <el-table-column label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_name || '' }}</template>
            </el-table-column>
            <el-table-column label="规格" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '' }}</template>
            </el-table-column>
            <el-table-column label="数量" prop="plan_qty" width="100" align="right" />
            <el-table-column label="状态" prop="status" width="90" align="center" />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }"><el-link type="primary" :underline="false" @click="openOrder(row)">工单</el-link></template>
            </el-table-column>
          </el-table>
        </section>
        </div>

        <!-- 下游去向：与上游对称，先给出明确的方向提示，再列出各类下游单据/计划 -->
        <div v-if="hasDownstream" class="dt-zone">
          <div class="dt-zone-bar dt-zone-bar--down">
            <el-icon class="dt-zone-bar__icon"><Bottom /></el-icon>
            <h3 class="dt-zone-bar__name">下游去向</h3>
            <span class="dt-zone-bar__desc">本单已下推产生以下下游单据 / 计划</span>
            <span class="dt-zone-bar__count">{{ downstreamCount }} 项</span>
          </div>

        <!-- 下游单据（采购订单等），按类型分组 -->
        <section v-for="grp in docGroups" :key="grp.type" class="dt-group">
          <div class="dt-group__header">
            <h3>{{ typeName(grp.type) }}</h3>
            <span>{{ grp.rows.length }} 张</span>
          </div>
          <el-table :data="grp.rows" size="small" border stripe class="dt-table" @row-dblclick="viewDoc">
            <el-table-column type="index" label="序号" width="52" align="center" />
            <el-table-column label="单号" prop="doc_no" min-width="150" show-overflow-tooltip />
            <el-table-column label="往来单位" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.partner_name || row.partner_code || '默认供应商' }}</template>
            </el-table-column>
            <el-table-column label="日期" prop="doc_date" width="110" />
            <el-table-column label="数量" width="90" align="right">
              <template #default="{ row }">{{ num(row.total_qty) }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
            </el-table-column>
            <el-table-column label="下推进度" width="100" align="center">
              <template #default="{ row }">
                <el-tag v-if="isPushProgressDoc(row.doc_type)" :type="(row.pushed_qty||0) >= (row.total_qty||0) && (row.total_qty||0) > 0 ? 'success' : ((row.pushed_qty||0) > 0 ? 'warning' : 'info')" size="small">
                  {{ row.pushed_qty || 0 }} / {{ row.total_qty || 0 }}
                </el-tag>
                <span v-else class="dt-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="84" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 'audited' ? 'success' : 'info'" size="small">
                  {{ row.status === 'audited' ? '已审核' : '草稿' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" align="center">
              <template #default="{ row }"><ScmDocActions :row="row" @changed="load" /></template>
            </el-table-column>
          </el-table>
        </section>

        <!-- 委外计划 -->
        <section v-if="outsourcePlans.length" class="dt-group">
          <div class="dt-group__header">
            <h3>委外计划</h3>
            <span>{{ outsourcePlans.length }} 条</span>
            <el-link class="dt-group__more" type="primary" :underline="false" @click="goPlans('outsource')">查看全部委外计划</el-link>
          </div>
          <el-table :data="outsourcePlans" size="small" border stripe class="dt-table">
            <el-table-column type="index" label="序号" width="48" align="center" />
            <el-table-column label="计划号" prop="code" min-width="160" show-overflow-tooltip />
            <el-table-column label="编号" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_code }}</template>
            </el-table-column>
            <el-table-column label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_name || '' }}</template>
            </el-table-column>
            <el-table-column label="规格" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '' }}</template>
            </el-table-column>
            <el-table-column label="数量" prop="plan_qty" width="100" align="right" />
            <el-table-column label="委外厂" prop="supplier_code" width="120" show-overflow-tooltip />
            <el-table-column label="状态" prop="status" width="90" align="center" />
            <el-table-column label="操作" width="120" align="center">
              <template #default="{ row }">
                <el-link type="primary" :underline="false" @click="openOrder(row)">工单</el-link>
                <el-link v-if="isPlanDraft(row)" type="danger" :underline="false" class="dt-op-del" @click="handleDeletePlan(row)">删除</el-link>
              </template>
            </el-table-column>
          </el-table>
        </section>

        <!-- 生产计划 -->
        <section v-if="selfPlans.length" class="dt-group">
          <div class="dt-group__header">
            <h3>生产计划</h3>
            <span>{{ selfPlans.length }} 条</span>
            <el-link class="dt-group__more" type="primary" :underline="false" @click="goPlans('self')">查看全部生产计划</el-link>
          </div>
          <el-table :data="selfPlans" size="small" border stripe class="dt-table">
            <el-table-column type="index" label="序号" width="48" align="center" />
            <el-table-column label="计划号" prop="code" min-width="160" show-overflow-tooltip />
            <el-table-column label="编号" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_code }}</template>
            </el-table-column>
            <el-table-column label="名称" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">{{ row.item_name || '' }}</template>
            </el-table-column>
            <el-table-column label="规格" width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.spec || '' }}</template>
            </el-table-column>
            <el-table-column label="数量" prop="plan_qty" width="100" align="right" />
            <el-table-column label="状态" prop="status" width="90" align="center" />
            <el-table-column label="操作" width="120" align="center">
              <template #default="{ row }">
                <el-link type="primary" :underline="false" @click="openOrder(row)">工单</el-link>
                <el-link v-if="isPlanDraft(row)" type="danger" :underline="false" class="dt-op-del" @click="handleDeletePlan(row)">删除</el-link>
              </template>
            </el-table-column>
          </el-table>
        </section>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Top, Bottom } from '@element-plus/icons-vue'
import { scmApi, type ScmDoc } from '@/api/scm'
import ScmDocActions from '@/components/scm/ScmDocActions.vue'
import { typeName, isPushProgressDoc } from '@/utils/scmDoc'
import { scmDownstreamDocRoute, scmDownstreamProductionPlanRoute } from '@/utils/scmDocNavigation'

type DownstreamPlan = { id: string; code: string; plan_type: string; item_code: string; item_name?: string; plan_qty: number; supplier_code?: string; status?: string }

const PLAN_STATUS_LABEL: Record<string, string> = { draft: '草稿', released: '已审核', closed: '已关闭' }
const PLAN_STATUS_TYPE: Record<string, 'success' | 'info' | 'warning'> = { draft: 'info', released: 'warning', closed: 'success' }

const route = useRoute()
const router = useRouter()
// 单据上下游追溯（ScmDocDownstream，:id=scm_doc.id）与生产/委外计划上下游追溯（ScmProductionPlanDownstream，
// :id=scm_production_plan.id）共用本页面：两者 id 命名空间不同，靠路由名分流调用哪个后端接口、渲染哪套表头。
const isPlanMode = computed(() => route.name === 'ScmProductionPlanDownstream')
const recordId = computed(() => route.params.id as string)

const loading = ref(false)
const doc = ref<ScmDoc | null>(null)
const plan = ref<any | null>(null)
const upstreamDocs = ref<ScmDoc[]>([])
const upstreamPlans = ref<DownstreamPlan[]>([])
const downstreamDocs = ref<ScmDoc[]>([])
const downstreamPlans = ref<DownstreamPlan[]>([])

const num = (v: any) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const docGroups = computed(() => {
  const map = new Map<string, ScmDoc[]>()
  for (const d of downstreamDocs.value) {
    if (!map.has(d.doc_type)) map.set(d.doc_type, [])
    map.get(d.doc_type)!.push(d)
  }
  return [...map.entries()].map(([type, rows]) => ({ type, rows }))
})
const outsourcePlans = computed(() => downstreamPlans.value.filter(p => p.plan_type === 'outsource'))
const selfPlans = computed(() => downstreamPlans.value.filter(p => (p.plan_type || 'self') !== 'outsource'))
const upstreamOutsourcePlans = computed(() => upstreamPlans.value.filter(p => p.plan_type === 'outsource'))
const upstreamSelfPlans = computed(() => upstreamPlans.value.filter(p => (p.plan_type || 'self') !== 'outsource'))
// 上游来源 / 下游去向：单据 + 委外/生产计划合计，用于对应方向区带的统一计数与显隐
const hasUpstream = computed(() => upstreamDocs.value.length > 0 || upstreamPlans.value.length > 0)
const upstreamCount = computed(() => upstreamDocs.value.length + upstreamPlans.value.length)
const hasDownstream = computed(() => downstreamDocs.value.length > 0 || downstreamPlans.value.length > 0)
const downstreamCount = computed(() => downstreamDocs.value.length + downstreamPlans.value.length)
const hasAny = computed(() => hasUpstream.value || hasDownstream.value)

function goBack() {
  if (isPlanMode.value) router.push({ name: 'ScmProductionPlan', query: { plan_type: plan.value?.plan_type || 'self' } })
  else router.push({ name: 'ScmDocList', query: { doc_type: doc.value?.doc_type || 'MR' } })
}
function viewDoc(row: ScmDoc) {
  if (row.id) router.push(scmDownstreamDocRoute(row.id, row.status, undefined, row.doc_type))
}
function goPlans(planType: 'outsource' | 'self') {
  router.push({ name: 'ScmProductionPlan', query: { plan_type: planType } })
}
// 草稿进入计划编辑页；已审核/关闭后进入工单执行页
function openOrder(row: DownstreamPlan) {
  router.push(scmDownstreamProductionPlanRoute(row.id, row.status))
}

// 计划草稿（未审核）判定
const isPlanDraft = (row: DownstreamPlan) => (row.status || 'draft') !== 'audited'

// 删除草稿委外/生产计划
async function handleDeletePlan(row: DownstreamPlan) {
  try {
    await ElMessageBox.confirm(`确定删除草稿计划 ${row.code}？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  const r = await scmApi.deleteProductionPlan(row.id)
  if (r.code === 0) { ElMessage.success('已删除'); load() }
}

async function load() {
  loading.value = true
  try {
    if (isPlanMode.value) {
      const res = await scmApi.getProductionPlanDownstream(recordId.value)
      if (res.code === 0) {
        plan.value = res.data.plan
        doc.value = null
        upstreamDocs.value = res.data.upstream_docs || []
        upstreamPlans.value = []
        downstreamDocs.value = res.data.downstream_docs || []
        downstreamPlans.value = []
      }
      return
    }
    const res = await scmApi.getDocDownstream(recordId.value)
    if (res.code === 0) {
      doc.value = res.data.doc
      plan.value = null
      upstreamDocs.value = res.data.upstream_docs || []
      upstreamPlans.value = res.data.upstream_plans || []
      downstreamDocs.value = res.data.downstream_docs || []
      downstreamPlans.value = res.data.downstream_plans || []
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.dt-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.dt-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap;
}
.dt-header__left, .dt-header__right { display: flex; align-items: center; gap: 8px; }
.dt-header__sep { color: var(--el-text-color-placeholder); }
.dt-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.dt-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; overflow: auto; }
/* 下游去向：把多张下游表收拢为一个区，区内各表之间留间距 */
.dt-zone { display: flex; flex-direction: column; gap: 12px; }
/* 上 / 下游方向区带：明确提示当前表属于「上游来源」还是「下游去向」 */
.dt-zone-bar {
  display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-radius: 8px; border: 1px solid var(--el-border-color-lighter);
}
.dt-zone-bar__icon { font-size: 16px; }
.dt-zone-bar__name { margin: 0; font-size: var(--cw-text-base); font-weight: 600; }
.dt-zone-bar__desc { font-size: 12px; color: var(--el-text-color-secondary); }
.dt-zone-bar__count { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
/* 上游：蓝调；下游：绿调，配合箭头方向一眼区分 */
.dt-zone-bar--up { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-7); }
.dt-zone-bar--up .dt-zone-bar__icon, .dt-zone-bar--up .dt-zone-bar__name { color: var(--el-color-primary); }
.dt-zone-bar--down { background: var(--el-color-success-light-9); border-color: var(--el-color-success-light-7); }
.dt-zone-bar--down .dt-zone-bar__icon, .dt-zone-bar--down .dt-zone-bar__name { color: var(--el-color-success); }
/* 上游区带嵌在卡片顶部，去掉圆角下沿与外层重叠 */
.dt-group > .dt-zone-bar--up { border: none; border-radius: 0; border-bottom: 1px solid var(--el-color-primary-light-7); }
.dt-group { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: #fff; overflow: hidden; }
.dt-group__header {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: var(--el-fill-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter);
}
.dt-group__header h3 { margin: 0; font-size: var(--cw-text-base); }
.dt-group__header span { font-size: 12px; color: var(--el-text-color-secondary); }
.dt-group__more { margin-left: auto; font-size: var(--cw-text-base); }
.dt-table { width: 100%; }
.dt-muted { color: var(--el-text-color-placeholder); }
.dt-op-del { margin-left: 8px; }
</style>
