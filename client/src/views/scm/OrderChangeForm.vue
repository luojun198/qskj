<template>
  <div class="page oc-page" v-loading="loading">
    <!-- 顶部导航：返回 + 标题 + 订单信息 + 操作 -->
    <div class="oc-header">
      <div class="oc-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="oc-header__sep">/</span>
        <span class="oc-header__title">{{ meta?.orderName || '订单' }}变更单</span>
        <el-tag v-if="change?.change_no" size="small">{{ change.change_no }}</el-tag>
        <el-tag v-if="change" size="small" :type="change.status === 'audited' ? 'success' : 'info'" effect="plain">{{ change.status === 'audited' ? '已审核' : '草稿' }}</el-tag>
        <span v-if="order" class="oc-header__meta">
          {{ meta?.orderName }}
          <el-link type="primary" :underline="false" @click="openOrder">{{ order.doc_no }}</el-link>
          · {{ order.partner_name || order.partner_code }}
        </span>
      </div>
      <div class="oc-header__right">
        <SaveAsButton doc :title="(meta?.orderName || '订单') + '变更单'" />
        <template v-if="!readonly">
          <el-button size="small" :loading="previewing" @click="preview">预览差异</el-button>
          <el-button type="primary" size="small" :loading="saving" @click="save(false)">保存草稿</el-button>
          <el-button type="success" size="small" :loading="saving" @click="save(true)">保存并审核</el-button>
        </template>
        <template v-else-if="change?.status === 'draft'">
          <el-button size="small" @click="viewMode = false">修改</el-button>
          <el-button type="danger" plain size="small" :loading="saving" @click="remove">删除</el-button>
          <el-button type="success" size="small" :loading="saving" @click="audit">审核生效</el-button>
        </template>
      </div>
    </div>

    <div class="oc-body">
      <el-alert type="info" :closable="false" show-icon class="oc-tip">
        已审核订单不能直接修改，增减数量、改单价、增删明细请在此提交变更单，审核后立即写回订单并留痕。
        约束：新数量不能低于{{ meta?.execName || '已执行' }}数量；改单价只影响尚未{{ meta?.execName?.replace('已', '') || '执行' }}的部分，已生成的{{ meta?.childName || '下游单据' }}保持原价；
        有未审核{{ meta?.childName || '下游单据' }}的行，减少数量或改价前需先审核或删除草稿；已执行的行不能删除。
      </el-alert>

      <el-form label-width="80px" size="small" class="oc-form" :disabled="readonly">
        <div class="oc-form__row">
          <el-form-item label="变更日期"><el-date-picker v-model="form.change_date" type="date" value-format="YYYY-MM-DD" style="width:150px" :clearable="false" :disabled-date="disabledBeforeGlStart" /></el-form-item>
          <el-form-item label="变更原因" class="grow"><el-input v-model="form.reason" placeholder="如：客户追加 20 件 / 供应商调价" /></el-form-item>
        </div>
        <div class="oc-form__row">
          <el-form-item label="订单备注" class="grow"><el-input v-model="head.remark" /></el-form-item>
          <el-form-item label="变更单备注" class="grow"><el-input v-model="form.remark" /></el-form-item>
        </div>
      </el-form>

      <section class="oc-section">
        <div class="oc-section__hd">
          <h3>订单明细</h3>
          <span class="oc-section__sub">表头税率 {{ order?.tax_rate ?? 0 }}%，明细税率为空时取表头</span>
          <el-button v-if="!readonly" size="small" @click="addLine">添加明细</el-button>
        </div>
        <el-table v-col-width="'scm_OrderChangeForm_1'" :data="lines" size="small" border>
          <el-table-column type="index" width="44" align="center" />
          <el-table-column label="物料" min-width="220">
            <template #default="{ row }">
              <template v-if="row.id || readonly">{{ row.item_code }} {{ row.item_name || '' }}<span v-if="row.spec" class="text-muted"> {{ row.spec }}</span></template>
              <ItemPicker v-else v-model="row.item_code" placeholder="选择物料" :browsable="false" @pick="(it: any) => onPickItem(it, row)" />
            </template>
          </el-table-column>
          <el-table-column label="原数量" width="90" align="right"><template #default="{ row }">{{ row._before ? num(row._before.qty) : '新增' }}</template></el-table-column>
          <el-table-column :label="meta?.execName || '已执行'" width="90" align="right">
            <template #default="{ row }"><span :class="{ warn: (row.draft_docs || []).length }" :title="(row.draft_docs || []).length ? `含未审核草稿：${row.draft_docs.join('、')}` : ''">{{ num(row.executed_qty) }}</span></template>
          </el-table-column>
          <el-table-column label="新数量" width="120" align="right">
            <template #default="{ row }"><el-input-number v-model="row.qty" :min="Number(row.executed_qty) || 0" :precision="4" :controls="false" size="small" style="width:100%" :disabled="readonly" /></template>
          </el-table-column>
          <el-table-column label="原单价" width="95" align="right"><template #default="{ row }">{{ row._before ? num(row._before.price) : '-' }}</template></el-table-column>
          <el-table-column label="新单价" width="115" align="right">
            <template #default="{ row }"><el-input-number v-model="row.price" :min="0" :precision="4" :controls="false" size="small" style="width:100%" :disabled="readonly || fullyExecuted(row)" :title="fullyExecuted(row) ? '已全部执行，不能改价' : ''" /></template>
          </el-table-column>
          <el-table-column label="税率%" width="90" align="right">
            <template #default="{ row }"><el-input-number v-model="row.tax_rate" :min="0" :max="100" :precision="1" :controls="false" size="small" style="width:100%" placeholder="取表头" :disabled="readonly || fullyExecuted(row)" /></template>
          </el-table-column>
          <el-table-column label="新金额" width="110" align="right"><template #default="{ row }">{{ fmt(amountOf(row)) }}</template></el-table-column>
          <el-table-column label="价税合计" width="115" align="right"><template #default="{ row }">{{ fmt(grossOf(row)) }}</template></el-table-column>
          <el-table-column label="备注" min-width="120"><template #default="{ row }"><el-input v-model="row.remark" size="small" :disabled="readonly" /></template></el-table-column>
          <el-table-column v-if="!readonly" label="操作" width="70" align="center">
            <template #default="{ row, $index }">
              <el-button link type="danger" size="small" :disabled="!canRemove(row)" :title="canRemove(row) ? '' : `${meta?.execName || '已执行'}或有草稿下游单的行不能删除`" @click="lines.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="oc-total">合计数量 {{ num(totalQty) }}　金额 {{ fmt(totalAmount) }}　价税合计 {{ fmt(totalGross) }}</div>
      </section>

      <section class="oc-section" v-if="diff.length || change">
        <div class="oc-section__hd"><h3>变更内容{{ change?.status === 'audited' ? '（已生效）' : '' }}</h3><span class="oc-section__sub">{{ diff.length }} 项</span></div>
        <el-empty v-if="!diff.length" description="与当前订单一致，无变更（可点「预览差异」）" :image-size="50" />
        <el-table v-col-width="'scm_OrderChangeForm_2'" v-else :data="diff" size="small" border>
          <el-table-column label="类别" width="80"><template #default="{ row }">{{ row.kind === 'head' ? '订单' : '明细' }}</template></el-table-column>
          <el-table-column label="项目" min-width="200"><template #default="{ row }">{{ row.label }}{{ row.item ? ' · ' + row.item : '' }}</template></el-table-column>
          <el-table-column label="变更前" min-width="140"><template #default="{ row }">{{ row.before ?? '-' }}</template></el-table-column>
          <el-table-column label="变更后" min-width="140"><template #default="{ row }"><b>{{ row.after ?? '-' }}</b></template></el-table-column>
        </el-table>
        <div v-if="change" class="text-muted oc-meta">制单 {{ change.maker || '-' }}<template v-if="change.auditor">　审核 {{ change.auditor }} {{ change.audited_at }}</template></div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { todayStr } from '@/utils/format'
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useGlStartDate } from '@/composables/useGlStartDate'
const { disabledBeforeGlStart } = useGlStartDate()
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'

const ItemPicker = defineAsyncComponent(() => import('@/components/scm/ItemPicker.vue'))

const route = useRoute()
const router = useRouter()
const changeId = computed(() => (route.name === 'ScmOrderChangeForm' ? String(route.params.id || '') : ''))
const docIdParam = computed(() => String(route.params.docId || ''))

const loading = ref(false); const saving = ref(false); const previewing = ref(false)
const order = ref<any>(null); const meta = ref<any>(null); const change = ref<any>(null)
const viewMode = ref(true)
const form = ref({ change_date: todayStr(), reason: '', remark: '' })
const head = ref<{ remark: string | null }>({ remark: '' })
const lines = ref<any[]>([])
const diff = ref<any[]>([])

const readonly = computed(() => change.value?.status === 'audited' || (change.value?.status === 'draft' && viewMode.value))

const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000) }
const fmt = (v: number) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const rateOf = (row: any) => (row.tax_rate === null || row.tax_rate === undefined || row.tax_rate === '' ? Number(order.value?.tax_rate) || 0 : Number(row.tax_rate) || 0)
const amountOf = (row: any) => {
  const factor = Number(row.discount_rate) > 0 ? Number(row.discount_rate) / 10 : 1
  return r2((Number(row.qty) || 0) * (Number(row.price) || 0) * factor)
}
const grossOf = (row: any) => r2(amountOf(row) * (1 + rateOf(row) / 100))
const totalQty = computed(() => lines.value.reduce((s, r) => s + (Number(r.qty) || 0), 0))
const totalAmount = computed(() => lines.value.reduce((s, r) => s + amountOf(r), 0))
const totalGross = computed(() => lines.value.reduce((s, r) => s + grossOf(r), 0))
const fullyExecuted = (row: any) => !!row._before && (Number(row.executed_qty) || 0) >= (Number(row._before.qty) || 0) - 1e-6 && (Number(row.qty) || 0) <= (Number(row._before.qty) || 0) + 1e-6
const canRemove = (row: any) => !row.id || (!(Number(row.executed_qty) > 0) && !(row.draft_docs || []).length)

function hydrate(target: any, before: any) {
  const beforeById = new Map((before?.lines || []).filter((l: any) => l.id).map((l: any) => [l.id, l]))
  head.value = { remark: target?.head?.remark ?? '' }
  lines.value = (target?.lines || []).map((l: any) => {
    const b: any = l.id ? beforeById.get(l.id) : null
    return { ...l, executed_qty: b?.executed_qty ?? l.executed_qty ?? 0, draft_docs: b?.draft_docs ?? l.draft_docs ?? [], _before: b ? { qty: b.qty, price: b.price } : null }
  })
}
function addLine() { lines.value.push({ id: null, item_code: '', item_name: '', qty: 1, price: 0, tax_rate: null, discount_rate: null, warehouse_code: null, remark: '', executed_qty: 0, draft_docs: [], _before: null }) }
function onPickItem(it: any, row: any) { row.item_code = it.code; row.item_name = it.name; row.spec = it.spec || '' }
function payload() {
  return {
    doc_id: order.value?.id, change_id: change.value?.id, change_date: form.value.change_date, reason: form.value.reason, remark: form.value.remark,
    head: { remark: head.value.remark },
    lines: lines.value.filter(l => l.item_code).map(l => ({ id: l.id || null, item_code: l.item_code, item_name: l.item_name, qty: l.qty, price: l.price,
      tax_rate: l.tax_rate === undefined || l.tax_rate === '' ? null : l.tax_rate, discount_rate: l.discount_rate, warehouse_code: l.warehouse_code, remark: l.remark })),
  }
}
async function preview() {
  previewing.value = true
  try {
    const r = await scmApi.previewOrderChange(payload())
    diff.value = r.data.diff || []
    ElMessage.success(`共 ${diff.value.length} 项变更，校验通过`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '预览失败')
  } finally { previewing.value = false }
}
async function save(thenAudit: boolean) {
  if (!form.value.reason?.trim()) return ElMessage.warning('请填写变更原因')
  saving.value = true
  try {
    let id = change.value?.id
    if (id) await scmApi.updateOrderChange(id, payload())
    else {
      const r = await scmApi.createOrderChange(payload())
      id = r.data.id
    }
    if (thenAudit) {
      try { await ElMessageBox.confirm('审核后立即写回订单（数量 / 单价 / 明细），不可反审核。继续？', '审核变更单', { type: 'warning' }) } catch {
        ElMessage.success('已保存草稿'); return router.replace({ name: 'ScmOrderChangeForm', params: { id } })
      }
      await scmApi.auditOrderChange(id)
      ElMessage.success('变更已生效')
    } else ElMessage.success('已保存草稿')
    await router.replace({ name: 'ScmOrderChangeForm', params: { id } })
    await init()
  } catch { /* 请求拦截器已提示原因，保留录入内容 */ } finally { saving.value = false }
}
async function audit() {
  try { await ElMessageBox.confirm('审核后立即写回订单（数量 / 单价 / 明细），不可反审核。继续？', '审核变更单', { type: 'warning' }) } catch { return }
  saving.value = true
  try { await scmApi.auditOrderChange(change.value.id); ElMessage.success('变更已生效'); await init() } catch { /* 拦截器已提示 */ } finally { saving.value = false }
}
async function remove() {
  try { await ElMessageBox.confirm('删除该草稿变更单？', '提示', { type: 'warning' }) } catch { return }
  try { await scmApi.deleteOrderChange(change.value.id); ElMessage.success('已删除'); goBack() } catch { /* 拦截器已提示 */ }
}
function openOrder() { if (order.value) router.push(scmDocumentRoute(order.value.id, order.value.doc_type, order.value.status)) }
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: 'ScmOrderChangeList', query: { doc_type: order.value?.doc_type || '' } })
}

async function init(): Promise<void> {
  loading.value = true
  try {
    if (changeId.value) {
      const c = await scmApi.getOrderChange(changeId.value)
      change.value = c.data
      form.value = { change_date: c.data.change_date, reason: c.data.reason || '', remark: c.data.remark || '' }
      const base = await scmApi.getOrderChangeBase(c.data.doc_id)
      order.value = base.data.order; meta.value = base.data.meta
      // 草稿：已执行 / 草稿下游取订单当前值；已审核：展示审核时快照
      hydrate(c.data.after, c.data.status === 'audited' ? c.data.before : base.data.snapshot)
      diff.value = c.data.diff || []
      viewMode.value = true
    } else {
      const base = await scmApi.getOrderChangeBase(docIdParam.value)
      if (base.data.draft) {
        ElMessage.info(`该订单已有草稿变更单 ${base.data.draft.change_no}，已为您打开`)
        await router.replace({ name: 'ScmOrderChangeForm', params: { id: base.data.draft.id } })
        return init()
      }
      order.value = base.data.order; meta.value = base.data.meta
      if (order.value.status !== 'audited') { ElMessage.warning('订单未审核，请直接修改订单'); return goBack() }
      change.value = null
      hydrate(base.data.snapshot, base.data.snapshot)
      diff.value = []
    }
  } catch { /* 拦截器已提示 */ } finally { loading.value = false }
}
onMounted(init)
</script>

<style scoped>
.oc-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.oc-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-bg-color); flex-shrink: 0; }
.oc-header__left { display: flex; align-items: center; gap: 6px; font-size: var(--cw-text-base); }
.oc-header__sep { color: var(--el-text-color-placeholder); }
.oc-header__title { font-weight: 600; }
.oc-header__meta { margin-left: 8px; color: var(--el-text-color-secondary); }
.oc-header__right { display: flex; gap: 8px; }
.oc-body { flex: 1; overflow: auto; padding: 12px 16px; }
.oc-tip { margin-bottom: 12px; }
.oc-form__row { display: flex; gap: 12px; }
.oc-form__row .grow { flex: 1; }
.oc-section { margin-top: 12px; }
.oc-section__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.oc-section__hd h3 { margin: 0; font-size: 14px; }
.oc-section__sub { font-size: 12px; color: var(--el-text-color-secondary); flex: 1; }
.oc-total { text-align: right; margin-top: 6px; font-size: 12px; color: var(--el-text-color-regular); }
.oc-meta { margin-top: 6px; font-size: 12px; }
.text-muted { color: var(--el-text-color-secondary); }
.warn { color: var(--el-color-warning); }
</style>
