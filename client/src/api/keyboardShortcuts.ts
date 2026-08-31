import request from './request'

/**
 * 获取所有快捷键配置
 */
export const getKeyboardShortcuts = (params?: { module?: string; keyword?: string }) =>
  request.get('/base/keyboard-shortcuts', { params })

/**
 * 更新快捷键配置
 */
export const updateKeyboardShortcut = (id: number, data: any) =>
  request.put(`/base/keyboard-shortcuts/${id}`, data)

/**
 * 重置为默认配置
 */
export const resetKeyboardShortcuts = () =>
  request.post('/base/keyboard-shortcuts/reset')
