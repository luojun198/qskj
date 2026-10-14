<template>
  <div class="page cfa-page">
    <div class="cfa-header">
      <div class="cfa-header__left">
        <span class="cfa-header__title">现金流量表</span>
        <el-tag size="small" effect="plain" type="success" style="margin-left:8px">按科目现金流量项目自动计算</el-tag>
        <el-tag v-if="data?.standardName" size="small" effect="plain" style="margin-left:4px">{{ data.standardName }}</el-tag>
      </div>
      <div class="cfa-header__right">
        <el-select v-model="filters.year" size="small" style="width: 100px">
          <el-option v-for="y in years" :key="y" :label="`${y}年`" :value="y" />
        </el-select>
        <el-select v-model="filters.period" size="small" style="width: 90px">
          <el-option v-for="m in 12" :key="m" :label="`${m}月`" :value="m" />
        </el-select>
        <el-select v-model="filters.scope" size="small" style="width: 110px">
          <el-option label="本月" value="month" />
          <el-option label="本年累计" value="ytd" />
        </el-select>
        <el-button type="primary" size="small" :loading="loading" @click="fetchData">查询</el-button>
        <el-button size="small" :disabled="!data" @click="exportData">另存</el-button>
        <el-button size="small" @click="router.push('/base/cash-flow-account-map')">科目现金流量项目</el-button>
      </div>
    </div>
    <AccountScopeAlert />

    <div v-loading="loading" class="cfa-body">
      <template v-if="data">
        <el-alert
          v-if="!data.persisted"
          type="info"
          :closable="false"
          show-icon
          class="cfa-alert"
          title="本账套还没有保存过科目现金流量项目，当前按系统默认规则计算；打开「科目现金流量项目」核对后即保存。"
        />
        <el-alert
          v-if="Math.abs(data.unmappedTotal) >= 0.01"
          type="warning"
          :closable="false"
          show-icon
          class="cfa-alert"
        >
          <template #title>
            有 {{ fmt(data.unmappedTotal) }} 元现金收付的对方科目未设置现金流量项目，未计入任何项目：
            <span v-for="u in data.unmapped.slice(0, 6)" :key="u.account_id + u.side" class="cfa-unmapped">
              {{ u.account_code }} {{ u.account_name }}（{{ u.side === 'credit' ? '贷' : '借' }} {{ fmt(u.amount) }}）
            </span>
            <span v-if="data.unmapped.length > 6">等 {{ data.unmapped.length }} 项</span>
            <el-button link type="primary" size="small" @click="router.push('/base/cash-flow-account-map')">去设置</el-button>
          </template>
        </el-alert>

        <el-tabs v-model="activeTab" class="cfa-tabs">
          <el-tab-pane label="主表" name="main">
            <table class="cfa-table">
              <thead>
                <tr><th>项目</th><th class="cfa-amount-col">金额</th></tr>
              </thead>
              <tbody>
                <template v-for="(sec, idx) in data.sections" :key="sec.key">
                  <tr class="cfa-section"><td colspan="2">{{ SECTION_NO[idx] }}、{{ sec.label }}产生的现金流量</td></tr>
                  <tr v-for="it in sec.inflows" :key="it.code">
                    <td class="cfa-indent">{{ it.name }}</td>
                    <td class="cfa-amount">{{ fmt(it.amount) }}</td>
                  </tr>
                  <tr class="cfa-subtotal">
                    <td class="cfa-indent2">{{ sec.label }}现金流入小计</td>
                    <td class="cfa-amount">{{ fmt(sec.inflowTotal) }}</td>
                  </tr>
                  <tr v-for="it in sec.outflows" :key="it.code">
                    <td class="cfa-indent">{{ it.name }}</td>
                    <td class="cfa-amount">{{ fmt(it.amount) }}</td>
                  </tr>
                  <tr class="cfa-subtotal">
                    <td class="cfa-indent2">{{ sec.label }}现金流出小计</td>
                    <td class="cfa-amount">{{ fmt(sec.outflowTotal) }}</td>
                  </tr>
                  <tr class="cfa-total">
                    <td>{{ sec.label }}产生的现金流量净额</td>
                    <td class="cfa-amount">{{ fmt(sec.net) }}</td>
                  </tr>
                </template>
                <tr v-for="it in data.others" :key="it.code">
                  <td>{{ it.name }}</td>
                  <td class="cfa-amount">{{ fmt(it.amount) }}</td>
                </tr>
                <tr class="cfa-total">
                  <td>{{ SECTION_NO[data.sections.length] }}、现金及现金等价物净增加额</td>
                  <td class="cfa-amount">{{ fmt(data.netIncrease) }}</td>
                </tr>
                <tr>
                  <td class="cfa-indent">加：期初现金及现金等价物余额</td>
                  <td class="cfa-amount">{{ fmt(data.beginCash) }}</td>
                </tr>
                <tr class="cfa-total">
                  <td>{{ SECTION_NO[data.sections.length + 1] }}、期末现金及现金等价物余额</td>
                  <td class="cfa-amount">{{ fmt(data.endCash) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="cfa-check">
              <el-tag :type="balanceOk ? 'success' : 'danger'" size="small">
                {{ balanceOk ? '平衡' : '不平衡' }}
              </el-tag>
              期初 {{ fmt(data.beginCash) }} + 净增加 {{ fmt(data.netIncrease) }} = {{ fmt(data.beginCash + data.netIncrease) }}，
              期末余额 {{ fmt(data.endCash) }}
              <span v-if="!balanceOk">，差额 {{ fmt(data.endCash - data.beginCash - data.netIncrease) }}（通常是对方科目未设置项目，或有未记账凭证）</span>
            </div>
          </el-tab-pane>

          <el-tab-pane v-if="data.hasSupplement !== false" label="补充资料（间接法）" name="supplement">
            <table class="cfa-table">
              <thead>
                <tr><th>将净利润调节为{{ data.sections[0]?.label }}现金流量</th><th class="cfa-amount-col">金额</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in data.supplement" :key="s.code" :class="{ 'cfa-subtotal': s.computed }">
                  <td :class="{ 'cfa-indent': !s.computed }">{{ s.name }}</td>
                  <td class="cfa-amount">{{ fmt(s.amount) }}</td>
                </tr>
                <tr class="cfa-total">
                  <td>{{ data.sections[0]?.label }}产生的现金流量净额（间接法）</td>
                  <td class="cfa-amount">{{ fmt(data.indirectOperating) }}</td>
                </tr>
                <tr>
                  <td class="cfa-indent">主表{{ data.sections[0]?.label }}现金流量净额（直接法）</td>
                  <td class="cfa-amount">{{ fmt(data.directOperating) }}</td>
                </tr>
                <tr :class="Math.abs(data.indirectDiff) >= 0.01 ? 'cfa-diff' : ''">
                  <td class="cfa-indent">差额（间接法 − 直接法）</td>
                  <td class="cfa-amount">{{ fmt(data.indirectDiff) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="cfa-note">
              附表按「科目现金流量项目」的附表列汇总非现金科目发生额（排除结转凭证）：资产负债类贷方记正、借方记负，损益类借方记正、贷方记负。
              有差额时，检查投资 / 筹资类科目的附表项目是否误设了经营性调节项，或在附表中用「其他」调节。
            </p>
          </el-tab-pane>
        </el-tabs>
      </template>
      <el-empty v-else-if="!loading" description="请选择期间后查询" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/api/request'
import { formatAmount } from '@/utils/format'
import { useSystemParamsStore } from '@/stores/systemParams'
import { exportStyledTable, type ExportColumnDef } from '@/utils/exportStyledExcel'
import AccountScopeAlert from '@/components/AccountScopeAlert.vue'

interface AmountLine { code: string; name: string; amount: number }
interface Section {
  key: string
  label: string
  inflows: AmountLine[]
  outflows: AmountLine[]
  inflowTotal: number
  outflowTotal: number
  net: number
}
interface AutoCashFlow {
  year: number
  period: number
  scope: 'month' | 'ytd'
  persisted: boolean
  standardName?: string
  hasSupplement?: boolean
  sections: Section[]
  others: AmountLine[]
  netIncrease: number
  cashChange: number
  beginCash: number
  endCash: number
  supplement: Array<AmountLine & { computed: boolean }>
  netProfit: number
  indirectOperating: number
  directOperating: number
  indirectDiff: number
  unmapped: Array<{ account_id: string; account_code: string; account_name: string; side: 'credit' | 'debit'; amount: number }>
  unmappedTotal: number
}

const SECTION_NO = ['一', '二', '三', '四', '五', '六']

const router = useRouter()
const systemParamsStore = useSystemParamsStore()
const loading = ref(false)
const data = ref<AutoCashFlow | null>(null)
const activeTab = ref('main')
const now = new Date()
const filters = reactive({
  year: systemParamsStore.currentYear || now.getFullYear(),
  period: systemParamsStore.currentPeriod || now.getMonth() + 1,
  scope: 'month' as 'month' | 'ytd',
})
const years = computed(() => {
  const y = now.getFullYear()
  return Array.from({ length: 8 }, (_, i) => y + 1 - i)
})

const balanceOk = computed(() => {
  const d = data.value
  if (!d) return true
  return Math.abs(d.endCash - d.beginCash - d.netIncrease) < 0.01
})

function fmt(v: number | null | undefined) {
  const n = Number(v) || 0
  return Math.abs(n) < 0.005 ? '' : formatAmount(n)
}

async function fetchData() {
  loading.value = true
  try {
    const r = await request.get<AutoCashFlow>('/report/cash-flow/auto', { params: { ...filters } })
    data.value = r.data
  } finally {
    loading.value = false
  }
}

function exportData() {
  const d = data.value
  if (!d) return
  type Row = { label: string; amount: number | null; bold?: boolean; indent?: number }
  const rows: Row[] = []
  d.sections.forEach((sec, idx) => {
    rows.push({ label: `${SECTION_NO[idx]}、${sec.label}产生的现金流量`, amount: null, bold: true })
    sec.inflows.forEach(i => rows.push({ label: i.name, amount: i.amount, indent: 1 }))
    rows.push({ label: `${sec.label}现金流入小计`, amount: sec.inflowTotal, indent: 2 })
    sec.outflows.forEach(i => rows.push({ label: i.name, amount: i.amount, indent: 1 }))
    rows.push({ label: `${sec.label}现金流出小计`, amount: sec.outflowTotal, indent: 2 })
    rows.push({ label: `${sec.label}产生的现金流量净额`, amount: sec.net, bold: true })
  })
  d.others.forEach(i => rows.push({ label: i.name, amount: i.amount }))
  const n = d.sections.length
  rows.push({ label: `${SECTION_NO[n]}、现金及现金等价物净增加额`, amount: d.netIncrease, bold: true })
  rows.push({ label: '加：期初现金及现金等价物余额', amount: d.beginCash, indent: 1 })
  rows.push({ label: `${SECTION_NO[n + 1]}、期末现金及现金等价物余额`, amount: d.endCash, bold: true })
  if (d.hasSupplement !== false && d.supplement.length) {
    rows.push({ label: '补充资料：将净利润调节为经营活动现金流量', amount: null, bold: true })
    d.supplement.forEach(s => rows.push({ label: s.name, amount: s.amount, indent: s.computed ? 0 : 1 }))
    rows.push({ label: '经营活动产生的现金流量净额（间接法）', amount: d.indirectOperating, bold: true })
  }

  const columns: ExportColumnDef<Row>[] = [
    { label: '项目', width: 56, value: r => r.label, indent: r => r.indent || 0, bold: r => !!r.bold },
    { label: '金额', width: 18, align: 'right', type: 'amount', value: r => r.amount, bold: r => !!r.bold },
  ]
  const scopeLabel = d.scope === 'ytd' ? `${d.year}年1-${d.period}月` : `${d.year}年${d.period}月`
  void exportStyledTable({
    fileName: `现金流量表_${scopeLabel}.xlsx`,
    sheetName: '现金流量表',
    title: '现金流量表',
    subtitle: scopeLabel,
    columns,
    rows,
  })
}

onMounted(fetchData)
</script>

<style scoped>
.cfa-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.cfa-header {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter);
}
.cfa-header__left { display: flex; align-items: center; }
.cfa-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.cfa-header__right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cfa-body { flex: 1; min-height: 0; overflow: auto; padding: 10px 16px 16px; }
.cfa-alert { margin-bottom: 8px; }
.cfa-unmapped { margin-right: 8px; }
.cfa-table { width: 100%; max-width: 900px; border-collapse: collapse; font-size: var(--cw-text-base); }
.cfa-table th, .cfa-table td { border: 1px solid var(--el-border-color-lighter); padding: 5px 10px; }
.cfa-table th { background: var(--el-fill-color-light); font-weight: 600; text-align: left; }
.cfa-amount-col { width: 200px; text-align: right !important; }
.cfa-amount { text-align: right; font-variant-numeric: tabular-nums; }
.cfa-section td { font-weight: 600; background: var(--el-fill-color-lighter); }
.cfa-subtotal td { color: var(--el-text-color-regular); font-weight: 500; }
.cfa-total td { font-weight: 600; }
.cfa-diff td { color: var(--el-color-danger); }
.cfa-indent { padding-left: 28px !important; }
.cfa-indent2 { padding-left: 44px !important; }
.cfa-check { margin-top: 10px; font-size: 12px; color: var(--el-text-color-secondary); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cfa-note { margin-top: 10px; max-width: 900px; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
</style>
