<template>
  <el-dialog
    v-model="visible"
    :title="mode === 'print' ? '连续打印明细账' : '批量另存明细账'"
    width="640px"
    :close-on-click-modal="false"
    destroy-on-close
    @opened="onOpened"
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      :title="
        mode === 'print'
          ? '按科目编码顺序连续输出所选科目的明细账，可一次送打。'
          : '将所选科目明细账导出到同一个 Excel（每个科目一个工作表）。'
      "
    />
    <div class="batch-toolbar">
      <el-input
        v-model="keyword"
        clearable
        placeholder="筛选科目编码/名称"
        style="width: 220px"
        size="small"
      />
      <el-checkbox v-model="includeChildren" size="small">选中科目时含下级</el-checkbox>
      <el-button size="small" @click="selectLeafAccounts">全选末级</el-button>
      <el-button size="small" @click="selectedIds = []">清空</el-button>
      <span class="hint">已选 {{ selectedIds.length }} 个</span>
    </div>
    <el-select
      v-model="selectedIds"
      multiple
      filterable
      collapse-tags
      collapse-tags-tooltip
      :filter-method="() => true"
      placeholder="选择要处理的科目"
      style="width: 100%"
      :popper-class="ACCOUNT_SELECT_POPPER_CLASS"
    >
      <el-option
        v-for="a in filteredAccounts"
        :key="a.id"
        :label="`${a.code} ${a.name}`"
        :value="a.id"
      />
    </el-select>
    <div v-if="running" class="progress-wrap">
      <el-progress :percentage="progressPercent" :stroke-width="14" />
      <div class="progress-text">{{ progressText }}</div>
    </div>
    <template #footer>
      <el-button :disabled="running" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="running" :disabled="selectedIds.length === 0" @click="confirm">
        {{ mode === 'print' ? '开始打印' : '开始导出' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ACCOUNT_SELECT_POPPER_CLASS } from '@/utils/accountSelectDisplay'

export type DetailBatchMode = 'print' | 'export'

interface AccountItem {
  id: string
  code: string
  name: string
}

const props = defineProps<{
  modelValue: boolean
  mode: DetailBatchMode
  accounts: AccountItem[]
  running?: boolean
  progressDone?: number
  progressTotal?: number
  progressText?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [accountIds: string[]]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const keyword = ref('')
const includeChildren = ref(true)
const selectedIds = ref<string[]>([])

const filteredAccounts = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.accounts
  return props.accounts.filter(
    a => a.code.toLowerCase().includes(kw) || a.name.toLowerCase().includes(kw)
  )
})

const progressPercent = computed(() => {
  const total = props.progressTotal || 0
  if (total <= 0) return 0
  return Math.min(100, Math.round(((props.progressDone || 0) / total) * 100))
})

function isLeaf(account: AccountItem): boolean {
  return !props.accounts.some(
    a => a.id !== account.id && a.code.startsWith(account.code) && a.code.length > account.code.length
  )
}

function expandWithChildren(ids: string[]): string[] {
  if (!includeChildren.value) return ids
  const selected = new Set<string>()
  const byId = new Map(props.accounts.map(a => [a.id, a]))
  for (const id of ids) {
    const acc = byId.get(id)
    if (!acc) continue
    selected.add(id)
    for (const child of props.accounts) {
      if (child.code.startsWith(acc.code) && child.code.length > acc.code.length) {
        selected.add(child.id)
      }
    }
  }
  return Array.from(selected)
}

function selectLeafAccounts() {
  selectedIds.value = props.accounts.filter(isLeaf).map(a => a.id)
}

function onOpened() {
  keyword.value = ''
  if (selectedIds.value.length === 0) {
    // 默认不预选，避免误打全部
  }
}

function confirm() {
  const ids = expandWithChildren(selectedIds.value)
  const ordered = props.accounts.filter(a => ids.includes(a.id)).map(a => a.id)
  emit('confirm', ordered)
}

watch(
  () => props.modelValue,
  v => {
    if (!v) selectedIds.value = []
  }
)
</script>

<style scoped>
.batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.progress-wrap {
  margin-top: 16px;
}
.progress-text {
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
}
</style>
