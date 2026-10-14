<template>
  <div class="item-picker" ref="pickerRef">
    <el-input
      ref="mainInputRef"
      v-model="display"
      :placeholder="placeholder"
      size="small"
      clearable
      @click="onMainInputClick"
      @focus="onMainInputFocus"
      @input="handleMainInput"
      @clear="clearItem"
      @keydown.esc="showPanel = false"
      @keydown.down.prevent="moveActiveItem(1)"
      @keydown.up.prevent="moveActiveItem(-1)"
      @keydown.enter.prevent="confirmActiveItem"
    >
      <template #prefix>
        <el-icon><Search /></el-icon>
      </template>
      <template v-if="browsable" #suffix>
        <el-icon
          class="ip-browse-btn"
          title="浏览选择物料"
          @mousedown.prevent.stop
          @click.stop="openBrowse"
        ><Grid /></el-icon>
      </template>
    </el-input>

    <!-- 系统通用物料选择模态框（浏览按钮调起） -->
    <ItemBatchPicker
      v-if="browsable && browseVisible"
      v-model="browseVisible"
      :multiple="browseMultiple"
      :default-source="defaultSource"
      @confirm="onBrowseConfirm"
    />

    <Teleport to="body">
      <div
        v-if="showPanel"
        ref="dropdownRef"
        class="item-picker-dropdown"
        :style="dropdownStyle"
        @mousedown.stop
        @click.stop
      >
        <div class="ip-filter">
          <span class="ip-filter__lbl">来源</span>
          <el-radio-group v-model="sourceFilter" size="small">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button v-for="(n, k) in SOURCE_TYPES" :key="k" :value="k">{{ n }}</el-radio-button>
          </el-radio-group>
          <el-checkbox v-if="warehouseCode || defaultStockOnly" v-model="stockOnly" size="small" class="ip-filter__stock">仅看有库存</el-checkbox>
        </div>
        <div v-if="sourceFallback" class="ip-fallback">没有「{{ SOURCE_TYPES[sourceFilter as keyof typeof SOURCE_TYPES] }}」来源的匹配物料，已显示全部</div>
        <el-table
          v-loading="loading"
          :data="displayCandidates"
          row-key="code"
          size="small"
          highlight-current-row
          max-height="340"
          border
          :row-class-name="rowClassName"
          @row-click="pickItem"
          class="compact-table"
        >
          <el-table-column label="编号" prop="code" width="120">
            <template #default="{ row }">
              <span :style="{ paddingLeft: indentOf(row) }">
                {{ row.code }}
                <el-tag v-if="isCategory(row)" size="small" type="info" effect="plain" class="cat-tag">目录</el-tag>
              </span>
            </template>
          </el-table-column>
          <el-table-column label="名称" prop="name" min-width="120" show-overflow-tooltip />
          <el-table-column label="规格" prop="spec" width="100" show-overflow-tooltip />
          <el-table-column label="单位" prop="unit" width="60" />
          <el-table-column label="存量(本仓/合计)" width="130" align="right">
            <template #default="{ row }">
              <span v-if="!isCategory(row)" :class="(Number(row._stock_total) || 0) > 0 ? 'text-success' : 'text-muted'">
                {{ stockDisplay(row) }}
              </span>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="displayCandidates.length === 0 && !loading" class="no-data">
          未找到匹配物料
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineAsyncComponent } from 'vue'
import type { ElInput } from 'element-plus'
import { scmApi, SOURCE_TYPES } from '@/api/scm'
import { Search, Grid } from '@element-plus/icons-vue'

// 浏览选择器体积较大，仅在用户真正点击浏览按钮后加载。
const ItemBatchPicker = defineAsyncComponent(() => import('@/components/scm/ItemBatchPicker.vue'))

const props = withDefaults(defineProps<{
  modelValue?: string
  warehouseCode?: string
  placeholder?: string
  /** 挂载即展开候选面板：用于"点击单元格进入编辑"的场景 */
  autoOpen?: boolean
  /** 展开后聚焦下拉内检索框（双击物料单元格时使用） */
  focusSearch?: boolean
  /** 是否显示「浏览」按钮调起系统模态框（默认显示） */
  browsable?: boolean
  /** 浏览模态框是否多选（默认单选，返回一个物料） */
  browseMultiple?: boolean
  /** 出库类单据：默认只显示有库存的物料（仅在传了 warehouseCode 时生效，可手动切换查看全部） */
  defaultStockOnly?: boolean
  /** 默认「来源」筛选（purchase / outsource / self / assembly）：如委外计划选成品默认委外；可手动切回全部 */
  defaultSource?: string
}>(), { modelValue: '', placeholder: '输入编号/名称进行搜索', autoOpen: false, focusSearch: false, browsable: true, browseMultiple: false, defaultStockOnly: false })

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'pick', item: any): void
  /** 浏览模态框多选确认时返回多个物料 */
  (e: 'pick-multiple', items: any[]): void
}>()

const browseVisible = ref(false)
function openBrowse() {
  showPanel.value = false
  browseVisible.value = true
}
function onBrowseConfirm(items: any[]) {
  if (!items || !items.length) return
  if (props.browseMultiple) {
    emit('pick-multiple', items)
    return
  }
  const it = items[0]
  editing.value = false  // 浏览模态选中提交
  display.value = `${it.code} ${it.name}`
  keyword.value = it.code
  emit('update:modelValue', it.code)
  emit('pick', it)
  showPanel.value = false
}

const pickerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const mainInputRef = ref<InstanceType<typeof ElInput> | null>(null)
const showPanel = ref(false)
const loading = ref(false)
const candidates = ref<any[]>([])
const activeCandidateIndex = ref(-1)
const sourceFilter = ref(props.defaultSource || '')   // '' = 全部；否则为 source_type 枚举（purchase/outsource/self/assembly）
watch(() => props.defaultSource, v => { sourceFilter.value = v || '' })
const stockOnly = ref(!!props.defaultStockOnly)   // 仅看有库存（出库类默认开；有仓库按仓结存，无仓库按全仓合计）
const display = ref('')
const keyword = ref('')
// 用户正在手工编辑主输入框文本、尚未重新选中：此时已选编码(modelValue)失效，
// 需置空避免脏值；同时守卫 modelValue 的 watch，防止置空回写把用户正在输入的文本清掉。
const editing = ref(false)
const dropdownStyle = ref<Record<string, string>>({})
let debounce: any = null
let searchSequence = 0
/** 打开面板后短暂忽略外部 click（含双击的第二次 click） */
let suppressOutsideClick = false

function updateDropdownPosition() {
  if (!pickerRef.value) return
  const rect = pickerRef.value.getBoundingClientRect()
  const panelWidth = 560
  let left = rect.left
  if (left + panelWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - panelWidth - 8)
  }
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${left}px`,
    width: `${panelWidth}px`,
    zIndex: '3000',
  }
}

function syncKeywordFromDisplay() {
  const text = display.value.trim()
  keyword.value = text.includes(' ') ? text.split(' ')[0] : text
}

async function openPanel(opts?: { focusInput?: boolean }) {
  suppressOutsideClick = true
  showPanel.value = true
  syncKeywordFromDisplay()
  search(keyword.value)
  await nextTick()
  updateDropdownPosition()
  if (opts?.focusInput) {
    await focusMainInput()
  }
  // 双击第二次 click 会在 ~50ms 内到达，需足够窗口
  setTimeout(() => { suppressOutsideClick = false }, 400)
}

onMounted(async () => {
  if (props.modelValue) resolveDisplay(props.modelValue)
  window.addEventListener('scroll', updateDropdownPosition, true)
  window.addEventListener('resize', updateDropdownPosition)
  await nextTick()
  document.addEventListener('click', handleClickOutside)
  if (props.autoOpen) {
    // 表格单元格进入编辑：展开面板并聚焦主输入框，用户可直接打字检索
    await openPanel({ focusInput: true })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', updateDropdownPosition, true)
  window.removeEventListener('resize', updateDropdownPosition)
})

watch(showPanel, async (open) => {
  if (!open) return
  await nextTick()
  updateDropdownPosition()
})

watch(() => props.modelValue, v => {
  if (editing.value) return  // 用户手工编辑中：不让回写覆盖正在输入的文本
  if (v) resolveDisplay(v)
  else display.value = ''
})

watch(() => props.focusSearch, async (v) => {
  if (!v) return
  await openPanel({ focusInput: true })
})

async function resolveDisplay(code: string) {
  if (!code) return
  if (display.value.startsWith(code + ' ')) return

  const res = await scmApi.getItems({ keyword: code, page_size: 1 })
  if (res.code === 0 && res.data.list.length > 0) {
    const item = res.data.list[0]
    display.value = `${item.code} ${item.name}`
  } else {
    display.value = code
  }
}

function handleClickOutside(e: MouseEvent) {
  if (suppressOutsideClick) return
  const target = e.target as Node
  if (pickerRef.value?.contains(target)) return
  if (dropdownRef.value?.contains(target)) return
  showPanel.value = false
}

async function focusMainInput() {
  await nextTick()
  const input = mainInputRef.value?.input as HTMLInputElement | undefined
  input?.focus()
  input?.select()
}

function onMainInputClick() {
  if (!showPanel.value) openPanel()
}

function onMainInputFocus() {
  if (!showPanel.value) openPanel()
}

// 主输入框直接打字检索：去掉了下拉内单独的搜索框，单元格内即可输入过滤候选
function handleMainInput(val: string) {
  // 手工改文本即视为「已选失效」：置空编码，避免用户改了文本却残留旧物料编码
  editing.value = true
  if (props.modelValue) emit('update:modelValue', '')
  keyword.value = val.includes(' ') ? val.split(' ')[0] : val
  if (!showPanel.value) openPanel()
  search(keyword.value)
}

function clearItem() {
  editing.value = false
  display.value = ''
  keyword.value = ''
  emit('update:modelValue', '')
  candidates.value = []
}

// 结存缓存（统一查全仓，客户端按 warehouseCode 取本仓）：
// 与 ItemBatchPicker / DocForm「实时库存」列口径一致（本仓 X / 合计 Y），避免三处对不上。
// byWh: item_code -> (warehouse_code -> qty)；total: item_code -> 全仓合计
interface StockCache { byWh: Map<string, Map<string, number>>; total: Map<string, number> }
let _stockKey: string | null = null
let _stockCache: StockCache = { byWh: new Map(), total: new Map() }
async function getStockCache(): Promise<StockCache> {
  // 缓存键只用 account_set（不随 warehouseCode 变，因为始终查全仓）
  const key = '__all__'
  if (_stockKey === key) return _stockCache
  const stockRes = await scmApi.getStock({})
  const byWh = new Map<string, Map<string, number>>()
  const total = new Map<string, number>()
  if (stockRes.code === 0) {
    for (const s of stockRes.data as any[]) {
      const code = s.item_code
      const wh = s.warehouse_code || ''
      const qty = Number(s.qty) || 0
      if (!byWh.has(code)) byWh.set(code, new Map())
      const whMap = byWh.get(code)!
      whMap.set(wh, (whMap.get(wh) || 0) + qty)
      total.set(code, (total.get(code) || 0) + qty)
    }
  }
  _stockKey = key; _stockCache = { byWh, total }
  return _stockCache
}

async function search(kw: string) {
  clearTimeout(debounce)
  const sequence = ++searchSequence
  debounce = setTimeout(async () => {
    loading.value = true
    try {
      const searchKw = kw.trim()
      // 全量加载（与批量选择器一致），避免成品等编码靠后的物料因分页被截断而选不到
      // 首次库存与物料请求并行，避免两个网络往返串行阻塞候选列表。
      const [res, sc] = await Promise.all([
        scmApi.getItems({ keyword: searchKw || undefined, all: '1', for_pick: '1' }),
        getStockCache(),
      ])
      if (sequence !== searchSequence) return
      if (res.code === 0) {
        const items = res.data.list as any[]
        // 「存量」列：有 warehouseCode→本仓库存；无 warehouseCode→退化为全仓合计（避免按空仓查导致恒 0）
        // _stock_qty 用于「仅看有库存」过滤与存量显示；_stock_total 始终是全仓合计。
        const wCode = props.warehouseCode || ''
        items.forEach(i => {
          const whMap = sc.byWh.get(i.code)
          i._stock_qty = wCode ? (whMap ? (whMap.get(wCode) || 0) : 0) : (sc.total.get(i.code) || 0)
          i._stock_total = sc.total.get(i.code) || 0
        })
        candidates.value = items
      }
    } finally {
      // 快速连续输入时，旧请求结束不能提前关闭新请求的加载状态。
      if (sequence === searchSequence) loading.value = false
    }
  }, 200)
}

// 本地过滤候选：来源 + 仅有库存（均剔除目录行）；无过滤时原样返回（含目录树）
// 来源为空的老物料按「外购」看待（与库表默认值一致）
const itemSource = (r: any) => r.source_type || 'purchase'
const sourceFiltered = computed(() => sourceFilter.value
  ? candidates.value.filter(r => !isCategory(r) && itemSource(r) === sourceFilter.value) : candidates.value)
// 默认来源下搜不到、但全部里有匹配时自动放开，避免「明明有这个物料却选不到」
const sourceFallback = computed(() => !!sourceFilter.value && !sourceFiltered.value.length
  && candidates.value.some(r => !isCategory(r)))
const displayCandidates = computed(() => {
  let list = sourceFallback.value ? candidates.value.filter(r => !isCategory(r)) : sourceFiltered.value
  // 「仅看有库存」按全仓合计判断（_stock_total），而非本仓库存——避免当前仓库无货但其他仓有货的物料被漏掉
  if (stockOnly.value) list = list.filter(r => !isCategory(r) && (Number(r._stock_total) || 0) > 0)
  return list
})

// 存量列显示：与 ItemBatchPicker / DocForm「实时库存」列完全一致——「本仓 X / 合计 Y」。
// 无 warehouseCode 时（出库类未选表头仓）只显示合计。格式：整数不补零、最多 3 位小数。
const stockNumFmt = (v: number) => {
  const n = Number(v) || 0
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}
function stockDisplay(row: any): string {
  const wh = Number(row._stock_qty) || 0
  const total = Number(row._stock_total) || 0
  if (props.warehouseCode) {
    return `本仓 ${stockNumFmt(wh)} / 合计 ${stockNumFmt(total)}`
  }
  return `合计 ${stockNumFmt(total)}`
}
const selectableCandidates = computed(() => displayCandidates.value.filter(row => !isCategory(row)))

watch(selectableCandidates, rows => {
  activeCandidateIndex.value = rows.length ? 0 : -1
}, { flush: 'sync' })

function moveActiveItem(offset: number) {
  if (!showPanel.value) {
    openPanel({ focusInput: true })
    return
  }
  const count = selectableCandidates.value.length
  if (!count) return
  const next = activeCandidateIndex.value < 0
    ? (offset > 0 ? 0 : count - 1)
    : (activeCandidateIndex.value + offset + count) % count
  activeCandidateIndex.value = next
}

function confirmActiveItem() {
  if (!showPanel.value) return
  const row = selectableCandidates.value[activeCandidateIndex.value]
  if (row) pickItem(row)
}
// 切换筛选后面板高度变化，重新定位下拉
watch([sourceFilter, stockOnly], () => nextTick(updateDropdownPosition))

function isCategory(row: any) {
  return row && (row.is_leaf === 0 || row.is_leaf === '0')
}
function indentOf(row: any) {
  const lv = Number(row?.level) || 1
  return `${(lv - 1) * 12}px`
}
function rowClassName({ row }: { row: any }) {
  if (isCategory(row)) return 'category-row'
  return selectableCandidates.value[activeCandidateIndex.value] === row ? 'keyboard-active-row' : ''
}

function pickItem(row: any) {
  if (isCategory(row)) return
  editing.value = false  // 选中提交，恢复 modelValue→display 同步
  display.value = `${row.code} ${row.name}`
  keyword.value = row.code
  emit('update:modelValue', row.code)
  emit('pick', row)
  showPanel.value = false
}

defineExpose({ openPanel })
</script>

<style scoped>
.item-picker { position: relative; width: 100%; }
.ip-browse-btn {
  cursor: pointer;
  color: var(--el-text-color-placeholder);
  transition: color 0.15s;
}
.ip-browse-btn:hover {
  color: var(--el-color-primary);
}
.item-picker-dropdown {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px;
}
.ip-filter {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 4px 6px; flex-wrap: wrap;
}
.ip-filter__lbl { font-size: 12px; color: var(--el-text-color-secondary); }
.ip-filter__stock { margin-left: auto; }
.ip-fallback { font-size: 12px; color: var(--el-color-warning); padding: 0 8px 4px; }
.no-data {
  padding: 20px; text-align: center; color: var(--el-text-color-secondary); font-size: var(--cw-text-base);
}
.text-success { color: var(--el-color-success); }
.text-muted { color: var(--el-text-color-placeholder); }

.compact-table :deep(.el-table__cell) {
  padding: 4px 0;
}
.cat-tag { margin-left: 4px; transform: scale(0.85); transform-origin: left center; }

.compact-table :deep(.category-row) {
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color-lighter);
  cursor: not-allowed;
}
.compact-table :deep(.category-row:hover > td.el-table__cell) {
  background: var(--el-fill-color-lighter) !important;
}
.compact-table :deep(.category-row .cell) {
  font-weight: 600;
}
.compact-table :deep(.keyboard-active-row > td.el-table__cell) {
  background: var(--el-color-primary-light-9) !important;
}
</style>
