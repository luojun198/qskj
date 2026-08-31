/**
 * 固定资产购入凭证生成
 *
 * 新增资产卡片时可选生成购置凭证（单分录，与折旧/处置凭证风格一致）：
 *   借：固定资产（资产类别配置的 account_code，回退 1601）  原值
 *   贷：资金来源科目（前端选择，默认银行存款 1001）         原值
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export interface PurchaseVoucherResult {
  voucherId: string
  voucherNo: string
  entryCount: number
  amount: number
}

export function generatePurchaseVoucher(params: {
  db: Database
  accountSetId: string
  asset: any                  // fixed_asset 行（含 asset_no/asset_name/original_value/category_code/acquire_date）
  creditAccount: string       // 贷方（资金来源）科目编码
  voucherTypeId: string | null
  makerName: string
}): PurchaseVoucherResult {
  const { db, accountSetId, asset, creditAccount, voucherTypeId, makerName } = params

  const amount = Math.round(Number(asset.original_value || 0) * 100) / 100
  if (amount <= 0) throw new Error('资产原值为 0，无法生成购置凭证')

  const lookupAcc = db.prepare('SELECT id, code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')

  // 借方：固定资产科目（资产类别配置，回退 1601）
  const assetCat = (asset.category_code
    ? db.prepare('SELECT account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?').get(accountSetId, asset.category_code)
    : null) as any
  const debitCode = assetCat?.account_code || '1601'
  const creditCode = creditAccount || '1001'

  const debitRow = lookupAcc.get(accountSetId, debitCode) as any
  const creditRow = lookupAcc.get(accountSetId, creditCode) as any
  const missing: string[] = []
  if (!debitRow) missing.push(debitCode)
  if (!creditRow) missing.push(creditCode)
  if (missing.length > 0) {
    throw new Error(`以下科目在账套中不存在，无法生成购置凭证：${missing.join('、')}`)
  }

  // 凭证日期 = 取得日期（无则今天），按其年月编号
  const voucherDate = (asset.acquire_date && /^\d{4}-\d{2}-\d{2}$/.test(asset.acquire_date))
    ? asset.acquire_date
    : new Date().toISOString().slice(0, 10)
  const year = parseInt(voucherDate.split('-')[0])
  const month = parseInt(voucherDate.split('-')[1])

  // 凭证号：期间全局最大号 + 1（与折旧/处置一致）
  const lastNo = (db.prepare(`
    SELECT CAST(
      CASE WHEN INSTR(voucher_no,'-')>0 THEN SUBSTR(voucher_no,INSTR(voucher_no,'-')+1) ELSE voucher_no END
      AS INTEGER) no
    FROM vouchers WHERE account_set_id=? AND year=? AND period=?
    ORDER BY no DESC LIMIT 1
  `).get(accountSetId, year, month) as any)?.no ?? 0
  const voucherNo = String(lastNo + 1).padStart(3, '0')

  const voucherId = uuidv4()

  db.prepare(`
    INSERT INTO vouchers
      (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period,
       total_amount, maker_name, remark, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'asset_purchase')
  `).run(
    voucherId, accountSetId, voucherNo, voucherTypeId ?? null,
    voucherDate, year, month, amount, makerName,
    `固定资产购入：${asset.asset_name}（编号 ${asset.asset_no}）`
  )

  const insEntry = db.prepare(`
    INSERT INTO voucher_entries
      (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
       direction, amount, amount_cents, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const summary = `购入固定资产：${asset.asset_name}`
  // 借：固定资产
  insEntry.run(uuidv4(), accountSetId, voucherId, 1, debitRow.id, debitRow.code, debitRow.name, 'debit', amount, Math.round(amount * 100), summary)
  // 贷：资金来源
  insEntry.run(uuidv4(), accountSetId, voucherId, 2, creditRow.id, creditRow.code, creditRow.name, 'credit', amount, Math.round(amount * 100), summary)

  return { voucherId, voucherNo, entryCount: 2, amount }
}
