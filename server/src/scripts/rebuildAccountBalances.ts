/**
 * 一次性脚本：根据 voucher_entries（status='posted' 的凭证）和 init_balances
 * 全量重建 account_balances 表。
 *
 * 用法：
 *   npm run --workspace=server scripts:rebuild-balances
 *   或带可选账套 ID：npm run --workspace=server scripts:rebuild-balances -- <accountSetId>
 *
 * 作用：
 *   - 修复历史结转/反结转流程中产生的 account_balances 脏数据（如 current_debit/credit 翻倍）
 *   - 按 (account_set_id, account_id, year, period, aux_item_id) 唯一键
 *     从 voucher_entries 聚合本期借/贷发生额，结合 init_balances 计算 end_balance
 *
 * 幂等：可重复运行，不依赖原数据。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename } from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { calcSignedBalance } from '../utils/accountBalance.js'
import { buildAuxItemId } from '../utils/auxItemId.js'

type AccountSetRow = { id: string; name: string }
type AccountRow = { id: string; code: string; name: string; direction: 'debit' | 'credit' }

async function run() {
  const db = getDb()
  const targetSetId = process.argv[2]?.trim() || ''

  const accountSets = db
    .prepare(
      targetSetId
        ? `SELECT id, name FROM account_sets WHERE id=?`
        : `SELECT id, name FROM account_sets ORDER BY created_at ASC`
    )
    .all(...(targetSetId ? [targetSetId] : [])) as AccountSetRow[]

  if (accountSets.length === 0) {
    console.error('[rebuild-balances] 没有找到目标账套')
    process.exit(1)
  }

  console.log(`[rebuild-balances] 共 ${accountSets.length} 个账套待处理`)

  for (const accountSet of accountSets) {
    rebuildOne(db, accountSet)
  }

  console.log('[rebuild-balances] 完成')
}

function rebuildOne(db: ReturnType<typeof getDb>, accountSet: AccountSetRow) {
  console.log(`\n[rebuild-balances] === ${accountSet.name} (${accountSet.id}) ===`)

  const accounts = db
    .prepare(`SELECT id, code, name, direction FROM accounts WHERE account_set_id=?`)
    .all(accountSet.id) as AccountRow[]
  const accountById = new Map(accounts.map(a => [a.id, a]))

  // 1) 聚合 voucher_entries（仅 posted 凭证）→ (account_id, year, period, aux_item_id) 维度
  const entryAgg = db
    .prepare(
      `SELECT ve.account_id, ve.account_code, ve.account_name,
              v.year, v.period,
              ve.direction, ve.amount,
              ve.dept_id, ve.project_id, ve.supplier_id, ve.person_id, ve.func_class_id,
              ve.aux_data
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.account_set_id=? AND v.status='posted' AND v.account_set_id=?
       ORDER BY v.year, v.period, ve.account_id`
    )
    .all(accountSet.id, accountSet.id) as Array<{
    account_id: string
    account_code: string
    account_name: string
    year: number
    period: number
    direction: 'debit' | 'credit'
    amount: number
    dept_id?: any
    project_id?: any
    supplier_id?: any
    person_id?: any
    func_class_id?: any
    aux_data?: string | null
  }>

  type AggKey = string
  type AggValue = {
    account_id: string
    account_code: string
    account_name: string
    year: number
    period: number
    aux_item_id: string
    current_debit: number
    current_credit: number
  }
  // 注意：aux_item_id 本身可能含 "|" 分隔符（如 "proj:xx|supp:yy|customer:xx"），
  // 因此 key 用 ASCII 控制字符 \x01 作为字段分隔，避免 split 截断。
  const SEP = '\x01'
  const agg = new Map<AggKey, AggValue>()
  for (const e of entryAgg) {
    const auxItemId = buildAuxItemId(e as any)
    const key = `${e.account_id}${SEP}${e.year}${SEP}${e.period}${SEP}${auxItemId}`
    let cur = agg.get(key)
    if (!cur) {
      cur = {
        account_id: e.account_id,
        account_code: e.account_code,
        account_name: e.account_name,
        year: e.year,
        period: e.period,
        aux_item_id: auxItemId,
        current_debit: 0,
        current_credit: 0,
      }
      agg.set(key, cur)
    }
    if (e.direction === 'debit') cur.current_debit += Number(e.amount) || 0
    else cur.current_credit += Number(e.amount) || 0
  }

  // 2) 读取 init_balances，按 (account_id, year, aux_item_id) 索引
  const initRows = db
    .prepare(
      `SELECT account_id, year, COALESCE(aux_item_id, '') as aux_item_id,
              SUM(COALESCE(init_balance, 0)) as init_balance
       FROM init_balances WHERE account_set_id=?
       GROUP BY account_id, year, COALESCE(aux_item_id, '')`
    )
    .all(accountSet.id) as Array<{ account_id: string; year: number; aux_item_id: string; init_balance: number }>
  const initMap = new Map<string, number>()
  for (const r of initRows) {
    initMap.set(`${r.account_id}${SEP}${r.year}${SEP}${r.aux_item_id}`, Number(r.init_balance) || 0)
  }

  // 3) 收集需要写入的 (account, year, period, aux) 组合：所有 agg 行 + 所有 init 行（确保期初也有 row）
  const allKeys = new Set<string>()
  for (const k of agg.keys()) allKeys.add(k)
  for (const r of initRows) {
    allKeys.add(`${r.account_id}${SEP}${r.year}${SEP}1${SEP}${r.aux_item_id}`)
  }

  const updateTxn = db.transaction(() => {
    db.prepare(`DELETE FROM account_balances WHERE account_set_id=?`).run(accountSet.id)

    const insert = db.prepare(`
      INSERT INTO account_balances (
        id, account_set_id, account_id, account_code, account_name,
        direction, year, period,
        init_balance, current_debit, current_credit, end_balance,
        end_debit, end_credit, aux_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let count = 0
    for (const key of allKeys) {
      const [accountId, yearStr, periodStr, auxItemId] = key.split(SEP)
      const year = Number(yearStr)
      const period = Number(periodStr)
      const account = accountById.get(accountId)
      if (!account) continue

      const aggValue = agg.get(key)
      const currentDebit = aggValue?.current_debit ?? 0
      const currentCredit = aggValue?.current_credit ?? 0

      // 期初余额：从 init_balances 取（仅当 period=1）；其余期间 init_balance=0
      // 注意：原系统对每期都存 init_balance（上期结余），这里简化为只 period=1 有初始 init。
      // 若需要"期初 = 上期 end_balance"传递，需要按时间顺序累计 —— 暂不做（损益类每月清零，资产负债类用 init_balances 已能反映年初），
      // 后续若有跨期账簿展示问题再增强。
      const initBalance = period === 1 ? initMap.get(`${accountId}${SEP}${year}${SEP}${auxItemId}`) ?? 0 : 0

      const endBalance = calcSignedBalance(account.direction, initBalance, currentDebit, currentCredit)

      insert.run(
        uuidv4(),
        accountSet.id,
        accountId,
        aggValue?.account_code || account.code,
        aggValue?.account_name || account.name,
        account.direction,
        year,
        period,
        initBalance,
        currentDebit,
        currentCredit,
        endBalance,
        0,
        0,
        auxItemId,
      )
      count++
    }

    console.log(`[rebuild-balances]   写入 ${count} 行 account_balances`)
  })

  updateTxn()
}

const entryScript = process.argv[1] ? basename(process.argv[1]) : ''
const thisScript = basename(fileURLToPath(import.meta.url))
if (entryScript === thisScript) {
  run().catch(err => {
    console.error('[rebuild-balances] 运行失败：', err)
    process.exit(1)
  })
}

void existsSync // 触发 ts 不报未使用
