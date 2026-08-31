/**
 * 固定资产处置服务
 *
 * 处理资产减少（出售/报废/损毁/盘亏/捐赠等），可选生成清理凭证
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

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
    generateVoucher = false, operatorName = '系统',
  } = params

  const asset = db.prepare(
    'SELECT * FROM fixed_asset WHERE id = ? AND account_set_id = ?'
  ).get(assetId, accountSetId) as any

  if (!asset) throw new Error('资产不存在')
  if (asset.scrap_date) throw new Error('该资产已处置，不能重复处置')

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
        (id, account_set_id, asset_no, change_date, change_item, old_value, new_value, amount, remark, operator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), accountSetId, asset.asset_no,
      scrapDate,
      `资产减少${changeTypeName ? '（' + changeTypeName + '）' : ''}`,
      originalValue, 0, -originalValue,
      scrapReason || null,
      operatorName
    )

    // 3. 可选生成清理凭证
    if (generateVoucher) {
      const vid = generateDisposalVoucher({
        db, accountSetId, asset, scrapDate, scrapReason, changeTypeName,
        originalValue, accumDepr, netValue, salvageValue,
        disposalIncome, disposalExpense, disposalGainLoss,
        accumAccount, clearingAccount,
        operatorName,
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
}

function generateDisposalVoucher(params: VoucherGenParams) {
  const {
    db, accountSetId, asset, scrapDate, scrapReason,
    changeTypeName, originalValue, accumDepr, netValue,
    disposalIncome, disposalExpense, disposalGainLoss,
    accumAccount, clearingAccount, operatorName,
  } = params

  const scrapYear = parseInt(scrapDate.split('-')[0])
  const scrapMonth = parseInt(scrapDate.split('-')[1])

  // 查找科目
  const lookupAcc = db.prepare('SELECT id, code, name FROM accounts WHERE account_set_id=? AND code=? LIMIT 1')

  // 查找资产所属类别的科目配置
  const assetCat = (asset.category_code
    ? db.prepare('SELECT account_code, depr_account_code, clearing_account_code FROM fixed_asset_category WHERE account_set_id=? AND code=?').get(accountSetId, asset.category_code)
    : null) as any
  
  const assetAccountCode = assetCat?.account_code || '1601'
  const actualAccumAccount = assetCat?.depr_account_code || accumAccount || '1602'
  const actualClearingAccount = assetCat?.clearing_account_code || clearingAccount || '1606'

  const assetRow = lookupAcc.get(accountSetId, assetAccountCode) as any
  const accumRow = lookupAcc.get(accountSetId, actualAccumAccount) as any
  const clearingRow = lookupAcc.get(accountSetId, actualClearingAccount) as any

  // 预检科目
  const missing: string[] = []
  if (!assetRow) missing.push(assetAccountCode)
  if (!accumRow) missing.push(actualAccumAccount)
  if (!clearingRow) missing.push(actualClearingAccount)
  if (disposalIncome > 0 || disposalExpense > 0 || disposalGainLoss !== 0) {
    // 可能需要营业外收支科目
  }
  if (missing.length > 0) {
    throw new Error(`以下科目在账套中不存在：${missing.join('、')}`)
  }

  // 生成凭证号
  const lastNo = (db.prepare(`
    SELECT CAST(
      CASE WHEN INSTR(voucher_no,'-')>0 THEN SUBSTR(voucher_no,INSTR(voucher_no,'-')+1) ELSE voucher_no END
      AS INTEGER) no
    FROM vouchers
    WHERE account_set_id=? AND year=? AND period=?
    ORDER BY no DESC LIMIT 1
  `).get(accountSetId, scrapYear, scrapMonth) as any)?.no ?? 0
  const voucherNo = String(lastNo + 1).padStart(3, '0')

  const voucherId = uuidv4()

  db.prepare(`
    INSERT INTO vouchers
      (id, account_set_id, voucher_no, voucher_type_id, voucher_date, year, period,
       total_amount, maker_name, remark, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'asset_disposal')
  `).run(
    voucherId, accountSetId, voucherNo, null,
    scrapDate, scrapYear, scrapMonth,
    originalValue, operatorName,
    `固定资产处置：${asset.asset_name}${changeTypeName ? '（' + changeTypeName + '）' : ''}${scrapReason ? ' ' + scrapReason : ''}`
  )

  const insEntry = db.prepare(`
    INSERT INTO voucher_entries
      (id, account_set_id, voucher_id, seq, account_id, account_code, account_name,
       direction, amount, amount_cents, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let seq = 1
  const summary = `处置资产：${asset.asset_name}（编号 ${asset.asset_no}）`

  // 借：累计折旧
  if (accumDepr > 0) {
    insEntry.run(
      uuidv4(), accountSetId, voucherId, seq++,
      accumRow.id, actualAccumAccount, accumRow.name,
      'debit', accumDepr, Math.round(accumDepr * 100), summary
    )
  }

  // 借：固定资产清理（净值）
  if (netValue > 0) {
    insEntry.run(
      uuidv4(), accountSetId, voucherId, seq++,
      clearingRow.id, actualClearingAccount, clearingRow.name,
      'debit', netValue, Math.round(netValue * 100), summary
    )
  }

  // 贷：固定资产（原值）
  insEntry.run(
    uuidv4(), accountSetId, voucherId, seq++,
    assetRow.id, assetAccountCode, assetRow.name,
    'credit', originalValue, Math.round(originalValue * 100), summary
  )

  // 处置收入：借 银行存款 / 贷 固定资产清理
  if (disposalIncome > 0) {
    // 尝试使用 1001（银行存款）
    const bankRow = lookupAcc.get(accountSetId, '1001') as any
    if (bankRow) {
      insEntry.run(
        uuidv4(), accountSetId, voucherId, seq++,
        bankRow.id, '1001', bankRow.name,
        'debit', disposalIncome, Math.round(disposalIncome * 100), `${summary}（处置收入）`
      )
      insEntry.run(
      uuidv4(), accountSetId, voucherId, seq++,
      clearingRow.id, actualClearingAccount, clearingRow.name,
      'credit', disposalIncome, Math.round(disposalIncome * 100), `${summary}（处置收入）`
      )
      }
      }

      // 处置费用：借 固定资产清理 / 贷 银行存款
      if (disposalExpense > 0) {
      const bankRow = lookupAcc.get(accountSetId, '1001') as any
      if (bankRow) {
      insEntry.run(
      uuidv4(), accountSetId, voucherId, seq++,
      clearingRow.id, actualClearingAccount, clearingRow.name,
      'debit', disposalExpense, Math.round(disposalExpense * 100), `${summary}（处置费用）`
      )
      insEntry.run(
      uuidv4(), accountSetId, voucherId, seq++,
      bankRow.id, '1001', bankRow.name,
      'credit', disposalExpense, Math.round(disposalExpense * 100), `${summary}（处置费用）`
      )
      }
      }

      // 结转清理净损益
      if (disposalGainLoss !== 0) {
      const glAccount = disposalGainLoss > 0 ? '6301' : '6711' // 营业外收入 / 营业外支出
      const glRow = lookupAcc.get(accountSetId, glAccount) as any
      if (glRow) {
      const absGainLoss = Math.abs(disposalGainLoss)
      if (disposalGainLoss > 0) {
      // 处置净收益：借 固定资产清理 / 贷 营业外收入
      insEntry.run(
        uuidv4(), accountSetId, voucherId, seq++,
        clearingRow.id, actualClearingAccount, clearingRow.name,
        'debit', absGainLoss, Math.round(absGainLoss * 100), `${summary}（结转净收益）`
      )
      insEntry.run(
        uuidv4(), accountSetId, voucherId, seq++,
        glRow.id, glAccount, glRow.name,
        'credit', absGainLoss, Math.round(absGainLoss * 100), `${summary}（结转净收益）`
      )
      } else {
      // 处置净损失：借 营业外支出 / 贷 固定资产清理
      insEntry.run(
        uuidv4(), accountSetId, voucherId, seq++,
        glRow.id, glAccount, glRow.name,
        'debit', absGainLoss, Math.round(absGainLoss * 100), `${summary}（结转净损失）`
      )
      insEntry.run(
        uuidv4(), accountSetId, voucherId, seq++,
        clearingRow.id, actualClearingAccount, clearingRow.name,
        'credit', absGainLoss, Math.round(absGainLoss * 100), `${summary}（结转净损失）`
      )
      }
      }
      }  return voucherId
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
    db.prepare("DELETE FROM fixed_asset_change WHERE account_set_id=? AND asset_no=? AND change_item LIKE '资产减少%'").run(accountSetId, asset.asset_no)
    // 3. 还原资产状态
    db.prepare(`UPDATE fixed_asset SET status_code=?, scrap_date=NULL, scrap_reason=NULL,
      scrap_voucher_id=NULL, pre_scrap_status=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(restoredStatus, assetId)
  })()

  return { assetNo: asset.asset_no, restoredStatus, deletedVoucherNo }
}
