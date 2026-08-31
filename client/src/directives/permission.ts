import type { Directive, DirectiveBinding } from 'vue'
import { hasPermission, hasAnyPermission, hasAllPermissions } from '@/utils/permission'

/**
 * v-permission 权限指令
 * 用法：
 * v-permission="'voucher:entry'"  单个权限
 * v-permission="['voucher:entry', 'voucher:query']"  任一权限
 * v-permission.all="['voucher:entry', 'voucher:audit']"  全部权限
 */
export const permission: Directive = {
  mounted(el: HTMLElement, binding: DirectiveBinding) {
    const { value, modifiers } = binding
    
    if (!value) {
      console.warn('[v-permission] 缺少权限参数')
      return
    }

    let hasAuth = false

    if (typeof value === 'string') {
      // 单个权限
      hasAuth = hasPermission(value)
    } else if (Array.isArray(value)) {
      // 多个权限
      if (modifiers.all) {
        // 需要全部权限
        hasAuth = hasAllPermissions(...value)
      } else {
        // 任一权限即可（默认）
        hasAuth = hasAnyPermission(...value)
      }
    }

    if (!hasAuth) {
      // 无权限则移除元素
      el.parentNode?.removeChild(el)
    }
  }
}
