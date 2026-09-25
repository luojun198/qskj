/**
 * 固定资产卡片批量导入（P4-1）
 *
 * 前端 Excel 解析后把行数据发过来，这里做逐行校验并整批事务写入。
 * 校验规则集中在 validateImportRow，前端预校验（逐行标红）与后端最终把关共用，
 * 避免两处规则漂移。
 */
import type { Database } from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

/** 导入模板列顺序（前端生成模板与解析都以此为准） */
export const ASSET_IMPORT_COLUMNS = [
  { key: 'asset_no', label: '资产编号', required: true },
  { key: 'asset_name', label: '资产名称', required: true },
  { key: 'category_code', label: '类别编码', required: false },
  { key: 'status_code', label: '状态编码', required: false },
  { key: 'dept_code', label: '部门编码', required: false },
  { key: 'purpose_code', label: '用途编码', required: false },
  { key: 'acquire_date', label: '取得日期', required: false },
  { key: 'start_depr_date', label: '开始折旧日期', required: false },
  { key: 'original_value', label: '原值', required: true },
  { key: 'salvage_rate', label: '残值率', required: false },
  { key: 'depr_method', label: '折旧方法', required: false },
  { key: 'use_months', label: '使用月数', required: false },
  { key: 'total_workload', label: '总工作量', required: false },
  { key: 'depr_months_done', label: '已提月数', required: false },
  { key: 'accum_depr', label: '累计折旧', required: false },
  { key: 'qty', label: '数量', required: false },
  { key: 'unit', label: '单位', required: false },
  { key: 'user_name', label: '使用人', required: false },
  { key: 'keeper', label: '保管人', required: false },
  { key: 'install_place', label: '存放地点', required: false },
  { key: 'remark', label: '备注', required: false },
] as const

export type AssetImportRow = Record<string, unknown>

export interface RowError {
  /** Excel 行号（含表头，从 1 开始），便于用户定位 */
  row: number
  field?: string
  message: string
}

export interface ImportDicts {
  categories: Set<string>
  statuses: Set<string>
  depts: Set<string>
  purposes: Set<string>
  existingNos: Set<string>
}

/** 一次性载入校验所需的字典与已存在编号，避免逐行查库 */
export function loadImportDicts(db: Database, accountSetId: string): ImportDicts {
  const codes = (table: string) =>
    new Set(
      (db.prepare(`SELECT code FROM ${table} WHERE account_set_id=?`).all(accountSetId) as any[]).map(
        r => String(r.code)
      )
    )
  return {
    categories: codes('fixed_asset_category'),
    statuses: codes('fixed_asset_status'),
    depts: codes('fixed_asset_dept'),
    purposes: codes('fixed_asset_purpose'),
    existingNos: new Set(
      (
        db
          .prepare('SELECT asset_no FROM fixed_asset WHERE account_set_id=?')
          .all(accountSetId) as any[]
      ).map(r => String(r.asset_no))
    ),
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VALID_DEPR_METHODS = ['1', '2', '3', '4']

const str = (v: unknown): string => (v == null ? '' : String(v).trim())

/** 数值解析：空串视为「未填」返回 undefined；非法返回 null */
function num(v: unknown): number | undefined | null {
  const s = str(v)
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 归一化日期：接受 YYYY-MM-DD、YYYY/MM/DD 以及 Excel 序列号（xlsx 可能给出 Date 或数字）。
 * 无法识别返回 null。
 */
export function normalizeDate(v: unknown): string | undefined | null {
  if (v == null || v === '') return undefined
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  const s = str(v)
  if (!s) return undefined
  const slashed = s.replace(/\//g, '-')
  if (DATE_RE.test(slashed)) {
    // 格式对还要是真实日期（2026-13-01 / 2026-02-30 这类要拒绝）
    const [y, m, d] = slashed.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? slashed : null
  }
  // Excel 日期序列号：1899-12-30 为 0
  const serial = Number(s)
  if (Number.isFinite(serial) && serial > 0 && serial < 100000) {
    const base = Date.UTC(1899, 11, 30)
    const d = new Date(base + serial * 86400000)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return null
}

/**
 * 校验一行。`seenNos` 用于检出本批次内部的重号。
 * 返回错误数组（空数组表示通过）。
 */
export function validateImportRow(params: {
  row: AssetImportRow
  rowNumber: number
  dicts: ImportDicts
  seenNos: Set<string>
}): RowError[] {
  const { row, rowNumber, dicts, seenNos } = params
  const errors: RowError[] = []
  const err = (field: string, message: string) => errors.push({ row: rowNumber, field, message })

  const assetNo = str(row.asset_no)
  if (!assetNo) {
    err('asset_no', '资产编号不能为空')
  } else if (dicts.existingNos.has(assetNo)) {
    err('asset_no', `资产编号 ${assetNo} 在账套中已存在`)
  } else if (seenNos.has(assetNo)) {
    err('asset_no', `资产编号 ${assetNo} 在本次导入中重复`)
  }

  if (!str(row.asset_name)) err('asset_name', '资产名称不能为空')

  const checkDict = (field: string, label: string, set: Set<string>) => {
    const code = str(row[field])
    if (code && !set.has(code)) err(field, `${label} ${code} 不存在，请先在资产档案中建立`)
  }
  checkDict('category_code', '类别编码', dicts.categories)
  checkDict('status_code', '状态编码', dicts.statuses)
  checkDict('dept_code', '部门编码', dicts.depts)
  checkDict('purpose_code', '用途编码', dicts.purposes)

  for (const [field, label] of [
    ['acquire_date', '取得日期'],
    ['start_depr_date', '开始折旧日期'],
  ] as const) {
    if (normalizeDate(row[field]) === null) {
      err(field, `${label}格式无法识别，请使用 YYYY-MM-DD`)
    }
  }

  const original = num(row.original_value)
  if (original === undefined) err('original_value', '原值不能为空')
  else if (original === null) err('original_value', '原值必须是数字')
  else if (original < 0) err('original_value', '原值不能为负数')

  const salvageRate = num(row.salvage_rate)
  if (salvageRate === null) err('salvage_rate', '残值率必须是数字')
  // 评审 P2：残值率 = 1 意味着残值等于原值、永不计提，与卡片 / 字典口径（0 ≤ 率 < 1）一致地拒绝
  else if (salvageRate !== undefined && (salvageRate < 0 || salvageRate >= 1)) {
    err('salvage_rate', '残值率应为大于等于 0 且小于 1 的小数（如 0.05 表示 5%）')
  }

  const deprMethod = str(row.depr_method)
  if (deprMethod && !VALID_DEPR_METHODS.includes(deprMethod)) {
    err('depr_method', '折旧方法只能是 1平均年限 / 2工作量 / 3双倍余额递减 / 4年数总和')
  }

  const useMonths = num(row.use_months)
  if (useMonths === null) err('use_months', '使用月数必须是数字')
  else if (useMonths !== undefined && useMonths <= 0) err('use_months', '使用月数必须大于 0')

  const doneMonths = num(row.depr_months_done)
  if (doneMonths === null) err('depr_months_done', '已提月数必须是数字')
  else if (doneMonths !== undefined && doneMonths < 0) err('depr_months_done', '已提月数不能为负数')
  else if (
    doneMonths !== undefined &&
    useMonths !== undefined &&
    useMonths !== null &&
    doneMonths > useMonths
  ) {
    err('depr_months_done', '已提月数不能大于使用月数')
  }

  const accum = num(row.accum_depr)
  if (accum === null) err('accum_depr', '累计折旧必须是数字')
  else if (accum !== undefined && accum < 0) err('accum_depr', '累计折旧不能为负数')
  else if (
    accum !== undefined &&
    original !== undefined &&
    original !== null &&
    accum > original
  ) {
    err('accum_depr', '累计折旧不能大于原值')
  }

  if (deprMethod === '2') {
    const workload = num(row.total_workload)
    if (workload === undefined || workload === null || workload <= 0) {
      err('total_workload', '工作量法必须填写大于 0 的总工作量')
    }
  }

  const qty = num(row.qty)
  if (qty === null) err('qty', '数量必须是数字')

  return errors
}

export interface BatchImportResult {
  successCount: number
  errors: RowError[]
}

/**
 * 整批导入。任一行校验失败即整批不写入（全有或全无），
 * 避免用户面对「一半进去一半没进去」的中间状态。
 */
export function batchImportAssets(params: {
  db: Database
  accountSetId: string
  rows: AssetImportRow[]
  /** Excel 数据起始行号（默认 2，即表头占第 1 行） */
  startRowNumber?: number
}): BatchImportResult {
  const { db, accountSetId, rows } = params
  const startRowNumber = params.startRowNumber ?? 2

  if (!Array.isArray(rows) || rows.length === 0) {
    return { successCount: 0, errors: [{ row: 0, message: '没有可导入的数据' }] }
  }
  if (rows.length > 5000) {
    return { successCount: 0, errors: [{ row: 0, message: '单次导入不能超过 5000 行' }] }
  }

  const dicts = loadImportDicts(db, accountSetId)
  const seenNos = new Set<string>()
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    const rowNumber = startRowNumber + index
    const rowErrors = validateImportRow({ row, rowNumber, dicts, seenNos })
    errors.push(...rowErrors)
    const assetNo = str(row.asset_no)
    if (assetNo) seenNos.add(assetNo)
  })

  if (errors.length > 0) return { successCount: 0, errors }

  const ins = db.prepare(
    `INSERT INTO fixed_asset
       (id, account_set_id, asset_no, asset_name, category_code, status_code, dept_code, purpose_code,
        acquire_date, start_depr_date, original_value, salvage_rate, salvage_value, depr_method,
        use_months, total_workload, accum_depr, impairment_amount, depr_months_done, net_value,
        qty, unit, user_name, keeper, install_place, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`
  )

  db.transaction(() => {
    for (const row of rows) {
      const originalValue = Number(num(row.original_value) ?? 0)
      const salvageRate = Number(num(row.salvage_rate) ?? 0)
      const accumDepr = Number(num(row.accum_depr) ?? 0)
      const round2 = (n: number) => Math.round(n * 100) / 100

      ins.run(
        uuidv4(),
        accountSetId,
        str(row.asset_no),
        str(row.asset_name),
        str(row.category_code) || null,
        str(row.status_code) || null,
        str(row.dept_code) || null,
        str(row.purpose_code) || null,
        normalizeDate(row.acquire_date) ?? null,
        normalizeDate(row.start_depr_date) ?? null,
        round2(originalValue),
        salvageRate,
        round2(originalValue * salvageRate),
        str(row.depr_method) || null,
        num(row.use_months) ?? null,
        num(row.total_workload) ?? null,
        round2(accumDepr),
        num(row.depr_months_done) ?? 0,
        round2(originalValue - accumDepr),
        num(row.qty) ?? 1,
        str(row.unit) || null,
        str(row.user_name) || null,
        str(row.keeper) || null,
        str(row.install_place) || null,
        str(row.remark) || null
      )
    }
  })()

  return { successCount: rows.length, errors: [] }
}
