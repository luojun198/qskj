import { getDb } from '../db/index.js'
import { ensureDefaultPrintTemplateForAccountSet } from '../services/printTemplateDefaults.js'

/**
 * 初始化默认打印模版
 * 为所有缺少默认模版的账套补建标准批量打印模版
 */
export function initDefaultPrintTemplate() {
  const db = getDb()

  const accountSets = db.prepare('SELECT id FROM account_sets').all() as Array<{ id: string }>

  if (accountSets.length === 0) {
    console.log('没有找到账套，跳过打印模版初始化')
    return
  }

  let createdCount = 0

  for (const accountSet of accountSets) {
    const result = ensureDefaultPrintTemplateForAccountSet(db, accountSet.id)
    if (result.created) {
      createdCount++
      console.log(`为账套 ${accountSet.id} 创建默认打印模版: ${result.id}`)
    }
  }

  console.log(`打印模版初始化完成，共创建 ${createdCount} 个默认模版`)
}
