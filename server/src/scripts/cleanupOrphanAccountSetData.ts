/**
 * 清理「已删除账套」残留的孤儿数据（评审 P2 收尾）。
 *
 * 背景：删账套的显式清理清单漏过若干表（供应链 scm_*、币种 / 汇率，早期还有固定资产各表），
 * 删账套后这些表里 account_set_id 指向不存在账套的行一直留着。cleanupAccountSetCascade 已加兜底扫表，
 * 本脚本只处理历史遗留。
 *
 * 判定：表含 account_set_id 列，且该值不在 account_sets.id 中（NULL 不算）。
 *
 * 用法：
 *   # 只列出会删什么，不写库（默认）
 *   npx tsx server/src/scripts/cleanupOrphanAccountSetData.ts
 *   # 确认无误后真正删除（执行前先备份数据库）
 *   npx tsx server/src/scripts/cleanupOrphanAccountSetData.ts --apply
 */
import type { Database } from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { getDb } from '../db/index.js'
import { listAccountSetScopedTables } from '../services/accountSetCleanup.js'

export interface OrphanRow {
  table: string
  accountSetId: string
  count: number
}

export function cleanupOrphanAccountSetData(options: { apply?: boolean; db?: Database } = {}) {
  const db = options.db ?? getDb()
  const rows: OrphanRow[] = []
  for (const table of listAccountSetScopedTables(db)) {
    const found = db
      .prepare(
        `SELECT account_set_id AS id, COUNT(*) AS n FROM "${table}"
          WHERE account_set_id IS NOT NULL AND account_set_id NOT IN (SELECT id FROM account_sets)
          GROUP BY account_set_id`
      )
      .all() as Array<{ id: string; n: number }>
    for (const f of found) rows.push({ table, accountSetId: f.id, count: f.n })
  }

  if (options.apply && rows.length) {
    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        for (const table of new Set(rows.map(r => r.table))) {
          db.prepare(
            `DELETE FROM "${table}" WHERE account_set_id IS NOT NULL AND account_set_id NOT IN (SELECT id FROM account_sets)`
          ).run()
        }
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }

  return { rows, total: rows.reduce((s, r) => s + r.count, 0), accountSets: new Set(rows.map(r => r.accountSetId)).size }
}

function isDirectScriptRun(scriptName: string) {
  if (!process.argv[1]) return false
  const currentName = basename(fileURLToPath(import.meta.url)).replace(/\.(cjs|mjs|js|ts)$/i, '')
  const entryName = basename(process.argv[1]).replace(/\.(cjs|mjs|js|ts)$/i, '')
  return currentName === scriptName && entryName === scriptName
}

if (isDirectScriptRun('cleanupOrphanAccountSetData')) {
  const apply = process.argv.includes('--apply')
  const result = cleanupOrphanAccountSetData({ apply })
  for (const r of result.rows) console.log(`${r.table.padEnd(32)} ${r.accountSetId}  ${r.count} 行`)
  console.log(
    `\n${apply ? '已删除' : '试运行（未写库，加 --apply 生效）'}：${result.accountSets} 个已删除账套，共 ${result.total} 行孤儿数据`
  )
}
