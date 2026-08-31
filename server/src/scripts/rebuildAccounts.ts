// 一次性脚本：重建标准化科目数据
import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { rebuildAccounts } from './seedAccounts.js'

const db = getDb()
const accountSet = db.prepare('SELECT * FROM account_sets LIMIT 1').get() as any

if (!accountSet) {
  console.log('没有找到账套，请先启动服务器初始化数据库')
  process.exit(1)
}

console.log(`找到账套: ${accountSet.name} (${accountSet.id})`)

// 检查现有科目数量
const before = (
  db.prepare('SELECT COUNT(*) as c FROM accounts WHERE account_set_id=?').get(accountSet.id) as any
).c
console.log(`重建前科目数量: ${before}`)

// 重建
const count = rebuildAccounts(accountSet.id)
console.log(`重建后科目数量: ${count}`)

// 验证父子关系
const parentCheck = db
  .prepare(
    `
  SELECT COUNT(*) as total,
         SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END) as no_parent
  FROM accounts WHERE account_set_id=?
`
  )
  .get(accountSet.id) as any
console.log(`总科目: ${parentCheck.total}, 无父级(一级的): ${parentCheck.no_parent}`)

process.exit(0)
