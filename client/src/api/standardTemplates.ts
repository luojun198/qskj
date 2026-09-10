import request from '@/api/request'
import type { StandardTemplateItem } from '@/utils/standardTemplateGroups'

export interface StandardTemplateListResult {
  templates: StandardTemplateItem[]
  groups: string[]
}

/**
 * 拉取标准模版（会计准则目录）。
 * - scope=auth：登录页（免鉴权）
 * - scope=system：系统管理（需登录）
 */
export async function fetchStandardTemplates(
  scope: 'auth' | 'system',
  config?: { skipErrorToast?: boolean }
): Promise<StandardTemplateListResult> {
  const url =
    scope === 'auth'
      ? '/auth/standard-account-set-templates'
      : '/system/standard-account-set-templates'
  const res = await request.get<StandardTemplateItem[]>(url, config)
  const groups = (res as unknown as { groups?: string[] }).groups
  return {
    templates: Array.isArray(res.data) ? res.data : [],
    groups: Array.isArray(groups) ? groups : [],
  }
}

/**
 * 刷新标准模版目录（需 system:account 权限）。
 * 用于替换「标准模版/catalog.json」或 ACD 文件后立即生效，无需重启后端。
 */
export async function refreshStandardTemplates(): Promise<StandardTemplateListResult> {
  const res = await request.post<StandardTemplateItem[]>(
    '/system/standard-account-set-templates/refresh'
  )
  const groups = (res as unknown as { groups?: string[] }).groups
  return {
    templates: Array.isArray(res.data) ? res.data : [],
    groups: Array.isArray(groups) ? groups : [],
  }
}
