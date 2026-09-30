<template>
  <div class="page pc-page" v-loading="loading">
    <div class="pc-header">
      <div class="pc-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="pc-header__sep">/</span>
        <span class="pc-header__title">工单变更单</span>
        <el-tag v-if="change?.change_no" size="small">{{ change.change_no }}</el-tag>
        <el-tag v-if="change" size="small" :type="change.status === 'audited' ? 'success' : 'info'" effect="plain">{{ change.status === 'audited' ? '已审核' : '草稿' }}</el-tag>
        <span class="pc-header__meta" v-if="plan">工单 <b>{{ plan.code }}</b>（{{ plan.status === 'released' ? '已审核' : plan.status }}）</span>
      </div>
      <div class="pc-header__right">
        <template v-if="!readonly">
          <el-button size="small" @click="preview" :loading="previewing">预览差异</el-button>
          <el-button type="primary" size="small" :loading="saving" @click="save(false)">保存草稿</el-button>
          <el-button type="success" size="small" :loading="saving" @click="save(true)">保存并审核</el-button>
        </template>
        <template v-else-if="change?.status === 'draft'">
          <el-button type="danger" plain size="small" :loading="saving" @click="remove">删除</el-button>
          <el-button type="success" size="small" :loading="saving" @click="audit">审核生效</el-button>
        </template>
      </div>
    </div>

    <div class="pc-body">
      <el-alert type="info" :closable="false" show-icon
        title="已审核工单不能直接编辑，追加 / 减少计划数、改交期、增删换用料请在此提交变更单；审核后立即写回工单并留痕。约束：新计划数 ≥ 已完工 + 已报废；用料需求 ≥ 已领用（先退料再减）；有完工 / 报工的成品不能删除。" />

      <el-form label-width="90px" size="small" class="pc-form" :disabled="readonly">
        <div class="pc-form__row">
          <el-form-item label="变更日期"><el-date-picker v-model="form.change_date" type="date" value-format="YYYY-MM-DD" style="width:150px" :clearable="false" /></el-form-item>
          <el-form-item label="变更原因" class="grow"><el-input v-model="form.reason" placeholder="如：客户追加 20 件 / 改用替代料 / 交期顺延" /></el-form-item>
        </div>
        <div class="pc-form__row">
          <el-form-item label="开工日期"><el-date-picker v-model="head.start_date" type="date" value-format="YYYY-MM-DD" style="width:150px" /></el-form-item>
          <el-form-item label="完工日期"><el-date-picker v-model="head.end_date" type="date" value-format="YYYY-MM-DD" style="width:150px" /></el-form-item>
          <el-form-item label="优先级"><el-input-number v-model="head.priority" :min="0" :max="99" :controls="false" style="width:80px" /></el-form-item>
          <el-form-item label="原料仓"><el-select v-model="head.yl_warehouse" clearable style="width:150px"><el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" /></el-select></el-form-item>
          <el-form-item label="成品仓"><el-select v-model="head.fp_warehouse" clearable style="width:150px"><el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" /></el-select></el-form-item>
          <el-form-item label="工单备注" class="grow"><el-input v-model="head.remark" /></el-form-item>
        </div>
      </el-form>

      <section class="pc-section">
        <div class="pc-section__hd"><h3>成品</h3><el-button v-if="!readonly" size="small" @click="addProduct">添加成品</el-button></div>
        <el-table :data="products" size="small" border highlight-current-row @current-change="(row: any) => currentProduct = row">
          <el-table-column type="index" width="44" align="center" />
          <el-table-column label="成品" min-width="220">
            <template #default="{ row }">
              <template v-if="row.id || readonly">{{ row.item_code }} {{ row.item_name || '' }}</template>
              <ItemPicker v-else v-model="row.item_code" placeholder="选择成品" @pick="(it: any) => onPickProduct(it, row)" />
            </template>
          </el-table-column>
          <el-table-column label="原计划数" width="95" align="right"><template #default="{ row }">{{ row._before_qty != null ? num(row._before_qty) : '新增' }}</template></el-table-column>
          <el-table-column label="新计划数" width="130" align="right">
            <template #default="{ row }"><el-input-number v-model="row.plan_qty" :min="minQty(row)" :precision="3" :controls="false" size="small" style="width:100%" :disabled="readonly" /></template>
          </el-table-column>
          <el-table-column label="已完工 / 报废" width="110" align="right"><template #default="{ row }">{{ num(row.finished_qty) }} / {{ num(row.scrap_qty) }}</template></el-table-column>
          <el-table-column label="成品仓" width="150">
            <template #default="{ row }"><el-select v-model="row.fp_warehouse" clearable size="small" :disabled="readonly"><el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" /></el-select></template>
          </el-table-column>
          <el-table-column label="用料" width="80" align="right"><template #default="{ row }">{{ row.lines.filter((l: any) => l.item_code).length }} 项</template></el-table-column>
          <el-table-column v-if="!readonly" label="操作" width="70" align="center">
            <template #default="{ row, $index }"><el-button link type="danger" size="small" :disabled="!canRemove(row)" :title="canRemove(row) ? '' : '有完工/报废/报工的成品不能删除'" @click="products.splice($index, 1)">删除</el-button></template>
          </el-table-column>
        </el-table>
      </section>

      <section class="pc-section" v-if="currentProduct">
        <div class="pc-section__hd">
          <h3>用料明细 — {{ currentProduct.item_code }}（计划 {{ num(currentProduct.plan_qty) }}）</h3>
          <el-button v-if="!readonly" size="small" @click="currentProduct.lines.push(newLine())">添加用料</el-button>
        </div>
        <el-table :data="currentProduct.lines" size="small" border>
          <el-table-column type="index" width="44" align="center" />
          <el-table-column label="物料" min-width="220">
            <template #default="{ row }">
              <template v-if="readonly">{{ row.item_code }} {{ row.item_name || '' }}</template>
              <ItemPicker v-else v-model="row.item_code" placeholder="选择物料" :browsable="false" @pick="(it: any) => { row.item_code = it.code; row.item_name = it.name; row.unit = it.unit }" />
            </template>
          </el-table-column>
          <el-table-column label="单位用量" width="120" align="right"><template #default="{ row }"><el-input-number v-model="row.qty" :min="0" :precision="6" :controls="false" size="small" style="width:100%" :disabled="readonly" /></template></el-table-column>
          <el-table-column label="损耗率%" width="100" align="right"><template #default="{ row }"><el-input-number v-model="row.scrap_rate" :min="0" :max="100" :precision="2" :controls="false" size="small" style="width:100%" :disabled="readonly" /></template></el-table-column>
          <el-table-column label="总需求" width="110" align="right"><template #default="{ row }">{{ num((Number(row.qty) || 0) * (1 + (Number(row.scrap_rate) || 0) / 100) * (Number(currentProduct.plan_qty) || 0)) }}</template></el-table-column>
          <el-table-column label="已领用(工单)" width="110" align="right"><template #default="{ row }"><span :class="{ warn: issuedOf(row.item_code) > totalNeed(row.item_code) + 1e-6 }">{{ num(issuedOf(row.item_code)) }}</span></template></el-table-column>
          <el-table-column label="领料仓" width="140"><template #default="{ row }"><el-select v-model="row.warehouse_code" clearable size="small" :disabled="readonly"><el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" /></el-select></template></el-table-column>
          <el-table-column v-if="!readonly" label="操作" width="70" align="center"><template #default="{ $index }"><el-button link type="danger" size="small" @click="currentProduct.lines.splice($index, 1)">删除</el-button></template></el-table-column>
        </el-table>
      </section>

      <section class="pc-section" v-if="diff.length || change">
        <div class="pc-section__hd"><h3>变更内容{{ change?.status === 'audited' ? '（已生效）' : '' }}</h3><span>{{ diff.length }} 项</span></div>
        <el-empty v-if="!diff.length" description="与当前工单一致，无变更" :image-size="50" />
        <el-table v-else :data="diff" size="small" border>
          <el-table-column label="类别" width="90"><template #default="{ row }">{{ ({ head: '工单', product: '成品', line: '用料' } as any)[row.kind] }}</template></el-table-column>
          <el-table-column label="项目" min-width="200"><template #default="{ row }">{{ row.label }}{{ row.product ? ' · ' + row.product : '' }}{{ row.item ? ' · ' + row.item : '' }}</template></el-table-column>
          <el-table-column label="变更前" min-width="140"><template #default="{ row }">{{ row.before ?? '-' }}</template></el-table-column>
          <el-table-column label="变更后" min-width="140"><template #default="{ row }"><b>{{ row.after ?? '-' }}</b></template></el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'

const ItemPicker = defineAsyncComponent(() => import('@/components/scm/ItemPicker.vue'))
const route = useRoute(); const router = useRouter()
const changeId = computed(() => String(route.params.id || ''))
const planIdParam = computed(() => String(route.params.planId || ''))
const loading = ref(false); const saving = ref(false); const previewing = ref(false)
const plan = ref<any>(null); const change = ref<any>(null)
const warehouses = ref<any[]>([])
const issued = ref<Record<string, number>>({})
const reportedProducts = ref<Set<string>>(new Set())
const form = ref({ change_date: todayStr(), reason: '', remark: '' })
const head = ref<any>({})
const products = ref<any[]>([])
const currentProduct = ref<any>(null)
const diff = ref<any[]>([])
const readonly = computed(() => change.value?.status === 'audited' || (change.value && change.value.status === 'draft' && viewMode.value))
const viewMode = ref(false)
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '') }
const newLine = () => ({ item_code: '', item_name: '', qty: 1, scrap_rate: 0, unit: '', warehouse_code: '', remark: '' })
const minQty = (row: any) => Math.max(0.001, (Number(row.finished_qty) || 0) + (Number(row.scrap_qty) || 0))
const canRemove = (row: any) => !row.id || (!(Number(row.finished_qty) > 0) && !(Number(row.scrap_qty) > 0) && !reportedProducts.value.has(row.id))
const issuedOf = (code: string) => Number(issued.value[code]) || 0
const totalNeed = (code: string) => products.value.reduce((s: number, p: any) => s + (p.lines as any[]).filter((l: any) => l.item_code === code).reduce((x: number, l: any) => x + (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100) * (Number(p.plan_qty) || 0), 0), 0)

function goBack() { plan.value ? router.push(scmProductionPlanOrderRoute(plan.value.id, 'self')) : router.back() }
function hydrate(snapshot: any) {
  head.value = { ...snapshot.head }
  products.value = snapshot.products.map((p: any) => ({ ...p, _before_qty: p.id ? p.plan_qty : null, lines: (p.lines || []).map((l: any) => ({ ...l })) }))
  currentProduct.value = products.value[0] || null
}
function addProduct() { products.value.push({ id: null, item_code: '', item_name: '', plan_qty: 1, fp_warehouse: '', finished_qty: 0, scrap_qty: 0, _before_qty: null, lines: [] }); currentProduct.value = products.value[products.value.length - 1] }
async function onPickProduct(it: any, row: any) {
  row.item_code = it.code; row.item_name = it.name
  if (row.lines.length) return
  try {
    const boms = await scmApi.getBoms()
    const b = ((boms.data || []) as any[]).filter((x: any) => x.item_code === it.code && x.status !== 'inactive')[0]
    if (b) { row.bom_id = b.id; const ex = await scmApi.getBom(b.id); row.lines = (((ex.data as any)?.lines) || []).filter((l: any) => !l.line_type || l.line_type === 'component').map((l: any) => ({ item_code: l.item_code, item_name: l.item_name, qty: Number(l.qty) || 0, scrap_rate: Number(l.scrap_rate) || 0, unit: l.unit, warehouse_code: '', remark: '' })) }
  } catch { /* 无 BOM 手工录入 */ }
}
function payload() {
  return {
    plan_id: plan.value.id, change_date: form.value.change_date, reason: form.value.reason, remark: form.value.remark, head: head.value,
    products: products.value.filter(p => p.item_code && Number(p.plan_qty) > 0).map(p => ({ id: p.id || undefined, item_code: p.item_code, plan_qty: p.plan_qty, bom_id: p.bom_id || undefined, fp_warehouse: p.fp_warehouse || undefined, remark: p.remark,
      lines: p.lines.filter((l: any) => l.item_code && Number(l.qty) > 0).map((l: any) => ({ item_code: l.item_code, qty: l.qty, scrap_rate: l.scrap_rate || 0, unit: l.unit, warehouse_code: l.warehouse_code || null, remark: l.remark })) })),
  }
}
/** 预览：在客户端按同样规则粗算差异（服务端保存时会给出精确差异与校验） */
function preview() {
  previewing.value = true
  try {
    const out: any[] = []
    const before = baseSnapshot.value
    if (!before) return
    for (const [k, label] of [['start_date', '开工日期'], ['end_date', '完工日期'], ['priority', '优先级'], ['yl_warehouse', '原料仓'], ['fp_warehouse', '成品仓'], ['remark', '备注']] as const) {
      if (String(before.head[k] ?? '') !== String(head.value[k] ?? '')) out.push({ kind: 'head', label, before: before.head[k], after: head.value[k] })
    }
    const byId = new Map(before.products.map((p: any) => [p.id, p]))
    for (const p of products.value) {
      const b: any = p.id ? byId.get(p.id) : null
      if (!b) { if (p.item_code) out.push({ kind: 'product', label: '新增成品', product: p.item_code, before: null, after: p.plan_qty }); continue }
      if (Number(b.plan_qty) !== Number(p.plan_qty)) out.push({ kind: 'product', label: '计划数', product: p.item_code, before: b.plan_qty, after: p.plan_qty })
      const bl = new Map(b.lines.map((l: any) => [l.item_code, l]))
      for (const l of p.lines.filter((x: any) => x.item_code)) { const o: any = bl.get(l.item_code); if (!o) out.push({ kind: 'line', label: '新增用料', product: p.item_code, item: l.item_code, before: null, after: l.qty }); else if (Number(o.qty) !== Number(l.qty) || Number(o.scrap_rate || 0) !== Number(l.scrap_rate || 0)) out.push({ kind: 'line', label: '单位用量', product: p.item_code, item: l.item_code, before: o.qty, after: l.qty }) }
      for (const code of bl.keys()) if (!p.lines.some((x: any) => x.item_code === code)) out.push({ kind: 'line', label: '删除用料', product: p.item_code, item: code, before: (bl.get(code) as any).qty, after: null })
    }
    for (const b of before.products) if (!products.value.some(p => p.id === b.id)) out.push({ kind: 'product', label: '删除成品', product: b.item_code, before: b.plan_qty, after: null })
    diff.value = out
    if (!out.length) ElMessage.info('与当前工单一致，没有变更')
  } finally { previewing.value = false }
}
const baseSnapshot = ref<any>(null)
async function save(andAudit: boolean) {
  if (!form.value.reason?.trim()) return ElMessage.warning('请填写变更原因')
  saving.value = true
  try {
    let id = change.value?.id
    const r: any = id ? await scmApi.updatePlanChange(id, payload()) : await scmApi.createPlanChange(payload())
    if (r.code !== 0) return ElMessage.error(r.message || '保存失败')
    id = id || r.data.id
    diff.value = r.data.diff || []
    if (andAudit) {
      const a: any = await scmApi.auditPlanChange(id)
      if (a.code !== 0) { ElMessage.error(a.message || '审核失败'); router.replace({ name: 'ScmPlanChangeForm', params: { id } }); return }
      ElMessage.success('变更已生效'); goBack(); return
    }
    ElMessage.success('已保存草稿')
    router.replace({ name: 'ScmPlanChangeForm', params: { id } })
    await init()
  } finally { saving.value = false }
}
async function audit() {
  try { await ElMessageBox.confirm('审核后立即写回工单（计划数 / 用料 / 日期），不可反审核。继续？', '审核变更单', { type: 'warning' }) } catch { return }
  saving.value = true
  try { const a: any = await scmApi.auditPlanChange(change.value.id); if (a.code === 0) { ElMessage.success('变更已生效'); goBack() } else ElMessage.error(a.message || '审核失败') } finally { saving.value = false }
}
async function remove() {
  try { await ElMessageBox.confirm('删除该草稿变更单？', '提示', { type: 'warning' }) } catch { return }
  const r: any = await scmApi.deletePlanChange(change.value.id)
  if (r.code === 0) { ElMessage.success('已删除'); goBack() } else ElMessage.error(r.message || '删除失败')
}
async function init() {
  loading.value = true
  try {
    const w = await scmApi.getWarehouses(); warehouses.value = w.data || []
    if (changeId.value) {
      const c = await scmApi.getPlanChange(changeId.value)
      if (c.code !== 0) { ElMessage.error('变更单不存在'); return router.back() }
      change.value = c.data
      form.value = { change_date: c.data.change_date, reason: c.data.reason || '', remark: c.data.remark || '' }
      const base = await scmApi.getPlanChangeBase(c.data.plan_id)
      plan.value = base.data.plan; issued.value = base.data.issued || {}
      baseSnapshot.value = c.data.status === 'audited' ? c.data.before : base.data.snapshot
      hydrate(c.data.after)
      // 已审核：after 快照里已有完工数是审核前的，展示时用当前工单
      diff.value = c.data.diff || []
      viewMode.value = false
    } else {
      const base = await scmApi.getPlanChangeBase(planIdParam.value)
      if (base.code !== 0) { ElMessage.error(base.message || '工单不存在'); return router.back() }
      if (base.data.draft) { ElMessage.info(`该工单已有草稿变更单 ${base.data.draft.change_no}，已为您打开`); return router.replace({ name: 'ScmPlanChangeForm', params: { id: base.data.draft.id } }) }
      plan.value = base.data.plan; issued.value = base.data.issued || {}
      if (plan.value.status !== 'released') { ElMessage.warning('仅已审核工单可做变更'); return goBack() }
      baseSnapshot.value = base.data.snapshot
      hydrate(base.data.snapshot)
    }
    const wr = await scmApi.getWorkReports({ plan_id: plan.value.id })
    reportedProducts.value = new Set(((wr.data || []) as any[]).map((r: any) => r.product_id).filter(Boolean))
  } finally { loading.value = false }
}
onMounted(init)
</script>

<style scoped>
.pc-page { display: flex; flex-direction: column; height: 100%; }
.pc-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.pc-header__left { display: flex; align-items: center; gap: 8px; }
.pc-header__sep { color: var(--el-text-color-placeholder); }
.pc-header__title { font-weight: 600; }
.pc-header__meta { font-size: 12px; color: var(--el-text-color-secondary); }
.pc-header__right { display: flex; gap: 8px; }
.pc-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.pc-form__row { display: flex; gap: 12px; flex-wrap: wrap; }
.pc-form__row .grow { flex: 1; min-width: 240px; }
.pc-form :deep(.el-form-item) { margin-bottom: 8px; }
.pc-section__hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.pc-section__hd h3 { margin: 0; font-size: 14px; }
.pc-section__hd span { font-size: 12px; color: var(--el-text-color-secondary); }
.warn { color: var(--el-color-danger); font-weight: 600; }
</style>
