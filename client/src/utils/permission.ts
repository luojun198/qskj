import { useUserStore } from '@/stores/user'

/**
 * 检查用户是否拥有指定权限
 * @param permission 权限代码，如 'voucher:entry'
 */
export function hasPermission(permission: string): boolean {
  const userStore = useUserStore()
  const permissions = userStore.permissions || []
  return permissions.includes('*') || permissions.includes(permission)
}

/**
 * 检查用户是否拥有任一权限
 * @param permissions 权限代码数组
 */
export function hasAnyPermission(...permissions: string[]): boolean {
  const userStore = useUserStore()
  const userPermissions = userStore.permissions || []
  if (userPermissions.includes('*')) return true
  return permissions.some(p => userPermissions.includes(p))
}

/**
 * 检查用户是否拥有全部权限
 * @param permissions 权限代码数组
 */
export function hasAllPermissions(...permissions: string[]): boolean {
  const userStore = useUserStore()
  const userPermissions = userStore.permissions || []
  if (userPermissions.includes('*')) return true
  return permissions.every(p => userPermissions.includes(p))
}
