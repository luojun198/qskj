import type { Database } from 'better-sqlite3'

export interface DeprQueryOptions {
  /** YYYYMM，含两端 */
  fromYm: number
  toYm: number
  category_code?: string
  dept_code?: string
  purpose_code?: string
  depr_method?: string
  keyword?: string
  /** 折旧为零不显示 */
  hideZero?: boolean
}

/**
 * 折旧查询（第七份反馈：参照润衡「折旧查询」，按年月范围 + 条件逐月列出计提记录）。
 * 部门 / 用途 / 折旧方法取计提当时记录在折旧表上的值，类别取卡片当前类别。
 */
export function queryDeprRecords(db: Database, accountSetId: string, opts: DeprQueryOptions) {
  const { fromYm, toYm } = opts
  if (!Number.isInteger(fromYm) || !Number.isInteger(toYm) || fromYm > toYm) {
    throw new Error('请选择正确的起止年月')
  }
  const conds = ['fd.account_set_id = ?', '(fd.year * 100 + fd.month) BETWEEN ? AND ?']
  const params: unknown[] = [accountSetId, fromYm, toYm]
  if (opts.category_code) { conds.push('fa.category_code = ?'); params.push(opts.category_code) }
  if (opts.dept_code) { conds.push('fd.dept_code = ?'); params.push(opts.dept_code) }
  if (opts.purpose_code) { conds.push('fd.purpose_code = ?'); params.push(opts.purpose_code) }
  if (opts.depr_method) { conds.push('fd.depr_method = ?'); params.push(opts.depr_method) }
  if (opts.keyword) {
    conds.push('(fd.asset_no LIKE ? OR fa.asset_name LIKE ? OR fa.spec LIKE ? OR fa.ref_no LIKE ?)')
    params.push(...Array(4).fill(`%${opts.keyword}%`))
  }
  if (opts.hideZero) conds.push('ABS(COALESCE(fd.month_depr, 0)) >= 0.005')
  return db.prepare(`
    SELECT fd.year, fd.month, fd.asset_no, fd.depr_method, fd.month_depr, fd.accum_depr, fd.dept_code, fd.purpose_code,
      fa.asset_name, fa.spec, fa.ref_no, fa.original_value, fa.category_code,
      fc.name AS category_name, fdp.name AS dept_name, fp.name AS purpose_name,
      fw.workload AS month_workload, v.voucher_no
    FROM fixed_asset_depr fd
    LEFT JOIN fixed_asset fa ON fa.account_set_id=fd.account_set_id AND fa.asset_no=fd.asset_no
    LEFT JOIN fixed_asset_category fc ON fc.account_set_id=fd.account_set_id AND fc.code=fa.category_code
    LEFT JOIN fixed_asset_dept fdp ON fdp.account_set_id=fd.account_set_id AND fdp.code=fd.dept_code
    LEFT JOIN fixed_asset_purpose fp ON fp.account_set_id=fd.account_set_id AND fp.code=fd.purpose_code
    LEFT JOIN fixed_asset_workload fw ON fw.account_set_id=fd.account_set_id AND fw.asset_no=fd.asset_no AND fw.year=fd.year AND fw.month=fd.month
    LEFT JOIN vouchers v ON v.id=fd.voucher_id
    WHERE ${conds.join(' AND ')}
    ORDER BY fd.year, fd.month, fd.asset_no
  `).all(...params)
}
