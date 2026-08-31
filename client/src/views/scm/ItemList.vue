<template>
  <div class="page scm-item-page">

    <!-- 顶部工具栏 -->
    <div class="item-header">
      <div class="item-title">
        <h3>物料管理</h3>
        <span>{{ itemCountLabel }}</span>
      </div>
      <div class="item-toolbar">
        <!-- 筛选过滤 -->
        <el-input
          v-model="filters.keyword"
          class="item-search"
          size="small"
          clearable
          placeholder="搜索编号/名称"
          @input="onSearchInput"
          @clear="onSearchClear"
        />
        <el-select
          v-model="filters.item_type"
          class="item-filter"
          size="small"
          clearable
          placeholder="属性"
          @change="load"
        >
          <el-option v-for="(n, k) in dynamicItemTypes" :key="k" :label="n" :value="k" />
        </el-select>
        <el-select
          v-model="filters.is_leaf"
          class="item-filter"
          size="small"
          clearable
          placeholder="性质"
          @change="load"
        >
          <el-option label="明细" :value="1" />
          <el-option label="目录" :value="0" />
        </el-select>

        <!-- 一键 / 层级 展开收纳（仅树形模式有效，搜索模式禁用） -->
        <el-button-group class="level-actions">
          <el-button size="small" :disabled="hasSearch" @click="collapseAll">一键收纳</el-button>
          <el-button size="small" :disabled="hasSearch" @click="goUpLevel">层级收纳</el-button>
          <el-button size="small" :disabled="hasSearch" @click="goDownLevel">层级展开</el-button>
          <el-button size="small" :disabled="hasSearch" @click="expandAll">一键展开</el-button>
        </el-button-group>

        <!-- 新增物料（同级 / 子级） -->
        <el-dropdown @command="handleAddCommand">
          <el-button type="primary" size="small">
            新增物料<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="sibling">新增同级物料</el-dropdown-item>
              <el-dropdown-item command="child">新增子物料</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- 字段配置 -->
        <el-button size="small" plain @click="openFieldConfig">
          <el-icon><Setting /></el-icon>字段配置
        </el-button>

        <!-- 列设置（投递到顶部多标签栏右侧） -->
        <Teleport v-if="ptActive" defer to="#tabbar-actions">
          <el-button size="small" plain @click="columnDialogVisible = true"><el-icon><Setting /></el-icon>列设置</el-button>
        </Teleport>
      </div>
    </div>

    <!-- 树形模式 -->
    <el-table
      v-if="!hasSearch"
      ref="tableRef"
      :data="treeData"
      v-loading="loading"
      row-key="id"
      :tree-props="{ children: 'children', hasChildren: 'hasChildren' }"
      :expand-row-keys="expandedKeys"
      border stripe size="small"
      highlight-current-row
      height="100%"
      :row-style="{ height: '30px' }"
      :cell-style="{ padding: '0' }"
      :header-cell-style="{ padding: '4px 0' }"
      class="item-table"
      @expand-change="handleExpandChange"
      @current-change="handleCurrentChange"
      @row-dblclick="(row: any) => openEdit(row)"
      @header-dragend="onDragEnd"
    >
      <el-table-column
        v-for="column in orderedVisibleColumns"
        :key="column.key"
        :column-key="column.key"
        :label="column.label"
        :prop="itemColumnProp(column.key)"
        :width="itemColumnWidth(column.key)"
        :align="itemColumnAlign(column.key)"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="column.key === 'code'" :style="treeIndent(row)" class="item-code">{{ row.code }}</span>
          <span v-else-if="column.key === 'name'" :style="treeIndent(row)" class="item-name">{{ row.name }}</span>
          <el-tag v-else-if="column.key === 'is_leaf'" :type="row.is_leaf !== 0 ? undefined : 'info'" size="small" effect="plain">{{ row.is_leaf !== 0 ? '明细' : '目录' }}</el-tag>
          <span v-else-if="column.key === 'is_asset' && row.is_asset" class="mini-flag">资</span>
          <template v-else>{{ itemColumnText(row, column.key) }}</template>
        </template>
      </el-table-column>

      <el-table-column label="操作" column-key="actions" :width="colWidth('actions', 100)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 搜索模式：扁平列表 -->
    <el-table
      v-else
      ref="tableRef"
      :data="list"
      v-loading="loading"
      border stripe size="small"
      highlight-current-row
      height="100%"
      :row-style="{ height: '30px' }"
      :cell-style="{ padding: '0' }"
      :header-cell-style="{ padding: '4px 0' }"
      class="item-table"
      @current-change="handleCurrentChange"
      @row-dblclick="(row: any) => openEdit(row)"
      @header-dragend="onDragEnd"
    >
      <el-table-column
        v-for="column in orderedVisibleColumns"
        :key="column.key"
        :column-key="column.key"
        :label="column.label"
        :prop="itemColumnProp(column.key)"
        :width="itemColumnWidth(column.key)"
        :align="itemColumnAlign(column.key)"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="column.key === 'code'" class="item-code">{{ row.code }}</span>
          <span v-else-if="column.key === 'name'" class="item-name">{{ row.name }}</span>
          <el-tag v-else-if="column.key === 'is_leaf'" :type="row.is_leaf !== 0 ? undefined : 'info'" size="small" effect="plain">{{ row.is_leaf !== 0 ? '明细' : '目录' }}</el-tag>
          <span v-else-if="column.key === 'is_asset' && row.is_asset" class="mini-flag">资</span>
          <template v-else>{{ itemColumnText(row, column.key) }}</template>
        </template>
      </el-table-column>

      <el-table-column label="操作" column-key="actions" :width="colWidth('actions', 100)" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <ColumnSettingsDialog v-model="columnDialogVisible" :columns="columnSettings" @update:columns="updateColumns" @reset="resetColumns" />

    <!-- 字段配置弹窗 -->
    <el-dialog v-model="fieldConfigVisible" title="物料自定义字段配置" width="680px" draggable>
      <el-table :data="fieldDefsEdit" border size="small" style="width:100%">
        <el-table-column label="字段编码" width="150">
          <template #default="{ row }">
            <el-input
              v-model="row.field_key"
              :disabled="!!row._persisted"
              placeholder="自动生成"
              size="small"
            />
          </template>
        </el-table-column>
        <el-table-column label="字段名称" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.field_name" placeholder="如：产地" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-select v-model="row.field_type" size="small" style="width:100%">
              <el-option label="文本" value="text" />
              <el-option label="数字" value="number" />
              <el-option label="日期" value="date" />
              <el-option label="下拉" value="select" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="下拉选项" min-width="140">
          <template #default="{ row }">
            <el-input
              v-if="row.field_type === 'select'"
              v-model="row.options_text"
              placeholder="选项用逗号分隔"
              size="small"
            />
            <span v-else style="color:var(--el-text-color-placeholder);font-size:12px">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="60" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="fieldDefsEdit.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button style="margin-top:8px" size="small" @click="addFieldDef">+ 添加字段</el-button>
      <template #footer>
        <el-button @click="fieldConfigVisible = false">取消</el-button>
        <el-button type="primary" :loading="fieldConfigSaving" @click="saveFieldDefs">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onActivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Setting } from '@element-plus/icons-vue'
import { scmApi, ITEM_TYPES, type ScmItem, type ScmItemFieldDef } from '@/api/scm'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import { usePageToolbarTeleport } from '@/composables/usePageToolbarTeleport'
import ColumnSettingsDialog from '@/components/common/ColumnSettingsDialog.vue'
import { loadColumnSettings, mergeColumnSettings, saveColumnSettings, serializeColumnSettings, type ColumnSetting } from '@/utils/columnSettings'

const { ptActive } = usePageToolbarTeleport()
const router = useRouter()

// ── 数据 ──────────────────────────────────────────────────────────────────
const allList = ref<ScmItem[]>([])
const list = ref<ScmItem[]>([])
const total = ref(0)
const loading = ref(false)
const filters = reactive<{ keyword: string; item_type: string; is_leaf: number | '' }>({
  keyword: '',
  item_type: '',
  is_leaf: '',
})

// ── 查询条件记忆：下次打开还原上次的筛选（关键字/属性/性质）──
const STORAGE_KEY_FILTERS = 'scm_item_filters'
function loadFilters() {
  try {
    const o = JSON.parse(localStorage.getItem(STORAGE_KEY_FILTERS) || 'null')
    if (!o || typeof o !== 'object') return
    if (typeof o.keyword === 'string') filters.keyword = o.keyword
    if (typeof o.item_type === 'string') filters.item_type = o.item_type
    if (o.is_leaf === 0 || o.is_leaf === 1 || o.is_leaf === '') filters.is_leaf = o.is_leaf
  } catch { /* ignore */ }
}
function saveFilters() {
  try {
    localStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify({
      keyword: filters.keyword, item_type: filters.item_type, is_leaf: filters.is_leaf,
    }))
  } catch { /* localStorage 不可用时忽略 */ }
}
watch(filters, saveFilters, { deep: true })
const customItemTypes = ref<Record<string, string>>({})
const dynamicItemTypes = computed(() => ({ ...ITEM_TYPES, ...customItemTypes.value }))
const currentRow = ref<ScmItem | null>(null)
const { tableRef, onDragEnd, colWidth } = useListColumnWidth('scm_item')

const hasSearch = computed(() => !!(filters.keyword || filters.item_type || filters.is_leaf !== ''))

// activeFieldDefs：页面显示用（is_enabled=1 的字段）
// 必须在 allColumnSettings 计算属性与 immediate watch 之前声明，否则存在 TDZ
const activeFieldDefs = ref<ScmItemFieldDef[]>([])

// ── 列配置 ────────────────────────────────────────────────────────────────
const STORAGE_KEY_COLS = 'scm_item_columns_visible'
const standardCols: ColumnSetting[] = [
  { key: 'code', label: '编号', visible: true, required: true },
  { key: 'name', label: '名称', visible: true, required: true },
  { key: 'spec', label: '规格', visible: true },
  { key: 'unit', label: '单位', visible: true },
  { key: 'item_type', label: '属性', visible: true },
  { key: 'is_leaf', label: '性质', visible: true },
  { key: 'purchase_price', label: '进价', visible: true },
  { key: 'sale_price', label: '售价', visible: true },
  { key: 'barcode', label: '条码', visible: false },
  { key: 'short_code', label: '简码', visible: false },
  { key: 'is_asset', label: '资产', visible: true },
  { key: 'remark', label: '备注', visible: false },
]

// 动态列：标准列 + 启用的自定义字段
const allColumnSettings = computed(() => {
  const res = standardCols.map(column => ({ ...column }))
  activeFieldDefs.value.forEach(f => {
    res.push({ key: `field_${f.field_key}`, label: f.field_name, visible: true, group: '自定义字段' })
  })
  return res
})
const columnDialogVisible = ref(false)
const columnSettings = ref<ColumnSetting[]>([])
const orderedVisibleColumns = computed(() => columnSettings.value.filter(column => column.visible))
watch(allColumnSettings, defaults => {
  columnSettings.value = columnSettings.value.length
    ? mergeColumnSettings(defaults, serializeColumnSettings(columnSettings.value))
    : loadColumnSettings(STORAGE_KEY_COLS, defaults)
}, { immediate: true })
function updateColumns(columns: ColumnSetting[]) {
  columnSettings.value = columns
  saveColumnSettings(STORAGE_KEY_COLS, columns)
}
function resetColumns() { updateColumns(allColumnSettings.value.map(column => ({ ...column }))) }

const ITEM_COLUMN_WIDTHS: Record<string, number> = { code: 140, name: 180, spec: 110, unit: 70, item_type: 90, is_leaf: 68, purchase_price: 90, sale_price: 90, barcode: 120, short_code: 100, is_asset: 52, remark: 150 }
function itemColumnWidth(key: string) { return colWidth(key, ITEM_COLUMN_WIDTHS[key] || 100) }
function itemColumnAlign(key: string) { return ['purchase_price', 'sale_price'].includes(key) ? 'right' : ['is_leaf', 'is_asset'].includes(key) ? 'center' : undefined }
function itemColumnProp(key: string) { return key.startsWith('field_') ? `field_values.${key.slice(6)}` : key }
function itemColumnText(row: any, key: string) {
  if (key === 'unit') return row.unit_name || row.unit
  if (key === 'item_type') return dynamicItemTypes.value[row.item_type] || row.item_type
  if (key.startsWith('field_')) return (row.field_values || {})[key.slice(6)]
  return row[key]
}
function treeIndent(row: any) { return { paddingLeft: `${((row.level || 1) - 1) * 14}px`, display: 'inline-block' } }

// ── 参数（属性下拉用） ─────────────────────────────────────────────────────
async function loadParams() {
  try {
    const r = await scmApi.getParams()
    for (const p of r.data as any[]) {
      if (p.param_key === 'scm:item_types') {
        try { customItemTypes.value = JSON.parse(p.param_value) } catch {}
      }
    }
  } catch {}
}

// ── 查询 ──────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    if (hasSearch.value) {
      const params: any = { page: 1, page_size: 200 }
      if (filters.keyword) params.keyword = filters.keyword
      if (filters.item_type) params.item_type = filters.item_type
      const res = await scmApi.getItems(params)
      if (res.code === 0) {
        let rows: ScmItem[] = (res.data as any).list
        if (filters.is_leaf !== '') rows = rows.filter(r => (r.is_leaf ?? 1) === filters.is_leaf)
        list.value = rows
        total.value = rows.length
      }
    } else {
      const res = await (scmApi.getItems as any)({ all: '1' })
      if (res.code === 0) {
        allList.value = (res.data as any).list
        total.value = allList.value.length
      }
    }
  } finally { loading.value = false }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
}
function onSearchClear() {
  filters.keyword = ''
  load()
}

// ── 树构建 ────────────────────────────────────────────────────────────────
const treeData = computed(() => buildTree(filteredAllList.value))

const filteredAllList = computed(() => {
  if (filters.is_leaf === '') return allList.value
  return filterWithAncestors(allList.value, r => (r.is_leaf ?? 1) === filters.is_leaf)
})

function filterWithAncestors(items: ScmItem[], predicate: (r: ScmItem) => boolean): ScmItem[] {
  const matched = new Set<string>()
  for (const item of items) {
    if (predicate(item)) matched.add(String(item.id))
  }
  // 保留祖先路径
  const idMap = new Map(items.map(i => [String(i.id), i]))
  const result = new Set<string>(matched)
  for (const id of matched) {
    let cur = idMap.get(id)
    while (cur && (cur as any).parent_id) {
      result.add(String((cur as any).parent_id))
      cur = idMap.get(String((cur as any).parent_id))
    }
  }
  return items.filter(i => result.has(String(i.id)))
}

function buildTree(items: any[]): any[] {
  const map = new Map<string, any>()
  for (const item of items) map.set(item.id, { ...item, children: [] })
  const roots: any[] = []
  for (const item of items) {
    const node = map.get(item.id)!
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// ── 计数标签 ─────────────────────────────────────────────────────────────
const itemCountLabel = computed(() => {
  const t = total.value
  if (!hasSearch.value) return `${t} 个物料`
  return `${t} / ${allList.value.length} 个物料`
})

// ── 展开/折叠 ─────────────────────────────────────────────────────────────
const expandedSet = ref<Set<string>>(new Set())
const expandedKeys = computed(() => [...expandedSet.value])

function handleExpandChange(row: any, expanded: boolean) {
  const s = new Set(expandedSet.value)
  if (expanded) s.add(row.id); else s.delete(row.id)
  expandedSet.value = s
}

function handleCurrentChange(row: any) {
  currentRow.value = row || null
}

function collapseAll() { expandedSet.value = new Set() }

function expandAll() {
  const s = new Set<string>()
  function walk(nodes: any[]) {
    for (const n of nodes) { if (n.children?.length) { s.add(n.id); walk(n.children) } }
  }
  walk(treeData.value)
  expandedSet.value = s
}

function goUpLevel() {
  if (expandedSet.value.size === 0) return
  const nodes = flattenTree(treeData.value)
  const maxDepth = nodes.filter(n => expandedSet.value.has(n.id)).reduce((m, n) => Math.max(m, n.level || 1), 0)
  const s = new Set(expandedSet.value)
  for (const n of nodes) { if ((n.level || 1) === maxDepth) s.delete(n.id) }
  expandedSet.value = s
}

function goDownLevel() {
  if (expandedSet.value.size === 0) {
    const s = new Set<string>()
    for (const n of treeData.value) { if (n.children?.length) s.add(n.id) }
    expandedSet.value = s
    return
  }
  const nodes = flattenTree(treeData.value)
  const maxDepth = nodes.filter(n => expandedSet.value.has(n.id)).reduce((m, n) => Math.max(m, n.level || 1), 0)
  const s = new Set(expandedSet.value)
  for (const n of nodes) {
    if (expandedSet.value.has(n.id) && n.children?.length) {
      for (const c of n.children) { if (c.children?.length) s.add(c.id) }
    } else if (!expandedSet.value.has(n.id) && (n.level || 1) === maxDepth && n.children?.length) {
      s.add(n.id)
    }
  }
  expandedSet.value = s
}

function flattenTree(nodes: any[]): any[] {
  const res: any[] = []
  function walk(ns: any[]) { for (const n of ns) { res.push(n); if (n.children) walk(n.children) } }
  walk(nodes)
  return res
}

// ── 新增 / 编辑（全页面） ─────────────────────────────────────────────────
type AddCommand = 'sibling' | 'child'

function handleAddCommand(command: AddCommand) {
  if (command === 'child') {
    if (!currentRow.value) return ElMessage.warning('请先选中一行物料，再增加子物料')
    router.push({ path: '/scm/items/new', query: { parent_id: (currentRow.value as any).id } })
  } else {
    // 同级：以当前选中行的父级为上级
    const parentId = currentRow.value ? ((currentRow.value as any).parent_id || '') : ''
    router.push({ path: '/scm/items/new', query: parentId ? { parent_id: parentId } : {} })
  }
}

function openEdit(row: ScmItem) {
  router.push(`/scm/items/${row.id}/edit`)
}

// ── 删除 ──────────────────────────────────────────────────────────────────
async function handleDelete(row: ScmItem) {
  await ElMessageBox.confirm(`确认删除物料「${row.name}」？`, '提示', { type: 'warning' })
  await scmApi.deleteItem(row.id)
  ElMessage.success('已删除')
  load()
}

// ── 自定义字段配置弹窗 ────────────────────────────────────────────────────
type FieldDefEdit = ScmItemFieldDef & { _persisted?: boolean; options_text?: string }
const fieldDefsEdit = ref<FieldDefEdit[]>([])
const fieldConfigVisible = ref(false)
const fieldConfigSaving = ref(false)

async function loadFieldDefs() {
  try {
    const r = await scmApi.getItemFieldDefs()
    if (r.code === 0) activeFieldDefs.value = r.data as ScmItemFieldDef[]
  } catch {}
}

function openFieldConfig() {
  // 深拷贝到编辑列表，并附加 options_text（JSON数组 → 逗号字符串）
  fieldDefsEdit.value = activeFieldDefs.value.map(f => ({
    ...f,
    _persisted: true,
    options_text: f.options_json ? (() => {
      try { return JSON.parse(f.options_json).join(',') } catch { return f.options_json }
    })() : '',
  }))
  fieldConfigVisible.value = true
}

function addFieldDef() {
  // 自动生成不重复的默认编码 field_1, field_2 ...
  const existingKeys = new Set([
    ...fieldDefsEdit.value.map(f => f.field_key),
    ...activeFieldDefs.value.map(f => f.field_key),
  ])
  let idx = fieldDefsEdit.value.length + 1
  while (existingKeys.has(`field_${idx}`)) idx++
  fieldDefsEdit.value.push({
    field_key: `field_${idx}`,
    field_name: '',
    field_type: 'text',
    options_json: undefined,
    options_text: '',
    sort_order: fieldDefsEdit.value.length,
    _persisted: false,
  })
}

async function saveFieldDefs() {
  // 基本校验
  for (const f of fieldDefsEdit.value) {
    if (!f.field_name?.trim()) return ElMessage.warning('字段名称不能为空')
    if (!f.field_key?.trim()) return ElMessage.warning('字段编码不能为空')
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(f.field_key)) {
      return ElMessage.warning(`字段编码"${f.field_key}"只能以字母开头，包含字母/数字/下划线`)
    }
  }
  // 编码唯一性
  const keys = fieldDefsEdit.value.map(f => f.field_key)
  if (new Set(keys).size !== keys.length) return ElMessage.warning('字段编码不能重复')

  const fields = fieldDefsEdit.value.map((f, i) => ({
    field_key: f.field_key.trim(),
    field_name: f.field_name.trim(),
    field_type: f.field_type,
    options_json: f.field_type === 'select' && f.options_text
      ? JSON.stringify(f.options_text.split(',').map(s => s.trim()).filter(Boolean))
      : null,
    sort_order: i,
  }))

  fieldConfigSaving.value = true
  try {
    await scmApi.saveItemFieldDefs(fields)
    ElMessage.success('字段配置已保存')
    await loadFieldDefs()
    fieldConfigVisible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    fieldConfigSaving.value = false
  }
}

// ── 初始化 ────────────────────────────────────────────────────────────────
onMounted(async () => {
  loadFilters()        // 先还原上次查询条件，再按其加载
  await loadParams()
  load()
  loadFieldDefs()
})

// 从「新增/编辑物料」全页面返回时刷新列表（keep-alive 复用，不会重跑 onMounted）
let firstActivate = true
onActivated(() => {
  if (firstActivate) { firstActivate = false; return }
  load()
})
</script>

<style scoped>
.page {
  height: calc(100vh - 60px);
  padding: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.item-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 140px;
}

.item-title h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.item-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.item-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.level-actions {
  flex-shrink: 0;
}

.item-search {
  width: 200px;
}

.item-filter {
  width: 110px;
}

.item-table {
  flex: 1;
  min-height: 0;
  border-radius: 6px;
  overflow: hidden;
}

.item-code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  color: var(--el-color-primary);
  font-weight: 600;
  line-height: 1.2;
}

.item-name {
  color: var(--el-text-color-primary);
  font-weight: 500;
  line-height: 1.2;
}

.mini-flag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 1;
}

:deep(.item-table .el-table__cell) {
  padding: 2px 0 !important;
}

:deep(.item-table th.el-table__cell) {
  padding: 5px 0 !important;
  background: var(--el-fill-color-light) !important;
  color: var(--cw-text-primary);
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

:deep(.item-table .el-table__row) {
  height: 30px;
}

:deep(.item-table .cell) {
  min-height: 24px;
  line-height: 24px;
  padding: 0 6px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:deep(.item-table .el-tag) {
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
}

:deep(.item-table .el-button--small) {
  height: 22px;
  padding: 0 4px;
}

:deep(.item-table .el-table__expand-icon) {
  width: 18px;
  height: 18px;
  margin-right: 2px;
}

@media (max-width: 1100px) {
  .item-toolbar { justify-content: flex-start; }
  .item-search { width: 160px; }
}
</style>
