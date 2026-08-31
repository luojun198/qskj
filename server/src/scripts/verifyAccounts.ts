import { getDb } from '../db/index.js'

const db = getDb()
const accountSet = db.prepare('SELECT * FROM account_sets LIMIT 1').get() as any
if (!accountSet) {
  console.log('No account set found')
  process.exit(1)
}

type AccountRow = {
  id: string
  code: string
  name: string
  direction: 'debit' | 'credit'
  level: number
  parent_id: string | null
  is_aux: number
  aux_types: string | null
  is_cash: number
  is_bank: number
}

const accounts = db
  .prepare(
    `SELECT id, code, name, direction, level, parent_id, is_aux, aux_types, is_cash, is_bank FROM accounts WHERE account_set_id=? ORDER BY code`
  )
  .all(accountSet.id) as AccountRow[]

const requiredAccounts: Array<[string, string, 'debit' | 'credit']> = [
  ['1001', '库存现金', 'debit'],
  ['1002', '银行存款', 'debit'],
  ['1011', '零余额账户用款额度', 'debit'],
  ['1021', '其他货币资金', 'debit'],
  ['1201', '财政应返还额度', 'debit'],
  ['1811', '政府储备物资', 'debit'],
  ['1821', '文物资源', 'debit'],
  ['3301', '本期盈余', 'credit'],
  ['6001', '财政拨款预算收入', 'credit'],
  ['8101', '财政拨款结转', 'credit'],
]

const requiredHierarchy: Array<[string, string, number, string | null]> = [
  ['1002', '银行存款', 1, null],
]

const accountByCode = new Map(accounts.map(account => [account.code, account]))

for (const [code, expectedName, expectedDirection] of requiredAccounts) {
  const row = accountByCode.get(code)
  if (!row) {
    throw new Error(`missing required account ${code}`)
  }
  if (row.name !== expectedName) {
    throw new Error(`account ${code} expected name ${expectedName} but got ${row.name}`)
  }
  if (row.direction !== expectedDirection) {
    throw new Error(
      `account ${code} expected direction ${expectedDirection} but got ${row.direction}`
    )
  }
}

if (accounts.some(account => account.code === '1012' && account.name === '其他货币资金')) {
  throw new Error('old account code 1012 for 其他货币资金 still exists')
}

if (accounts.some(account => account.code === '100201' || account.code === '100202' || account.code === '10020201')) {
  throw new Error('derived bank hierarchy codes should not exist in strict document mode')
}


for (const [code, expectedName, expectedLevel, expectedParentCode] of requiredHierarchy) {
  const row = accountByCode.get(code)
  if (!row) {
    throw new Error(`missing hierarchy account ${code}`)
  }
  if (row.name !== expectedName) {
    throw new Error(`account ${code} expected name ${expectedName} but got ${row.name}`)
  }
  if (row.level !== expectedLevel) {
    throw new Error(`account ${code} expected level ${expectedLevel} but got ${row.level}`)
  }

  const parent = row.parent_id ? accounts.find(account => account.id === row.parent_id) : null
  const actualParentCode = parent?.code ?? null
  if (actualParentCode !== expectedParentCode) {
    throw new Error(
      `account ${code} expected parent ${expectedParentCode ?? 'null'} but got ${actualParentCode ?? 'null'}`
    )
  }
}

const byLevel: Record<number, AccountRow[]> = {}
for (const account of accounts) {
  if (!byLevel[account.level]) byLevel[account.level] = []
  byLevel[account.level].push(account)
}

console.log(`总科目: ${accounts.length}`)
for (let level = 1; level <= 4; level++) {
  console.log(`  ${level}级: ${byLevel[level]?.length || 0}个`)
}

console.log('\n关键科目校验通过')
