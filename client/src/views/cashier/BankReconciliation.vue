<template>
  <div class="page page-recon">
    
    <div v-if="data" :key="renderKey" class="recon-body">
      <!-- 余额对照卡片 -->
      <div class="balance-cards">
        <div class="bal-card">
          <div class="bal-label">企业账面余额</div>
          <div class="bal-value">{{ fmt(data.enterprise_balance) }}</div>
        </div>
        <div class="bal-card">
          <div class="bal-label">银行对账单余额</div>
          <div class="bal-value">{{ fmt(data.bank_balance) }}</div>
        </div>
      </div>

      <!-- 未达账项表：左右两栏 -->
      <div class="unrecon-grid">
        <div class="unrecon-col">
          <h4>企业已记、银行未记（{{ data.enterprise_recorded.length }} 条）</h4>
          <el-table
            :key="data?.account_code + '_ent'"
            :data="data.enterprise_recorded"
            size="small"
            border
            stripe
            max-height="320"
            style="width: 100%"
          >
            <el-table-column label="日期" prop="biz_date" width="100" />
            <el-table-column label="摘要" prop="summary" width="140" show-overflow-tooltip />
            <el-table-column label="票据号" prop="bill_no" width="120" show-overflow-tooltip />
            <el-table-column label="收入" width="110" align="right">
              <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="支出" width="110" align="right">
              <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="col-footer">
            加：银行已收企业未收 <span class="val debit">{{ fmt(bankUnrecCredit) }}</span>
            &nbsp;&nbsp;减：银行已付企业未付 <span class="val credit">{{ fmt(bankUnrecDebit) }}</span>
          </div>
        </div>
        <div class="unrecon-col">
          <h4>银行已记、企业未记（{{ data.bank_recorded.length }} 条）</h4>
          <el-table
            :key="data?.account_code + '_bank'"
            :data="data.bank_recorded"
            size="small"
            border
            stripe
            max-height="320"
            style="width: 100%"
          >
            <el-table-column label="日期" prop="biz_date" width="100" />
            <el-table-column label="结算方式" prop="settle_type" width="90" />
            <el-table-column label="票据号" prop="bill_no" width="120" show-overflow-tooltip />
            <el-table-column label="收入" width="110" align="right">
              <template #default="{ row }"><span v-if="row.debit" class="debit">{{ fmt(row.debit) }}</span></template>
            </el-table-column>
            <el-table-column label="支出" width="110" align="right">
              <template #default="{ row }"><span v-if="row.credit" class="credit">{{ fmt(row.credit) }}</span></template>
            </el-table-column>
          </el-table>
          <div class="col-footer">
            加：企业已收银行未收 <span class="val debit">{{ fmt(entUnrecCredit) }}</span>
            &nbsp;&nbsp;减：企业已付银行未付 <span class="val credit">{{ fmt(entUnrecDebit) }}</span>
          </div>
        </div>
      </div>

      <!-- 调节后余额 -->
      <div class="adjusted-section">
        <div class="adj-card" :class="{ match: isMatch }">
          <div class="adj-label">调节后企业余额</div>
          <div class="adj-value">{{ fmt(data.adjusted_enterprise) }}</div>
        </div>
        <div class="adj-arrow">
          <el-icon :size="24" :color="isMatch ? '#67c23a' : '#f56c6c'">
            <CircleCheck v-if="isMatch" /><WarningFilled v-else />
          </el-icon>
        </div>
        <div class="adj-card" :class="{ match: isMatch }">
          <div class="adj-label">调节后银行余额</div>
          <div class="adj-value">{{ fmt(data.adjusted_bank) }}</div>
        </div>
        <div v-if="!isMatch" class="diff-tag">
          <el-tag type="danger" size="large">差额 ¥{{ fmt(data.difference) }}</el-tag>
        </div>
      </div>
    </div>

    <el-empty v-else-if="!loading" description="请选择银行科目和截止日期后查询" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Printer, CircleCheck, WarningFilled } from '@element-plus/icons-vue'
import { cashierApi, type ReconciliationData } from '@/api/cashier'

const accounts = ref<{ code: string; name: string; is_cash: number; is_bank: number }[]>([])
const bankAccounts = computed(() => accounts.value.filter(a => a.is_bank && !a.is_cash))

const now = new Date()
const accountCode = ref('')
const endDate = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
const data = ref<ReconciliationData | null>(null)
const loading = ref(false)
const renderKey = ref(0)

const fmt = (v: number) =>
  v === 0 ? '0.00' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const isMatch = computed(() => data.value && Math.abs(data.value.difference) < 0.01)

const entUnrecCredit = computed(() => data.value?.enterprise_recorded.reduce((s, r) => s + r.debit, 0) ?? 0)
const entUnrecDebit  = computed(() => data.value?.enterprise_recorded.reduce((s, r) => s + r.credit, 0) ?? 0)
const bankUnrecCredit = computed(() => data.value?.bank_recorded.reduce((s, r) => s + r.debit, 0) ?? 0)
const bankUnrecDebit  = computed(() => data.value?.bank_recorded.reduce((s, r) => s + r.credit, 0) ?? 0)

onMounted(async () => {
  const res = await cashierApi.getAccounts()
  if (res.code === 0) {
    accounts.value = res.data
    if (bankAccounts.value.length) {
      accountCode.value = bankAccounts.value[0].code
      load()
    }
  }
})

async function load() {
  if (!accountCode.value || !endDate.value) return
  loading.value = true
  try {
    const res = await cashierApi.getReconciliation({ account_code: accountCode.value, end_date: endDate.value })
    if (res.code === 0) { data.value = res.data; renderKey.value++ }
  } finally { loading.value = false }
}

function handlePrint() {
  window.print()
}
</script>

<style scoped>
.page-recon { display: flex; flex-direction: column; height: 100%; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.recon-body { flex: 1; overflow: auto; padding: 16px; }
.balance-cards { display: flex; gap: 16px; margin-bottom: 16px; }
.bal-card { flex: 1; text-align: center; padding: 16px; border-radius: 8px; background: var(--el-fill-color-lighter); }
.bal-label { font-size: 13px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
.bal-value { font-size: 22px; font-weight: 700; }
.unrecon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; min-width: 0; }
/* Grid 子项默认 min-width:auto，会与 EP doLayout 形成列宽正反馈循环 */
.unrecon-col { min-width: 0; overflow: hidden; }
.unrecon-col :deep(.el-table) { width: 100% !important; max-width: 100%; }
.unrecon-col :deep(.el-table__body table),
.unrecon-col :deep(.el-table__header table) { table-layout: fixed; width: 100% !important; }
.unrecon-col h4 { margin: 0 0 8px; font-size: 13px; }
.col-footer { padding: 8px 0; font-size: 13px; text-align: right; }
.col-footer .val { font-weight: 600; margin: 0 4px; }
.debit { color: #409eff; }
.credit { color: #f56c6c; }
.adjusted-section { display: flex; align-items: center; gap: 12px; justify-content: center; padding: 16px; border-radius: 8px; background: var(--el-fill-color-lighter); flex-wrap: wrap; }
.adj-card { padding: 12px 24px; border-radius: 6px; text-align: center; border: 2px solid var(--el-border-color); }
.adj-card.match { border-color: #67c23a; }
.adj-label { font-size: 13px; color: var(--el-text-color-secondary); }
.adj-value { font-size: 20px; font-weight: 700; }
.adj-arrow { font-size: 24px; display: flex; align-items: center; }
.diff-tag { width: 100%; text-align: center; }
</style>
