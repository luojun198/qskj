/**
 * S3：整单折扣分摊到行
 *
 * 原实现整单折扣只作用于表头 total_amount，凭证/应收应付/成本都按行取数，
 * 于是「单据合计 ≠ 凭证金额 ≠ 往来挂账额」。本组用例把「Σ行金额 == 表头合计」钉死。
 */
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'

let testDb: Database.Database
vi.mock('../db/index.js', () => ({ getDb: () => testDb }))

import {
  allocateHeaderDiscount,
  LINE_COL_QTY, LINE_COL_PRICE, LINE_COL_AMOUNT,
  LINE_COL_DISCOUNT_AMOUNT, LINE_COL_TAX_AMOUNT,
} from '../routes/scmDoc.js'

/** 构造一行「落库数组 + 汇总值」，只填分摊逻辑关心的几列 */
function mkRow(qty: number, price: number, amount: number, tax = 0) {
  const values: any[] = []
  values[LINE_COL_QTY] = qty
  values[LINE_COL_PRICE] = price
  values[LINE_COL_AMOUNT] = amount
  values[LINE_COL_DISCOUNT_AMOUNT] = 0
  values[LINE_COL_TAX_AMOUNT] = tax
  return { values, amount }
}

const sumLines = (rows: Array<{ values: any[] }>) =>
  Math.round(rows.reduce((s, r) => s + Number(r.values[LINE_COL_AMOUNT]), 0) * 100) / 100

describe('S3 整单折扣分摊到行', () => {
  it('无整单折扣时行金额原样不动', () => {
    const rows = [mkRow(1, 100, 100), mkRow(2, 50, 100)]
    expect(allocateHeaderDiscount(rows, 0)).toBe(200)
    expect(rows.map(r => r.values[LINE_COL_AMOUNT])).toEqual([100, 100])
  })

  it('9 折：行金额同比例下调，Σ行 == 表头合计', () => {
    const rows = [mkRow(1, 100, 100), mkRow(2, 50, 100)]
    const total = allocateHeaderDiscount(rows, 9)
    expect(total).toBe(180)
    expect(sumLines(rows)).toBe(180)
    expect(rows.map(r => r.values[LINE_COL_AMOUNT])).toEqual([90, 90])
  })

  it('舍入尾差由末行吸收，Σ行严格等于表头合计', () => {
    // 三行各 33.33，7 折后单行 23.331 → 23.33，Σ=69.99，而 99.99×0.7=69.99…需末行兜底
    const rows = [mkRow(1, 33.33, 33.33), mkRow(1, 33.33, 33.33), mkRow(1, 33.34, 33.34)]
    const total = allocateHeaderDiscount(rows, 7)
    expect(sumLines(rows)).toBe(total)
  })

  it('税额随折后金额同比例缩放', () => {
    const rows = [mkRow(1, 100, 100, 13)]
    allocateHeaderDiscount(rows, 8)
    expect(rows[0].values[LINE_COL_AMOUNT]).toBe(80)
    expect(rows[0].values[LINE_COL_TAX_AMOUNT]).toBe(10.4)
  })

  it('折扣额 = 原价 - 折后金额（含行折扣叠加整单折扣）', () => {
    // 行折扣后 90（原价 100），再整单 9 折 → 81，折扣额 = 100 - 81 = 19
    const rows = [mkRow(1, 100, 90)]
    allocateHeaderDiscount(rows, 9)
    expect(rows[0].values[LINE_COL_AMOUNT]).toBe(81)
    expect(rows[0].values[LINE_COL_DISCOUNT_AMOUNT]).toBe(19)
  })

  it('全 0 金额行不产生 NaN', () => {
    const rows = [mkRow(0, 0, 0), mkRow(0, 0, 0)]
    expect(allocateHeaderDiscount(rows, 9)).toBe(0)
    expect(rows.every(r => r.values[LINE_COL_AMOUNT] === 0)).toBe(true)
  })

  it('空行数组直接返回 0', () => {
    expect(allocateHeaderDiscount([], 9)).toBe(0)
  })
})
