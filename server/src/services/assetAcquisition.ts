/**
 * 固定资产购入凭证生成
 *
 * 新增资产卡片时可选生成购置凭证（单分录，与折旧/处置凭证风格一致）：
 *   借：固定资产（资产类别配置的 account_code，回退 1601）  原值
 *   贷：资金来源科目（前端选择，默认银行存款 1001）         原值
 *
 * P0-1：分录经 assetVoucherBuilder 统一落库，借方固定资产科目按资产部门带出辅助核算项。
 */
import type { Database } from 'better-sqlite3'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
} from './assetVoucherBuilder.js'
import type { VoucherEntryInput } from './voucherEntry.js'

export interface PurchaseVoucherResult {
  voucherId: string
  voucherNo: string
  entryCount: number
  amount: number
}

export function generatePurchaseVoucher(params: {
  db: Database
  accountSetId: string
  asset: any // fixed_asset 行（含 asset_no/asset_name/original_value/category_code/acquire_date/dept_code）
  creditAccount: string // 贷方（资金来源）科目编码
  voucherTypeId: string | null
  makerName: string
}): PurchaseVoucherResult {
  const { db, accountSetId, asset, creditAccount, voucherTypeId, makerName } = params

  const amount = Math.round(Number(asset.original_value || 0) * 100) / 100
  if (amount <= 0) throw new Error('资产原值为 0，无法生成购置凭证')

  // 借方：固定资产科目（资产类别配置，回退 1601）
  const assetCat = (
    asset.category_code
      ? db
          .prepare('SELECT account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?')
          .get(accountSetId, asset.category_code)
      : null
  ) as any
  const debitCode = assetCat?.account_code || '1601'
  const creditCode = creditAccount || '1001'

  const accounts = resolveAccounts(db, accountSetId, [debitCode, creditCode], '购置')
  const debitRow = accounts.get(debitCode)!
  const creditRow = accounts.get(creditCode)!

  // 凭证日期 = 取得日期（无则今天），按其年月编号
  const voucherDate =
    asset.acquire_date && /^\d{4}-\d{2}-\d{2}$/.test(asset.acquire_date)
      ? asset.acquire_date
      : new Date().toISOString().slice(0, 10)
  const year = parseInt(voucherDate.split('-')[0])
  const month = parseInt(voucherDate.split('-')[1])

  const auxContext = loadAssetAuxContext(db, accountSetId)
  const assetRefs = resolveAssetAuxRefs(db, accountSetId, asset, auxContext)

  const summary = `购入固定资产：${asset.asset_name}`
  const entries: VoucherEntryInput[] = [
    {
      account_id: debitRow.id,
      account_code: debitRow.code,
      account_name: debitRow.name,
      direction: 'debit',
      amount,
      summary,
      ...auxRefsForAccount(db, accountSetId, debitRow.code, assetRefs, auxContext),
    },
    {
      account_id: creditRow.id,
      account_code: creditRow.code,
      account_name: creditRow.name,
      direction: 'credit',
      amount,
      summary,
      ...auxRefsForAccount(db, accountSetId, creditRow.code, assetRefs, auxContext),
    },
  ]

  const result = insertAssetVoucher({
    db,
    accountSetId,
    source: 'asset_purchase',
    voucherDate,
    year,
    period: month,
    remark: `固定资产购入：${asset.asset_name}（编号 ${asset.asset_no}）`,
    makerName,
    voucherTypeId,
    entries,
    auxContext,
  })

  return {
    voucherId: result.voucherId,
    voucherNo: result.voucherNo,
    entryCount: result.entryCount,
    amount,
  }
}
