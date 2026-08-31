<template>
  <div class="page scm-arap-page">
    <div class="filter-row">
      <el-radio-group v-model="arapType" size="small" @change="onArapTypeChange">
        <el-radio-button value="">全部往来</el-radio-button>
        <el-radio-button value="ar">应收</el-radio-button>
        <el-radio-button value="ap">应付</el-radio-button>
      </el-radio-group>
      <el-select v-model="partnerCode" filterable clearable :placeholder="partnerPlaceholder" style="width:220px" size="small" @change="load">
        <el-option v-for="p in filteredPartners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-date-picker v-model="startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width:140px" size="small" />
      <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width:140px" size="small" />
      <el-button type="primary" plain size="small" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <span class="total-hint" v-if="isSummaryView">
        共 {{ summary.length }} 个单位
        <template v-if="arapType !== 'ap'">　<span class="amt-ar">应收 {{ fmt(totalReceivable) }}　收款 {{ fmt(totalReceived) }}　期末应收 {{ fmt(totalArClosing) }}</span></template>
        <template v-if="arapType !== 'ar'">　<span class="amt-ap">应付 {{ fmt(totalPayable) }}　付款 {{ fmt(totalPaid) }}　期末应付 {{ fmt(totalApClosing) }}</span></template>
      </span>
      <span class="total-hint" v-else-if="isAll">共 {{ detail.length }} 笔　增加合计 {{ fmt(totalIn) }}　核销合计 {{ fmt(totalOut) }}</span>
      <span class="total-hint" v-else>期初 {{ fmt(opening) }}　期末 {{ fmt(closing) }}</span>
    </div>

    <div class="page-body">
      <!-- 余额表：按往来单位汇总 -->
      <el-table v-if="isSummaryView" :data="summary" v-loading="loading" border stripe size="small" height="100%"
        show-summary :summary-method="summaryMethod" row-class-name="drill-row" @row-dblclick="drillPartner">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column label="往来单位" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.partner_type === 'customer'" type="success" size="small" effect="plain">客户</el-tag>
            <el-tag v-else-if="row.partner_type === 'supplier'" type="danger" size="small" effect="plain">供应商</el-tag>
            <el-tag v-else-if="row.partner_type === 'both'" type="primary" size="small" effect="plain">客户+供应商</el-tag>
            <span v-else class="ps-muted">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="arapType !== 'ap'" prop="ar_opening" class-name="ar-col" label="期初应收" width="120" align="right"><template #default="{ row }"><span class="amt-ar">{{ fmt(row.ar_opening) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ap'" prop="receivable_amount" class-name="ar-col" label="应收金额" width="120" align="right"><template #default="{ row }"><span class="amt-ar">{{ fmt(row.receivable_amount) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ap'" prop="received_amount" class-name="ar-col" label="收款金额" width="120" align="right"><template #default="{ row }"><span class="amt-ar">{{ fmt(row.received_amount) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ap'" prop="ar_closing" class-name="ar-col" label="期末应收" width="125" align="right"><template #default="{ row }"><b class="amt-ar">{{ fmt(row.ar_closing) }}</b></template></el-table-column>
        <el-table-column v-if="arapType !== 'ar'" prop="ap_opening" class-name="ap-col" label="期初应付" width="120" align="right"><template #default="{ row }"><span class="amt-ap">{{ fmt(row.ap_opening) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ar'" prop="payable_amount" class-name="ap-col" label="应付金额" width="120" align="right"><template #default="{ row }"><span class="amt-ap">{{ fmt(row.payable_amount) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ar'" prop="paid_amount" class-name="ap-col" label="付款金额" width="120" align="right"><template #default="{ row }"><span class="amt-ap">{{ fmt(row.paid_amount) }}</span></template></el-table-column>
        <el-table-column v-if="arapType !== 'ar'" prop="ap_closing" class-name="ap-col" label="期末应付" width="125" align="right"><template #default="{ row }"><b class="amt-ap">{{ fmt(row.ap_closing) }}</b></template></el-table-column>
        <el-table-column label="操作" width="110" fixed="right" align="center" class-name="action-col">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="drillPartner(row)">查看明细</el-link>
          </template>
        </el-table-column>
      </el-table>

      <!-- 明细视图：逐笔流水（明细账未选单位 / 选了单位的单往来） -->
      <template v-else>
      <el-empty v-if="isDetailPage && !partnerCode && !arapType && !detail.length"
        description="请先选择往来单位，或点「应收/应付」按类型查询" />
      <el-table v-else :data="detail" v-loading="loading" border stripe size="small" height="100%"
        :row-class-name="() => (isAll ? 'drill-row' : '')" @row-dblclick="drillPartner">
        <el-table-column type="index" label="序号" width="50" align="center" />
        <el-table-column v-if="isAll" label="往来单位" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.partner_code }} {{ row.partner_name || '' }}</template>
        </el-table-column>
        <el-table-column label="日期" prop="doc_date" width="120" />
        <el-table-column label="单据类型" width="110">
          <template #default="{ row }">{{ typeName(row.doc_type) }}</template>
        </el-table-column>
        <el-table-column label="单号" prop="doc_no" min-width="150" show-overflow-tooltip />
        <el-table-column label="到期日" width="104">
          <template #default="{ row }">
            <span :class="{ 'due-over': row.direction === 'in' && (row.amount - (row.verified_amount || 0)) > 0.005 && row.due_date && row.due_date < today }">{{ row.due_date || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="摘要/方向" width="120" align="center">
          <template #default="{ row }">
            <el-tag :class="isArBusiness(row) ? 'arap-tag-ar' : 'arap-tag-ap'" :type="isArBusiness(row) ? 'success' : 'danger'" size="small" effect="plain">
              {{ businessLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发生额" width="130" align="right">
          <template #default="{ row }">
            <span :class="isArBusiness(row) ? 'amt-ar' : 'amt-ap'">
              {{ row.direction === 'in' ? '+' : '-' }}{{ fmt(row.amount) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="结存余额" width="130" align="right">
          <template #default="{ row }">{{ fmt(row.balance) }}</template>
        </el-table-column>
        <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="132" fixed="right" align="center" class-name="action-col">
          <template #default="{ row }">
            <ScmDocActions v-if="row.doc" :row="row.doc" @changed="load" />
          </template>
        </el-table-column>
      </el-table>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { scmApi, type ScmPartner } from '@/api/scm'
import ScmDocActions from '@/components/scm/ScmDocActions.vue'

const route = useRoute()
const router = useRouter()
const partners = ref<ScmPartner[]>([])
const partnerCode = ref<string>((route.query.partner_code as string) || '')
const arapType = ref<'' | 'ar' | 'ap'>('')
const startDate = ref('')
const endDate = ref('')
const loading = ref(false)
const opening = ref(0)
const closing = ref(0)
const totalIn = ref(0)
const totalOut = ref(0)
const detail = ref<any[]>([])
// 往来余额表汇总数据（按往来单位一行一汇总）
const summary = ref<any[]>([])
const totalOpening = ref(0)
const totalClosing = ref(0)
const totalReceivable = ref(0)
const totalReceived = ref(0)
const totalPayable = ref(0)
const totalPaid = ref(0)
const totalArClosing = ref(0)
const totalApClosing = ref(0)
const isAll = computed(() => !partnerCode.value)
// 往来明细账（独立路由）：默认不查全部往来，避免全量数据过大
const isDetailPage = computed(() => route.name === 'ScmPartnerLedgerDetail')
// 余额表（非明细账）且未选往来单位 → 显示「按往来单位汇总」视图
const isSummaryView = computed(() => !isDetailPage.value && !partnerCode.value)
const today = new Date().toISOString().slice(0, 10)

// 往来单位下拉随应收/应付类型联动：客户/供应商分别过滤，双向及未分类单位两边均保留。
function partnerBusinessRole(partner: any): 'customer' | 'supplier' | 'both' {
  const type = String(partner?.partner_type || '').trim().toLowerCase()
  if (!type || type === 'both' || type === '双向' || type === '3') return 'both'
  if (/customer|客户|^1$/.test(type)) return 'customer'
  if (/supplier|供应|^2$/.test(type)) return 'supplier'
  return 'both'
}
const filteredPartners = computed(() => {
  if (!arapType.value) return partners.value
  return partners.value.filter(partner => {
    const role = partnerBusinessRole(partner)
    return role === 'both' || role === (arapType.value === 'ar' ? 'customer' : 'supplier')
  })
})
const partnerPlaceholder = computed(() => arapType.value === 'ar' ? '选择客户' : arapType.value === 'ap' ? '选择供应商' : '选择往来单位')

const DOC_TYPE_NAMES: Record<string, string> = {
  IS: '期初入库', PI: '采购入库', PR: '采购退货', SO: '销售出库', SR: '销售退货', OI: '其他入库', OO: '其他出库',
  TR: '调拨单', CK: '盘点单', AS: '组装单', DS: '拆卸单', PQ: '采购询价单', PO: '采购订单',
  SQ: '销售报价单', SOa: '销售订单', RP: '采购发票', RS: '销售发票', PAY: '付款单', RCV: '收款单', MR: '缺料单',
  PL: '生产领用', PF: '完工入库', PS: '不良品入库', PB: '补料单', PJ: '退料单', WO: '委外发货', WI: '委外入库',
}
function typeName(t: string) { return DOC_TYPE_NAMES[t] || t }
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const AR_BUSINESS_TYPES = new Set(['SO', 'SR', 'RS', 'RCV'])
const AP_BUSINESS_TYPES = new Set(['PI', 'PR', 'RP', 'PAY', 'WI'])
function isArBusiness(row: any) {
  if (AR_BUSINESS_TYPES.has(row?.doc_type)) return true
  if (AP_BUSINESS_TYPES.has(row?.doc_type)) return false
  return arapType.value !== 'ap'
}
function businessLabel(row: any) {
  if (isArBusiness(row)) return row.direction === 'in' ? '应收' : '收款'
  return row.direction === 'in' ? '应付' : '付款'
}
// 余额表合计行按字段语义合计，避免列随应收/应付筛选变化时错位。
function summaryMethod({ columns, data }: { columns: any[]; data: any[] }) {
  return columns.map((column: any, i: number) => {
    if (i === 0) return '合计'
    if (i === 1) return `${data.length} 个单位`
    const key = column.property
    if (['ar_opening', 'receivable_amount', 'received_amount', 'ar_closing', 'ap_opening', 'payable_amount', 'paid_amount', 'ap_closing'].includes(key)) {
      return fmt(data.reduce((s, e) => s + (Number(e[key]) || 0), 0))
    }
    return ''
  })
}

async function loadPartners() {
  const r = await scmApi.getPartners({})
  if (r.code === 0) partners.value = r.data as ScmPartner[]
}

async function onArapTypeChange() {
  if (partnerCode.value && !filteredPartners.value.some(partner => partner.code === partnerCode.value)) {
    partnerCode.value = ''
    router.replace({ query: { ...route.query, partner_code: undefined } })
  }
  // 选了应收/应付后立即查询：明细账未选单位时查全部逐笔明细（带 arap_type 筛选），不留空。
  await load()
}

async function load() {
  loading.value = true
  try {
    const params = { start_date: startDate.value || undefined, end_date: endDate.value || undefined, arap_type: arapType.value || undefined }
    if (partnerCode.value) {
      const r = await scmApi.getPartnerLedger(partnerCode.value, params)
      if (r.code === 0) {
        opening.value = r.data.opening || 0
        closing.value = r.data.closing || 0
        detail.value = r.data.detail || []
      }
    } else if (isSummaryView.value) {
      // 余额表未选往来单位 → 按往来单位汇总（期初/本期增加/本期减少/期末）
      const r = await scmApi.getPartnerBalanceSummary(params)
      if (r.code === 0) {
        summary.value = r.data.summary || []
        totalOpening.value = r.data.total_opening || 0
        totalIn.value = r.data.total_in || 0
        totalOut.value = r.data.total_out || 0
        totalClosing.value = r.data.total_closing || 0
        totalReceivable.value = r.data.total_receivable || 0
        totalReceived.value = r.data.total_received || 0
        totalPayable.value = r.data.total_payable || 0
        totalPaid.value = r.data.total_paid || 0
        totalArClosing.value = r.data.total_ar_closing || 0
        totalApClosing.value = r.data.total_ap_closing || 0
      }
    } else {
      // 明细账未选往来单位 → 查全部往来逐笔明细
      const r = await scmApi.getAllPartnerLedger(params)
      if (r.code === 0) {
        totalIn.value = r.data.total_in || 0
        totalOut.value = r.data.total_out || 0
        detail.value = r.data.detail || []
      }
    }
  } finally {
    loading.value = false
  }
}

// 全部往来模式下双击某行 → 就地下钻到该往来单位的单往来对账
// （本页在 Layout keep-alive 下、且为同页切换，故直接改 partnerCode + load，不依赖路由重挂载）
function drillPartner(row: any) {
  if (!isAll.value || !row?.partner_code) return
  partnerCode.value = row.partner_code
  router.replace({ query: { ...route.query, partner_code: row.partner_code } })
  load()
}

let activatedAtLeastOnce = false

function loadOnEntry() {
  // 明细账：默认不查全部（数据量大），需选往来单位后再查；余额表：保持默认查全部。
  if (!isDetailPage.value || partnerCode.value) load()
}

onMounted(async () => {
  await loadPartners()
  // 非 keep-alive 场景没有 activated 生命周期，仍需保证首次进入正常加载。
  if (!activatedAtLeastOnce) loadOnEntry()
})

// 页面由 Layout keep-alive 缓存；收付款审核后重新进入时必须按最新往来日志刷新，
// 否则会继续显示开单前的旧余额，让已完成的核销看起来没有生效。
onActivated(() => {
  activatedAtLeastOnce = true
  loadOnEntry()
})
</script>

<style scoped>
.scm-arap-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.total-hint { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.page-body { flex: 1; min-height: 0; }
.amt-ar { color: #15803d !important; font-weight: 700; }
.amt-ap { color: #dc2626 !important; font-weight: 700; }
.page-body :deep(.el-table__footer-wrapper td.ar-col .cell) { color: #15803d !important; font-weight: 700; }
.page-body :deep(.el-table__footer-wrapper td.ap-col .cell) { color: #dc2626 !important; font-weight: 700; }
.page-body :deep(.arap-tag-ar) { color: #166534 !important; border-color: #86efac !important; background: #f0fdf4 !important; }
.page-body :deep(.arap-tag-ap) { color: #b91c1c !important; border-color: #fca5a5 !important; background: #fef2f2 !important; }
.page-body :deep(.drill-row) { cursor: pointer; }
.due-over { color: var(--el-color-danger); font-weight: 600; }
.ps-muted { color: var(--el-text-color-placeholder); }
</style>
