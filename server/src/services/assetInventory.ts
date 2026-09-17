/**
 * 固定资产盘点服务
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
  assertPeriodOpen,
} from './assetVoucherBuilder.js'
import { deleteVoucherRecords, type VoucherEntryInput } from './voucherEntry.js'
import { assertVoucherEntriesInScopeById } from './accountAuthorization.js'

// ── 创建盘点 ──────────────────────────────────────────────

export function createInventory(params: {
  db: Database
  accountSetId: string
  name: string
  inventoryDate: string
  remark?: string
}): string {
  const { db, accountSetId, name, inventoryDate, remark } = params

  // 获取所有未处置资产
  const assets = db.prepare(`
    SELECT fa.*, fc.name AS category_name, fd2.name AS dept_name
    FROM fixed_asset fa
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    LEFT JOIN fixed_asset_dept fd2 ON fd2.account_set_id = fa.account_set_id AND fd2.code = fa.dept_code
    WHERE fa.account_set_id = ? AND fa.scrap_date IS NULL
    ORDER BY fa.asset_no
  `).all(accountSetId) as any[]

  const invId = uuidv4()

  db.transaction(() => {
    db.prepare(`
      INSERT INTO fixed_asset_inventory
        (id, account_set_id, name, inventory_date, status, total_count, remark)
      VALUES (?, ?, ?, ?, 'in_progress', ?, ?)
    `).run(invId, accountSetId, name, inventoryDate, assets.length, remark || null)

    const insItem = db.prepare(`
      INSERT INTO fixed_asset_inventory_item
        (id, inventory_id, account_set_id, asset_no, asset_name, category_name, dept_name,
         book_qty, book_original_value, book_accum_depr, book_net_value,
         actual_qty, actual_status, difference_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 0)
    `)

    for (const a of assets) {
      insItem.run(
        uuidv4(), invId, accountSetId,
        a.asset_no, a.asset_name, a.category_name, a.dept_name,
        a.qty || 1, a.original_value, a.accum_depr, a.net_value,
        a.qty || 1
      )
    }
  })()

  return invId
}

// ── 查询盘点列表 ────────────────────────────────────────────

export interface InventorySummary {
  id: string
  name: string
  inventory_date: string
  status: string
  total_count: number
  match_count: number
  surplus_count: number
  deficit_count: number
  remark: string | null
  created_at: string
}

export function listInventories(params: {
  db: Database
  accountSetId: string
}): InventorySummary[] {
  return params.db.prepare(`
    SELECT id, name, inventory_date, status, total_count, match_count, surplus_count, deficit_count, remark, created_at
    FROM fixed_asset_inventory
    WHERE account_set_id = ?
    ORDER BY created_at DESC
  `).all(params.accountSetId) as InventorySummary[]
}

// ── 查询盘点明细 ────────────────────────────────────────────

export interface InventoryItem {
  id: string
  asset_no: string
  asset_name: string
  category_name: string | null
  dept_name: string | null
  book_qty: number
  book_original_value: number
  book_accum_depr: number
  book_net_value: number
  actual_qty: number
  actual_status: string
  difference_qty: number
  difference_note: string | null
}

export function getInventoryItems(params: {
  db: Database
  accountSetId: string
  inventoryId: string
}): { inventory: InventorySummary | null; items: InventoryItem[] } {
  const inventory = params.db.prepare(
    'SELECT * FROM fixed_asset_inventory WHERE id=? AND account_set_id=?'
  ).get(params.inventoryId, params.accountSetId) as InventorySummary | undefined

  if (!inventory) return { inventory: null, items: [] }

  const items = params.db.prepare(`
    SELECT * FROM fixed_asset_inventory_item
    WHERE inventory_id = ? AND account_set_id = ?
    ORDER BY asset_no
  `).all(params.inventoryId, params.accountSetId) as InventoryItem[]

  return { inventory: inventory || null, items }
}

// ── 更新盘点结果 ────────────────────────────────────────────

export function updateInventoryItem(params: {
  db: Database
  accountSetId: string
  itemId: string
  actualQty: number
  actualStatus: string
  differenceNote?: string
}): void {
  const { db, accountSetId, itemId, actualQty, actualStatus, differenceNote } = params

  const item = db.prepare(
    'SELECT * FROM fixed_asset_inventory_item WHERE id=? AND account_set_id=?'
  ).get(itemId, accountSetId) as any

  if (!item) throw new Error('盘点明细不存在')

  const diffQty = actualQty - item.book_qty

  db.prepare(`
    UPDATE fixed_asset_inventory_item SET
      actual_qty = ?, actual_status = ?,
      difference_qty = ?, difference_note = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(actualQty, actualStatus, diffQty, differenceNote || null, itemId)
}

// ── 批量标记（快速操作） ─────────────────────────────────────

export function batchMarkItems(params: {
  db: Database
  accountSetId: string
  inventoryId: string
  itemIds: string[]
  actualStatus: string
}): void {
  const { db, accountSetId, inventoryId, itemIds, actualStatus } = params
  if (itemIds.length === 0) return

  const placeholders = itemIds.map(() => '?').join(',')

  // 对于 'normal' 状态，实盘 = 账面
  if (actualStatus === 'normal') {
    db.prepare(`
      UPDATE fixed_asset_inventory_item SET
        actual_qty = book_qty,
        actual_status = 'normal',
        difference_qty = 0,
        updated_at = datetime('now')
      WHERE inventory_id = ? AND account_set_id = ? AND id IN (${placeholders})
    `).run(inventoryId, accountSetId, ...itemIds)
  } else {
    db.prepare(`
      UPDATE fixed_asset_inventory_item SET
        actual_status = ?,
        updated_at = datetime('now')
      WHERE inventory_id = ? AND account_set_id = ? AND id IN (${placeholders})
    `).run(actualStatus, inventoryId, accountSetId, ...itemIds)
  }
}

// ── 完成盘点（汇总统计） ──────────────────────────────────────

export function completeInventory(params: {
  db: Database
  accountSetId: string
  inventoryId: string
  generateVoucher?: boolean
  accumAccount?: string
  surplusAccount?: string
  deficitAccount?: string
  operatorName?: string
  /** AS-P1-12：科目授权范围，生成凭证后校验，超权删凭证并告警 */
  accountScope?: unknown
}): { surplusCount: number; deficitCount: number; voucher?: any; voucherWarning?: string | null } {
  const { db, accountSetId, inventoryId, generateVoucher = false, accumAccount = '1602', surplusAccount = '6901', deficitAccount = '6901', operatorName = '系统' } = params

  // FIX：完成盘点会写卡片、生成凭证，必须幂等且落在未结账期间，
  // 否则重复调用会重复生成盘盈盘亏凭证、重复处置卡片。
  const inv = db.prepare(
    'SELECT * FROM fixed_asset_inventory WHERE id=? AND account_set_id=?'
  ).get(inventoryId, accountSetId) as any
  if (!inv) throw new Error('盘点记录不存在')
  if (inv.status === 'completed') throw new Error('该盘点已完成，不能重复完成')

  const invDate: string =
    typeof inv.inventory_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(inv.inventory_date)
      ? inv.inventory_date.slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  assertPeriodOpen(db, accountSetId, parseInt(invDate.split('-')[0]), parseInt(invDate.split('-')[1]))

  // 更新汇总统计
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN actual_status = 'normal' THEN 1 ELSE 0 END) AS match_cnt,
      SUM(CASE WHEN actual_status = 'surplus' THEN 1 ELSE 0 END) AS surplus_cnt,
      SUM(CASE WHEN actual_status = 'deficit' THEN 1 ELSE 0 END) AS deficit_cnt
    FROM fixed_asset_inventory_item
    WHERE inventory_id = ? AND account_set_id = ?
  `).get(inventoryId, accountSetId) as any

  db.prepare(`
    UPDATE fixed_asset_inventory SET
      status = 'completed',
      match_count = ?, surplus_count = ?, deficit_count = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(stats.match_cnt || 0, stats.surplus_cnt || 0, stats.deficit_cnt || 0, inventoryId)

  // FIX（A3）：盘亏原先只生成凭证，卡片不动——资产仍在卡片上并继续计提折旧，
  // 造成资产账与总账双计。这里按处置流程把盘亏资产置为报废状态并留下变动流水。
  markDeficitAssetsDisposed({ db, accountSetId, inventoryId, inventoryDate: invDate, operatorName })

  // FIX（A4）：盘盈是同卡片的数量差，同步调增卡片数量与原值，使资产账与凭证一致。
  adjustSurplusAssets({ db, accountSetId, inventoryId, inventoryDate: invDate, operatorName })

  let voucherResult = null
  let voucherWarning: string | null = null

  if (generateVoucher && (stats.surplus_cnt > 0 || stats.deficit_cnt > 0)) {
    try {
      voucherResult = generateInventoryVoucher({
        db, accountSetId, inventoryId,
        accumAccount, surplusAccount, deficitAccount, operatorName,
      })
      // AS-P1-12：科目授权——超权时删除凭证并告警（卡片处理保留）
      const scopeErr = assertVoucherEntriesInScopeById(db, params.accountScope as any, voucherResult.voucherId, accountSetId)
      if (scopeErr) {
        deleteVoucherRecords(db, voucherResult.voucherId)
        voucherResult = null
        throw new Error(scopeErr)
      }
      // AS-P0-4：凭证回写到明细行（表已设计 voucher_id 列但此前从未写入），
      // 完成后可从盘点记录反查凭证，也便于后续对账与撤销
      db.prepare(
        "UPDATE fixed_asset_inventory_item SET voucher_id=? WHERE inventory_id=? AND actual_status IN ('surplus','deficit')"
      ).run(voucherResult.voucherId, inventoryId)
    } catch (e: any) {
      voucherWarning = e.message
    }
  }

  return {
    surplusCount: stats.surplus_cnt || 0,
    deficitCount: stats.deficit_cnt || 0,
    voucher: voucherResult,
    voucherWarning,
  }
}

// ── 盘亏资产卡片处置（A3） ───────────────────────────────────

/**
 * 把本次盘点中判定为盘亏的资产按「报废处置」处理。
 *
 * 与 assetDisposal.disposeAsset 保持同一套字段（status_code='04' + pre_scrap_status +
 * scrap_date/scrap_reason），这样折旧取数（fixedAssetDepreciation 按 status.depreciable 过滤）
 * 会自动跳过它们，且撤销处置的既有逻辑同样适用。
 */
function markDeficitAssetsDisposed(params: {
  db: Database
  accountSetId: string
  inventoryId: string
  inventoryDate: string
  operatorName: string
}): void {
  const { db, accountSetId, inventoryId, inventoryDate, operatorName } = params

  const items = db.prepare(`
    SELECT i.asset_no, i.asset_name, fa.id AS asset_id, fa.status_code,
           fa.original_value, fa.net_value, fa.scrap_date
    FROM fixed_asset_inventory_item i
    JOIN fixed_asset fa ON fa.account_set_id = i.account_set_id AND fa.asset_no = i.asset_no
    WHERE i.inventory_id = ? AND i.account_set_id = ? AND i.actual_status = 'deficit'
  `).all(inventoryId, accountSetId) as any[]

  if (!items.length) return

  const year = parseInt(inventoryDate.split('-')[0])
  const period = parseInt(inventoryDate.split('-')[1])

  const updCard = db.prepare(`
    UPDATE fixed_asset SET
      status_code = '04',
      pre_scrap_status = ?,
      scrap_date = ?, scrap_reason = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `)
  const insChange = db.prepare(`
    INSERT INTO fixed_asset_change
      (id, account_set_id, asset_no, change_date, change_item, old_value, new_value, amount,
       remark, operator, change_kind, year, period)
    VALUES (?, ?, ?, ?, '盘亏处置', ?, 0, ?, ?, ?, 'dispose', ?, ?)
  `)

  for (const it of items) {
    if (it.scrap_date) continue // 已处置的不重复处理
    updCard.run(it.status_code || '01', inventoryDate, '盘亏', it.asset_id)
    insChange.run(
      uuidv4(), accountSetId, it.asset_no, inventoryDate,
      Number(it.original_value || 0), Number(it.net_value || 0),
      '固定资产盘亏', operatorName, year, period
    )
  }
}

// ── 盘盈卡片数量调整（A4） ───────────────────────────────────

/**
 * 盘盈按数量差调增卡片：qty 增加 difference_qty，原值按单位原值同比例调增。
 * 折旧要素（use_months / depr_months_done）不动——盘盈只补数量，不重开折旧序列。
 */
function adjustSurplusAssets(params: {
  db: Database
  accountSetId: string
  inventoryId: string
  inventoryDate: string
  operatorName: string
}): void {
  const { db, accountSetId, inventoryId, inventoryDate, operatorName } = params

  const items = db.prepare(`
    SELECT i.asset_no, i.book_qty, i.difference_qty, fa.id AS asset_id,
           fa.qty, fa.original_value, fa.accum_depr, fa.impairment_amount, fa.salvage_rate
    FROM fixed_asset_inventory_item i
    JOIN fixed_asset fa ON fa.account_set_id = i.account_set_id AND fa.asset_no = i.asset_no
    WHERE i.inventory_id = ? AND i.account_set_id = ? AND i.actual_status = 'surplus'
  `).all(inventoryId, accountSetId) as any[]

  if (!items.length) return

  const year = parseInt(inventoryDate.split('-')[0])
  const period = parseInt(inventoryDate.split('-')[1])

  const insChange = db.prepare(`
    INSERT INTO fixed_asset_change
      (id, account_set_id, asset_no, change_date, change_item, old_value, new_value, amount,
       remark, operator, change_kind, year, period)
    VALUES (?, ?, ?, ?, '盘盈调增', ?, ?, ?, ?, ?, 'original_value', ?, ?)
  `)

  for (const it of items) {
    const bookQty = Number(it.book_qty || 0)
    const diffQty = Number(it.difference_qty || 0)
    if (!(bookQty > 0) || !(diffQty > 0)) continue

    const oldOriginal = Number(it.original_value || 0)
    const addValue = Math.round((oldOriginal / bookQty) * diffQty * 100) / 100
    const newOriginal = Math.round((oldOriginal + addValue) * 100) / 100
    const newQty = Number(it.qty || bookQty) + diffQty
    const newSalvage = Math.round(newOriginal * Number(it.salvage_rate || 0) * 100) / 100
    const newNet = Math.round(
      (newOriginal - Number(it.accum_depr || 0) - Number(it.impairment_amount || 0)) * 100
    ) / 100

    db.prepare(`
      UPDATE fixed_asset SET
        qty = ?, original_value = ?, salvage_value = ?, net_value = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newQty, newOriginal, newSalvage, newNet, it.asset_id)

    insChange.run(
      uuidv4(), accountSetId, it.asset_no, inventoryDate,
      oldOriginal, newOriginal, addValue,
      `固定资产盘盈（数量 +${diffQty}）`, operatorName, year, period
    )
  }
}

// ── 生成盘盈盘亏凭证 ─────────────────────────────────────────

function generateInventoryVoucher(params: {
  db: Database
  accountSetId: string
  inventoryId: string
  accumAccount: string
  surplusAccount: string
  deficitAccount: string
  operatorName: string
  voucherTypeId?: string | null
}): any {
  const { db, accountSetId, inventoryId, accumAccount, surplusAccount, deficitAccount, operatorName, voucherTypeId } = params

  const inventory = db.prepare('SELECT * FROM fixed_asset_inventory WHERE id=?').get(inventoryId) as any
  if (!inventory) throw new Error('盘点记录不存在')

  const surplusItems = db.prepare(`
    SELECT i.*, fa.category_code, fa.dept_code, fa.user_name, fc.account_code as asset_account
    FROM fixed_asset_inventory_item i
    LEFT JOIN fixed_asset fa ON fa.account_set_id = i.account_set_id AND fa.asset_no = i.asset_no
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE i.inventory_id = ? AND i.actual_status = 'surplus'
  `).all(inventoryId) as any[]

  const deficitItems = db.prepare(`
    SELECT i.*, fa.category_code, fa.dept_code, fa.user_name, fc.account_code as asset_account, fc.depr_account_code
    FROM fixed_asset_inventory_item i
    LEFT JOIN fixed_asset fa ON fa.account_set_id = i.account_set_id AND fa.asset_no = i.asset_no
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id = fa.account_set_id AND fc.code = fa.category_code
    WHERE i.inventory_id = ? AND i.actual_status = 'deficit'
  `).all(inventoryId) as any[]

  if (!surplusItems.length && !deficitItems.length) {
    throw new Error('无盘盈盘亏项，无需生成凭证')
  }

  // 盘盈对应科目（盘盈凭证贷方）/ 盘亏对应科目（盘亏凭证借方），均回退 6901
  const surplusAccCode = surplusAccount || '6901'
  const deficitAccCode = deficitAccount || '6901'

  // 预检科目（仅校验实际用到的），缺失即抛错
  const requiredCodes: string[] = []
  if (surplusItems.length > 0) requiredCodes.push(surplusAccCode)
  if (deficitItems.length > 0) requiredCodes.push(deficitAccCode)
  for (const item of surplusItems) requiredCodes.push(item.asset_account || '1601')
  for (const item of deficitItems) {
    requiredCodes.push(item.asset_account || '1601')
    requiredCodes.push(item.depr_account_code || accumAccount || '1602')
  }
  const accounts = resolveAccounts(db, accountSetId, requiredCodes, '盘点调整')

  /**
   * 凭证期间取盘点日期所属期间。原实现凭证日期用 inventory_date、年月却用 new Date()，
   * 补录历史盘点时会把凭证落到错误期间。
   */
  const voucherDate: string =
    typeof inventory.inventory_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(inventory.inventory_date)
      ? inventory.inventory_date.slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  const year = parseInt(voucherDate.split('-')[0])
  const month = parseInt(voucherDate.split('-')[1])

  const auxContext = loadAssetAuxContext(db, accountSetId)
  const entries: VoucherEntryInput[] = []
  const push = (
    item: any,
    code: string,
    direction: 'debit' | 'credit',
    amount: number,
    summary: string
  ) => {
    if (!(amount > 0)) return
    const acc = accounts.get(code)!
    const refs = resolveAssetAuxRefs(db, accountSetId, item, auxContext)
    entries.push({
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      direction,
      amount: Math.round(amount * 100) / 100,
      summary,
      ...auxRefsForAccount(db, accountSetId, acc.code, refs, auxContext),
    })
  }

  /**
   * 盘盈：借 固定资产 / 贷 盘盈对应科目
   *
   * FIX（A4）：盘点明细只能由现有卡片生成（createInventory），所以盘盈必然是
   * 「同一张卡片实盘数 > 账面数」，而不是账外资产。原实现按 book_net_value 全额入账，
   * 等于把一张已经在账的资产再入一次原值。改为只就数量差部分入账。
   */
  for (const item of surplusItems) {
    const label = `盘盈：${item.asset_name}（${item.asset_no}）`
    const bookQty = Number(item.book_qty || 0)
    const diffQty = Number(item.difference_qty || 0)
    if (!(bookQty > 0) || !(diffQty > 0)) continue
    const surplusValue = Math.round((Number(item.book_net_value || 0) / bookQty) * diffQty * 100) / 100
    push(item, item.asset_account || '1601', 'debit', surplusValue, label)
    push(item, surplusAccCode, 'credit', surplusValue, label)
  }

  // 盘亏：借 盘亏对应科目（净值） + 借 累计折旧 / 贷 固定资产（原值）
  for (const item of deficitItems) {
    const label = `盘亏：${item.asset_name}（${item.asset_no}）`
    const deprAccCode = item.depr_account_code || accumAccount || '1602'
    push(item, deficitAccCode, 'debit', item.book_net_value, label)
    push(item, deprAccCode, 'debit', item.book_accum_depr, `盘亏冲销折旧：${item.asset_name}（${item.asset_no}）`)
    push(item, item.asset_account || '1601', 'credit', item.book_original_value, label)
  }

  const totalSurplusValue = surplusItems.reduce((s: number, i: any) => s + i.book_net_value, 0)
  const totalDeficitValue = deficitItems.reduce((s: number, i: any) => s + i.book_net_value, 0)

  const result = insertAssetVoucher({
    db,
    accountSetId,
    // 原实现漏写 source，导致盘点凭证不受 voucher.ts 的 asset_ 删除拦截保护
    source: 'asset_inventory',
    voucherDate,
    year,
    period: month,
    remark: `固定资产盘点调整（${inventory.name}）`,
    makerName: operatorName,
    voucherTypeId,
    entries,
    auxContext,
  })

  return {
    voucherId: result.voucherId,
    voucherNo: result.voucherNo,
    entryCount: result.entryCount,
    totalSurplusValue,
    totalDeficitValue,
  }
}

// ── 删除盘点 ─────────────────────────────────────────────────

export function deleteInventory(params: {
  db: Database
  accountSetId: string
  inventoryId: string
}): void {
  const row = params.db.prepare(
    'SELECT id, status FROM fixed_asset_inventory WHERE id=? AND account_set_id=?'
  ).get(params.inventoryId, params.accountSetId) as any
  if (!row) throw new Error('盘点记录不存在')

  // AS-P0-4：已完成盘点已写入卡片（盘亏置报废、盘盈调增原值）并可能生成凭证，
  // 删除盘点记录后这些副作用既不回滚也无痕迹（凭证被 asset_ 守卫拦死）。
  // 完成的盘点不允许删除；作废场景应提供显式的反向还原，不在本接口范围。
  if (row.status === 'completed') {
    throw new Error('该盘点已完成并已写入资产/凭证，不允许删除；如需作废请先撤销相关处理')
  }

  params.db.transaction(() => {
    params.db.prepare('DELETE FROM fixed_asset_inventory_item WHERE inventory_id=?').run(params.inventoryId)
    params.db.prepare('DELETE FROM fixed_asset_inventory WHERE id=?').run(params.inventoryId)
  })()
}
