/**
 * 第六份反馈：单据类页面的列表、编辑、查看都要有「另存」。
 * 新增单据页 / 单据列表时把文件名加进清单；漏加另存按钮，这里会报错。
 */
import { describe, it, expect } from 'vitest'

const sources = import.meta.glob('../*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** 单据编辑 / 查看页：须用单据模式另存（整张单据：表头 + 明细） */
const DOC_PAGES = [
  'DocForm', 'StatementForm', 'OrderChangeForm', 'PlanChangeForm', 'MrpForm',
  'ProductionPlanForm', 'QcForm', 'WipCountForm', 'BomForm', 'WorkReportForm',
]
/** 单据列表 */
const DOC_LISTS = ['DocList', 'StatementList', 'OrderChangeList', 'PlanChangeList', 'ProductionPlan', 'QcList', 'BomList', 'WorkReport']

const src = (name: string) => sources[`../${name}.vue`] ?? ''

describe('单据类页面另存覆盖', () => {
  it.each(DOC_PAGES)('%s 编辑 / 查看页有单据另存', name => {
    expect(src(name), `${name}.vue 不存在`).not.toBe('')
    expect(/<SaveAsButton\b[^>]*\bdoc\b/.test(src(name)) || /exportDocPage|另存/.test(src(name))).toBe(true)
  })

  it.each(DOC_LISTS)('%s 列表有另存', name => {
    expect(src(name), `${name}.vue 不存在`).not.toBe('')
    expect(/<SaveAsButton\b|另存/.test(src(name))).toBe(true)
  })
})
