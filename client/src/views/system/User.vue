<template>
  <div class="page page--perm">
    <template v-if="pageView === 'list'">
      <PageListLayout title="用户管理" embedded>
        <template #actions>
          <el-button type="primary" @click="openDialog('add')">新增用户</el-button>
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
        <el-table-column prop="username" label="登录账号" :width="colWidth('username', 120)" />
        <el-table-column prop="nickname" label="姓名" :width="colWidth('nickname', 120)" />
        <el-table-column prop="role_names" label="角色" :width="colWidth('role_names', 180)">
          <template #default="{ row }">
            <span v-if="row.role_names">{{ row.role_names }}</span>
            <span v-else style="color: #909399;">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" :width="colWidth('email', 180)" />
        <el-table-column prop="phone" label="电话" :width="colWidth('phone', 130)" />
        <el-table-column prop="status" label="状态" :width="colWidth('status', 80)">
          <template #default="{ row }">
            <el-tag
              :type="
                row.status === 'active' ? 'success' : row.status === 'locked' ? 'danger' : 'warning'
              "
              size="small"
            >
              {{
                ({ active: '正常', disabled: '禁用', locked: '锁定' } as Record<string, string>)[
                  row.status
                ] || row.status
              }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="last_login_at" label="最后登录" :width="colWidth('last_login_at', 160)" />
        <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 240)" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDialog('edit', row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="openPermissionPage(row)">权限</el-button>
            <el-button link type="success" size="small" @click="openAccountScopePage(row)">科目</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px">
        <el-form :model="form" label-width="120px">
          <el-form-item label="登录账号" required>
            <el-input v-model="form.username" :disabled="dialogType === 'edit'" />
          </el-form-item>
          <el-form-item label="姓名">
            <el-input v-model="form.nickname" />
          </el-form-item>
          <el-form-item v-if="dialogType === 'add'" label="密码" required>
            <el-input v-model="form.password" type="password" show-password />
          </el-form-item>
          <el-form-item v-if="dialogType === 'edit'" label="重置密码">
            <el-input v-model="form.password" type="password" show-password placeholder="留空则不修改" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="form.email" />
          </el-form-item>
          <el-form-item label="电话">
            <el-input v-model="form.phone" />
          </el-form-item>
          <el-form-item v-if="dialogType === 'edit'" label="状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option label="正常" value="active" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </el-form-item>
          <el-form-item label="角色">
            <el-select
              v-model="form.role_ids"
              multiple
              placeholder="请选择角色（可多选）"
              style="width: 100%"
              clearable
            >
              <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="自定义权限">
            <el-button type="primary" @click="openPermissionPageFromForm">配置权限</el-button>
            <span class="perm-summary">已选择 {{ form.custom_permissions?.length || 0 }} 项权限</span>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
        </template>
      </el-dialog>
      </PageListLayout>
    </template>

    <template v-else-if="pageView === 'permissions'">
      <div class="page-header page-header--perm">
        <div class="page-header__left">
          <el-button @click="closeSubPage">返回</el-button>
          <h3>{{ permissionPageTitle }}</h3>
        </div>
        <el-button type="primary" :loading="saving" @click="savePermissionPage">保存</el-button>
      </div>
      <PermissionConfigPanel v-model:permissions="permissionDraft" />
    </template>

    <template v-else-if="pageView === 'accountScopes'">
      <div class="page-header page-header--perm">
        <div class="page-header__left">
          <el-button @click="closeSubPage">返回</el-button>
          <h3>{{ accountScopePageTitle }}</h3>
        </div>
        <el-button type="primary" :loading="saving" @click="saveAccountScopePage">保存</el-button>
      </div>
      <AccountScopeTree v-model="accountScopeDraft" />
    </template>
  </div>
</template>

<script setup lang="ts">
import PageListLayout from '@/components/layout/PageListLayout.vue'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import PermissionConfigPanel from '@/components/system/PermissionConfigPanel.vue'
import AccountScopeTree, { type AccountScopeValue } from '@/components/system/AccountScopeTree.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('system_user')
const list = ref<any[]>([])
const roles = ref<any[]>([])
const dialogVisible = ref(false)
const pageView = ref<'list' | 'permissions' | 'accountScopes'>('list')
const dialogType = ref('add')
const dialogTitle = computed(() => (dialogType.value === 'add' ? '新增用户' : '编辑用户'))
const form = ref<any>({ status: 'active', role_ids: [], custom_permissions: [] })
const saving = ref(false)
const permissionDraft = ref<string[]>([])
const permissionTargetUser = ref<any>(null)
const permissionFromForm = ref(false)
const accountScopeDraft = ref<AccountScopeValue>({ enabled: false, account_ids: [] })
const accountScopeTargetUser = ref<any>(null)

const accountScopePageTitle = computed(() => {
  const user = accountScopeTargetUser.value
  if (!user) return '科目授权'
  return `科目授权 · ${user.nickname || user.username}`
})

const permissionPageTitle = computed(() => {
  if (permissionFromForm.value) {
    const name = form.value.nickname || form.value.username || '新用户'
    return `配置自定义权限 · ${name}`
  }
  const user = permissionTargetUser.value
  if (!user) return '配置自定义权限'
  return `配置自定义权限 · ${user.nickname || user.username}`
})

function parseCustomPermissions(value: unknown): string[] {
  if (!value) return []
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? [...parsed] : []
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? [...value] : []
}

async function fetchData() {
  const [userRes, roleRes] = await Promise.all([
    request.get<any[]>('/system/users'),
    request.get<any[]>('/system/roles'),
  ])
  list.value = userRes.data
  roles.value = roleRes.data
}

function openDialog(type: string, row?: any) {
  dialogType.value = type
  if (type === 'add') {
    form.value = { status: 'active', role_ids: [], custom_permissions: [] }
  } else {
    form.value = {
      ...row,
      role_ids: row.role_ids || [],
      custom_permissions: parseCustomPermissions(row.custom_permissions),
    }
  }
  dialogVisible.value = true
}

function openPermissionPage(row: any) {
  permissionFromForm.value = false
  permissionTargetUser.value = row
  permissionDraft.value = parseCustomPermissions(row.custom_permissions)
  pageView.value = 'permissions'
}

function openPermissionPageFromForm() {
  permissionFromForm.value = true
  permissionTargetUser.value = dialogType.value === 'edit' ? { ...form.value } : null
  permissionDraft.value = [...(form.value.custom_permissions || [])]
  dialogVisible.value = false
  pageView.value = 'permissions'
}

function closeSubPage() {
  pageView.value = 'list'
  permissionTargetUser.value = null
  permissionFromForm.value = false
  accountScopeTargetUser.value = null
  if (dialogType.value === 'add' || dialogType.value === 'edit') {
    dialogVisible.value = true
  }
}

function closePermissionPage() {
  closeSubPage()
}

async function openAccountScopePage(row: any) {
  accountScopeTargetUser.value = row
  pageView.value = 'accountScopes'
  try {
    const res = await request.get<AccountScopeValue>(`/system/users/${row.id}/account-scopes`)
    accountScopeDraft.value = res.data || { enabled: false, account_ids: [] }
  } catch {
    accountScopeDraft.value = { enabled: false, account_ids: [] }
  }
}

async function saveAccountScopePage() {
  const user = accountScopeTargetUser.value
  if (!user?.id) return
  saving.value = true
  try {
    await request.put(`/system/users/${user.id}/account-scopes`, accountScopeDraft.value)
    ElMessage.success('科目授权已保存')
    pageView.value = 'list'
    accountScopeTargetUser.value = null
    await fetchData()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function savePermissionPage() {
  if (permissionFromForm.value) {
    form.value.custom_permissions = [...permissionDraft.value]
    pageView.value = 'list'
    permissionFromForm.value = false
    dialogVisible.value = true
    return
  }

  const user = permissionTargetUser.value
  if (!user?.id) return

  saving.value = true
  try {
    await request.put(`/system/users/${user.id}`, {
      custom_permissions: permissionDraft.value,
    })
    ElMessage.success('权限配置已保存')
    pageView.value = 'list'
    permissionTargetUser.value = null
    await fetchData()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function handleSave() {
  if (!form.value.username?.trim()) {
    ElMessage.warning('请输入登录账号')
    return
  }
  if (dialogType.value === 'add' && !form.value.password?.trim()) {
    ElMessage.warning('请输入密码')
    return
  }

  const hasRoles = form.value.role_ids && form.value.role_ids.length > 0
  const hasCustomPerms = form.value.custom_permissions && form.value.custom_permissions.length > 0
  if (!hasRoles && !hasCustomPerms) {
    ElMessage.warning('请至少选择一个角色或配置自定义权限')
    return
  }

  saving.value = true
  try {
    const submitData = { ...form.value }
    if (dialogType.value === 'add') {
      await request.post('/system/users', submitData)
    } else {
      await request.put(`/system/users/${form.value.id}`, submitData)
    }
    ElMessage.success(dialogType.value === 'add' ? '新增用户成功' : '保存成功')
    dialogVisible.value = false
    await fetchData()
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: any) {
  await request.delete(`/system/users/${row.id}`)
  fetchData()
}

onMounted(fetchData)
</script>

<style scoped>
.page--perm {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.page-header--perm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.page-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-header__left h3 {
  margin: 0;
}

.perm-summary {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}
</style>
