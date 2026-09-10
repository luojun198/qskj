<template>
  <el-dialog
    :model-value="modelValue"
    :title="`选择源单（${typeName(sourceDocType)}）`"
    width="900px"
    draggable
    @update:model-value="(v:boolean) => emit('update:modelValue', v)"
  >
    <div class="src-picker-hint">
      <template v-if="detailSource === 'received'">
        列出<b>有入库记录</b>的<b>已审核</b>{{ typeName(sourceDocType) }}；勾选订单后下方展开其<b>已入库明细</b>，
        可<b>逐行勾选</b>并<b>调整退货数量</b>（不超过剩余可退）。
      </template>
      <template v-else>
        仅列出<b>已审核</b>且<b>未完全下推</b>的{{ typeName(sourceDocType) }}；可多选合并（须同一往来单位）。
        下方明细可<b>逐行勾选</b>并<b>调整带入数量</b>。
      </template>
    </div>

    <!-- 上栏：源单列表（整张多选） -->
    <div class="src-picker-section-title">源单</div>
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="docs"
      size="small"
      border
      stripe
      max-height="240"
      @selection-change="onSelectionChange"
      @row-click="toggleRow"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column label="单据号" prop="doc_no" width="160" />
      <el-table-column label="日期" prop="doc_date" width="105" />
      <el-table-column label="往来单位" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.partner_name || row.partner_code }}</template>
      </el-table-column>
      <el-table-column label="数量" prop="total_qty" width="90" align="right" />
      <el-table-column label="金额" width="120" align="right">
        <template #default="{ row }">{{ fmt(row.total_amount) }}</template>
      </el-table-column>
      <el-table-column label="下推进度" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.push_progress === 'part' ? 'warning' : 'info'" size="small">
            {{ row.push_progress === 'part' ? '部分下推' : '未下推' }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="!loading && !docs.length" class="src-picker-empty">无可选源单</div>

    <!-- 下栏：已选源单的明细行（逐行勾选 + 可调带入数量） -->
    <div class="src-picker-section-title">
      明细行
      <span class="src-picker-section-sub">勾选要带入的明细，可按需修改带入数量（不超过剩余可推）</span>
    </div>
    <el-table
      v-loading="loadingDetail"
      :data="detailRows"
      size="small"
      border
      stripe
      max-height="240"
      empty-text="请先在上方勾选源单"
    >
      <el-table-column label="" width="42" align="center">
        <template #default="{ row }">
          <el-checkbox v-model="row.checked" />
        </template>
      </el-table-column>
      <el-table-column label="来源单据" prop="doc_no" width="150" />
      <el-table-column label="编号" width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.line.item_code }}</template>
      </el-table-column>
      <el-table-column label="名称" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.line.item_name || '' }}</template>
      </el-table-column>
      <el-table-column label="规格" width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.line.spec || '' }}</template>
      </el-table-column>
      <el-table-column label="仓位" width="90">
        <template #default="{ row }">{{ row.line.warehouse_code || '-' }}</template>
      </el-table-column>
      <el-table-column :label="detailSource === 'received' ? '已入库' : '原数量'" width="80" align="right">
        <template #default="{ row }">{{ row.line.qty }}</template>
      </el-table-column>
      <el-table-column :label="detailSource === 'received' ? '已退' : '已下推'" width="80" align="right">
        <template #default="{ row }">{{ row.line.pushed_qty || 0 }}</template>
      </el-table-column>
      <el-table-column v-if="detailSource === 'self'" label="正常剩余" width="90" align="right">
        <template #default="{ row }">{{ row.baseRemain }}</template>
      </el-table-column>
      <el-table-column :label="detailSource === 'received' ? '剩余可退' : sourceDocType === 'PO' ? '允许剩余' : '剩余可推'" width="90" align="right">
        <template #default="{ row }">{{ row.remain }}</template>
      </el-table-column>
      <el-table-column label="带入数量" width="130" align="right">
        <template #default="{ row }">
          <el-input-number
            v-model="row.bringQty"
            :min="0"
            :max="row.remain"
            :precision="6"
            :controls="false"
            size="small"
            :disabled="!row.checked"
            style="width:100%"
          />
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <span class="src-picker-count">
        已选源单 {{ selected.length }} 张 · 已勾明细 {{ checkedCount }} 行 · 带入数量合计 {{ bringTotal }}
      </span>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :loading="confirming"
        :disabled="!checkedCount"
        @click="handleConfirm"
      >确定带入</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { scmApi } from '@/api/scm'

const props = withDefaults(defineProps<{
  modelValue: boolean
  sourceDocType: string
  partnerCode?: string
  /** 明细来源：self=展开源单自身明细(默认)；received=展开源单(采购订单)下钻出的「已入库」明细(采购订单退货用) */
  detailSource?: 'self' | 'received'
}>(), { detailSource: 'self' })
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  /** 带入的明细行 + 来源往来单位 */
  (e: 'confirm', payload: { lines: any[]; partner_code: string }): void
}>()

const DOC_TITLE: Record<string, string> = {
  PQ: '采购询价', PO: '采购订单', SQ: '销售报价', SOa: '销售订单',
  PI: '采购入库', PR: '采购退货',
}
const typeName = (c: string) => DOC_TITLE[c] || c
const fmt = (v: number) => (v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 一条明细选择行：绑定到某张源单的某条明细 */
interface DetailRow {
  doc_id: string       // 来源源单 id
  doc_no: string       // 来源单据号（展示用）
  partner_code: string // 来源源单往来单位（校验用）
  line: any            // 原始明细行（含 id/item_code/qty/pushed_qty/price...）
  remain: number       // 剩余可下推量 = qty - pushed_qty
  baseRemain: number   // 不含超量比例的正常剩余量
  checked: boolean     // 是否勾选带入，默认 true
  bringQty: number     // 带入数量，默认 = remain
}

const tableRef = ref<any>(null)
const loading = ref(false)
const loadingDetail = ref(false)
const confirming = ref(false)
const docs = ref<any[]>([])
const selected = ref<any[]>([])
// 已加载明细的源单 id 集合，避免重复请求；增删整张单据时不影响已做的勾选/数量调整
const loadedDocIds = ref<Set<string>>(new Set())
const detailRows = ref<DetailRow[]>([])
const purchaseOverReceiptEnabled = ref(false)
const purchaseOverReceiptRate = ref(0)

/** 已勾选且带入数量 > 0 的明细行数 */
const checkedCount = computed(() =>
  detailRows.value.filter(r => r.checked && (Number(r.bringQty) || 0) > 0).length
)
/** 带入数量合计 */
const bringTotal = computed(() =>
  detailRows.value
    .filter(r => r.checked)
    .reduce((s, r) => s + (Number(r.bringQty) || 0), 0)
)

async function onOpen() {
  selected.value = []
  detailRows.value = []
  loadedDocIds.value = new Set()
  loading.value = true
  try {
    if (props.sourceDocType === 'PO' && props.detailSource === 'self') {
      const params = await scmApi.getParams()
      const value = (key: string) => params.data?.find((row: any) => row.param_key === key)?.param_value || ''
      purchaseOverReceiptEnabled.value = value('scm:purchase_over_receipt_enabled') === '1'
      purchaseOverReceiptRate.value = Math.max(0, Number(value('scm:purchase_over_receipt_rate')) || 0)
    } else {
      purchaseOverReceiptEnabled.value = false; purchaseOverReceiptRate.value = 0
    }
    const res = await scmApi.getDocs({
      doc_type: props.sourceDocType,
      status: 'audited',
      partner_code: props.partnerCode || undefined,
      page_size: 200,
    })
    if (res.code === 0) {
      // received（采购订单退货）：列出有入库记录的订单（push_progress!=='none'，含已全部收货）
      // self（常规下推/入库单退货）：列出未完全下推的源单
      docs.value = props.detailSource === 'received'
        ? (res.data.list as any[]).filter(d => d.push_progress && d.push_progress !== 'none')
        : props.sourceDocType === 'PO'
          ? (res.data.list as any[])
          : (res.data.list as any[]).filter(d => d.push_progress !== 'full')
    }
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  visible => {
    if (visible) void onOpen()
  },
  { immediate: true },
)

function onSelectionChange(rows: any[]) {
  selected.value = rows
  void syncDetailRows(rows)
}

function toggleRow(row: any) {
  tableRef.value?.toggleRowSelection(row)
}

/** 源单勾选变化时，增量加载明细：移除已取消勾选的单据明细，为新勾选的单据补充明细。 */
async function syncDetailRows(rows: any[]) {
  const keepIds = new Set(rows.map(r => r.id))
  // 1) 移除已取消勾选源单的明细行
  detailRows.value = detailRows.value.filter(d => keepIds.has(d.doc_id))
  // 1.1) 同步「已加载」缓存：剔除已取消勾选的源单 id，否则重新勾选时会被当作已加载而跳过、明细不再出现
  for (const id of [...loadedDocIds.value]) if (!keepIds.has(id)) loadedDocIds.value.delete(id)
  // 2) 找出尚未加载明细的源单
  const toLoad = rows.filter(r => !loadedDocIds.value.has(r.id))
  if (!toLoad.length) return
  loadingDetail.value = true
  try {
    for (const d of toLoad) {
      loadedDocIds.value.add(d.id)
      if (props.detailSource === 'received') await loadReceivedRows(d)
      else await loadSelfRows(d)
    }
  } finally {
    loadingDetail.value = false
  }
}

/** self：默认带入正常剩余；开启采购超收后，仅把输入上限放宽到允许剩余。 */
async function loadSelfRows(d: any) {
  const res = await scmApi.getDoc(d.id)
  if (res.code !== 0) return
  const s = res.data as any
  for (const l of (s.lines || [])) {
    const qty = Number(l.qty) || 0
    const pushedQty = Number(l.pushed_qty) || 0
    const baseRemain = Math.round(Math.max(0, qty - pushedQty) * 1000000) / 1000000
    const limit = qty * (purchaseOverReceiptEnabled.value && props.sourceDocType === 'PO' ? (1 + purchaseOverReceiptRate.value / 100) : 1)
    const remain = Math.round(Math.max(0, limit - pushedQty) * 1000000) / 1000000
    if (remain <= 0) continue // 跳过已下推完的行
    detailRows.value.push({
      doc_id: d.id, doc_no: d.doc_no, partner_code: d.partner_code || '',
      line: l, remain, baseRemain, checked: baseRemain > 0, bringQty: baseRemain,
    })
  }
}

/** received（采购订单退货）：把订单 d 下钻为其「已入库」明细行 —— 关联到入库行(source_line_id=入库行id)，
 *  剩余可退 = 入库数量 - 已退。doc_id 仍存订单 id（保证取消勾选订单时整组明细被移除）。 */
async function loadReceivedRows(d: any) {
  // 1) 本订单行 id 集合：过滤掉多源合并入库单里不属于本订单的行
  const poRes = await scmApi.getDoc(d.id)
  const poLineIds = new Set<string>((poRes.code === 0 ? (poRes.data as any).lines || [] : []).map((l: any) => l.id))
  // 2) 本订单的下游已审核采购入库单
  const dnRes = await scmApi.getDocDownstream(d.id)
  const piDocs = (dnRes.code === 0 ? dnRes.data.downstream_docs || [] : [])
    .filter((x: any) => x.doc_type === 'PI' && x.status === 'audited')
  // 3) 逐张入库单取明细，保留本订单的入库行
  for (const pi of piDocs) {
    const piRes = await scmApi.getDoc(pi.id)
    if (piRes.code !== 0) continue
    for (const l of ((piRes.data as any).lines || [])) {
      if (poLineIds.size && l.source_line_id && !poLineIds.has(l.source_line_id)) continue
      const remain = (Number(l.qty) || 0) - (Number(l.pushed_qty) || 0)
      if (remain <= 0) continue // 已全部退完的入库行跳过
      detailRows.value.push({
        doc_id: d.id,                                   // 订单 id：取消勾选订单时移除本组
        doc_no: pi.doc_no,                              // 入库单号：「来源单据」列展示
        partner_code: pi.partner_code || d.partner_code || '',
        line: l, remain, baseRemain: remain, checked: true, bringQty: remain,
      })
    }
  }
}

async function handleConfirm() {
  // 取已勾选且带入数量 > 0 的明细行
  const picked = detailRows.value.filter(r => r.checked && (Number(r.bringQty) || 0) > 0)
  if (!picked.length) {
    return ElMessage.warning('请勾选并填写要带入的明细行')
  }
  // 多选须同一往来单位（保证应收主体唯一）
  const partners = Array.from(new Set(picked.map(r => r.partner_code || '')))
  if (partners.length > 1) {
    return ElMessage.warning('所选明细的往来单位不一致，请选择同一往来单位的单据')
  }
  confirming.value = true
  try {
    const lines: any[] = picked.map(r => {
      const qty = Number(r.bringQty) || 0
      const price = Number(r.line.price) || 0
      const l = r.line
      const taxRate = l.tax_rate === null || l.tax_rate === undefined || l.tax_rate === '' ? null : Number(l.tax_rate)
      return {
        item_code: l.item_code,
        item_name: l.item_name || '',
        warehouse_code: l.warehouse_code || '',
        qty,
        price,
        amount: Math.round(qty * price * 100) / 100,
        unit_cost: l.unit_cost || 0,
        price_with_tax: Number(l.price_with_tax) || null,
        tax_rate: taxRate,
        tax_amount: taxRate === null ? null : Math.round(qty * price * taxRate) / 100,
        remark: l.remark || '',
        source_line_id: l.id, // 行级溯源键（received 模式即指向入库行）
        purchase_order_no: props.sourceDocType === 'PO' && props.detailSource === 'self' ? r.doc_no : undefined,
      }
    })
    emit('confirm', { lines, partner_code: partners[0] })
    emit('update:modelValue', false)
  } finally {
    confirming.value = false
  }
}
</script>

<style scoped>
.src-picker-hint { font-size: var(--cw-text-base); color: var(--el-text-color-secondary); margin-bottom: 8px; }
.src-picker-section-title {
  font-size: var(--cw-text-base); font-weight: 600; color: var(--el-text-color-primary);
  margin: 10px 0 6px; display: flex; align-items: baseline; gap: 8px;
}
.src-picker-section-sub { font-weight: 400; color: var(--el-text-color-secondary); }
.src-picker-empty { padding: 20px; text-align: center; color: var(--el-text-color-placeholder); }
.src-picker-count { margin-right: auto; font-size: var(--cw-text-base); color: var(--el-text-color-secondary); }
:deep(.el-dialog__footer) { display: flex; align-items: center; gap: 8px; }
</style>
