import type { Database } from 'better-sqlite3'
import { yieldEventLoop } from './batchProgress.js'

/** 分块执行数据库事务，避免单次事务过大且周期性让出事件循环 */
export async function runInDbTransactionChunks<T>(
  db: Database,
  items: T[],
  chunkSize: number,
  processor: (item: T, index: number) => void,
  options?: { onChunkDone?: (processed: number, total: number) => void }
): Promise<void> {
  const total = items.length
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total)
    const runChunk = db.transaction(() => {
      for (let i = start; i < end; i++) {
        processor(items[i], i)
      }
    })
    runChunk()
    options?.onChunkDone?.(end, total)
    if (end < total) {
      await yieldEventLoop()
    }
  }
}

export function createAuxItemExistsCheckers(db: Database, accountSetId: string, type: string) {
  const codeExistsStmt = db.prepare(
    `SELECT 1 AS ok FROM aux_items WHERE account_set_id=? AND type=? AND code=? LIMIT 1`
  )
  const nameExistsStmt = db.prepare(
    `SELECT 1 AS ok FROM aux_items WHERE account_set_id=? AND type=? AND name=? LIMIT 1`
  )
  return {
    codeExists(code: string) {
      return !!codeExistsStmt.get(accountSetId, type, code)
    },
    nameExists(name: string) {
      return !!nameExistsStmt.get(accountSetId, type, name)
    },
  }
}

export function createAccountParentLookup(db: Database, accountSetId: string) {
  const parentStmt = db.prepare(
    `SELECT id, level FROM accounts WHERE account_set_id=? AND code=? LIMIT 1`
  )
  return (parentCode: string | null | undefined) => {
    if (!parentCode) return null
    return parentStmt.get(accountSetId, parentCode) as { id: string; level: number } | undefined
  }
}
