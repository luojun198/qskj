<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-header">
        <h2>{{ brandingStore.title }}{{ brandingStore.subtitle ? ' · ' + brandingStore.subtitle : '' }}</h2>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="accountSetId">
          <el-select
            v-model="form.accountSetId"
            placeholder="请选择账套"
            prefix-icon="OfficeBuilding"
            style="width: 100%"
            filterable
          >
            <el-option
              v-for="item in accountSets"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            >
              <span style="float: left">{{ item.name }}</span>
              <span style="float: right; color: #8492a6; font-size: 12px">{{ item.code }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item prop="username">
          <el-select
            v-model="form.username"
            placeholder="请选择操作员"
            style="width: 100%"
            filterable
            clearable
            autocomplete="username"
            :disabled="!form.accountSetId"
            @keyup.enter="handleLogin"
          >
            <el-option
              v-for="item in userList"
              :key="item.username"
              :label="item.nickname ? `${item.nickname}（${item.username}）` : item.username"
              :value="item.username"
            >
              <span style="float: left">{{ item.username }}</span>
              <span v-if="item.nickname" style="float: right; color: #8492a6; font-size: 12px">{{ item.nickname }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            name="password"
            type="password"
            placeholder="密码"
            prefix-icon="Lock"
            show-password
            autocomplete="current-password"
            @input="syncPasswordFromNativeInput"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item class="login-submit-item">
          <el-checkbox v-model="rememberMe">记住账号密码</el-checkbox>
          <el-button
            type="primary"
            :loading="loading"
            style="width: 100%"
            @click="handleLogin"
            >登 录</el-button
          >
        </el-form-item>
      </el-form>

      <div class="login-footer">
        <el-button text size="small" @click="showCreateDialog = true">
          <el-icon style="margin-right: 4px"><Plus /></el-icon>新增账套
        </el-button>
        <el-button text size="small" @click="showImportDialog = true">
          <el-icon style="margin-right: 4px"><Upload /></el-icon>导入账套
        </el-button>
      </div>

      <p class="login-version" :class="{ 'is-mismatch': buildVersionMismatch }">
        {{ buildVersionLabel }}
        <span v-if="buildVersionMismatch" class="login-version__warn">前后端版本不一致</span>
      </p>
    </div>

    <!-- 新增账套弹窗 -->
    <el-dialog
      v-model="showCreateDialog"
      title="新增账套"
      width="480px"
      class="create-account-dialog"
      :close-on-click-modal="false"
    >
      <el-form
        ref="createFormRef"
        :model="createForm"
        :rules="createRules"
        label-width="108px"
        size="small"
        class="create-account-form"
      >
        <el-form-item label="单位名称" prop="name">
          <el-input v-model="createForm.name" placeholder="例如：某某单位" maxlength="100" />
        </el-form-item>
        <el-form-item label="账套编码">
          <el-input v-model="createForm.code" disabled placeholder="自动生成" />
        </el-form-item>
        <el-form-item label="选择模版">
          <el-radio-group v-model="createForm.use_template" class="template-radio-group">
            <el-radio :value="true">标准模版</el-radio>
            <el-radio :value="false">空账套</el-radio>
          </el-radio-group>
          <StandardTemplateSelect
            v-if="createForm.use_template"
            v-model="createForm.standard_template_id"
            :templates="standardTemplates"
            :groups="standardTemplateGroups"
            placeholder="选择会计准则 / 科目体系模版"
            size="small"
            clearable
            class="template-select"
          />
          <div v-if="createForm.use_template && selectedTemplate" class="template-hint">
            {{ selectedTemplate.description }}
          </div>
        </el-form-item>
        <el-form-item label="统一社会信用代码">
          <el-input v-model="createForm.credit_code" maxlength="18" />
        </el-form-item>
        <el-form-item label="隶属财政部门">
          <el-input v-model="createForm.fiscal_dept" />
        </el-form-item>
        <el-form-item label="账套启用日期" prop="start_date">
          <el-date-picker
            v-model="createForm.start_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="选择启用日期"
          />
        </el-form-item>
        <el-form-item label="单位负责人">
          <el-input v-model="createForm.unit_leader" />
        </el-form-item>
        <el-form-item label="财务负责人">
          <el-input v-model="createForm.chief_accountant" />
        </el-form-item>
        <el-form-item v-if="!createForm.use_template" label="科目级数">
          <el-input-number
            v-model="createForm.account_levels"
            :min="1" :max="10"
            :controls="false"
            style="width: 100px"
          />
        </el-form-item>
        <el-form-item v-if="!createForm.use_template" label="科目长度">
          <div class="code-lengths-row">
            <template v-for="(_, index) in Array(createForm.account_levels)" :key="index">
              <span v-if="index > 0" class="lengths-sep">-</span>
              <el-input-number
                v-model="createForm.account_code_lengths[index]"
                :min="1" :max="9"
                :controls="false"
                style="width: 52px"
              />
            </template>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取 消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreate">创建账套</el-button>
      </template>
    </el-dialog>

    <!-- 备份导入弹窗 -->
    <el-dialog
      v-model="showImportDialog"
      title="导入账套"
      width="520px"
      :close-on-click-modal="false"
      @closed="resetImportForm"
    >
      <el-alert
        type="info"
        :closable="false"
        style="margin-bottom: 16px"
      >
        <template #title>
          支持导入单账套 SQLite 备份（.db，由系统内「单账套备份」导出）或润衡财务软件备份（.acd）。完整库备份请登录后在「数据安全 → 备份恢复」导入。
        </template>
      </el-alert>

      <el-form ref="importFormRef" :model="importForm" :rules="importRules" label-width="90px">
        <el-form-item label="备份文件" prop="file">
          <div class="file-pick-area">
            <input
              ref="fileInputRef"
              type="file"
              accept=".db,.acd"
              style="display: none"
              @change="onFileInputChange"
            />
            <el-button type="default" @click="fileInputRef?.click()">
              <el-icon style="margin-right: 4px"><UploadFilled /></el-icon>选择备份文件
            </el-button>
            <span v-if="importForm.file" class="file-name">{{ importForm.file.name }}</span>
            <span v-else class="file-hint">（支持 .db 和 .acd 格式）</span>
          </div>
          <div v-if="!importForm.file" style="color: #909399; font-size: 12px; margin-top: 4px">
            请先选择备份文件
          </div>
        </el-form-item>

        <el-form-item label="账套名称" prop="name">
          <el-input v-model="importForm.name" placeholder="例如：2025年度财务账套" maxlength="50" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showImportDialog = false">取 消</el-button>
        <el-button type="primary" :loading="importing" @click="handleImport">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 导入结果对话框 -->
    <el-dialog
      v-model="showImportResultDialog"
      :title="importResult.success ? '导入成功' : '导入失败'"
      width="520px"
      :close-on-click-modal="false"
      :show-close="false"
    >
      <div v-if="importResult.success" class="import-result-success">
        <div class="result-header">
          <el-icon class="success-icon" color="#67c23a" :size="48"><CircleCheck /></el-icon>
          <h3>账套导入完成</h3>
          <p>导入结果已整理好，详细统计和提示信息可点击查看。</p>
        </div>

        <div class="result-info">
          <div class="info-item">
            <span class="label">账套名称：</span>
            <span class="value">{{ importResult.accountSetName }}</span>
          </div>
          <div v-if="importStatsSummary" class="info-item">
            <span class="label">导入摘要：</span>
            <span class="value">{{ importStatsSummary }}</span>
          </div>
          <div v-if="importResult.warnings.length > 0" class="info-item">
            <span class="label">提示信息：</span>
            <span class="value">{{ importResult.warnings.length }} 条，建议稍后查看详情确认</span>
          </div>
        </div>
      </div>

      <div v-else class="import-result-error">
        <div class="result-header">
          <el-icon class="error-icon" color="#f56c6c" :size="48"><CircleClose /></el-icon>
          <h3>导入失败</h3>
        </div>
        <div class="error-message">
          {{ importResult.errorMessage }}
        </div>
      </div>

      <template #footer>
        <el-button
          v-if="importResult.success"
          @click="handleImportDetailOpen"
        >
          查看导入详情
        </el-button>
        <el-button type="primary" @click="handleImportResultClose">确 定</el-button>
      </template>
    </el-dialog>

    <!-- 导入详情页面 -->
    <el-dialog
      v-model="showImportDetailDialog"
      title="导入详情"
      width="780px"
      :close-on-click-modal="false"
      @closed="resetImportResult"
    >
      <div class="import-detail-page">
        <div class="detail-account">
          <span class="detail-label">账套名称</span>
          <strong>{{ importResult.accountSetName }}</strong>
        </div>

        <div v-if="importResult.stats.length > 0" class="result-stats">
          <h4>导入统计</h4>
          <el-table :data="importResult.stats" style="width: 100%" size="small">
            <el-table-column prop="name" label="数据类型" width="160" />
            <el-table-column prop="count" label="数量" align="right" />
          </el-table>
        </div>

        <div class="result-warnings">
          <div class="warnings-title">
            <h4>提示信息</h4>
            <span>{{ importResult.warnings.length }} 条</span>
          </div>
          <el-empty
            v-if="importResult.warnings.length === 0"
            description="本次导入没有提示信息"
            :image-size="72"
          />
          <el-scrollbar v-else max-height="320px">
            <ul>
              <li v-for="(warning, index) in importResult.warnings" :key="index">{{ warning }}</li>
            </ul>
          </el-scrollbar>
        </div>
      </div>

      <template #footer>
        <el-button type="primary" @click="handleImportDetailClose">关 闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { getDefaultLandingPath } from '@/config/navigation'
import { useUserStore } from '@/stores/user'
import { loadHomePage } from '@/utils/homePreference'
import { useSystemParamsStore } from '@/stores/systemParams'
import { useLicenseStore } from '@/stores/license'
import { useBrandingStore } from '@/stores/branding'
import { getAccountSets, getUsersByAccountSet, backupImport, acdImport, type AccountSetItem, type UserItem } from '@/api/auth'
import { parseAccountSetName } from '@/utils/accountSetName'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { UploadFilled, Upload, CircleCheck, CircleClose, Plus } from '@element-plus/icons-vue'
import request from '@/api/request'
import { getAccountSetDefaultStartDate } from '@/utils/format'
import { useAppBuildInfo } from '@/composables/useAppBuildInfo'
import StandardTemplateSelect from '@/components/system/StandardTemplateSelect.vue'
import { fetchStandardTemplates as requestStandardTemplates } from '@/api/standardTemplates'
import {
  pickDefaultStandardTemplate,
  type StandardTemplateItem,
} from '@/utils/standardTemplateGroups'
import {
  clearRememberedLogin,
  loadRememberedLogin,
  readNativePassword,
  saveRememberedLogin,
} from '@/utils/rememberedLogin'

const router = useRouter()
const { label: buildVersionLabel, mismatch: buildVersionMismatch } = useAppBuildInfo()
const route = useRoute()
const userStore = useUserStore()
const brandingStore = useBrandingStore()
const systemParamsStore = useSystemParamsStore()
const formRef = ref<FormInstance>()
const importFormRef = ref<FormInstance>()
const createFormRef = ref<FormInstance>()
const fileInputRef = ref<HTMLInputElement>()
const loading = ref(false)
const accountSets = ref<AccountSetItem[]>([])
const userList = ref<UserItem[]>([])

const standardTemplates = ref<StandardTemplateItem[]>([])
const standardTemplateGroups = ref<string[]>([])
const selectedTemplate = computed(
  () => standardTemplates.value.find(item => item.id === createForm.standard_template_id) || null
)

const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = reactive({
  name: '',
  code: '',
  credit_code: '',
  fiscal_dept: '',
  start_date: getAccountSetDefaultStartDate(),
  unit_leader: '',
  chief_accountant: '',
  use_template: true,
  standard_template_id: '',
  account_levels: 6,
  account_code_lengths: [4, 2, 2, 2, 2, 2, 2, 2, 2, 2],
})

const createRules: FormRules = {
  name: [{ required: true, message: '请输入单位名称', trigger: 'blur' }],
  start_date: [{ required: true, message: '请选择启用日期', trigger: 'change' }],
}

// 导入相关
const showImportDialog = ref(false)
const importing = ref(false)
const importForm = reactive({
  file: null as File | null,
  name: '',
})

// 导入结果对话框
const showImportResultDialog = ref(false)
const showImportDetailDialog = ref(false)
const importResult = reactive({
  success: false,
  accountSetName: '',
  stats: [] as Array<{ name: string; count: string }>,
  warnings: [] as string[],
  errorMessage: '',
})
const importStatsSummary = computed(() => {
  return importResult.stats
    .slice(0, 3)
    .map(item => `${item.name}${item.count}`)
    .join('，')
})

const importRules: FormRules = {
  file: [{ required: true, message: '请上传备份文件', trigger: 'change' }],
  name: [{ required: true, message: '请输入账套名称', trigger: 'blur' }],
}

const form = reactive({
  accountSetId: '',
  username: '',
  password: '',
})

const rememberMe = ref(userStore.rememberMe)

const rules = {
  accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
  username: [{ required: true, message: '请选择操作员', trigger: 'change' }],
  // 密码不设必填：从 ACD 导入的账套里可能存在原本就没设密码的操作员，
  // 这类账号密码留空登录，密码对不对由后端判定。
  password: [],
}

function loginFormRoot(): HTMLElement | null {
  return (formRef.value?.$el as HTMLElement | undefined) || null
}

function syncPasswordFromNativeInput() {
  const native = readNativePassword(loginFormRoot())
  if (native && native !== form.password) {
    form.password = native
  }
}

async function fetchAccountSets(options?: {
  preferAccountSetId?: string
  silent?: boolean
  /** 创建/导入成功但列表接口暂时失败时，用此数据补全下拉框 */
  fallbackAccountSet?: AccountSetItem
}): Promise<boolean> {
  try {
    const res = await getAccountSets({ silent: options?.silent ?? true })
    accountSets.value = res.data || []
  } catch (error) {
    console.error('获取账套列表失败:', error)
    if (options?.fallbackAccountSet) {
      const exists = accountSets.value.some(item => item.id === options.fallbackAccountSet!.id)
      if (!exists) {
        accountSets.value = [options.fallbackAccountSet, ...accountSets.value]
      }
    }
    return false
  }

  const preferId = options?.preferAccountSetId
  if (preferId) {
    if (!accountSets.value.some(item => item.id === preferId) && options?.fallbackAccountSet) {
      accountSets.value = [
        options.fallbackAccountSet,
        ...accountSets.value.filter(item => item.id !== options.fallbackAccountSet!.id),
      ]
    }
    if (accountSets.value.some(item => item.id === preferId)) {
      form.accountSetId = preferId
      await fetchUsers(preferId)
      return true
    }
    return false
  }

  const querySetId = route.query.targetAccountSetId as string
  if (querySetId && accountSets.value.some(item => item.id === querySetId)) {
    form.accountSetId = querySetId
    await fetchUsers(querySetId)
  }
  return true
}

// 获取标准模版列表
async function fetchStandardTemplates() {
  try {
    const result = await requestStandardTemplates('auth', { skipErrorToast: true })
    standardTemplates.value = result.templates
    standardTemplateGroups.value = result.groups
    if (
      createForm.use_template &&
      !createForm.standard_template_id &&
      standardTemplates.value.length > 0
    ) {
      createForm.standard_template_id = pickDefaultStandardTemplate(standardTemplates.value)
    }
  } catch {
    standardTemplates.value = []
    standardTemplateGroups.value = []
  }
}

// 获取指定账套的用户列表
async function fetchUsers(accountSetId: string) {
  if (!accountSetId) {
    userList.value = []
    return
  }
  try {
    const res = await getUsersByAccountSet(accountSetId, { silent: true })
    userList.value = res.data || []
  } catch (error) {
    console.error('获取用户列表失败:', error)
    userList.value = []
  }
}

function queryUsers(queryString: string, cb: (items: UserItem[]) => void) {
  const keyword = queryString.trim().toLowerCase()
  const list = keyword
    ? userList.value.filter(user =>
        user.username.toLowerCase().includes(keyword) ||
        (user.nickname || '').toLowerCase().includes(keyword)
      )
    : userList.value
  cb(list)
}

// 监听账套变化，自动加载用户列表
watch(showCreateDialog, visible => {
  if (visible) {
    createForm.start_date = getAccountSetDefaultStartDate()
  }
})

watch(() => form.accountSetId, (newAccountSetId) => {
  if (newAccountSetId) {
    fetchUsers(newAccountSetId)
  } else {
    userList.value = []
  }
})

async function handleLogin() {
  syncPasswordFromNativeInput()
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const res = await userStore.loginAction({
      username: form.username,
      password: form.password,
      targetAccountSetId: form.accountSetId,
      rememberMe: rememberMe.value,
    })

    await afterLoginSuccess(res)
  } catch (error: any) {
    if (error?.response?.data?.code !== 40901) return

    const data = error.response.data.data || {}
    try {
      await ElMessageBox.confirm(
        `该账号已在 IP ${formatLoginIp(data.activeLoginIp)} 登录，是否强制登录？`,
        '确认强制登录',
        {
          confirmButtonText: '强制登录',
          cancelButtonText: '取消',
          type: 'warning',
        }
      )
    } catch {
      return
    }

    const res = await userStore.loginAction({
      username: form.username,
      password: form.password,
      targetAccountSetId: form.accountSetId,
      forceLogin: true,
      rememberMe: rememberMe.value,
    })
    await afterLoginSuccess(res, true)
  } finally {
    loading.value = false
  }
}

async function afterLoginSuccess(res: any, forcedLogin = false) {
  // 记住上次成功登录的账套（独立于 logout 时会被清掉的 accountSetId 键），
  // 用于下次进入登录页自动恢复账套选择
  if (form.accountSetId) {
    localStorage.setItem('lastAccountSetId', form.accountSetId)
  }

  // 处理记住账号密码逻辑
  if (rememberMe.value) {
    saveRememberedLogin({
      username: form.username,
      password: form.password,
      accountSetId: form.accountSetId,
    })
    userStore.rememberMe = true
  } else {
    clearRememberedLogin()
    userStore.rememberMe = false
  }

  if ((forcedLogin || res.forcedLogin) && res.forcedOldLoginIp) {
    try {
      await ElMessageBox.confirm('已强制登录另一台电脑，是否现在前往用户管理修改账户密码？', '安全提示', {
        confirmButtonText: '修改密码',
        cancelButtonText: '稍后',
        type: 'warning',
      })
      queueLastLoginNotice(res.lastLoginTime, res.lastLoginIp)
      router.push('/system/user')
      return
    } catch {
      // 用户选择稍后处理
    }
  }

  queueLastLoginNotice(res.lastLoginTime, res.lastLoginIp)
  await systemParamsStore.load()
  const home = loadHomePage(userStore.userInfo?.username || '', userStore.accountSetId || '')
  await router.push(
    getDefaultLandingPath(
      userStore.permissions,
      systemParamsStore.enableCashFlow,
      useLicenseStore().modules,
      home
    )
  )
}

function formatLoginIp(ip?: string | null) {
  const value = (ip || '').trim()
  if (!value) return '无记录'
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value === '::ffff:127.0.0.1') {
    return '本机（127.0.0.1）'
  }
  if (value.startsWith('::ffff:')) {
    return value.replace('::ffff:', '')
  }
  return value
}

function queueLastLoginNotice(lastLoginTime?: string | null, lastLoginIp?: string | null) {
  if (!lastLoginTime && !lastLoginIp) return
  sessionStorage.setItem(
    'lastLoginNotice',
    JSON.stringify({
      lastLoginTime: lastLoginTime || '',
      lastLoginIp: lastLoginIp || '',
    })
  )
}

// 文件选择（原生 input，避免 el-upload 内部 iframe）
function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  importForm.file = input.files?.[0] || null
  // 清空 input 以便再次选择同一文件
  input.value = ''
  importFormRef.value?.validateField('file')

  // 智能解析文件名为账套名称
  if (importForm.file) {
    const parsedName = parseAccountSetName(importForm.file.name)
    if (parsedName) {
      importForm.name = parsedName
    }
  }
}

function resetImportForm() {
  importFormRef.value?.resetFields()
  importForm.file = null
  if (fileInputRef.value) fileInputRef.value.value = ''
}

// 创建账套
async function handleCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return

  creating.value = true
  try {
    const payload: any = { ...createForm }
    // 自动从启用日期推算会计年度
    if (payload.start_date) {
      payload.fiscal_year = parseInt(payload.start_date.substring(0, 4), 10)
    } else {
      payload.fiscal_year = new Date().getFullYear()
    }

    if (payload.use_template && !payload.standard_template_id) {
      ElMessage.warning('请选择标准模板')
      return
    }

    let result: any
    const fromStandardTemplate = payload.use_template && payload.standard_template_id
    if (fromStandardTemplate) {
      result = await request.post('/auth/account-sets/create-from-standard-template', payload, {
        timeout: 120000,
        skipErrorToast: true,
      })
    } else {
      result = await request.post('/auth/account-sets/create', payload, {
        skipErrorToast: true,
      })
    }

    if (result?.code !== 0) {
      throw new Error(result?.message || '创建失败')
    }

    const created: any = result?.data
    const newAccountSetId = created?.id
    const fallbackAccountSet: AccountSetItem | undefined =
      newAccountSetId && created?.name
        ? { id: newAccountSetId, name: created.name, code: created.code || '' }
        : undefined

    showCreateDialog.value = false
    createFormRef.value?.resetFields()

    if (!newAccountSetId) {
      await fetchAccountSets({ silent: true })
      ElMessage.warning('账套已创建，但未返回账套 ID，请在下拉框中手动选择账套')
      return
    }

    const refreshed = await fetchAccountSets({
      preferAccountSetId: newAccountSetId,
      silent: true,
      fallbackAccountSet,
    })
    form.username = 'admin'

    const createSummary = fromStandardTemplate
      ? '账套已从标准模板创建成功'
      : '账套创建成功'
    ElMessage.success({
      message: refreshed
        ? `${createSummary}，已自动选中新建账套。请使用 admin / admin123 登录`
        : `${createSummary}。请在下拉框中选择新建账套，使用 admin / admin123 登录`,
      duration: 6000,
      showClose: true,
    })
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

// 导入账套
async function handleImport() {
  const valid = await importFormRef.value?.validate().catch(() => false)
  if (!valid) return

  if (!importForm.file) {
    ElMessage.warning('请上传备份文件')
    return
  }

  // 根据文件扩展名判断导入类型
  const fileName = importForm.file.name.toLowerCase()
  const fileExt = fileName.split('.').pop()

  if (fileExt !== 'db' && fileExt !== 'acd') {
    ElMessage.error('不支持的文件格式，请选择 .db 或 .acd 文件')
    return
  }

  importing.value = true
  try {
    let result
    if (fileExt === 'acd') {
      // ACD 导入
      result = await acdImport(
        importForm.file,
        importForm.name
      )

      // 准备导入结果数据
      const data = result.data
      const stats = []
      if (data.imported.accounts) stats.push({ name: '科目', count: `${data.imported.accounts} 个` })
      if (data.imported.initBalances) stats.push({ name: '期初余额', count: `${data.imported.initBalances} 条` })
      if (data.imported.transferTypes) stats.push({ name: '结转类型', count: `${data.imported.transferTypes} 种 (${data.imported.transferItems} 条分录)` })
      if (data.imported.vouchers) stats.push({ name: '凭证', count: `${data.imported.vouchers} 张 (${data.imported.voucherEntries} 条分录)` })
      if (data.imported.reportDefinitions) stats.push({ name: '报表模板', count: `${data.imported.reportDefinitions} 个` })
      if (data.imported.standardReports) stats.push({ name: '标准报表', count: `${data.imported.standardReports} 张` })

      // 显示导入结果对话框
      importResult.success = true
      importResult.accountSetName = data.name
      importResult.stats = stats
      importResult.warnings = data.warnings || []
      showImportResultDialog.value = true
    } else {
      // .db 导入
      result = await backupImport(
        importForm.file,
        importForm.name
      )

      const data = result.data
      const stats = []
      if (data.imported.accounts) stats.push({ name: '科目', count: `${data.imported.accounts} 个` })
      if (data.imported.initBalances) stats.push({ name: '期初余额', count: `${data.imported.initBalances} 条` })
      if (data.imported.vouchers) stats.push({ name: '凭证', count: `${data.imported.vouchers} 张 (${data.imported.entries} 条分录)` })
      if (data.imported.users) stats.push({ name: '用户', count: `${data.imported.users} 个` })

      // 显示导入结果对话框
      importResult.success = true
      importResult.accountSetName = data.name
      importResult.stats = stats
      importResult.warnings = []
      showImportResultDialog.value = true
    }

    // 关闭导入弹窗
    showImportDialog.value = false
    resetImportForm()

    const imported = result?.data
    const importedAccountSetId = imported?.id
    const fallbackAccountSet: AccountSetItem | undefined =
      importedAccountSetId && imported?.name
        ? { id: importedAccountSetId, name: imported.name, code: imported.code || '' }
        : undefined

    await fetchAccountSets({
      preferAccountSetId: importedAccountSetId,
      silent: true,
      fallbackAccountSet,
    })

    if (!importedAccountSetId) {
      ElMessage.warning('导入完成，但未返回账套 ID，请在下拉框中手动选择账套')
      return
    }

    form.username = 'admin'
  } catch (error: any) {
    // 显示导入失败对话框
    importResult.success = false
    importResult.errorMessage = error?.response?.data?.message || error.message || '导入失败，请检查文件格式'
    showImportResultDialog.value = true
  } finally {
    importing.value = false
  }
}

// 关闭导入结果对话框
function handleImportResultClose() {
  showImportResultDialog.value = false
  resetImportResult()
  if (!importResult.success) {
    resetImportForm()
  }
}

function handleImportDetailOpen() {
  showImportResultDialog.value = false
  showImportDetailDialog.value = true
}

function handleImportDetailClose() {
  showImportDetailDialog.value = false
}

function resetImportResult() {
  showImportDetailDialog.value = false
  importResult.success = false
  importResult.accountSetName = ''
  importResult.stats = []
  importResult.warnings = []
  importResult.errorMessage = ''
}

onMounted(async () => {
  void brandingStore.load()
  // 优先级：URL targetAccountSetId > localStorage.lastAccountSetId > 不预选
  const queryTargetId = route.query.targetAccountSetId as string | undefined
  const rememberedAccountSetId = localStorage.getItem('lastAccountSetId') || undefined
  const preferAccountSetId = queryTargetId || rememberedAccountSetId

  await fetchAccountSets({
    preferAccountSetId,
    silent: true,
  }).catch(() => {})
  fetchStandardTemplates()

  // 回填记住的账号密码（用户名需在用户列表加载后再设，
  // 否则 el-select 找不到 option 不会显示已选项的 label）
  const remembered = loadRememberedLogin()
  rememberMe.value = remembered.rememberMe
  userStore.rememberMe = remembered.rememberMe
  if (remembered.username) {
    form.username = remembered.username
  }
  if (remembered.password) {
    form.password = remembered.password
    await nextTick()
    formRef.value?.clearValidate('password')
  }

  // 浏览器可能稍后才把密码填进原生 input，Vue v-model 感知不到
  window.setTimeout(syncPasswordFromNativeInput, 80)
  window.setTimeout(syncPasswordFromNativeInput, 400)
})
</script>

<style scoped>
@import './Login.styles.css';
</style>
