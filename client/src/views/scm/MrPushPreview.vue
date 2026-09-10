<template>
  <div class="page mr-preview-page">
    <div class="mr-preview-header">
      <div class="mr-preview-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="mr-preview-header__sep">/</span>
        <span class="mr-preview-header__title">{{ previewTitle }}</span>
        <el-tag v-if="doc?.doc_no" size="small">{{ doc.doc_no }}</el-tag>
        <el-tag v-if="doc?.status" :type="doc.status === 'audited' ? 'success' : 'info'" size="small" effect="plain">
          {{ doc.status === 'audited' ? '已审核' : '草稿' }}
        </el-tag>
      </div>
      <div class="mr-preview-header__right">
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        <el-tag v-if="downstreamCompleted" type="success" size="small" effect="plain">已全部下推</el-tag>
        <el-button v-else type="primary" size="small" :loading="generating" :disabled="!canGenerate" @click="handleGenerate">
          生成已选下游单据
        </el-button>
      </div>
    </div>

    <div class="mr-preview-body" v-loading="loading">
      <div class="mr-summary">
        <div class="mr-summary-card">
          <span class="mr-summary-label">BOM 层级</span>
          <b>{{ maxLevel + 1 }}</b>
        </div>
        <div class="mr-summary-card">
          <span class="mr-summary-label">可下推行数</span>
          <b>{{ totalRows }}</b>
        </div>
        <div class="mr-summary-card">
          <span class="mr-summary-label">数量合计</span>
          <b>{{ num(totalQty) }}</b>
        </div>
        <div class="mr-summary-note">{{ summaryNote }}</div>
      </div>

      <el-alert v-if="hasCycle" type="error" :closable="false" show-icon class="mr-alert"
        :title="`BOM 存在循环：${cycles.map(path => path.join(' → ')).join('；')}，请先修正 BOM 后再下推。`" />
      <el-alert v-else-if="missingBomCount" type="warning" :closable="false" show-icon class="mr-alert"
        :title="`${missingBomCount} 个自制/委外/组装物料没有有效 BOM：仍可生成空工单，但不会继续展开下层材料。`" />

      <el-empty v-if="!loading && !activeGroups.length" :description="emptyDescription" />

      <div v-else class="mr-groups">
        <section v-for="group in groups" :key="group.key" class="mr-group" :class="{ 'is-empty': !group.rows.length }">
          <div class="mr-group__header">
            <div class="mr-group__title">
              <el-checkbox
                :model-value="groupChecked(group)"
                :indeterminate="groupIndeterminate(group)"
                :disabled="!group.rows.some(row => Number(row.remain_qty) > 0)"
                @change="value => toggleGroup(group, Boolean(value))"
              />
              <div>
              <h3>{{ group.target }}</h3>
              <span>{{ group.title }}，{{ group.rows.length }} 行</span>
              </div>
            </div>
            <el-tag :type="group.rows.length ? group.tagType : 'info'" effect="plain">
              {{ num(groupTotal(group)) }}
            </el-tag>
          </div>

          <el-table :data="group.rows" size="small" border stripe class="mr-table">
            <el-table-column label="选" width="44" align="center">
              <template #default="{ row }"><el-checkbox v-model="row.checked" /></template>
            </el-table-column>
            <el-table-column label="层级" width="66" align="center">
              <template #default="{ row }"><el-tag size="small" effect="plain">L{{ row.level }}</el-tag></template>
            </el-table-column>
            <el-table-column label="编号" prop="item_code" width="112" show-overflow-tooltip />
            <el-table-column label="名称" prop="item_name" min-width="150" show-overflow-tooltip />
            <el-table-column label="上级物料" width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.parent_item_codes.join('、') || '根缺料' }}</template>
            </el-table-column>
            <el-table-column label="毛需求" width="88" align="right">
              <template #default="{ row }">{{ num(row.gross_qty) }}</template>
            </el-table-column>
            <el-table-column label="库存" width="78" align="right">
              <template #default="{ row }">{{ num(row.stock_qty) }}</template>
            </el-table-column>
            <el-table-column label="外部在途" width="88" align="right">
              <template #default="{ row }">{{ num(row.external_supply_qty) }}</template>
            </el-table-column>
            <el-table-column label="本单已生成" width="100" align="right">
              <template #default="{ row }">{{ num(row.generated_qty) }}</template>
            </el-table-column>
            <el-table-column label="本次下推" width="170" align="right">
              <template #default="{ row }">
                <div class="mr-qty-edit">
                  <el-input-number v-model="row.remain_qty" :min="0" :precision="3" :controls="false" size="small" style="width:96px"
                    @change="value => onQtyChange(row, value)" />
                  <el-tag v-if="(Number(row.remain_qty) || 0) > row.suggest_qty" type="warning" size="small" effect="plain">多买</el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column :label="group.key === 'self' ? 'BOM/来源' : '供应商/外协厂'" width="220">
              <template #default="{ row }">
                <template v-if="group.key === 'self' || group.key === 'assembly'">
                  <el-tag v-if="row.missing_bom" type="warning" size="small">缺少 BOM</el-tag>
                  <span v-else>{{ row.bom_code || group.title }}</span>
                </template>
                <el-select v-else v-model="row.supplier_code" filterable placeholder="选择供应商/外协厂" size="small" style="width: 100%">
                  <el-option v-for="supplier in supplierOptions" :key="supplier.code" :label="supplierLabel(supplier)" :value="supplier.code" />
                </el-select>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
    </div>

    <div class="mr-preview-footer">
      <span>预计生成：</span>
      <el-tag :type="countByKey.purchase ? 'success' : 'info'" effect="plain">采购物料 {{ countByKey.purchase }} 项</el-tag>
      <el-tag :type="countByKey.outsource ? 'warning' : 'info'" effect="plain">委外成品 {{ countByKey.outsource }} 项</el-tag>
      <el-tag :type="countByKey.self ? 'primary' : 'info'" effect="plain">自制成品 {{ countByKey.self }} 项</el-tag>
      <el-tag :type="countByKey.assembly ? 'primary' : 'info'" effect="plain">组装成品 {{ countByKey.assembly }} 项</el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { scmApi, type ScmDoc } from '@/api/scm'
import { scmDocumentRoute } from '@/utils/scmDocNavigation'

type GroupKey = 'purchase' | 'outsource' | 'self' | 'assembly'
type PreviewRow = {
  key: string; level: number; parent_item_codes: string[]
  item_code: string; item_name: string; spec: string; unit: string
  source_type: GroupKey; supplier_code: string; purchase_price: number
  bom_id: string | null; bom_code: string
  root_qty: number; dependent_gross_qty: number; gross_qty: number
  stock_qty: number; external_supply_qty: number; required_qty: number
  generated_qty: number; suggest_qty: number; missing_bom: boolean
  remain_qty: number; checked: boolean
}
type PreviewGroup = {
  key: GroupKey
  title: string
  target: string
  tagType: 'success' | 'warning' | 'primary'
  rows: PreviewRow[]
}

const route = useRoute()
const router = useRouter()
const docId = computed(() => route.params.id as string)

const loading = ref(false)
const generating = ref(false)
const doc = ref<ScmDoc | null>(null)
const hasCycle = ref(false)
const cycles = ref<string[][]>([])
/** 供应商编码→名称，用于把有效供应商显示为「编码 名称」 */
type SupplierOption = { code: string; name: string }
const supplierOptions = ref<SupplierOption[]>([])
const isMrp = computed(() => doc.value?.doc_type === 'MRP')
const previewTitle = computed(() => isMrp.value ? 'MRP 直接下推预览' : '缺料下推预览')
const summaryNote = computed(() => isMrp.value
  ? '直接读取已审核 MRP 的多层 BOM 净需求快照，不再重复展开 BOM，也不再次扣减库存和在途；仅扣减本计算单已经生成的下游数量。'
  : '根缺料不重复扣库存；下级需求已扣全部仓库库存、外部采购在途和未完工工单。默认选中全部净需求，可逐行取消或修改数量。')
const emptyDescription = computed(() => isMrp.value ? '当前 MRP 计算单没有可展示的下推节点。' : '当前缺料单没有可展示的下推节点。')

/** 有效供应商 = 行供应商 ‖ 物料档案默认供应商；返回「编码 名称」 */
const supplierLabel = (supplier: SupplierOption) => supplier.name ? `${supplier.code} ${supplier.name}` : supplier.code

const num = (v: number) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
const round = (n: number) => Math.round(n * 1000000) / 1000000

const groups = ref<PreviewGroup[]>([])
function buildGroups(nodes: Omit<PreviewRow, 'remain_qty' | 'checked'>[]) {
  const base: PreviewGroup[] = [
    { key: 'purchase', title: '采购来源', target: '采购订单', tagType: 'success', rows: [] },
    { key: 'outsource', title: '委外来源', target: '委外计划', tagType: 'warning', rows: [] },
    { key: 'self', title: '自制来源', target: '生产计划', tagType: 'primary', rows: [] },
    { key: 'assembly', title: '组装来源', target: '组装单', tagType: 'primary', rows: [] },
  ]
  const map = new Map<GroupKey, PreviewGroup>(base.map(group => [group.key, group]))
  for (const node of nodes) {
    const group = map.get(node.source_type)
    if (!group) continue
    group.rows.push({ ...node, remain_qty: node.suggest_qty, checked: node.suggest_qty > 0 })
  }
  groups.value = base
}
// 组内本次下推合计（只统计勾选行，实时随编辑变化）
const groupTotal = (group: PreviewGroup) => round(group.rows.reduce((s, r) => s + (r.checked ? (Number(r.remain_qty) || 0) : 0), 0))

const activeGroups = computed(() => groups.value.filter(group => group.rows.length > 0))
const allRows = computed(() => activeGroups.value.flatMap(group => group.rows))
const selectedRows = computed(() => allRows.value.filter(row => row.checked && Number(row.remain_qty) > 0))
const totalRows = computed(() => allRows.value.filter(row => row.suggest_qty > 0).length)
const totalQty = computed(() => round(allRows.value.reduce((sum, row) => sum + (Number(row.suggest_qty) || 0), 0)))
const maxLevel = computed(() => allRows.value.reduce((max, row) => Math.max(max, row.level), 0))
const missingBomCount = computed(() => allRows.value.filter(row => row.missing_bom && row.required_qty > 0).length)
const canGenerate = computed(() => !!doc.value && doc.value.status === 'audited' && !hasCycle.value && selectedRows.value.length > 0)
const downstreamCompleted = computed(() =>
  !loading.value && !!doc.value && doc.value.status === 'audited' && !hasCycle.value
  && allRows.value.length > 0 && totalRows.value === 0
)
const countByKey = computed<Record<GroupKey, number>>(() => ({
  purchase: selectedRows.value.filter(row => row.source_type === 'purchase').length,
  outsource: selectedRows.value.filter(row => row.source_type === 'outsource').length,
  self: selectedRows.value.filter(row => row.source_type === 'self').length,
  assembly: selectedRows.value.filter(row => row.source_type === 'assembly').length,
}))

function groupChecked(group: PreviewGroup) {
  const actionable = group.rows.filter(row => Number(row.remain_qty) > 0)
  return actionable.length > 0 && actionable.every(row => row.checked)
}
function groupIndeterminate(group: PreviewGroup) {
  const actionable = group.rows.filter(row => Number(row.remain_qty) > 0)
  const checked = actionable.filter(row => row.checked).length
  return checked > 0 && checked < actionable.length
}
function toggleGroup(group: PreviewGroup, checked: boolean) {
  for (const row of group.rows) if (Number(row.remain_qty) > 0) row.checked = checked
}
function onQtyChange(row: PreviewRow, value: number | undefined) {
  if ((Number(value) || 0) > 0) row.checked = true
}

function goBack() {
  const from = route.query.from
  if (from === 'view') {
    router.push(scmDocumentRoute(docId.value, '', 'draft'))
  } else if (from === 'mrp') {
    router.push({ name: 'ScmMrpView', params: { id: docId.value } })
  } else {
    router.push({ name: 'ScmDocList', query: { doc_type: 'MR' } })
  }
}

async function load() {
  loading.value = true
  try {
    const [res, supRes] = await Promise.all([
      scmApi.getMrDownstreamPreview(docId.value),
      scmApi.getPartners({ partner_type: 'supplier' }).catch(() => ({ code: -1, data: [] as any[] })),
    ])
    if (res.code === 0) {
      doc.value = res.data.doc
      hasCycle.value = Boolean(res.data.has_cycle)
      cycles.value = res.data.cycles || []
      buildGroups(res.data.nodes as Omit<PreviewRow, 'remain_qty' | 'checked'>[])
    }
    if ((supRes as any).code === 0) {
      supplierOptions.value = ((supRes as any).data as any[]).map(p => ({ code: String(p.code), name: String(p.name || '') }))
    }
  } finally {
    loading.value = false
  }
}

async function handleGenerate() {
  if (!canGenerate.value) {
    ElMessage.warning(hasCycle.value ? 'BOM 存在循环，请先修正后再下推' : '请至少选择一条数量大于 0 的下推明细')
    return
  }
  const selectedNodes = selectedRows.value.map(row => ({
    key: row.key,
    qty: Number(row.remain_qty) || 0,
    supplier_code: row.source_type === 'purchase' || row.source_type === 'outsource' ? row.supplier_code : undefined,
  }))
  const targets = [...new Set(selectedRows.value.map(row => row.source_type))]
  generating.value = true
  try {
    const res = await scmApi.genDownstream(docId.value, targets, undefined, false, selectedNodes)
    if (res.code !== 0) return
    const { po, outsource_plans, self_plans, outsource_products = 0, self_products = 0, assembly_docs = 0 } = res.data
    const parts: string[] = []
    if (po) parts.push(`采购单 ${po} 张`)
    if (self_plans) parts.push(`生产工单 ${self_plans} 张（${self_products} 个成品）`)
    if (outsource_plans) parts.push(`委外工单 ${outsource_plans} 张（${outsource_products} 个成品）`)
    if (assembly_docs) parts.push(`组装单 ${assembly_docs} 张`)
    ElMessage.success('已生成 ' + parts.join(' / '))
    await load()
  } finally {
    generating.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.mr-preview-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
}
.mr-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  flex-wrap: wrap;
}
.mr-preview-header__left,
.mr-preview-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mr-preview-header__sep {
  color: var(--el-text-color-placeholder);
}
.mr-preview-header__title {
  font-size: var(--cw-text-lg);
  font-weight: 600;
}
.mr-preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px;
  overflow: auto;
}
.mr-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 180px)) minmax(280px, 1fr);
  gap: 10px;
  align-items: stretch;
}
.mr-summary-card,
.mr-summary-note {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
}
.mr-summary-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
}
.mr-summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mr-summary-card b {
  font-size: 22px;
  line-height: 1;
}
.mr-summary-note {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--cw-text-base);
  line-height: 1.6;
}
.mr-groups {
  display: grid;
  gap: 12px;
}
.mr-group {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.mr-group.is-empty {
  opacity: .62;
}
.mr-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--el-fill-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.mr-group__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mr-group__header h3 {
  margin: 0 0 4px;
  font-size: var(--cw-text-base);
}
.mr-group__header span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mr-table {
  width: 100%;
}
.mr-qty {
  color: var(--el-color-primary);
  font-weight: 600;
}
.mr-qty-edit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.mr-preview-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: #fff;
}
.mr-preview-footer .el-button {
  margin-left: auto;
}
@media (max-width: 900px) {
  .mr-summary {
    grid-template-columns: 1fr;
  }
  .mr-preview-footer .el-button {
    margin-left: 0;
  }
}
</style>
