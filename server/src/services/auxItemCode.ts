import type { Database } from 'better-sqlite3'

/**
 * 某类别下一个可用的项目编码（FIX-419）：取该类别全部项目（含停用）中纯数字编码的最大值 + 1，
 * 位数取现有纯数字编码的最长位数（至少 6 位），并跳过已存在的编码。
 * 此前前端按「编码字符串倒序取第 1 条」推算，999 / 6001 / 000001 混排时取到旧号，保存报「项目编码已存在」。
 */
export function nextAuxItemCode(db: Database, accountSetId: string, type: string): string {
  const codes = (db.prepare('SELECT code FROM aux_items WHERE account_set_id=? AND type=?').all(accountSetId, type) as Array<{ code: string }>)
    .map(r => String(r.code || '').trim())
  const taken = new Set(codes)
  let max = 0
  let width = 6
  for (const c of codes) {
    if (!/^\d+$/.test(c)) continue
    const n = Number(c)
    if (Number.isSafeInteger(n) && n > max) max = n
    if (c.length > width) width = c.length
  }
  let next = max + 1
  let code = String(next).padStart(width, '0')
  while (taken.has(code)) { next++; code = String(next).padStart(width, '0') }
  return code
}
