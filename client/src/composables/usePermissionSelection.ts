import { computed, ref, type Ref } from 'vue'
import request from '@/api/request'

export interface PermissionItem {
  code: string
  name: string
  acdCode?: string
}

export interface PermissionGroup {
  module: string
  moduleName: string
  permissions: PermissionItem[]
}

export function usePermissionSelection(selected: Ref<string[]>) {
  const permissionGroups = ref<PermissionGroup[]>([])
  const loading = ref(false)

  async function fetchPermissions() {
    if (permissionGroups.value.length > 0) return
    loading.value = true
    try {
      const res = await request.get<PermissionGroup[]>('/system/permissions')
      permissionGroups.value = res.data
    } finally {
      loading.value = false
    }
  }

  const allPermCodes = computed(() =>
    permissionGroups.value.flatMap(g => g.permissions.map(p => p.code))
  )

  const selectedCount = computed(() => selected.value.length)

  const isAllChecked = computed(
    () =>
      allPermCodes.value.length > 0 &&
      allPermCodes.value.every(c => selected.value.includes(c))
  )

  const isAllIndeterminate = computed(() => {
    const checked = allPermCodes.value.filter(c => selected.value.includes(c))
    return checked.length > 0 && checked.length < allPermCodes.value.length
  })

  function isGroupAllChecked(group: PermissionGroup): boolean {
    return group.permissions.every(p => selected.value.includes(p.code))
  }

  function isGroupIndeterminate(group: PermissionGroup): boolean {
    const checked = group.permissions.filter(p => selected.value.includes(p.code))
    return checked.length > 0 && checked.length < group.permissions.length
  }

  function toggleAll(checked: boolean) {
    selected.value = checked ? [...allPermCodes.value] : []
  }

  function toggleInvert() {
    const set = new Set(selected.value)
    selected.value = allPermCodes.value.filter(c => !set.has(c))
  }

  function toggleGroup(group: PermissionGroup, checked: boolean) {
    const codes = group.permissions.map(p => p.code)
    if (checked) {
      const existing = new Set(selected.value)
      codes.forEach(c => existing.add(c))
      selected.value = Array.from(existing)
    } else {
      selected.value = selected.value.filter(c => !codes.includes(c))
    }
  }

  function toggleGroupInvert(group: PermissionGroup) {
    const codes = group.permissions.map(p => p.code)
    const codeSet = new Set(codes)
    const others = selected.value.filter(c => !codeSet.has(c))
    const inverted = codes.filter(c => !selected.value.includes(c))
    selected.value = [...others, ...inverted]
  }

  return {
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
  }
}
