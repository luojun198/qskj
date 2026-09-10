import { describe, expect, it } from 'vitest'
import {
  formatStandardTemplateLabel,
  formatStandardTemplateMeta,
  groupStandardTemplates,
  pickDefaultStandardTemplate,
  STANDARD_TEMPLATE_FALLBACK_GROUP,
  type StandardTemplateItem,
} from '../standardTemplateGroups'

const templates: StandardTemplateItem[] = [
  { id: 'rh10', name: '事业单位会计准则(2019年停用)', description: '', group: '已停用旧准则', retired: true, order: 5 },
  { id: 'rh02', name: '企业会计准则（4-2-2）', description: '', group: '企业会计准则', order: 1 },
  { id: '新企业会计准则', name: '企业会计准则（4-3-3）', description: '', group: '企业会计准则', order: 0 },
  { id: 'rh47', name: '政府会计制度（中小学校）', description: '', group: '行政事业与公共部门', order: 3 },
  { id: 'legacy', name: '自定义目录', description: '' },
]

describe('groupStandardTemplates', () => {
  it('按后端分组顺序整理，组内按 order 排序，停用分组放末尾', () => {
    const grouped = groupStandardTemplates(templates, ['企业会计准则', '行政事业与公共部门', '已停用旧准则'])
    expect(grouped.map(g => g.group)).toEqual([
      '企业会计准则',
      '行政事业与公共部门',
      STANDARD_TEMPLATE_FALLBACK_GROUP,
      '已停用旧准则',
    ])
    expect(grouped[0].items.map(i => i.id)).toEqual(['新企业会计准则', 'rh02'])
    expect(grouped[0].retired).toBe(false)
    expect(grouped[3].retired).toBe(true)
  })

  it('后端未给 groups 时按首次出现顺序分组', () => {
    const grouped = groupStandardTemplates(templates)
    expect(grouped.map(g => g.group)).toEqual([
      '企业会计准则',
      '行政事业与公共部门',
      STANDARD_TEMPLATE_FALLBACK_GROUP,
      '已停用旧准则',
    ])
  })

  it('默认选中第一个未停用模板', () => {
    expect(pickDefaultStandardTemplate(templates)).toBe('rh02')
    expect(pickDefaultStandardTemplate([templates[0]])).toBe('rh10')
    expect(pickDefaultStandardTemplate([])).toBe('')
  })
})

describe('formatStandardTemplateLabel', () => {
  it('有 code 时显示「序号 名称」，没有则只显示名称', () => {
    expect(formatStandardTemplateLabel({ ...templates[1], code: '02' })).toBe('02 企业会计准则（4-2-2）')
    expect(formatStandardTemplateLabel(templates[4])).toBe('自定义目录')
  })
})

describe('formatStandardTemplateMeta', () => {
  it('有 summary 时输出紧凑概况', () => {
    const meta = formatStandardTemplateMeta({
      ...templates[1],
      excelFiles: [{ name: 'a.xlsx' }],
      summary: {
        accounts: 245,
        topLevelAccounts: 60,
        reports: 38,
        codeLengths: [4, 2, 2],
        cashFlowItems: 0,
        transferTypes: 0,
      },
    })
    expect(meta).toBe('245科目 · 38表 · 4-2-2 · Excel1')
  })

  it('没有 summary 时退回 description', () => {
    expect(formatStandardTemplateMeta({ ...templates[1], description: '兜底说明' })).toBe('兜底说明')
  })
})
