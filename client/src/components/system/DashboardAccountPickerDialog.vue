<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="580px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    class="dashboard-account-picker-dialog"
    @update:model-value="emit('update:visible', $event)"
    @closed="handleClosed"
  >
    <div class="picker-toolbar">
      <el-input
        v-model="keyword"
        clearable
        placeholder="模糊搜索：编码、名称，空格分隔多个关键词"
        @input="handleKeywordInput"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <div class="picker-toolbar__actions">
        <el-button link type="primary" @click="expandAll">全部展开</el-button>
        <el-button link type="primary" @click="collapseAll">全部收起</el-button>
        <el-button link type="danger" @click="clearSelection">清空</el-button>
      </div>
    </div>

    <div v-loading="loading" class="picker-tree-wrap">
      <el-empty v-if="!treeData.length" description="暂无可用科目" :image-size="64" />
      <el-tree
        v-else
        ref="treeRef"
        :key="treeRenderKey"
        :data="treeData"
        node-key="code"
        show-checkbox
        :props="treeProps"
        :filter-node-method="filterNode"
        :default-expanded-keys="defaultExpandedKeys"
        @check="syncCheckedState"
      >
        <template #default="{ data }">
          <span class="picker-node" :title="`${data.code} ${data.name}`">
            <span class="picker-node__code">{{ data.code }}</span>
            <span class="picker-node__name">{{ data.name }}</span>
          </span>
        </template>
      </el-tree>
    </div>

    <p class="picker-summary">
      已选 <strong>{{ rootCount }}</strong> 个一级科目，共
      <strong>{{ checkedCount }}</strong> 个（含下级）；勾选父科目将自动勾选全部子科目
    </p>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="confirmSelection">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { ElTree } from 'element-plus'
import type { Account } from '@/types/base'
import {
  buildAccountTree,
  collapseCheckedCodesToRoots,
  expandCodeRootsToCheckedCodes,
  fuzzyMatchAccount,
  type AccountTreeNode,
} from '@/utils/dashboardAccountSelection'

const props = withDefaults(
  defineProps<{
    visible: boolean
    selectedRoots: string[]
    accounts: Account[]
    title?: string
  }>(),
  {
    title: '选择科目',
  }
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:selectedRoots': [value: string[]]
}>()

const treeRef = ref<InstanceType<typeof ElTree>>()
const keyword = ref('')
const loading = ref(false)
const treeRenderKey = ref(0)
const defaultExpandedKeys = ref<string[]>([])
const checkedCodes = ref<string[]>([])

const treeProps = {
  label: 'name',
  children: 'children',
}

const treeData = computed(() => buildAccountTree(props.accounts))

const rootCount = computed(() => collapseCheckedCodesToRoots(checkedCodes.value).length)
const checkedCount = computed(() => checkedCodes.value.length)

function filterNode(value: string, data: AccountTreeNode) {
  if (!value) return true
  return fuzzyMatchAccount(value, data)
}

function syncCheckedState() {
  checkedCodes.value = (treeRef.value?.getCheckedKeys(false) as string[]) || []
}

function applyCheckedRoots(roots: string[]) {
  const expanded = expandCodeRootsToCheckedCodes(roots, props.accounts)
  checkedCodes.value = expanded
  defaultExpandedKeys.value = expanded.length > 0 ? [...expanded] : treeData.value.map(item => item.code)
  treeRenderKey.value += 1
}

async function initializePicker() {
  loading.value = true
  keyword.value = ''
  applyCheckedRoots(props.selectedRoots)
  await nextTick()
  treeRef.value?.setCheckedKeys(checkedCodes.value, false)
  syncCheckedState()
  loading.value = false
}

function handleKeywordInput() {
  treeRef.value?.filter(keyword.value)
  if (keyword.value.trim()) {
    expandAll()
  }
}

function expandAll() {
  const nodes = treeRef.value?.store?.nodesMap
  if (!nodes) return
  for (const node of Object.values(nodes)) {
    if (node.childNodes?.length) node.expanded = true
  }
}

function collapseAll() {
  const nodes = treeRef.value?.store?.nodesMap
  if (!nodes) return
  for (const node of Object.values(nodes)) {
    node.expanded = false
  }
}

function clearSelection() {
  treeRef.value?.setCheckedKeys([], false)
  checkedCodes.value = []
}

function confirmSelection() {
  syncCheckedState()
  emit('update:selectedRoots', collapseCheckedCodesToRoots(checkedCodes.value))
  emit('update:visible', false)
}

function handleClosed() {
  keyword.value = ''
  checkedCodes.value = []
}

watch(
  () => props.visible,
  visible => {
    if (visible) {
      void initializePicker()
    }
  }
)
</script>

<style scoped>
.picker-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.picker-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.picker-tree-wrap {
  min-height: 280px;
  max-height: min(420px, 52vh);
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 10px;
  background: var(--el-fill-color-blank, #fff);
}

.picker-tree-wrap :deep(.el-tree-node__content) {
  height: auto;
  min-height: 30px;
  padding-top: 3px;
  padding-bottom: 3px;
  align-items: flex-start;
}

.picker-tree-wrap :deep(.el-tree-node__label) {
  flex: 1;
  min-width: 0;
  white-space: normal;
  line-height: 1.4;
}

.picker-node {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.picker-node__code {
  flex: 0 0 64px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}

.picker-node__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-primary, #303133);
  line-height: 1.4;
  word-break: normal;
  overflow-wrap: break-word;
}

.picker-summary {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}

.picker-summary strong {
  color: var(--el-color-primary, #409eff);
  font-weight: 600;
}
</style>

<style>
.dashboard-account-picker-dialog .el-dialog__body {
  padding-top: 8px;
}
</style>
