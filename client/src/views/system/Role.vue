<template>
  <div class="page page--perm">
    <template v-if="pageView === 'list'">
      <div class="page-header">
        <h3>角色管理</h3>
        <div class="page-header-actions">
          <el-button type="primary" @click="openEditor('add')">新增角色</el-button>
        </div>
      </div>
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
        <el-table-column prop="name" label="角色名称" :width="colWidth('name', 150)" />
        <el-table-column prop="code" label="角色编码" :width="colWidth('code', 120)" />
        <el-table-column prop="description" label="描述" :width="colWidth('description', 200)" />
        <el-table-column prop="is_system" label="类型" :width="colWidth('is_system', 120)">
          <template #default="{ row }">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <el-tag :type="row.is_system ? 'primary' : row.is_personal ? 'warning' : 'info'" size="small">
                {{ row.is_system ? '系统' : row.is_personal ? '个人' : '自定义' }}
              </el-tag>
              <span v-if="row.is_personal && row.username" style="font-size: 12px; color: #909399;">
                用户：{{ row.username }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column column-key="操作" label="操作" :width="colWidth('操作', 180)" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.is_personal"
              link
              type="primary"
              size="small"
              @click="openEditor('edit', row)"
            >编辑</el-button>
            <el-button
              v-if="!row.is_system && !row.is_personal"
              link
              type="danger"
              size="small"
              @click="handleDelete(row)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <div class="page-header page-header--perm">
        <div class="page-header__left">
          <el-button @click="closeEditor">返回</el-button>
          <h3>{{ editorTitle }}</h3>
        </div>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </div>

      <div class="role-editor">
        <el-form :model="form" label-width="88px" class="role-editor__form">
          <div class="role-editor__fields">
            <el-form-item label="角色名称" required>
              <el-input v-model="form.name" />
            </el-form-item>
            <el-form-item label="角色编码" required>
              <el-input v-model="form.code" :disabled="editorType === 'edit'" />
            </el-form-item>
            <el-form-item label="描述" class="role-editor__desc">
              <el-input v-model="form.description" />
            </el-form-item>
          </div>
        </el-form>

        <el-tabs v-model="editorTab" class="role-editor__tabs">
          <el-tab-pane label="功能权限" name="perm">
            <PermissionConfigPanel v-model:permissions="form.permissions" />
          </el-tab-pane>
          <el-tab-pane label="科目授权" name="account">
            <AccountScopeTree v-model="form.account_scope" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/api/request'
import { useListColumnWidth } from '@/composables/useColumnWidthMemory'
import PermissionConfigPanel from '@/components/system/PermissionConfigPanel.vue'
import AccountScopeTree, { type AccountScopeValue } from '@/components/system/AccountScopeTree.vue'

const { tableRef, onDragEnd, colWidth } = useListColumnWidth('system_role')
const list = ref<any[]>([])
const pageView = ref<'list' | 'editor'>('list')
const editorType = ref('add')
const editorTitle = computed(() => (editorType.value === 'add' ? '新增角色' : '编辑角色'))
const defaultAccountScope = (): AccountScopeValue => ({ enabled: false, account_ids: [] })
const form = ref<any>({
  name: '',
  code: '',
  description: '',
  permissions: [],
  account_scope: defaultAccountScope(),
})
const editorTab = ref('perm')
const saving = ref(false)

async function loadRoleAccountScope(roleId: string) {
  try {
    const res = await request.get<AccountScopeValue>(`/system/roles/${roleId}/account-scopes`)
    form.value.account_scope = res.data || defaultAccountScope()
  } catch {
    form.value.account_scope = defaultAccountScope()
  }
}

async function fetchData() {
  const res = await request.get<any[]>('/system/roles')
  list.value = res.data.map((r: any) => ({
    ...r,
    permissions: r.permissions ? JSON.parse(r.permissions) : [],
  }))
}

async function openEditor(type: string, row?: any) {
  editorType.value = type
  editorTab.value = 'perm'
  form.value =
    type === 'add'
      ? {
          name: '',
          code: '',
          description: '',
          permissions: [],
          account_scope: defaultAccountScope(),
        }
      : {
          ...row,
          permissions: Array.isArray(row.permissions) ? [...row.permissions] : [],
          account_scope: defaultAccountScope(),
        }
  pageView.value = 'editor'
  if (type === 'edit' && row?.id) {
    await loadRoleAccountScope(row.id)
  }
}

function closeEditor() {
  pageView.value = 'list'
}

async function handleSave() {
  if (!form.value.name?.trim()) {
    ElMessage.warning('请输入角色名称')
    return
  }
  if (!form.value.code?.trim()) {
    ElMessage.warning('请输入角色编码')
    return
  }

  saving.value = true
  try {
    const { account_scope, ...rolePayload } = form.value
    let roleId = form.value.id as string | undefined
    if (editorType.value === 'add') {
      const res = await request.post<{ id: string }>('/system/roles', rolePayload)
      roleId = res.data?.id
    } else {
      await request.put(`/system/roles/${form.value.id}`, rolePayload)
    }
    if (roleId) {
      await request.put(`/system/roles/${roleId}/account-scopes`, account_scope || defaultAccountScope())
    }
    ElMessage.success(editorType.value === 'add' ? '新增角色成功' : '保存成功')
    pageView.value = 'list'
    await fetchData()
  } finally {
    saving.value = false
  }
}

async function handleDelete(row: any) {
  await request.delete(`/system/roles/${row.id}`)
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

.role-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 8px;
}

.role-editor__form {
  flex-shrink: 0;
}

.role-editor__fields {
  display: grid;
  grid-template-columns: 220px 220px 1fr;
  gap: 0 16px;
  align-items: start;
}

.role-editor__desc {
  margin-bottom: 0;
}

.role-editor__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.role-editor__tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
