<template>
  <div class="page pp-form-page">
    <!-- 顶部工具栏 -->
    <div class="pp-form-header">
      <div class="pp-form-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="pp-form-header__sep">/</span>
        <span class="pp-form-header__title">{{ pageTitle }}</span>
        <el-tag v-if="editId && planStatus" :type="planStatus === 'draft' ? 'info' : 'warning'" size="small" effect="plain">
          {{ STATUS_LABEL[planStatus] || planStatus }}
        </el-tag>
      </div>
      <div class="pp-form-header__right">
        <el-button size="small" @click="goBack">取消</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="readonly" @click="handleSave">保存</el-button>
      </div>
    </div>

    <el-alert v-if="readonly" type="warning" :closable="false" show-icon
      title="该计划已审核/已关闭，成品与用料已锁定，不可编辑" style="margin: 8px 16px 0;" />

    <!-- 表单主体 -->
    <div class="pp-form-body">
      <el-form :model="form" label-width="84px" size="small" :disabled="readonly">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="计划号" required>
              <el-input v-model="form.code" :disabled="!!editId" placeholder="计划唯一编号" />
            </el-form-item>
          </el-col>
          <el-col v-if="form.plan_type === 'outsource'" :span="6">
            <el-form-item label="委外厂" required>
              <el-select v-model="form.supplier_code" filterable clearable placeholder="选择委外厂" style="width:100%">
                <el-option v-for="p in outsourcePartners" :key="p.code" :label="`${p.code} ${p.name}`" :value="p.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="原料仓">
              <el-select v-model="form.yl_warehouse" clearable filterable style="width:100%" placeholder="各成品用料默认领料仓">
                <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="生产部门"><el-input v-model="form.dept_code" placeholder="可留空" /></el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="优先级"><el-input-number v-model="form.priority" :min="0" :precision="0" :controls="false" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="开始日期"><el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="结束日期"><el-date-picker v-model="form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <!-- 成品明细（master）：一单可多个成品 -->
      <div class="pp-lines-toolbar">
        <span class="pp-lines-title">成品明细</span>
        <span class="pp-lines-summary">共 {{ form.products.filter((p:any) => p.item_code).length }} 个成品（末行空行直接选成品即可）</span>
      </div>
      <el-table :data="form.products" border size="small" highlight-current-row :current-row-key="currentIndex"
        row-key="_k" @current-change="onCurrentProduct" class="compact-data-table pp-product-table" style="width:100%">
        <el-table-column label="序号" width="52" align="center">
          <template #default="{ $index }"><span :class="{ 'pp-cur': $index === currentIndex }">{{ $index + 1 }}</span></template>
        </el-table-column>
        <el-table-column label="成品物料" min-width="190">
          <template #default="{ row }">
            <ItemPicker v-if="!readonly" v-model="row.item_code" placeholder="选择成品" @pick="(it:any) => onPickProduct(it, row)" />
            <span v-else>{{ row.item_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="成品名称" min-width="150"><template #default="{ row }">{{ row.item_name }}</template></el-table-column>
        <el-table-column label="计划数量" width="120" align="right">
          <template #default="{ row }">
            <el-input-number v-if="!readonly" v-model="row.plan_qty" :min="0" :precision="3" :controls="false" size="small" style="width:100%" />
            <span v-else>{{ row.plan_qty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="BOM 模板" min-width="150">
          <template #default="{ row, $index }">
            <el-input :model-value="bomDisplay(row)" readonly clearable :disabled="readonly" placeholder="双击选择"
              @dblclick="openBomPicker($index)" @clear="row.bom_id = ''">
              <template #suffix><el-icon class="pp-bom-browse" @click.stop="openBomPicker($index)"><Grid /></el-icon></template>
            </el-input>
          </template>
        </el-table-column>
        <el-table-column label="成品仓" width="150">
          <template #default="{ row }">
            <el-select v-if="!readonly" v-model="row.fp_warehouse" clearable filterable size="small" placeholder="完工入库仓" style="width:100%">
              <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
            </el-select>
            <span v-else>{{ row.fp_warehouse ? whName(row.fp_warehouse) : '' }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="form.plan_type === 'outsource'" label="税前加工单价" width="130" align="right">
          <template #default="{ row }">
            <el-input-number v-if="!readonly" v-model="row.process_fee" :min="0" :precision="2" :controls="false" size="small" style="width:100%" />
            <span v-else>{{ Number(row.process_fee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="form.plan_type === 'outsource'" label="加工税率%" width="110" align="right">
          <template #default="{ row }">
            <el-input-number v-if="!readonly" v-model="row.process_tax_rate" :min="0" :max="100" :precision="2" :controls="false" size="small" style="width:100%" />
            <span v-else>{{ Number(row.process_tax_rate || 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用料" width="90" align="center">
          <template #default="{ row, $index }">
            <el-button link type="primary" size="small" @click="currentIndex = $index">{{ row.lines.length }} 项 ✎</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="50" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" :disabled="readonly" @click="removeProduct($index)">删</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 用料明细（detail）：当前选中成品的实际执行 BOM -->
      <div v-if="currentProduct" class="pp-lines-toolbar pp-detail-toolbar">
        <span class="pp-lines-title">用料明细 · {{ currentProduct.item_code || '未选成品' }} {{ currentProduct.item_name }}</span>
        <el-button size="small" plain :disabled="readonly" @click="batchVisible = true"><el-icon><Grid /></el-icon>批量选料</el-button>
        <el-button size="small" plain :disabled="readonly" :loading="smartWhLoading" @click="smartPickWarehouse" title="按当前库存为全部成品的用料自动分配领料仓库"><el-icon><MagicStick /></el-icon>智能选仓</el-button>
        <span class="pp-lines-summary">共 {{ currentProduct.lines.filter((l:any) => l.item_code).length }} 项</span>
      </div>
      <el-table v-if="currentProduct" :data="currentProduct.lines" border size="small" :height="tableHeight" style="width:100%" @cell-click="handleCellClick" class="compact-data-table">
        <el-table-column label="序号" width="52" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column label="物料编号" min-width="150" prop="item_code">
          <template #default="{ row, $index }">
            <ItemPicker v-if="!readonly && isEditing($index, 'item_code')" v-model="row.item_code" auto-open :browsable="false" @pick="(item:any) => { row.item_code = item.code; row.item_name = item.name; row.spec = item.spec || ''; row.unit = item.unit; stopEdit() }" v-focus />
            <div v-else class="editable-cell">{{ row.item_code }}</div>
          </template>
        </el-table-column>
        <el-table-column label="物料名称" min-width="170" prop="item_name">
          <template #default="{ row }"><div class="static-cell">{{ row.item_name }}</div></template>
        </el-table-column>
        <el-table-column label="规格" min-width="120" prop="spec" show-overflow-tooltip>
          <template #default="{ row }"><div class="static-cell">{{ row.spec || '' }}</div></template>
        </el-table-column>
        <el-table-column label="单位用量" width="120" align="right" prop="qty">
          <template #default="{ row, $index }">
            <el-input-number v-if="!readonly && isEditing($index, 'qty')" v-model="row.qty" :min="0" :precision="4" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.qty }}</div>
          </template>
        </el-table-column>
        <el-table-column label="单位" width="90" prop="unit">
          <template #default="{ row, $index }">
            <el-input v-if="!readonly && isEditing($index, 'unit')" v-model="row.unit" size="small" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.unit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="损耗率%" width="100" align="right" prop="scrap_rate">
          <template #default="{ row, $index }">
            <el-input-number v-if="!readonly && isEditing($index, 'scrap_rate')" v-model="row.scrap_rate" :min="0" :max="100" :precision="2" size="small" :controls="false" style="width:100%" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.scrap_rate }}</div>
          </template>
        </el-table-column>
        <el-table-column label="领料仓库" width="150" prop="warehouse_code">
          <template #default="{ row, $index }">
            <el-select v-if="!readonly && isEditing($index, 'warehouse_code')" v-model="row.warehouse_code" filterable clearable size="small" placeholder="默认取原料仓" style="width:100%" @change="stopEdit" @visible-change="v => !v && stopEdit()" v-focus>
              <el-option v-for="w in warehouses" :key="w.code" :label="w.name || w.code" :value="w.code" />
            </el-select>
            <div v-else class="editable-cell">{{ row.warehouse_code ? whName(row.warehouse_code) : '（默认原料仓）' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="计划总需" width="110" align="right">
          <template #default="{ row }">{{ totalNeed(row) }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" prop="remark">
          <template #default="{ row, $index }">
            <el-input v-if="!readonly && isEditing($index, 'remark')" v-model="row.remark" size="small" @blur="stopEdit" v-focus />
            <div v-else class="editable-cell">{{ row.remark }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="50" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" :disabled="readonly" @click="currentProduct.lines.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <ItemBatchPicker v-if="batchVisible" v-model="batchVisible" @confirm="onBatchAddLines" />
    <BomPicker v-if="bomPickerVisible" v-model="bomPickerVisible" :item-code="bomPickerItemCode" @confirm="onBomPicked" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Grid, MagicStick } from '@element-plus/icons-vue'
import { scmApi } from '@/api/scm'
import { useAutoBlankRow } from '@/composables/useAutoBlankRow'
import { hasSelectedMaterialLines, matchProductBoms, pickDefaultProductBom, shouldResetProductBom } from '@/utils/productionPlanBom'

// 选择器只在用户编辑对应单元格或打开弹窗时加载，缩短计划单首屏时间。
const ItemPicker = defineAsyncComponent(() => import('@/components/scm/ItemPicker.vue'))
const ItemBatchPicker = defineAsyncComponent(() => import('@/components/scm/ItemBatchPicker.vue'))
const BomPicker = defineAsyncComponent(() => import('@/components/scm/BomPicker.vue'))

const route = useRoute()
const router = useRouter()

const STATUS_LABEL: Record<string, string> = { draft: '草稿', released: '已审核', closed: '已关闭' }
const isNew = computed(() => route.name === 'ScmProductionPlanNew')
const editId = computed(() => isNew.value ? null : (route.params.id as string))
const planStatus = ref<string>('draft')
const readonly = computed(() => !!editId.value && planStatus.value !== 'draft')
const pageTitle = computed(() => (form.value.plan_type === 'outsource' ? '委外计划' : '生产计划') + (isNew.value ? '（新增）' : '（编辑）'))
const tableHeight = computed(() => 'calc(100vh - 470px)')

let kSeq = 0
const newProduct = () => ({ _k: ++kSeq, id: undefined, source_line_id: undefined, source_doc_id: undefined, item_code: '', _resolved_item_code: '', item_name: '', spec: '', plan_qty: 1, bom_id: '', fp_warehouse: '', process_fee: 0, process_tax_rate: 0, lines: [] as any[] })
const emptyForm = () => ({
  code: '', plan_type: (route.query.plan_type as string) || 'self',
  supplier_code: '', dept_code: '', priority: 0, yl_warehouse: '', start_date: '', end_date: '',
  products: [newProduct()],
})
const form = ref<Record<string, any>>(emptyForm())
const currentIndex = ref(0)
const currentProduct = computed(() => form.value.products[currentIndex.value] || null)
const saving = ref(false)

// 成品表 / 用料明细末尾自动保留空行（免点「添加成品/添加用料」；空行保存已过滤）
useAutoBlankRow(() => form.value.products, newProduct, { enabled: () => !readonly.value })
useAutoBlankRow(
  () => currentProduct.value?.lines,
  () => ({ item_code: '', item_name: '', spec: '', qty: 1, unit: '', scrap_rate: 0, warehouse_code: '', remark: '' }),
  { enabled: () => !readonly.value && !!currentProduct.value },
)
const boms = ref<any[]>([]); const warehouses = ref<any[]>([]); const partners = ref<any[]>([])
const outsourcePartners = computed(() => partners.value.filter((p: any) => p.enabled !== 0 && p.is_outsource === 1))
const whName = (code: string) => { const w = warehouses.value.find((x: any) => x.code === code); return w ? w.name : code }

function onCurrentProduct(row: any) { if (!row) return; const i = form.value.products.indexOf(row); if (i >= 0) currentIndex.value = i }

const totalNeed = (row: any) => {
  const pq = Number(currentProduct.value?.plan_qty) || 0
  const n = (Number(row.qty) || 0) * (1 + (Number(row.scrap_rate) || 0) / 100) * pq
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}

// 成品 master 操作
function removeProduct(idx: number) {
  form.value.products.splice(idx, 1)
  if (!form.value.products.length) form.value.products.push(newProduct())
  if (currentIndex.value >= form.value.products.length) currentIndex.value = form.value.products.length - 1
}

// 逐格编辑（用料明细，作用于当前成品）
const editingCell = ref<{ rowIndex: number; field: string } | null>(null)
const vFocus = { mounted: (el: HTMLElement) => { const i = (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement | null; if (i) { i.focus(); i.select() } } }
function isEditing(rowIndex: number, field: string) { return editingCell.value?.rowIndex === rowIndex && editingCell.value?.field === field }
function handleCellClick(row: any, column: any) {
  if (readonly.value || !currentProduct.value) return
  const rowIndex = currentProduct.value.lines.indexOf(row)
  if (['item_code', 'qty', 'unit', 'scrap_rate', 'warehouse_code', 'remark'].includes(column.property)) editingCell.value = { rowIndex, field: column.property }
}
function stopEdit() { editingCell.value = null }

const batchVisible = ref(false)
function onBatchAddLines(items: any[]) {
  const cur = currentProduct.value
  if (!cur || !items || !items.length) return
  const existed = new Set(cur.lines.map((l: any) => l.item_code).filter(Boolean))
  cur.lines = cur.lines.filter((l: any) => l.item_code)
  for (const it of items) {
    if (existed.has(it.code)) continue
    existed.add(it.code)
    cur.lines.push({ item_code: it.code, item_name: it.name, spec: it.spec || '', qty: 1, unit: it.unit_name || it.unit || '', scrap_rate: 0, warehouse_code: '', remark: '' })
  }
}

// 智能选仓：按当前库存为全部成品的每条用料自动分配「领料仓库」
// 规则：优先能满足该行计划总需的仓（取其中库存最多）；都不够→库存最多的仓；无库存→留空(默认原料仓)并汇总提示。
const smartWhLoading = ref(false)
async function smartPickWarehouse() {
  const prods = form.value.products.filter((p: any) => (p.lines || []).some((l: any) => l.item_code))
  if (!prods.length) return ElMessage.warning('请先添加成品与用料')
  try { await ElMessageBox.confirm('将按当前库存，为全部成品的每条用料自动分配「领料仓库」（覆盖已填的领料仓）。继续？', '智能选仓', { type: 'warning', confirmButtonText: '智能分配', cancelButtonText: '取消' }) } catch { return }
  smartWhLoading.value = true
  try {
    const r = await scmApi.getStock()
    const byItem = new Map<string, { wh: string; qty: number }[]>()
    for (const s of (r.code === 0 ? (r.data || []) : []) as any[]) {
      const wh = s.warehouse_code || ''; const qty = Number(s.qty) || 0
      if (!wh || qty <= 0) continue
      if (!byItem.has(s.item_code)) byItem.set(s.item_code, [])
      byItem.get(s.item_code)!.push({ wh, qty })
    }
    for (const arr of byItem.values()) arr.sort((a, b) => b.qty - a.qty)
    let assigned = 0; const noStock: string[] = []
    for (const p of prods) {
      const pq = Number(p.plan_qty) || 0
      for (const l of (p.lines || [])) {
        if (!l.item_code) continue
        const cand = byItem.get(l.item_code) || []
        if (!cand.length) { if (!noStock.includes(l.item_code)) noStock.push(l.item_code); continue }
        const need = (Number(l.qty) || 0) * (1 + (Number(l.scrap_rate) || 0) / 100) * pq
        const cover = cand.filter(c => c.qty >= need)
        l.warehouse_code = (cover[0] || cand[0]).wh
        assigned++
      }
    }
    const msg = `已为 ${assigned} 项用料智能分配领料仓库` + (noStock.length ? `；${noStock.length} 项无库存已保留默认原料仓：${noStock.slice(0, 8).join('、')}${noStock.length > 8 ? '…' : ''}` : '')
    noStock.length ? ElMessage.warning(msg) : ElMessage.success(msg)
  } finally { smartWhLoading.value = false }
}

// 选成品：回填名称 + 若唯一匹配 BOM 且该成品当前无用料，自动带模板
async function onPickProduct(item: any, row: any) {
  const nextCode = String(item.code || '')
  if (shouldResetProductBom(row._resolved_item_code || '', nextCode)) {
    row.bom_id = ''
    row.lines = []
  }
  row.item_code = nextCode
  row.item_name = item.name
  row._resolved_item_code = nextCode
  if (row.bom_id || hasSelectedMaterialLines(row.lines)) return
  // 选定成品后自动带出 BOM：唯一匹配直接带；多张时带默认那张（启用/版本新/编码小），并提示可改选
  const matched = matchProductBoms(await ensureBomsLoaded(), nextCode)
  const bom = pickDefaultProductBom(matched)
  if (!bom) return void ElMessage.warning(`成品 ${nextCode} 尚未维护 BOM，请先在「BOM 管理」建档，或手工录入用料`)
  row.bom_id = bom.id
  await loadBomInto(row, bom.id)
  if (matched.length > 1) ElMessage.info(`成品 ${nextCode} 有 ${matched.length} 张 BOM，已带入 ${bom.code || ''}，可双击「BOM 模板」改选`)
}

// BOM 模板：按成品行选择
const bomPickerVisible = ref(false)
const bomPickerForIndex = ref(0)
const bomPickerItemCode = ref('')
function bomDisplay(row: any) {
  if (!row.bom_id) return ''
  const b = boms.value.find((x: any) => x.id === row.bom_id)
  return b ? `${b.code} ${b.item_code}` : row.bom_id
}
function openBomPicker(idx: number) {
  if (readonly.value) return
  const row = form.value.products[idx]
  if (!row?.item_code) return void ElMessage.warning('请先选择成品')
  bomPickerForIndex.value = idx
  bomPickerItemCode.value = row.item_code
  bomPickerVisible.value = true
}
async function onBomPicked(bom: any) {
  if (!bom) return
  const row = form.value.products[bomPickerForIndex.value]
  if (!row) return
  if (row.lines.length) {
    try { await ElMessageBox.confirm('选择模板将覆盖该成品当前用料明细，确认？', '提示', { type: 'warning' }) } catch { return }
  }
  if (!boms.value.find((x: any) => x.id === bom.id)) boms.value.push(bom)
  row.bom_id = bom.id
  await loadBomInto(row, bom.id)
}
async function loadBomInto(row: any, bomId: string) {
  if (!bomId) return
  const r = await scmApi.getBom(bomId)
  if (r.code === 0 && Array.isArray(r.data?.lines)) {
    // 仅主件(component)进领料用料；副产品/联产品是产出，不作领料需求
    row.lines = r.data.lines.filter((l: any) => (l.line_type || 'component') === 'component').map((l: any) => ({
      item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '',
      qty: Number(l.qty) || 0, unit: l.unit || '', scrap_rate: Number(l.scrap_rate) || 0,
      warehouse_code: '', remark: l.remark || '',
    }))
  }
}

async function ensureBomsLoaded() {
  if (boms.value.length) return boms.value
  const r = await scmApi.getBoms()
  if (r.code === 0 && Array.isArray(r.data)) boms.value = r.data
  return boms.value
}

async function loadMeta() {
  const [b, w, p] = await Promise.all([scmApi.getBoms(), scmApi.getWarehouses(), scmApi.getPartners({})])
  if (b.code === 0) boms.value = b.data
  if (w.code === 0) warehouses.value = w.data
  if (p.code === 0) partners.value = p.data as any[]
}

onMounted(async () => {
  const metaTask = loadMeta().catch(() => undefined)
  if (editId.value) {
    const r = await scmApi.getProductionPlan(editId.value)
    if (r.code === 0) {
      const p = r.data.plan
      planStatus.value = p.status || 'draft'
      const products = (r.data.products || []).map((pd: any) => ({
        _k: ++kSeq, id: pd.id, source_line_id: pd.source_line_id || undefined, source_doc_id: pd.source_doc_id || undefined,
        item_code: pd.item_code, _resolved_item_code: pd.item_code, item_name: pd.item_name || '', spec: pd.spec || '',
        plan_qty: Number(pd.plan_qty) || 0, bom_id: pd.bom_id || '', fp_warehouse: pd.fp_warehouse || '',
        process_fee: Number(pd.process_fee) || 0, process_tax_rate: Number(pd.process_tax_rate) || 0,
        lines: (pd.bom_lines || []).map((l: any) => ({
          item_code: l.item_code, item_name: l.item_name || '', spec: l.spec || '',
          qty: Number(l.qty) || 0, unit: l.unit || '', scrap_rate: Number(l.scrap_rate) || 0,
          warehouse_code: l.warehouse_code || '', remark: l.remark || '',
        })),
      }))
      form.value = {
        code: p.code, plan_type: p.plan_type || 'self', supplier_code: p.supplier_code || '', dept_code: p.dept_code || '',
        priority: Number(p.priority) || 0, yl_warehouse: p.yl_warehouse || '',
        start_date: p.start_date || '', end_date: p.end_date || '',
        products: products.length ? products : [newProduct()],
      }
      currentIndex.value = 0
    }
  } else {
    form.value = emptyForm()
    try { const r = await scmApi.getProductionPlanNextNo(form.value.plan_type as any); if (r.code === 0) form.value.code = r.data.next_no } catch { /* 取号失败可手填 */ }
  }
  void metaTask
})

async function handleSave() {
  if (!form.value.code) return ElMessage.warning('计划号不能为空')
  if (form.value.plan_type === 'outsource' && !form.value.supplier_code) return ElMessage.warning('委外计划必须选择委外厂')
  const products = form.value.products
    .filter((p: any) => p.item_code && Number(p.plan_qty) > 0)
    .map((p: any) => ({
      id: p.id || undefined, source_line_id: p.source_line_id || undefined, source_doc_id: p.source_doc_id || undefined,
      item_code: p.item_code, plan_qty: p.plan_qty, bom_id: p.bom_id || null, fp_warehouse: p.fp_warehouse || null,
      process_fee: Number(p.process_fee) || 0, process_tax_rate: Number(p.process_tax_rate) || 0,
      lines: p.lines.filter((l: any) => l.item_code && Number(l.qty) > 0),
    }))
  if (!products.length) return ElMessage.warning('请至少添加一个成品（成品与计划数必填）')
  saving.value = true
  try {
    const payload = {
      code: form.value.code, plan_type: form.value.plan_type, supplier_code: form.value.supplier_code || null,
      dept_code: form.value.dept_code || null, priority: form.value.priority, yl_warehouse: form.value.yl_warehouse || null,
      start_date: form.value.start_date || null, end_date: form.value.end_date || null, products,
    }
    if (editId.value) { await scmApi.updateProductionPlan(editId.value, payload); ElMessage.success('已保存') }
    else { await scmApi.createProductionPlan(payload); ElMessage.success('保存成功') }
    goBack()
  } finally { saving.value = false }
}

function goBack() { router.push({ name: 'ScmProductionPlan', query: { plan_type: form.value.plan_type || 'self' } }) }
</script>

<style scoped>
.pp-form-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.pp-form-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color); flex-shrink: 0;
}
.pp-form-header__left { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.pp-form-header__sep { color: var(--el-text-color-placeholder); }
.pp-form-header__title { font-weight: 600; color: var(--el-text-color-primary); }
.pp-form-header__right { display: flex; gap: 8px; }
.pp-form-body { flex: 1; overflow: auto; padding: 14px 16px; }
.pp-lines-toolbar { display: flex; align-items: center; gap: 8px; margin: 6px 0 8px; }
.pp-detail-toolbar { margin-top: 16px; padding-top: 10px; border-top: 1px dashed var(--el-border-color); }
.pp-lines-title { font-size: 14px; font-weight: 600; margin-right: 6px; }
.pp-lines-summary { margin-left: auto; font-size: 13px; color: var(--el-text-color-secondary); }
.pp-product-table :deep(.current-row > td) { background: var(--el-color-primary-light-9) !important; }
.pp-cur { color: var(--el-color-primary); font-weight: 700; }
.compact-data-table :deep(.el-table__cell) { padding: 0; }
.compact-data-table :deep(.cell) { padding: 0 4px; line-height: 28px; }
.editable-cell { min-height: 28px; cursor: pointer; width: 100%; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.editable-cell:hover { background-color: var(--el-fill-color-light); }
.pp-bom-browse { cursor: pointer; color: var(--el-text-color-placeholder); transition: color .15s; }
.pp-bom-browse:hover { color: var(--el-color-primary); }
</style>
