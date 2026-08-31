import { getDb } from '../db/index.js'

const accountSetId = process.argv[2] || 'cf363554-958b-4aaa-8838-563fb84ef608'

const db = getDb()

// 检查账套
const accountSet = db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId)
console.log('\n=== 账套信息 ===')
console.log(accountSet)

// 检查科目数量
const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE account_set_id = ?').get(accountSetId) as { count: number }
console.log('\n=== 科目数量 ===')
console.log(accountCount.count)

// 检查前几个科目
const accounts = db.prepare('SELECT code, name, level FROM accounts WHERE account_set_id = ? ORDER BY code LIMIT 10').all(accountSetId)
console.log('\n=== 前10个科目 ===')
console.log(accounts)

// 检查凭证数量
const voucherCount = db.prepare('SELECT COUNT(*) as count FROM vouchers WHERE account_set_id = ?').get(accountSetId) as { count: number }
console.log('\n=== 凭证数量 ===')
console.log(voucherCount.count)

// 检查凭证分录数量
const entryCount = db.prepare('SELECT COUNT(*) as count FROM voucher_entries WHERE account_set_id = ?').get(accountSetId) as { count: number }
console.log('\n=== 凭证分录数量 ===')
console.log(entryCount.count)

// 检查用户数量
const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE account_set_id = ?').get(accountSetId) as { count: number }
console.log('\n=== 用户数量 ===')
console.log(userCount.count)

// 检查用户列表
const users = db.prepare('SELECT username, nickname FROM users WHERE account_set_id = ?').all(accountSetId)
console.log('\n=== 用户列表 ===')
console.log(users)

// 检查凭证类型数量
const vtCount = db.prepare('SELECT COUNT(*) as count FROM voucher_types WHERE account_set_id = ?').get(accountSetId) as { count: number }
console.log('\n=== 凭证类型数量 ===')
console.log(vtCount.count)

// 检查凭证类型列表
const voucherTypes = db.prepare('SELECT code, name FROM voucher_types WHERE account_set_id = ?').all(accountSetId)
console.log('\n=== 凭证类型列表 ===')
console.log(voucherTypes)
