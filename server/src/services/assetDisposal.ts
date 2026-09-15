/**
 * 固定资产处置服务
 *
 * 处理资产减少（出售/报废/损毁/盘亏/捐赠等），可选生成清理凭证
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
  getAssetParam,
  assertPeriodOpen,
} from './assetVoucherBuilder.js'
import type { VoucherEntryInput } from './voucherEntry.js'

export interface DisposalParams {
  db: Database
  accountSetId: string
  assetId: string
  /** 减少方式编码（对应 fixed_asset_change_type direction='decrease'） */
  changeTypeCode: string | null
  /** 减少日期 */
  scrapDate: string
  /** 减少原因/备注 */
  scrapReason: string | null
  /** 处置收入（残值回收款等） */
  disposalIncome?: number
  /** 处置费用（清理费用等） */
  disposalExpense?: number
  /** 累计折旧科目 */
  accumAccount?: string
  /** 固定资产清理科目 */
  clearingAccount?: string
  /** 是否生成凭证 */
  generateVoucher?: boolean
  /** 制单人 */
  operatorName?: string
  /** 处置凭证类型（参数 asset:disposal_voucher_type_id，缺省时由取号逻辑推断） */
  voucherTypeId?: string | null
}

export interface DisposalResult {
  assetNo: string
  assetName: string
  originalValue: number
  accumDepr: number
  netValue: number
  disposalGainLoss: number
  voucher?: any
  voucherWarning?: string
}

export function disposeAsset(params: DisposalParams): DisposalResult {
  const {
    db, accountSetId, assetId, changeTypeCode, scrapDate, scrapReason,
    disposalIncome = 0, disposalExpense = 0,
    accumAccount = '1602', clearingAccount = '1606',
    generateVoucher = false, operatorName = '系统', voucherTypeId = null,
  } = params

  const asset = db.prepare(
    'SELECT * FROM fixed_asset WHERE id = ? AND account_set_id = ?'
  ).get(assetId, accountSetId) as any

  if (!asset) throw new Error('资产不存在')
  if (asset.scrap_date) throw new Error('该资产已处置，不能重复处置')

  // P0-5：处置所属会计期间已结账则拒绝（无论是否生成凭证，资产账都会变动）
  assertPeriodOpen(
    db,
    accountSetId,
    parseInt(scrapDate.split('-')[0]),
    parseInt(scrapDate.split('-')[1])
  )

  const originalValue = asset.original_value
  const accumDepr = asset.accum_depr
  const netValue = asset.net_value
  const salvageValue = asset.salvage_value || 0

  // 处置损益 = 处置收入 - 处置费用 - 净值
  const disposalGainLoss = Math.round((disposalIncome - disposalExpense - netValue) * 100) / 100

  // 在事务中执行
  db.transaction(() => {
    // 1. 更新资产卡片（存处置前状态，供撤销还原）
    db.prepare(`
      UPDATE fixed_asset SET
        status_code = '04',
        pre_scrap_status = ?,
        scrap_date = ?, scrap_reason = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(asset.status_code || '01', scrapDate, scrapReason, assetId)

    // 2. 记录变动流水
    const changeTypeName = changeTypeCode
      ? (db.prepare('SELECT name FROM fixed_asset_change_type WHERE account_set_id=? AND code=?').get(accountSetId, changeTypeCode) as any)?.name
      : null

    db.prepare(`
      INSERT INTO fixed_asset_change
        (id, account_set_id, asset_no, change_date, change_item, old_value, new_value, amount, remark, operator,
         change_kind, change_type_code, year, period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispose', ?, ?, ?)
    `).run(
      uuidv4(), accountSetId, asset.asset_no,
      scrapDate,
      `资产减少${changeTypeName ? '（' + changeTypeName + '）' : ''}`,
      originalValue, 0, -originalValue,
      scrapReason || null,
      operatorName,
      changeTypeCode ?? null,
      parseInt(scrapDate.split('-')[0]),
      parseInt(scrapDate.split('-')[1])
    )

    // 3. 可选生成清理凭证
    if (generateVoucher) {
      const vid = generateDisposalVoucher({
        db, accountSetId, asset, scrapDate, scrapReason, changeTypeName,
        originalValue, accumDepr, netValue, salvageValue,
        disposalIncome, disposalExpense, disposalGainLoss,
        accumAccount, clearingAccount,
        operatorName, voucherTypeId,
      })
      db.prepare('UPDATE fixed_asset SET scrap_voucher_id=? WHERE id=?').run(vid, assetId)
    }
  })()

  return {
    assetNo: asset.asset_no,
    assetName: asset.asset_name,
    originalValue,
    accumDepr,
    netValue,
    disposalGainLoss,
  }
}

interface VoucherGenParams {
  db: Database
  accountSetId: string
  asset: any
  scrapDate: string
  scrapReason: string | null
  changeTypeName: string | null
  originalValue: number
  accumDepr: number
  netValue: number
  salvageValue: number
  disposalIncome: number
  disposalExpense: number
  disposalGainLoss: number
  accumAccount: string
  clearingAccount: string
  operatorName: string
  voucherTypeId?: string | null
}

function generateDisposalVoucher(params: VoucherGenParams): string {
  const {
    db, accountSetId, asset, scrapDate, scrapReason,
    changeTypeName, originalValue, accumDepr, netValue,
    disposalIncome, disposalExpense, disposalGainLoss,
    accumAccount, clearingAccount, operatorName, voucherTypeId,
  } = params

  const scrapYear = parseInt(scrapDate.split('-')[0])
  const scrapMonth = parseInt(scrapDate.split('-')[1])

  // 查找资产所属类别的科目配置
  const assetCat = (asset.category_code
    ? db.prepare('SELECT account_code, depr_account_code, clearing_account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?').get(accountSetId, asset.category_code)
    : null) as any

  const assetAccountCode = assetCat?.account_code || '1601'
  const actualAccumAccount = assetCat?.depr_account_code || accumAccount || '1602'
  const actualClearingAccount = assetCat?.clearing_account_code || clearingAccount || '1606'

  /**
   * P0-2：银行存款 / 营业外收支科目原先硬编码为 1001 / 6301 / 6711，且查不到时
   * 静默跳过分录，会生成借贷不平的坏凭证。现改为读参数（默认值不变），
   * 并与其余科目一起预检——缺失即抛错，绝不生成半截凭证。
   */
  const bankCode = getAssetParam(db, accountSetId, 'asset:disposal_bank_account') || '1001'
  const gainCode = getAssetParam(db, accountSetId, 'asset:disposal_gain_account') || '6301'
  const lossCode = getAssetParam(db, accountSetId, 'asset:disposal_loss_account') || '6711'

  // 只预检本次实际会用到的科目
  const requiredCodes: string[] = [assetAccountCode, actualClearingAccount]
  if (accumDepr > 0) requiredCodes.push(actualAccumAccount)
  if (disposalIncome > 0 || disposalExpense > 0) requiredCodes.push(bankCode)
  if (disposalGainLoss > 0) requiredCodes.push(gainCode)
  if (disposalGainLoss < 0) requiredCodes.push(lossCode)

  const accounts = resolveAccounts(db, accountSetId, requiredCodes, '处置')

  const auxContext = loadAssetAuxContext(db, accountSetId)
  const assetRefs = resolveAssetAuxRefs(db, accountSetId, asset, auxContext)

  const summary = `处置资产：${asset.asset_name}（编号 ${asset.asset_no}）`
  const entries: VoucherEntryInput[] = []
  const push = (
    code: string,
    direction: 'debit' | 'credit',
    amount: number,
    entrySummary: string
  ) => {
    const acc = accounts.get(code)!
    entries.push({
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      direction,
      amount: Math.round(amount * 100) / 100,
      summary: entrySummary,
      ...auxRefsForAccount(db, accountSetId, acc.code, assetRefs, auxContext),
    })
  }

  // 借：累计折旧
  if (accumDepr > 0) push(actualAccumAccount, 'debit', accumDepr, summary)
  // 借：固定资产清理（净值）
  if (netValue > 0) push(actualClearingAccount, 'debit', netValue, summary)
  // 贷：固定资产（原值）
  push(assetAccountCode, 'credit', originalValue, summary)

  // 处置收入：借 银行存款 / 贷 固定资产清理
  if (disposalIncome > 0) {
    push(bankCode, 'debit', disposalIncome, `${summary}（处置收入）`)
    push(actualClearingAccount, 'credit', disposalIncome, `${summary}（处置收入）`)
  }

  // 处置费用：借 固定资产清理 / 贷 银行存款
  if (disposalExpense > 0) {
    push(actualClearingAccount, 'debit', disposalExpense, `${summary}（处置费用）`)
    push(bankCode, 'credit', disposalExpense, `${summary}（处置费用）`)
  }

  // 结转清理净损益
  if (disposalGainLoss > 0) {
    // 净收益：借 固定资产清理 / 贷 营业外收入
    push(actualClearingAccount, 'debit', disposalGainLoss, `${summary}（结转净收益）`)
    push(gainCode, 'credit', disposalGainLoss, `${summary}（结转净收益）`)
  } else if (disposalGainLoss < 0) {
    // 净损失：借 营业外支出 / 贷 固定资产清理
    const absGainLoss = Math.abs(disposalGainLoss)
    push(lossCode, 'debit', absGainLoss, `${summary}（结转净损失）`)
    push(actualClearingAccount, 'credit', absGainLoss, `${summary}（结转净损失）`)
  }

  const result = insertAssetVoucher({
    db,
    accountSetId,
    source: 'asset_disposal',
    voucherDate: scrapDate,
    year: scrapYear,
    period: scrapMonth,
    remark: `固定资产处置：${asset.asset_name}${changeTypeName ? '（' + changeTypeName + '）' : ''}${scrapReason ? ' ' + scrapReason : ''}`,
    makerName: operatorName,
    voucherTypeId,
    entries,
    auxContext,
    // 期间开放性已在 disposeAsset 入口统一校验
    skipPeriodCheck: true,
  })

  return result.voucherId
}

// ── 撤销处置 ─────────────────────────────────────────────

export interface CancelDisposalResult {
  assetNo: string
  restoredStatus: string
  deletedVoucherNo: string | null
}

export function cancelDisposal(params: {
  db: any
  accountSetId: string
  assetId: string
}): CancelDisposalResult {
  const { db, accountSetId, assetId } = params

  const asset = db.prepare(
    'SELECT * FROM fixed_asset WHERE id = ? AND account_set_id = ?'
  ).get(assetId, accountSetId) as any

  if (!asset) throw new Error('资产不存在')
  if (!asset.scrap_date) throw new Error('该资产未处置，无需撤销')

  const restoredStatus = asset.pre_scrap_status || '01'
  let deletedVoucherNo: string | null = null

  // 处置凭证：若已记账则阻止
  if (asset.scrap_voucher_id) {
    const v = db.prepare('SELECT id, voucher_no, status FROM vouchers WHERE id=?').get(asset.scrap_voucher_id) as any
    if (v) {
      if (v.status === 'posted') throw new Error('处置凭证已记账，请先取消记账后再撤销处置')
      deletedVoucherNo = v.voucher_no
    }
  }

  db.transaction(() => {
    // 1. 删除处置凭证（模块内部操作，绕过 API 删除拦截）
    if (asset.scrap_voucher_id) {
      const vc = db.prepare('SELECT id FROM vouchers WHERE id=?').get(asset.scrap_voucher_id) as any
      if (vc) {
        db.prepare('DELETE FROM voucher_entries WHERE voucher_id=?').run(asset.scrap_voucher_id)
        db.prepare('DELETE FROM vouchers WHERE id=?').run(asset.scrap_voucher_id)
      }
    }
    // 2. 删除处置流水
    // 按 change_kind 精确删除；原先用 change_item LIKE '资产减少%'，
    // 会误删 ACD 导入的历史「资产减少」记录（迁移 v110 已把它们标为 legacy）
    db.prepare(
      "DELETE FROM fixed_asset_change WHERE account_set_id=? AND asset_no=? AND change_kind='dispose'"
    ).run(accountSetId, asset.asset_no)
    // 3. 还原资产状态
    db.prepare(`UPDATE fixed_asset SET status_code=?, scrap_date=NULL, scrap_reason=NULL,
      scrap_voucher_id=NULL, pre_scrap_status=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(restoredStatus, assetId)
  })()

  return { assetNo: asset.asset_no, restoredStatus, deletedVoucherNo }
}
