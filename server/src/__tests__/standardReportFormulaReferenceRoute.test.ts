import { describe, expect, it } from 'vitest'

import router from '../routes/ledgerStandardReport.js'
import { FORMULA_REFERENCE, EXCEL_FUNCTION_NAMES } from '../services/reportFormula.js'

/**
 * `/formula-reference` 必须注册在 `/:id` **之前**，否则会被那条通配路由吃掉，
 * 前端拿到的会是「报表不存在」而不是函数列表。这类顺序问题跑单测最省事。
 */
function registeredGetPaths() {
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
  return stack
    .filter(layer => layer.route?.methods?.get)
    .map(layer => layer.route!.path)
}

describe('标准报表公式速查接口', () => {
  it('formula-reference 注册在 /:id 之前', () => {
    const paths = registeredGetPaths()
    const referenceIndex = paths.indexOf('/formula-reference')
    const wildcardIndex = paths.indexOf('/:id')

    expect(referenceIndex).toBeGreaterThanOrEqual(0)
    expect(wildcardIndex).toBeGreaterThanOrEqual(0)
    expect(referenceIndex).toBeLessThan(wildcardIndex)
  })

  it('速查表覆盖引擎实际支持的每个 Excel 函数', () => {
    // 加了函数却忘了补说明，用户在 fx 弹层里就看不到
    const documented = new Set(FORMULA_REFERENCE.map(item => item.name.toUpperCase()))
    const missing = EXCEL_FUNCTION_NAMES.filter(name => !documented.has(name))

    expect(missing).toEqual([])
  })

  it('速查表条目字段完整', () => {
    for (const item of FORMULA_REFERENCE) {
      expect(item.group).toBeTruthy()
      expect(item.name).toBeTruthy()
      expect(item.signature).toBeTruthy()
      expect(item.description).toBeTruthy()
    }
  })
})
