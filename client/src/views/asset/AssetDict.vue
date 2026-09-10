<template>
  <div class="page page-asset-dict">
    
    <div class="dict-layout">
      <!-- 左侧分类导航 -->
      <nav class="dict-nav">
        <div class="dict-nav__title">资产档案</div>
        <button
          v-for="m in dictMenus"
          :key="m.key"
          type="button"
          class="dict-nav__item"
          :class="{ 'is-active': activeTab === m.key }"
          @click="activeTab = m.key"
        >{{ m.label }}</button>
      </nav>

      <!-- 右侧内容 -->
      <section class="dict-content">
        <DictPanel
          :title="activeLabel"
          :rows="activeRows"
          :columns="activeColumns"
          :loading="initializing"
          @add="openAdd(activeTab)"
          @edit="row => openEdit(activeTab, row)"
          @delete="row => handleDelete(activeTab, row)"
          @init="handleInit(activeTab)"
        />
      </section>
    </div>

    <!-- 通用编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editRow ? '编辑' : '新增'" width="480px" draggable>
      <div v-if="editRow && navigationInfo" style="margin-bottom: 16px; border-bottom: 1px solid var(--el-border-color-lighter); padding-bottom: 12px;">
        <DialogNavigation
          :current="navigationInfo.current"
          :total="navigationInfo.total"
          :is-first="navigationInfo.isFirst"
          :is-last="navigationInfo.isLast"
          @navigate="handleNavigate"
        />
      </div>
      <el-form :model="form" label-width="100px" size="small">
        <el-form-item label="编码" required>
          <el-input v-model="form.code" :disabled="!!editRow" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <template v-if="activeTab === 'category'">
          <el-form-item label="默认残值率(%)">
            <el-tooltip placement="right" :show-after="300" popper-class="salvage-rate-tip">
              <template #content>
                <div class="salvage-tip-content">
                  <div class="salvage-tip-title">中国各类资产通用残值率参考</div>
                  <table class="salvage-tip-table">
                    <tr><td>房屋及构筑物</td><td>5%</td></tr>
                    <tr><td>专用设备</td><td>5%</td></tr>
                    <tr><td>通用设备</td><td>5%</td></tr>
                    <tr><td>交通运输工具</td><td>5%</td></tr>
                    <tr><td>图书、档案</td><td>0%</td></tr>
                    <tr><td>家具、用具</td><td>5%</td></tr>
                    <tr><td>文物和陈列品</td><td>0~5%</td></tr>
                  </table>
                  <div class="salvage-tip-note">
                    行政事业单位实务中多取 <b>0%</b> 或 <b>5%</b>，<br>以本单位资产管理办法为准。
                  </div>
                </div>
              </template>
              <el-input-number v-model="form.salvage_rate" :precision="2" :min="0" :max="100" style="width:100%" />
            </el-tooltip>
          </el-form-item>
          <el-form-item label="资产科目">
            <AccountSelect v-model="form.account_code" placeholder="如 1601 固定资产" search-keyword="固定资产" />
          </el-form-item>
          <el-form-item label="累计折旧科目">
            <AccountSelect v-model="form.depr_account_code" placeholder="如 1602 累计折旧" search-keyword="折旧" />
          </el-form-item>
          <el-form-item label="减值准备科目">
            <AccountSelect v-model="form.impairment_account_code" placeholder="如 1603 固定资产减值准备" search-keyword="减值" />
          </el-form-item>
          <el-form-item label="资产清理科目">
            <AccountSelect v-model="form.clearing_account_code" placeholder="如 1606 固定资产清理" search-keyword="清理" />
          </el-form-item>
        </template>
        <template v-if="activeTab === 'status'">
          <el-form-item label="计提折旧">
            <el-switch v-model="form.depreciable" :active-value="1" :inactive-value="0" />
          </el-form-item>
        </template>
        <template v-if="activeTab === 'purpose'">
          <el-form-item label="折旧费用科目">
            <AccountSelect v-model="form.expense_account" placeholder="如 660201 折旧费" search-keyword="折旧" />
          </el-form-item>
        </template>
        <template v-if="activeTab === 'change_type'">
          <el-form-item label="方向" required>
            <el-select v-model="form.direction" style="width:100%">
              <el-option label="增加方式" value="increase" />
              <el-option label="减少方式" value="decrease" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, defineComponent, h } from 'vue'
import { ElMessage, ElMessageBox, ElTable, ElTableColumn, ElButton } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fixedAssetApi, type AssetDicts } from '@/api/fixedAsset'
import AccountSelect from '@/components/base/AccountSelect.vue'
import DialogNavigation from '@/components/common/DialogNavigation.vue'
import { useBaseDataStore } from '@/stores/baseData'

// 内联 DictPanel 子组件
const DictPanel = defineComponent({
  props: { rows: Array, columns: Array, title: String, loading: Boolean },
  emits: ['add', 'edit', 'delete', 'init'],
  setup(props, { emit }) {
    return () =>
      h('div', { class: 'dict-panel' }, [
        h('div', { class: 'dict-panel-toolbar' }, [
          h(ElButton, { type: 'primary', size: 'small', onClick: () => emit('add') }, () => [h(Plus), ' 新增项目']),
          h(ElButton, { 
            type: 'warning', 
            size: 'small', 
            loading: props.loading,
            onClick: () => emit('init') 
          }, () => '一键预设通用项目'),
        ]),
        h(ElTable, { data: props.rows, size: 'small', border: true, style: 'width:100%; margin-bottom: 16px;', maxHeight: 'calc(100vh - 280px)' }, {
          default: () => [
            ...(props.columns as any[]).map(col =>
              h(ElTableColumn, {
                label: col.label,
                prop: col.prop,
                width: col.width,
                align: col.align,
                formatter: col.formatter,
              })
            ),
            h(ElTableColumn, { label: '操作', width: 120, align: 'center' }, {
              default: ({ row }: any) => h('div', [
                h(ElButton, { link: true, type: 'primary', size: 'small', onClick: () => emit('edit', row) }, () => '编辑'),
                h(ElButton, { link: true, type: 'danger', size: 'small', onClick: () => emit('delete', row) }, () => '删除'),
              ]),
            }),
          ],
        }),
      ])
  },
})

const activeTab = ref('category')
const dicts = ref<AssetDicts>({ category: [], status: [], purpose: [], dept: [], change_type: [] })
const dialogVisible = ref(false)
const editRow = ref<any>(null)
const saving = ref(false)
const initializing = ref(false)
const form = ref<any>({})

/** 翻页导航信息 */
const navigationInfo = computed(() => {
  const allRows = (dicts.value as any)[activeTab.value] || []
  if (allRows.length === 0 || !editRow.value) return null
  const idx = allRows.findIndex((r: any) => r.id === editRow.value?.id)
  return {
    current: idx + 1,
    total: allRows.length,
    isFirst: idx <= 0,
    isLast: idx >= allRows.length - 1 || idx === -1
  }
})

/** 翻页处理 */
function handleNavigate(direction: 'first' | 'previous' | 'next' | 'last') {
  const allRows = (dicts.value as any)[activeTab.value] || []
  if (allRows.length === 0) return
  
  let targetIdx = 0
  const currentIdx = allRows.findIndex((r: any) => r.id === editRow.value?.id)
  
  if (direction === 'first') targetIdx = 0
  else if (direction === 'last') targetIdx = allRows.length - 1
  else if (direction === 'previous') targetIdx = Math.max(0, currentIdx - 1)
  else if (direction === 'next') targetIdx = Math.min(allRows.length - 1, currentIdx + 1)
  
  if (allRows[targetIdx]) {
    openEdit(activeTab.value, allRows[targetIdx])
  }
}

const baseDataStore = useBaseDataStore()

// 科目编码 → "编码 名称" 显示
function formatAccountCode(code: any): string {
  if (!code) return ''
  const acc = baseDataStore.accounts.find((a: any) => String(a.code) === String(code))
  return acc ? `${acc.code} ${acc.name}` : String(code)
}

const categoryColumns = computed(() => {
  // 触碰 accounts 以便加载完成后重新渲染表格
  void baseDataStore.accounts.length
  return [
    { label: '编码', prop: 'code', width: 80 },
    { label: '名称', prop: 'name', width: 120 },
    { label: '默认残值率(%)', prop: 'salvage_rate', width: 110, align: 'right' },
    { label: '资产科目', prop: 'account_code', width: 160, formatter: (r: any) => formatAccountCode(r.account_code) },
    { label: '累计折旧科目', prop: 'depr_account_code', width: 170, formatter: (r: any) => formatAccountCode(r.depr_account_code) },
    { label: '减值准备科目', prop: 'impairment_account_code', width: 180, formatter: (r: any) => formatAccountCode(r.impairment_account_code) },
    { label: '清理科目', prop: 'clearing_account_code', width: 170, formatter: (r: any) => formatAccountCode(r.clearing_account_code) },
  ]
})
const statusColumns = [
  { label: '编码', prop: 'code', width: 100 },
  { label: '名称', prop: 'name', width: 150 },
  { label: '计提折旧', prop: 'depreciable', width: 100 },
]
const purposeColumns = computed(() => {
  void baseDataStore.accounts.length
  return [
    { label: '编码', prop: 'code', width: 100 },
    { label: '名称', prop: 'name', width: 150 },
    { label: '折旧费用科目', prop: 'expense_account', width: 200, formatter: (r: any) => formatAccountCode(r.expense_account) },
  ]
})
const deptColumns = [
  { label: '编码', prop: 'code', width: 100 },
  { label: '名称', prop: 'name', width: 200 },
]
const changeTypeColumns = [
  { label: '编码', prop: 'code', width: 100 },
  { label: '名称', prop: 'name', width: 180 },
  {
    label: '方向',
    prop: 'direction',
    width: 100,
    formatter: (r: any) => (r.direction === 'decrease' ? '减少方式' : '增加方式'),
  },
]

// 左侧分类导航菜单
const dictMenus = [
  { key: 'category', label: '资产类别' },
  { key: 'status', label: '资产状态' },
  { key: 'purpose', label: '资产用途' },
  { key: 'dept', label: '使用部门' },
  { key: 'change_type', label: '增减方式' },
] as const

// 当前选中分类的标题 / 数据 / 列定义（驱动右侧内容）
const activeLabel = computed(() => dictMenus.find(m => m.key === activeTab.value)?.label || '')
const activeRows = computed(() => (dicts.value as any)[activeTab.value] || [])
const activeColumns = computed(() => {
  switch (activeTab.value) {
    case 'category': return categoryColumns.value
    case 'purpose': return purposeColumns.value
    case 'status': return statusColumns
    case 'dept': return deptColumns
    case 'change_type': return changeTypeColumns
    default: return []
  }
})

onMounted(async () => {
  void baseDataStore.loadAccounts()
  const res = await fixedAssetApi.getDicts()
  if (res.code === 0) dicts.value = res.data
})

async function reload() {
  const res = await fixedAssetApi.getDicts()
  if (res.code === 0) dicts.value = res.data
}

function generateNextCode(type: keyof AssetDicts) {
  const items = dicts.value[type] || []
  if (items.length === 0) return '01'

  let maxNum = 0
  let maxCodeLength = 2
  let prefix = ''
  let found = false

  for (const item of items) {
    const match = String(item.code || '').match(/^([a-zA-Z\-_]*)(\d+)$/)
    if (match) {
      found = true
      const num = parseInt(match[2], 10)
      if (num >= maxNum) {
        maxNum = num
        maxCodeLength = match[2].length
        prefix = match[1]
      }
    }
  }

  if (!found) return ''
  return prefix + String(maxNum + 1).padStart(maxCodeLength, '0')
}

function openAdd(type: string) {
  activeTab.value = type
  editRow.value = null
  const nextCode = generateNextCode(type as keyof AssetDicts)
  form.value = type === 'change_type' ? { code: nextCode, direction: 'increase' } : { code: nextCode, salvage_rate: 0, depreciable: 1 }
  dialogVisible.value = true
}

function openEdit(type: string, row: any) {
  activeTab.value = type
  editRow.value = row
  form.value = { ...row }
  dialogVisible.value = true
}

async function handleDelete(type: string, row: any) {
  await ElMessageBox.confirm(`确认删除「${row.name}」？`, '提示', { type: 'warning' })
  await fixedAssetApi.deleteDict(type, row.id)
  ElMessage.success('已删除')
  reload()
}

async function handleInit(type: string) {
  const titles: Record<string, string> = {
    category: '资产类别',
    status: '资产状态',
    purpose: '资产用途',
    change_type: '增减方式',
    dept: '使用部门'
  }
  try {
    await ElMessageBox.confirm(
      `确定要一键预设「${titles[type] || type}」的常规项目吗？（仅在列表为空时生效）`, 
      '提示', 
      { type: 'info', confirmButtonText: '确定预设' }
    )
    initializing.value = true
    await fixedAssetApi.initDict(type)
    ElMessage.success('初始化成功')
    reload()
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '初始化失败')
    }
  } finally {
    initializing.value = false
  }
}

async function handleSave() {
  if (!form.value.code || !form.value.name) return ElMessage.warning('编码和名称不能为空')
  saving.value = true
  try {
    if (editRow.value) {
      await fixedAssetApi.updateDict(activeTab.value, editRow.value.id, form.value)
    } else {
      await fixedAssetApi.createDict(activeTab.value, form.value)
    }
    dialogVisible.value = false
    reload()
    ElMessage.success('保存成功')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page-asset-dict { display: flex; flex-direction: column; height: 100%; }
.dict-layout { flex: 1; display: flex; min-height: 0; }
/* 左侧竖向分类导航 */
.dict-nav {
  width: 168px; flex-shrink: 0; overflow: auto; padding: 12px 8px;
  border-right: 1px solid var(--el-border-color-light); background: var(--el-bg-color);
}
.dict-nav__title { font-size: 12px; color: var(--el-text-color-secondary); padding: 4px 12px 8px; }
.dict-nav__item {
  display: block; width: 100%; text-align: left; border: none; background: transparent;
  padding: 9px 12px; margin-bottom: 2px; border-radius: 6px; font-size: var(--cw-text-base);
  color: var(--el-text-color-regular); cursor: pointer; transition: background .15s, color .15s;
}
.dict-nav__item:hover { background: var(--el-fill-color-light); }
.dict-nav__item.is-active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; }
/* 右侧内容 */
.dict-content { flex: 1; overflow: auto; padding: 16px; min-width: 0; }
.dict-panel-toolbar { margin-bottom: 8px; }
</style>

<!-- 残值率提示框样式（teleport 到 body，需用全局或 :deep 无法作用，改用 popper-class） -->
<style>
.salvage-rate-tip { max-width: 260px !important; }
.salvage-tip-content { font-size: 12px; line-height: 1.6; }
.salvage-tip-title {
  font-weight: 600;
  font-size: var(--cw-text-base);
  margin-bottom: 6px;
  color: #e6f0ff;
}
.salvage-tip-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}
.salvage-tip-table td {
  padding: 2px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.salvage-tip-table td:last-child {
  text-align: right;
  font-weight: 600;
  color: #7dd3fc;
  white-space: nowrap;
}
.salvage-tip-note {
  color: rgba(255,255,255,0.75);
  font-size: 11.5px;
  line-height: 1.5;
}
.salvage-tip-note b { color: #fde68a; }
</style>
