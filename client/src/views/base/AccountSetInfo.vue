<template>
  <div class="page asi-page">
    <!-- 顶部导航条：返回 + 标题 + 关键信息 + 操作 -->
    <div class="asi-header">
      <div class="asi-header__left">
        <el-button link size="small" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>返回
        </el-button>
        <span class="asi-header__sep">/</span>
        <span class="asi-header__title">套账信息</span>
        <el-tag v-if="editing" size="small" type="warning" effect="plain" style="margin-left: 8px">
          编辑中
        </el-tag>
        <el-tag v-if="accountSetName" size="small" effect="plain" style="margin-left: 8px">
          {{ accountSetName }}
        </el-tag>
        <el-tag size="small" type="info" effect="plain" style="margin-left: 4px">
          {{ meta.current_year }} 年第 {{ meta.current_period }} 期
        </el-tag>
      </div>
      <div class="asi-header__right">
        <template v-if="editing">
          <el-button size="small" :disabled="saving" @click="handleCancel">取消</el-button>
          <el-button
            type="primary"
            size="small"
            :loading="saving"
            :disabled="!isDirty"
            @click="handleSave"
          >
            保存
          </el-button>
        </template>
        <template v-else>
          <el-button size="small" @click="fetchData">刷新</el-button>
          <el-button v-if="canEdit" type="primary" size="small" @click="startEdit">
            修改参数
          </el-button>
        </template>
      </div>
    </div>

    <div v-loading="loading" class="asi-body">
      <!-- 单位与账套 -->
      <section class="asi-card asi-card--wide">
        <header class="asi-card__head">
          <span class="asi-card__marker" aria-hidden="true"></span>
          <h4 class="asi-card__title">单位与账套</h4>
          <span class="asi-card__sub">带锁的项目在建账时确定，不在本页修改</span>
        </header>
        <dl class="asi-list asi-list--2col">
          <div class="asi-row asi-row--span2">
            <dt>使用单位名称</dt>
            <dd>
              <el-input
                v-if="editing"
                v-model="draft.unit_name"
                class="asi-input--name"
                size="small"
                clearable
                placeholder="留空则取账套名称"
              />
              <template v-else>{{ unitName || '—' }}</template>
            </dd>
          </div>
          <div class="asi-row asi-row--span2">
            <dt>
              账套名称
              <el-tooltip content="账套档案，在「套账管理」中维护" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>{{ accountSetName || '—' }}</dd>
          </div>
          <div class="asi-row">
            <dt>
              建账日期
              <el-tooltip content="建账时确定，需通过「系统初始化」变更" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>{{ meta.start_date || '—' }}</dd>
          </div>
          <div class="asi-row">
            <dt>
              当前会计区间
              <el-tooltip content="由最新已过账凭证推算，随结账推进" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>{{ meta.current_year }} 年第 {{ meta.current_period }} 期</dd>
          </div>
          <div class="asi-row asi-row--span2">
            <dt>
              会计准则 / 取数口径
              <el-tooltip content="在「首页取数规则」页配置" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>{{ standardLabel }}</dd>
          </div>
        </dl>
      </section>

      <!-- 科目设置 -->
      <section class="asi-card">
        <header class="asi-card__head">
          <span class="asi-card__marker" aria-hidden="true"></span>
          <h4 class="asi-card__title">科目设置</h4>
          <span class="asi-card__sub">科目编码分级规则</span>
        </header>
        <dl class="asi-list">
          <div class="asi-row">
            <dt>
              科目级数
              <el-tooltip content="建账或「系统初始化」时确定，改动会与已有科目冲突" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>{{ form.account_levels }} 级</dd>
          </div>
          <div class="asi-row">
            <dt>
              每级编码长度
              <el-tooltip content="建账或「系统初始化」时确定，改动会与已有科目冲突" placement="top">
                <el-icon class="asi-lock"><Lock /></el-icon>
              </el-tooltip>
            </dt>
            <dd>
              <span class="asi-code-len">
                <template v-for="(len, index) in codeLengths" :key="index">
                  <span v-if="index > 0" class="asi-code-len__sep">-</span>
                  <span class="asi-code-len__seg">{{ len }}</span>
                </template>
              </span>
            </dd>
          </div>
          <div class="asi-row">
            <dt>本位币</dt>
            <dd>
              <el-input
                v-if="editing"
                v-model="draft.base_currency"
                size="small"
                :disabled="!draft.enable_foreign_currency"
                :placeholder="draft.enable_foreign_currency ? 'RMB' : '未启用外币核算'"
                style="width: 120px"
              />
              <template v-else>{{ form.base_currency || 'RMB' }}</template>
            </dd>
          </div>
        </dl>
      </section>

      <!-- 凭证设置 -->
      <section class="asi-card">
        <header class="asi-card__head">
          <span class="asi-card__marker" aria-hidden="true"></span>
          <h4 class="asi-card__title">凭证设置</h4>
          <span class="asi-card__sub">
            {{ editing ? '三个开关在下方「业务开关」中调整' : '编号规则与录入流程' }}
          </span>
        </header>
        <dl class="asi-list">
          <div class="asi-row">
            <dt>凭证编号规则</dt>
            <dd>
              <el-select v-if="editing" v-model="draft.voucher_no_rule" size="small" style="width: 160px">
                <el-option label="按凭证类型编号" value="by_type" />
                <el-option label="统一编号" value="unified" />
              </el-select>
              <template v-else>
                {{ VOUCHER_NO_RULE_LABELS[form.voucher_no_rule] || form.voucher_no_rule }}
              </template>
            </dd>
          </div>
          <div class="asi-row">
            <dt>凭证审核</dt>
            <dd :class="stateClass(current.require_audit)">
              {{ current.require_audit ? '启用' : '不启用' }}
            </dd>
          </div>
          <div class="asi-row">
            <dt>直接打印</dt>
            <dd :class="stateClass(current.direct_print)">
              {{ current.direct_print ? '已开启' : '已关闭' }}
            </dd>
          </div>
          <div class="asi-row">
            <dt>凭证时序控制</dt>
            <dd :class="stateClass(current.voucher_time_control)">
              {{ current.voucher_time_control ? '已开启' : '已关闭' }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- 业务开关 -->
      <section class="asi-card asi-card--wide">
        <header class="asi-card__head">
          <span class="asi-card__marker" aria-hidden="true"></span>
          <h4 class="asi-card__title">业务开关</h4>
          <span class="asi-card__sub">影响可用的账簿与报表</span>
        </header>
        <div class="asi-switches">
          <div
            v-for="sw in switches"
            :key="sw.key"
            class="asi-switch"
            :class="{ 'is-on': sw.on }"
          >
            <span class="asi-switch__dot" aria-hidden="true"></span>
            <span class="asi-switch__label">{{ sw.label }}</span>
            <el-switch
              v-if="editing"
              v-model="draft[sw.key]"
              size="small"
              inline-prompt
              active-text="开"
              inactive-text="关"
            />
            <span v-else class="asi-switch__state">{{ sw.on ? '已开启' : '已关闭' }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { ArrowLeft, Lock } from '@element-plus/icons-vue'
import request from '@/api/request'
import { showSuccess, showOperationError } from '@/composables/useMessage'
import { hasPermission } from '@/utils/permission'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useUserStore } from '@/stores/user'

interface SystemParam {
  param_key: string
  param_value: string
}

/** 取值口径与「系统参数 > 总账」保持一致 */
const VOUCHER_NO_RULE_LABELS: Record<string, string> = {
  by_type: '按凭证类型编号',
  unified: '统一编号',
}

const ACCOUNTING_STANDARD_LABELS: Record<string, string> = {
  auto: '自动识别',
  government: '政府会计制度',
  small_business: '小企业会计准则',
  enterprise: '新企业会计准则',
  custom: '自定义',
}

const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const editing = ref(false)
const saving = ref(false)

const form = ref({
  unit_name: '',
  accounting_standard: 'auto',
  voucher_no_rule: 'by_type',
  require_audit: true,
  direct_print: false,
  voucher_time_control: false,
  enable_cash_flow: false,
  enable_foreign_currency: false,
  base_currency: 'RMB',
  account_levels: 6,
  account_code_lengths: [4, 2, 2, 2, 2, 2, 2, 2, 2, 2] as number[],
})
const meta = ref({
  unit_name: '',
  start_date: '',
  current_year: new Date().getFullYear(),
  current_period: new Date().getMonth() + 1,
  resolved_accounting_standard_name: '',
})

/** 本页可写的 8 个参数；编辑期间只改 draft，取消即丢弃 */
const draft = reactive({
  unit_name: '',
  voucher_no_rule: 'by_type',
  require_audit: true,
  direct_print: false,
  voucher_time_control: false,
  enable_cash_flow: false,
  enable_foreign_currency: false,
  base_currency: 'RMB',
})
type DraftKey = keyof typeof draft
/** 进入编辑态时的快照，用于判断是否有未保存改动 */
const snapshot = ref('')

const accountSetName = computed(() => userStore.accountSetName)
const unitName = computed(() => form.value.unit_name || meta.value.unit_name)
/** 参数写入需要 system:account（PUT /system/params 的权限码） */
const canEdit = computed(() => hasPermission('system:account'))
const isDirty = computed(() => JSON.stringify(draft) !== snapshot.value)

/** 编辑态下各处显示跟随草稿，退出编辑后回到服务端值 */
const current = computed(() => (editing.value ? draft : form.value))

const standardLabel = computed(
  () =>
    meta.value.resolved_accounting_standard_name ||
    ACCOUNTING_STANDARD_LABELS[form.value.accounting_standard] ||
    '未设置'
)

const codeLengths = computed(() =>
  form.value.account_code_lengths.slice(0, form.value.account_levels)
)

const SWITCH_ITEMS: Array<{ key: DraftKey; label: string }> = [
  { key: 'require_audit', label: '凭证审核' },
  { key: 'direct_print', label: '直接打印' },
  { key: 'voucher_time_control', label: '凭证时序控制' },
  { key: 'enable_cash_flow', label: '现金流量表' },
  { key: 'enable_foreign_currency', label: '外币核算' },
]

const switches = computed(() =>
  SWITCH_ITEMS.map(item => ({ ...item, on: !!(current.value as any)[item.key] }))
)

function stateClass(on: boolean) {
  return on ? 'asi-state asi-state--on' : 'asi-state asi-state--off'
}

const BOOL_KEYS: string[] = [
  'require_audit',
  'direct_print',
  'voucher_time_control',
  'enable_cash_flow',
  'enable_foreign_currency',
]
const TEXT_KEYS: string[] = ['unit_name', 'accounting_standard', 'voucher_no_rule', 'base_currency']
/** 提交给 PUT /system/params 的键，顺序与 Param.vue 的总账页签一致 */
const EDITABLE_KEYS: DraftKey[] = [
  'unit_name',
  'voucher_no_rule',
  'require_audit',
  'direct_print',
  'voucher_time_control',
  'enable_cash_flow',
  'enable_foreign_currency',
  'base_currency',
]

async function fetchData() {
  loading.value = true
  try {
    const res = await request.get<SystemParam[]>('/system/params')
    for (const p of (res.data || []) as SystemParam[]) {
      if (BOOL_KEYS.includes(p.param_key)) {
        ;(form.value as any)[p.param_key] = p.param_value === 'true'
      } else if (TEXT_KEYS.includes(p.param_key)) {
        if (p.param_value) (form.value as any)[p.param_key] = p.param_value
      } else if (p.param_key === 'account_levels') {
        form.value.account_levels = parseInt(p.param_value) || 6
      } else if (p.param_key === 'account_code_lengths') {
        try {
          const lengths = JSON.parse(p.param_value)
          if (Array.isArray(lengths) && lengths.length) form.value.account_code_lengths = lengths
        } catch {
          /* 解析失败保持默认值 */
        }
      }
    }
    const meta_ = (res as any).meta
    if (meta_) meta.value = { ...meta.value, ...meta_ }
  } catch (error) {
    showOperationError('加载套账信息', error)
  } finally {
    loading.value = false
  }
}

function startEdit() {
  // 单位名称留空时服务端回退账套名，这里带上回退值，避免用户误以为没设置
  draft.unit_name = unitName.value
  draft.voucher_no_rule = form.value.voucher_no_rule
  draft.require_audit = form.value.require_audit
  draft.direct_print = form.value.direct_print
  draft.voucher_time_control = form.value.voucher_time_control
  draft.enable_cash_flow = form.value.enable_cash_flow
  draft.enable_foreign_currency = form.value.enable_foreign_currency
  draft.base_currency = form.value.base_currency || 'RMB'
  snapshot.value = JSON.stringify(draft)
  editing.value = true
}

async function confirmDiscard() {
  if (!isDirty.value) return true
  try {
    await ElMessageBox.confirm('有未保存的修改，确定放弃吗？', '提示', {
      type: 'warning',
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
    })
    return true
  } catch {
    return false
  }
}

async function handleCancel() {
  if (!(await confirmDiscard())) return
  editing.value = false
}

async function handleSave() {
  saving.value = true
  try {
    const params: SystemParam[] = EDITABLE_KEYS.map(key => {
      const value = draft[key]
      return {
        param_key: key,
        param_value:
          typeof value === 'boolean'
            ? String(value)
            : key === 'base_currency'
              ? value || 'RMB'
              : value,
      }
    })
    await request.put('/system/params', { params })
    // 现金流/外币开关会改变左侧导航与默认落地页，必须强制刷新参数 store
    await useSystemParamsStore().load(true)
    await fetchData()
    editing.value = false
    showSuccess('保存成功')
  } catch (error) {
    showOperationError('保存套账信息', error)
  } finally {
    saving.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/group/财务总账')
}

onBeforeRouteLeave(async () => {
  if (!editing.value) return true
  return await confirmDiscard()
})

onMounted(fetchData)
</script>

<style scoped>
.asi-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ---- 顶部导航条 ---- */
.asi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--wb-line, var(--el-border-color-lighter));
  background: var(--wb-card, #fff);
  flex-shrink: 0;
}

.asi-header__left,
.asi-header__right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.asi-header__sep {
  color: var(--el-text-color-placeholder);
}

.asi-header__title {
  font-size: var(--cw-text-base);
  font-weight: 600;
}

/* ---- 主体：两列卡片栅格 ---- */
.asi-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
}

.asi-card {
  border: 1px solid var(--wb-line, var(--el-border-color-lighter));
  border-radius: var(--wb-radius, 6px);
  background: var(--wb-card, #fff);
  overflow: hidden;
}

.asi-card--wide {
  grid-column: 1 / -1;
}

.asi-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  background: var(--surface-brand-soft, #f0fdf4);
  border-bottom: 1px solid var(--wb-line, var(--el-border-color-lighter));
}

.asi-card__marker {
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--mint-500, #10b981);
}

.asi-card__title {
  margin: 0;
  font-size: var(--cw-text-sm);
  font-weight: 600;
  color: var(--mint-800, #065f46);
}

.asi-card__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---- 明细行 ---- */
.asi-list {
  margin: 0;
  padding: 6px 12px 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0 24px;
}

.asi-list--2col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.asi-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  border-bottom: 1px dashed var(--wb-line, var(--el-border-color-lighter));
}

.asi-row--span2 {
  grid-column: 1 / -1;
}

.asi-row:last-child {
  border-bottom: none;
}

.asi-row dt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  width: 128px;
  flex-shrink: 0;
  font-size: var(--cw-text-sm);
  color: var(--el-text-color-secondary);
}

.asi-row dd {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: var(--cw-text-sm);
  color: var(--el-text-color-primary);
  word-break: break-all;
}

/* 单位名称往往很长（如「车子物流（深圳）有限公司」），输入框占满整行 */
.asi-input--name {
  width: 100%;
  max-width: 560px;
}

:deep(.asi-lock) {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  cursor: help;
}

/* 编码长度分段：4-2-2-2 */
.asi-code-len {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.asi-code-len__seg {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--wb-line, var(--el-border-color-lighter));
  border-radius: 3px;
  background: var(--el-fill-color-lighter);
  font-size: 12px;
}

.asi-code-len__sep {
  color: var(--el-text-color-placeholder);
}

.asi-state--on {
  color: var(--mint-700, #047857);
}

.asi-state--off {
  color: var(--el-text-color-secondary);
}

/* ---- 业务开关 ---- */
.asi-switches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  padding: 10px 12px 12px;
}

.asi-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--wb-line, var(--el-border-color-lighter));
  border-radius: var(--wb-radius-sm, 4px);
  background: var(--el-fill-color-blank);
  font-size: var(--cw-text-sm);
}

.asi-switch__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

.asi-switch.is-on {
  border-color: var(--mint-500, #10b981);
  background: var(--surface-brand-soft, #f0fdf4);
}

.asi-switch.is-on .asi-switch__dot {
  background: var(--mint-500, #10b981);
}

.asi-switch__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asi-switch__state {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.asi-switch.is-on .asi-switch__state {
  color: var(--mint-700, #047857);
}

@media (max-width: 900px) {
  .asi-body,
  .asi-list--2col {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
