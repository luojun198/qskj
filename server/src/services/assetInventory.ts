/**
 * 固定资产盘点服务
 */
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  insertAssetVoucher,
  loadAssetAuxContext,
  resolveAssetAuxRefs,
  auxRefsForAccount,
  resolveAccounts,
} from './assetVoucherBuilder.js'
import type { VoucherEntryInput } from './voucherEntry.js'

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
}): { surplusCount: number; deficitCount: number; voucher?: any; voucherWarning?: string } {
  const { db, accountSetId, inventoryId, generateVoucher = false, accumAccount = '1602', surplusAccount = '6901', deficitAccount = '6901', operatorName = '系统' } = params

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

  let voucherResult = null
  let voucherWarning: string | null = null

  if (generateVoucher && (stats.surplus_cnt > 0 || stats.deficit_cnt > 0)) {
    try {
      voucherResult = generateInventoryVoucher({
        db, accountSetId, inventoryId,
        accumAccount, surplusAccount, deficitAccount, operatorName,
      })
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

  // 盘盈：借 固定资产 / 贷 盘盈对应科目
  for (const item of surplusItems) {
    const label = `盘盈：${item.asset_name}（${item.asset_no}）`
    push(item, item.asset_account || '1601', 'debit', item.book_net_value, label)
    push(item, surplusAccCode, 'credit', item.book_net_value, label)
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
    'SELECT id FROM fixed_asset_inventory WHERE id=? AND account_set_id=?'
  ).get(params.inventoryId, params.accountSetId)
  if (!row) throw new Error('盘点记录不存在')

  params.db.transaction(() => {
    params.db.prepare('DELETE FROM fixed_asset_inventory_item WHERE inventory_id=?').run(params.inventoryId)
    params.db.prepare('DELETE FROM fixed_asset_inventory WHERE id=?').run(params.inventoryId)
  })()
}
