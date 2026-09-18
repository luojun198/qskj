<template>
  <div class="page wc-page" v-loading="loading">
    <div class="wc-header">
      <div class="wc-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="wc-header__sep">/</span>
        <span class="wc-header__title">在制品盘点</span>
        <el-tag v-if="count?.count_no" size="small">{{ count.count_no }}</el-tag>
        <el-tag v-if="count" size="small" :type="count.status === 'audited' ? 'success' : 'info'" effect="plain">{{ count.status === 'audited' ? '已审核' : '草稿' }}</el-tag>
        <span class="wc-header__meta" v-if="plan">工单 <b>{{ plan.code }}</b></span>
      </div>
      <div class="wc-header__right">
        <template v-if="!readonly">
          <el-button type="primary" size="small" :loading="saving" @click="save(false)">保存草稿</el-button>
          <el-button type="success" size="small" :loading="saving" @click="save(true)">保存并审核</el-button>
        </template>
        <template v-else-if="count?.status === 'draft'">
          <el-button type="danger" plain size="small" :loading="saving" @click="remove">删除</el-button>
          <el-button type="success" size="small" :loading="saving" @click="audit">审核</el-button>
        </template>
      </div>
    </div>
    <div class="wc-body">
      <el-alert type="info" :closable="false" show-icon
        title="账面在制 = 工单净领用 − (已完工 + 已报废) × 单件用量 − 已审核盘亏。审核后：现场比账面多（盘盈）自动生成退料单草稿退回原料仓；现场比账面少（盘亏）记为在制损耗，领料建议按损耗补领，损耗成本留在工单在制随末批吸收。" />
      <el-form label-width="90px" size="small" :disabled="readonly" class="wc-form">
        <el-form-item label="盘点日期"><el-date-picker v-model="form.count_date" type="date" value-format="YYYY-MM-DD" style="width:150px" :clearable="false" /></el-form-item>
        <el-form-item label="备注" class="grow"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <el-table :data="rows" size="small" border show-summary :summary-method="sumRow">
        <el-table-column type="index" width="44" align="center" />
        <el-table-column label="物料" min-width="200" show-overflow-tooltip><template #default="{ row }">{{ row.item_code }} {{ row.item_name || '' }}</template></el-table-column>
        <el-table-column label="单位" prop="unit" width="60" align="center" />
        <el-table-column label="净领用" width="95" align="right"><template #default="{ row }">{{ num(row.issued_qty) }}</template></el-table-column>
        <el-table-column label="已消耗" width="95" align="right"><template #default="{ row }">{{ num(row.consumed_qty) }}</template></el-table-column>
        <el-table-column label="已盘亏" width="90" align="right"><template #default="{ row }">{{ Number(row.loss_qty) ? num(row.loss_qty) : '' }}</template></el-table-column>
        <el-table-column label="账面在制" width="100" align="right"><template #default="{ row }"><b>{{ num(row.book_qty) }}</b></template></el-table-column>
        <el-table-column label="实盘" width="130" align="right">
          <template #default="{ row }"><el-input-number v-model="row.counted_qty" :min="0" :precision="4" :controls="false" size="small" style="width:100%" :disabled="readonly" /></template>
        </el-table-column>
        <el-table-column label="差异" width="100" align="right"><template #default="{ row }"><span :class="diffCls(row)">{{ signed(diffOf(row)) }}</span></template></el-table-column>
        <el-table-column label="处理" width="110"><template #default="{ row }">{{ diffOf(row) > 1e-6 ? '盘盈 → 退料' : diffOf(row) < -1e-6 ? '盘亏 → 损耗' : '' }}</template></el-table-column>
        <el-table-column label="备注" min-width="120"><template #default="{ row }"><el-input v-model="row.remark" size="small" :disabled="readonly" /></template></el-table-column>
      </el-table>
      <div v-if="count?.return_doc" class="wc-return">盘盈退料单：<el-link type="primary" @click="router.push(scmDownstreamDocRoute(count.return_doc.id, count.return_doc.status, undefined, 'PJ'))">{{ count.return_doc.doc_no }}</el-link>（{{ count.return_doc.status === 'audited' ? '已审核' : '草稿，请审核后账面对齐' }}）</div>

      <section class="wc-section" v-if="history.length">
        <div class="wc-section__hd"><h3>本工单盘点记录</h3></div>
        <el-table :data="history" size="small" border>
          <el-table-column label="盘点号" width="150"><template #default="{ row }"><el-link type="primary" @click="router.push({ name: 'ScmWipCountForm', params: { id: row.id } })">{{ row.count_no }}</el-link></template></el-table-column>
          <el-table-column label="日期" prop="count_date" width="105" />
          <el-table-column label="差异行" width="80" align="right"><template #default="{ row }">{{ row.diff_lines }}</template></el-table-column>
          <el-table-column label="状态" width="80" align="center"><template #default="{ row }"><el-tag size="small" :type="row.status === 'audited' ? 'success' : 'info'" effect="plain">{{ row.status === 'audited' ? '已审核' : '草稿' }}</el-tag></template></el-table-column>
          <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip />
          <el-table-column label="经办" width="140"><template #default="{ row }">{{ row.maker }}{{ row.auditor ? ' / ' + row.auditor : '' }}</template></el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { scmDownstreamDocRoute, scmProductionPlanOrderRoute } from '@/utils/scmDocNavigation'

const route = useRoute(); const router = useRouter()
const countId = computed(() => String(route.params.id || ''))
const planIdParam = computed(() => String(route.params.planId || ''))
const loading = ref(false); const saving = ref(false)
const plan = ref<any>(null); const count = ref<any>(null)
const rows = ref<any[]>([]); const history = ref<any[]>([])
const form = ref({ count_date: new Date().toISOString().slice(0, 10), remark: '' })
const readonly = computed(() => count.value?.status === 'audited')
const num = (v: any) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '') }
const diffOf = (row: any) => Math.round(((Number(row.counted_qty) || 0) - (Number(row.book_qty) || 0)) * 1e6) / 1e6
const signed = (n: number) => n === 0 ? '' : (n > 0 ? '+' : '') + num(n)
const diffCls = (row: any) => ({ pos: diffOf(row) > 1e-6, neg: diffOf(row) < -1e-6 })
function sumRow() { return ['合计', '', '', num(rows.value.reduce((s, r) => s + (Number(r.issued_qty) || 0), 0)), '', '', num(rows.value.reduce((s, r) => s + (Number(r.book_qty) || 0), 0)), num(rows.value.reduce((s, r) => s + (Number(r.counted_qty) || 0), 0)), '', '', ''] }
function goBack() { plan.value ? router.push(scmProductionPlanOrderRoute(plan.value.id, 'self')) : router.back() }
async function loadBook(planId: string) {
  const b = await scmApi.getWipBook(planId)
  if (b.code !== 0) throw new Error(b.message || '工单不存在')
  plan.value = b.data.plan; history.value = b.data.counts || []
  return b.data.rows as any[]
}
async function init() {
  loading.value = true
  try {
    if (countId.value) {
      const c = await scmApi.getWipCount(countId.value)
      if (c.code !== 0) { ElMessage.error('盘点单不存在'); return router.back() }
      count.value = c.data
      form.value = { count_date: c.data.count_date, remark: c.data.remark || '' }
      const book = await loadBook(c.data.plan_id)
      // 草稿：按当前账面展示并保留已录实盘；已审核：展示审核时的账面 / 实盘
      rows.value = c.data.status === 'audited'
        ? c.data.lines.map((l: any) => ({ ...l, issued_qty: null, consumed_qty: null, loss_qty: null }))
        : book.map(r => { const l = c.data.lines.find((x: any) => x.item_code === r.item_code); return { ...r, counted_qty: l ? l.counted_qty : r.book_qty, remark: l?.remark || '' } })
    } else {
      const book = await loadBook(planIdParam.value)
      if (plan.value.status !== 'released') { ElMessage.warning('仅已审核工单可做在制盘点'); return goBack() }
      const draft = history.value.find((h: any) => h.status === 'draft')
      if (draft) { ElMessage.info(`已有草稿盘点单 ${draft.count_no}，已为您打开`); return router.replace({ name: 'ScmWipCountForm', params: { id: draft.id } }) }
      rows.value = book.map(r => ({ ...r, counted_qty: r.book_qty, remark: '' }))
    }
  } catch (e: any) { ElMessage.error(e?.message || '加载失败'); router.back() } finally { loading.value = false }
}
const payload = () => ({ plan_id: plan.value.id, count_date: form.value.count_date, remark: form.value.remark, lines: rows.value.map(r => ({ item_code: r.item_code, counted_qty: r.counted_qty, remark: r.remark })) })
async function save(andAudit: boolean) {
  saving.value = true
  try {
    let id = count.value?.id
    const r: any = id ? await scmApi.updateWipCount(id, payload()) : await scmApi.createWipCount(payload())
    if (r.code !== 0) return ElMessage.error(r.message || '保存失败')
    id = id || r.data.id
    if (andAudit) { const a: any = await scmApi.auditWipCount(id); if (a.code !== 0) { ElMessage.error(a.message || '审核失败'); router.replace({ name: 'ScmWipCountForm', params: { id } }); return }
      ElMessage.success(a.data.return_doc ? `已审核，盘盈退料单 ${a.data.return_doc.doc_no} 已生成（草稿）` : '已审核') }
    else ElMessage.success('已保存草稿')
    await router.replace({ name: 'ScmWipCountForm', params: { id } }); await init()
  } finally { saving.value = false }
}
async function audit() {
  try { await ElMessageBox.confirm('审核后盘盈生成退料单草稿、盘亏记为在制损耗，不可反审核。继续？', '审核盘点', { type: 'warning' }) } catch { return }
  saving.value = true
  try { const a: any = await scmApi.auditWipCount(count.value.id); if (a.code === 0) { ElMessage.success('已审核'); await init() } else ElMessage.error(a.message || '审核失败') } finally { saving.value = false }
}
async function remove() {
  try { await ElMessageBox.confirm('删除该草稿盘点单？', '提示', { type: 'warning' }) } catch { return }
  const r: any = await scmApi.deleteWipCount(count.value.id)
  if (r.code === 0) { ElMessage.success('已删除'); goBack() } else ElMessage.error(r.message || '删除失败')
}
onMounted(init)
</script>

<style scoped>
.wc-page { display: flex; flex-direction: column; height: 100%; }
.wc-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.wc-header__left { display: flex; align-items: center; gap: 8px; }
.wc-header__sep { color: var(--el-text-color-placeholder); }
.wc-header__title { font-weight: 600; }
.wc-header__meta { font-size: 12px; color: var(--el-text-color-secondary); }
.wc-header__right { display: flex; gap: 8px; }
.wc-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.wc-form { display: flex; gap: 12px; flex-wrap: wrap; }
.wc-form .grow { flex: 1; min-width: 240px; }
.wc-form :deep(.el-form-item) { margin-bottom: 0; }
.wc-return { font-size: 13px; }
.wc-section__hd h3 { margin: 0 0 6px; font-size: 14px; }
.pos { color: var(--el-color-success); font-weight: 600; }
.neg { color: var(--el-color-danger); font-weight: 600; }
</style>
