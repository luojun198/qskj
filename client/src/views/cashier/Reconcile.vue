<template>
  <div class="page-reconcile">
    <!-- 顶部：返回 + 标题 + 条件 + 操作 -->
    <div class="rc-header">
      <div class="rc-header-left">
        <el-button link :icon="ArrowLeft" @click="goBack">返回</el-button>
        <span class="rc-title">出纳对账</span>
        <span class="rc-sub">出纳日记账 ↔ 总账已记账凭证分录，支持一对多 / 多对一</span>
      </div>
      <div class="rc-header-left">
        <el-select v-model="accountCode" placeholder="选择科目" style="width:180px" size="small" @change="reload">
          <el-option v-for="a in accounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-select>
        <!-- FIX-260：外币科目按原币对账 -->
        <el-tag v-if="accountCurrency" type="warning" effect="plain" size="small" title="外币科目：按原币金额对账">{{ accountCurrency }} 原币</el-tag>
        <el-date-picker v-model="dateRange[0]" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width:120px" size="small" @change="reload" />
        <el-date-picker v-model="dateRange[1]" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width:120px" size="small" @change="reload" />
        <span class="label">日期容差</span>
        <el-input-number v-model="dayTolerance" :min="0" :max="31" :controls="false" size="small" style="width:52px" />
        <span class="label">天</span>
        <el-button type="primary" size="small" :loading="autoing" @click="handleAuto">自动对账</el-button>
        <el-button size="small" plain @click="$router.push({ path: '/cashier/reconciliation', query: { account_code: accountCode } })">差异清单</el-button>
        <el-button size="small" plain :icon="Upload" @click="goImport">对账单导入</el-button>
        <el-button size="small" plain :loading="loading" :icon="Refresh" @click="reload" />
      </div>
      <!-- 本期汇总：出纳 vs 总账 -->
      <div v-if="summary" class="rc-summary">
        <div class="sum-card">
          <div class="sum-title">出纳日记账</div>
          <div>借 <b class="dc">{{ m(summary.cashier.debit) }}</b>　贷 <b class="cr">{{ m(summary.cashier.credit) }}</b></div>
          <div>余额 <b>{{ m(summary.cashier.balance) }}</b>　未对 <b>{{ summary.cashier.unmatched }}</b> 条</div>
        </div>
        <div class="sum-card">
          <div class="sum-title">总账（已记账）</div>
          <div>借 <b class="dc">{{ m(summary.gl.debit) }}</b>　贷 <b class="cr">{{ m(summary.gl.credit) }}</b></div>
          <div>余额 <b>{{ m(summary.gl.balance) }}</b>　未对 <b>{{ summary.gl.unmatched }}</b> 条</div>
        </div>
        <div class="sum-card" :class="balanceDiff === 0 ? 'is-ok' : 'is-bad'">
          <div class="sum-title">余额差额（出纳 − 总账）</div>
          <div class="sum-diff">{{ m(balanceDiff) }}</div>
          <div class="sum-note">{{ balanceDiff === 0 ? '两个模块余额一致' : '存在未对项或期初差异，见差异清单' }}</div>
        </div>
        <div class="sum-alerts">
          <el-tag v-if="summary.unposted" type="warning" effect="light">本期有 {{ summary.unposted }} 张未记账凭证未参与对账</el-tag>
          <el-tag v-if="staleCount" type="danger" effect="light">{{ staleCount }} 个对账批次因凭证变动已失效，已退回未对</el-tag>
          <el-tag v-if="truncatedTip" type="warning" effect="light">{{ truncatedTip }}</el-tag>
        </div>
      </div>
    </div>

    <!-- 双栏 -->
    <div class="rc-body">
      <div class="rc-col">
        <div class="rc-col-hd">
          <span class="rc-col-title">出纳日记账</span>
          <el-radio-group v-model="cTab" size="small">
            <el-radio-button value="unmatched">未对</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="matched">已对</el-radio-button>
          </el-radio-group>
        </div>
        <el-table ref="cTableRef" :data="cRows" row-key="id" size="small" border class="rc-table"
          :row-class-name="cClass" @selection-change="(v: GlCashierRow[]) => (selC = v)" @row-click="onCClick" @header-dragend="cDrag">
          <el-table-column type="selection" width="34" :selectable="(r: GlCashierRow) => !r.batch_id" />
          <el-table-column label="日期" prop="biz_date" :width="cCw('biz_date', 88)" />
          <el-table-column label="摘要" prop="summary" min-width="90" :width="cWidths.summary" show-overflow-tooltip />
          <el-table-column label="票据号" prop="bill_no" :width="cCw('bill_no', 76)" show-overflow-tooltip />
          <el-table-column label="收入" :width="cCw('debit', 92)" align="right">
            <template #default="{ row }"><span v-if="row.debit" class="dc">{{ m(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="支出" :width="cCw('credit', 92)" align="right">
            <template #default="{ row }"><span v-if="row.credit" class="cr">{{ m(row.credit) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="62" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.match_type" :type="typeTag(row.match_type)" size="small" effect="plain">{{ typeLabel(row.match_type) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="rc-col">
        <div class="rc-col-hd">
          <span class="rc-col-title">总账分录（已记账）</span>
          <el-radio-group v-model="gTab" size="small">
            <el-radio-button value="unmatched">未对</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="matched">已对</el-radio-button>
          </el-radio-group>
        </div>
        <el-table ref="gTableRef" :data="gRows" row-key="id" size="small" border class="rc-table"
          :row-class-name="gClass" @selection-change="(v: GlEntryRow[]) => (selG = v)" @row-click="onGClick" @header-dragend="gDrag">
          <el-table-column type="selection" width="34" :selectable="(r: GlEntryRow) => !r.batch_id" />
          <el-table-column label="日期" prop="voucher_date" :width="gCw('voucher_date', 88)" />
          <el-table-column label="凭证号" :width="gCw('voucher_no', 80)">
            <template #default="{ row }">{{ voucherLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="摘要" prop="summary" min-width="90" :width="gWidths.summary" show-overflow-tooltip />
          <el-table-column label="借方" :width="gCw('debit', 92)" align="right">
            <template #default="{ row }"><span v-if="row.debit" class="dc">{{ m(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方" :width="gCw('credit', 92)" align="right">
            <template #default="{ row }"><span v-if="row.credit" class="cr">{{ m(row.credit) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="62" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.match_type" :type="typeTag(row.match_type)" size="small" effect="plain">{{ typeLabel(row.match_type) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 底部操作条 -->
    <div class="rc-footer">
      <template v-if="activeBatch">
        <span class="footer-hint">
          已对批次（{{ typeLabel(activeBatch.type) }}）：出纳 {{ activeBatch.cashier }} 条 ↔ 总账 {{ activeBatch.gl }} 条，合计 {{ netLabel(activeBatch.amount) }}
        </span>
        <el-button type="danger" size="small" plain :loading="opLoading" @click="handleCancel">撤销对账</el-button>
        <el-button size="small" @click="activeBatchId = ''">取消</el-button>
      </template>
      <template v-else-if="selC.length || selG.length">
        <span class="footer-hint">
          出纳已选 <b>{{ selC.length }}</b> 条 合计 <b>{{ netLabel(selCSum) }}</b>
          ↔ 总账已选 <b>{{ selG.length }}</b> 条 合计 <b>{{ netLabel(selGSum) }}</b>
          <span v-if="manualBlock" class="warn">{{ manualBlock }}</span>
        </span>
        <el-button type="primary" size="small" :disabled="!!manualBlock" :loading="opLoading" @click="handleManual">手动对账</el-button>
        <el-button size="small" @click="clearSelection">取消选择</el-button>
      </template>
      <span v-else class="footer-tip">勾选两侧未对行（一方只能 1 条），金额合计相等即可手动对账；点击已对行查看同批并可撤销</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Refresh, Upload } from '@element-plus/icons-vue'
import { cashierApi, type GlCashierRow, type GlEntryRow, type GlMatchType, type GlReconcileSummary } from '@/api/cashier'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef: cTableRef, colWidth: cCw, onDragEnd: cDrag, widths: cWidths } = useListColumnWidth('cashier_gl_reconcile_cashier')
const { tableRef: gTableRef, colWidth: gCw, onDragEnd: gDrag, widths: gWidths } = useListColumnWidth('cashier_gl_reconcile_gl')

const route = useRoute()
const router = useRouter()

const accounts = ref<{ code: string; name: string; is_foreign?: number; currency_code?: string | null }[]>([])
const accountCurrency = computed(() => {
  const a = accounts.value.find(x => x.code === accountCode.value)
  const code = a && Number(a.is_foreign || 0) === 1 && a.currency_code ? String(a.currency_code).toUpperCase() : ''
  return code && code !== 'CNY' && code !== 'RMB' ? code : ''
})
const accountCode = ref((route.query.account_code as string) || '')
const dateRange = ref<string[]>(['', ''])
const dayTolerance = ref(0)

const loading = ref(false)
const autoing = ref(false)
const opLoading = ref(false)
const cashierRows = ref<GlCashierRow[]>([])
const glRows = ref<GlEntryRow[]>([])
const summary = ref<GlReconcileSummary | null>(null)
const staleCount = ref(0)
/** FIX-326：明细超过上限时只显示前 N 条（合计 / 余额仍按整个区间） */
const truncatedTip = ref('')
const cTab = ref<'all' | 'unmatched' | 'matched'>('unmatched')
const gTab = ref<'all' | 'unmatched' | 'matched'>('unmatched')
const selC = ref<GlCashierRow[]>([])
const selG = ref<GlEntryRow[]>([])
const activeBatchId = ref('')

const byTab = <T extends { batch_id: string | null }>(rows: T[], tab: string) =>
  tab === 'unmatched' ? rows.filter(r => !r.batch_id) : tab === 'matched' ? rows.filter(r => r.batch_id) : rows
const cRows = computed(() => byTab(cashierRows.value, cTab.value))
const gRows = computed(() => byTab(glRows.value, gTab.value))

const m = (v: number) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const net = (rs: Array<{ debit: number; credit: number }>) => Math.round(rs.reduce((t, r) => t + (r.debit || 0) - (r.credit || 0), 0) * 100) / 100
/** 净额显示为「收 / 支 + 金额」，避免支出显示成负数 */
const netLabel = (v: number) => (v < 0 ? `支 ${m(-v)}` : `收 ${m(v)}`)
const selCSum = computed(() => net(selC.value))
const selGSum = computed(() => net(selG.value))
const balanceDiff = computed(() => summary.value ? Math.round((summary.value.cashier.balance - summary.value.gl.balance) * 100) / 100 : 0)

/** 手动对账不可用的原因；空串表示可以对账 */
const manualBlock = computed(() => {
  if (!selC.value.length || !selG.value.length) return '两侧都要选'
  if (selC.value.length > 1 && selG.value.length > 1) return '只支持一对多或多对一'
  if (Math.abs(selCSum.value - selGSum.value) > 0.005) return `金额差 ${m(Math.abs(selCSum.value - selGSum.value))}`
  return ''
})

const typeLabel = (t: GlMatchType | null) => (t === 'link' ? '关联' : t === 'auto' ? '自动' : t === 'manual' ? '手动' : '')
const typeTag = (t: GlMatchType | null) => (t === 'link' ? 'success' : t === 'auto' ? 'primary' : 'warning')
function voucherLabel(r: GlEntryRow) {
  const no = String(r.voucher_no || '')
  return no.includes('-') || !r.voucher_type_name ? no : `${r.voucher_type_name}-${no}`
}

const activeBatch = computed(() => {
  if (!activeBatchId.value) return null
  const cs = cashierRows.value.filter(r => r.batch_id === activeBatchId.value)
  const gs = glRows.value.filter(r => r.batch_id === activeBatchId.value)
  if (!cs.length && !gs.length) return null
  return { cashier: cs.length, gl: gs.length, amount: net(cs), type: (cs[0] || gs[0]).match_type, ref: (cs[0] || gs[0]).id }
})

function cClass({ row }: { row: GlCashierRow }) {
  if (activeBatchId.value && row.batch_id === activeBatchId.value) return 'row-batch'
  return selC.value.some(r => r.id === row.id) ? 'row-sel' : ''
}
function gClass({ row }: { row: GlEntryRow }) {
  if (activeBatchId.value && row.batch_id === activeBatchId.value) return 'row-batch'
  return selG.value.some(r => r.id === row.id) ? 'row-sel' : ''
}

function onCClick(row: GlCashierRow) {
  if (row.batch_id) return showBatch(row.batch_id)
  activeBatchId.value = ''
  ;(cTableRef.value as any)?.toggleRowSelection(row)
}
function onGClick(row: GlEntryRow) {
  if (row.batch_id) return showBatch(row.batch_id)
  activeBatchId.value = ''
  ;(gTableRef.value as any)?.toggleRowSelection(row)
}
/** 点已对行：高亮同批两侧成员（切到「全部」确保都看得见） */
function showBatch(batchId: string) {
  clearSelection()
  activeBatchId.value = activeBatchId.value === batchId ? '' : batchId
  if (activeBatchId.value) {
    if (cTab.value === 'unmatched') cTab.value = 'all'
    if (gTab.value === 'unmatched') gTab.value = 'all'
  }
}
function clearSelection() {
  ;(cTableRef.value as any)?.clearSelection()
  ;(gTableRef.value as any)?.clearSelection()
  selC.value = []
  selG.value = []
}

const rangeParams = () => ({
  account_code: accountCode.value,
  start_date: dateRange.value[0] || undefined,
  end_date: dateRange.value[1] || undefined,
})

async function load() {
  if (!accountCode.value) return
  loading.value = true
  try {
    const res = await cashierApi.getGlReconcileEntries(rangeParams())
    if (res.code !== 0) return
    cashierRows.value = res.data.cashier
    glRows.value = res.data.gl
    summary.value = res.data.summary
    if (res.data.stale) staleCount.value = res.data.stale
    const t = res.data.truncated
    const sides = [t?.cashier ? `出纳 ${res.data.summary.cashier.count} 条` : '', t?.gl ? `总账 ${res.data.summary.gl.count} 条` : ''].filter(Boolean)
    truncatedTip.value = sides.length ? `区间内${sides.join('、')}，每侧仅显示前 ${res.data.limit} 条，请缩小日期范围后对账` : ''
  } finally { loading.value = false }
}
function reload() {
  staleCount.value = 0
  activeBatchId.value = ''
  clearSelection()
  load()
}

async function handleAuto() {
  if (!accountCode.value) return
  autoing.value = true
  try {
    const res = await cashierApi.glAutoMatch({ ...rangeParams(), day_tolerance: dayTolerance.value || 0 })
    if (res.code !== 0) return
    const { linked, matched, stale } = res.data
    ElMessage.success(`自动对账完成：关联 ${linked} 笔、金额匹配 ${matched} 笔${stale ? `；${stale} 个失效批次已退回` : ''}`)
    clearSelection()
    await load()
  } finally { autoing.value = false }
}

async function handleManual() {
  if (manualBlock.value) return
  opLoading.value = true
  try {
    const res = await cashierApi.glManualMatch({
      account_code: accountCode.value,
      journal_ids: selC.value.map(r => r.id),
      entry_ids: selG.value.map(r => r.id),
    })
    if (res.code === 0) { ElMessage.success('手动对账成功'); clearSelection(); await load() }
  } finally { opLoading.value = false }
}

async function handleCancel() {
  if (!activeBatch.value) return
  opLoading.value = true
  try {
    const res = await cashierApi.glCancelMatch({ account_code: accountCode.value, ref_id: activeBatch.value.ref })
    if (res.code === 0) { ElMessage.success('已撤销对账'); activeBatchId.value = ''; await load() }
  } finally { opLoading.value = false }
}

function goBack() {
  router.push({ path: '/cashier/journal', query: accountCode.value ? { account_code: accountCode.value } : {} })
}
/** 对账单导入：生成出纳日记账后回到出纳录单 */
function goImport() {
  router.push({ path: '/cashier/bank-import', query: { account: accountCode.value || undefined } })
}

// keep-alive：从其他页面带 account_code 回来时切科目并刷新
let mountedOnce = false
onActivated(() => {
  if (!mountedOnce) return
  const q = route.query.account_code as string | undefined
  if (q && q !== accountCode.value) accountCode.value = q
  reload()
})

onMounted(async () => {
  const ac = await cashierApi.getAccounts()
  if (ac.code === 0) accounts.value = ac.data
  if (!accountCode.value && accounts.value.length) accountCode.value = accounts.value[0].code
  await load()
  // FIX-326：keep-alive 首次挂载也会触发 onActivated；首次加载完成后才置位，避免进页面时重复加载两遍
  mountedOnce = true
})
</script>

<style scoped>
.page-reconcile { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.rc-header { padding:8px 12px 6px; border-bottom:1px solid var(--el-border-color-light); display:flex; flex-direction:column; gap:6px; }
.rc-header-left { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.rc-title { font-size: var(--cw-text-lg); font-weight:600; }
.rc-sub { font-size:12px; color: var(--el-text-color-secondary); }
.label { font-size:12px; color: var(--el-text-color-regular); }
.rc-summary { display:flex; gap:8px; align-items:stretch; flex-wrap:wrap; }
.sum-card { border:1px solid var(--el-border-color-lighter); border-radius:6px; padding:4px 10px; font-size:12px; line-height:20px; background: var(--el-fill-color-lighter); min-width:210px; }
.sum-card b { font-weight:600; }
.sum-title { font-weight:600; color: var(--el-text-color-primary); }
.sum-card.is-ok { border-color: var(--el-color-success-light-5); background: var(--el-color-success-light-9); }
.sum-card.is-bad { border-color: var(--el-color-warning-light-5); background: var(--el-color-warning-light-9); }
.sum-diff { font-size:16px; font-weight:700; }
.sum-note { color: var(--el-text-color-secondary); }
.sum-alerts { display:flex; flex-direction:column; gap:4px; justify-content:center; }
.rc-body { flex:1; overflow:hidden; display:flex; gap:8px; padding:8px 12px 0; }
.rc-col { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; overflow:hidden; }
.rc-col-hd { display:flex; align-items:center; justify-content:space-between; }
.rc-col-title { font-size:12px; font-weight:600; color: var(--el-text-color-primary); }
.rc-table { flex:1; }
.rc-table :deep(.el-table__body-wrapper) { overflow-y:auto; }
.rc-table :deep(.el-table__row) { cursor:pointer; }
.rc-footer { padding:5px 12px; border-top:1px solid var(--el-border-color-light); display:flex; align-items:center; gap:8px; min-height:38px; }
.footer-hint { font-size: var(--cw-text-base); color: var(--el-text-color-regular); }
.footer-tip { font-size:12px; color: var(--el-text-color-secondary); }
.warn { color: var(--el-color-warning); font-weight:600; margin-left:6px; }
.dc { color:#409eff; }
.cr { color:#f56c6c; }
</style>

<style>
.el-table tr.row-sel td { background:#ecf5ff !important; }
.el-table tr.row-batch td { background:#f0f9eb !important; }
</style>
