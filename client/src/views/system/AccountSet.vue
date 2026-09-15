<template>
  <PageListLayout title="账套管理">
    <template #actions>
      <el-button type="primary" @click="openDialog('add')">新增账套</el-button>
    </template>

    <el-table
      ref="tableRef"
      :data="list"
      stripe
      border
      size="small"
      class="compact-data-table"
      height="100%"
      @header-dragend="onDragEnd"
    >
      <el-table-column prop="name" label="单位名称" />
      <el-table-column prop="code" label="账套编码" :width="colWidth('code', 120)" />
      <el-table-column prop="credit_code" label="统一社会信用代码" :width="colWidth('credit_code', 180)" />
      <el-table-column prop="start_date" label="启用日期" :width="colWidth('start_date', 120)" />
      <el-table-column prop="chief_accountant" label="财务负责人" :width="colWidth('chief_accountant', 100)" />
      <el-table-column prop="status" label="状态" :width="colWidth('status', 100)">
        <template #default="{ row }">
          <div class="status-cell">
            <div class="status-tags">
              <el-tag
                :type="
                  row.status === 'active' ? 'success' : row.status === 'inactive' ? 'warning' : 'danger'
                "
                size="small"
                class="status-tag"
              >
                {{
                  ({ active: '启用', inactive: '停用' } as Record<string, string>)[
                    row.status
                  ] || row.status
                }}
              </el-tag>
              <el-tag 
                v-if="row.id === currentAccountSetId" 
                type="primary" 
                size="small" 
                class="current-tag"
              >
                当前
              </el-tag>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 200)" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.id !== currentAccountSetId" link type="success" size="small" @click="handleSelect(row)">选择</el-button>
          <el-button link type="primary" size="small" @click="openDialog('edit', row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="480px"
      class="create-account-dialog"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-width="108px"
        size="small"
        class="create-account-form"
      >
        <el-form-item label="单位名称" prop="name">
          <el-input v-model="form.name" placeholder="例如:某某单位" maxlength="100" />
        </el-form-item>
        <el-form-item label="账套编码">
          <el-input v-model="form.code" disabled placeholder="自动生成" />
        </el-form-item>
        <el-form-item v-if="dialogType === 'add'" label="选择模版">
          <el-radio-group v-model="form.use_template" class="template-radio-group">
            <el-radio :label="true">标准模版</el-radio>
            <el-radio :label="false">空账套</el-radio>
          </el-radio-group>
          <StandardTemplateSelect
            v-if="form.use_template"
            v-model="form.standard_template_id"
            :templates="standardTemplates"
            :groups="standardTemplateGroups"
            placeholder="选择会计准则 / 科目体系模版"
            clearable
            class="template-select"
          />
          <div v-if="form.use_template" class="template-hint">
            <span v-if="selectedTemplate">{{ selectedTemplate.description }}</span>
            <el-button
              link
              type="primary"
              size="small"
              :loading="templateRefreshing"
              class="template-refresh"
              @click="reloadStandardTemplates"
            >
              刷新模版目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="统一社会信用代码">
          <el-input v-model="form.credit_code" maxlength="18" />
        </el-form-item>
        <el-form-item label="隶属财政部门">
          <el-input v-model="form.fiscal_dept" />
        </el-form-item>
        <el-form-item label="账套启用日期" prop="start_date">
          <el-date-picker
            v-model="form.start_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            placeholder="选择启用日期"
          />
        </el-form-item>
        <el-form-item label="单位负责人">
          <el-input v-model="form.unit_leader" />
        </el-form-item>
        <el-form-item label="财务负责人">
          <el-input v-model="form.chief_accountant" />
        </el-form-item>
        <el-form-item v-if="dialogType === 'add' && !form.use_template" label="科目级数">
          <el-input-number
            v-model="form.account_levels"
            :min="1" :max="10"
            :controls="false"
            style="width: 100px"
          />
        </el-form-item>
        <el-form-item v-if="dialogType === 'add' && !form.use_template" label="科目长度">
          <div class="code-lengths-row">
            <template v-for="(_, index) in Array(form.account_levels)" :key="index">
              <span v-if="index > 0" class="lengths-sep">-</span>
              <el-input-number
                v-model="form.account_code_lengths[index]"
                :min="1" :max="9"
                :controls="false"
                style="width: 52px"
              />
            </template>
          </div>
        </el-form-item>
        <template v-if="dialogType === 'edit'">
          <el-form-item label="科目级数">
            <span class="readonly-value">{{ form.account_levels ?? 6 }} 级</span>
          </el-form-item>
          <el-form-item label="科目长度">
            <span class="readonly-value">
              {{ (form.account_code_lengths || []).slice(0, form.account_levels ?? 6).join(' - ') }}
            </span>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option label="启用" value="active" />
              <el-option label="停用" value="inactive" />
            </el-select>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">
          {{ dialogType === 'add' ? '创建账套' : '保存' }}
        </el-button>
      </template>
    </el-dialog>
  </PageListLayout>
</template>

<script setup lang="ts">
import PageListLayout from '@/components/layout/PageListLayout.vue'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import request from '@/api/request'
import { logout } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { getAccountSetDefaultStartDate } from '@/utils/format'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import StandardTemplateSelect from '@/components/system/StandardTemplateSelect.vue'
import {
  fetchStandardTemplates as requestStandardTemplates,
  refreshStandardTemplates,
} from '@/api/standardTemplates'
import {
  pickDefaultStandardTemplate,
  type StandardTemplateItem,
} from '@/utils/standardTemplateGroups'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('system_account_set')

interface Template {
  id: string
  name: string
  file: string
  description: string
}

const router = useRouter()
const userStore = useUserStore()
const currentAccountSetId = computed(() => userStore.accountSetId)

const list = ref<any[]>([])
const dialogVisible = ref(false)
const dialogType = ref('add')
const saving = ref(false)
const dialogTitle = computed(() => dialogType.value === 'add' ? '新增账套' : '编辑账套')
const templates = ref<Template[]>([])
const standardTemplates = ref<StandardTemplateItem[]>([])
const standardTemplateGroups = ref<string[]>([])
const selectedTemplate = computed(
  () => standardTemplates.value.find(item => item.id === form.value?.standard_template_id) || null
)

const formRef = ref<FormInstance>()
const formRules: FormRules = {
  name: [{ required: true, message: '请输入单位名称', trigger: 'blur' }],
  start_date: [{ required: true, message: '请选择启用日期', trigger: 'change' }],
}

const form = ref<any>({})

async function fetchData() {
  const res = await request.get<any[]>('/system/account-sets')
  list.value = res.data
}

async function fetchTemplates() {
  try {
    const res = await request.get<Template[]>('/system/account-set-templates')
    templates.value = res.data || []
  } catch {
    templates.value = []
  }
}

async function fetchStandardTemplates() {
  try {
    const result = await requestStandardTemplates('system')
    standardTemplates.value = result.templates
    standardTemplateGroups.value = result.groups
  } catch {
    standardTemplates.value = []
    standardTemplateGroups.value = []
  }
}

const templateRefreshing = ref(false)

/** 替换「标准模版/catalog.json」或 ACD 文件后，重新扫描目录（无需重启后端） */
async function reloadStandardTemplates() {
  templateRefreshing.value = true
  try {
    const result = await refreshStandardTemplates()
    standardTemplates.value = result.templates
    standardTemplateGroups.value = result.groups
    ElMessage.success(`已刷新，共 ${result.templates.length} 个标准模版`)
  } catch {
    // 请求层已提示错误
  } finally {
    templateRefreshing.value = false
  }
}

function generateCode() {
  let maxNum = 0
  for (const item of list.value) {
    const match = /^ZT(\d+)$/.exec(String(item.code || ''))
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }
  return `ZT${String(maxNum + 1).padStart(3, '0')}`
}

function openDialog(type: string, row?: any) {
  dialogType.value = type
  if (type === 'edit' && row) {
    form.value = {
      ...row,
      account_levels: row.account_levels ?? 6,
      account_code_lengths: row.account_code_lengths ?? [4,2,2,2,2,2,2,2,2,2],
    }
  } else {
    form.value = {
      name: '',
      code: generateCode(),
      credit_code: '',
      fiscal_dept: '',
      start_date: getAccountSetDefaultStartDate(),
      unit_leader: '',
      chief_accountant: '',
      status: 'active',
      use_template: true,
      standard_template_id: pickDefaultStandardTemplate(standardTemplates.value),
      account_levels: 6,
      account_code_lengths: [4,2,2,2,2,2,2,2,2,2],
    }
  }
  dialogVisible.value = true
  // 清理上一次的校验状态
  setTimeout(() => formRef.value?.clearValidate(), 0)
}

async function handleSave() {
  if (saving.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  // 前端名称重复校验
  const duplicate = list.value.find(item =>
    item.name === form.value.name && item.id !== form.value.id
  )
  if (duplicate) {
    ElMessage.warning('账套名称已存在，请使用其他名称')
    return
  }
  saving.value = true
  try {
    const payload = { ...form.value }
    // 自动从启用日期推算会计年度
    if (payload.start_date && !payload.fiscal_year) {
      payload.fiscal_year = parseInt(payload.start_date.substring(0, 4), 10)
    }
    if (!payload.fiscal_year) {
      payload.fiscal_year = new Date().getFullYear()
    }
    if (dialogType.value === 'add') {
      if (payload.use_template && !payload.standard_template_id) {
        ElMessage.warning('请选择标准模版')
        return
      }
      if (payload.use_template && payload.standard_template_id) {
        // 从标准模板创建
        const res = await request.post('/system/account-sets/from-standard-template', payload)
        ElMessage.success((res.data as any)?.message || '从标准模板创建成功')
      } else {
        // 创建空账套
        await request.post('/system/account-sets', payload)
        ElMessage.success('创建成功')
      }
    } else {
      await request.put(`/system/account-sets/${payload.id}`, payload)
      ElMessage.success('保存成功')
    }
    dialogVisible.value = false
    fetchData()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleSelect(row: any) {
  try {
    await logout()
  } catch (error) {
    console.error('退出登录失败:', error)
  }
  useUserStore().logout()
  await router.push({
    path: '/login',
    query: {
      targetAccountSetId: row.id,
      targetAccountSetName: row.name,
    },
  })
}

async function handleDelete(row: any) {
  try {
    const { value: password } = await (ElMessageBox.prompt as any)(
      `确定要删除账套「${row.name}」吗？此操作将删除该账套下的所有数据（科目、凭证、期初余额等），不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning',
        inputType: 'password',
        inputPlaceholder: '请输入管理员密码',
        customStyle: 'width: 460px; max-width: 95vw;',
        inputValidator: (val: string) => {
          if (!val) return '请输入管理员密码'
          return true
        },
      }
    )
    await request.delete(`/system/account-sets/${row.id}`, { data: { password } })
    ElMessage.success('删除成功')
    fetchData()
  } catch {
    // 用户取消
  }
}

onMounted(() => {
  fetchData()
  fetchTemplates()
  fetchStandardTemplates()
})
</script>

<style scoped>
/* === 与登录页"新增账套"对话框保持一致的紧凑样式 === */
.create-account-dialog :deep(.el-dialog__header) {
  padding: 12px 16px !important;
}
.create-account-dialog :deep(.el-dialog__title) {
  font-size: var(--cw-text-lg) !important;
}
.create-account-dialog :deep(.el-dialog__body) {
  padding: 12px 16px 4px !important;
}
.create-account-dialog :deep(.el-dialog__footer) {
  padding: 10px 16px !important;
}
.create-account-form :deep(.el-form-item) {
  margin-bottom: 10px;
}
.create-account-form :deep(.el-form-item__label) {
  font-size: 12px !important;
  padding-right: 8px !important;
}
.template-radio-group {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}
.template-radio-group :deep(.el-radio) {
  margin-right: 0;
  height: 24px;
}
.template-radio-group :deep(.el-radio__label) {
  font-size: 12px !important;
  padding-left: 6px;
}
.template-select {
  width: 100%;
}
.code-lengths-row :deep(.el-input-number) {
  width: 56px;
}

.template-hint { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; line-height: 1.4; }
.template-refresh { flex: none; }
.readonly-value { color: #606266; font-size: var(--cw-text-base); line-height: 32px; }
.code-lengths-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lengths-sep { color: #86868b; font-size: var(--cw-text-base); }

/* 状态列：紧凑表行高较矮，标签横排以免撑破行 */
.status-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 0;
}

.status-tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.current-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  border-radius: 3px;
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  border: none;
  box-shadow: 0 2px 4px rgba(64, 158, 255, 0.2);
  transition: all 0.2s ease;
}

/* 紧凑表默认行高较矮，本页状态/操作列略高时允许行撑开 */
.el-table.compact-data-table :deep(.el-table__body .el-table__row) {
  height: auto !important;
  min-height: 30px;
}

.current-tag:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(64, 158, 255, 0.3);
}

/* 状态标签颜色优化 */
:deep(.el-tag--success) {
  background: linear-gradient(135deg, #67c23a 0%, #529b2e 100%);
  border: none;
  color: white;
  box-shadow: 0 2px 4px rgba(103, 194, 58, 0.2);
}

:deep(.el-tag--warning) {
  background: linear-gradient(135deg, #e6a23c 0%, #c78a2a 100%);
  border: none;
  color: white;
  box-shadow: 0 2px 4px rgba(230, 162, 60, 0.2);
}

:deep(.el-tag--danger) {
  background: linear-gradient(135deg, #f56c6c 0%, #d95454 100%);
  border: none;
  color: white;
  box-shadow: 0 2px 4px rgba(245, 108, 108, 0.2);
}

:deep(.el-tag--primary) {
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  border: none;
  color: white;
  box-shadow: 0 2px 4px rgba(64, 158, 255, 0.2);
}
</style>
