/**
 * 结转损益参数重置脚本
 * 清理混乱的结转损益配置，设置符合政府会计制度的默认值
 */

import { getDb } from '../db/index.ts'
import { v4 as uuidv4 } from 'uuid'

// 默认结转损益配置
const DEFAULT_TRANSFER_PARAMS = [
  { key: 'auto_transfer:balance_account_code', value: '3301', description: '结转平衡科目（优先）- 本期盈余' },
  { key: 'auto_transfer:surplus_account_code', value: '3301', description: '结转平衡科目（备选）- 本期盈余' },
]

function resetTransferParams(accountSetId) {
  const db = getDb()

  const transaction = db.transaction(() => {
    // 步骤1：清理所有结转损益相关参数（包括混乱的配置）
    const deleteStmt = db.prepare(`
      DELETE FROM system_params
      WHERE account_set_id = ?
        AND param_key LIKE 'auto_transfer%'
    `)
    const deleteResult = deleteStmt.run(accountSetId)
    const cleanedCount = deleteResult.changes || 0

    // 步骤2：插入正确的默认配置
    const insertStmt = db.prepare(`
      INSERT INTO system_params (id, account_set_id, param_key, param_value, description)
      VALUES (?, ?, ?, ?, ?)
    `)
    let insertedCount = 0
    for (const param of DEFAULT_TRANSFER_PARAMS) {
      insertStmt.run(uuidv4(), accountSetId, param.key, param.value, param.description)
      insertedCount++
    }

    return { cleanedCount, insertedCount }
  })

  return transaction()
}

function listTransferParams(accountSetId) {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM system_params
    WHERE account_set_id = ?
      AND param_key LIKE 'auto_transfer%'
    ORDER BY param_key
  `).all(accountSetId)
}

async function main() {
  try {
    const db = getDb()

    // 获取当前账套ID
    const accountSet = db.prepare('SELECT id, name FROM account_sets WHERE status = ? LIMIT 1').get('active')
    if (!accountSet) {
      console.error('未找到活跃的账套')
      process.exit(1)
    }

    console.log(`=== 结转损益参数重置 ===`)
    console.log(`目标账套: ${accountSet.name} (${accountSet.id})`)
    console.log('')

    // 显示重置前的配置
    console.log('【重置前】结转损益参数:')
    const beforeParams = listTransferParams(accountSet.id)
    if (beforeParams.length === 0) {
      console.log('  (无配置)')
    } else {
      for (const p of beforeParams) {
        console.log(`  ${p.param_key}: "${p.param_value}"`)
      }
    }
    console.log('')

    // 执行重置
    const { cleanedCount, insertedCount } = resetTransferParams(accountSet.id)
    console.log(`【执行重置】`)
    console.log(`  - 清理混乱配置: ${cleanedCount} 条`)
    console.log(`  - 插入默认配置: ${insertedCount} 条`)
    console.log('')

    // 显示重置后的配置
    console.log('【重置后】结转损益参数:')
    const afterParams = listTransferParams(accountSet.id)
    for (const p of afterParams) {
      console.log(`  ${p.param_key}: "${p.param_value}" (${p.description || ''})`)
    }
    console.log('')

    // 验证科目是否存在
    console.log('【科目验证】')
    const balanceAccount = db.prepare(`
      SELECT code, name FROM accounts
      WHERE account_set_id = ? AND code = ?
    `).get(accountSet.id, '3301')

    if (balanceAccount) {
      console.log(`  ✓ 本期盈余科目存在: ${balanceAccount.code} ${balanceAccount.name}`)
    } else {
      console.log(`  ✗ 警告: 未找到本期盈余科目(3301)，请检查科目表`)
    }

    console.log('')
    console.log('=== 重置完成 ===')
    console.log('提示：重置后请刷新系统参数页面查看配置')

  } catch (error) {
    console.error('重置失败:', error)
    process.exit(1)
  }
}

main()
