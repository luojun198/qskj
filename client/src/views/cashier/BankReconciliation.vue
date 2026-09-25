<template>
  <!-- FIX-262：差异清单——出纳与总账的未对项与余额差异（原银行余额调节表下线） -->
  <div class="page page-recon">
    <div class="filter-row" style="padding: 12px 16px 0">
      <el-button link :icon="ArrowLeft" @click="goReconcile">返回出纳对账</el-button>
      <span class="page-title">差异清单</span><span class="page-sub">出纳日记账 ↔ 总账（已记账）</span>
      <el-select v-model="accountCode" placeholder="选择现金 / 银行科目" style="width: 220px" @change="load">
        <el-option v-for="a in accounts" :key="a.code" :label="`${a.code} ${a.name}`" :value="a.code" />
      </el-select>
      <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="截止日期" style="width: 150px" @change="load" />
      <el-button type="primary" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <FilterClearButton @clear="handleClearFilters" />
      <el-button plain :disabled="!data" @click="handlePrint"><el-icon><Printer /></el-icon>打印</el-button>
    </div>

    <div v-if="data" :key="renderKey" class="recon-body">
      <el-alert v-if="data.unposted" type="warning" :closable="false" show-icon class="recon-alert"
        :title="`截至 ${data.end_date} 该科目有 ${data.unposted} 张未记账凭证，未参与对账（总账余额只含已记账凭证）`" />
      <el-alert v-if="data.stale" type="error" :closable="false" show-icon class="recon-alert"
        :title="`${data.stale} 个对账批次因凭证变动已失效，相关记录已退回未对`" />

      <!-- 余额对照卡片 -->
      <div class="balance-cards">
        <div class="bal-card">
          <div class="bal-label">出纳账面余额<el-tag v-if="data.currency && data.currency !== 'RMB'" type="warning" effect="plain" size="small" style="margin-left:6px">{{ data.currency }} 原币</el-tag></div>
          <div class="bal-value">{{ fmt(data.cashier_balance) }}</div>
          <div class="bal-sub">出纳期初 + 截至日日记账发生额</div>
        </div>
        <div class="bal-card">
          <div class="bal-label">总账余额（已记账）</div>
          <div class="bal-value">{{ fmt(data.gl_balance) }}</div>
          <div class="bal-sub">总账年初 + 当年截至日已记账发生额</div>
        </div>
      </div>

      <!-- 未对项：左右两栏 -->
      <div class="unrecon-grid">
        <div class="unrecon-col">
          <h4>出纳已记、总账未记（{{ unmatchedLabel(data.cashier_unmatched.length, data.cashier_unmatched_total) }}）</h4>
          <el-table :key="data.account_code + '_c'" :data="data.cashier_unmatched" size="small" border stripe max-height="320" style="width: 100%">
            <el-table-column label="日期" prop="biz_date" width="100" />
            <el-table-column label="摘要" prop="summary" min-width="140" show-overflow-tooltip />
            <el-table-column label="票据号" prop="bill_no" width="110" show-overflow-tooltip />
            <el-table-column label="收入" width="110" align="right">
              <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="支出" width="110" align="right">
              <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="col-footer">
            出纳未对净额 <span class="val">{{ fmt(cashierNet) }}</span>
          </div>
        </div>
        <div class="unrecon-col">
          <h4>总账已记、出纳未记（{{ unmatchedLabel(data.gl_unmatched.length, data.gl_unmatched_total) }}）</h4>
          <el-table :key="data.account_code + '_g'" :data="data.gl_unmatched" size="small" border stripe max-height="320" style="width: 100%">
            <el-table-column label="日期" prop="voucher_date" width="100" />
            <el-table-column label="凭证号" width="90">
              <template #default="{ row }">{{ voucherLabel(row) }}</template>
            </el-table-column>
            <el-table-column label="摘要" prop="summary" min-width="140" show-overflow-tooltip />
            <el-table-column label="借方" width="110" align="right">
              <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="贷方" width="110" align="right">
              <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="col-footer">
            总账未对净额 <span class="val">{{ fmt(glNet) }}</span>
          </div>
        </div>
      </div>

      <!-- 调节后余额 -->
      <div class="adjusted-section">
        <div class="adj-card" :class="{ match: isMatch }">
          <div class="adj-label">调节后出纳余额（出纳余额 − 出纳未对净额）</div>
          <div class="adj-value">{{ fmt(data.adjusted_cashier) }}</div>
        </div>
        <div class="adj-arrow">
          <el-icon :size="24" :color="isMatch ? '#67c23a' : '#f56c6c'">
            <CircleCheck v-if="isMatch" /><WarningFilled v-else />
          </el-icon>
        </div>
        <div class="adj-card" :class="{ match: isMatch }">
          <div class="adj-label">调节后总账余额（总账余额 − 总账未对净额）</div>
          <div class="adj-value">{{ fmt(data.adjusted_gl) }}</div>
        </div>
        <div v-if="!isMatch" class="diff-tag">
          <el-tag type="danger" size="large">期初差异 {{ fmt(data.difference) }}</el-tag>
          <div class="diff-note">
            未对项已全部扣除后仍有差额，通常是出纳期初与总账在出纳启用日（{{ data.init_date || '未设置' }}）之前的余额不一致，
            可到 <router-link to="/cashier/init-balance" class="bal-link">出纳期初</router-link> 用「读入总账余额」核对。
          </div>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="请选择科目和截止日期后查询" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Printer, CircleCheck, WarningFilled, ArrowLeft } from '@element-plus/icons-vue'
import { cashierApi, type CashierGlReport } from '@/api/cashier'
import FilterClearButton from '@/components/common/FilterClearButton.vue'
import { useFilterClear } from '@/composables/useFilterClear'

const route = useRoute()
const router = useRouter()
const accounts = ref<{ code: string; name: string }[]>([])

const now = new Date()
const accountCode = ref((route.query.account_code as string) || '')
const endDate = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
const data = ref<CashierGlReport | null>(null)
const loading = ref(false)
const renderKey = ref(0)
const { clearFilters } = useFilterClear([accountCode, endDate])

function handleClearFilters() {
  clearFilters()
  load()
}

const fmt = (v: number) =>
  v === 0 ? '0.00' : (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// FIX-326：未对净额取服务端 SQL 汇总（明细最多 list_limit 条，前端求和会漏算被截断的部分）
const cashierNet = computed(() => data.value?.cashier_unmatched_net ?? 0)
const glNet = computed(() => data.value?.gl_unmatched_net ?? 0)
function unmatchedLabel(shown: number, total?: number) {
  return total != null && total > shown ? `共 ${total} 条，显示前 ${shown} 条` : `${shown} 条`
}
const isMatch = computed(() => !!data.value && Math.abs(data.value.difference) < 0.01)

function voucherLabel(r: { voucher_no: string; voucher_type_name: string | null }) {
  const no = String(r.voucher_no || '')
  return no.includes('-') || !r.voucher_type_name ? no : `${r.voucher_type_name}-${no}`
}

onMounted(async () => {
  const res = await cashierApi.getAccounts()
  if (res.code === 0) {
    accounts.value = res.data
    if (!accountCode.value && accounts.value.length) accountCode.value = accounts.value[0].code
    load()
  }
})

async function load() {
  if (!accountCode.value || !endDate.value) return
  loading.value = true
  try {
    const res = await cashierApi.getGlReconcileReport({ account_code: accountCode.value, end_date: endDate.value })
    if (res.code === 0) { data.value = res.data; renderKey.value++ }
  } finally { loading.value = false }
}

function goReconcile() {
  router.push({ path: '/cashier/reconcile', query: accountCode.value ? { account_code: accountCode.value } : {} })
}

function handlePrint() {
  window.print()
}
</script>

<style scoped>
.page-recon { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.page-title { font-size: var(--cw-text-lg); font-weight: 600; }
.page-sub { font-size: 12px; color: var(--el-text-color-secondary); margin-right: 8px; }
.recon-body { flex: 1; overflow: auto; padding: 16px; }
.recon-alert { margin-bottom: 12px; }
.balance-cards { display: flex; gap: 16px; margin-bottom: 16px; }
.bal-card { flex: 1; text-align: center; padding: 16px; border-radius: 8px; background: var(--el-fill-color-lighter); }
.bal-label { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 4px; }
.bal-value { font-size: 22px; font-weight: 700; }
.bal-sub { margin-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.bal-link { color: var(--el-color-primary); }
.unrecon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; min-width: 0; }
/* Grid 子项默认 min-width:auto，会与 EP doLayout 形成列宽正反馈循环 */
.unrecon-col { min-width: 0; overflow: hidden; }
.unrecon-col :deep(.el-table) { width: 100% !important; max-width: 100%; }
.unrecon-col :deep(.el-table__body table),
.unrecon-col :deep(.el-table__header table) { table-layout: fixed; width: 100% !important; }
.unrecon-col h4 { margin: 0 0 8px; font-size: var(--cw-text-base); }
.col-footer { padding: 8px 0; font-size: var(--cw-text-base); text-align: right; }
.col-footer .val { font-weight: 600; margin: 0 4px; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.adjusted-section { display: flex; align-items: center; gap: 12px; justify-content: center; padding: 16px; border-radius: 8px; background: var(--el-fill-color-lighter); flex-wrap: wrap; }
.adj-card { padding: 12px 24px; border-radius: 6px; text-align: center; border: 2px solid var(--el-border-color); }
.adj-card.match { border-color: #67c23a; }
.adj-label { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.adj-value { font-size: 20px; font-weight: 700; }
.adj-arrow { font-size: 24px; display: flex; align-items: center; }
.diff-tag { width: 100%; text-align: center; }
.diff-note { margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
