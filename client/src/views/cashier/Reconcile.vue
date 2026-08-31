<template>
  <div class="page-reconcile">
    <!-- 顶部工具栏 -->
    <div class="rc-header">
      <div class="rc-header-left">
        <el-select v-model="accountCode" placeholder="选择科目" style="width:160px" size="small" @change="load">
          <el-option v-for="a in accounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
        </el-select>
        <el-date-picker v-model="dateRange[0]" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width:115px" size="small" @change="load" />
        <el-date-picker v-model="dateRange[1]" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width:115px" size="small" @change="load" />
        <el-checkbox v-model="useBillNo" size="small">票据号优先</el-checkbox>
        <el-button type="primary" size="small" :loading="reconciling" @click="handleAutoReconcile">自动勾对</el-button>
        <el-button size="small" :icon="Plus" @click="showAdd = !showAdd">录入对账单</el-button>
        <el-button size="small" plain @click="$router.push('/cashier/reconciliation')">余额调节表</el-button>
        <el-button size="small" plain :loading="loading" :icon="Refresh" @click="load" />
      </div>
      <!-- 统计 -->
      <div class="rc-stats">
        <span>日记账：未对 <b>{{ js.unmatched }}</b> 条 ¥{{ n(js.unmatchedAmt) }} / 已对 <b>{{ js.matched }}</b> 条</span>
        <span class="sep">｜</span>
        <span>对账单：未对 <b>{{ bs.unmatched }}</b> 条 / 已对 <b>{{ bs.matched }}</b> 条</span>
        <template v-if="selJ && selB">
          <span class="sep">｜</span>
          <span class="hint">已选 {{ n(selJ.debit || selJ.credit) }} ↔ {{ n(selB.debit || selB.credit) }}
            <span v-if="Math.abs((selJ.debit-selJ.credit)-(selB.debit-selB.credit))>0.005" class="warn">金额不一致</span>
          </span>
        </template>
      </div>
    </div>

    <!-- 快速录入 -->
    <div v-if="showAdd" class="rc-add">
      <el-date-picker v-model="addForm.biz_date" type="date" value-format="YYYY-MM-DD" placeholder="日期" style="width:105px" size="small" />
      <el-input-number v-model="addForm.debit" :precision="2" :min="0" placeholder="收入" style="width:105px" size="small" controls-position="right" />
      <el-input-number v-model="addForm.credit" :precision="2" :min="0" placeholder="支出" style="width:105px" size="small" controls-position="right" />
      <el-input v-model="addForm.bill_no" placeholder="票据号" style="width:100px" size="small" />
      <el-select v-model="addForm.settle_type" clearable placeholder="结算方式" style="width:95px" size="small">
        <el-option v-for="s in settleTypes" :key="s.code" :label="s.name" :value="s.code" />
      </el-select>
      <el-button type="primary" size="small" :loading="adding" @click="handleAdd">保存</el-button>
      <el-button size="small" @click="showAdd=false">取消</el-button>
    </div>

    <!-- 双栏 -->
    <div class="rc-body">
      <!-- 左栏：日记账 -->
      <div class="rc-col">
        <div class="rc-col-hd">
          <span class="rc-col-title">出纳日记账</span>
          <el-radio-group v-model="jTab" size="small">
            <el-radio-button value="unmatched">未对</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="matched">已对</el-radio-button>
          </el-radio-group>
        </div>
        <el-table ref="jTableRef" :data="jRows" size="small" border class="rc-table" highlight-current-row
          @row-click="onJClick" :row-class-name="jClass" @header-dragend="jDrag">
          <el-table-column label="日期" prop="biz_date" :width="jCw('biz_date', 84)" />
          <el-table-column label="摘要" prop="summary" min-width="80" :width="jWidths.summary" show-overflow-tooltip />
          <el-table-column label="借方" prop="debit" :width="jCw('debit', 86)" align="right">
            <template #default="{row}"><span v-if="row.debit" class="dc">{{ m(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方" prop="credit" :width="jCw('credit', 86)" align="right">
            <template #default="{row}"><span v-if="row.credit" class="cr">{{ m(row.credit) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="42" align="center">
            <template #default="{row}">
              <el-tag :type="row.reconciled?'success':'info'" size="small" effect="plain">{{ row.reconciled?'✓':'—' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 右栏：对账单 -->
      <div class="rc-col">
        <div class="rc-col-hd">
          <span class="rc-col-title">银行对账单</span>
          <el-radio-group v-model="bTab" size="small">
            <el-radio-button value="unmatched">未对</el-radio-button>
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="matched">已对</el-radio-button>
          </el-radio-group>
        </div>
        <el-table ref="bTableRef" :data="bRows" size="small" border class="rc-table" highlight-current-row
          @row-click="onBClick" :row-class-name="bClass" @header-dragend="bDrag">
          <el-table-column label="日期" prop="biz_date" :width="bCw('biz_date', 84)" />
          <el-table-column label="票据号" prop="bill_no" min-width="80" :width="bWidths.bill_no" show-overflow-tooltip />
          <el-table-column label="借方" prop="debit" :width="bCw('debit', 86)" align="right">
            <template #default="{row}"><span v-if="row.debit" class="dc">{{ m(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方" prop="credit" :width="bCw('credit', 86)" align="right">
            <template #default="{row}"><span v-if="row.credit" class="cr">{{ m(row.credit) }}</span></template>
          </el-table-column>
          <el-table-column label="" width="42" align="center">
            <template #default="{row}">
              <el-tag :type="row.matched?'success':'info'" size="small" effect="plain">{{ row.matched?'✓':'—' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 底部操作条 -->
    <div class="rc-footer">
      <template v-if="selJ && !selJ.reconciled && selB && !selB.matched">
        <el-button type="primary" size="small" :loading="opLoading" @click="handleManual">手动勾对</el-button>
        <el-button size="small" @click="selJ=null;selB=null">取消选择</el-button>
      </template>
      <template v-else-if="cancelRow">
        <span class="footer-hint">撤销「{{ cancelRow.biz_date }}」的对账？</span>
        <el-button type="danger" size="small" plain :loading="opLoading" @click="handleCancel">确认撤销</el-button>
        <el-button size="small" @click="cancelRow=null">取消</el-button>
      </template>
      <template v-else>
        <span class="footer-tip">点击未对账行选中 → 两侧各选一行后可手动勾对；点击已对账行可撤销</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { cashierApi, type JournalRow, type BankStatement, type SettleType } from '@/api/cashier'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'

const { tableRef: jTableRef, colWidth: jCw, onDragEnd: jDrag, widths: jWidths } = useListColumnWidth('cashier_reconcile_journal')
const { tableRef: bTableRef, colWidth: bCw, onDragEnd: bDrag, widths: bWidths } = useListColumnWidth('cashier_reconcile_bank')

const route = useRoute()
const router = useRouter()

const accounts = ref<{ code: string; name: string }[]>([])
const settleTypes = ref<SettleType[]>([])
const accountCode = ref((route.query.account_code as string) || '')
const dateRange = ref<string[]>(['', ''])
const useBillNo = ref(true)

const loading = ref(false)
const reconciling = ref(false)
const opLoading = ref(false)
const adding = ref(false)
const showAdd = ref(false)
const addForm = ref({ biz_date: '', debit: 0, credit: 0, bill_no: '', settle_type: '' })

const journalRows = ref<JournalRow[]>([])
const bankRows = ref<BankStatement[]>([])
const jTab = ref<'all'|'unmatched'|'matched'>('unmatched')
const bTab = ref<'all'|'unmatched'|'matched'>('unmatched')
const selJ = ref<JournalRow | null>(null)
const selB = ref<BankStatement | null>(null)
const cancelRow = ref<JournalRow | null>(null)

const jRows = computed(() => {
  if (jTab.value === 'unmatched') return journalRows.value.filter(r => !r.reconciled)
  if (jTab.value === 'matched') return journalRows.value.filter(r => r.reconciled)
  return journalRows.value
})
const bRows = computed(() => {
  if (bTab.value === 'unmatched') return bankRows.value.filter(r => !r.matched)
  if (bTab.value === 'matched') return bankRows.value.filter(r => r.matched)
  return bankRows.value
})
const js = computed(() => {
  const rows = journalRows.value
  const u = rows.filter(r => !r.reconciled)
  return { matched: rows.filter(r => r.reconciled).length, unmatched: u.length, unmatchedAmt: u.reduce((s, r) => s + r.debit + r.credit, 0) }
})
const bs = computed(() => ({
  matched: bankRows.value.filter(r => r.matched).length,
  unmatched: bankRows.value.filter(r => !r.matched).length,
}))

const m = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n = (v: number) => v === 0 ? '0.00' : m(v)

function jClass({ row }: { row: JournalRow }) {
  if (selJ.value?.id === row.id) return 'row-sel'
  if (cancelRow.value?.id === row.id) return 'row-cancel'
  return ''
}
function bClass({ row }: { row: BankStatement }) {
  return selB.value?.id === row.id ? 'row-sel' : ''
}

function onJClick(row: JournalRow) {
  if (row.reconciled) { cancelRow.value = cancelRow.value?.id === row.id ? null : row; selJ.value = null; selB.value = null }
  else { cancelRow.value = null; selJ.value = selJ.value?.id === row.id ? null : row }
}
function onBClick(row: BankStatement) {
  if (!row.matched) { cancelRow.value = null; selB.value = selB.value?.id === row.id ? null : row }
}

async function load() {
  if (!accountCode.value) return
  loading.value = true
  try {
    const [jr, br] = await Promise.all([
      cashierApi.getJournal({ account_code: accountCode.value, start_date: dateRange.value[0] || undefined, end_date: dateRange.value[1] || undefined }),
      cashierApi.getBankStatements({ account_code: accountCode.value, start_date: dateRange.value[0] || undefined, end_date: dateRange.value[1] || undefined }),
    ])
    if (jr.code === 0) journalRows.value = jr.data.rows
    if (br.code === 0) bankRows.value = br.data
  } finally { loading.value = false }
}

async function handleAutoReconcile() {
  if (!accountCode.value) return
  reconciling.value = true
  try {
    const res = await cashierApi.autoReconcile({ account_code: accountCode.value, start_date: dateRange.value[0]||undefined, end_date: dateRange.value[1]||undefined, use_bill_no: useBillNo.value })
    if (res.code === 0) { ElMessage.success(`自动勾对完成，匹配 ${res.data.matched} 条`); selJ.value=null; selB.value=null; cancelRow.value=null; await load() }
  } finally { reconciling.value = false }
}

async function handleManual() {
  if (!selJ.value || !selB.value) return
  opLoading.value = true
  try {
    const res = await cashierApi.manualReconcile({ journal_id: selJ.value.id, bank_statement_id: selB.value.id })
    if (res.code === 0) { ElMessage.success('手动勾对成功'); selJ.value=null; selB.value=null; await load() }
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '手动勾对失败') }
  finally { opLoading.value = false }
}

async function handleCancel() {
  if (!cancelRow.value) return
  opLoading.value = true
  try {
    const res = await cashierApi.cancelReconcile({ journal_id: cancelRow.value.id })
    if (res.code === 0) { ElMessage.success('已撤销对账'); cancelRow.value=null; await load() }
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '撤销失败') }
  finally { opLoading.value = false }
}

async function handleAdd() {
  if (!addForm.value.biz_date) return ElMessage.warning('请填写日期')
  if (!addForm.value.debit && !addForm.value.credit) return ElMessage.warning('收入或支出不能为零')
  adding.value = true
  try {
    const res = await cashierApi.createBankStatement({ account_code: accountCode.value, ...addForm.value, bill_no: addForm.value.bill_no||null, settle_type: addForm.value.settle_type||null } as any)
    if (res.code === 0) { ElMessage.success('已录入'); addForm.value = { biz_date:'', debit:0, credit:0, bill_no:'', settle_type:'' }; showAdd.value=false; await load() }
  } finally { adding.value = false }
}

onMounted(async () => {
  const [ac, st] = await Promise.all([cashierApi.getAccounts(), cashierApi.getSettleTypes()])
  if (ac.code === 0) accounts.value = ac.data
  if (st.code === 0) settleTypes.value = st.data
  if (!accountCode.value && accounts.value.length) accountCode.value = accounts.value[0].code
  await load()
})
</script>

<style scoped>
.page-reconcile { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.rc-header { padding:8px 12px 6px; border-bottom:1px solid var(--el-border-color-light); display:flex; flex-direction:column; gap:5px; }
.rc-header-left { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.rc-stats { font-size:12px; color:#606266; display:flex; align-items:center; gap:6px; }
.rc-stats b { color:#303133; font-weight:600; }
.sep { color:#dcdfe6; }
.hint { color:#409eff; }
.warn { color:#e6a23c; font-weight:600; margin-left:4px; }
.rc-add { padding:5px 12px; background:var(--el-fill-color-lighter); border-bottom:1px solid var(--el-border-color-light); display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
.rc-body { flex:1; overflow:hidden; display:flex; gap:8px; padding:8px 12px 0; }
.rc-col { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; overflow:hidden; }
.rc-col-hd { display:flex; align-items:center; justify-content:space-between; }
.rc-col-title { font-size:12px; font-weight:600; color:#303133; }
.rc-table { flex:1; }
.rc-table :deep(.el-table__body-wrapper) { overflow-y:auto; }
.rc-footer { padding:5px 12px; border-top:1px solid var(--el-border-color-light); display:flex; align-items:center; gap:8px; min-height:36px; }
.footer-hint { font-size:13px; color:#606266; }
.footer-tip { font-size:12px; color:#909399; }
.dc { color:#409eff; }
.cr { color:#f56c6c; }
</style>

<style>
.el-table tr.row-sel td { background:#ecf5ff !important; }
.el-table tr.row-cancel td { background:#fef0f0 !important; }
</style>
