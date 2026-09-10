<template>
  <div class="page wo-page">
    <div class="wo-header">
      <div class="wo-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="wo-header__sep">/</span>
        <span class="wo-header__title">工单</span>
        <el-tag v-if="plan?.code" size="small">{{ plan.code }}</el-tag>
        <el-tag v-if="plan" :type="STATUS_TYPE[plan.status] || 'info'" size="small" effect="plain">{{ STATUS_LABEL[plan.status] || plan.status }}</el-tag>
        <el-tag v-if="issueState.status === 'completed'" type="success" size="small" effect="plain">{{ isOut ? '已发料齐' : '已领齐' }}</el-tag>
        <el-tag v-else-if="issueState.status === 'not_required'" type="info" size="small" effect="plain">无需领料</el-tag>
        <el-tag v-else-if="issueState.reason" type="warning" size="small" effect="plain" :title="issueState.reason">领料已锁定</el-tag>
        <el-tag v-if="finishState.status === 'completed'" type="success" size="small" effect="plain">已完工</el-tag>
      </div>
      <div class="wo-header__right">
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        <ScmPushMenu v-if="plan && plan.status === 'released'" :source-kind="isOut ? 'outsource_plan' : 'production_plan'"
          :source-id="id" :local-actions="['issue', 'finish']" @action="handlePushAction" />
        <el-button v-if="plan && plan.status === 'draft'" type="primary" size="small" :loading="busy" @click="onRelease">审核</el-button>
        <el-button v-if="plan && plan.status === 'released' && !docs.length" type="warning" plain size="small" :loading="busy"
          :disabled="!!plan.mrp_status" :title="plan.mrp_status ? `已进入 MRP 计算单 ${plan.mrp_doc_no || ''}，不能反审核` : '反审核'"
          @click="onUnrelease">反审核</el-button>
        <el-button v-if="plan && plan.status === 'released'" size="small" :loading="busy" @click="onClose">关闭工单</el-button>
        <el-button v-if="plan && plan.status === 'closed'" type="warning" plain size="small" :loading="busy" @click="onReopen">重开工单</el-button>
      </div>
    </div>

    <div class="wo-body" v-loading="loading">
      <!-- 汇总卡片 -->
      <div class="wo-cards" v-if="plan">
        <div class="wo-card"><span>成品数</span><b>{{ products.length }} 个</b></div>
        <div class="wo-card"><span>计划总数 / 已完工</span><b>{{ num(cost.totalPlanQty ?? plan.plan_qty) }} / {{ num(totalFinished) }}</b></div>
        <div class="wo-card"><span>已领成本</span><b>{{ fmt(cost.issuedCost) }}</b></div>
        <div class="wo-card" :class="{ 'wo-card--warn': Math.abs(cost.wip) > 0.01 }"><span>在制(WIP)</span><b>{{ fmt(cost.wip) }}</b></div>
        <div class="wo-card"><span>{{ isOut ? '委外厂' : '原料仓' }}</span><b>{{ isOut ? (plan.supplier_name || plan.supplier_code || '-') : (plan.yl_warehouse_name || plan.yl_warehouse || '-') }}</b></div>
      </div>

      <!-- 成品明细 -->
      <section class="wo-section" v-if="plan">
        <div class="wo-section__hd"><h3>成品明细</h3><span>{{ products.length }} 个成品</span></div>
        <el-table :data="products" size="small" border stripe>
          <el-table-column type="index" label="序号" width="48" align="center" />
          <el-table-column label="成品编号" width="120" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }}</template></el-table-column>
          <el-table-column label="成品名称" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.item_name || '' }}</template></el-table-column>
          <el-table-column label="计划数" width="90" align="right"><template #default="{ row }">{{ num(row.plan_qty) }}</template></el-table-column>
          <el-table-column label="已完工" width="90" align="right"><template #default="{ row }">{{ num(row.finished_qty) }}</template></el-table-column>
          <el-table-column label="进度" width="140">
            <template #default="{ row }">
              <el-progress :percentage="pct(row)" :stroke-width="10" :status="pct(row) >= 100 ? 'success' : undefined" />
            </template>
          </el-table-column>
          <el-table-column label="成品仓" width="130" show-overflow-tooltip><template #default="{ row }">{{ row.fp_warehouse_name || row.fp_warehouse || '-' }}</template></el-table-column>
          <el-table-column label="每件料成本" width="110" align="right"><template #default="{ row }">{{ fmt(costOf(row.id).mat_unit_cost) }}</template></el-table-column>
          <el-table-column label="已结转料成本" width="120" align="right"><template #default="{ row }">{{ fmt(costOf(row.id).consumed_cost) }}</template></el-table-column>
        </el-table>
      </section>

      <!-- 用料汇总（全部成品） -->
      <section class="wo-section">
        <div class="wo-section__hd"><h3>用料汇总（全部成品）</h3><span>{{ materialRows.length }} 项</span></div>
        <el-empty v-if="!materialRows.length" :image-size="60" description="未指定 BOM/用料，请到「生产计划」页编辑该计划" />
        <el-table v-else :data="materialRows" size="small" border stripe>
          <el-table-column type="index" label="序号" width="48" align="center" />
          <el-table-column label="所属成品" width="120" show-overflow-tooltip><template #default="{ row }">{{ row.product_code }}</template></el-table-column>
          <el-table-column label="物料编号" width="120" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }}</template></el-table-column>
          <el-table-column label="物料名称" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.item_name || '' }}</template></el-table-column>
          <el-table-column label="单位用量" prop="qty" width="100" align="right" />
          <el-table-column label="损耗率%" prop="scrap_rate" width="90" align="right" />
          <el-table-column label="计划总需" width="110" align="right"><template #default="{ row }">{{ num(row.need) }}</template></el-table-column>
          <el-table-column label="已领用" width="110" align="right">
            <template #header>
              已领用
              <el-tooltip content="按已审核领料/退料汇总的净领用数量（工单级，同一物料多成品共享该数量）" placement="top">
                <el-icon class="wo-hd-help"><QuestionFilled /></el-icon>
              </el-tooltip>
            </template>
            <template #default="{ row }">
              <span :class="(Number(row.issued_qty) || 0) >= (Number(row.need) || 0) ? 'wo-issued-ok' : ((Number(row.issued_qty) || 0) > 0 ? '' : 'wo-muted')">{{ num(row.issued_qty) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="领料仓库" width="150" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.warehouse_code">{{ row.warehouse_name || row.warehouse_code }}</span>
              <span v-else class="wo-muted">默认原料仓{{ (plan?.yl_warehouse_name || plan?.yl_warehouse) ? '（' + (plan.yl_warehouse_name || plan.yl_warehouse) + '）' : '' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <!-- 关联单据 -->
      <section class="wo-section">
        <div class="wo-section__hd"><h3>关联单据（领料 / 完工）</h3><span>{{ docs.length }} 张</span></div>
        <el-empty v-if="!docs.length" description="暂无领料/完工单据" :image-size="60" />
        <el-table v-else :data="docs" size="small" border stripe @row-dblclick="openDoc">
          <el-table-column type="index" label="序号" width="48" align="center" />
          <el-table-column label="类型" width="100"><template #default="{ row }">{{ typeName(row.doc_type) }}</template></el-table-column>
          <el-table-column label="单号" prop="doc_no" min-width="150" show-overflow-tooltip />
          <el-table-column label="日期" prop="doc_date" width="110" />
          <el-table-column label="数量" prop="total_qty" width="90" align="right" />
          <el-table-column label="金额" width="110" align="right"><template #default="{ row }">{{ fmt(row.total_amount) }}</template></el-table-column>
          <el-table-column label="状态" width="84" align="center">
            <template #default="{ row }"><el-tag :type="row.status === 'audited' ? 'success' : 'info'" size="small">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center"><template #default="{ row }"><el-link type="primary" :underline="false" @click.stop="openDoc(row)">打开</el-link></template></el-table-column>
        </el-table>
      </section>
    </div>

    <!-- 完工入库：按成品逐行填本次完工数（一张单） -->
    <el-dialog v-model="finishVisible" :title="isOut ? '委外入库（按成品）' : '完工入库（按成品）'" width="620px">
      <el-form label-width="80px" size="small">
        <el-form-item label="成品仓">
          <el-select v-model="finishWh" filterable clearable placeholder="留空则各成品取自己的成品仓" style="width:100%">
            <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
          </el-select>
        </el-form-item>
      </el-form>
      <el-table :data="finishRows" size="small" border>
        <el-table-column label="成品" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }} {{ row.item_name }}</template></el-table-column>
        <el-table-column label="计划/已完工" width="120" align="center"><template #default="{ row }">{{ num(row.plan_qty) }} / {{ num(row.finished_qty) }}</template></el-table-column>
        <el-table-column label="本次完工" width="130" align="right">
          <template #default="{ row }"><el-input-number v-model="row.qty" :min="0" :max="row.base_remaining" :precision="3" :controls="false" size="small" style="width:100%" /></template>
        </el-table-column>
        <el-table-column v-if="isOut" label="加工费单价" width="130" align="right">
          <template #default="{ row }"><el-input-number v-model="row.process_fee" :min="0" :precision="2" :controls="false" size="small" style="width:100%" /></template>
        </el-table-column>
        <el-table-column v-if="isOut" label="税率%" width="100" align="right">
          <template #default="{ row }"><el-input-number v-model="row.process_tax_rate" :min="0" :max="100" :precision="2" :controls="false" size="small" style="width:100%" /></template>
        </el-table-column>
      </el-table>
      <p class="wo-finish-tip">{{ isOut ? '成品成本=各成品 BOM·领料单价上卷+加工费；加工费生成委外厂应付。末批吸收料在制余额。' : '成品成本按各成品 BOM·领料单价上卷结转；末批吸收料在制余额。' }}</p>
      <template #footer>
        <el-button size="small" @click="finishVisible = false">取消</el-button>
        <el-button type="primary" size="small" :loading="busy" @click="onGenFinish">{{ isOut ? '生成委外入库' : '生成完工单' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onActivated, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, QuestionFilled } from '@element-plus/icons-vue'
import { scmApi, type ProductionPlanActionState, type ScmPushOption } from '@/api/scm'
import { typeName } from '@/utils/scmDoc'
import { scmDownstreamDocRoute } from '@/utils/scmDocNavigation'
import ScmPushMenu from '@/components/scm/ScmPushMenu.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const STATUS_LABEL: Record<string, string> = { draft: '草稿', released: '已审核', closed: '已关闭' }
const STATUS_TYPE: Record<string, 'success' | 'info' | 'warning'> = { draft: 'info', released: 'warning', closed: 'success' }

const loading = ref(false)
const busy = ref(false)
const plan = ref<any>(null)
const products = ref<any[]>([])
const docs = ref<any[]>([])
const cost = ref<any>({ issuedCost: 0, finishedCost: 0, finishedQty: 0, wip: 0, unitCost: 0, totalPlanQty: 0, products: [] })
const actionState = ref<ProductionPlanActionState>({
  issue: { status: 'unavailable', remaining_qty: 0, remaining_lines: 0, base_remaining: 0, max_allowed_qty: 0, overrun_remaining: 0 },
  finish: { status: 'unavailable', remaining_qty: 0, remaining_lines: 0, base_remaining: 0, max_allowed_qty: 0, overrun_remaining: 0 },
})
const finishVisible = ref(false)
const finishRows = ref<any[]>([])
const finishWh = ref('')
const warehouses = ref<any[]>([])
const isOut = computed(() => plan.value?.plan_type === 'outsource')
const issueState = computed(() => actionState.value.issue)
const finishState = computed(() => actionState.value.finish)

const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '') }
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (row: any) => { const pq = Number(row.plan_qty) || 0; return pq > 0 ? Math.min(100, Math.round((Number(row.finished_qty) || 0) / pq * 100)) : 0 }
const totalFinished = computed(() => products.value.reduce((s, p) => s + (Number(p.finished_qty) || 0), 0))
const costOf = (pid: string) => (cost.value.products || []).find((c: any) => c.product_id === pid) || { mat_unit_cost: 0, consumed_cost: 0 }

// 全部成品用料汇总（带所属成品 + 计划总需）
const materialRows = computed(() => products.value.flatMap((p: any) => (p.bom_lines || []).map((l: any) => ({
  ...l, product_code: p.item_code,
  need: (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100) * (Number(p.plan_qty) || 0),
}))))
async function load() {
  loading.value = true
  try {
    const r = await scmApi.getProductionPlan(id.value)
    if (r.code === 0) {
      plan.value = r.data.plan
      products.value = r.data.products || []
      docs.value = r.data.docs || []
      cost.value = r.data.cost
      actionState.value = r.data.action_state || {
        issue: { status: 'unavailable', remaining_qty: 0, remaining_lines: 0, base_remaining: 0, max_allowed_qty: 0, overrun_remaining: 0 },
        finish: { status: 'unavailable', remaining_qty: 0, remaining_lines: 0, base_remaining: 0, max_allowed_qty: 0, overrun_remaining: 0 },
      }
    }
  } finally { loading.value = false }
}
function goBack() { router.push({ name: 'ScmProductionPlan', query: { plan_type: plan.value?.plan_type || 'self' } }) }
function handlePushAction(option: ScmPushOption) {
  if (option.action !== 'issue' && option.action !== 'finish') return
  if ((Number(option.base_remaining) || 0) <= 0.000001 && (Number(option.overrun_remaining) || 0) > 0.000001) {
    openPlanDoc(option.action)
    return
  }
  if (option.action === 'issue') onGenIssue()
  else if (option.action === 'finish') openFinish()
}
function openPlanDoc(action: 'issue' | 'finish') {
  const docType = action === 'issue' ? (isOut.value ? 'WO' : 'PL') : (isOut.value ? 'WI' : 'PF')
  router.push({ name: 'ScmDocNew', query: { doc_type: docType, plan_id: id.value } })
}
function openDoc(row: any) { router.push(scmDownstreamDocRoute(row.id, row.status)) }

async function onRelease() {
  busy.value = true
  try { const r = await scmApi.releaseProductionPlan(id.value); if (r.code === 0) { ElMessage.success('工单已审核'); load() } } finally { busy.value = false }
}
async function onUnrelease() {
  try { await ElMessageBox.confirm('反审核该工单？将退回「草稿」以便编辑（需无下游领料/完工单据）。', '反审核', { type: 'warning', confirmButtonText: '反审核', cancelButtonText: '取消' }) } catch { return }
  busy.value = true
  try { const r = await scmApi.unreleaseProductionPlan(id.value); if (r.code === 0) { ElMessage.success('已反审核，退回草稿'); load() } else ElMessage.error(r.message || '反审核失败') } finally { busy.value = false }
}
async function onGenIssue() {
  busy.value = true
  try {
    const r = await scmApi.genPlanIssue(id.value)
    if (r.code === 0) { ElMessage.success(`已生成${isOut.value ? '委外发货单' : '领料单'} ${r.data.doc_no}，请复核后审核`); router.push(scmDownstreamDocRoute(r.data.id, 'draft')) }
  } catch {
    // 命中后端防重等校验（HTTP 400）：错误消息由全局 toast 弹出，这里刷新数据使按钮自动禁用
    load()
  } finally { busy.value = false }
}
async function openFinish() {
  finishWh.value = ''
  finishRows.value = products.value.map((p: any) => ({
    product_id: p.id, item_code: p.item_code, item_name: p.item_name || '',
    plan_qty: Number(p.plan_qty) || 0, finished_qty: Number(p.finished_qty) || 0,
    base_remaining: Math.max(0, (Number(p.plan_qty) || 0) - (Number(p.finished_qty) || 0)),
    qty: Math.max(0, (Number(p.plan_qty) || 0) - (Number(p.finished_qty) || 0)),
    process_fee: Number(p.process_fee) || 0, process_tax_rate: Number(p.process_tax_rate) || 0,
  }))
  if (!warehouses.value.length) { try { const w = await scmApi.getWarehouses(); if (w.code === 0) warehouses.value = w.data } catch {} }
  finishVisible.value = true
}
async function onGenFinish() {
  const items = finishRows.value.filter((r: any) => Number(r.qty) > 0).map((r: any) => ({ product_id: r.product_id, qty: Number(r.qty),
    process_fee: isOut.value ? (Number(r.process_fee) || 0) : 0,
    process_tax_rate: isOut.value ? (Number(r.process_tax_rate) || 0) : 0 }))
  if (!items.length) return ElMessage.warning('请至少为一个成品填写本次完工数')
  if (finishRows.value.some((r: any) => Number(r.qty) > Number(r.base_remaining) + 0.000001)) {
    return ElMessage.warning('快速生成仅按原计划剩余量生成；追加超量请从下推菜单进入完整单据')
  }
  busy.value = true
  try {
    const r = await scmApi.genPlanFinish(id.value, { products: items, fp_warehouse: finishWh.value || undefined })
    if (r.code === 0) { finishVisible.value = false; ElMessage.success(`已生成${isOut.value ? '委外入库' : '完工入库'} ${r.data.doc_no}，请复核后审核入库`); router.push(scmDownstreamDocRoute(r.data.id, 'draft')) }
  } catch {
    // 命中后端防重等校验（HTTP 400）：错误消息由全局 toast 弹出，这里关闭对话框并刷新数据使按钮自动禁用
    finishVisible.value = false
    load()
  } finally { busy.value = false }
}
async function onClose() {
  busy.value = true
  try {
    const r = await scmApi.closeProductionPlan(id.value, false)
    if (r.code === 0) { ElMessage.success('工单已关闭'); load(); return }
    if (r.code === 409) {
      await ElMessageBox.confirm(`${r.message}`, '关闭确认', { type: 'warning', confirmButtonText: '强制关闭', cancelButtonText: '取消' })
      const r2 = await scmApi.closeProductionPlan(id.value, true)
      if (r2.code === 0) { ElMessage.success('工单已强制关闭'); load() }
    } else { ElMessage.error(r.message || '关闭失败') }
  } catch { /* 取消 */ } finally { busy.value = false }
}
async function onReopen() {
  try {
    await ElMessageBox.confirm('确定重开该已关闭工单？无完工/无领料的工单将退回「草稿」可编辑，已有活动的退回「已审核」。', '重开工单', { type: 'warning', confirmButtonText: '重开', cancelButtonText: '取消' })
  } catch { return }
  busy.value = true
  try {
    const r = await scmApi.reopenProductionPlan(id.value)
    if (r.code === 0) { ElMessage.success(r.data?.status === 'draft' ? '已重开并退回草稿，可编辑' : '已重开为已审核'); load() }
  } finally { busy.value = false }
}
onMounted(async () => {
  await load()
  if (route.query.push_action === 'finish') {
    const query = { ...route.query }
    delete query.push_action
    await router.replace({ query })
    if (finishState.value.status === 'available') {
      if (finishState.value.base_remaining <= 0.000001 && finishState.value.overrun_remaining > 0.000001) openPlanDoc('finish')
      else await openFinish()
    }
    else ElMessage.warning(finishState.value.draft_doc ? `已有完工/入库草稿 ${finishState.value.draft_doc.doc_no}` : '当前没有可下推的完工数量')
  }
})
onActivated(() => { if (plan.value) load() })
</script>

<style scoped>
.wo-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.wo-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; }
.wo-header__left, .wo-header__right { display: flex; align-items: center; gap: 8px; }
.wo-header__sep { color: var(--el-text-color-placeholder); }
.wo-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.wo-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 14px; }
.wo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.wo-card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: #fff; }
.wo-card span { font-size: 12px; color: var(--el-text-color-secondary); }
.wo-card b { font-size: 16px; }
.wo-card--warn b { color: var(--el-color-warning); }
.wo-section__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.wo-section__hd h3 { margin: 0; font-size: var(--cw-text-base); }
.wo-section__hd span { font-size: 12px; color: var(--el-text-color-secondary); }
.wo-muted { color: var(--el-text-color-placeholder); }
.wo-issued-ok { color: var(--el-color-success); font-weight: 600; }
.wo-hd-help { vertical-align: -2px; margin-left: 2px; color: var(--el-text-color-secondary); cursor: help; }
.wo-finish-tip { margin: 10px 2px 0; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
