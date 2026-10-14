<template>
  <div class="page vgp-page">
    <!-- 顶部导航 -->
    <div class="vgp-header">
      <div class="vgp-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="vgp-header__sep">/</span>
        <span class="vgp-header__title">出纳录单 / {{ entryPreview ? '生成凭证确认' : '生成凭证预览' }}</span>
        <el-tag v-if="params" type="info" size="small" effect="plain" style="margin-left:8px">
          {{ params.ids?.length ? `已选 ${params.ids.length} 条` : `${params.start_date} 至 ${params.end_date}` }}
        </el-tag>
      </div>
      <div class="vgp-header__right">
        <el-button plain size="small" @click="goBack">返回出纳录单</el-button>
        <el-button type="success" size="small" :loading="generating" @click="handleConfirmGenerate">
          确认生成（{{ rows.length }} 条）
        </el-button>
      </div>
    </div>

    <div class="vgp-body">
      <!-- 汇总 -->
      <div class="vgp-summary">
        <div class="vgp-card">
          <div class="vgp-card__label">将生成凭证</div>
          <div class="vgp-card__value">{{ voucherGroups.length }} <span class="vgp-card__unit">张{{ hasScmGroups ? '（收付款单同单合并一张）' : '（每条记录一张）' }}</span></div>
        </div>
        <div class="vgp-card">
          <div class="vgp-card__label">收入合计（借现金）</div>
          <div class="vgp-card__value vgr-income">{{ amt(totalDebit) }} <span class="vgp-card__unit">元</span></div>
        </div>
        <div class="vgp-card">
          <div class="vgp-card__label">支出合计（贷现金）</div>
          <div class="vgp-card__value vgr-expense">{{ amt(totalCredit) }} <span class="vgp-card__unit">元</span></div>
        </div>
        <div v-if="missingCount > 0" class="vgp-card vgp-card--warn">
          <div class="vgp-card__label">未填对方科目</div>
          <div class="vgp-card__value" style="color:var(--el-color-warning)">{{ missingCount }} <span class="vgp-card__unit">条需挂账或返回补全</span></div>
        </div>
        <div v-if="missingAuxCount > 0" class="vgp-card vgp-card--danger">
          <div class="vgp-card__label">辅助核算未填</div>
          <div class="vgp-card__value" style="color:var(--el-color-danger)">{{ missingAuxCount }} <span class="vgp-card__unit">条需返回补填</span></div>
        </div>
      </div>

      <el-alert v-if="loadError" type="error" :closable="false" show-icon style="margin-bottom:10px" :title="loadError" />

      <el-alert v-if="autoIncludedCount > 0" type="warning" :closable="false" show-icon style="margin-bottom:10px">
        系统参数为「通过出纳生成凭证」：同一张收付款单的流水合并生成一张凭证，已自动带入未勾选的 {{ autoIncludedCount }} 条同单流水。
      </el-alert>

      <el-alert v-if="missingAuxCount > 0" type="error" :closable="false" show-icon style="margin-bottom:10px">
        有 {{ missingAuxCount }} 条记录的对方科目挂了辅助核算（如部门、项目），但录单时未选择，生成的凭证将无法记账，已拦截。
        请返回出纳录单补填后再生成：{{ missingAuxSample }}
      </el-alert>

      <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px">
        <template v-if="entryPreview">
          以下是即将生成的凭证分录（凭证号在生成时按期间顺序编号）。请核对借贷科目与金额无误后点右上角「确认生成」。
        </template>
        <template v-else>
          预览即将生成的会计凭证（每条出纳记录一张，借贷自动对转）。请核对无误后点右上角「确认生成」。
        </template>
      </el-alert>

      <!-- 单行生成：直接以凭证分录形式预览（与凭证查询/生成结果页同款表格） -->
      <div v-if="entryPreview" class="vgp-table-wrap voucher-list-page">
        <VoucherAuditTable
          mode="preview"
          :loading="loading"
          :flat-list="entryFlatList"
          :is-selectable-row="() => false"
          :get-row-class="getEntryRowClass"
          :aux-categories="baseData.auxCategories"
          :has-more="false"
        />
        <div v-if="entryFlatList.length > 0" class="voucher-batch-bar voucher-query-summary-bar">
          <span class="summary-item">
            <span class="summary-label">将生成凭证：</span>
            <span class="summary-value">{{ voucherGroups.length }} 张</span>
          </span>
          <span class="summary-item">
            <span class="summary-label">借方合计：</span>
            <span class="summary-value summary-debit">{{ amt(entryTotal) }}</span>
          </span>
          <span class="summary-item">
            <span class="summary-label">贷方合计：</span>
            <span class="summary-value summary-credit">{{ amt(entryTotal) }}</span>
          </span>
        </div>
      </div>

      <!-- 批量生成：按记录逐行预览 -->
      <div v-else class="vgp-table-wrap">
        <el-table :data="rows" v-loading="loading" size="small" border stripe height="100%">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="日期" prop="biz_date" width="110" />
          <el-table-column label="单据序号" prop="seq" width="80" align="center" />
          <el-table-column label="摘要" prop="summary" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <el-tag v-if="row.scm_doc_no" size="small" type="warning" effect="plain" style="margin-right:4px">
                {{ row.scm_doc_type === 'PAY' ? '付款单' : '收款单' }} {{ row.scm_doc_no }}{{ row.auto_included ? '（自动带入）' : '' }}
              </el-tag>{{ row.summary }}
            </template>
          </el-table-column>
          <el-table-column label="对方科目" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ formatCounter(row.counter_account) }}</template>
          </el-table-column>
          <el-table-column label="借方(收入)" width="120" align="right">
            <template #default="{ row }"><span v-if="row.debit" class="vgp-debit">{{ amt(row.debit) }}</span></template>
          </el-table-column>
          <el-table-column label="贷方(支出)" width="120" align="right">
            <template #default="{ row }"><span v-if="row.credit" class="vgp-credit">{{ amt(row.credit) }}</span></template>
          </el-table-column>
          <!-- FIX-260：外币科目显示币种 / 汇率 / 本位币金额（凭证按本位币入账） -->
          <template v-if="hasForeignRows">
            <el-table-column label="币种" width="70" align="center" prop="currency" />
            <el-table-column label="汇率" width="90" align="right">
              <template #default="{ row }">{{ Number(row.exchange_rate) > 0 ? Number(row.exchange_rate).toFixed(4) : '' }}</template>
            </el-table-column>
            <el-table-column label="本位币金额" width="120" align="right">
              <template #default="{ row }">{{ amt(baseAmountOf(row)) }}</template>
            </el-table-column>
          </template>
          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }">
              <el-tooltip v-if="row.missing_aux?.length" :content="`对方科目要求：${row.missing_aux.join('、')}`" placement="top">
                <el-tag type="danger" size="small" effect="plain">缺{{ row.missing_aux.join('、') }}</el-tag>
              </el-tooltip>
              <el-tag v-else-if="row.counter_account" type="success" size="small" effect="plain">可生成</el-tag>
              <el-tag v-else type="warning" size="small" effect="plain">缺对方科目</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
    <div v-if="!params" class="vgp-empty">
      <el-empty description="没有预览数据（可能已刷新页面），请回到出纳录单重新点击「生成凭证」">
        <el-button type="primary" plain @click="goBack">返回出纳录单</el-button>
      </el-empty>
    </div>

    <!-- 缺对方科目：二次确认 + 挂账 -->
    <el-dialog v-model="hangupVisible" title="存在未填对方科目的记录" width="660px" draggable>
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px">
        以下 {{ hangupRows.length }} 条记录未填写对方科目。可点「返回补全」回到出纳录单补全对方科目；
        或指定一个<strong>末级挂账科目</strong>（如其他应收款/其他应付款），对这些记录统一挂账后生成凭证，事后再行调整。
      </el-alert>
      <el-table :data="hangupRows" size="small" border max-height="240">
        <el-table-column label="日期" prop="biz_date" width="110" />
        <el-table-column label="单据序号" prop="seq" width="80" align="center" />
        <el-table-column label="摘要" prop="summary" min-width="180" show-overflow-tooltip />
        <el-table-column label="借方(收入)" prop="debit" width="120" align="right">
          <template #default="{ row }"><span v-if="row.debit" class="vgp-debit">{{ amt(row.debit) }}</span></template>
        </el-table-column>
        <el-table-column label="贷方(支出)" prop="credit" width="120" align="right">
          <template #default="{ row }"><span v-if="row.credit" class="vgp-credit">{{ amt(row.credit) }}</span></template>
        </el-table-column>
      </el-table>
      <div style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size: var(--cw-text-base);white-space:nowrap">挂账科目：</span>
        <el-select
          v-model="hangupAccount"
          filterable
          clearable
          placeholder="选择末级挂账科目"
          style="width:300px"
        >
          <el-option
            v-for="a in counterAccounts"
            :key="a.code"
            :label="`${a.code} ${a.name}`"
            :value="a.isParent ? '' : a.code"
            :disabled="a.isParent"
            :class="{ 'parent-option': a.isParent }"
          />
        </el-select>
        <el-checkbox v-model="rememberHangup">记住为默认挂账科目</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="goBack">返回补全</el-button>
        <el-button type="primary" :loading="generating" :disabled="!hangupAccount" @click="doGenerate(hangupAccount)">
          按挂账科目生成
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
// 凭证页共用全局样式：用脚本 import 而非 <style src>。
// 多个组件 <style src> 同一文件时，生产构建只编译一份且可能套用某个导入方的 scoped，导致其它页面样式丢失（FIX-344）
import '@/views/voucher/voucher.styles.css'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { cashierApi } from '@/api/cashier'
import request from '@/api/request'
import { useBaseDataStore } from '@/stores/baseData'
import { useUserStore } from '@/stores/user'
import VoucherAuditTable from '@/components/voucher/VoucherAuditTable.vue'
import { buildVoucherFlatRows } from '@/utils/voucherFlatList'

interface PreviewParams {
  account_code: string
  start_date: string
  end_date: string
  ids?: string[]
}
interface PreviewRow {
  id: string
  biz_date: string
  seq: number | null
  summary: string | null
  debit: number
  credit: number
  counter_account: string | null
  /** 对方科目要求辅助核算但未填的类别名 */
  missing_aux?: string[]
  /** 来源收付款单（通过出纳制证模式下同单合并一张凭证） */
  scm_doc_type?: string
  scm_doc_no?: string
  auto_included?: boolean
  /** FIX-260：外币科目行 */
  currency?: string
  exchange_rate?: number
  base_debit?: number
  base_credit?: number
}

const SESSION_KEY = 'cashier:voucher-generate-preview'
const router = useRouter()
const baseData = useBaseDataStore()

const params = ref<PreviewParams | null>(null)
const loading = ref(false)
const rows = ref<PreviewRow[]>([])
const loadError = ref('')
const generating = ref(false)
const userStore = useUserStore()

/** 行级「生成」（只选一条记录）：直接按凭证分录形式预览二次确认，不再走按记录逐行的列表 */
const entryPreview = computed(() => (params.value?.ids?.length ?? 0) === 1)

/** 系统参数：出纳默认凭证类型（与后端 generateCashierVoucher 取法一致：参数优先，否则排序第一个） */
const defaultVoucherTypeId = ref('')
const previewVoucherTypeName = computed(() => {
  const types = baseData.voucherTypes
  if (!types.length) return ''
  const byParam = defaultVoucherTypeId.value ? types.find(t => String(t.id) === String(defaultVoucherTypeId.value)) : undefined
  return (byParam || types[0])?.name || ''
})

const cashAccountName = computed(() =>
  params.value ? (counterAccountMap.value.get(params.value.account_code) || '') : ''
)

/**
 * 把预览记录按后端生成规则展开为「一张凭证两条分录」的扁平行：
 * 收入 → 借现金 / 贷对方；支出 → 借对方 / 贷现金。凭证号生成时才编，这里显示「待编号」。
 */
/** FIX-260：凭证金额 = 本位币金额（外币行为 原币 × 汇率；本位币行 base_* 与原币一致） */
function baseAmountOf(r: PreviewRow): number {
  const fc = Math.round((r.debit > 0 ? r.debit : r.credit) * 100) / 100
  const stored = r.debit > 0 ? Number(r.base_debit) : Number(r.base_credit)
  if (stored > 0) return Math.round(stored * 100) / 100
  const rate = Number(r.exchange_rate) > 0 ? Number(r.exchange_rate) : 1
  return Math.round(fc * rate * 100) / 100
}
const hasForeignRows = computed(() => rows.value.some(r => Number(r.exchange_rate) > 0 && Number(r.exchange_rate) !== 1))

/** 与后端生成口径一致：手工流水一行一张；收付款单来源的流水同一单据合并一张 */
const voucherGroups = computed(() => {
  const groups: PreviewRow[][] = []
  const byDoc = new Map<string, PreviewRow[]>()
  for (const r of rows.value) {
    if (!r.scm_doc_no) { groups.push([r]); continue }
    const key = `${r.scm_doc_type}|${r.scm_doc_no}`
    let g = byDoc.get(key)
    if (!g) { g = []; byDoc.set(key, g); groups.push(g) }
    g.push(r)
  }
  return groups
})
const hasScmGroups = computed(() => rows.value.some(r => r.scm_doc_no))
const autoIncludedCount = computed(() => rows.value.filter(r => r.auto_included).length)

const entryFlatList = computed(() => {
  if (!params.value) return []
  const cashCode = params.value.account_code
  const vouchers = voucherGroups.value.map(group => {
    const head = group[0]
    const entries = group.flatMap(r => {
      const amt = baseAmountOf(r)
      const counterCode = r.counter_account || ''
      const counterName = counterCode ? (counterAccountMap.value.get(counterCode) || '') : '（未填对方科目）'
      const summary = r.summary || '出纳生成'
      const cash = { account_code: cashCode, account_name: cashAccountName.value, amount: amt, summary }
      const counter = { account_code: counterCode, account_name: counterName, amount: amt, summary }
      return r.debit > 0
        ? [{ ...cash, direction: 'debit' }, { ...counter, direction: 'credit' }]
        : [{ ...counter, direction: 'debit' }, { ...cash, direction: 'credit' }]
    })
    const remark = head.scm_doc_no
      ? `${head.scm_doc_type === 'PAY' ? '付款单' : '收款单'}${head.scm_doc_no}`
      : head.summary || '出纳生成'
    return {
      id: head.id,
      voucher_no: '待编号',
      voucher_type_name: previewVoucherTypeName.value,
      voucher_date: head.biz_date,
      status: 'pending',
      remark,
      maker_name: userStore.userInfo?.nickname || userStore.userInfo?.username || '-',
      entries,
    }
  })
  return buildVoucherFlatRows(vouchers, { mode: 'query' })
})
const entryTotal = computed(() => rows.value.reduce((s, r) => s + baseAmountOf(r), 0))

function getEntryRowClass({ row }: { row: any }) {
  return row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd'
}

const totalDebit = computed(() => rows.value.reduce((s, r) => s + (Number(r.debit) || 0), 0))
const totalCredit = computed(() => rows.value.reduce((s, r) => s + (Number(r.credit) || 0), 0))
const missingRows = computed(() => rows.value.filter(r => !r.counter_account))
const missingCount = computed(() => missingRows.value.length)
/** 对方科目要求辅助核算但未填（服务端预览 / 生成拦截返回 missing_aux） */
const missingAuxRows = computed(() => rows.value.filter(r => (r as any).missing_aux?.length))
const missingAuxCount = computed(() => missingAuxRows.value.length)
const missingAuxSample = computed(() => missingAuxRows.value.slice(0, 3)
  .map((r: any) => `${r.biz_date} ${r.summary || ''}（缺${r.missing_aux.join('、')}）`).join('；')
  + (missingAuxCount.value > 3 ? ` 等 ${missingAuxCount.value} 条` : ''))

const amt = (v: number) =>
  (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 对方科目候选：全部启用科目，父科目不可选（与出纳录单一致） */
const counterAccounts = computed(() => {
  const all = baseData.accounts
  if (!all.length) return [] as { code: string; name: string; isParent: boolean }[]
  const parentIds = new Set(all.filter(a => a.parent_id).map(a => String(a.parent_id)))
  return all
    .filter(a => a.is_enabled !== 0)
    .map(a => ({ code: a.code, name: a.name, isParent: parentIds.has(String(a.id)) }))
    .sort((a, b) => a.code.localeCompare(b.code))
})
const counterAccountMap = computed(() => new Map(counterAccounts.value.map(a => [a.code, a.name])))
const formatCounter = (code: string | null) => {
  if (!code) return ''
  const name = counterAccountMap.value.get(code)
  return name ? `${code} ${name}` : code
}

/** 系统参数：出纳默认挂账科目 */
const defaultCounterAccount = ref('')
const hangupVisible = ref(false)
const hangupRows = ref<PreviewRow[]>([])
const hangupAccount = ref('')
const rememberHangup = ref(false)

async function loadData() {
  if (!params.value) return
  loading.value = true
  try {
    const res = await cashierApi.previewGenerateVoucher({
      account_code: params.value.account_code,
      start_date: params.value.start_date,
      end_date: params.value.end_date,
      ids: params.value.ids,
    })
    loadError.value = ''
    if (res.code === 0) rows.value = res.data.rows
  } catch (err: any) {
    // 收付款制证方式拦截（来源于收付款单的流水由单据制证等）：常驻提示，便于用户看清原因
    loadError.value = err?.response?.data?.message || '获取预览数据失败'
    rows.value = []
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

/** 确认生成：全部已填对方科目直接生成；有缺失时先弹挂账/补全二次确认 */
async function handleConfirmGenerate() {
  if (rows.value.length === 0) return ElMessage.warning('没有可生成的记录')
  if (missingAuxCount.value > 0) return ElMessage.error(`有 ${missingAuxCount.value} 条记录的对方科目辅助核算未填写，请返回出纳录单补填后再生成`)
  if (missingCount.value > 0) {
    hangupRows.value = rows.value.filter(r => !r.counter_account)
    hangupAccount.value = defaultCounterAccount.value || ''
    rememberHangup.value = false
    hangupVisible.value = true
    return
  }
  doGenerate()
}

async function doGenerate(hangupCode?: string) {
  if (!params.value) return
  generating.value = true
  try {
    const res = await cashierApi.generateVoucher({
      account_code: params.value.account_code,
      start_date: params.value.start_date,
      end_date: params.value.end_date,
      hangup_account_code: hangupCode,
      ids: params.value.ids,
    })
    if (res.code === 0) {
      try { sessionStorage.setItem('cashier:voucher-generate-result', JSON.stringify(res.data)) } catch { /* ignore */ }
      // 通知出纳录单页（keep-alive 缓存中）下次激活时刷新列表
      try { sessionStorage.setItem('cashier:journal-dirty', '1') } catch { /* ignore */ }
      hangupVisible.value = false
      router.replace({ name: 'CashierVoucherGenerateResult' })
    }
  } catch (err: any) {
    const data = err?.response?.data
    if (data?.missingAuxRows?.length) {
      // 预览后数据变更 / 挂账科目也要求辅助：把缺项标到预览行上
      const byId = new Map<string, string[]>(data.missingAuxRows.map((r: any) => [r.id, r.missing_aux]))
      rows.value = rows.value.map((r: any) => (byId.has(r.id) ? { ...r, missing_aux: byId.get(r.id) } : r))
      hangupVisible.value = false
      ElMessage.error(data.message || '存在辅助核算未填写的记录')
    } else if (data?.missingRows?.length) {
      // 兜底：预览后数据变更导致仍缺对方科目，拦截并引导挂账（不覆盖预览列表）
      hangupRows.value = data.missingRows.map((r: any) => ({
        id: r.id, biz_date: r.biz_date, seq: r.seq, summary: r.summary,
        debit: r.debit, credit: r.credit, counter_account: null,
      }))
      hangupAccount.value = defaultCounterAccount.value || ''
      rememberHangup.value = false
      hangupVisible.value = true
      ElMessage.warning(data.message || '存在未填对方科目的记录，请选择挂账科目或返回补全')
    } else {
      ElMessage.error(data?.message || '生成凭证失败')
    }
  } finally {
    generating.value = false
  }
}

/** 记住为默认挂账科目（持久化系统参数，需 system:account 权限） */
async function saveDefaultHangup(code: string) {
  try {
    await request.put('/system/params', {
      params: [{ param_key: 'cashier:default_counter_account', param_value: code }],
    }, { skipErrorToast: true })
    defaultCounterAccount.value = code
  } catch {
    ElMessage.warning('将按本次挂账生成，但保存默认挂账科目失败（可能无系统参数权限）')
  }
}

// 拦截弹窗内选择记住时同步保存
watch(rememberHangup, val => {
  if (val && hangupAccount.value) void saveDefaultHangup(hangupAccount.value)
})

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/cashier/journal')
}

/** 读取出纳录单写入的预览参数（原始 JSON，用于判断是否变化） */
function readSessionRaw(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY) } catch { return null }
}
let lastRaw: string | null = null

/** 字典/系统参数只加载一次；每次进入页面都按当前参数重新拉预览数据 */
let dictsLoaded = false
async function loadDicts() {
  if (dictsLoaded) return
  await baseData.loadAccounts()
  try { await Promise.all([baseData.loadVoucherTypes(), baseData.loadAuxCategories?.()]) } catch { /* ignore */ }
  // 默认挂账科目 / 默认凭证类型
  try {
    const pRes = await request.get<any[]>('/system/params')
    if (pRes.code === 0) {
      const list = pRes.data || []
      defaultCounterAccount.value = list.find((x: any) => x.param_key === 'cashier:default_counter_account')?.param_value || ''
      defaultVoucherTypeId.value = list.find((x: any) => x.param_key === 'cashier:default_voucher_type_id')?.param_value || ''
    }
  } catch { /* ignore */ }
  dictsLoaded = true
}

async function initFromSession(force: boolean) {
  const raw = readSessionRaw()
  // 上次离开时（返回补全）挂账弹窗可能仍打开，重新进入一律关闭
  hangupVisible.value = false
  // keep-alive 激活：参数没变且已有数据时不重复请求
  if (!force && raw === lastRaw && rows.value.length > 0) return
  lastRaw = raw
  try {
    params.value = raw ? (JSON.parse(raw) as PreviewParams) : null
  } catch {
    params.value = null
  }
  rows.value = []
  await loadDicts()
  await loadData()
}

onMounted(() => initFromSession(true))
// 页面被 keep-alive 缓存：再次从出纳录单点「生成」进入时 onMounted 不会重跑，这里按新参数重载
onActivated(() => initFromSession(false))
</script>


<style scoped>
.vgp-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.vgp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.vgp-header__left { display: flex; align-items: center; }
.vgp-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.vgp-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.vgp-header__right { display: flex; align-items: center; gap: 8px; }
.vgp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; }
.vgp-summary { display: flex; gap: 12px; flex-wrap: wrap; padding: 12px 16px; }
.vgp-card {
  flex: 1; min-width: 180px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px; padding: 10px 16px;
}
.vgp-card--warn { background: var(--el-color-warning-light-9); }
.vgp-card--danger { background: var(--el-color-danger-light-9); }
.vgp-card__label { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 4px; }
.vgp-card__value { font-size: 22px; font-weight: 600; }
.vgp-card__unit { font-size: var(--cw-text-base); font-weight: 400; color: var(--el-text-color-secondary); }
.vgp-debit { color: #409eff; }
.vgp-credit { color: #f56c6c; }
.vgp-table-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 12px; }
.vgp-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.parent-option { color: #c0c4cc; font-style: italic; }
</style>
