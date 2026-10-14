<template>
  <div class="page voucher-list-page vgr-page">
    <!-- 顶部导航 -->
    <div class="vgr-header">
      <div class="vgr-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="vgr-header__sep">/</span>
        <span class="vgr-header__title">出纳录单 / 生成凭证结果</span>
        <el-tag v-if="store" type="success" effect="plain" style="margin-left:8px">成功生成 {{ store.syncedCount }} 张凭证</el-tag>
      </div>
      <div class="vgr-header__right">
        <el-button plain size="small" @click="goBack">返回出纳录单</el-button>
      </div>
    </div>

    <div v-if="store" class="vgr-body">
      <!-- 汇总统计 -->
      <div class="vgr-summary">
        <div class="vgr-card">
          <div class="vgr-card__label">生成凭证</div>
          <div class="vgr-card__value">{{ store.syncedCount }} <span class="vgr-card__unit">张</span></div>
        </div>
        <div class="vgr-card">
          <div class="vgr-card__label">收入合计（借现金）</div>
          <div class="vgr-card__value vgr-income">{{ amt(store.totalDebit) }} <span class="vgr-card__unit">元 · {{ incomeCount }} 笔</span></div>
        </div>
        <div class="vgr-card">
          <div class="vgr-card__label">支出合计（贷现金）</div>
          <div class="vgr-card__value vgr-expense">{{ amt(store.totalCredit) }} <span class="vgr-card__unit">元 · {{ expenseCount }} 笔</span></div>
        </div>
      </div>

      <!-- 挂账说明 -->
      <el-alert
        v-if="store.hangupCount > 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:10px"
      >
        其中 <b>{{ store.hangupCount }}</b> 条未填对方科目，已按挂账科目
        <b>{{ store.hangupCode }} {{ store.hangupName }}</b> 统一挂账，事后再行调整。
      </el-alert>
      <el-alert
        v-if="truncated"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom:10px"
      >
        本次生成凭证较多，仅显示前 {{ vouchers.length }} 张，完整列表请到「凭证查询」查看。
      </el-alert>

      <!-- 凭证列表（与凭证查询页同款表格） -->
      <div class="vgr-table-wrap">
        <VoucherAuditTable
          mode="query"
          :loading="loading"
          :flat-list="flatList"
          :is-selectable-row="() => false"
          :get-row-class="getRowClass"
          :aux-categories="baseData.auxCategories"
          :has-more="false"
          @row-click="handleRowClick"
          @view-detail="handleViewDetail"
        />
      </div>

      <!-- 合计条（与凭证查询页同款） -->
      <div v-if="flatList.length > 0" class="voucher-batch-bar voucher-query-summary-bar">
        <span class="summary-item">
          <span class="summary-label">已生成凭证：</span>
          <span class="summary-value">{{ voucherCount }} 张</span>
        </span>
        <span class="summary-item">
          <span class="summary-label">借方合计：</span>
          <span class="summary-value summary-debit">{{ amt(totalDebitRows) }}</span>
        </span>
        <span class="summary-item">
          <span class="summary-label">贷方合计：</span>
          <span class="summary-value summary-credit">{{ amt(totalCreditRows) }}</span>
        </span>
        <span class="summary-item">
          <span class="summary-label">差额：</span>
          <span class="summary-value" :class="balanceDiff !== 0 ? 'summary-error' : ''">{{ amt(balanceDiff) }}</span>
        </span>
      </div>
    </div>
    <div v-else class="vgr-empty">
      <el-empty description="没有生成结果数据（可能已刷新页面），请回到出纳录单重新生成">
        <el-button type="primary" plain @click="goBack">返回出纳录单</el-button>
      </el-empty>
    </div>

    <!-- 凭证详情弹窗（双击查看） -->
    <VoucherDetailDialog v-model="detailVisible" :detail="detail" :can-unpost="false" />
  </div>
</template>

<script setup lang="ts">
// 凭证页共用全局样式：用脚本 import 而非 <style src>。
// 多个组件 <style src> 同一文件时，生产构建只编译一份且可能套用某个导入方的 scoped，导致其它页面样式丢失（FIX-344）
import '@/views/voucher/voucher.styles.css'
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import request from '@/api/request'
import VoucherAuditTable from '@/components/voucher/VoucherAuditTable.vue'
import VoucherDetailDialog from '@/components/voucher/VoucherDetailDialog.vue'
import { buildVoucherFlatRows } from '@/utils/voucherFlatList'
import { useBaseDataStore } from '@/stores/baseData'

interface VoucherDetail {
  voucherNo: string
  bizDate: string
  summary: string | null
  amount: number
  direction: '收入' | '支出'
  counterCode: string
  counterName: string
  hungup: boolean
}
interface GenerateResult {
  syncedCount: number
  voucherNos: string[]
  voucherIds: string[]
  totalDebit: number
  totalCredit: number
  hangupCount: number
  hangupCode: string | null
  hangupName: string | null
  details: VoucherDetail[]
}

const SESSION_KEY = 'cashier:voucher-generate-result'
const router = useRouter()
const baseData = useBaseDataStore()

const store = ref<GenerateResult | null>(null)
const loading = ref(false)
const vouchers = ref<any[]>([])
const flatList = ref<any[]>([])
const truncated = computed(() => store.value ? vouchers.value.length < store.value.voucherIds.length : false)

// 合计：直接用生成接口返回的口径（与分录行合计一致）
const incomeCount = computed(() => store.value?.details.filter(d => d.direction === '收入').length ?? 0)
const expenseCount = computed(() => store.value ? store.value.details.length - incomeCount.value : 0)
const totalDebitRows = computed(() => flatList.value.reduce((s, r) => r.direction === 'debit' ? s + (Number(r.amount) || 0) : s, 0))
const totalCreditRows = computed(() => flatList.value.reduce((s, r) => r.direction === 'credit' ? s + (Number(r.amount) || 0) : s, 0))
const balanceDiff = computed(() => totalDebitRows.value - totalCreditRows.value)
const voucherCount = computed(() => new Set(flatList.value.map(r => r._voucherId)).size)

const amt = (v: number) =>
  (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 与凭证查询页一致的分组斑马纹
const selectedVoucherId = ref('')
function getRowClass({ row }: { row: any }) {
  const stripeClass = row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd'
  if (selectedVoucherId.value && row._voucherId === selectedVoucherId.value) {
    return `${stripeClass} voucher-selected`
  }
  return stripeClass
}

function handleRowClick(row: { _voucherId?: string }) {
  if (!row._voucherId) return
  selectedVoucherId.value = selectedVoucherId.value === row._voucherId ? '' : row._voucherId
}

// 双击查看凭证详情（与凭证查询页同款弹窗）
const detailVisible = ref(false)
const detail = ref<any>(null)
async function handleViewDetail(row: any) {
  const voucherId = row?._voucherId || row?.id
  if (!voucherId) return
  try {
    const res = await request.get(`/voucher/vouchers/${voucherId}`)
    if (res.code === 0) {
      detail.value = res.data
      detailVisible.value = true
    }
  } catch { /* request 层已统一提示 */ }
}

async function load() {
  if (!store.value?.voucherIds?.length) return
  loading.value = true
  try {
    await baseData.loadAuxCategories?.()
  } catch { /* ignore */ }
  try {
    const res = await request.get<any[]>('/voucher/vouchers', {
      params: { ids: store.value.voucherIds.join(','), page: 1, pageSize: -1 },
    })
    if (res.code === 0) {
      vouchers.value = res.data || []
      flatList.value = buildVoucherFlatRows(vouchers.value, { mode: 'query' })
    }
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/cashier/journal')
}

let lastRaw: string | null = null
async function initFromSession(force: boolean) {
  let raw: string | null = null
  try { raw = sessionStorage.getItem(SESSION_KEY) } catch { /* ignore */ }
  if (!force && raw === lastRaw) return
  lastRaw = raw
  try {
    store.value = raw ? (JSON.parse(raw) as GenerateResult) : null
  } catch {
    store.value = null
  }
  vouchers.value = []
  flatList.value = []
  selectedVoucherId.value = ''
  if (store.value) await load()
}

onMounted(() => initFromSession(true))
// keep-alive 缓存下第二次生成后进入本页 onMounted 不重跑：按新的结果数据重载
onActivated(() => initFromSession(false))
</script>

<style scoped>
.vgr-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.vgr-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.vgr-header__left { display: flex; align-items: center; }
.vgr-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.vgr-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.vgr-header__right { display: flex; align-items: center; gap: 8px; }
.vgr-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; }
.vgr-summary { display: flex; gap: 12px; flex-wrap: wrap; padding: 12px 16px; }
.vgr-card {
  flex: 1; min-width: 180px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px; padding: 10px 16px;
}
.vgr-card__label { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 4px; }
.vgr-card__value { font-size: 22px; font-weight: 600; }
.vgr-card__unit { font-size: var(--cw-text-base); font-weight: 400; color: var(--el-text-color-secondary); }
.vgr-income { color: #409eff; }
.vgr-expense { color: #f56c6c; }
.vgr-table-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px; }
.vgr-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
</style>

