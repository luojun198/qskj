import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runVoucherBatchInChunks } from '../services/batchOperationAsync.js'
import { createTask, getTask } from '../services/taskQueue.js'

/**
 * FIX-252：批量凭证操作分片执行——
 *  - 一个分片一个外层事务，单张失败只回滚该张（SAVEPOINT），同分片其他张照常提交；
 *  - 进度每分片写一次；分片之间让出事件循环。
 */
function setup() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE posted (id TEXT PRIMARY KEY)')
  return db
}

describe('runVoucherBatchInChunks', () => {
  it('单张失败只回滚该张，同分片其余张提交；校验失败与抛错都计入 failed', async () => {
    const db = setup()
    const task = createTask('batch-post', 'as-1')
    const vouchers = Array.from({ length: 250 }, (_, i) => ({ id: `v${i}`, voucher_no: String(i) }))
    const insert = db.prepare('INSERT INTO posted VALUES (?)')
    // 单张操作模拟 applyVoucherPosting：自带事务，写入后再判断是否抛错
    const postOne = db.transaction((id: string, shouldThrow: boolean) => {
      insert.run(id)
      if (shouldThrow) throw new Error('模拟过账异常')
    })

    const result = await runVoucherBatchInChunks(
      db,
      task.id,
      vouchers,
      v => {
        const n = Number(v.id.slice(1))
        if (n % 50 === 7) return '期间已结账'
        postOne(v.id, n % 50 === 13)
        return null
      },
      '记账失败'
    )

    expect(result.failed).toBe(10) // 5 张校验失败 + 5 张抛错
    expect(result.success).toBe(240)
    const rows = db.prepare('SELECT id FROM posted').all() as { id: string }[]
    expect(rows).toHaveLength(240)
    // 抛错的那张已回滚，没有半提交
    expect(rows.some(r => r.id === 'v13')).toBe(false)
    expect(rows.some(r => r.id === 'v12')).toBe(true)
    expect(result.errors.find(e => e.id === 'v7')?.error).toBe('期间已结账')
    expect(result.errors.find(e => e.id === 'v13')?.error).toBe('模拟过账异常')
    expect(db.inTransaction).toBe(false)

    const t = getTask(task.id)!
    expect(t.processed).toBe(250)
    expect(t.progress).toBe(100)
    expect(t.success).toBe(240)
  })

  it('分片之间让出事件循环，期间排队的宏任务能得到执行', async () => {
    const db = setup()
    const task = createTask('batch-post', 'as-1')
    const vouchers = Array.from({ length: 350 }, (_, i) => ({ id: `v${i}` }))
    const ticks: number[] = []
    const timer = setInterval(() => ticks.push(getTask(task.id)?.processed ?? -1), 0)
    // 每张模拟 0.05ms 的同步工作，使每个分片约 5ms，让定时器有机会在分片之间触发
    await runVoucherBatchInChunks(
      db,
      task.id,
      vouchers,
      () => {
        const until = performance.now() + 0.05
        while (performance.now() < until) { /* busy */ }
        return null
      },
      '失败'
    )
    clearInterval(timer)
    // 七个分片（50 张一片），至少在中间进度上被观察到过
    expect(ticks.some(p => p > 0 && p < 350)).toBe(true)
  })
})
