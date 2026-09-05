/** 旧模块首页地址 → 当前应用标题，避免书签/外链失效 */
export const NAV_APP_TITLE_ALIASES: Record<string, string> = {
  财务会计: '财务总账',
  资金管理: '出纳管理',
  资产管理: '固定资产',
}

export function resolveNavAppTitle(title: string): string {
  return NAV_APP_TITLE_ALIASES[title] || title
}

export function getGroupNavigationPath(groupTitle: string): string {
  return `/group/${encodeURIComponent(resolveNavAppTitle(groupTitle))}`
}
