<template>
  <div class="page cfm-page">
    <!-- 顶部导航 -->
    <div class="cfm-header">
      <div class="cfm-header__left">
        <el-button link size="small" @click="goBack"><el-icon><ArrowLeft /></el-icon>返回</el-button>
        <span class="cfm-header__sep">/</span>
        <span class="cfm-header__title">科目现金流量项目</span>
        <el-tag v-if="userStore.accountSetName" size="small" effect="plain" style="margin-left:8px">{{ userStore.accountSetName }}</el-tag>
        <el-tag v-if="options.standardName" size="small" type="primary" effect="plain" style="margin-left:4px">当前准则：{{ options.standardName }}</el-tag>
        <el-tag v-if="unsetCount > 0" type="warning" size="small" style="margin-left:4px">本页 {{ unsetCount }} 个科目主表项目未设置</el-tag>
      </div>
      <div class="cfm-header__right">
        <el-button size="small" @click="openCopy">复制至其他账套</el-button>
        <el-button size="small" :loading="restoring" @click="handleRestore">恢复默认</el-button>
      </div>
    </div>

    <div class="cfm-body">
      <div class="cfm-hint">
        凭证里现金类科目（库存现金 / 银行存款 / 其他货币资金）收付款时，按<b>对方科目</b>在这里的设置自动归入现金流量表项目，录凭证不用再选现金流量。
        「科目发生额在贷方」对应现金流入，「在借方」对应现金流出<template v-if="options.hasSupplement">；附表项目用于补充资料（间接法）</template><template v-else>；{{ options.standardName }}的现金流量表只有直接法主表，不设附表项目</template>。改动即时保存。
      </div>

      <div class="cfm-toolbar">
        <el-radio-group v-model="tab" size="small" @change="loadRows">
          <el-radio-button v-for="t in tabs" :key="t.key" :value="t.key">{{ t.label }}</el-radio-button>
        </el-radio-group>
        <el-input v-model="keyword" size="small" clearable placeholder="搜索编码/名称" class="cfm-search">
          <template #suffix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-checkbox v-model="expandAll" size="small">展开所有级次</el-checkbox>
        <el-checkbox v-model="hideDisabled" size="small">隐藏禁用科目</el-checkbox>
        <el-button link size="small" :loading="loading" @click="loadRows"><el-icon><Refresh /></el-icon>刷新</el-button>
      </div>

      <div class="cfm-table-wrap" v-loading="loading">
        <el-table
          :key="tableKey"
          :data="treeRows"
          row-key="account_id"
          border
          size="small"
          height="100%"
          :default-expand-all="expandAll || !!keyword.trim()"
          :tree-props="{ children: 'children' }"
          :row-class-name="rowClass"
        >
          <el-table-column label="科目编码" min-width="130">
            <template #default="{ row }">{{ formatCode(row.code) }}</template>
          </el-table-column>
          <el-table-column label="科目名称" min-width="190" show-overflow-tooltip>
            <template #default="{ row }">
              <span :class="{ 'cfm-top': row.level === 1 }">{{ row.name }}</span>
              <el-tag v-if="!row.is_enabled" size="small" type="info" effect="plain" class="cfm-tag">禁用</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="category_label" label="科目类别" width="100" />
          <el-table-column label="科目方向" width="76" align="center">
            <template #default="{ row }">{{ row.direction === 'credit' ? '贷' : '借' }}</template>
          </el-table-column>
          <el-table-column label="现金流量主表项目" align="center">
            <el-table-column label="科目发生额在贷方（现金流入）" min-width="230">
              <template #default="{ row }">
                <span v-if="row.is_cash_equivalent" class="cfm-cash">现金及现金等价物</span>
                <CellPicker
                  v-else
                  :value="row.main_credit_code"
                  :label="mainLabel(row.main_credit_code)"
                  :active="isEditing(row, 'main_credit_code')"
                  @activate="startEdit(row, 'main_credit_code')"
                >
                  <el-select
                    :model-value="row.main_credit_code"
                    size="small"
                    filterable
                    clearable
                    placeholder="请选择"
                    class="cfm-select"
                    @change="(v: string | null) => handleChange(row, 'main_credit_code', v)"
                    @visible-change="(v: boolean) => !v && stopEdit()"
                  >
                    <el-option-group v-for="g in mainGroups" :key="g.label" :label="g.label">
                      <el-option v-for="o in g.options" :key="o.code" :label="o.name" :value="o.code" />
                    </el-option-group>
                  </el-select>
                </CellPicker>
              </template>
            </el-table-column>
            <el-table-column label="科目发生额在借方（现金流出）" min-width="230">
              <template #default="{ row }">
                <CellPicker
                  v-if="!row.is_cash_equivalent"
                  :value="row.main_debit_code"
                  :label="mainLabel(row.main_debit_code)"
                  :active="isEditing(row, 'main_debit_code')"
                  @activate="startEdit(row, 'main_debit_code')"
                >
                  <el-select
                    :model-value="row.main_debit_code"
                    size="small"
                    filterable
                    clearable
                    placeholder="请选择"
                    class="cfm-select"
                    @change="(v: string | null) => handleChange(row, 'main_debit_code', v)"
                    @visible-change="(v: boolean) => !v && stopEdit()"
                  >
                    <el-option-group v-for="g in mainGroups" :key="g.label" :label="g.label">
                      <el-option v-for="o in g.options" :key="o.code" :label="o.name" :value="o.code" />
                    </el-option-group>
                  </el-select>
                </CellPicker>
              </template>
            </el-table-column>
          </el-table-column>
          <el-table-column v-if="options.hasSupplement" label="现金流量附表项目" align="center">
            <el-table-column
              v-for="col in suppColumns"
              :key="col.key"
              :label="col.label"
              min-width="230"
            >
              <template #default="{ row }">
                <CellPicker
                  v-if="!row.is_cash_equivalent"
                  :value="row[col.key]"
                  :label="suppLabel(row[col.key])"
                  :active="isEditing(row, col.key)"
                  @activate="startEdit(row, col.key)"
                >
                  <el-select
                    :model-value="row[col.key]"
                    size="small"
                    filterable
                    clearable
                    placeholder="不调节"
                    class="cfm-select"
                    @change="(v: string | null) => handleChange(row, col.key, v)"
                    @visible-change="(v: boolean) => !v && stopEdit()"
                  >
                    <el-option v-for="o in options.supplement" :key="o.code" :label="o.name" :value="o.code" />
                  </el-select>
                </CellPicker>
              </template>
            </el-table-column>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 复制至其他账套（轻量选择器） -->
    <el-dialog v-model="copyVisible" title="复制至其他账套" width="460px">
      <div class="cfm-copy-tip">按<b>科目编码</b>对应目标账套科目，覆盖其全部科目现金流量项目设置；目标账套没有的科目跳过。</div>
      <el-empty v-if="!copyTargets.length" description="没有可复制的账套（需在目标账套有同名账号且有「现金项目维护」权限）" :image-size="60" />
      <el-checkbox-group v-else v-model="copySelected" class="cfm-copy-list">
        <el-checkbox v-for="t in copyTargets" :key="t.id" :value="t.id">{{ t.code ? `${t.code} ` : '' }}{{ t.name }}</el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="copyVisible = false">取消</el-button>
        <el-button type="primary" :loading="copying" :disabled="!copySelected.length" @click="handleCopy">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh, Search, ArrowDown } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import {
  cashFlowAccountMapApi,
  type CashFlowAccountTab,
  type CashFlowMapCodes,
  type CashFlowMapOptions,
  type CashFlowMapRow,
} from '@/api/cashFlowAccountMap'

type CodeKey = keyof CashFlowMapCodes
type TreeRow = CashFlowMapRow & { children?: TreeRow[] }

/** 单元格：平时只显示文字，点击才换成下拉框（几百行 × 4 个下拉框一次性渲染会很卡） */
const CellPicker = defineComponent({
  props: { value: { type: String, default: null }, label: { type: String, default: '' }, active: Boolean },
  emits: ['activate'],
  setup(props, { slots, emit }) {
    const box = ref<HTMLElement | null>(null)
    // 换成下拉框后自动聚焦并展开
    watch(
      () => props.active,
      async active => {
        if (!active) return
        await nextTick()
        // 点一下选择框外壳：聚焦并展开下拉（不用 automatic-dropdown，聚焦展开与点击切换会互相抵消）
        const wrapper = box.value?.querySelector('.el-select__wrapper') as HTMLElement | null
        wrapper?.click()
      }
    )
    return () =>
      props.active
        ? h('div', { ref: box, class: 'cfm-cell-edit' }, slots.default?.())
        : h(
            'div',
            { class: ['cfm-cell', { 'is-empty': !props.value }], title: props.label, onClick: () => emit('activate') },
            [h('span', { class: 'cfm-cell__text' }, props.value ? props.label : '未设置'), h(ArrowDown, { class: 'cfm-cell__arrow' })]
          )
  },
})

const router = useRouter()
const userStore = useUserStore()

const tabs = ref<Array<{ key: CashFlowAccountTab; label: string }>>([
  { key: 'asset', label: '资产' },
  { key: 'liability', label: '负债' },
  { key: 'common', label: '共同' },
  { key: 'equity', label: '权益' },
  { key: 'cost', label: '成本' },
  { key: 'pl', label: '损益' },
])
const tab = ref<CashFlowAccountTab>('asset')
const keyword = ref('')
const expandAll = ref(true)
const hideDisabled = ref(false)
const loading = ref(false)
const restoring = ref(false)
const rows = ref<CashFlowMapRow[]>([])
const options = reactive<CashFlowMapOptions>({ tabs: [], main: [], supplement: [], hasSupplement: true })
const editing = ref<{ id: string; key: CodeKey } | null>(null)

const suppColumns: Array<{ key: CodeKey; label: string }> = [
  { key: 'supp_credit_code', label: '科目发生额在贷方' },
  { key: 'supp_debit_code', label: '科目发生额在借方' },
]

const mainNameByCode = computed(() => new Map(options.main.map(o => [o.code, o.name])))
const suppNameByCode = computed(() => new Map(options.supplement.map(o => [o.code, o.name])))
const mainGroups = computed(() => {
  const groups = new Map<string, Array<{ code: string; name: string }>>()
  for (const o of options.main) {
    const list = groups.get(o.group) || []
    list.push(o)
    groups.set(o.group, list)
  }
  // 「其他」（现金内部流转、汇率影响等中性项目）放最后
  return [...groups.entries()]
    .sort((a, b) => Number(a[0] === '其他') - Number(b[0] === '其他'))
    .map(([label, opts]) => ({ label, options: opts }))
})

function mainLabel(code: string | null) {
  return code ? mainNameByCode.value.get(code) || `${code}（已停用）` : ''
}
function suppLabel(code: string | null) {
  return code ? suppNameByCode.value.get(code) || `${code}（已停用）` : ''
}

/** 编码按级次加空格显示：100201 → 1002 01 */
function formatCode(code: string) {
  if (!/^\d+$/.test(code) || code.length <= 4) return code
  const parts = [code.slice(0, 4)]
  for (let i = 4; i < code.length; i += 2) parts.push(code.slice(i, i + 2))
  return parts.join(' ')
}

const visibleRows = computed(() => {
  let list = rows.value
  if (hideDisabled.value) list = list.filter(r => r.is_enabled)
  const kw = keyword.value.trim()
  if (kw) list = list.filter(r => r.code.includes(kw) || r.name.includes(kw))
  return list
})

const tableKey = computed(() => `${tab.value}|${expandAll.value}|${keyword.value.trim() ? 1 : 0}`)

const treeRows = computed<TreeRow[]>(() => {
  const list = visibleRows.value.map(r => ({ ...r })) as TreeRow[]
  if (keyword.value.trim()) return list // 搜索时平铺
  const byId = new Map(list.map(r => [r.account_id, r]))
  const roots: TreeRow[] = []
  for (const r of list) {
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined
    if (parent) (parent.children ||= []).push(r)
    else roots.push(r)
  }
  return roots
})

const unsetCount = computed(
  () => rows.value.filter(r => !r.is_cash_equivalent && r.is_enabled && (!r.main_credit_code || !r.main_debit_code)).length
)

function rowClass({ row }: { row: CashFlowMapRow }) {
  return row.is_enabled ? '' : 'cfm-row-disabled'
}

function isEditing(row: CashFlowMapRow, key: CodeKey) {
  return editing.value?.id === row.account_id && editing.value.key === key
}
function startEdit(row: CashFlowMapRow, key: CodeKey) {
  editing.value = { id: row.account_id, key }
}
function stopEdit() {
  // 下拉收起后延迟退出编辑，避免 change 事件还没处理完单元格就被卸载
  setTimeout(() => (editing.value = null), 120)
}

async function loadOptions() {
  const r = await cashFlowAccountMapApi.options()
  options.main = r.data.main
  options.supplement = r.data.supplement
  options.standardName = r.data.standardName
  options.hasSupplement = r.data.hasSupplement !== false
  if (r.data.tabs?.length) {
    tabs.value = r.data.tabs
    if (!tabs.value.some(t => t.key === tab.value)) tab.value = tabs.value[0].key
  }
}

async function loadRows() {
  loading.value = true
  editing.value = null
  try {
    const r = await cashFlowAccountMapApi.list(tab.value)
    rows.value = r.data.rows
    if (r.data.seeded) ElMessage.success('已按科目名称预设现金流量项目，请核对')
  } finally {
    loading.value = false
  }
}

async function handleChange(row: CashFlowMapRow, key: CodeKey, value: string | null | undefined) {
  const next = value || null
  if (next === row[key]) return
  let applyToChildren = false
  if (row.has_children) {
    try {
      await ElMessageBox.confirm(`「${row.name}」有下级科目，是否把下级科目的现金流量项目一并改成与它相同？`, '同步下级', {
        confirmButtonText: '同时修改下级',
        cancelButtonText: '仅本科目',
        distinguishCancelAndClose: true,
        type: 'info',
      })
      applyToChildren = true
    } catch (action) {
      if (action !== 'cancel') return // 关闭 = 放弃修改
    }
  }
  const prev = row[key]
  // 树形行是 rows 的副本，两边一起改，避免重新计算树时丢失
  const source = rows.value.find(r => r.account_id === row.account_id)
  const setCode = (v: string | null) => {
    row[key] = v
    if (source) source[key] = v
  }
  setCode(next)
  try {
    // 把当前行完整的 4 个编码一起提交：同步下级时下级拿到的是整行设置
    await cashFlowAccountMapApi.update(row.account_id, {
      main_credit_code: row.main_credit_code,
      main_debit_code: row.main_debit_code,
      supp_credit_code: row.supp_credit_code,
      supp_debit_code: row.supp_debit_code,
      applyToChildren,
    })
    if (applyToChildren) await loadRows()
  } catch {
    setCode(prev)
  }
}

async function handleRestore() {
  const label = tabs.value.find(t => t.key === tab.value)?.label || ''
  let scope: CashFlowAccountTab | undefined = tab.value
  try {
    await ElMessageBox.confirm(`按系统默认规则重新设置科目现金流量项目，会覆盖已修改的内容。`, '恢复默认', {
      confirmButtonText: `仅恢复「${label}」类`,
      cancelButtonText: '恢复全部类别',
      distinguishCancelAndClose: true,
      type: 'warning',
    })
  } catch (action) {
    if (action !== 'cancel') return
    scope = undefined
  }
  restoring.value = true
  try {
    const r = await cashFlowAccountMapApi.restoreDefault(scope)
    ElMessage.success(`已恢复默认 ${r.data.written} 个科目`)
    await loadRows()
  } finally {
    restoring.value = false
  }
}

// ── 复制至其他账套 ──
const copyVisible = ref(false)
const copying = ref(false)
const copyTargets = ref<Array<{ id: string; name: string; code: string | null }>>([])
const copySelected = ref<string[]>([])

async function openCopy() {
  copySelected.value = []
  const r = await cashFlowAccountMapApi.copyTargets()
  copyTargets.value = r.data
  copyVisible.value = true
}

async function handleCopy() {
  try {
    await ElMessageBox.confirm(`将覆盖所选 ${copySelected.value.length} 个账套的科目现金流量项目设置，确定复制？`, '复制至其他账套', {
      type: 'warning',
    })
  } catch {
    return
  }
  copying.value = true
  try {
    const r = await cashFlowAccountMapApi.copy(copySelected.value)
    const lines = r.data.map(
      x => `${x.accountSetName}：复制 ${x.copied} 个科目${x.skippedAccounts ? `，跳过 ${x.skippedAccounts} 个（目标账套无此科目或为现金科目）` : ''}${x.skippedItems ? `，${x.skippedItems} 处项目对应不上已留空` : ''}`
    )
    copyVisible.value = false
    await ElMessageBox.alert(lines.join('\n'), '复制完成', { customClass: 'cfm-pre-msg' })
  } finally {
    copying.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

onMounted(async () => {
  await loadOptions()
  await loadRows()
})
</script>

<style scoped>
.cfm-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
.cfm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px;
}
.cfm-header__left { display: flex; align-items: center; flex-wrap: wrap; }
.cfm-header__sep { margin: 0 8px; color: var(--el-text-color-placeholder); }
.cfm-header__title { font-size: var(--cw-text-lg); font-weight: 600; }
.cfm-header__right { display: flex; align-items: center; gap: 8px; }

.cfm-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 16px 12px; gap: 10px; }
.cfm-hint { font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
.cfm-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cfm-search { width: 200px; }
.cfm-table-wrap { flex: 1; min-height: 0; }

.cfm-top { font-weight: 600; }
.cfm-tag { margin-left: 6px; }
.cfm-cash { color: var(--el-text-color-placeholder); }
.cfm-select { width: 100%; }

:deep(.cfm-cell) {
  display: flex; align-items: center; justify-content: space-between; gap: 4px;
  height: 24px; padding: 0 8px; border: 1px solid var(--el-border-color); border-radius: 4px;
  background: var(--el-fill-color-blank); cursor: pointer; min-width: 0;
}
:deep(.cfm-cell:hover) { border-color: var(--el-color-primary); }
:deep(.cfm-cell.is-empty .cfm-cell__text) { color: var(--el-text-color-placeholder); }
:deep(.cfm-cell__text) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.cfm-cell__arrow) { width: 12px; height: 12px; flex-shrink: 0; color: var(--el-text-color-placeholder); }
:deep(.cfm-row-disabled) { color: var(--el-text-color-placeholder); }

.cfm-copy-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 10px; line-height: 1.6; }
.cfm-copy-list { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow: auto; }
</style>

<style>
.cfm-pre-msg .el-message-box__message { white-space: pre-line; }
</style>
