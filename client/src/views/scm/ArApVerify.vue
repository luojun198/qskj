<template>
  <div class="page scm-verify-page">
    <div class="filter-row">
      <el-select v-model="partnerCode" filterable clearable :placeholder="partnerPlaceholder" style="width:240px" size="small" @change="load">
        <el-option v-for="p in filteredPartners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
      </el-select>
      <el-radio-group v-model="side" size="small" @change="onSideChange">
        <el-radio-button value="ap">应付（付款核销）</el-radio-button>
        <el-radio-button value="ar">应收（收款核销）</el-radio-button>
      </el-radio-group>
      <el-button type="primary" plain size="small" :disabled="!partnerCode" @click="load"><el-icon><Search /></el-icon>查询</el-button>
      <el-button type="success" plain size="small" @click="createAdvanceDoc">
        <el-icon><Plus /></el-icon>新增{{ side === 'ar' ? '预收款单' : '预付款单' }}
      </el-button>
      <span class="hint" v-if="partnerCode">
        {{ side === 'ap' ? '未付合计' : '未收合计' }} <b>{{ fmt(openIn) }}</b>
        　{{ side === 'ap' ? '预付余额' : '预收余额' }} <b class="adv">{{ fmt(advance) }}</b>
      </span>
    </div>

    <el-empty v-if="!partnerCode" description="请选择往来单位进行核销" />
    <template v-else>
      <div class="verify-bar">
        <span>已选可核销：应收应付 <b>{{ fmt(selInTotal) }}</b> ／ 收付款 <b>{{ fmt(selOutTotal) }}</b>
          → 本次核销 <b class="match">{{ fmt(matchTotal) }}</b></span>
        <el-button type="primary" size="small" :disabled="matchTotal <= 0 || saving" :loading="saving" @click="doVerify">核销所选</el-button>
      </div>

      <div class="two-col">
        <div class="col">
          <div class="col-hd">{{ side === 'ap' ? '未核销应付（采购/委外等）' : '未核销应收（销售/发票等）' }}</div>
          <el-table :data="inItems" v-loading="loading" border stripe size="small" height="100%"
            @selection-change="r => onSelectionChange('in', r)">
            <el-table-column type="selection" width="40" />
            <el-table-column label="日期" prop="doc_date" width="104" />
            <el-table-column label="单据" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ typeName(row.doc_type) }} {{ row.doc_no }}</template>
            </el-table-column>
            <el-table-column label="到期日" width="104">
              <template #default="{ row }">
                <span :class="{ overdue: row.overdue_days > 0 }">{{ row.due_date || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="逾期" width="70" align="right">
              <template #default="{ row }"><span v-if="row.overdue_days > 0" class="overdue">{{ row.overdue_days }}天</span><span v-else>—</span></template>
            </el-table-column>
            <el-table-column label="未核销" width="118" align="right">
              <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
            </el-table-column>
            <el-table-column label="本次核销" width="130" align="right">
              <template #default="{ row }">
                <el-input-number v-model="amt[row.id]" :min="0" :max="row.open_amount" :controls="false"
                  :disabled="!isSelected('in', row.id)" size="small" style="width:110px" @change="onAmountChange('in')" />
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="col">
          <div class="col-hd">{{ side === 'ap' ? '付款 / 预付余额' : '收款 / 预收余额' }}</div>
          <el-table :data="outItems" v-loading="loading" border stripe size="small" height="100%"
            @selection-change="r => onSelectionChange('out', r)">
            <el-table-column type="selection" width="40" />
            <el-table-column label="日期" prop="doc_date" width="104" />
            <el-table-column label="单据" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ typeName(row.doc_type) }} {{ row.doc_no }}</template>
            </el-table-column>
            <el-table-column label="可用余额" width="118" align="right">
              <template #default="{ row }">{{ fmt(row.open_amount) }}</template>
            </el-table-column>
            <el-table-column label="本次核销" width="130" align="right">
              <template #default="{ row }">
                <el-input-number v-model="amt[row.id]" :min="0" :max="row.open_amount" :controls="false"
                  :disabled="!isSelected('out', row.id)" size="small" style="width:110px" @change="onAmountChange('out')" />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <el-collapse v-model="showHistory" class="history">
        <el-collapse-item name="h">
          <template #title><span class="h-title">核销记录（可取消核销）</span></template>
          <el-table :data="verifies" border stripe size="small">
            <el-table-column label="核销单号" prop="verify_no" width="150" />
            <el-table-column label="日期" prop="verify_date" width="120" />
            <el-table-column label="笔数" prop="line_count" width="70" align="right" />
            <el-table-column label="核销金额" width="130" align="right"><template #default="{ row }">{{ fmt(row.total_amount) }}</template></el-table-column>
            <el-table-column label="操作人" prop="created_by" min-width="100" />
            <el-table-column label="操作" width="90" align="center">
              <template #default="{ row }"><el-button link type="danger" size="small" @click="cancelV(row.verify_no)">取消核销</el-button></template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { scmApi, type ScmPartner } from '@/api/scm'
import { allocateArapAmount, partnerMatchesArapSide, roundArapAmount, sumArapOpenAmount } from '@/utils/scmArapVerify'

const route = useRoute()
const router = useRouter()
const normalizeSide = (value: unknown): 'ar' | 'ap' => value === 'ar' ? 'ar' : 'ap'
const partners = ref<ScmPartner[]>([])
const partnerCode = ref<string>((route.query.partner_code as string) || '')
const side = ref<'ar' | 'ap'>(normalizeSide(route.query.side))
const loading = ref(false)
const saving = ref(false)
const inItems = ref<any[]>([])
const outItems = ref<any[]>([])
const openIn = ref(0)
const advance = ref(0)
const selIn = ref<any[]>([])
const selOut = ref<any[]>([])
const amt = reactive<Record<string, number>>({})
const verifies = ref<any[]>([])
const showHistory = ref<string[]>([])
const filteredPartners = computed(() => partners.value.filter(partner => partnerMatchesArapSide(partner, side.value)))
const partnerPlaceholder = computed(() => side.value === 'ar' ? '选择客户' : '选择供应商')

const DOC_TYPE_NAMES: Record<string, string> = {
  PI: '采购入库', PR: '采购退货', SO: '销售出库', SR: '销售退货', RP: '采购发票', RS: '销售发票',
  PAY: '付款单', RCV: '收款单', WI: '委外入库',
}
const typeName = (t: string) => DOC_TYPE_NAMES[t] || t
const fmt = (v: any) => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const selInTotal = computed(() => selIn.value.reduce((s, r) => s + (Number(amt[r.id]) || 0), 0))
const selOutTotal = computed(() => selOut.value.reduce((s, r) => s + (Number(amt[r.id]) || 0), 0))
const matchTotal = computed(() => Math.round(Math.min(selInTotal.value, selOutTotal.value) * 100) / 100)
const amountsBalanced = computed(() => Math.abs(selInTotal.value - selOutTotal.value) <= 0.005)

function applyAmount(rows: any[], targetAmount: number) {
  const allocation = allocateArapAmount(rows, targetAmount)
  for (const row of rows) amt[row.id] = allocation[row.id] || 0
}

function clearUnselected(allRows: any[], selectedRows: any[]) {
  const selectedIds = new Set(selectedRows.map(row => row.id))
  for (const row of allRows) {
    if (!selectedIds.has(row.id)) amt[row.id] = 0
  }
}

function balanceSelectedAmounts() {
  if (!selIn.value.length || !selOut.value.length) {
    applyAmount(selIn.value, sumArapOpenAmount(selIn.value))
    applyAmount(selOut.value, sumArapOpenAmount(selOut.value))
    return
  }

  const target = Math.min(sumArapOpenAmount(selIn.value), sumArapOpenAmount(selOut.value))
  applyAmount(selIn.value, target)
  applyAmount(selOut.value, target)
}

function onSelectionChange(kind: 'in' | 'out', rows: any[]) {
  if (kind === 'in') {
    selIn.value = rows
    clearUnselected(inItems.value, rows)
  } else {
    selOut.value = rows
    clearUnselected(outItems.value, rows)
  }
  balanceSelectedAmounts()
}

function onAmountChange(kind: 'in' | 'out') {
  const sourceRows = kind === 'in' ? selIn.value : selOut.value
  const targetRows = kind === 'in' ? selOut.value : selIn.value
  if (!sourceRows.length || !targetRows.length) return

  const sourceTotal = roundArapAmount(sourceRows.reduce((total, row) => total + (Number(amt[row.id]) || 0), 0))
  const balancedTotal = Math.min(sourceTotal, sumArapOpenAmount(targetRows))
  if (sourceTotal > balancedTotal + 0.005) applyAmount(sourceRows, balancedTotal)
  applyAmount(targetRows, balancedTotal)
}

function isSelected(kind: 'in' | 'out', id: string) {
  const rows = kind === 'in' ? selIn.value : selOut.value
  return rows.some(row => row.id === id)
}

async function loadPartners() {
  const r = await scmApi.getPartners({})
  if (r.code === 0) partners.value = r.data as ScmPartner[]
}

async function load() {
  selIn.value = []
  selOut.value = []
  if (!partnerCode.value) {
    inItems.value = []
    outItems.value = []
    openIn.value = 0
    advance.value = 0
    return
  }
  loading.value = true
  try {
    const r = await scmApi.getArapOpenItems({ partner_code: partnerCode.value, side: side.value })
    if (r.code === 0) {
      inItems.value = r.data.in_items || []
      outItems.value = r.data.out_items || []
      openIn.value = r.data.open_in || 0
      advance.value = r.data.advance || 0
      // 未勾选时不预填，勾选后再按两侧可用余额自动找平。
      for (const row of [...inItems.value, ...outItems.value]) amt[row.id] = 0
    }
    await loadVerifies()
  } finally { loading.value = false }
}

async function loadVerifies() {
  const r = await scmApi.listArapVerifies({ partner_code: partnerCode.value })
  if (r.code === 0) verifies.value = r.data || []
}

async function onSideChange(value: string | number | boolean | undefined) {
  const nextSide = normalizeSide(value)
  const query = { ...route.query, side: nextSide }
  if (partnerCode.value && !partners.value.some(partner => partner.code === partnerCode.value && partnerMatchesArapSide(partner, nextSide))) {
    partnerCode.value = ''
    ;(query as any).partner_code = undefined
  }
  if (route.query.side === nextSide) {
    await router.replace({ path: route.path, query })
    await load()
    return
  }
  await router.replace({ path: route.path, query })
}

function createAdvanceDoc() {
  router.push({
    name: 'ScmDocNew',
    query: {
      doc_type: side.value === 'ar' ? 'RCV' : 'PAY',
      payment_mode: 'advance',
    },
  })
}

watch(
  () => route.query.side,
  async value => {
    // 本页路径不带任何标签维度参数（全局唯一一个实例），但 route 仍是全局单例——
    // 用户离开本页后，若目标路由恰好也带 side/query 变化，这个 watcher 依旧会触发；
    // 加一道"当前路由确实还是本页"的判断，避免用残留的 route.path/route.query 误写别的页面地址。
    if (route.name !== 'ScmArApVerify') return
    side.value = normalizeSide(value)
    if (partnerCode.value && !filteredPartners.value.some(partner => partner.code === partnerCode.value)) {
      partnerCode.value = ''
      await router.replace({ path: route.path, query: { ...route.query, partner_code: undefined } })
    }
    await load()
  }
)

// 贪心配对：把已选应收应付按顺序用已选收付款抵消，生成 matches
function buildMatches() {
  const ins = selIn.value.map(r => ({ id: r.id, left: Math.min(Number(amt[r.id]) || 0, r.open_amount) })).filter(x => x.left > 0.005)
  const outs = selOut.value.map(r => ({ id: r.id, left: Math.min(Number(amt[r.id]) || 0, r.open_amount) })).filter(x => x.left > 0.005)
  const matches: Array<{ in_log_id: string; out_log_id: string; amount: number }> = []
  let j = 0
  for (const it of ins) {
    while (it.left > 0.005 && j < outs.length) {
      const o = outs[j]
      const m = Math.round(Math.min(it.left, o.left) * 100) / 100
      if (m > 0.005) { matches.push({ in_log_id: it.id, out_log_id: o.id, amount: m }); it.left -= m; o.left -= m }
      if (o.left <= 0.005) j++
    }
  }
  return matches
}

async function doVerify() {
  if (!amountsBalanced.value) return ElMessage.warning('两侧本次核销金额不一致，请重新勾选或调整金额')
  const matches = buildMatches()
  if (!matches.length) return ElMessage.warning('请在两侧各勾选并填写核销金额')
  saving.value = true
  try {
    const r = await scmApi.verifyArap({ partner_code: partnerCode.value, matches })
    if (r.code === 0) { ElMessage.success(`已核销：核销单 ${r.data.verify_no}`); await load() }
  } finally { saving.value = false }
}

async function cancelV(verifyNo: string) {
  await ElMessageBox.confirm(`确认取消核销单「${verifyNo}」？`, '提示', { type: 'warning' })
  const r = await scmApi.cancelArapVerify(verifyNo)
  if (r.code === 0) { ElMessage.success('已取消核销'); await load() }
}

onMounted(async () => {
  await loadPartners()
  if (partnerCode.value && !filteredPartners.value.some(partner => partner.code === partnerCode.value)) {
    partnerCode.value = ''
    await router.replace({ path: route.path, query: { ...route.query, partner_code: undefined } })
  }
  // 兼容历史地址 /scm/arap-verify：补齐默认方向，确保刷新后的菜单高亮和页面状态一致。
  if (route.query.side !== side.value) {
    await router.replace({ path: route.path, query: { ...route.query, side: side.value } })
    return
  }
  if (partnerCode.value) await load()
})
</script>

<style scoped>
.scm-verify-page { display: flex; flex-direction: column; height: 100%; padding: 12px 16px; gap: 8px; }
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hint { margin-left: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
.hint .adv { color: var(--el-color-warning); }
.verify-bar { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--el-fill-color-light); border-radius: 6px; font-size: var(--cw-text-base); }
.verify-bar .match { color: var(--el-color-success); }
.two-col { flex: 1; min-height: 0; display: flex; gap: 12px; }
.two-col .col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.col-hd { font-size: var(--cw-text-base); font-weight: 600; margin-bottom: 4px; color: var(--el-text-color-primary); }
.overdue { color: var(--el-color-danger); font-weight: 600; }
.history { margin-top: 4px; }
.h-title { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
</style>
