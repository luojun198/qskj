<template>
  <div class="page stf-page" v-loading="loading">
    <!-- 顶部导航：返回 + 标题 + 单号 + 状态 + 操作 -->
    <div class="stf-header">
      <div class="stf-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="stf-header__sep">/</span>
        <span class="stf-header__title">{{ stmt ? directionTitle : `新增${directionTitle}` }}</span>
        <el-tag v-if="stmt?.stmt_no" size="small">{{ stmt.stmt_no }}</el-tag>
        <el-tag v-if="stmt" size="small" :type="stmt.status === 'audited' ? 'success' : 'info'" effect="plain">{{ stmt.status === 'audited' ? '已审核' : '草稿' }}</el-tag>
        <span v-if="stmt" class="stf-header__meta">{{ statementDirectionLabel(stmt.direction) }} · {{ stmt.partner_code }} {{ stmt.partner_name || '' }}</span>
      </div>
      <div class="stf-header__right">
        <template v-if="editing">
          <el-button size="small" :loading="fetching" @click="fetchCandidates">取未对账明细</el-button>
          <el-button type="primary" size="small" :loading="saving" @click="save(false)">保存草稿</el-button>
          <el-button type="success" size="small" :loading="saving" @click="save(true)">保存并审核</el-button>
        </template>
        <template v-else-if="stmt?.status === 'draft'">
          <el-button size="small" @click="startEdit">修改</el-button>
          <el-button type="danger" plain size="small" :loading="saving" @click="remove">删除</el-button>
          <el-button type="success" size="small" :loading="saving" @click="audit">审核</el-button>
        </template>
        <template v-else-if="stmt?.status === 'audited'">
          <el-button type="warning" plain size="small" :loading="saving" @click="unaudit">反审核</el-button>
        </template>
        <el-button v-if="stmt" size="small" @click="print"><el-icon><Printer /></el-icon>打印</el-button>
        <!-- 另存：导出 Excel（与凭证、库存等页面「另存」一致；客户测试 20261011） -->
        <el-button v-if="stmt && !editing" size="small" :loading="exporting" @click="saveAs"><el-icon><Download /></el-icon>另存</el-button>
      </div>
    </div>

    <div class="stf-body">
      <el-alert v-if="editing" type="info" :closable="false" show-icon class="stf-tip">
        选择往来单位和截止日期后点「取未对账明细」，勾选本次要对账的行。未勾选的行不受影响，下次生成对账单时会继续带出；
        已在其他对账单中的行不会出现。对账单<b>审核后</b>，其中的源单将被锁定，不能反审核、修改或删除。
      </el-alert>

      <el-form label-width="84px" size="small" class="stf-form" :disabled="!editing">
        <div class="stf-form__row">
          <el-form-item v-if="!fixedDirection && !stmt" label="对账方向">
            <el-radio-group v-model="form.direction" @change="onHeadChange">
              <el-radio-button value="ap">应付（供应商）</el-radio-button>
              <el-radio-button value="ar">应收（客户）</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="往来单位" class="grow">
            <el-select v-model="form.partner_code" filterable :placeholder="form.direction === 'ar' ? '选择客户' : '选择供应商'" style="width:100%" :disabled="!!stmt" @change="onHeadChange">
              <el-option v-for="p in directionPartners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="对账日期">
            <el-date-picker v-model="form.stmt_date" type="date" value-format="YYYY-MM-DD" style="width:140px" :clearable="false" />
          </el-form-item>
        </div>
        <div class="stf-form__row">
          <el-form-item label="开始日期">
            <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" placeholder="不限（含以前未对账）" style="width:180px" />
          </el-form-item>
          <el-form-item label="截止日期">
            <el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width:140px" :clearable="false" />
          </el-form-item>
          <el-form-item label="备注" class="grow"><el-input v-model="form.remark" maxlength="200" /></el-form-item>
        </div>
      </el-form>

      <div class="stf-summary">
        <span>业务金额 <b>{{ fmtAmount(totals.docAmount) }}</b></span>
        <span>{{ form.direction === 'ar' ? '收款' : '付款' }} <b>{{ fmtAmount(totals.paymentAmount) }}</b></span>
        <span>本次对账金额 <b class="em">{{ fmtAmount(totals.netAmount) }}</b></span>
        <span class="muted">截止日往来余额 {{ fmtAmount(ledgerBalance) }}</span>
        <span class="muted">已选 {{ editing ? selectedKeys.size : viewRows.length }} / {{ editing ? candidates.length : viewRows.length }} 行</span>
      </div>

      <el-table ref="tableRef" :data="tableRows" border size="small" class="stf-table" :row-key="rowKey"
        :span-method="spanMethod" empty-text="暂无明细，请先取未对账明细" @selection-change="onSelectionChange">
        <el-table-column v-if="editing" type="selection" width="42" align="center" :reserve-selection="true" />
        <el-table-column label="类别" width="100"><template #default="{ row }">{{ statementCatLabel(row.src_doc_type) }}</template></el-table-column>
        <el-table-column label="单据号" width="150">
          <template #default="{ row }"><el-link type="primary" :underline="false" @click="openDoc(row)">{{ row.src_doc_no }}</el-link></template>
        </el-table-column>
        <el-table-column label="日期" prop="src_doc_date" width="100" />
        <el-table-column label="物料编码" prop="item_code" width="110" show-overflow-tooltip />
        <el-table-column label="物料名称" prop="item_name" min-width="150" show-overflow-tooltip />
        <el-table-column label="规格" prop="spec" width="100" show-overflow-tooltip />
        <el-table-column label="单位" prop="unit" width="56" align="center" />
        <el-table-column label="数量" width="90" align="right"><template #default="{ row }">{{ row.qty == null ? '' : fmtQty(row.qty * row.sign) }}</template></el-table-column>
        <el-table-column label="含税单价" width="100" align="right"><template #default="{ row }">{{ unitGross(row) }}</template></el-table-column>
        <el-table-column label="价税合计" width="120" align="right">
          <template #default="{ row }"><span :class="{ neg: row.sign < 0 }">{{ fmtAmount(row.amount_with_tax * row.sign) }}</span></template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="120" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Printer, Download } from '@element-plus/icons-vue'
import { exportStyledTable } from '@/utils/exportStyledExcel'
import { scmApi, type ScmPartner, type ScmStatement, type ScmStatementLine } from '@/api/scm'
import { todayStr } from '@/utils/format'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'
import { statementCatLabel, statementDirectionLabel } from '@/utils/statementDoc'
import { useScmDecimalsStore } from '@/stores/scmDecimals'

// 小数位：系统参数 → 供应链 → 小数位设置 →「对账单」
const decStore = useScmDecimalsStore()
void decStore.load()
const fmtAmount = (v: any) => decStore.amount(Number(v) || 0, 'statement')
const fmtQty = (v: any) => decStore.qty(Number(v) || 0, 'statement')
const fmtPrice = (v: any) => decStore.price(Number(v) || 0, 'statement')

const route = useRoute()
const router = useRouter()
const statementId = computed(() => String(route.params.id || ''))

const loading = ref(false)
const fetching = ref(false)
const saving = ref(false)
const partners = ref<ScmPartner[]>([])
const stmt = ref<(ScmStatement & { lines: ScmStatementLine[] }) | null>(null)
const editing = ref(true)
// 第五份反馈：应收 / 应付对账单分开入口，菜单带 direction 进来时方向锁定，往来单位只列对应类型
const fixedDirection = route.query.direction === 'ar' || route.query.direction === 'ap'
const form = reactive({
  direction: (route.query.direction === 'ar' ? 'ar' : 'ap') as 'ar' | 'ap',
  partner_code: String(route.query.partner_code || ''),
  stmt_date: todayStr(),
  start_date: '' as string | null,
  end_date: todayStr(),
  remark: '',
})
const candidates = ref<ScmStatementLine[]>([])
const directionTitle = computed(() => (form.direction === 'ar' ? '应收对账单' : '应付对账单'))
/** 应收只列客户、应付只列供应商；类型为「两者」或未设类型的单位两边都列 */
const directionPartners = computed(() => partners.value.filter(p => {
  const t = String(p.partner_type || '')
  if (!t || t === 'both') return true
  return form.direction === 'ar' ? t === 'customer' : t === 'supplier'
}))
const ledgerBalance = ref(0)
const selectedKeys = ref(new Set<string>())
const tableRef = ref<any>()

const rowKey = (r: ScmStatementLine) => (r.src_line_id || r.src_log_id || '') as string
const viewRows = computed(() => stmt.value?.lines || [])
const tableRows = computed(() => (editing.value ? candidates.value : viewRows.value))

const totals = computed(() => {
  const rows = editing.value ? candidates.value.filter(r => selectedKeys.value.has(rowKey(r))) : viewRows.value
  const r2 = (n: number) => Math.round(n * 100) / 100
  // 从润衡导入的历史对账单只有表头金额、没有明细：查看时按表头金额显示
  const s0 = stmt.value
  if (!editing.value && s0 && !rows.length && (Number(s0.net_amount) || Number(s0.doc_amount))) {
    return { docAmount: r2(Number(s0.doc_amount) || 0), paymentAmount: r2(Number(s0.payment_amount) || 0), netAmount: r2(Number(s0.net_amount) || 0) }
  }
  const docAmount = r2(rows.filter(r => r.src_kind === 'line').reduce((s, r) => s + r.amount_with_tax * r.sign, 0))
  const paymentAmount = r2(rows.filter(r => r.src_kind === 'log').reduce((s, r) => s + r.amount_with_tax, 0))
  return { docAmount, paymentAmount, netAmount: r2(docAmount - paymentAmount) }
})

function unitGross(r: ScmStatementLine) {
  if (!r.qty) return ''
  const p = r.amount_with_tax / Number(r.qty)
  return isFinite(p) ? fmtPrice(p) : ''
}

/** 同一单据的类别 / 单据号 / 日期合并单元格 */
function spanMethod({ row, rowIndex, column }: any) {
  const mergeLabels = ['类别', '单据号', '日期']
  if (!mergeLabels.includes(column.label)) return [1, 1]
  const rows = tableRows.value
  if (rowIndex > 0 && rows[rowIndex - 1].src_doc_id === row.src_doc_id) return [0, 0]
  let n = 1
  while (rowIndex + n < rows.length && rows[rowIndex + n].src_doc_id === row.src_doc_id) n++
  return [n, 1]
}

function onSelectionChange(rows: ScmStatementLine[]) {
  selectedKeys.value = new Set(rows.map(rowKey))
}

function onHeadChange() {
  candidates.value = []
  selectedKeys.value = new Set()
}

async function fetchCandidates() {
  if (!form.partner_code) return ElMessage.warning('请选择往来单位')
  if (!form.end_date) return ElMessage.warning('请选择截止日期')
  fetching.value = true
  try {
    const r = await scmApi.getStatementCandidates({
      direction: form.direction, partner_code: form.partner_code, end_date: form.end_date,
      start_date: form.start_date || undefined, statement_id: stmt.value?.id,
    })
    candidates.value = r.data.rows
    ledgerBalance.value = r.data.ledger_balance
    // 新单默认全选；编辑草稿默认勾本单已占用的行
    const pre = stmt.value ? candidates.value.filter(x => x.selected_by_self) : candidates.value
    await nextTick()
    tableRef.value?.clearSelection()
    for (const row of pre) tableRef.value?.toggleRowSelection(row, true)
    selectedKeys.value = new Set(pre.map(rowKey))
    if (!candidates.value.length) ElMessage.info('该往来单位在截止日前没有未对账的明细')
  } catch { /* 拦截器已提示 */ } finally { fetching.value = false }
}

function payload() {
  const rows = candidates.value.filter(r => selectedKeys.value.has(rowKey(r)))
  return {
    direction: form.direction, partner_code: form.partner_code, stmt_date: form.stmt_date,
    start_date: form.start_date || null, end_date: form.end_date, remark: form.remark || null,
    lines: rows.map(r => ({ src_kind: r.src_kind, src_line_id: r.src_line_id, src_log_id: r.src_log_id })),
  }
}

async function save(andAudit: boolean) {
  if (!selectedKeys.value.size) return ElMessage.warning('请至少勾选一行明细')
  if (andAudit) {
    try { await ElMessageBox.confirm('审核后，其中的源单将被锁定，不能反审核、修改或删除。继续？', '保存并审核', { type: 'warning' }) } catch { return }
  }
  saving.value = true
  try {
    const r = stmt.value
      ? await scmApi.updateStatement(stmt.value.id, payload())
      : await scmApi.createStatement(payload())
    if (andAudit) await scmApi.auditStatement(r.data.id)
    ElMessage.success(andAudit ? `对账单 ${r.data.stmt_no} 已审核` : `已保存 ${r.data.stmt_no}`)
    if (!stmt.value) await router.replace({ name: 'ScmStatementForm', params: { id: r.data.id } })
    await load()
  } catch { /* 拦截器已提示 */ } finally { saving.value = false }
}

async function startEdit() {
  if (!stmt.value) return
  editing.value = true
  await fetchCandidates()
}
async function audit() {
  if (!stmt.value) return
  try { await ElMessageBox.confirm(`审核对账单「${stmt.value.stmt_no}」后，其中的源单将被锁定。继续？`, '审核', { type: 'warning' }) } catch { return }
  saving.value = true
  try { await scmApi.auditStatement(stmt.value.id); ElMessage.success('已审核'); await load() } catch { /* 拦截器已提示 */ } finally { saving.value = false }
}
async function unaudit() {
  if (!stmt.value) return
  try { await ElMessageBox.confirm(`反审核对账单「${stmt.value.stmt_no}」？反审核后源单解除锁定。`, '反审核', { type: 'warning' }) } catch { return }
  saving.value = true
  try { await scmApi.unauditStatement(stmt.value.id); ElMessage.success('已反审核'); await load() } catch { /* 拦截器已提示 */ } finally { saving.value = false }
}
async function remove() {
  if (!stmt.value) return
  try { await ElMessageBox.confirm(`删除草稿对账单「${stmt.value.stmt_no}」？明细行将释放。`, '提示', { type: 'warning' }) } catch { return }
  try { await scmApi.deleteStatement(stmt.value.id); ElMessage.success('已删除'); goBack() } catch { /* 拦截器已提示 */ }
}
const exporting = ref(false)
/** 另存：按页面所见列导出 Excel，表头带往来单位 / 对账期间，表尾汇总业务金额 − 收付款 = 本次对账金额 */
async function saveAs() {
  const s = stmt.value
  if (!s) return
  const title = s.direction === 'ar' ? '销售对账单' : '采购对账单'
  const r2 = (n: number) => Math.round(n * 100) / 100
  exporting.value = true
  try {
    await exportStyledTable<ScmStatementLine>({
      fileName: `${title}_${s.stmt_no}_${s.partner_code}.xlsx`,
      sheetName: title,
      title,
      subtitle: `${s.direction === 'ar' ? '客户' : '供应商'}：${s.partner_code} ${s.partner_name || ''}    对账单号：${s.stmt_no}    对账期间：${s.start_date || '期初'} ~ ${s.end_date || ''}    对账日期：${s.stmt_date || ''}`,
      rows: viewRows.value,
      stripe: true,
      columns: [
        { label: '类别', width: 12, value: r => statementCatLabel(r.src_doc_type) },
        { label: '单据号', width: 18, value: r => r.src_doc_no || '' },
        { label: '日期', width: 12, align: 'center', value: r => r.src_doc_date || '' },
        { label: '物料编码', width: 14, value: r => r.item_code || '' },
        { label: '物料名称', width: 22, value: r => r.item_name || '' },
        { label: '规格', width: 14, value: r => r.spec || '' },
        { label: '单位', width: 8, align: 'center', value: r => r.unit || '' },
        { label: '数量', width: 10, align: 'right', type: 'number', value: r => (r.qty == null ? '' : Number(r.qty) * r.sign) },
        { label: '含税单价', width: 12, align: 'right', value: r => unitGross(r) },
        { label: '价税合计', width: 14, align: 'right', type: 'amount', value: r => r2(r.amount_with_tax * r.sign) },
        { label: '备注', width: 20, value: r => r.remark || '' },
      ],
      summaryValues: ['合计', '', '', '', `业务金额 ${fmtAmount(totals.value.docAmount)}`, `${s.direction === 'ar' ? '收款' : '付款'} ${fmtAmount(totals.value.paymentAmount)}`, '', '', '本次对账金额', totals.value.netAmount, ''],
    })
  } catch (e: any) {
    ElMessage.error(e?.message || '另存失败')
  } finally { exporting.value = false }
}
function print() {
  if (stmt.value) router.push({ name: 'ScmStatementPrint', params: { id: stmt.value.id } })
}
function openDoc(row: ScmStatementLine) {
  router.push(scmDocumentRoute(row.src_doc_id, row.src_doc_type, 'audited'))
}
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push({ name: 'ScmStatementList', query: { direction: stmt.value?.direction || form.direction } })
}

async function load() {
  if (!statementId.value) { stmt.value = null; editing.value = true; return }
  loading.value = true
  try {
    const r = await scmApi.getStatement(statementId.value)
    stmt.value = r.data
    Object.assign(form, {
      direction: r.data.direction, partner_code: r.data.partner_code, stmt_date: r.data.stmt_date,
      start_date: r.data.start_date || '', end_date: r.data.end_date, remark: r.data.remark || '',
    })
    ledgerBalance.value = Number(r.data.ledger_balance) || 0
    editing.value = false
    candidates.value = []
  } catch { /* 拦截器已提示 */ } finally { loading.value = false }
}

onMounted(async () => {
  const p = await scmApi.getPartners({})
  if (p.code === 0) partners.value = p.data as ScmPartner[]
  await load()
  if (!stmt.value && form.partner_code) await fetchCandidates()
})
</script>

<style scoped>
.stf-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.stf-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-bg-color); flex-shrink: 0; }
.stf-header__left { display: flex; align-items: center; gap: 6px; font-size: var(--cw-text-base); }
.stf-header__sep { color: var(--el-text-color-placeholder); }
.stf-header__title { font-weight: 600; }
.stf-header__meta { margin-left: 8px; color: var(--el-text-color-secondary); }
.stf-header__right { display: flex; gap: 8px; }
.stf-body { flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.stf-form__row { display: flex; gap: 12px; flex-wrap: wrap; }
.stf-form__row .grow { flex: 1; min-width: 240px; }
.stf-form :deep(.el-form-item) { margin-bottom: 8px; }
.stf-summary { display: flex; gap: 24px; align-items: center; font-size: 13px; padding: 6px 10px; background: var(--el-fill-color-light); border-radius: 4px; flex-wrap: wrap; }
.stf-summary .em { color: var(--el-color-primary); font-size: 15px; }
.stf-summary .muted { color: var(--el-text-color-secondary); }
.neg { color: var(--el-color-danger); }
</style>
