#!/usr/bin/env node
/**
 * 迁移脚本：为现有账套初始化结转配置
 * 用途：修复因账套创建时未初始化结转类型和配置项导致的数据缺失问题
 */

import { getDb } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

function migrateTransferConfig() {
  const db = getDb()

  // 获取所有账套
  const accountSets = db.prepare('SELECT id, name FROM account_sets').all() as Array<{ id: string; name: string }>

  if (accountSets.length === 0) {
    console.log('[迁移] 未找到账套')
    return
  }

  for (const accountSet of accountSets) {
    console.log(`\n[迁移] 处理账套: ${accountSet.name} (${accountSet.id})`)

    // 检查结转类型
    const transferTypeCount = (
      db.prepare('SELECT COUNT(*) as c FROM transfer_types WHERE account_set_id = ?').get(accountSet.id) as any
    ).c

    if (transferTypeCount === 0) {
      console.log('[迁移] 初始化结转类型...')
      insertTransferTypes(accountSet.id)
      console.log('[迁移] ✓ 已插入 9 个结转类型')
    } else {
      console.log(`[迁移] 结转类型已存在 (${transferTypeCount} 条)`)
    }

    // 检查结转配置项
    const transferItemCount = (
      db.prepare('SELECT COUNT(*) as c FROM transfer_items WHERE account_set_id = ?').get(accountSet.id) as any
    ).c

    if (transferItemCount === 0) {
      console.log('[迁移] 初始化结转配置项...')
      insertTransferItems(accountSet.id)
      const newCount = (
        db.prepare('SELECT COUNT(*) as c FROM transfer_items WHERE account_set_id = ?').get(accountSet.id) as any
      ).c
      console.log(`[迁移] ✓ 已插入 ${newCount} 个结转配置项`)
    } else {
      console.log(`[迁移] 结转配置项已存在 (${transferItemCount} 条)`)
    }

    // 检查系统参数
    const params = [
      { key: 'transfer_balance_account', value: '3301', desc: '结转结余科目' },
      { key: 'transfer_surplus_account', value: '3301', desc: '本期盈余科目' },
      { key: 'transfer_voucher_type', value: '结转', desc: '自动结转凭证类型' },
    ]

    for (const param of params) {
      const existing = db
        .prepare('SELECT * FROM system_params WHERE account_set_id = ? AND param_key = ?')
        .get(accountSet.id, param.key)

      if (!existing) {
        db.prepare('INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)').run(
          uuidv4(),
          accountSet.id,
          param.key,
          param.value
        )
        console.log(`[迁移] ✓ 已添加系统参数: ${param.desc} = ${param.value}`)
      }
    }
  }

  console.log('\n[迁移] 完成！')
}

// 初始化结转类型
function insertTransferTypes(accountSetId: string) {
  const db = getDb()

  const transferTypes = [
    { id: '1', code: '10', name: '结转本期收', voucherType: '结转' },
    { id: '2', code: '20', name: '结转本期支', voucherType: '结转' },
    { id: '3', code: '60', name: '结转盈余(口)', voucherType: '结转' },
    { id: '4', code: '70', name: '结转累计盈', voucherType: '结转' },
    { id: '5', code: '80', name: '结转财政拨', voucherType: '结转' },
    { id: '6', code: '82', name: '结转非财政', voucherType: '结转' },
    { id: '7', code: '84', name: '结转其他资', voucherType: '结转' },
    { id: '8', code: '86', name: '结转经营(口)', voucherType: '结转' },
    { id: '9', code: '88', name: '财政拨款结', voucherType: '结转' },
  ]

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transfer_types (id, code, name, voucher_type, account_set_id)
    VALUES (?, ?, ?, ?, ?)
  `)

  for (const t of transferTypes) {
    insert.run(t.id, t.code, t.name, t.voucherType, accountSetId)
  }
}

// 初始化结转配置项
function insertTransferItems(accountSetId: string) {
  const db = getDb()

  // 结转本期收入配置
  const incomeItems = [
    { typeCode: '10', summary: '结转财政拨款收入', fromCode: '4001', fromName: '财政拨款收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转事业收入', fromCode: '4101', fromName: '事业收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转上级补助收入', fromCode: '4201', fromName: '上级补助收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转附属单位上缴收入', fromCode: '4301', fromName: '附属单位上缴收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转经营收入', fromCode: '4401', fromName: '经营收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转非同级财政拨款收入', fromCode: '4601', fromName: '非同级财政拨款收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转投资收益', fromCode: '4602', fromName: '投资收益', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转捐赠收入', fromCode: '4603', fromName: '捐赠收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转利息收入', fromCode: '4604', fromName: '利息收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转租金收入', fromCode: '4605', fromName: '租金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '结转其他收入', fromCode: '4609', fromName: '其他收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '10', summary: '转入本期盈余', fromCode: '', fromName: '', toCode: '3301', toName: '本期盈余', transferType: 'all', ratio: 100 },
  ]

  // 结转本期支出配置
  const expenseItems = [
    { typeCode: '20', summary: '结转业务活动费用', fromCode: '5001', fromName: '业务活动费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转单位管理费用', fromCode: '5101', fromName: '单位管理费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转经营费用', fromCode: '5201', fromName: '经营费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转资产处置费用', fromCode: '5301', fromName: '资产处置费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转上缴上级费用', fromCode: '5401', fromName: '上缴上级费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转对附属单位补助费用', fromCode: '5501', fromName: '对附属单位补助费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转利息费用', fromCode: '5701', fromName: '利息费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转所得税费用', fromCode: '5801', fromName: '所得税费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '结转其他费用', fromCode: '5901', fromName: '其他费用', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '20', summary: '转入本期盈余', fromCode: '', fromName: '', toCode: '3301', toName: '本期盈余', transferType: 'all', ratio: 100 },
  ]

  // 结转盈余配置
  const surplusItems = [
    { typeCode: '60', summary: '结转本期盈余', fromCode: '3301', fromName: '本期盈余', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '60', summary: '转入本年盈余分配', fromCode: '', fromName: '', toCode: '3302', toName: '本年盈余分配', transferType: 'all', ratio: 100 },
  ]

  // 结转累计盈余配置
  const accumulatedItems = [
    { typeCode: '70', summary: '结转本年盈余分配', fromCode: '3302', fromName: '本年盈余分配', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '结转无偿调拨净资产', fromCode: '3401', fromName: '无偿调拨净资产', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '结转以前年度盈余调整', fromCode: '3501', fromName: '以前年度盈余调整', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '70', summary: '转入累计盈余', fromCode: '', fromName: '', toCode: '3001', toName: '累计盈余', transferType: 'all', ratio: 100 },
  ]

  // 财政拨款结转配置
  const financeItems = [
    { typeCode: '80', summary: '结转财政拨款预算收入', fromCode: '6001', fromName: '财政拨款预算收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '结转行政支出财政拨款', fromCode: '710101', fromName: '行政支出财政拨款支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '结转事业支出财政拨款', fromCode: '720101', fromName: '事业支出财政拨款支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '80', summary: '转入财政拨款结转', fromCode: '', fromName: '', toCode: '810106', toName: '财政拨款结转/本年收支结转', transferType: 'all', ratio: 100 },
  ]

  // 非财政拨款结转配置
  const nonFinanceItems = [
    { typeCode: '82', summary: '结转事业预算收入专项', fromCode: '610101', fromName: '事业预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转上级补助预算收入专项', fromCode: '620101', fromName: '上级补助预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转附属单位上缴预算收入专项', fromCode: '630101', fromName: '附属单位上缴预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转债务预算收入专项', fromCode: '650101', fromName: '债务预算收入/专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '结转非同级财政拨款预算收入专项', fromCode: '660101', fromName: '非同级财政拨款预算收入/专项资金', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '82', summary: '转入非财政拨款结转', fromCode: '', fromName: '', toCode: '820104', toName: '非财政拨款结转/本年收支结转', transferType: 'all', ratio: 100 },
  ]

  // 其他资金结转配置
  const otherItems = [
    { typeCode: '84', summary: '结转事业预算收入非专项', fromCode: '610102', fromName: '事业预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转上级补助预算收入非专项', fromCode: '620102', fromName: '上级补助预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转附属单位上缴预算收入非专项', fromCode: '630102', fromName: '附属单位上缴预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转债务预算收入非专项', fromCode: '650102', fromName: '债务预算收入/非专项资金收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '结转非同级财政拨款预算收入非专项', fromCode: '660102', fromName: '非同级财政拨款预算收入/非专项资金', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '84', summary: '转入其他结余', fromCode: '', fromName: '', toCode: '8501', toName: '其他结余', transferType: 'all', ratio: 100 },
  ]

  // 经营结转配置
  const operatingItems = [
    { typeCode: '86', summary: '结转经营预算收入', fromCode: '6401', fromName: '经营预算收入', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '86', summary: '结转经营支出', fromCode: '7301', fromName: '经营支出', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '86', summary: '转入经营结余', fromCode: '', fromName: '', toCode: '8401', toName: '经营结余', transferType: 'all', ratio: 100 },
  ]

  // 财政拨款结余配置
  const financeSurplusItems = [
    { typeCode: '88', summary: '结转财政拨款结转', fromCode: '810107', fromName: '财政拨款结转/累计结转', toCode: '', toName: '', transferType: 'all', ratio: 100 },
    { typeCode: '88', summary: '转入财政拨款结余', fromCode: '', fromName: '', toCode: '810205', toName: '财政拨款结余/累计结余', transferType: 'all', ratio: 100 },
  ]

  const allItems = [
    ...incomeItems,
    ...expenseItems,
    ...surplusItems,
    ...accumulatedItems,
    ...financeItems,
    ...nonFinanceItems,
    ...otherItems,
    ...operatingItems,
    ...financeSurplusItems,
  ]

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transfer_items
    (id, type_code, summary, from_code, from_name, to_code, to_name, transfer_type, ratio, sort_order, account_set_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  allItems.forEach((item, index) => {
    insert.run(
      uuidv4(),
      item.typeCode,
      item.summary,
      item.fromCode,
      item.fromName,
      item.toCode,
      item.toName,
      item.transferType,
      item.ratio,
      index,
      accountSetId
    )
  })
}

// 执行迁移
migrateTransferConfig()
