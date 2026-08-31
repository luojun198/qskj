<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    fullscreen
    :close-on-click-modal="false"
    destroy-on-close
    class="item-batch-picker-dialog"
    @open="onOpen"
  >
    <!-- 对话框头部工具栏 -->
    <div class="ibp-toolbar">
      <div class="ibp-toolbar__left">
        <el-input
          v-model="keyword"
          placeholder="搜索编号 / 名称 / 规格"
          clearable
          style="width: 280px"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select
          v-model="filterType"
          placeholder="全部属性"
          clearable
          style="width: 130px"
        >
          <el-option
            v-for="(label, key) in itemTypeMap"
            :key="key"
            :label="label"
            :value="key"
          />
        </el-select>
        <el-select
          v-model="sourceType"
          placeholder="全部来源"
          clearable
          style="width: 120px"
        >
          <el-option v-for="(n, k) in SOURCE_TYPES" :key="k" :label="n" :value="k" />
        </el-select>
        <el-checkbox v-if="warehouseCode || stockOnlyDefault" v-model="stockOnly">仅看有库存</el-checkbox>
        <span class="ibp-hint">{{ multiple ? '仅显示明细物料，双击行可快速选中' : '单选模式，双击行即可选定' }}</span>
      </div>
      <div class="ibp-toolbar__right">
        <el-button :disabled="selected.length === 0" @click="clearSelection">清空选择</el-button>
        <el-button type="primary" :disabled="selected.length === 0" @click="confirm">
          {{ multiple ? `确认添加${selected.length > 0 ? ` (${selected.length}项)` : ''}` : '确认选择' }}
        </el-button>
      </div>
    </div>

    <!-- 主体：左侧树形分类 + 右侧物料列表 -->
    <div class="ibp-body">
      <!-- 左侧分类导航（可切换分组 + 可折叠树） -->
      <div class="ibp-sidebar">
        <!-- 分组方式切换 -->
        <div class="ibp-sidebar__head">
          <el-radio-group v-model="groupMode" size="small" class="ibp-group-switch">
            <el-radio-button value="category">物料分类</el-radio-button>
            <el-radio-button value="source">来源</el-radio-button>
          </el-radio-group>
        </div>
        <!-- 展开/收起控制 -->
        <div class="ibp-tree-tools">
          <el-button text size="small" @click="expandAll">
            <el-icon><Expand /></el-icon>一键展开
          </el-button>
          <el-button text size="small" @click="collapseAll">
            <el-icon><Fold /></el-icon>一键收纳
          </el-button>
          <el-button text size="small" @click="levelExpand">
            <el-icon><ArrowDown /></el-icon>层级展开
          </el-button>
          <el-button text size="small" @click="levelCollapse">
            <el-icon><ArrowUp /></el-icon>层级收纳
          </el-button>
        </div>
        <el-scrollbar height="calc(100vh - 266px)">
          <el-tree
            ref="treeRef"
            :data="treeData"
            node-key="key"
            :props="{ label: 'label', children: 'children' }"
            :default-expand-all="true"
            :expand-on-click-node="false"
            highlight-current
            class="ibp-tree"
            @node-click="onNodeClick"
          >
            <template #default="{ data }">
              <span class="ibp-tree-node">
                <span v-if="data.code" class="ibp-tree-code">{{ data.code }}</span>
                <span class="ibp-tree-label">{{ data.label }}</span>
              </span>
            </template>
          </el-tree>
        </el-scrollbar>
      </div>

      <!-- 右侧物料列表 -->
      <div class="ibp-main">
        <el-table
          ref="tableRef"
          v-loading="loading"
          :data="list"
          border
          size="small"
          max-height="calc(100vh - 218px)"
          row-key="id"
          :highlight-current-row="!multiple"
          @selection-change="onSelectionChange"
          @row-click="onRowClick"
          @row-dblclick="onRowDblClick"
          class="ibp-table"
        >
          <el-table-column v-if="multiple" type="selection" width="46" :selectable="isSelectable" reserve-selection />
          <el-table-column v-else width="46" align="center">
            <template #default="{ row }">
              <el-radio
                :model-value="selected[0] && selected[0].id"
                :value="row.id"
                :disabled="!isSelectable(row)"
                @change="onRowClick(row)"
              ><span></span></el-radio>
            </template>
          </el-table-column>
          <el-table-column label="编号" prop="code" width="140" sortable />
          <el-table-column label="名称" prop="name" min-width="160" show-overflow-tooltip />
          <el-table-column label="规格" prop="spec" width="120" show-overflow-tooltip />
          <el-table-column label="单位" width="70">
            <template #default="{ row }">{{ row.unit_name || row.unit }}</template>
          </el-table-column>
          <el-table-column label="属性" width="90">
            <template #default="{ row }">{{ itemTypeMap[row.item_type] || row.item_type }}</template>
          </el-table-column>
          <el-table-column v-if="warehouseCode || stockOnlyDefault" label="存量(本仓/合计)" width="130" align="right">
            <template #default="{ row }">
              <span :class="(Number(row._stock_total) || 0) > 0 ? 'ibp-stock-ok' : 'ibp-stock-none'">
                {{ stockDisplay(row) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="进价" prop="purchase_price" width="90" align="right">
            <template #default="{ row }">{{ row.purchase_price ? row.purchase_price.toFixed(4) : '' }}</template>
          </el-table-column>
          <el-table-column label="售价" prop="sale_price" width="90" align="right">
            <template #default="{ row }">{{ row.sale_price ? row.sale_price.toFixed(4) : '' }}</template>
          </el-table-column>
          <el-table-column label="备注" prop="remark" min-width="120" show-overflow-tooltip />
        </el-table>

        <!-- 分页 -->
        <div class="ibp-pagination">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[50, 100, 200, 500]"
            layout="total, sizes, prev, pager, next"
            background
            small
          />
        </div>
      </div>
    </div>

    <!-- 底部状态条：显示当前已选信息 -->
    <div class="ibp-footer">
      <div class="ibp-footer__info">
        <template v-if="multiple">
          已选 <b class="ibp-footer__count">{{ selected.length }}</b> 项
        </template>
        <template v-else-if="selected.length">
          已选：<b class="ibp-footer__count">{{ selected[0].code }} {{ selected[0].name }}</b>
        </template>
        <span v-else class="ibp-footer__placeholder">尚未选择物料</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted } from 'vue'
import { ElTable, ElTree } from 'element-plus'
import { Search, Expand, Fold, ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import { scmApi, ITEM_TYPES, SOURCE_TYPES, type ScmItem } from '@/api/scm'

// 分类节点（树）数据结构
interface TreeNode {
  key: string
  label: string
  code?: string
  field: 'all' | 'category' | 'category_none' | 'source'
  value: string
  children?: TreeNode[]
}
// 物料分类档案（scm_item_category）
interface CategoryDef {
  id: string
  code: string
  name: string
  parent_code?: string | null
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** 多选（批量加行）= true（默认）；单选（选一个物料）= false */
  multiple?: boolean
  /** 自定义标题，不传则按 multiple 自动取 */
  title?: string
  /** 传入仓库编码则加载该仓库结存、显示「存量」列并可按库存筛选 */
  warehouseCode?: string
  /** 出库类单据：打开时默认勾选「仅看有库存」（仅在有 warehouseCode 时生效） */
  stockOnlyDefault?: boolean
}>(), { multiple: true })

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', items: ScmItem[]): void
}>()

// 支持父页面按需挂载：组件首次创建时 modelValue 可能已经为 true。
const visible = ref(props.modelValue)
const dialogTitle = computed(() => props.title || (props.multiple ? '批量选择物料' : '选择物料'))

watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => emit('update:modelValue', v))

// ──────────────────────────── 数据 ────────────────────────────
const tableRef = ref<InstanceType<typeof ElTable> | null>(null)
const treeRef = ref<InstanceType<typeof ElTree> | null>(null)
const loading = ref(false)
const allList = ref<ScmItem[]>([])
const categoryDefs = ref<CategoryDef[]>([])  // 物料分类档案 scm_item_category
const filteredList = ref<ScmItem[]>([])
const list = ref<ScmItem[]>([])

const total = ref(0)
const page = ref(1)
const pageSize = ref(200)  // 默认每页 200，避免编码靠后的成品(130xxx)落到第 2 页而看不到
const keyword = ref('')
const filterType = ref('')
const sourceType = ref('')   // 工具栏「来源」筛选：'' = 全部；否则为 source_type 枚举
const stockOnly = ref(false) // 工具栏「仅看有库存」（仅在有 warehouseCode 时生效）
const groupMode = ref<'category' | 'source'>('category') // 左侧分组方式
const activeFilter = ref<{ field: TreeNode['field']; value: string }>({ field: 'all', value: '' })
const currentLevel = ref(0) // 层级展开/收纳的当前层级
const selected = ref<ScmItem[]>([])

// 属性字典：复用 api/scm.ts 的 ITEM_TYPES（'0'原辅材料/'6'半成品/'9'成品），与物料档案口径一致
const itemTypeMap: Record<string, string> = ITEM_TYPES

// ──────────────────────────── 事件 ────────────────────────────
function onOpen() {
  keyword.value = ''
  filterType.value = ''
  sourceType.value = ''
  stockOnly.value = !!props.stockOnlyDefault
  groupMode.value = 'category'
  activeFilter.value = { field: 'all', value: '' }
  currentLevel.value = 0
  page.value = 1
  selected.value = []
  clearSelection()
  loadAllData()
}

// 兜底：父页面用 v-if 按需挂载时（如 DocForm 双击打开），组件首次创建时 modelValue 已为 true，
// el-dialog 在「挂载即 visible=true」的情况下不会触发 @open 事件，导致 onOpen→loadAllData 不执行，
// 弹窗空白。此处主动补一次加载。
onMounted(() => {
  if (props.modelValue) loadAllData()
})

function onSelectionChange(rows: ScmItem[]) {
  if (!props.multiple) return
  selected.value = rows
}

// 单选模式：点击行即选中（多选模式不处理，交给复选框）
function onRowClick(row: ScmItem) {
  if (props.multiple) return
  if (!isSelectable(row)) return
  selected.value = [row]
}

function onRowDblClick(row: ScmItem) {
  if (!isSelectable(row)) return
  if (props.multiple) {
    tableRef.value?.toggleRowSelection(row)
  } else {
    selected.value = [row]
    confirm()
  }
}

function isSelectable(row: ScmItem) {
  return row.is_leaf === 1 || row.is_leaf === undefined
}

function clearSelection() {
  tableRef.value?.clearSelection()
  ;(tableRef.value as any)?.setCurrentRow()
  selected.value = []
}

function confirm() {
  emit('confirm', [...selected.value])
  visible.value = false
}

// ──────────────────────────── 数据加载与过滤 ────────────────────────────
async function loadAllData() {
  loading.value = true
  try {
    const needStock = props.warehouseCode || props.stockOnlyDefault
    // needStock：有 warehouseCode 或 stockOnlyDefault 时才显示「存量」列。
    // 查全仓（不传 warehouse_code），客户端按 warehouseCode 取本仓——与单据页口径一致。
    const [itemsRes, catRes, stockRes] = await Promise.all([
      (scmApi.getItems as any)({ all: '1' }),
      scmApi.getCategories().catch(() => ({ code: -1, data: [] })),
      needStock
        ? scmApi.getStock({}).catch(() => ({ code: -1, data: [] }))
        : Promise.resolve({ code: -1, data: [] }),
    ])
    if (itemsRes.code === 0) {
      allList.value = itemsRes.data.list || []
    }
    if ((catRes as any).code === 0) {
      categoryDefs.value = ((catRes as any).data || []) as CategoryDef[]
    }
    // 总是查全仓库存（不传 warehouse_code），客户端再按 warehouseCode 取本仓。
    // 这样与单据页「查询实时库存」列口径一致（都是本仓/合计双值），避免两边对不上。
    if (needStock && (stockRes as any).code === 0) {
      const byWhMap = new Map<string, Map<string, number>>() // item_code -> (warehouse_code -> qty)
      const totalMap = new Map<string, number>()              // item_code -> 全仓合计
      for (const s of (stockRes as any).data as any[]) {
        const code = s.item_code
        const wh = s.warehouse_code || ''
        const qty = Number(s.qty) || 0
        if (!byWhMap.has(code)) byWhMap.set(code, new Map())
        const whMap = byWhMap.get(code)!
        whMap.set(wh, (whMap.get(wh) || 0) + qty)
        totalMap.set(code, (totalMap.get(code) || 0) + qty)
      }
      const wCode = props.warehouseCode || ''
      allList.value.forEach((i: any) => {
        const whMap = byWhMap.get(i.code)
        // _stock_qty 用于「仅看有库存」过滤与存量显示：
        //   有 warehouseCode→本仓库存；无 warehouseCode→退化为全仓合计（避免按空仓查导致恒 0）
        i._stock_qty = wCode ? (whMap ? (whMap.get(wCode) || 0) : 0) : (totalMap.get(i.code) || 0)
        i._stock_total = totalMap.get(i.code) || 0
      })
    }
    updateFilteredList()
    // 默认高亮"全部物料"节点（el-tree 的 highlight-current 需显式 setCurrentKey 才会亮）
    nextTick(() => treeRef.value?.setCurrentKey('all'))
  } catch (e) {
    console.error('加载物料数据失败:', e)
  } finally {
    loading.value = false
  }
}

// 存量列显示：与单据页「查询实时库存」列口径一致——「本仓 X / 合计 Y」。
// 无 warehouseCode 时（出库类未选表头仓）只显示合计。
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

// ──────────────────────────── 左侧分类树 ────────────────────────────
const treeData = computed<TreeNode[]>(() => {
  const root: TreeNode = { key: 'all', label: '全部物料', field: 'all', value: '' }
  if (groupMode.value === 'category') {
    return [root, ...buildCategoryTree(), { key: 'cat:__none', label: '未分类', field: 'category_none', value: '' }]
  }
  // source
  return [
    root,
    { key: 'src:purchase', label: '采购', field: 'source', value: 'purchase' },
    { key: 'src:outsource', label: '委外', field: 'source', value: 'outsource' },
    { key: 'src:self', label: '自制（成品）', field: 'source', value: 'self' },
    { key: 'src:assembly', label: '组装', field: 'source', value: 'assembly' },
  ]
})

// 按 parent_code 构建物料分类档案树
function buildCategoryTree(): TreeNode[] {
  const byParent = new Map<string, CategoryDef[]>()
  for (const c of categoryDefs.value) {
    const p = c.parent_code || '__root'
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(c)
  }
  const build = (parentKey: string): TreeNode[] =>
    (byParent.get(parentKey) || []).map(c => ({
      key: `cat:${c.code}`,
      label: c.name,
      code: c.code,
      field: 'category' as const,
      value: c.code,
      children: build(c.code),
    }))
  return build('__root')
}

// 收集某分类码及其所有子孙分类码（用于右表过滤包含子分类）
function categoryDescendantCodes(code: string): Set<string> {
  const childrenMap = new Map<string, string[]>()
  for (const c of categoryDefs.value) {
    const p = c.parent_code || ''
    if (!childrenMap.has(p)) childrenMap.set(p, [])
    childrenMap.get(p)!.push(c.code)
  }
  const result = new Set<string>([code])
  const stack = [code]
  while (stack.length) {
    const cur = stack.pop()!
    for (const ch of childrenMap.get(cur) || []) {
      if (!result.has(ch)) { result.add(ch); stack.push(ch) }
    }
  }
  return result
}

function onNodeClick(data: TreeNode) {
  activeFilter.value = { field: data.field, value: data.value }
}

// 切换分组时重置过滤为「全部物料」并重设层级
watch(groupMode, () => {
  activeFilter.value = { field: 'all', value: '' }
  currentLevel.value = 0
  nextTick(() => treeRef.value?.setCurrentKey('all'))
})

// ──────────────────────────── 展开 / 收纳控制 ────────────────────────────
function setAllExpanded(expanded: boolean) {
  const store: any = (treeRef.value as any)?.store
  if (!store) return
  for (const node of Object.values<any>(store.nodesMap)) {
    if (expanded) node.expand()
    else node.collapse()
  }
}
function expandAll() { setAllExpanded(true) }
function collapseAll() { setAllExpanded(false) }

function applyLevelExpand() {
  const store: any = (treeRef.value as any)?.store
  if (!store) return
  for (const node of Object.values<any>(store.nodesMap)) {
    if (node.level <= currentLevel.value) node.expand()
    else node.collapse()
  }
}
function maxTreeLevel(): number {
  const store: any = (treeRef.value as any)?.store
  if (!store) return 1
  let max = 1
  for (const node of Object.values<any>(store.nodesMap)) {
    if (node.level > max) max = node.level
  }
  return max
}
function levelExpand() {
  currentLevel.value = Math.min(currentLevel.value + 1, maxTreeLevel())
  applyLevelExpand()
}
function levelCollapse() {
  currentLevel.value = Math.max(currentLevel.value - 1, 0)
  applyLevelExpand()
}

function updateFilteredList() {
  // 只取明细物料
  let items = allList.value.filter(i => i.is_leaf === 1 || i.is_leaf === undefined)

  // 1. 左侧分类树过滤（按 activeFilter.field 分支）
  const f = activeFilter.value
  if (f.field === 'category') {
    // 物料的顶类写在 category_code、子类写在 subcategory_code；
    // 点顶类（如 C01）命中 category_code，点子类（如 C0105）命中 subcategory_code，两者任一匹配即可
    const codes = categoryDescendantCodes(f.value)
    items = items.filter(i =>
      (i.category_code && codes.has(i.category_code)) ||
      (i.subcategory_code && codes.has(i.subcategory_code))
    )
  } else if (f.field === 'category_none') {
    items = items.filter(i => !i.category_code)
  } else if (f.field === 'source') {
    items = items.filter(i => i.source_type === f.value)
  }

  // 2. 属性过滤
  if (filterType.value) {
    items = items.filter(i => i.item_type === filterType.value)
  }

  // 2.5 来源过滤（工具栏「来源」下拉，独立于左侧分组树）
  if (sourceType.value) {
    items = items.filter(i => i.source_type === sourceType.value)
  }

  // 2.6 仅看有库存（按全仓合计判断 _stock_total，而非本仓库存——避免当前仓库无货但其他仓有货的物料被漏掉）
  if (stockOnly.value) {
    items = items.filter(i => (Number(i._stock_total) || 0) > 0)
  }

  // 3. 关键字过滤
  if (keyword.value.trim()) {
    const kw = keyword.value.trim().toLowerCase()
    items = items.filter(i =>
      (i.code && i.code.toLowerCase().includes(kw)) ||
      (i.name && i.name.toLowerCase().includes(kw)) ||
      (i.spec && i.spec.toLowerCase().includes(kw))
    )
  }

  filteredList.value = items
  total.value = items.length

  const maxPage = Math.ceil(total.value / pageSize.value) || 1
  if (page.value > maxPage) {
    page.value = maxPage
  }

  paginate()
}

function paginate() {
  const start = (page.value - 1) * pageSize.value
  const end = page.value * pageSize.value
  list.value = filteredList.value.slice(start, end)
}

// 监听过滤条件，当改变时回到第一页并重新过滤
watch([keyword, filterType, sourceType, stockOnly, activeFilter, pageSize], () => {
  page.value = 1
  updateFilteredList()
}, { deep: true })

// 监听页码改变，仅做切片
watch(page, () => {
  paginate()
})
</script>

<style>
/* 全局样式（非 scoped）：让 fullscreen 对话框自身用 flex 纵向布局且禁止滚动，
   避免内容超高时整个对话框（含顶部工具栏）被鼠标滚轮带出可视区。 */
.item-batch-picker-dialog.el-dialog.is-fullscreen {
  display: flex;
  flex-direction: column;
  overflow: hidden !important;
}
.item-batch-picker-dialog .el-dialog__header {
  flex-shrink: 0;
}
.item-batch-picker-dialog .el-dialog__body {
  padding: 0 !important;
  flex: 1;
  min-height: 0; /* flex 子项允许收缩，内部表格区域自行滚动 */
  display: flex;
  flex-direction: column;
  overflow: hidden !important;
}
</style>

<style scoped>
/* 工具栏 */
.ibp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
  flex-shrink: 0;
  gap: 12px;
  flex-wrap: wrap;
}
.ibp-toolbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ibp-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ibp-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.ibp-stock-ok { color: var(--el-color-success); }
.ibp-stock-none { color: var(--el-text-color-placeholder); }

/* 底部操作条 */
.ibp-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.ibp-footer__info {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.ibp-footer__count {
  color: var(--el-color-primary);
  font-size: 15px;
  margin: 0 2px;
}
.ibp-footer__placeholder {
  color: var(--el-text-color-placeholder);
}
.ibp-footer__actions {
  display: flex;
  gap: 10px;
}

/* 主体布局 */
.ibp-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧分类 */
.ibp-sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ibp-sidebar__head {
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.ibp-group-switch {
  width: 100%;
}
.ibp-group-switch :deep(.el-radio-button) {
  flex: 1;
}
.ibp-group-switch :deep(.el-radio-button__inner) {
  width: 100%;
  padding-left: 0;
  padding-right: 0;
}
.ibp-tree-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.ibp-tree-tools .el-button {
  margin-left: 0;
  padding: 2px 4px;
  font-size: 12px;
}
.ibp-tree {
  background: transparent;
  padding: 4px 4px 12px;
}
/* 强制 tree 节点内容横向排列（三角图标 + 编码 + 名称 同一行）。
   EP 默认 display:flex 在某些全局样式覆盖下会退化为 block，导致图标和文字纵向堆叠。 */
.ibp-tree :deep(.el-tree-node__content) {
  display: flex;
  align-items: center;
}
.ibp-tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
/* 当前选中目录高亮（EP 的 highlight-current 在初始未 setCurrentKey 时不亮，
   这里强化选中态视觉：左侧蓝色竖条 + 浅色背景 + 加粗） */
.ibp-tree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background-color: var(--el-color-primary-light-9) !important;
  border-left: 3px solid var(--el-color-primary);
  font-weight: 600;
  color: var(--el-color-primary);
}
.ibp-tree :deep(.el-tree-node.is-current > .el-tree-node__content .ibp-tree-code),
.ibp-tree :deep(.el-tree-node.is-current > .el-tree-node__content .ibp-tree-label) {
  color: var(--el-color-primary);
}
.ibp-tree-code {
  font-family: monospace;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.ibp-tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 右侧主体 */
.ibp-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ibp-table {
  flex: 1;
}

/* 表格行双击视觉提示 */
.ibp-table :deep(.el-table__row) {
  cursor: pointer;
}

/* 分页 */
.ibp-pagination {
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color-light);
  display: flex;
  justify-content: flex-end;
  background: var(--el-bg-color);
  flex-shrink: 0;
}
</style>
