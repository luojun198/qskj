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
import { getVoucherImmutableReason } from './voucherMutationGuard.js'
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

/** 每个分片的凭证张数：一个分片一个事务、一次进度写入、一次让出事件循环 */
const BATCH_CHUNK_SIZE = 50

/**
 * FIX-252（十万级压测 P1-4）：分片执行批量凭证操作。
 *
 * 旧实现在一个 setImmediate 回调里同步逐张跑完全部凭证（3,000 张记账 52 秒），期间事件循环被占，
 * 其他所有用户的请求排队；且每张单独提交事务、每张写一次任务进度。现改为：
 *  - 每 BATCH_CHUNK_SIZE 张包一个外层事务（单张操作自带的 db.transaction 在其中降级为 SAVEPOINT，
 *    单张失败只回滚该张，语义与逐张一致），减少提交次数；
 *  - 每个分片后 `await setImmediate` 让出事件循环，让排队的 HTTP 请求得到处理；
 *  - 进度每分片写一次而不是每张。
 * handle 返回校验失败文案（记为失败）或 null（成功）；抛错同样记为失败。
 */
export async function runVoucherBatchInChunks(
  db: Database,
  taskId: string,
  vouchers: any[],
  handle: (voucher: any) => string | null | undefined,
  fallbackError: string
): Promise<{ success: number; failed: number; errors: BatchVoucherError[] }> {
  let success = 0
  let failed = 0
  const errors: BatchVoucherError[] = []

  const runChunk = db.transaction((chunk: any[]) => {
    for (const voucher of chunk) {
      try {
        const validationError = handle(voucher)
        if (validationError) {
          failed++
          pushVoucherBatchError(errors, voucher, validationError)
        } else {
          success++
        }
      } catch (error: any) {
        failed++
        pushVoucherBatchError(errors, voucher, error.message || fallbackError)
      }
    }
  })

  for (let start = 0; start < vouchers.length; start += BATCH_CHUNK_SIZE) {
    runChunk(vouchers.slice(start, start + BATCH_CHUNK_SIZE))
    const processed = Math.min(start + BATCH_CHUNK_SIZE, vouchers.length)
    updateTask(taskId, {
      processed,
      success,
      failed,
      progress: Math.floor((processed / vouchers.length) * 100),
    })
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  // 批量写入后刷新规划器统计（压测发现统计陈旧时余额表 CTE 会误选索引，0.5s → 1.5s）
  try { db.pragma('optimize') } catch { /* 只读库等情况忽略 */ }

  return { success, failed, errors }
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

      const { success, failed, errors } = await runVoucherBatchInChunks(
        params.db,
        task.id,
        vouchers,
        voucher => {
          const validationError = validateVoucherForAudit(voucher, params.userId)
          if (validationError) return validationError
          applyVoucherAudit({
            db: params.db,
            voucherId: voucher.id,
            userId: params.userId,
            userName: params.userName,
          })
          return null
        },
        '审核失败'
      )

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

      const { success, failed, errors } = await runVoucherBatchInChunks(
        params.db,
        task.id,
        vouchers,
        voucher => {
          // P1-14：与同步接口一致，补总账 / 出纳期间闸
          const validationError =
            validateVoucherForUnAudit(voucher) ||
            getVoucherImmutableReason({ db: params.db, accountSetId: params.accountSetId, voucher, operation: 'unaudit' })
          if (validationError) return validationError
          applyVoucherUnAudit({ db: params.db, voucherId: voucher.id })
          return null
        },
        '反审核失败'
      )

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

      // FIX-324：整批共用实时余额缓存
      const balanceCache = new Map<string, number>()
      const { success, failed, errors } = await runVoucherBatchInChunks(
        params.db,
        task.id,
        vouchers,
        voucher => {
          const validationError = validateVoucherCanPost(
            voucher,
            requireAuditEnabled,
            allowDirectPostEnabled
          )
          if (validationError) return validationError
          const entries = loadVoucherEntries(params.db, voucher.id)
          applyVoucherPosting(params.db, voucher, entries, {
            accountSetId: params.accountSetId,
            userId: params.userId,
            userName: params.userName,
            requireAudit: requireAuditEnabled,
            allowDirectPost: allowDirectPostEnabled,
            // 上面 validateInitBalanceBalancedForYears 已对全部涉及年度试算通过
            skipInitBalanceCheck: true,
            balanceCache,
          })
          return null
        },
        '记账失败'
      )

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

      const { success, failed, errors } = await runVoucherBatchInChunks(
        params.db,
        task.id,
        vouchers,
        voucher => {
          // 总账 / 出纳期间闸（此前异步批量反记账没有任何期间校验）
          const validationError =
            validateVoucherForUnpost(voucher) ||
            getVoucherImmutableReason({ db: params.db, accountSetId: params.accountSetId, voucher, operation: 'unpost' })
          if (validationError) return validationError
          const entries = loadVoucherEntries(params.db, voucher.id)
          applyVoucherUnpost(params.db, voucher, entries, {
            accountSetId: params.accountSetId,
            requireAudit: getRequireAuditEnabled(requireAudit),
            allowDirectPost: getAllowDirectPost(allowDirectPost),
          })
          return null
        },
        '反记账失败'
      )

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
