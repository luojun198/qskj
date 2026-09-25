/**
 * 余额表 SQL 改写对照脚本（阶段 1 回归）：
 *   npx tsx scratch/balanceQuerySnapshot.mts save   → 用当前代码跑三张余额表 × 多口径，结果写 scratch/tmp/balance-snapshot.json
 *   npx tsx scratch/balanceQuerySnapshot.mts diff   → 用当前代码重跑并与快照逐行比对
 * 数据来源：data/finance-0523.db 的只读副本，所有账套、多组日期区间、含/不含未记账。
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildLedgerGeneralQuery,
  buildQuantityBalanceQuery,
  buildForeignBalanceQuery,
} from '../server/src/services/ledgerQuery.ts'
import {
  hasPreBookColumns,
  hasForeignPreBookColumns,
  resolveOpeningBaseYear,
} from '../server/src/services/initBalanceScope.ts'
import { peekAccountSetStartDate } from '../server/src/services/accountSetDefaults.ts'

const mode = process.argv[2] || 'save'
const SRC = path.resolve('data/finance-0523.db')
const SNAP = path.resolve('scratch/tmp/balance-snapshot.json')
const tmp = path.join(os.tmpdir(), `balance-snap-${Date.now()}.db`)
fs.copyFileSync(SRC, tmp)
const db = new Database(tmp, { readonly: true })

const sets = db.prepare('SELECT id, name FROM account_sets').all() as { id: string; name: string }[]
const ranges: [string, string][] = [
  ['2026-01-01', '2026-12-31'],
  ['2026-09-01', '2026-09-30'],
  ['2026-03-15', '2026-05-20'],
  ['2025-11-01', '2026-02-28'],
  ['2025-01-01', '2025-12-31'],
]

function ctx(accountSetId: string) {
  return {
    accountSetId,
    accountSetStartDate: peekAccountSetStartDate(db as any, accountSetId),
    preBookEnabled: hasPreBookColumns(db as any),
    resolveOpeningBaseYear: (y: number) => resolveOpeningBaseYear(db as any, accountSetId, y),
  }
}

const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)
function normalize(rows: any[]) {
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v)])))
}

const result: Record<string, any[]> = {}
const timings: Record<string, number> = {}
for (const s of sets) {
  for (const [startDate, endDate] of ranges) {
    for (const includeUnposted of [false, true]) {
      const base = { ...ctx(s.id), startDate, endDate, includeUnposted }
      const cases: [string, { sql: string; params: any[] }][] = [
        ['general', buildLedgerGeneralQuery(base)],
        ['quantity', buildQuantityBalanceQuery(base)],
        [
          'foreign',
          buildForeignBalanceQuery({ ...base, foreignPreBookEnabled: hasForeignPreBookColumns(db as any) }),
        ],
      ]
      for (const [name, q] of cases) {
        const key = `${s.name}|${name}|${startDate}~${endDate}|unposted=${includeUnposted}`
        const t0 = performance.now()
        result[key] = normalize(db.prepare(q.sql).all(...q.params))
        timings[key] = Math.round(performance.now() - t0)
      }
    }
  }
}
db.close()
fs.unlinkSync(tmp)

const slow = Object.entries(timings).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('最慢 5 项(ms):', slow)
console.log('总耗时(ms):', Object.values(timings).reduce((a, b) => a + b, 0))

if (mode === 'save') {
  fs.mkdirSync(path.dirname(SNAP), { recursive: true })
  fs.writeFileSync(SNAP, JSON.stringify(result))
  console.log(`已保存 ${Object.keys(result).length} 组结果 → ${SNAP}`)
} else {
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')) as Record<string, any[]>
  let bad = 0
  for (const key of Object.keys(snap)) {
    const a = JSON.stringify(snap[key])
    const b = JSON.stringify(result[key])
    if (a !== b) {
      bad++
      console.log(`❌ 不一致: ${key}`)
      const rowsA = snap[key], rowsB = result[key] || []
      if (rowsA.length !== rowsB.length) console.log(`   行数 ${rowsA.length} → ${rowsB.length}`)
      for (let i = 0; i < Math.min(rowsA.length, rowsB.length); i++) {
        if (JSON.stringify(rowsA[i]) !== JSON.stringify(rowsB[i])) {
          console.log('   快照:', JSON.stringify(rowsA[i]))
          console.log('   当前:', JSON.stringify(rowsB[i]))
          break
        }
      }
    }
  }
  console.log(bad === 0 ? `✅ ${Object.keys(snap).length} 组结果全部一致` : `共 ${bad} 组不一致`)
  process.exit(bad === 0 ? 0 : 1)
}
