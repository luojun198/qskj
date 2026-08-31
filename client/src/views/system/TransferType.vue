<template>
  <div class="page transfer-page">
    <div class="page-header transfer-header">
      <div class="header-title-block">
        <h3>结转维护</h3>
        <span class="header-summary">
          <span>{{ transferTypes.length }} 类型</span>
          <span>·</span>
          <span>{{ transferItems.length }} 规则</span>
          <template v-if="selectedType"><span>·</span><span>当前：{{ selectedType.name }}</span></template>
        </span>
      </div>
      <div class="page-header-toolbar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索类型、科目、摘要"
          clearable
          size="small"
          style="width: 220px"
          prefix-icon="Search"
        />
        <el-button size="small" @click="addTransferType">
          <el-icon><Plus /></el-icon>新增类型
        </el-button>
        <el-button size="small" type="primary" @click="handleSave">保存配置</el-button>
      </div>
    </div>

    <div class="transfer-workspace">
      <aside class="type-sidebar">
        <div class="sidebar-header">
          <span>结转类型</span>
          <el-tag size="small" effect="plain">{{ filteredTypes.length }}</el-tag>
        </div>

        <el-scrollbar class="type-scroll">
          <button
            v-for="type in filteredTypes"
            :key="type.id"
            type="button"
            class="type-list-item"
            :class="{ active: selectedType?.id === type.id }"
            @click="handleTypeClick(type)"
          >
            <span class="type-code">{{ type.code }}</span>
            <span class="type-main">
              <span class="type-name-row">
                <span class="type-name" v-html="highlightTypeText(type.name)"></span>
                <span class="type-meta">
                  <span>{{ type.periodType === 'monthly' ? '月' : '年' }}</span>
                  <span>·</span>
                  <span>{{ getTypeItemCount(type.code) }}条</span>
                </span>
              </span>
              <span class="type-flow">
                {{ getTypeSourcePreview(type.code) }}
                <span class="flow-arrow">→</span>
                {{ getTypeTargetText(type.code) }}
              </span>
            </span>
            <el-button
              class="type-delete"
              size="small"
              type="danger"
              link
              @click.stop="deleteTransferType(type)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </button>

          <div v-if="filteredTypes.length === 0" class="sidebar-empty">
            没有匹配的结转类型
          </div>
        </el-scrollbar>
      </aside>

      <main class="content-section transfer-detail">
        <template v-if="selectedType">
          <div class="detail-toolbar">
            <span class="type-badge">{{ selectedType.code || '--' }}</span>
            <div class="editor-row">
              <label class="editor-field editor-field--code">
                <span>代码</span>
                <el-input v-model="selectedTypeCodeModel" size="small" />
              </label>
              <label class="editor-field editor-field--name">
                <span>名称</span>
                <el-input v-model="selectedType.name" size="small" />
              </label>
              <label class="editor-field editor-field--voucher">
                <span>凭证字</span>
                <el-input v-model="selectedType.voucherType" size="small" />
              </label>
              <label class="editor-field editor-field--period">
                <span>周期</span>
                <el-select v-model="selectedType.periodType" size="small">
                  <el-option label="月度" value="monthly" />
                  <el-option label="年末" value="yearly" />
                </el-select>
              </label>
            </div>
            <div class="section-actions">
              <el-button size="small" @click="addItem">
                <el-icon><Plus /></el-icon>新增规则
              </el-button>
              <el-button size="small" @click="deleteSelectedItems" :disabled="selectedTypeItems.length === 0">
                <el-icon><Delete /></el-icon>清空规则
              </el-button>
            </div>
          </div>

          <div class="relation-chips">
            <span class="chip"><em>规则</em>{{ selectedTypeItems.length }}</span>
            <span class="chip"><em>转出</em>{{ selectedTypeSourceCount }} 科目</span>
            <span class="chip chip--target" :title="selectedTypeTargetText"><em>转入</em>{{ selectedTypeTargetText }}</span>
            <span class="chip"><em>方式</em>{{ selectedTypeTransferMode }}</span>
          </div>

          <div class="content-table-wrapper">
            <el-table
              ref="contentTableRef"
              :data="selectedTypeItems"
              border
              style="width: 100%"
              height="100%"
              :row-class-name="getItemRowClass"
              @header-dragend="handleContentHeaderDragend"
              class="compact-table content-table"
            >
              <el-table-column
                type="index"
                column-key="index"
                label="序"
                :width="getContentColumnWidth('index', 44)"
              />
              <el-table-column prop="summary" label="摘要" :width="getContentColumnWidth('summary', 130)">
                <template #default="{ row }">
                  <el-input v-model="row.summary" size="small" />
                </template>
              </el-table-column>
              <el-table-column prop="fromCode" label="转出科目" :min-width="getContentColumnWidth('fromCode', 240)">
                <template #default="scope">
                  <el-select
                    v-model="scope.row.fromCode"
                    filterable
                    clearable
                    placeholder="选择转出科目"
                    size="small"
                    class="account-select"
                    :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
                    @change="updateFromName(scope.row)"
                  >
                    <el-option
                      v-for="acc in allAccounts"
                      :key="acc.code"
                      :label="`${acc.code} ${accountFullPathMap[acc.code] || acc.name}`"
                      :value="acc.code"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column prop="toCode" label="转入科目" :min-width="getContentColumnWidth('toCode', 240)">
                <template #default="scope">
                  <el-select
                    v-model="scope.row.toCode"
                    filterable
                    clearable
                    placeholder="选择明细科目"
                    size="small"
                    class="account-select"
                    :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
                    @change="updateToName(scope.row)"
                  >
                    <el-option
                      v-for="acc in detailAccounts"
                      :key="acc.code"
                      :label="`${acc.code} ${accountFullPathMap[acc.code] || acc.name}`"
                      :value="acc.code"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column prop="transferType" label="转出方式" :width="getContentColumnWidth('transferType', 90)">
                <template #default="scope">
                  <el-select v-model="scope.row.transferType" size="small">
                    <el-option label="全部" value="all" />
                    <el-option label="部分" value="partial" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column prop="ratio" label="比例" :width="getContentColumnWidth('ratio', 112)">
                <template #default="scope">
                  <span v-if="scope.row.transferType === 'all'" class="ratio-text">全部余额</span>
                  <div v-else class="ratio-input">
                    <el-input-number
                      v-model="scope.row.ratio"
                      :min="0"
                      :max="100"
                      :precision="2"
                      size="small"
                      style="width: 76px"
                      controls-position="right"
                    />
                    <span>%</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                column-key="action"
                label="操作"
                :width="getContentColumnWidth('action', 54)"
                fixed="right"
              >
                <template #default="scope">
                  <el-button size="small" type="danger" link @click="deleteItem(scope.row)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="content-footer">
            <span class="warning-tip">
              <el-icon color="#e6a23c"><Warning /></el-icon>
              一个结转类型可以配置多个转出科目，但只能对应一个转入明细科目。
            </span>
          </div>
        </template>

        <div v-else class="empty-tip">
          <el-icon :size="24" color="#ccc"><InfoFilled /></el-icon>
          <span>请选择左侧结转类型，或新增一个类型</span>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, watch } from 'vue'
import { useColumnWidthMemory } from '@/composables/useColumnWidthMemory'
import { Plus, Delete, InfoFilled, Warning } from '@element-plus/icons-vue'
import request from '@/api/request'
import { showSuccess, showWarning, showOperationError } from '@/composables/useMessage'
import { useConfirm } from '@/composables/useConfirm'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'

const contentTableRef = ref()
const {
  colWidth: getContentColumnWidth,
  onDragEnd: handleContentHeaderDragend,
  load: reloadContentColumnWidths,
  bindTable: bindContentTableLayout,
} = useColumnWidthMemory('transfer_content', {
  storageKey: 'transfer_content_column_widths',
})
bindContentTableLayout(contentTableRef)

interface AccountOption {
  id: string
  code: string
  name: string
}

interface TransferType {
  id: string
  code: string
  name: string
  voucherType: string
  periodType: string
}

interface TransferItem {
  id: string
  typeCode: string
  summary: string
  fromCode: string
  fromName: string
  toCode: string
  toName: string
  transferType: 'all' | 'partial'
  ratio?: number
}

const allAccounts = ref<AccountOption[]>([])
const allAccountsWithChildren = ref<any[]>([])
const accountFullPathMap = ref<Record<string, string>>({})
const transferTypes = ref<TransferType[]>([])
const transferItems = ref<TransferItem[]>([])
const selectedType = ref<TransferType | null>(null)

const selectedTypeItems = computed(() => {
  if (!selectedType.value) return []
  return transferItems.value.filter(item => item.typeCode === selectedType.value?.code)
})

const selectedTypeCodeModel = computed({
  get: () => selectedType.value?.code || '',
  set: (value: string) => {
    if (!selectedType.value) return
    const nextCode = value.trim()
    const oldCode = selectedType.value.code
    selectedType.value.code = nextCode
    if (!oldCode || oldCode === nextCode) return
    for (const item of transferItems.value) {
      if (item.typeCode === oldCode) {
        item.typeCode = nextCode
      }
    }
  },
})

const selectedTypeSourceCount = computed(() => {
  return new Set(selectedTypeItems.value.map(item => item.fromCode).filter(Boolean)).size
})

const selectedTypeTargetText = computed(() => {
  if (!selectedType.value) return '未设置'
  return getTypeTargetText(selectedType.value.code)
})

const selectedTypeTransferMode = computed(() => {
  const items = selectedTypeItems.value
  if (items.length === 0) return '未设置'
  const hasPartial = items.some(item => item.transferType === 'partial')
  const hasAll = items.some(item => item.transferType !== 'partial')
  if (hasPartial && hasAll) return '全部 + 部分'
  return hasPartial ? '按比例' : '全部结转'
})

const searchKeyword = ref('')

const filteredTypes = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return transferTypes.value

  return transferTypes.value.filter(type => {
    if (type.code.toLowerCase().includes(keyword) || type.name.toLowerCase().includes(keyword)) {
      return true
    }
    const items = transferItems.value.filter(item => item.typeCode === type.code)
    return items.some(item => {
      const fromCodeMatch = item.fromCode && item.fromCode.toLowerCase().includes(keyword)
      const fromNameMatch = item.fromName && item.fromName.toLowerCase().includes(keyword)
      const toCodeMatch = item.toCode && item.toCode.toLowerCase().includes(keyword)
      const toNameMatch = item.toName && item.toName.toLowerCase().includes(keyword)
      return fromCodeMatch || fromNameMatch || toCodeMatch || toNameMatch
    })
  })
})

function highlightTypeText(text: string): string {
  const keyword = searchKeyword.value.trim()
  if (!keyword || !text) return text
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(regex, '<mark style="background-color: #ffeb3b; padding: 0 2px;">$1</mark>')
}

function isItemMatched(item: TransferItem): boolean {
  const keyword = searchKeyword.value.trim().toLowerCase()
  if (!keyword) return false
  const fromCodeMatch = item.fromCode && item.fromCode.toLowerCase().includes(keyword)
  const fromNameMatch = item.fromName && item.fromName.toLowerCase().includes(keyword)
  const toCodeMatch = item.toCode && item.toCode.toLowerCase().includes(keyword)
  const toNameMatch = item.toName && item.toName.toLowerCase().includes(keyword)
  return !!(fromCodeMatch || fromNameMatch || toCodeMatch || toNameMatch)
}

function getItemRowClass({ row }: { row: TransferItem }): string {
  return isItemMatched(row) ? 'matched-item-row' : ''
}

function getItemsByTypeCode(typeCode: string): TransferItem[] {
  return transferItems.value.filter(item => item.typeCode === typeCode)
}

function getTypeItemCount(typeCode: string): number {
  return getItemsByTypeCode(typeCode).length
}

function formatAccountText(code: string): string {
  if (!code) return ''
  const name = accountFullPathMap.value[code] || getAccountName(code)
  return name ? `${code} ${name}` : code
}

function getTypeTargetText(typeCode: string): string {
  const toCodes = [...new Set(getItemsByTypeCode(typeCode).map(item => item.toCode).filter(Boolean))]
  if (toCodes.length === 0) return '未设置转入'
  if (toCodes.length === 1) return formatAccountText(toCodes[0])
  return `${toCodes.length} 个不同转入`
}

function getTypeSourcePreview(typeCode: string): string {
  const fromCodes = [...new Set(getItemsByTypeCode(typeCode).map(item => item.fromCode).filter(Boolean))]
  if (fromCodes.length === 0) return '未设置转出'
  if (fromCodes.length === 1) return formatAccountText(fromCodes[0])
  return `${fromCodes.length} 个转出科目`
}

watch(searchKeyword, () => {
  const keyword = searchKeyword.value.trim()
  if (!keyword) return
  const filtered = filteredTypes.value
  if (filtered.length === 1) {
    selectedType.value = filtered[0]
    return
  }
  if (selectedType.value && !filtered.find(t => t.id === selectedType.value?.id)) {
    selectedType.value = filtered[0] || null
    return
  }
  if (!selectedType.value && filtered.length > 0) {
    selectedType.value = filtered[0]
  }
})

function isDetailAccount(code: string): boolean {
  const account = allAccountsWithChildren.value.find(a => a.code === code)
  if (!account) return false
  return !account.children || account.children.length === 0
}

const detailAccounts = computed(() => {
  return allAccounts.value.filter(acc => isDetailAccount(acc.code))
})

function getAccountName(code: string): string {
  const acc = allAccounts.value.find(a => a.code === code)
  return acc?.name || ''
}

function getAccountFullPath(code: string): string {
  return accountFullPathMap.value[code] || getAccountName(code)
}

function updateFromName(row: TransferItem) {
  row.fromName = getAccountFullPath(row.fromCode)
}

function updateToName(row: TransferItem) {
  row.toName = getAccountFullPath(row.toCode)

  if (row.toCode && !isDetailAccount(row.toCode)) {
    showWarning('转入科目必须是明细科目，不能选择父级科目')
    row.toCode = ''
    row.toName = ''
    return
  }

  if (row.toCode && selectedType.value) {
    const otherItems = selectedTypeItems.value.filter(item => item.id !== row.id)
    const existingToCodes = new Set(otherItems.map(item => item.toCode).filter(Boolean))
    if (existingToCodes.size > 0 && !existingToCodes.has(row.toCode)) {
      showWarning('每个结转类型只能有一个转入科目')
      row.toCode = ''
      row.toName = ''
      return
    }
  }
}

function handleTypeClick(row: TransferType) {
  selectedType.value = row
}

function addTransferType() {
  const newType: TransferType = {
    id: Date.now().toString(),
    code: getNextTypeCode(),
    name: '新结转类型',
    voucherType: '结转',
    periodType: 'monthly',
  }
  transferTypes.value.push(newType)
  selectedType.value = newType
  showSuccess('已添加新的结转类型')
}

function getNextTypeCode(): string {
  const maxCode = transferTypes.value.reduce((max, type) => {
    const numericCode = Number.parseInt(type.code, 10)
    return Number.isFinite(numericCode) ? Math.max(max, numericCode) : max
  }, 0)
  return (maxCode + 1).toString().padStart(2, '0')
}

async function deleteTransferType(row: TransferType) {
  const confirmed = await useConfirm({
    message: '确定要删除这个结转类型吗？相关的结转配置也会被删除。',
    title: '提示',
    type: 'warning',
  })
  if (!confirmed) return

  transferTypes.value = transferTypes.value.filter(t => t.id !== row.id)
  transferItems.value = transferItems.value.filter(i => i.typeCode !== row.code)
  if (selectedType.value?.id === row.id) {
    selectedType.value = transferTypes.value[0] || null
  }
  showSuccess('删除成功')
}

function addItem() {
  if (!selectedType.value) {
    showWarning('请先选择一个结转类型')
    return
  }
  const newItem: TransferItem = {
    id: Date.now().toString(),
    typeCode: selectedType.value.code,
    summary: '结转',
    fromCode: '',
    fromName: '',
    toCode: '',
    toName: '',
    transferType: 'all',
    ratio: 100
  }
  transferItems.value.push(newItem)
}

function deleteItem(row: TransferItem) {
  transferItems.value = transferItems.value.filter(i => i.id !== row.id)
  showSuccess('删除成功')
}

async function deleteSelectedItems() {
  if (!selectedType.value) {
    showWarning('请先选择一个结转类型')
    return
  }
  const confirmed = await useConfirm({
    message: '确定要删除当前结转类型的所有配置吗？',
    title: '提示',
    type: 'warning',
  })
  if (!confirmed) return
  transferItems.value = transferItems.value.filter(i => i.typeCode !== selectedType.value?.code)
  showSuccess('删除成功')
}

async function fetchData() {
  const [accountRes, typeRes, itemRes] = await Promise.all([
    request.get<any[]>('/base/accounts', { params: { all: 1 } }),
    request.get<TransferType[]>('/system/transfer-types'),
    request.get<TransferItem[]>('/system/transfer-items'),
  ])

  allAccountsWithChildren.value = accountRes.data || []

  const accountMap: Record<string, any> = {}
  for (const acc of allAccountsWithChildren.value) {
    accountMap[acc.id] = { ...acc, children: [] }
  }
  for (const acc of allAccountsWithChildren.value) {
    if (acc.parent_id && accountMap[acc.parent_id]) {
      accountMap[acc.parent_id].children.push(accountMap[acc.id])
    }
  }
  allAccountsWithChildren.value = Object.values(accountMap)

  allAccounts.value = allAccountsWithChildren.value.map(acc => ({
    id: acc.id,
    code: acc.code,
    name: acc.name,
  }))

  const fullPathMap: Record<string, string> = {}
  const originalAccounts = accountRes.data || []
  for (const acc of originalAccounts) {
    const pathParts: string[] = []
    let current: any = acc
    while (current) {
      pathParts.unshift(current.name)
      const parent = originalAccounts.find((a: any) => a.id === current.parent_id)
      current = parent || null
    }
    const fullPath = pathParts.slice(1).join('/')
    fullPathMap[acc.code] = fullPath || acc.name
  }
  accountFullPathMap.value = fullPathMap

  if (typeRes.data && typeRes.data.length > 0) {
    transferTypes.value = typeRes.data
  } else {
    transferTypes.value = []
  }

  if (itemRes.data && itemRes.data.length > 0) {
    transferItems.value = itemRes.data
    for (const item of transferItems.value) {
      if (item.fromCode) {
        item.fromName = accountFullPathMap.value[item.fromCode] || getAccountName(item.fromCode)
      }
      if (item.toCode) {
        item.toName = accountFullPathMap.value[item.toCode] || getAccountName(item.toCode)
      }
    }
  }

  if (transferTypes.value.length > 0) {
    selectedType.value = transferTypes.value[0]
  }
}

async function handleSave() {
  try {
    const codeSet = new Set<string>()
    for (const type of transferTypes.value) {
      const code = type.code.trim()
      const name = type.name.trim()
      if (!code || !name) {
        showWarning('结转类型的代码和名称不能为空')
        return
      }
      if (codeSet.has(code)) {
        showWarning(`结转类型代码「${code}」重复，请调整后再保存`)
        return
      }
      codeSet.add(code)
      type.code = code
      type.name = name
      type.voucherType = type.voucherType?.trim() || '结转'
      type.periodType = type.periodType || 'monthly'
      if (/年末|年结|年度/.test(type.name) && type.periodType !== 'yearly') {
        type.periodType = 'yearly'
      }

      const items = transferItems.value.filter(item => item.typeCode === type.code)
      if (items.length === 0) continue
      const toCodes = items.map(item => item.toCode).filter(Boolean)
      const uniqueToCodes = new Set(toCodes)
      if (uniqueToCodes.size > 1) {
        showWarning(`结转类型「${type.name}」有多个不同的转入科目，每个结转类型只能有一个转入科目`)
        return
      }
      for (const toCode of uniqueToCodes) {
        if (!isDetailAccount(toCode)) {
          const account = allAccounts.value.find(a => a.code === toCode)
          showWarning(`结转类型「${type.name}」的转入科目「${account?.name || toCode}」不是明细科目，转入科目必须是明细科目`)
          return
        }
      }
    }
    await request.put('/system/transfer-types', { types: transferTypes.value })
    await request.put('/system/transfer-items', { items: transferItems.value })
    showSuccess('配置已保存')
  } catch (error) {
    showOperationError('保存结转配置', error)
  }
}

onMounted(async () => {
  try {
    await fetchData()
  } catch (err: any) {
    showOperationError('加载结转配置', err)
    transferTypes.value = []
    selectedType.value = null
  }
})

onActivated(() => reloadContentColumnWidths())
</script>

<style scoped>
.page {
  padding: 10px 12px;
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--el-fill-color-lighter);
}

.transfer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.header-title-block {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.page-header h3 {
  margin: 0;
  font-size: 15px;
  line-height: 1.25;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.header-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.page-header-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.transfer-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  gap: 8px;
}

.type-sidebar,
.transfer-detail {
  min-height: 0;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}

.type-sidebar {
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  height: 32px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.type-scroll {
  flex: 1;
  min-height: 0;
}

.type-list-item {
  position: relative;
  width: 100%;
  padding: 6px 28px 6px 8px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 6px;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.type-list-item:hover {
  background: var(--el-fill-color-light);
}

.type-list-item.active {
  background: var(--el-color-primary-light-9);
}

.type-list-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--el-color-primary);
}

.type-code,
.type-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 26px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.type-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.type-name-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.type-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.type-meta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

.type-meta span {
  white-space: nowrap;
}

.type-flow {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.flow-arrow {
  color: var(--el-color-primary);
  padding: 0 3px;
}

.type-delete {
  position: absolute;
  right: 6px;
  top: 6px;
  opacity: 0;
}

.type-list-item:hover .type-delete,
.type-list-item.active .type-delete {
  opacity: 1;
}

.sidebar-empty {
  padding: 20px 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
  font-size: 12px;
}

.transfer-detail {
  display: flex;
  flex-direction: column;
  padding: 8px;
}

.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.editor-row {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 70px minmax(140px, 1fr) 80px 80px;
  gap: 6px;
  align-items: center;
}

.editor-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.editor-field > :deep(.el-input),
.editor-field > :deep(.el-select) {
  flex: 1;
  min-width: 0;
}

.section-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.relation-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-primary);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
}

.chip em {
  font-style: normal;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.chip--target {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.content-table-wrapper {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.empty-tip {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}

.content-footer {
  padding-top: 6px;
  flex-shrink: 0;
}

.warning-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #a86b00;
  font-size: 11px;
}

.compact-table {
  font-size: 12px;
}

.compact-table :deep(.el-table__cell) {
  padding: 2px 0 !important;
}

.compact-table :deep(.el-table__row) {
  height: 28px;
}

.compact-table :deep(.cell) {
  padding: 0 6px;
  line-height: 1.4;
}

.compact-table :deep(th.el-table__cell .cell) {
  font-family: var(--cw-table-header-font-family);
  font-size: var(--cw-table-header-font-size);
  font-weight: var(--cw-table-header-font-weight);
}

.compact-table :deep(th.el-table__cell) {
  background-color: var(--el-fill-color-lighter);
  font-family: var(--cw-table-header-font-family);
  font-weight: var(--cw-table-header-font-weight);
  font-size: var(--cw-table-header-font-size);
}

.content-table {
  height: 100%;
}

.account-select {
  width: 100%;
}

.account-select :deep(.el-input__inner) {
  font-size: 12px;
}

.ratio-text {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ratio-input {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

:deep(.matched-item-row) {
  background-color: #e6f7ff !important;
}

:deep(.matched-item-row:hover) {
  background-color: #bae7ff !important;
}

@media (max-width: 1100px) {
  .transfer-workspace {
    grid-template-columns: 1fr;
  }

  .type-sidebar {
    max-height: 220px;
  }

  .editor-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

