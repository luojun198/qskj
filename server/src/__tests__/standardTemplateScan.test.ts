import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  readStandardTemplateCatalog,
  scanStandardTemplatesUncached,
  STANDARD_TEMPLATE_DEFAULT_GROUP,
} from '../services/standardTemplateScan.js'
import { inferAccountingStandardFromTemplateId } from '../services/accountingStandard.js'

let root: string

function writeCatalog(dir: string, content: unknown) {
  writeFileSync(join(dir, 'catalog.json'), JSON.stringify(content), 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'std-tpl-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('标准模版目录 catalog.json', () => {
  it('缺失或损坏的 catalog 退回空目录，不影响目录扫描', () => {
    expect(readStandardTemplateCatalog(root)).toEqual({})
    writeFileSync(join(root, 'catalog.json'), '{ 这不是 json', 'utf8')
    expect(readStandardTemplateCatalog(root)).toEqual({})
  })

  it('按 catalog 顺序登记 dir / acd 两种形态，并追加未登记子目录', () => {
    mkdirSync(join(root, '新企业会计准则'))
    writeFileSync(join(root, '新企业会计准则', 'a.acd'), 'x')
    writeFileSync(join(root, '新企业会计准则', '资产负债表.xlsx'), 'x')
    mkdirSync(join(root, '准则库'))
    writeFileSync(join(root, '准则库', '02-企业会计准则（科目级数4-2-2）.acd'), 'x')
    writeFileSync(join(root, '准则库', '10-事业单位会计准则(2019年停用).acd'), 'x')
    mkdirSync(join(root, '自定义行业'))
    writeFileSync(join(root, '自定义行业', 'custom.acd'), 'x')
    mkdirSync(join(root, '没有acd的目录'))

    writeCatalog(root, {
      groups: ['企业会计准则', '已停用旧准则'],
      templates: [
        { id: 'rh10', code: '10', name: '事业单位会计准则(2019年停用)', group: '已停用旧准则', standard: 'auto', retired: true, acd: '准则库/10-事业单位会计准则(2019年停用).acd' },
        { id: '新企业会计准则', code: '01', name: '企业会计准则（科目级数4-3-3）', group: '企业会计准则', standard: 'enterprise', dir: '新企业会计准则' },
        { id: 'rh02', code: '02', name: '企业会计准则（科目级数4-2-2）', group: '企业会计准则', standard: 'enterprise', acd: '准则库/02-企业会计准则（科目级数4-2-2）.acd' },
        { id: 'missing', name: '文件不存在的登记项', acd: '准则库/none.acd' },
      ],
    })

    const { templates, groups } = scanStandardTemplatesUncached([root])
    expect(templates.map(t => t.id)).toEqual(['rh10', '新企业会计准则', 'rh02', '自定义行业'])
    expect(templates.map(t => t.order)).toEqual([0, 1, 2, 3])
    expect(groups).toEqual(['企业会计准则', '已停用旧准则', STANDARD_TEMPLATE_DEFAULT_GROUP])

    const retired = templates[0]
    expect(retired.retired).toBe(true)
    expect(retired.inferredStandard).toBe('auto')
    expect(retired.code).toBe('10')

    const dirTemplate = templates[1]
    expect(dirTemplate.name).toBe('企业会计准则（科目级数4-3-3）')
    expect(dirTemplate.acdFile).toBe(resolve(root, '新企业会计准则', 'a.acd'))
    expect(dirTemplate.excelFiles.map(f => f.name)).toEqual(['资产负债表'])
    expect(dirTemplate.inferredStandard).toBe('enterprise')

    const fileTemplate = templates[2]
    expect(fileTemplate.excelFiles).toEqual([])
    expect(fileTemplate.acdFile).toBe(resolve(root, '准则库', '02-企业会计准则（科目级数4-2-2）.acd'))

    // 「准则库」目录本身不应被当成模板；未登记目录沿用旧约定
    const legacy = templates[3]
    expect(legacy.group).toBe(STANDARD_TEMPLATE_DEFAULT_GROUP)
    expect(legacy.retired).toBe(false)
    expect(legacy.name).toBe('自定义行业')
  })

  it('catalog 未声明 standard 时按名称推断；声明 custom 视为无效', () => {
    mkdirSync(join(root, '准则库'))
    writeFileSync(join(root, '准则库', 'a.acd'), 'x')
    writeFileSync(join(root, '准则库', 'b.acd'), 'x')
    writeCatalog(root, {
      templates: [
        { id: 'gov', name: '政府会计制度（中小学校）', acd: '准则库/a.acd' },
        { id: 'small', name: '小企业会计准则（科目级数4-2-2）', standard: 'custom', acd: '准则库/b.acd' },
      ],
    })
    const { templates } = scanStandardTemplatesUncached([root])
    expect(templates.find(t => t.id === 'gov')?.inferredStandard).toBe('government')
    expect(templates.find(t => t.id === 'small')?.inferredStandard).toBe('small_business')
  })

  it('多个目录同 ID 只登记一次（部署目录优先）', () => {
    const second = mkdtempSync(join(tmpdir(), 'std-tpl-2-'))
    try {
      for (const dir of [root, second]) {
        mkdirSync(join(dir, '小企业会计准则'))
        writeFileSync(join(dir, '小企业会计准则', 'x.acd'), 'x')
      }
      const { templates } = scanStandardTemplatesUncached([root, second])
      expect(templates).toHaveLength(1)
      expect(templates[0].acdFile.startsWith(root)).toBe(true)
    } finally {
      rmSync(second, { recursive: true, force: true })
    }
  })
})

describe('inferAccountingStandardFromTemplateId', () => {
  it('停用/旧准则不套用现行预设', () => {
    expect(inferAccountingStandardFromTemplateId('企业会计准则(2007年停用)')).toBe('auto')
    expect(inferAccountingStandardFromTemplateId('旧建筑施工企业会计准则')).toBe('auto')
    expect(inferAccountingStandardFromTemplateId('企业会计准则（科目级数4-2-2）')).toBe('enterprise')
    expect(inferAccountingStandardFromTemplateId('政府会计制度（行政事业单位）')).toBe('government')
  })
})
