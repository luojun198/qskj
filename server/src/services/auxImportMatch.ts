import type Database from 'better-sqlite3'
import { normalizeImportCode, normalizeImportText } from './baseValidation.js'

export type AuxImportMatchItem = { id: string; code: string; name: string }

const CHUNK_SIZE = 500

function queryByCodes(
  db: Database.Database,
  accountSetId: string,
  type: string,
  codes: string[]
): AuxImportMatchItem[] {
  if (codes.length === 0) return []
  const results: AuxImportMatchItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < codes.length; i += CHUNK_SIZE) {
    const chunk = codes.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, code, name FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active' AND code IN (${placeholders})`
      )
      .all(accountSetId, type, ...chunk) as AuxImportMatchItem[]
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      results.push(row)
    }
  }
  return results
}

function queryByNames(
  db: Database.Database,
  accountSetId: string,
  type: string,
  names: string[]
): AuxImportMatchItem[] {
  if (names.length === 0) return []
  const results: AuxImportMatchItem[] = []
  const seen = new Set<string>()
  for (let i = 0; i < names.length; i += CHUNK_SIZE) {
    const chunk = names.slice(i, i + CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, code, name FROM aux_items
         WHERE account_set_id=? AND type=? AND status='active' AND name IN (${placeholders})`
      )
      .all(accountSetId, type, ...chunk) as AuxImportMatchItem[]
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      results.push(row)
    }
  }
  return results
}

/** 按导入文件中出现的编码/名称批量查库（十万级导入匹配，不拉全量列表） */
export function lookupAuxItemsForImport(
  db: Database.Database,
  accountSetId: string,
  type: string,
  codes: string[],
  names: string[]
): AuxImportMatchItem[] {
  const normalizedCodes = [
    ...new Set(codes.map(c => normalizeImportCode(c)).filter(Boolean)),
  ]
  const normalizedNames = [
    ...new Set(names.map(n => normalizeImportText(n)).filter(Boolean)),
  ]

  const byId = new Map<string, AuxImportMatchItem>()
  for (const item of queryByCodes(db, accountSetId, type, normalizedCodes)) {
    byId.set(item.id, item)
  }
  for (const item of queryByNames(db, accountSetId, type, normalizedNames)) {
    byId.set(item.id, item)
  }
  return [...byId.values()]
}
