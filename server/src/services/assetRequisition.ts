/**
 * 固定资产领用归还台账（P3-1）
 *
 * 对应用友 U8「资产使用登记」/ 金蝶 K3「资产领用单」：记录资产在人与部门之间的
 * 实物流转。领用归还本身不产生会计分录，但会回写卡片上的使用人 / 保管人 / 存放地点；
 * 若领用同时发生了部门变化，联动写一条 change_kind='dept' 的变动流水，
 * 让「增减变动表」与资产台账能看到这次部门转移。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export type RequisitionAction = 'out' | 'in'

export interface RequisitionRow {
  id: string
  asset_no: string
  asset_name?: string | null
  action: RequisitionAction
  action_date: string
  user_name: string | null
  user_aux_id: string | null
  dept_code: string | null
  dept_name?: string | null
  keeper: string | null
  install_place: string | null
  expect_return_date: string | null
  condition_note: string | null
  remark: string | null
  operator: string | null
  created_at: string
  /** 领用记录是否仍未归还（仅 action='out' 有意义） */
  outstanding?: boolean
}

function loadAsset(db: Database, accountSetId: string, assetId: string): any {
  const asset = db
    .prepare('SELECT * FROM fixed_asset WHERE id=? AND account_set_id=?')
    .get(assetId, accountSetId) as any
  if (!asset) throw new Error('资产不存在')
  return asset
}

/** 该资产最近一条领用/归还记录，用于判断当前是否处于「已领用未归还」状态 */
function lastAction(db: Database, accountSetId: string, assetNo: string): any {
  return db
    .prepare(
      `SELECT * FROM fixed_asset_requisition
        WHERE account_set_id=? AND asset_no=?
        ORDER BY action_date DESC, created_at DESC, rowid DESC
        LIMIT 1`
    )
    .get(accountSetId, assetNo)
}

/** 资产当前是否处于已领用未归还状态 */
export function isCheckedOut(db: Database, accountSetId: string, assetNo: string): boolean {
  return lastAction(db, accountSetId, assetNo)?.action === 'out'
}

export interface CreateRequisitionParams {
  db: Database
  accountSetId: string
  assetId: string
  action: RequisitionAction
  actionDate: string
  userName?: string | null
  userAuxId?: string | null
  deptCode?: string | null
  keeper?: string | null
  installPlace?: string | null
  expectReturnDate?: string | null
  conditionNote?: string | null
  remark?: string | null
  operatorName?: string
  operatorId?: string | null
}

export interface CreateRequisitionResult {
  id: string
  assetNo: string
  action: RequisitionAction
  /** 因部门变化而联动写入的变动流水 id */
  deptChangeId: string | null
}

export function createRequisition(params: CreateRequisitionParams): CreateRequisitionResult {
  const {
    db,
    accountSetId,
    assetId,
    action,
    actionDate,
    operatorName = '系统',
    operatorId = null,
  } = params

  if (action !== 'out' && action !== 'in') throw new Error('操作类型只能是领用或归还')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(actionDate || '')) {
    throw new Error('日期格式应为 YYYY-MM-DD')
  }

  const asset = loadAsset(db, accountSetId, assetId)
  if (asset.scrap_date) throw new Error('该资产已处置，不能再办理领用归还')

  const checkedOut = isCheckedOut(db, accountSetId, asset.asset_no)
  if (action === 'out' && checkedOut) {
    throw new Error('该资产已被领用且尚未归还，请先办理归还')
  }
  if (action === 'in' && !checkedOut) {
    throw new Error('该资产当前没有未归还的领用记录')
  }

  const deptCode = (params.deptCode ?? '').trim() || null
  if (deptCode) {
    const exists = db
      .prepare('SELECT code FROM fixed_asset_dept WHERE account_set_id=? AND code=?')
      .get(accountSetId, deptCode)
    if (!exists) {
      throw new Error(`部门编码 ${deptCode} 不存在，请先在「资产档案 → 使用部门」中建立`)
    }
  }
  if (action === 'out' && !((params.userName ?? '').trim())) {
    throw new Error('领用时必须填写领用人')
  }
  if (
    params.expectReturnDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(params.expectReturnDate)
  ) {
    throw new Error('预计归还日期格式应为 YYYY-MM-DD')
  }

  const id = uuidv4()
  let deptChangeId: string | null = null

  db.transaction(() => {
    db.prepare(
      `INSERT INTO fixed_asset_requisition
         (id, account_set_id, asset_no, action, action_date, user_name, user_aux_id,
          dept_code, keeper, install_place, expect_return_date, condition_note,
          remark, operator, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      accountSetId,
      asset.asset_no,
      action,
      actionDate,
      (params.userName ?? '').trim() || null,
      params.userAuxId ?? null,
      deptCode,
      (params.keeper ?? '').trim() || null,
      (params.installPlace ?? '').trim() || null,
      params.expectReturnDate ?? null,
      (params.conditionNote ?? '').trim() || null,
      (params.remark ?? '').trim() || null,
      operatorName,
      operatorId
    )

    if (action === 'out') {
      // 领用：把使用人/保管人/存放地点/部门写回卡片
      db.prepare(
        `UPDATE fixed_asset SET
           user_name = ?, keeper = ?, install_place = ?, dept_code = ?,
           updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        (params.userName ?? '').trim() || asset.user_name,
        (params.keeper ?? '').trim() || asset.keeper,
        (params.installPlace ?? '').trim() || asset.install_place,
        deptCode ?? asset.dept_code,
        assetId
      )

      // 部门确实变了 → 联动记一条部门调拨流水，保证台账与增减变动表能看到
      if (deptCode && deptCode !== (asset.dept_code || null)) {
        deptChangeId = writeDeptChangeFromRequisition({
          db,
          accountSetId,
          asset,
          newDeptCode: deptCode,
          actionDate,
          operatorName,
          operatorId,
        })
      }
    } else {
      // 归还：清空使用人（保管人与存放地点按传入值更新，未传则保持）
      db.prepare(
        `UPDATE fixed_asset SET
           user_name = NULL, keeper = ?, install_place = ?,
           updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        (params.keeper ?? '').trim() || asset.keeper,
        (params.installPlace ?? '').trim() || asset.install_place,
        assetId
      )
    }
  })()

  return { id, assetNo: asset.asset_no, action, deptChangeId }
}

/** 领用引起的部门转移，写成一条与「部门调拨」同构的变动流水 */
function writeDeptChangeFromRequisition(args: {
  db: Database
  accountSetId: string
  asset: any
  newDeptCode: string
  actionDate: string
  operatorName: string
  operatorId: string | null
}): string {
  const { db, accountSetId, asset, newDeptCode, actionDate, operatorName, operatorId } = args
  const nameOf = (code: string | null) =>
    code
      ? ((
          db
            .prepare('SELECT name FROM fixed_asset_dept WHERE account_set_id=? AND code=?')
            .get(accountSetId, code) as any
        )?.name ?? code)
      : '（无）'

  const id = uuidv4()
  db.prepare(
    `INSERT INTO fixed_asset_change
       (id, account_set_id, asset_no, change_date, change_item,
        old_value, new_value, amount, remark, operator,
        change_kind, change_type_code, field_key, old_text, new_text,
        voucher_id, year, period, created_by)
     VALUES (?,?,?,?,?,NULL,NULL,NULL,?,?,'dept',NULL,'dept_code',?,?,NULL,?,?,?)`
  ).run(
    id,
    accountSetId,
    asset.asset_no,
    actionDate,
    `部门调拨：${nameOf(asset.dept_code)} → ${nameOf(newDeptCode)}（资产领用）`,
    '由资产领用登记联动产生',
    operatorName,
    asset.dept_code || null,
    newDeptCode,
    parseInt(actionDate.split('-')[0]),
    parseInt(actionDate.split('-')[1]),
    operatorId
  )
  return id
}

/**
 * 删除一条领用/归还记录。
 * 只允许删除该资产最后一条，否则「已领用/已归还」的状态推演会错乱。
 * 卡片上的使用人等字段不做回滚（属于事实性信息，由用户按需重新登记）。
 */
export function deleteRequisition(params: {
  db: Database
  accountSetId: string
  requisitionId: string
}): { assetNo: string } {
  const { db, accountSetId, requisitionId } = params
  const row = db
    .prepare('SELECT * FROM fixed_asset_requisition WHERE id=? AND account_set_id=?')
    .get(requisitionId, accountSetId) as any
  if (!row) throw new Error('领用记录不存在')

  const last = lastAction(db, accountSetId, row.asset_no)
  if (last?.id !== requisitionId) {
    throw new Error('只能删除该资产最后一条领用/归还记录')
  }

  db.prepare('DELETE FROM fixed_asset_requisition WHERE id=?').run(requisitionId)
  return { assetNo: row.asset_no }
}

export interface RequisitionFilters {
  assetNo?: string
  action?: RequisitionAction
  deptCode?: string
  userName?: string
  keyword?: string
  /** 只看已领用未归还 */
  outstandingOnly?: boolean
  /** 只看逾期未还（预计归还日期早于今天） */
  overdueOnly?: boolean
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

/**
 * 领用记录分页查询。
 *
 * 「未归还」判定：该记录是 action='out'，且此后该资产没有更晚的记录。
 * 用相关子查询而非窗口函数，兼容旧版 SQLite。
 */
export function listRequisitions(params: {
  db: Database
  accountSetId: string
  filters: RequisitionFilters
}): { total: number; rows: RequisitionRow[] } {
  const { db, accountSetId, filters } = params
  const where: string[] = ['r.account_set_id = ?']
  const args: any[] = [accountSetId]

  const OUTSTANDING_SQL = `
    r.action = 'out' AND NOT EXISTS (
      SELECT 1 FROM fixed_asset_requisition r2
       WHERE r2.account_set_id = r.account_set_id
         AND r2.asset_no = r.asset_no
         AND (r2.action_date > r.action_date
              OR (r2.action_date = r.action_date AND r2.rowid > r.rowid))
    )`

  if (filters.assetNo) {
    where.push('r.asset_no = ?')
    args.push(filters.assetNo)
  }
  if (filters.action) {
    where.push('r.action = ?')
    args.push(filters.action)
  }
  if (filters.deptCode) {
    where.push('r.dept_code = ?')
    args.push(filters.deptCode)
  }
  if (filters.userName) {
    where.push('r.user_name = ?')
    args.push(filters.userName)
  }
  if (filters.dateFrom) {
    where.push('r.action_date >= ?')
    args.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    where.push('r.action_date <= ?')
    args.push(filters.dateTo)
  }
  if (filters.keyword) {
    where.push('(r.asset_no LIKE ? OR fa.asset_name LIKE ? OR r.user_name LIKE ?)')
    const kw = `%${filters.keyword}%`
    args.push(kw, kw, kw)
  }
  if (filters.outstandingOnly || filters.overdueOnly) {
    where.push(`(${OUTSTANDING_SQL})`)
  }
  if (filters.overdueOnly) {
    where.push("r.expect_return_date IS NOT NULL AND r.expect_return_date < date('now','localtime')")
  }

  const from = `
    FROM fixed_asset_requisition r
    LEFT JOIN fixed_asset fa ON fa.account_set_id = r.account_set_id AND fa.asset_no = r.asset_no
    LEFT JOIN fixed_asset_dept fd ON fd.account_set_id = r.account_set_id AND fd.code = r.dept_code
  `
  const whereSql = `WHERE ${where.join(' AND ')}`
  const total = (db.prepare(`SELECT COUNT(*) AS c ${from} ${whereSql}`).get(...args) as any).c

  const page = Math.max(1, Number(filters.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize || 20)))
  const rows = db
    .prepare(
      `SELECT r.*, fa.asset_name, fd.name AS dept_name,
              CASE WHEN ${OUTSTANDING_SQL} THEN 1 ELSE 0 END AS outstanding
       ${from}
       ${whereSql}
       ORDER BY r.action_date DESC, r.rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize) as any[]

  return {
    total,
    rows: rows.map(r => ({ ...r, outstanding: !!r.outstanding })),
  }
}

/** 某张卡片的领用归还历史（资产明细页用） */
export function getAssetRequisitions(params: {
  db: Database
  accountSetId: string
  assetId: string
}): RequisitionRow[] {
  const { db, accountSetId, assetId } = params
  const asset = loadAsset(db, accountSetId, assetId)
  return listRequisitions({
    db,
    accountSetId,
    filters: { assetNo: asset.asset_no, pageSize: 200 },
  }).rows
}
