/**
 * 出纳流水辅助项目子表同步。
 *
 * 辅助项目 = 流水「对方科目」的辅助核算（现金 / 银行科目自身没有辅助项）。
 * 流水上的 counter_aux_item_id 仍是 JSON（{ 类别id: 项目id }），生成凭证时从它解析；
 * 子表 cashier_journal_aux 由本函数在每次写入 / 修改流水时同步，专供报表筛选与汇总。
 */
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'

type Db = Database.Database

/** 解析 counter_aux_item_id：只接受 { key: 非空字符串 } 的对象，其余视为无辅助 */
export function parseCounterAux(raw: unknown): Record<string, string> {
  if (raw == null || raw === '') return {}
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return {} }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const id = v == null ? '' : String(v).trim()
    if (k && id) out[k] = id
  }
  return out
}

function hasAuxTable(db: Db): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cashier_journal_aux'").get()
}

/**
 * 以最新 JSON 重写某条流水的辅助子表行（先删后插，幂等）。
 * key 兼容类别 id 与类别 code；匹配不到类别的 key 忽略。
 */
export function syncJournalAux(db: Db, accountSetId: string, journalId: string, counterAuxJson: unknown): void {
  if (!hasAuxTable(db)) return
  db.prepare('DELETE FROM cashier_journal_aux WHERE journal_id=?').run(journalId)
  const selections = parseCounterAux(counterAuxJson)
  const keys = Object.keys(selections)
  if (!keys.length) return
  const findCat = db.prepare('SELECT id, code FROM aux_categories WHERE account_set_id=? AND (id=? OR code=?) LIMIT 1')
  const ins = db.prepare(
    'INSERT OR REPLACE INTO cashier_journal_aux (id, account_set_id, journal_id, category_id, category_code, item_id) VALUES (?,?,?,?,?,?)'
  )
  for (const key of keys) {
    const cat = findCat.get(accountSetId, key, key) as { id: string; code: string } | undefined
    if (!cat) continue
    ins.run(uuidv4(), accountSetId, journalId, cat.id, cat.code, selections[key])
  }
}
