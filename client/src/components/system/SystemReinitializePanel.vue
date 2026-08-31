<template>
  <div class="reinit-panel">
    <div class="reinit-toolbar">
      <el-radio-group v-model="mode" size="small" class="reinit-toolbar__mode">
        <el-radio value="voucher_only">仅清理凭证</el-radio>
        <el-radio value="full_reinit">重新初始化</el-radio>
      </el-radio-group>

      <div class="reinit-toolbar__date">
        <span class="reinit-toolbar__label">建账日期</span>
        <el-date-picker
          v-model="startDate"
          type="date"
          size="small"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          class="reinit-toolbar__picker"
        />
      </div>

      <div class="reinit-toolbar__actions">
        <el-button size="small" :loading="previewLoading" @click="handlePreview">
          查看影响范围
        </el-button>
        <el-button size="small" type="danger" plain @click="openConfirmDialog">
          执行初始化
        </el-button>
      </div>

      <el-tooltip :content="modeDesc" placement="top" :show-after="200">
        <el-icon class="reinit-toolbar__help"><QuestionFilled /></el-icon>
      </el-tooltip>
    </div>

    <div v-if="mode === 'full_reinit'" class="reinit-extra">
      <div class="reinit-extra__row">
        <span class="reinit-extra__label">科目级数</span>
        <el-input-number
          v-model="accountLevels"
          :min="1"
          :max="10"
          :controls="false"
          size="small"
          class="reinit-extra__levels"
        />
        <span class="reinit-extra__label">科目长度</span>
        <div class="reinit-extra__lengths">
          <template v-for="(_, index) in Array(accountLevels)" :key="index">
            <span v-if="index > 0" class="reinit-extra__lengths-sep">-</span>
            <el-input-number
              v-model="accountCodeLengths[index]"
              :min="1"
              :max="9"
              :controls="false"
              size="small"
              class="reinit-extra__length-input"
            />
          </template>
        </div>
      </div>
      <div class="reinit-extra__row">
        <span class="reinit-extra__label">会计准则</span>
        <el-select v-model="accountingStandard" size="small" class="reinit-extra__standard" placeholder="请选择">
          <el-option label="政府会计制度" value="government" />
          <el-option label="小企业会计准则" value="small_business" />
          <el-option label="新企业会计准则" value="enterprise" />
        </el-select>
        <span class="reinit-extra__label">标准模板</span>
        <el-select
          v-model="standardTemplateId"
          size="small"
          class="reinit-extra__template"
          placeholder="请选择标准模板"
          :loading="templatesLoading"
          filterable
        >
          <el-option
            v-for="item in filteredTemplates"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </div>
      <div class="reinit-extra__preserve">
        <span class="reinit-extra__label">保留项</span>
        <el-checkbox v-model="preserve.preserve_aux" size="small">辅助核算</el-checkbox>
        <el-checkbox v-model="preserve.preserve_voucher_types" size="small">凭证类型</el-checkbox>
        <el-checkbox v-model="preserve.preserve_transfer" size="small">结转维护</el-checkbox>
        <el-checkbox v-model="preserve.preserve_dashboard_rules" size="small">主页取数</el-checkbox>
        <el-checkbox v-model="preserve.preserve_business_params" size="small">业务开关</el-checkbox>
        <el-tooltip content="重置科目后科目 ID 会变化，期初余额必须清空" placement="top">
          <el-checkbox disabled checked size="small">期初（不可保留）</el-checkbox>
        </el-tooltip>
      </div>
    </div>

    <el-alert
      v-if="preview"
      type="warning"
      :closable="false"
      show-icon
      class="reinit-preview-alert"
      title="影响范围预览"
    >
      <div class="reinit-preview-grid">
        <span>凭证 {{ preview.willDelete.vouchers }} 张</span>
        <span>分录 {{ preview.willDelete.voucher_entries }} 条</span>
        <span>期初 {{ preview.willDelete.init_balances }} 条</span>
        <span>科目 {{ preview.willDelete.accounts }} 个</span>
        <span>辅助 {{ preview.willDelete.aux_items }} 条</span>
        <span>结账 {{ preview.willDelete.period_closing }} 条</span>
        <span v-if="preview.templateAccountCount != null">
          模板约 {{ preview.templateAccountCount }} 科目
        </span>
      </div>
      <ul v-if="preview.warnings.length" class="reinit-warning-list">
        <li v-for="(warn, idx) in preview.warnings" :key="idx">{{ warn }}</li>
      </ul>
    </el-alert>

    <el-dialog v-model="confirmVisible" title="确认系统初始化" width="440px" destroy-on-close>
      <el-alert type="error" :closable="false" show-icon style="margin-bottom: 16px">
        此操作不可恢复。确认后将先自动执行完整备份（与「备份恢复」页相同，保存至服务器备份目录），备份失败则不会继续初始化。
      </el-alert>
      <el-form label-width="96px">
        <el-form-item label="确认文案" required>
          <el-input v-model="confirmText" placeholder="请输入：确认初始化" />
        </el-form-item>
        <el-form-item label="管理员密码" required>
          <el-input v-model="adminPassword" type="password" show-password autocomplete="off" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmVisible = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="handleSubmit">确认执行</el-button>
      </template>
    </el-dialog>

    <TaskProgressDialog
      v-model="taskProgressVisible"
      :task-id="currentTaskId"
      :task-type="currentTaskType"
      @completed="handleTaskCompleted"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import TaskProgressDialog from '@/components/task/TaskProgressDialog.vue'
import { useAsyncBatchTask } from '@/composables/useAsyncBatchTask'
import { showError, showOperationError } from '@/composables/useMessage'
import {
  fetchStandardTemplates,
  previewSystemReinitialize,
  runSystemReinitializeAsync,
  type ReinitMode,
  type ReinitPreviewResult,
  type StandardTemplateItem,
} from '@/api/systemReinitialize'
import { inferAccountingStandardFromTemplateName } from '@/utils/accountingStandard'
import { getAccountSetDefaultStartDate } from '@/utils/format'

const props = defineProps<{
  currentStartDate?: string
  accountLevels?: number
  accountCodeLengths?: number[]
}>()

const emit = defineEmits<{ completed: [] }>()

const mode = ref<ReinitMode>('voucher_only')
const startDate = ref('')
const accountLevels = ref(6)
const accountCodeLengths = ref<number[]>([4, 2, 2, 2, 2, 2, 2, 2, 2, 2])
const accountingStandard = ref<'government' | 'small_business' | 'enterprise'>('government')
const standardTemplateId = ref('')
const templates = ref<StandardTemplateItem[]>([])
const templatesLoading = ref(false)
const preview = ref<ReinitPreviewResult | null>(null)
const previewLoading = ref(false)

const preserve = reactive({
  preserve_aux: false,
  preserve_voucher_types: false,
  preserve_transfer: false,
  preserve_dashboard_rules: false,
  preserve_business_params: false,
})

const confirmVisible = ref(false)
const confirmText = ref('')
const adminPassword = ref('')
const submitting = ref(false)

const {
  taskProgressVisible,
  currentTaskId,
  currentTaskType,
  startAsyncTask,
  resetTaskDialog,
} = useAsyncBatchTask()

const modeDesc = computed(() =>
  mode.value === 'voucher_only'
    ? '保留准则、科目、辅助与期初，仅删除全部凭证及相关余额、结账记录；须重新选择建账日期。'
    : '重选准则与标准模板并重导科目，须设置科目级数/长度；期初将清空；须重新选择建账日期；可勾选保留项。'
)

const filteredTemplates = computed(() => {
  return templates.value.filter(item => {
    const inferred = inferAccountingStandardFromTemplateName(item.name)
    if (inferred === 'auto') return true
    return inferred === accountingStandard.value
  })
})

function resolveDefaultStartDate() {
  const current = String(props.currentStartDate || '').trim()
  return current || getAccountSetDefaultStartDate()
}

function buildPayload() {
  return {
    mode: mode.value,
    start_date: startDate.value,
    accounting_standard: mode.value === 'full_reinit' ? accountingStandard.value : undefined,
    standard_template_id: mode.value === 'full_reinit' ? standardTemplateId.value : undefined,
    account_levels: mode.value === 'full_reinit' ? accountLevels.value : undefined,
    account_code_lengths:
      mode.value === 'full_reinit'
        ? accountCodeLengths.value.slice(0, accountLevels.value)
        : undefined,
    preserve: mode.value === 'full_reinit' ? { ...preserve } : undefined,
  }
}

function validateAccountCodeConfig(): boolean {
  if (mode.value !== 'full_reinit') return true
  if (!accountLevels.value || accountLevels.value < 1) {
    showError('请设置科目级数')
    return false
  }
  for (let i = 0; i < accountLevels.value; i++) {
    const len = accountCodeLengths.value[i]
    if (!len || len < 1) {
      showError(`请设置第 ${i + 1} 级科目长度`)
      return false
    }
  }
  return true
}

function validateStartDateRequired(): boolean {
  if (!startDate.value) {
    showError('请选择建账日期')
    return false
  }
  return true
}

async function loadTemplates() {
  templatesLoading.value = true
  try {
    const res = await fetchStandardTemplates()
    templates.value = res.data || []
  } catch (error) {
    showOperationError('加载标准模板', error)
  } finally {
    templatesLoading.value = false
  }
}

async function handlePreview() {
  if (!validateStartDateRequired()) return
  if (!validateAccountCodeConfig()) return

  if (mode.value === 'full_reinit') {
    if (!accountingStandard.value) {
      showError('请选择会计准则')
      return
    }
    if (!standardTemplateId.value) {
      showError('请选择标准模板')
      return
    }
  }

  previewLoading.value = true
  try {
    const res = await previewSystemReinitialize(buildPayload())
    preview.value = res.data || null
  } catch (error) {
    showOperationError('预览影响范围', error)
  } finally {
    previewLoading.value = false
  }
}

function openConfirmDialog() {
  if (!validateStartDateRequired()) return
  confirmText.value = ''
  adminPassword.value = ''
  confirmVisible.value = true
}

async function handleSubmit() {
  if (confirmText.value.trim() !== '确认初始化') {
    showError('请输入确认文案：确认初始化')
    return
  }
  if (!adminPassword.value) {
    showError('请输入管理员密码')
    return
  }
  if (!validateStartDateRequired()) return
  if (!validateAccountCodeConfig()) return
  if (mode.value === 'full_reinit' && !standardTemplateId.value) {
    showError('请选择标准模板')
    return
  }

  submitting.value = true
  try {
    await startAsyncTask('system-reinitialize', () =>
      runSystemReinitializeAsync({
        ...buildPayload(),
        password: adminPassword.value,
        confirm_text: confirmText.value.trim(),
      })
    )
    confirmVisible.value = false
  } catch (error) {
    showOperationError('系统初始化', error)
  } finally {
    submitting.value = false
  }
}

function handleTaskCompleted() {
  resetTaskDialog()
  preview.value = null
  emit('completed')
}

watch(
  () => [props.accountLevels, props.accountCodeLengths] as const,
  ([levels, lengths]) => {
    if (levels) accountLevels.value = levels
    if (lengths?.length) accountCodeLengths.value = [...lengths]
  },
  { immediate: true }
)

watch(
  () => props.currentStartDate,
  value => {
    if (!startDate.value) {
      startDate.value = String(value || '').trim() || getAccountSetDefaultStartDate()
    }
  },
  { immediate: true }
)

watch(mode, () => {
  preview.value = null
})

watch(accountingStandard, () => {
  if (!filteredTemplates.value.some(item => item.id === standardTemplateId.value)) {
    standardTemplateId.value = ''
  }
  preview.value = null
})

watch([accountLevels, accountCodeLengths], () => {
  preview.value = null
})

watch(startDate, () => {
  preview.value = null
})

onMounted(() => {
  if (!startDate.value) {
    startDate.value = resolveDefaultStartDate()
  }
  void loadTemplates()
})
</script>

<style scoped>
.reinit-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reinit-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.reinit-toolbar__mode {
  flex-shrink: 0;
}

.reinit-toolbar__mode :deep(.el-radio) {
  margin-right: 12px;
}

.reinit-toolbar__date {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.reinit-toolbar__label,
.reinit-extra__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.reinit-toolbar__label::before {
  content: '*';
  color: var(--el-color-danger);
  margin-right: 2px;
}

.reinit-toolbar__picker {
  width: 132px;
}

.reinit-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.reinit-toolbar__help {
  font-size: 15px;
  color: var(--el-text-color-placeholder);
  cursor: help;
  flex-shrink: 0;
}

.reinit-extra {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-extra-light);
}

.reinit-extra__row,
.reinit-extra__preserve {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.reinit-extra__standard {
  width: 148px;
}

.reinit-extra__levels {
  width: 72px;
}

.reinit-extra__lengths {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.reinit-extra__lengths-sep {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.reinit-extra__length-input {
  width: 52px;
}

.reinit-extra__template {
  flex: 1;
  min-width: 160px;
  max-width: 320px;
}

.reinit-extra__preserve :deep(.el-checkbox) {
  margin-right: 0;
}

.reinit-preview-alert {
  margin-top: 0;
}

.reinit-preview-alert :deep(.el-alert__content) {
  padding: 0;
}

.reinit-preview-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
}

.reinit-warning-list {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .reinit-toolbar__actions {
    margin-left: 0;
    width: 100%;
  }
}
</style>
