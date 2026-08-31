<template>
  <div class="rules-page" v-loading="loading">
    <header class="page-header">
      <div class="page-header__left">
        <el-button text :icon="ArrowLeft" @click="router.push('/system/param')">返回</el-button>
        <div>
          <h2>首页取数规则</h2>
          <p>财务金额仅统计已记账凭证；政府会计的财务口径与预算口径分别展示。</p>
        </div>
      </div>
      <div class="page-header__actions">
        <el-button :disabled="standard === 'custom'" @click="resetToPreset">恢复准则预置</el-button>
        <el-button type="primary" :loading="saving" @click="saveRules">保存规则</el-button>
      </div>
    </header>

    <el-card shadow="never" class="standard-card">
      <el-form inline label-width="96px">
        <el-form-item label="会计准则">
          <el-select v-model="standard" style="width: 220px" @change="handleStandardChange">
            <el-option label="自动识别" value="auto" />
            <el-option label="政府会计制度" value="government" />
            <el-option label="小企业会计准则" value="small_business" />
            <el-option label="新企业会计准则" value="enterprise" />
            <el-option label="自定义" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="规则模式">
          <el-switch
            v-model="config.customized"
            :disabled="standard === 'custom'"
            active-text="自定义规则"
            inactive-text="跟随准则预置"
            @change="handleModeChange"
          />
        </el-form-item>
      </el-form>
      <el-alert
        :closable="false"
        type="info"
        show-icon
        title="草稿、已审核凭证只进入待办数量，不参与收入、支出、余额、趋势和活跃科目金额。"
      />
    </el-card>

    <section class="rule-section">
      <div class="section-title">
        <div>
          <h3>财务会计口径</h3>
          <p>用于首页财务收入、财务支出和本期盈余。</p>
        </div>
      </div>
      <div class="rule-grid">
        <RuleCard
          v-for="item in financialItems"
          :key="item.key"
          :title="item.title"
          :description="item.description"
          :codes="config.financial[item.key].codeRoots"
          :account-map="accountMap"
          :readonly="!config.customized"
          @pick="openPicker('financial', item.key, item.title, item.direction)"
          @remove="removeCode('financial', item.key, $event)"
        />
      </div>
    </section>

    <section v-if="showBudget" class="rule-section rule-section--budget">
      <div class="section-title">
        <div>
          <h3>预算会计口径</h3>
          <p>用于首页预算收入、预算支出和预算结余，不与财务会计金额合并。</p>
        </div>
      </div>
      <div class="rule-grid rule-grid--two">
        <RuleCard
          v-for="item in budgetItems"
          :key="item.key"
          :title="item.title"
          :description="item.description"
          :codes="config.budget[item.key].codeRoots"
          :account-map="accountMap"
          :readonly="!config.customized"
          @pick="openPicker('budget', item.key, item.title, item.direction)"
          @remove="removeCode('budget', item.key, $event)"
        />
      </div>
    </section>

    <DashboardAccountPickerDialog
      v-model:visible="pickerVisible"
      :title="`选择${picker.title}科目`"
      :selected-roots="pickerCodes"
      :accounts="pickerAccounts"
      @update:selected-roots="updatePickerCodes"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { ElButton, ElEmpty, ElTag } from 'element-plus'
import { useRouter } from 'vue-router'
import request from '@/api/request'
import { useBaseDataStore } from '@/stores/baseData'
import { showOperationError, showSuccess } from '@/composables/useMessage'
import DashboardAccountPickerDialog from '@/components/system/DashboardAccountPickerDialog.vue'
import type { Account } from '@/types/base'

type Rule = { codeRoots: string[]; nameKeywords: string[] }
type FinancialKey = 'income' | 'pureExpense' | 'fee' | 'cost'
type BudgetKey = 'income' | 'expense'
type RuleConfig = {
  version: 2
  customized: boolean
  financial: Record<FinancialKey, Rule>
  budget: Record<BudgetKey, Rule>
}

const emptyRule = (): Rule => ({ codeRoots: [], nameKeywords: [] })
const emptyConfig = (): RuleConfig => ({
  version: 2,
  customized: false,
  financial: {
    income: emptyRule(),
    pureExpense: emptyRule(),
    fee: emptyRule(),
    cost: emptyRule(),
  },
  budget: { income: emptyRule(), expense: emptyRule() },
})

const RuleCard = defineComponent({
  props: {
    title: { type: String, required: true },
    description: { type: String, required: true },
    codes: { type: Array as () => string[], required: true },
    accountMap: { type: Map as unknown as () => Map<string, Account>, required: true },
    readonly: { type: Boolean, default: false },
  },
  emits: ['pick', 'remove'],
  setup(props, { emit }) {
    return () =>
      h('article', { class: 'rule-card' }, [
        h('div', { class: 'rule-card__header' }, [
          h('div', [h('h4', props.title), h('p', props.description)]),
          h(
            ElButton,
            { type: 'primary', plain: true, size: 'small', disabled: props.readonly, onClick: () => emit('pick') },
            () => '选择科目'
          ),
        ]),
        props.codes.length
          ? h(
              'div',
              { class: 'rule-card__tags' },
              props.codes.map(code =>
                h(
                  ElTag,
                  {
                    key: code,
                    closable: !props.readonly,
                    onClose: () => emit('remove', code),
                  },
                  () => `${code} ${props.accountMap.get(code)?.name || ''}`.trim()
                )
              )
            )
          : h(ElEmpty, { description: '未配置科目', imageSize: 44 }),
      ])
  },
})

const router = useRouter()
const baseDataStore = useBaseDataStore()
const loading = ref(false)
const saving = ref(false)
const standard = ref('auto')
const config = reactive<RuleConfig>(emptyConfig())
const pickerVisible = ref(false)
const picker = reactive<{
  section: 'financial' | 'budget'
  key: FinancialKey | BudgetKey
  title: string
  direction: 'debit' | 'credit'
}>({ section: 'financial', key: 'income', title: '', direction: 'credit' })

const financialItems: Array<{
  key: FinancialKey
  title: string
  description: string
  direction: 'debit' | 'credit'
}> = [
  { key: 'income', title: '财务收入', description: '贷方发生额减借方发生额', direction: 'credit' },
  { key: 'pureExpense', title: '财务支出', description: '不含费用、成本分类的借方净发生额', direction: 'debit' },
  { key: 'fee', title: '费用', description: '费用类科目的借方净发生额', direction: 'debit' },
  { key: 'cost', title: '成本', description: '成本类科目的借方净发生额', direction: 'debit' },
]
const budgetItems: Array<{
  key: BudgetKey
  title: string
  description: string
  direction: 'debit' | 'credit'
}> = [
  { key: 'income', title: '预算收入', description: '预算收入类科目的贷方净发生额', direction: 'credit' },
  { key: 'expense', title: '预算支出', description: '预算支出类科目的借方净发生额', direction: 'debit' },
]

const accountMap = computed(() => new Map(baseDataStore.accounts.map(item => [item.code, item])))
const pickerAccounts = computed(() =>
  baseDataStore.accounts.filter(item => !item.direction || item.direction === picker.direction)
)
const pickerCodes = computed(() => {
  if (picker.section === 'financial') {
    return config.financial[picker.key as FinancialKey].codeRoots
  }
  return config.budget[picker.key as BudgetKey].codeRoots
})
const showBudget = computed(
  () =>
    standard.value === 'government' ||
    config.budget.income.codeRoots.length > 0 ||
    config.budget.expense.codeRoots.length > 0
)

function assignConfig(value: RuleConfig) {
  Object.assign(config, emptyConfig(), value, {
    financial: { ...emptyConfig().financial, ...(value?.financial || {}) },
    budget: { ...emptyConfig().budget, ...(value?.budget || {}) },
  })
}

async function loadPreset(selectedStandard = standard.value) {
  if (selectedStandard === 'custom') return
  const res = await request.get<RuleConfig>('/system/dashboard-rules-preview', {
    params: { standard: selectedStandard },
  })
  assignConfig(res.data)
}

async function loadData() {
  loading.value = true
  try {
    await baseDataStore.loadAccounts(true)
    const res = await request.get('/system/params')
    const params = (res.data || []) as Array<{ param_key: string; param_value: string }>
    standard.value = params.find(item => item.param_key === 'accounting_standard')?.param_value || 'auto'
    const effective = (res as any).meta?.dashboard_effective_rule_config as RuleConfig | undefined
    if (effective) assignConfig(effective)
    else await loadPreset()
    if (standard.value === 'custom') config.customized = true
  } catch (error) {
    showOperationError('加载首页取数规则', error)
  } finally {
    loading.value = false
  }
}

async function handleStandardChange(value: string) {
  try {
    if (value === 'custom') {
      config.customized = true
      return
    }
    await loadPreset(value)
  } catch (error) {
    showOperationError('加载准则预置规则', error)
  }
}

async function handleModeChange(customized: string | number | boolean) {
  if (!customized) {
    try {
      await loadPreset()
    } catch (error) {
      config.customized = true
      showOperationError('恢复准则预置规则', error)
    }
  }
}

async function resetToPreset() {
  try {
    await loadPreset()
    showSuccess('已恢复准则预置，保存后生效')
  } catch (error) {
    showOperationError('恢复准则预置规则', error)
  }
}

function openPicker(
  section: 'financial' | 'budget',
  key: FinancialKey | BudgetKey,
  title: string,
  direction: 'debit' | 'credit'
) {
  if (!config.customized) return
  Object.assign(picker, { section, key, title, direction })
  pickerVisible.value = true
}

function updatePickerCodes(codes: string[]) {
  if (picker.section === 'financial') {
    config.financial[picker.key as FinancialKey].codeRoots = codes
  } else {
    config.budget[picker.key as BudgetKey].codeRoots = codes
  }
}

function removeCode(section: 'financial' | 'budget', key: FinancialKey | BudgetKey, code: string) {
  if (section === 'financial') {
    const rule = config.financial[key as FinancialKey]
    rule.codeRoots = rule.codeRoots.filter(item => item !== code)
  } else {
    const rule = config.budget[key as BudgetKey]
    rule.codeRoots = rule.codeRoots.filter(item => item !== code)
  }
}

async function saveRules() {
  saving.value = true
  try {
    await request.put('/system/params', {
      params: [
        { param_key: 'accounting_standard', param_value: standard.value },
        { param_key: 'dashboard_category_rules', param_value: JSON.stringify(config) },
      ],
    })
    showSuccess('首页取数规则已保存')
    await loadData()
  } catch (error) {
    showOperationError('保存首页取数规则', error)
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.rules-page { min-height: 100%; padding: 20px; background: var(--el-bg-color-page); }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.page-header__left { display: flex; align-items: flex-start; gap: 12px; }
.page-header h2, .section-title h3, .rule-card h4 { margin: 0; }
.page-header p, .section-title p, .rule-card p { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
.page-header__actions { display: flex; gap: 10px; }
.standard-card { margin-bottom: 18px; }
.standard-card :deep(.el-form-item) { margin-bottom: 14px; }
.rule-section { margin-top: 18px; }
.rule-section--budget { padding-top: 2px; }
.section-title { display: flex; justify-content: space-between; margin-bottom: 12px; }
.rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.rule-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rule-card { min-height: 150px; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 10px; background: var(--el-bg-color); }
.rule-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rule-card__tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
@media (max-width: 900px) {
  .page-header { align-items: flex-start; flex-direction: column; }
  .rule-grid, .rule-grid--two { grid-template-columns: 1fr; }
}
</style>
