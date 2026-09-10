import { getActivePinia } from 'pinia'
import { useBaseDataStore } from '@/stores/baseData'
import { accountDisplayMode } from './accountDisplayPreference'
import { buildAccountPathIndex, formatAccountFullPath } from './accountPathDisplay'

/**
 * 凭证各列表共用的科目展示：按「科目显示」开关在「末级名称」和「完整路径」间切换。
 * 科目表取自 baseData store；科目已删除或尚未加载时回落到分录快照，绝不显示空白。
 */
interface EntryRowLike {
  account_id?: string | null
  account_code?: string | null
  account_name?: string | null
}

/** 科目表：pinia 未激活（如脱离 app 的组件单测）时返回空数组，展示自动回落到分录快照 */
function accountList(): any[] {
  if (!getActivePinia()) return []
  return useBaseDataStore().accounts as any[]
}

function findAccount(row: EntryRowLike): any | null {
  const accounts = accountList()
  if (!accounts.length) return null
  return (
    accounts.find(a => a.id === row.account_id) ||
    (row.account_code ? accounts.find(a => a.code === row.account_code) : null) ||
    null
  )
}

/**
 * 供列定义 computed 显式依赖：开关切换或科目表加载完成后重建列，触发虚拟表格重绘。
 * （单元格渲染函数里读 store 不一定被表格的渲染作用域追踪，所以在列层面显式依赖一次。）
 */
export function accountDisplayRevision(): unknown {
  return `${accountDisplayMode.value}:${accountList().length}`
}

/** 「科目名称」列：完整路径模式返回各级名称（管理费用/办公费），否则返回末级名称 */
export function accountNameByMode(row: EntryRowLike): string {
  const snapshot = String(row.account_name || '')
  if (accountDisplayMode.value !== 'full') return snapshot
  const acc = findAccount(row)
  if (!acc?.id) return snapshot
  const path = buildAccountPathIndex(accountList()).get(acc.id)
  return path || snapshot
}

/** 「会计科目」合并列：编码 + 名称（或完整路径） */
export function accountLabelByMode(row: EntryRowLike): string {
  const code = String(row.account_code || '')
  if (accountDisplayMode.value === 'full') {
    const acc = findAccount(row)
    if (acc) {
      return formatAccountFullPath(acc.code, acc.id, accountList(), acc.name)
    }
  }
  return `${code} ${row.account_name || ''}`.trim()
}
