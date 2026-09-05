import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ACD_UNIT_NAME_PARAM,
  isPlaceholderUnitName,
  resolveReportUnitName,
  stripAccountSetNameDecorations,
} from '../services/reportUnitName.js'

function createDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE system_params (
      id TEXT PRIMARY KEY,
      account_set_id TEXT,
      param_key TEXT NOT NULL,
      param_value TEXT,
      description TEXT,
      UNIQUE(account_set_id, param_key)
    );
  `)
  return db
}

function addSet(db: Database.Database, id: string, name: string) {
  db.prepare('INSERT INTO account_sets VALUES (?,?)').run(id, name)
}

function setParam(db: Database.Database, setId: string, key: string, value: string) {
  db.prepare(
    'INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?,?,?,?)'
  ).run(`${setId}-${key}`, setId, key, value)
}

describe('reportUnitName', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb()
  })

  describe('账套名兜底', () => {
    it('剥掉 ACD 文件名带来的 zwNN 前缀与备份日期', () => {
      expect(stripAccountSetNameDecorations('zw06广州东汇食品有限公司20260827')).toBe(
        '广州东汇食品有限公司'
      )
      expect(stripAccountSetNameDecorations('zw01广州东汇食品有限公司20260516(2)')).toBe(
        '广州东汇食品有限公司'
      )
    })

    it('不碰账套名里的时间戳——13 位数字不是备份日期', () => {
      // 只按 8 位数剥的话会截成「测试导入_17844」
      expect(stripAccountSetNameDecorations('测试导入_1784492442487')).toBe('测试导入_1784492442487')
    })

    it('普通账套名原样返回', () => {
      expect(stripAccountSetNameDecorations('出纳测试')).toBe('出纳测试')
      expect(stripAccountSetNameDecorations('3333333')).toBe('3333333')
    })

    it('剥完为空时退回原名，不返回空串', () => {
      expect(stripAccountSetNameDecorations('zw0620260827')).toBe('zw0620260827')
    })
  })

  describe('模板占位名识别', () => {
    it('ACD 自带的占位单位名不算真实单位', () => {
      expect(isPlaceholderUnitName('xx公司')).toBe(true)
      expect(isPlaceholderUnitName('xx行政事业单位')).toBe(true)
      expect(isPlaceholderUnitName('  ')).toBe(true)
      expect(isPlaceholderUnitName(null)).toBe(true)
      expect(isPlaceholderUnitName('广州东汇食品有限公司')).toBe(false)
    })
  })

  describe('取数时的 %U 来源优先级', () => {
    it('优先用用户维护的 unit_name', () => {
      addSet(db, 's1', 'zw06广州东汇食品有限公司20260827')
      setParam(db, 's1', ACD_UNIT_NAME_PARAM, '广州东汇食品有限公司')
      setParam(db, 's1', 'unit_name', '广州东汇食品（集团）有限公司')

      expect(resolveReportUnitName(db as never, 's1')).toBe('广州东汇食品（集团）有限公司')
    })

    it('没设 unit_name 时用 ACD 解析出的单位名', () => {
      addSet(db, 's1', 'zw06广州东汇食品有限公司20260827')
      setParam(db, 's1', ACD_UNIT_NAME_PARAM, '广州东汇食品有限公司')

      expect(resolveReportUnitName(db as never, 's1')).toBe('广州东汇食品有限公司')
    })

    it('ACD 里是模板占位名时跳过它，退回账套名', () => {
      // zw09 这张备份的 xt_dwmc 就是「xx行政事业单位」
      addSet(db, 's1', 'zw09深圳美茂商业管理有限公司20260827')
      setParam(db, 's1', ACD_UNIT_NAME_PARAM, 'xx行政事业单位')

      expect(resolveReportUnitName(db as never, 's1')).toBe('深圳美茂商业管理有限公司')
    })

    it('什么都没有时退回账套名，且不带 zwNN 前缀与日期', () => {
      addSet(db, 's1', 'zw06广州东汇食品有限公司20260827')

      // 这正是修复前报表抬头打出「zw06广州东汇食品有限公司20260827」的那条路径
      expect(resolveReportUnitName(db as never, 's1')).toBe('广州东汇食品有限公司')
    })

    it('unit_name 被填成占位名时同样跳过', () => {
      addSet(db, 's1', 'zw06广州东汇食品有限公司20260827')
      setParam(db, 's1', 'unit_name', 'xx公司')
      setParam(db, 's1', ACD_UNIT_NAME_PARAM, '广州东汇食品有限公司')

      expect(resolveReportUnitName(db as never, 's1')).toBe('广州东汇食品有限公司')
    })

    it('账套不存在时返回空串而不是抛错', () => {
      expect(resolveReportUnitName(db as never, 'missing')).toBe('')
    })
  })
})
