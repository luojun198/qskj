<template>
  <div class="perm-config-panel">
    <div v-if="loading" class="perm-loading">加载中...</div>
    <div v-else-if="permissionGroups.length === 0" class="perm-loading">暂无权限数据</div>
    <div v-else class="perm-body">
      <div class="perm-toolbar">
        <el-checkbox
          :model-value="isAllChecked"
          :indeterminate="isAllIndeterminate"
          @change="(v: any) => toggleAll(!!v)"
        >全选</el-checkbox>
        <el-button link type="primary" size="small" @click="toggleInvert">反选</el-button>
        <span class="perm-toolbar__count">已选择 {{ selectedCount }} / {{ allPermCodes.length }} 项权限</span>
      </div>

      <div class="perm-grid cw-grouped-checkbox-grid">
        <div v-for="group in permissionGroups" :key="group.module" class="perm-group cw-grouped-checkbox-group">
          <div class="perm-group-header cw-grouped-checkbox-group__header">
            <el-checkbox
              :model-value="isGroupAllChecked(group)"
              :indeterminate="isGroupIndeterminate(group)"
              @change="(v: any) => toggleGroup(group, !!v)"
            >{{ group.moduleName }}</el-checkbox>
            <el-button link type="primary" size="small" @click="toggleGroupInvert(group)">反选</el-button>
          </div>
          <div class="perm-items cw-grouped-checkbox-items">
            <el-checkbox
              v-for="p in group.permissions"
              :key="p.code"
              v-model="selectedPermissions"
              :label="p.code"
              size="small"
            >{{ p.name }}</el-checkbox>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePermissionSelection } from '@/composables/usePermissionSelection'

const props = defineProps<{
  permissions: string[]
}>()

const emit = defineEmits<{
  'update:permissions': [value: string[]]
}>()

const selectedPermissions = computed({
  get: () => (Array.isArray(props.permissions) ? props.permissions : []),
  set: (value: string[]) => emit('update:permissions', value),
})

const {
  permissionGroups,
  loading,
  allPermCodes,
  selectedCount,
  isAllChecked,
  isAllIndeterminate,
  fetchPermissions,
  isGroupAllChecked,
  isGroupIndeterminate,
  toggleAll,
  toggleInvert,
  toggleGroup,
  toggleGroupInvert,
} = usePermissionSelection(selectedPermissions)

onMounted(() => {
  void fetchPermissions()
})
</script>

<style scoped>
.perm-config-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.perm-loading {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.perm-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.perm-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 4px;
  flex-shrink: 0;
}

.perm-toolbar__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.perm-grid {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-bottom: 4px;
}

.perm-group-header :deep(.el-checkbox__label) {
  font-weight: 600;
}
</style>
