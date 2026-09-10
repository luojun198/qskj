import { describe, it, expect } from 'vitest'
import { pinDesignedPanelElements } from '@/utils/printTemplateHiprint'

const panelOf = (els: unknown[]) => ({ panels: [{ index: 0, printElements: els }] })
const el = (type: string, extra: Record<string, unknown> = {}) => ({
  options: { left: 10, top: 20, ...extra },
  printElementType: { type },
})

describe('pinDesignedPanelElements', () => {
  it('给文本元素补 fixed，保证打印时使用设计坐标', () => {
    const out: any = pinDesignedPanelElements(panelOf([el('text')]))
    expect(out.panels[0].printElements[0].options.fixed).toBe(true)
    expect(out.panels[0].printElements[0].options.top).toBe(20)
  })

  it('表格与整页 HTML 不钉死（需要按行数增高、分页）', () => {
    const out: any = pinDesignedPanelElements(panelOf([el('table'), el('html')]))
    expect(out.panels[0].printElements[0].options.fixed).toBeUndefined()
    expect(out.panels[0].printElements[1].options.fixed).toBeUndefined()
  })

  it('不修改入参（避免污染设计器里正在编辑的 JSON）', () => {
    const src = panelOf([el('text')])
    pinDesignedPanelElements(src)
    expect((src.panels[0].printElements[0] as any).options.fixed).toBeUndefined()
  })

  it('非法/空模板原样返回', () => {
    expect(pinDesignedPanelElements(null)).toBeNull()
    expect(pinDesignedPanelElements({} as any)).toEqual({})
  })
})
