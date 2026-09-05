import { describe, expect, it } from 'vitest'

import {
  EXCEL_FUNCTION_NAMES,
  FormulaError,
  collectCellRefs,
  evaluateFormula,
  expandRange,
  isAnchorFunction,
} from '../services/reportFormula.js'

/** 用一张小表当取值源；未列出的地址视为空单元格 */
function sheet(values: Record<string, number | string | boolean>) {
  return {
    getCell: (address: string) => values[address],
    callAnchor: (name: string, rawArgs: string[]) => {
      // 取数函数在这里只回显参数，用来验证参数是**原文**而不是求值结果
      anchorCalls.push(`${name}(${rawArgs.join('|')})`)
      return 100
    },
  }
}

let anchorCalls: string[] = []

function evaluate(formula: string, values: Record<string, number | string | boolean> = {}) {
  anchorCalls = []
  return evaluateFormula(formula, sheet(values), isAnchorFunction)
}

describe('reportFormula', () => {
  describe('四则运算与运算符', () => {
    it('加减乘除与优先级', () => {
      expect(evaluate('=1+2*3')).toBe(7)
      expect(evaluate('=(1+2)*3')).toBe(9)
      expect(evaluate('=10-4-3')).toBe(3)
      expect(evaluate('=10/4')).toBe(2.5)
    })

    it('乘方右结合、一元负号、百分号', () => {
      expect(evaluate('=2^3^2')).toBe(512)
      expect(evaluate('=-2^2')).toBe(4) // 一元负号先于乘方绑定，与 Excel 一致
      expect(evaluate('=50%')).toBe(0.5)
      expect(evaluate('=200*10%')).toBe(20)
    })

    it('除以 0 报 #DIV/0! 而不是给个 Infinity', () => {
      expect(() => evaluate('=1/0')).toThrowError(FormulaError)
      try {
        evaluate('=1/0')
      } catch (error) {
        expect((error as FormulaError).code).toBe('#DIV/0!')
      }
    })

    it('比较运算与文本连接', () => {
      expect(evaluate('=1>0')).toBe(true)
      expect(evaluate('=2<>2')).toBe(false)
      expect(evaluate('="甲"&"乙"')).toBe('甲乙')
    })
  })

  describe('单元格引用', () => {
    it('引用取值，空单元格按 0 参与运算', () => {
      expect(evaluate('=A1+B1', { A1: 10, B1: 5 })).toBe(15)
      expect(evaluate('=A1+B1', { A1: 10 })).toBe(10)
    })

    it('支持 $ 绝对引用写法', () => {
      expect(evaluate('=$A$1*2', { A1: 6 })).toBe(12)
    })

    it('区域求和，起止顺序颠倒也能算', () => {
      const values = { A1: 1, A2: 2, A3: 3 }
      expect(evaluate('=SUM(A1:A3)', values)).toBe(6)
      expect(evaluate('=SUM(A3:A1)', values)).toBe(6)
    })

    it('区域不能直接参与四则运算', () => {
      expect(() => evaluate('=A1:A3+1', { A1: 1 })).toThrowError(FormulaError)
    })
  })

  describe('函数', () => {
    const values = { A1: 1, A2: 2, A3: 3, A4: 4, B1: '文本' }

    it('SUM 支持区域、单值与混合参数', () => {
      expect(evaluate('=SUM(A1:A4)', values)).toBe(10)
      expect(evaluate('=SUM(A1,A2,10)', values)).toBe(13)
      expect(evaluate('=SUM(A1:A2,A4)', values)).toBe(7)
    })

    it('函数可以嵌套 —— 旧实现的单趟正则做不到', () => {
      expect(evaluate('=ROUND(SUM(A1:A4)/3,2)', values)).toBe(3.33)
      expect(evaluate('=MAX(SUM(A1:A2),SUM(A3:A4))', values)).toBe(7)
      expect(evaluate('=ABS(MIN(A1:A4)-10)', values)).toBe(9)
    })

    it('统计类函数跳过区域里的文本与空格', () => {
      expect(evaluate('=COUNT(A1:B1)', values)).toBe(1)
      expect(evaluate('=COUNTA(A1:B1)', values)).toBe(2)
      expect(evaluate('=AVERAGE(A1:A4)', values)).toBe(2.5)
      expect(evaluate('=MAX(A1:A4)', values)).toBe(4)
      expect(evaluate('=MIN(A1:A4)', values)).toBe(1)
    })

    it('ROUND 家族按位数取舍', () => {
      expect(evaluate('=ROUND(2.345,2)')).toBe(2.35)
      expect(evaluate('=ROUND(-2.345,2)')).toBe(-2.35)
      expect(evaluate('=ROUNDUP(2.341,2)')).toBe(2.35)
      expect(evaluate('=ROUNDDOWN(2.349,2)')).toBe(2.34)
      expect(evaluate('=ROUND(2.6)')).toBe(3)
      expect(evaluate('=INT(2.9)')).toBe(2)
    })

    it('IF 惰性求值：不该走的分支不参与计算', () => {
      // B1=0 时若急切求值，D1/B1 会先炸出 #DIV/0!
      expect(evaluate('=IF(B1>0,D1/B1,0)', { B1: 0, D1: 5 })).toBe(0)
      expect(evaluate('=IF(B1>0,D1/B1,0)', { B1: 2, D1: 5 })).toBe(2.5)
      expect(evaluate('=IF(A1>0,"有","无")', { A1: 1 })).toBe('有')
    })

    it('IFERROR 兜住错误分支', () => {
      expect(evaluate('=IFERROR(1/0,"-")')).toBe('-')
      expect(evaluate('=IFERROR(10/2,"-")')).toBe(5)
    })

    it('AND / OR / NOT', () => {
      expect(evaluate('=AND(1>0,2>1)')).toBe(true)
      expect(evaluate('=OR(1>2,2>1)')).toBe(true)
      expect(evaluate('=NOT(1>0)')).toBe(false)
    })

    it('SUMIF / COUNTIF 支持比较式条件', () => {
      const data = { A1: 10, A2: -5, A3: 20 }
      expect(evaluate('=SUMIF(A1:A3,">0")', data)).toBe(30)
      expect(evaluate('=COUNTIF(A1:A3,">0")', data)).toBe(2)
      expect(evaluate('=COUNTIF(A1:A3,"<>10")', data)).toBe(2)
    })

    it('未知函数报 #NAME?', () => {
      try {
        evaluate('=VLOOKUP(A1,A1:A3,2)')
        throw new Error('应当抛错')
      } catch (error) {
        expect((error as FormulaError).code).toBe('#NAME?')
      }
    })

    it('参数个数不对时报错', () => {
      expect(() => evaluate('=ROUND()')).toThrowError(FormulaError)
    })
  })

  describe('@ 取数函数', () => {
    it('参数按原文传递，前导零不丢', () => {
      evaluate('=@JQY(6601,01,99)')
      expect(anchorCalls).toEqual(['jqy(6601|01|99)'])
    })

    it('@ 可省略，混写也能识别', () => {
      expect(evaluate('=@YE(1001,99)+YE(1002,99)')).toBe(200)
      expect(anchorCalls).toEqual(['ye(1001|99)', 'ye(1002|99)'])
    })

    it('取数函数可与 Excel 函数、单元格引用混算', () => {
      expect(evaluate('=ROUND(@YE(1001,99)/3,2)+A1', { A1: 1 })).toBe(34.33)
    })

    it('取数函数名单与 Excel 函数名单不重叠', () => {
      const overlap = EXCEL_FUNCTION_NAMES.filter(name => isAnchorFunction(name))
      expect(overlap).toEqual([])
    })
  })

  describe('collectCellRefs（供拓扑排序用）', () => {
    it('区域会展开成逐格地址', () => {
      expect(collectCellRefs('=SUM(A1:A3)').sort()).toEqual(['A1', 'A2', 'A3'])
    })

    it('取数函数的参数不会被当成单元格引用', () => {
      // `@ye(1001,99)` 里没有任何单元格依赖，误判会让拓扑排序凭空多出依赖
      expect(collectCellRefs('=@ye(1001,99)+B5', isAnchorFunction)).toEqual(['B5'])
    })

    it('解析失败时返回空数组而不是抛错', () => {
      expect(collectCellRefs('=SUM(')).toEqual([])
    })
  })

  describe('expandRange', () => {
    it('跨行跨列按行优先展开', () => {
      expect(expandRange('A1', 'B2')).toEqual(['A1', 'B1', 'A2', 'B2'])
    })
  })
})
