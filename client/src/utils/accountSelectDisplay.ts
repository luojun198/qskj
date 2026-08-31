/** 树形科目选择下拉 popper 类名（挂到 el-tree-select，与 EP 的 el-tree-select__popper 并存） */
export const ACCOUNT_TREE_SELECT_POPPER_CLASS = 'account-tree-select-popper'

/** 树形科目下拉宽度（勿用 fit-input-width，否则易被对话框内窄输入框锁死） */
export const ACCOUNT_TREE_SELECT_POPPER_STYLE = {
  minWidth: '420px',
  width: '420px',
  maxWidth: 'min(520px, 92vw)',
} as const

/** 平铺科目选择下拉 popper 类名（挂到 el-select） */
export const ACCOUNT_SELECT_POPPER_CLASS = 'account-select-popper'

/** 科目下拉/树节点展示：编码 + 名称 */
export function formatAccountSelectLabel(
  code: string | number | null | undefined,
  name: string | null | undefined
): string {
  const c = String(code ?? '').trim()
  const n = String(name ?? '').trim()
  if (c && n) return `${c} ${n}`
  return c || n
}

/** 为树形选择器节点附加 displayLabel */
export function withAccountTreeSelectLabel<T extends { code?: string; name?: string }>(
  node: T
): T & { displayLabel: string } {
  return {
    ...node,
    displayLabel: formatAccountSelectLabel(node.code, node.name),
  }
}
