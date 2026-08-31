<template>
  <el-dialog
    :model-value="visible"
    title="主页 Dashboard 取数规则"
    width="680px"
    :close-on-click-modal="false"
    destroy-on-close
    class="dashboard-rules-dialog"
    @update:model-value="emit('update:visible', $event)"
  >
    <div class="rules-dialog-body">
      <el-form label-width="88px" size="default" class="rules-dialog-form">
        <el-form-item label="会计准则">
          <el-select
            :model-value="accountingStandard"
            style="width: 100%"
            @update:model-value="emit('update:accountingStandard', $event)"
          >
            <el-option label="自动识别" value="auto" />
            <el-option label="政府会计制度" value="government" />
            <el-option label="小企业会计准则" value="small_business" />
            <el-option label="新企业会计准则" value="enterprise" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="rules-dialog-alert"
        title="已按所选准则从当前账套科目中匹配默认项；每类科目点击「选择科目」在弹出层中勾选，父科目会自动勾选全部子科目。"
      />

      <div class="rules-category-list">
        <div
          v-for="category in categories"
          :key="category.key"
          class="rules-category-row"
        >
          <div class="rules-category-row__main">
            <div class="rules-category-row__head">
              <span :class="['rules-category-row__dot', `is-${category.tone}`]" />
              <div class="rules-category-row__text">
                <span class="rules-category-row__label">{{ category.label }}</span>
                <span class="rules-category-row__summary">
                  {{ formatAccountRootsSummary(rulesForm[category.key], accounts) }}
                </span>
              </div>
            </div>
            <div v-if="rulesForm[category.key].length" class="rules-category-row__tags">
              <el-tag
                v-for="code in rulesForm[category.key].slice(0, 6)"
                :key="code"
                size="small"
                type="info"
                effect="plain"
              >
                {{ code }}
              </el-tag>
              <el-tag
                v-if="rulesForm[category.key].length > 6"
                size="small"
                type="info"
                effect="plain"
              >
                +{{ rulesForm[category.key].length - 6 }}
              </el-tag>
            </div>
            <span v-else class="rules-category-row__empty">点击右侧按钮选择科目</span>
          </div>
          <el-button type="primary" plain @click="openPicker(category.key)">
            选择科目
          </el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="emit('confirm')">确定</el-button>
    </template>

    <DashboardAccountPickerDialog
      v-model:visible="pickerVisible"
      v-model:selected-roots="pickerRoots"
      :accounts="accounts"
      :title="pickerTitle"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DashboardAccountPickerDialog from '@/components/system/DashboardAccountPickerDialog.vue'
import type { Account } from '@/types/base'
import { formatAccountRootsSummary } from '@/utils/dashboardAccountSelection'

export type DashboardRulesFormState = {
  incomeCodeRoots: string[]
  pureExpenseCodeRoots: string[]
  feeCodeRoots: string[]
  costCodeRoots: string[]
}

type CategoryKey = keyof DashboardRulesFormState

const props = defineProps<{
  visible: boolean
  accountingStandard: string
  rulesForm: DashboardRulesFormState
  accounts: Account[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:accountingStandard': [value: string]
  'update:rulesForm': [value: DashboardRulesFormState]
  confirm: []
}>()

const categories: Array<{
  key: CategoryKey
  label: string
  tone: string
}> = [
  { key: 'incomeCodeRoots', label: '收入科目', tone: 'income' },
  { key: 'pureExpenseCodeRoots', label: '支出科目', tone: 'expense' },
  { key: 'feeCodeRoots', label: '费用科目', tone: 'fee' },
  { key: 'costCodeRoots', label: '成本科目', tone: 'cost' },
]

const pickerVisible = ref(false)
const activeCategoryKey = ref<CategoryKey>('incomeCodeRoots')
const pickerRoots = ref<string[]>([])

const pickerTitle = computed(() => {
  const category = categories.find(item => item.key === activeCategoryKey.value)
  return category ? `选择${category.label}` : '选择科目'
})

function openPicker(key: CategoryKey) {
  activeCategoryKey.value = key
  pickerRoots.value = [...props.rulesForm[key]]
  pickerVisible.value = true
}

watch(pickerRoots, roots => {
  if (!pickerVisible.value) return
  emit('update:rulesForm', {
    ...props.rulesForm,
    [activeCategoryKey.value]: [...roots],
  })
})
</script>

<style scoped>
.rules-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rules-dialog-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.rules-dialog-alert :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.45;
}

.rules-category-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rules-category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--el-fill-color-lighter, #fafafa);
  border: 1px solid var(--el-border-color-extra-light, #f0f2f5);
}

.rules-category-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rules-category-row__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.rules-category-row__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
}

.rules-category-row__dot.is-income {
  background: #67c23a;
}

.rules-category-row__dot.is-expense {
  background: #409eff;
}

.rules-category-row__dot.is-fee {
  background: #e6a23c;
}

.rules-category-row__dot.is-cost {
  background: #909399;
}

.rules-category-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rules-category-row__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
}

.rules-category-row__summary {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}

.rules-category-row__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rules-category-row__empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder, #a8abb2);
}

@media (max-width: 640px) {
  .rules-category-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>

<style>
.dashboard-rules-dialog .el-dialog__body {
  padding-top: 12px;
  padding-bottom: 8px;
}
</style>
