import { Database } from 'better-sqlite3'
import { createTask, updateTask, Task } from './taskQueue.js'
import {
  applyVoucherAudit,
  applyVoucherUnAudit,
  getVoucherById,
  validateVoucherForAudit,
  validateVoucherForUnAudit,
} from './voucherEntry.js'
import {
  applyVoucherPosting,
  applyVoucherUnpost,
  getAllowDirectPost,
  getRequireAuditEnabled,
  loadVoucherEntries,
  validateVoucherCanPost,
  validateVoucherForUnpost,
} from './voucherPosting.js'
import { validateInitBalanceBalancedForYears } from './initBalanceTrial.js'
import { formatVoucherDisplayLabel } from '../utils/displayLabel.js'

type BatchVoucherError = { id: string; label: string; error: string }

function pushVoucherBatchError(
  errors: BatchVoucherError[],
  voucher: { id: string; voucher_no?: string; voucher_date?: string },
  error: string
) {
  errors.push({
    id: voucher.id,
    label: formatVoucherDisplayLabel(voucher),
    error,
  })
}

function sliceBatchErrors(errors: BatchVoucherError[]) {
  return errors.slice(0, 10)
}

interface BatchOperationParams {
  db: Database
  accountSetId: string
  userId: string
  userName: string
  dateRange?: [string, string]
  voucherTypeIds?: string[]
  status?: string
}

// 批量审核（异步）
export async function batchAuditAsync(params: BatchOperationParams): Promise<string> {
  const task = createTask('batch-audit', params.accountSetId)

  // 异步执行
  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })

      // 查询符合条件的凭证（只查询未审核的凭证）
      const vouchers = queryVouchers({ ...params, status: 'draft' })
      updateTask(task.id, { total: vouchers.length })

      let success = 0
      let failed = 0
      const errors: BatchVoucherError[] = []

      for (let i = 0; i < vouchers.length; i++) {
        const voucher = vouchers[i]
        try {
          const validationError = validateVoucherForAudit(voucher, params.userId)
          if (validationError) {
            failed++
            pushVoucherBatchError(errors, voucher, validationError)
          } else {
            applyVoucherAudit({
              db: params.db,
              voucherId: voucher.id,
              userId: params.userId,
              userName: params.userName,
            })
            success++
          }
        } catch (error: any) {
          failed++
          pushVoucherBatchError(errors, voucher, error.message || '审核失败')
        }

        // 更新进度
        const processed = i + 1
        const progress = Math.floor((processed / vouchers.length) * 100)
        updateTask(task.id, { processed, success, failed, progress })
      }

      // 完成
      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: `批量审核完成：成功 ${success} 张，失败 ${failed} 张`,
        result: { success, failed, errors: sliceBatchErrors(errors) },
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '批量审核失败',
      })
    }
  })

  return task.id
}

// 批量反审核（异步）
export async function batchUnAuditAsync(params: BatchOperationParams): Promise<string> {
  const task = createTask('batch-unaudit', params.accountSetId)

  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })

      const vouchers = queryVouchers({ ...params, status: 'audited' })
      updateTask(task.id, { total: vouchers.length })

      let success = 0
      let failed = 0
      const errors: BatchVoucherError[] = []

      for (let i = 0; i < vouchers.length; i++) {
        const voucher = vouchers[i]
        try {
          const validationError = validateVoucherForUnAudit(voucher)
          if (validationError) {
            failed++
            pushVoucherBatchError(errors, voucher, validationError)
          } else {
            applyVoucherUnAudit({ db: params.db, voucherId: voucher.id })
            success++
          }
        } catch (error: any) {
          failed++
          pushVoucherBatchError(errors, voucher, error.message || '反审核失败')
        }

        const processed = i + 1
        const progress = Math.floor((processed / vouchers.length) * 100)
        updateTask(task.id, { processed, success, failed, progress })
      }

      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: `批量反审核完成：成功 ${success} 张，失败 ${failed} 张`,
        result: { success, failed, errors: sliceBatchErrors(errors) },
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '批量反审核失败',
      })
    }
  })

  return task.id
}

// 批量记账（异步）
export async function batchPostAsync(params: BatchOperationParams): Promise<string> {
  const task = createTask('batch-post', params.accountSetId)

  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })

      // 获取系统参数
      const requireAudit = params.db
        .prepare(
          `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`
        )
        .get(params.accountSetId) as any
      const requireAuditEnabled = getRequireAuditEnabled(requireAudit)

      const allowDirectPost = params.db
        .prepare(
          `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`
        )
        .get(params.accountSetId) as any
      const allowDirectPostEnabled = getAllowDirectPost(allowDirectPost)

      // 根据系统参数决定查询哪些状态的凭证
      // 如果不启用审核，可以直接记账 draft 状态的凭证
      // 如果启用审核但允许直接记账，可以记账 draft 和 audited 状态的凭证
      // 如果启用审核且不允许直接记账，只能记账 audited 状态的凭证
      let queryStatus: string
      if (!requireAuditEnabled) {
        // 不启用审核：查询 draft 和 audited 状态的凭证
        queryStatus = 'draft,audited'
      } else if (allowDirectPostEnabled) {
        // 启用审核但允许直接记账：查询 draft 和 audited 状态的凭证
        queryStatus = 'draft,audited'
      } else {
        // 启用审核且不允许直接记账：只查询 audited 状态的凭证
        queryStatus = 'audited'
      }

      // 查询符合条件的凭证（排除已记账的）
      const vouchers = queryVouchersForPost(params, queryStatus)
      updateTask(task.id, { total: vouchers.length })

      const initBalanceError = validateInitBalanceBalancedForYears(
        params.db,
        params.accountSetId,
        [...new Set(vouchers.map(v => v.year as number))]
      )
      if (initBalanceError) {
        updateTask(task.id, {
          status: 'completed',
          progress: 100,
          processed: vouchers.length,
          success: 0,
          failed: vouchers.length,
          message: `批量记账失败：${initBalanceError}（共 ${vouchers.length} 张全部未通过）`,
          result: {
            success: 0,
            failed: vouchers.length,
            initBalanceBlocked: true,
            reason: initBalanceError,
          },
        })
        return
      }

      let success = 0
      let failed = 0
      const errors: BatchVoucherError[] = []

      for (let i = 0; i < vouchers.length; i++) {
        const voucher = vouchers[i]
        try {
          const validationError = validateVoucherCanPost(
            voucher,
            requireAuditEnabled,
            allowDirectPostEnabled
          )
          if (validationError) {
            failed++
            pushVoucherBatchError(errors, voucher, validationError)
          } else {
            const entries = loadVoucherEntries(params.db, voucher.id)
            applyVoucherPosting(params.db, voucher, entries, {
              accountSetId: params.accountSetId,
              userId: params.userId,
              userName: params.userName,
              requireAudit: requireAuditEnabled,
              allowDirectPost: allowDirectPostEnabled,
            })
            success++
          }
        } catch (error: any) {
          failed++
          pushVoucherBatchError(errors, voucher, error.message || '记账失败')
        }

        const processed = i + 1
        const progress = Math.floor((processed / vouchers.length) * 100)
        updateTask(task.id, { processed, success, failed, progress })
      }

      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: `批量记账完成：成功 ${success} 张，失败 ${failed} 张`,
        result: { success, failed, errors: sliceBatchErrors(errors) },
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '批量记账失败',
      })
    }
  })

  return task.id
}

// 批量反记账（异步）
export async function batchUnpostAsync(params: BatchOperationParams): Promise<string> {
  const task = createTask('batch-unpost', params.accountSetId)

  setImmediate(async () => {
    try {
      updateTask(task.id, { status: 'processing' })

      const vouchers = queryVouchers({ ...params, status: 'posted' })
      updateTask(task.id, { total: vouchers.length })

      let success = 0
      let failed = 0
      const errors: BatchVoucherError[] = []

      const requireAudit = params.db
        .prepare(
          `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='require_audit'`
        )
        .get(params.accountSetId) as any

      const allowDirectPost = params.db
        .prepare(
          `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='allow_direct_post'`
        )
        .get(params.accountSetId) as any

      for (let i = 0; i < vouchers.length; i++) {
        const voucher = vouchers[i]
        try {
          const validationError = validateVoucherForUnpost(voucher)
          if (validationError) {
            failed++
            pushVoucherBatchError(errors, voucher, validationError)
          } else {
            const entries = loadVoucherEntries(params.db, voucher.id)
            applyVoucherUnpost(params.db, voucher, entries, {
              accountSetId: params.accountSetId,
              requireAudit: getRequireAuditEnabled(requireAudit),
              allowDirectPost: getAllowDirectPost(allowDirectPost),
            })
            success++
          }
        } catch (error: any) {
          failed++
          pushVoucherBatchError(errors, voucher, error.message || '反记账失败')
        }

        const processed = i + 1
        const progress = Math.floor((processed / vouchers.length) * 100)
        updateTask(task.id, { processed, success, failed, progress })
      }

      updateTask(task.id, {
        status: 'completed',
        progress: 100,
        message: `批量反记账完成：成功 ${success} 张，失败 ${failed} 张`,
        result: { success, failed, errors: sliceBatchErrors(errors) },
      })
    } catch (error: any) {
      updateTask(task.id, {
        status: 'failed',
        message: error.message || '批量反记账失败',
      })
    }
  })

  return task.id
}

// 查询符合条件的凭证
function queryVouchers(params: BatchOperationParams): any[] {
  let sql = `SELECT * FROM vouchers WHERE account_set_id = ?`
  const sqlParams: any[] = [params.accountSetId]

  if (params.dateRange && params.dateRange.length === 2) {
    sql += ` AND voucher_date BETWEEN ? AND ?`
    sqlParams.push(params.dateRange[0], params.dateRange[1])
  }

  if (params.voucherTypeIds && params.voucherTypeIds.length > 0) {
    sql += ` AND voucher_type_id IN (${params.voucherTypeIds.map(() => '?').join(',')})`
    sqlParams.push(...params.voucherTypeIds)
  }

  if (params.status) {
    sql += ` AND status = ?`
    sqlParams.push(params.status)
  }

  sql += ` ORDER BY voucher_date, voucher_no`

  return params.db.prepare(sql).all(...sqlParams) as any[]
}

// 查询符合条件的凭证（用于批量记账，支持多状态）
function queryVouchersForPost(params: BatchOperationParams, statusList: string): any[] {
  let sql = `SELECT * FROM vouchers WHERE account_set_id = ? AND status != 'posted'`
  const sqlParams: any[] = [params.accountSetId]

  // 如果指定了状态列表，添加状态过滤
  if (statusList) {
    const statuses = statusList.split(',')
    sql += ` AND status IN (${statuses.map(() => '?').join(',')})`
    sqlParams.push(...statuses)
  }

  if (params.dateRange && params.dateRange.length === 2) {
    sql += ` AND voucher_date BETWEEN ? AND ?`
    sqlParams.push(params.dateRange[0], params.dateRange[1])
  }

  if (params.voucherTypeIds && params.voucherTypeIds.length > 0) {
    sql += ` AND voucher_type_id IN (${params.voucherTypeIds.map(() => '?').join(',')})`
    sqlParams.push(...params.voucherTypeIds)
  }

  sql += ` ORDER BY voucher_date, voucher_no`

  return params.db.prepare(sql).all(...sqlParams) as any[]
}
