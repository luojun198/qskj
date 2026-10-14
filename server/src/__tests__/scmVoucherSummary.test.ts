import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUMMARY_TEMPLATES,
  FALLBACK_SUMMARY_TEMPLATE,
  SAMPLE_SUMMARY_CONTEXT,
  SUMMARY_DOC_TYPES,
  normalizeSummarySettings,
  renderSummary,
  resolveSummaryTemplate,
  type SummaryContext,
} from '../services/scmVoucherSummary.js'

const ctx: SummaryContext = { ...SAMPLE_SUMMARY_CONTEXT }
const empty = { roles: {}, accounts: [] }

describe('renderSummary', () => {
  it('替换占位符；多物料显示「等N种」', () => {
    expect(renderSummary('销售{物料汇总}（{往来单位}）{单号}', ctx))
      .toBe('销售金士顿 16G DDR4 3200等2种（深圳市恒通网络科技有限公司）202610-SO-001')
  })
  it('单物料直接显示名称', () => {
    expect(renderSummary('{物料汇总}', { ...ctx, items: ['内存条'] })).toBe('内存条')
  })
  it('缺值时清掉空括号和多余空格', () => {
    expect(renderSummary('收{往来单位}款（{备注}）{单号}', { ...ctx, remark: '' })).toBe('收深圳市恒通网络科技有限公司款202610-SO-001')
    expect(renderSummary('采购 {物料汇总}  {单号}', { ...ctx, items: [] })).toBe('采购 202610-SO-001')
  })
  it('未知占位符原样去掉；{科目} 取科目名称', () => {
    expect(renderSummary('{科目}{不存在}', ctx, '应收账款')).toBe('应收账款')
  })
})

describe('resolveSummaryTemplate 优先级', () => {
  it('内置默认：按单据类型 + 角色', () => {
    expect(resolveSummaryTemplate(empty, 'SO', 'cost', '6401')).toBe(DEFAULT_SUMMARY_TEMPLATES.SO.cost)
  })
  it('没有配置的类型 / 角色走兜底', () => {
    expect(resolveSummaryTemplate(empty, 'XX', 'ar', '1122')).toBe(FALLBACK_SUMMARY_TEMPLATE)
    expect(resolveSummaryTemplate(empty, 'PI', 'cost', '6401')).toBe(FALLBACK_SUMMARY_TEMPLATE)
  })
  it('自定义角色模板覆盖内置，科目规则优先于角色规则，指定类型优先于通配', () => {
    const s = normalizeSummarySettings({
      roles: { SO: { revenue: '角色模板' } },
      accounts: [
        { doc_type: '', account: '6001001', template: '科目通配' },
        { doc_type: 'SO', account: '6001001', template: '科目+类型' },
      ],
    })
    expect(resolveSummaryTemplate(s, 'SO', 'revenue', '6001002')).toBe('角色模板')
    expect(resolveSummaryTemplate(s, 'SO', 'revenue', '6001001')).toBe('科目+类型')
    expect(resolveSummaryTemplate(s, 'SR', 'revenue', '6001001')).toBe('科目通配')
  })
})

describe('内置预设覆盖', () => {
  it('每个设置页单据类型都有预设，且模板渲染后非空', () => {
    for (const t of SUMMARY_DOC_TYPES) {
      const roles = DEFAULT_SUMMARY_TEMPLATES[t.code]
      expect(roles, t.code).toBeTruthy()
      for (const tpl of Object.values(roles!)) expect(renderSummary(tpl!, ctx), `${t.code} ${tpl}`).not.toBe('')
    }
  })
})

describe('normalizeSummarySettings', () => {
  it('丢弃非法角色 / 空模板 / 空科目，截断超长模板', () => {
    const s = normalizeSummarySettings({
      roles: { SO: { revenue: ' ', bad: 'x', ar: 'a'.repeat(300) } },
      accounts: [{ account: '', template: 'x' }, { account: '1122', template: '' }, { account: '1122', template: 'ok' }],
    })
    expect(Object.keys(s.roles.SO)).toEqual(['ar'])
    expect(s.roles.SO.ar).toHaveLength(200)
    expect(s.accounts).toEqual([{ doc_type: '', account: '1122', template: 'ok' }])
  })
  it('非对象输入得到空设置', () => {
    expect(normalizeSummarySettings(null)).toEqual({ roles: {}, accounts: [] })
  })
})
