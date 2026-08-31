export function getGroupNavigationPath(groupTitle: string): string {
  return `/group/${encodeURIComponent(groupTitle)}`
}
