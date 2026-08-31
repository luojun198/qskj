import { onMounted, onUnmounted } from 'vue'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  handler: (event: KeyboardEvent) => void
  description?: string
}

/**
 * 键盘快捷键 composable
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: 's', ctrl: true, handler: handleSave, description: '保存' },
 *   { key: 'Escape', handler: handleClose, description: '关闭' }
 * ])
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = (event: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      if (!event.key || !shortcut.key) continue
      const ctrlMatch = shortcut.ctrl === undefined || shortcut.ctrl === (event.ctrlKey || event.metaKey)
      const altMatch = shortcut.alt === undefined || shortcut.alt === event.altKey
      const shiftMatch = shortcut.shift === undefined || shortcut.shift === event.shiftKey
      const metaMatch = shortcut.meta === undefined || shortcut.meta === event.metaKey
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()

      if (ctrlMatch && altMatch && shiftMatch && metaMatch && keyMatch) {
        // 检查是否在输入框中
        const target = event.target as HTMLElement
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        const isContentEditable = target.isContentEditable

        // 如果是 Escape 键，总是允许
        if (shortcut.key.toLowerCase() === 'escape') {
          event.preventDefault()
          shortcut.handler(event)
          return
        }

        // 在输入框中：避免与普通输入冲突
        if (isInput || isContentEditable) {
          const el = target as HTMLInputElement
          const inputType =
            target.tagName === 'INPUT' ? String(el.type || 'text').toLowerCase() : ''
          const isTextLike =
            isContentEditable ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            (target.tagName === 'INPUT' &&
              ['text', 'search', 'password', 'url', 'email', 'tel'].includes(inputType))

          // 无任何修饰键：不在输入框内触发
          if (!shortcut.ctrl && !shortcut.alt && !shortcut.meta && !shortcut.shift) {
            continue
          }

          // 仅 Shift+按键：在文本类控件中不触发（例如摘要里需要输入大写 S）
          if (
            isTextLike &&
            shortcut.shift &&
            !shortcut.ctrl &&
            !shortcut.alt &&
            !shortcut.meta
          ) {
            continue
          }
        }

        event.preventDefault()
        shortcut.handler(event)
        return
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })

  return {
    shortcuts,
  }
}

/**
 * 常用快捷键预设
 */
export const commonShortcuts = {
  save: (handler: () => void) => ({
    key: 's',
    ctrl: true,
    handler,
    description: 'Ctrl+S 保存',
  }),
  close: (handler: () => void) => ({
    key: 'Escape',
    handler,
    description: 'Esc 关闭',
  }),
  search: (handler: () => void) => ({
    key: 'f',
    ctrl: true,
    handler,
    description: 'Ctrl+F 搜索',
  }),
  refresh: (handler: () => void) => ({
    key: 'r',
    ctrl: true,
    handler,
    description: 'Ctrl+R 刷新',
  }),
  /** 新增 / 保存并新增（Shift+S；与 Ctrl+S 保存区分；文本框内不触发以免挡住大写 S） */
  add: (handler: () => void) => ({
    key: 's',
    shift: true,
    handler,
    description: 'Shift+S 新增/保存并新增',
  }),
  delete: (handler: () => void) => ({
    key: 'Delete',
    handler,
    description: 'Delete 删除',
  }),
}
