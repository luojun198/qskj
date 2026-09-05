import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { exportZcYzzj, exportZcSbbd } from '../services/acdExportCashierAsset.js'
import { createAssetTestDb, SET_ID } from './helpers/assetTestDb.js'

/** ACD 导出的是 GBK 文本，解回来按行拆分便于断言 */
function decodeLines(buf: Buffer): string[][] {
  const text = iconv.decode(buf, 'gbk')
  return text
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .map(l => l.split('\t'))
}

describe('ACD 导出：资产变动分流到 zc_yzzj / zc_sbbd', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createAssetTestDb()
  })

  afterEach(() => db.close())

  let seq = 0
  const addChange = (over: Record<string, unknown>) => {
    seq += 1
    const row = {
      id: `ch-${seq}`,
      account_set_id: SET_ID,
      asset_no: 'A1',
      change_date: '2026-06-15',
      change_item: '原值增减',
      old_value: null,
      new_value: null,
      amount: null,
      remark: null,
      operator: '测试',
      change_kind: null,
      change_type_code: null,
      field_key: null,
      old_text: null,
      new_text: null,
      voucher_id: null,
      year: 2026,
      period: 6,
      created_by: null,
      ...over,
    }
    const cols = Object.keys(row)
    db.prepare(
      `INSERT INTO fixed_asset_change (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
    ).run(...cols.map(c => (row as any)[c]))
  }

  const yzzj = () => decodeLines(exportZcYzzj(db, SET_ID))
  const sbbd = () => decodeLines(exportZcSbbd(db, SET_ID))

  it('原值变动进 zc_yzzj', () => {
    addChange({ change_kind: 'original_value', change_item: '原值增减', new_value: 15000, amount: 3000 })
    expect(yzzj()).toHaveLength(1)
    expect(sbbd()).toHaveLength(0)
  })

  it('大修改良也进 zc_yzzj（原实现按 change_item 字符串匹配会漏掉）', () => {
    addChange({ change_kind: 'improvement', change_item: '大修改良', new_value: 18000, amount: 6000 })
    expect(yzzj()).toHaveLength(1)
    expect(sbbd()).toHaveLength(0)
  })

  it('计提减值准备也进 zc_yzzj', () => {
    addChange({ change_kind: 'impairment', change_item: '计提减值准备', new_value: 2000, amount: 2000 })
    expect(yzzj()).toHaveLength(1)
    expect(sbbd()).toHaveLength(0)
  })

  it('部门调拨、状态变更、折旧要素调整进 zc_sbbd', () => {
    addChange({ change_kind: 'dept', change_item: '部门调拨：生产部 → 销售部' })
    addChange({ change_kind: 'status', change_item: '使用状态变更：在用 → 未使用' })
    addChange({ change_kind: 'depr_factor', change_item: '折旧要素调整：使用月数' })
    expect(yzzj()).toHaveLength(0)
    expect(sbbd()).toHaveLength(3)
  })

  it('处置与拆分进 zc_sbbd', () => {
    addChange({ change_kind: 'dispose', change_item: '资产减少（出售）' })
    addChange({ change_kind: 'split', change_item: '资产拆分转出（拆出 2 张卡片）' })
    expect(yzzj()).toHaveLength(0)
    expect(sbbd()).toHaveLength(2)
  })

  it('ACD 导入的历史行按其原有 change_item 归属，不因 legacy 标记被挪走', () => {
    addChange({ change_kind: 'legacy', change_item: '原值增减', new_value: 9000, amount: 1000 })
    addChange({ change_kind: 'legacy', change_item: '变动' })
    expect(yzzj()).toHaveLength(1)
    expect(sbbd()).toHaveLength(1)
  })

  it('change_kind 为空的旧数据同样按 change_item 归属', () => {
    addChange({ change_kind: null, change_item: '原值增减', new_value: 9000, amount: 1000 })
    addChange({ change_kind: null, change_item: '其他变动' })
    expect(yzzj()).toHaveLength(1)
    expect(sbbd()).toHaveLength(1)
  })

  it('两张表互补：每条变动记录恰好出现在其中一张', () => {
    addChange({ change_kind: 'original_value', change_item: '原值增减', new_value: 1, amount: 1 })
    addChange({ change_kind: 'improvement', change_item: '大修改良', new_value: 2, amount: 2 })
    addChange({ change_kind: 'dept', change_item: '部门调拨' })
    addChange({ change_kind: 'legacy', change_item: '原值增减', new_value: 3, amount: 3 })
    addChange({ change_kind: 'legacy', change_item: '变动' })

    const total = (db.prepare('SELECT COUNT(*) c FROM fixed_asset_change').get() as any).c
    expect(yzzj().length + sbbd().length).toBe(total)
  })

  it('zc_yzzj 输出 10 列，序号自 1 递增，带出年月', () => {
    addChange({ change_kind: 'original_value', change_item: '原值增减', new_value: 15000, amount: 3000 })
    addChange({
      change_kind: 'original_value',
      change_item: '原值增减',
      change_date: '2026-07-20',
      new_value: 16000,
      amount: 1000,
    })
    const lines = yzzj()
    expect(lines[0]).toHaveLength(10)
    expect(lines[0][0]).toBe('1')
    expect(lines[1][0]).toBe('2')
    // nf / yf 列
    expect(lines[1][7]).toBe('2026')
    expect(lines[1][8]).toBe('7')
  })

  it('zc_sbbd 输出 6 列，带出变动项与操作人', () => {
    addChange({
      change_kind: 'dept',
      change_item: '部门调拨：生产部 → 销售部',
      operator: '张三',
    })
    const line = sbbd()[0]
    expect(line).toHaveLength(6)
    expect(line[0]).toBe('A1')
    expect(line[1]).toBe('部门调拨：生产部 → 销售部')
    expect(line[5]).toBe('张三')
  })
})
