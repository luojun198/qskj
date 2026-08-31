<template>
  <div class="account-scope-panel">
    <div class="account-scope-toolbar">
      <el-checkbox v-model="enabledLocal" @change="onEnabledChange">启用科目权限限制</el-checkbox>
      <span class="account-scope-hint">
        授权父科目将自动包含其全部下级科目；与用户/角色功能权限取并集生效
      </span>
    </div>
    <div v-if="loading" class="account-scope-loading">加载科目树...</div>
    <div v-else-if="!enabledLocal" class="account-scope-disabled">未启用时该用户/角色可操作全部科目</div>
    <div v-else class="account-scope-body">
      <div class="account-scope-actions">
        <el-checkbox
          :model-value="isAllChecked"
          :indeterminate="isAllIndeterminate"
          @change="(v: any) => toggleAll(!!v)"
        >全选</el-checkbox>
        <el-button link type="primary" size="small" @click="toggleInvert">反选</el-button>
        <span class="account-scope-count">已选 {{ checkedKeys.length }} 个科目</span>
      </div>
      <el-tree
        ref="treeRef"
        :data="treeData"
        node-key="id"
        show-checkbox
        default-expand-all
        :props="{ label: 'label', children: 'children' }"
        :check-strictly="true"
        :default-checked-keys="checkedKeys"
        @check="onTreeCheck"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import request from '@/api/request'

export interface AccountScopeValue {
  enabled: boolean
  account_ids: string[]
}

const props = defineProps<{
  modelValue: AccountScopeValue
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AccountScopeValue]
}>()

const loading = ref(false)
const treeRef = ref<any>(null)
const flatAccounts = ref<Array<{ id: string; code: string; name: string; parent_id: string | null }>>([])
const checkedKeys = ref<string[]>([])
const enabledLocal = ref(false)
const syncing = ref(false)

type TreeNode = { id: string; label: string; children?: TreeNode[] }

const treeData = computed(() => buildTree(flatAccounts.value))

const allLeafIds = computed(() => flatAccounts.value.map(a => a.id))

const isAllChecked = computed(
  () =>
    allLeafIds.value.length > 0 &&
    checkedKeys.value.length === allLeafIds.value.length
)

const isAllIndeterminate = computed(
  () =>
    checkedKeys.value.length > 0 && checkedKeys.value.length < allLeafIds.value.length
)

function buildTree(
  accounts: Array<{ id: string; code: string; name: string; parent_id: string | null }>
): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  for (const acc of accounts) {
    map.set(acc.id, { id: acc.id, label: `${acc.code} ${acc.name}`, children: [] })
  }
  for (const acc of accounts) {
    const node = map.get(acc.id)!
    if (acc.parent_id && map.has(acc.parent_id)) {
      map.get(acc.parent_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }
  const prune = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.children && n.children.length === 0) delete n.children
      else if (n.children) prune(n.children)
    }
  }
  prune(roots)
  return roots
}

function emitValue() {
  emit('update:modelValue', {
    enabled: enabledLocal.value,
    account_ids: [...checkedKeys.value],
  })
}

function onEnabledChange() {
  emitValue()
}

function onTreeCheck() {
  if (syncing.value || !treeRef.value) return
  checkedKeys.value = treeRef.value.getCheckedKeys(false) as string[]
  emitValue()
}

function toggleAll(checked: boolean) {
  if (!treeRef.value) return
  if (checked) {
    treeRef.value.setCheckedKeys(allLeafIds.value)
    checkedKeys.value = [...allLeafIds.value]
  } else {
    treeRef.value.setCheckedKeys([])
    checkedKeys.value = []
  }
  emitValue()
}

function toggleInvert() {
  const next = allLeafIds.value.filter(id => !checkedKeys.value.includes(id))
  treeRef.value?.setCheckedKeys(next)
  checkedKeys.value = next
  emitValue()
}

function applyFromProps() {
  syncing.value = true
  enabledLocal.value = !!props.modelValue?.enabled
  checkedKeys.value = Array.isArray(props.modelValue?.account_ids)
    ? [...props.modelValue.account_ids]
    : []
  treeRef.value?.setCheckedKeys(checkedKeys.value)
  syncing.value = false
}

watch(
  () => props.modelValue,
  () => applyFromProps(),
  { deep: true }
)

onMounted(async () => {
  loading.value = true
  try {
    const res = await request.get<any[]>('/base/accounts', { params: { is_enabled: '', all: 1 } })
    flatAccounts.value = (res.data || []).map((a: any) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      parent_id: a.parent_id || null,
    }))
    applyFromProps()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.account-scope-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 200px;
}

.account-scope-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.account-scope-hint {
  font-size: 12px;
  color: #909399;
}

.account-scope-loading,
.account-scope-disabled {
  color: #909399;
  font-size: 13px;
  padding: 8px 0;
}

.account-scope-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 8px;
}

.account-scope-body :deep(.el-tree-node__content) {
  height: auto;
  min-height: 28px;
  padding-top: 3px;
  padding-bottom: 3px;
  align-items: flex-start;
}

.account-scope-body :deep(.el-tree-node__label) {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  font-weight: 400;
  white-space: normal;
  word-break: break-word;
}

.account-scope-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.account-scope-count {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}
</style>
