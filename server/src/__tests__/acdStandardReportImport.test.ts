import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  AcdStandardReportImportError,
  applyTitleMerge,
  fillTableBorders,
  applyCenterAcross,
  estimateColumnWidths,
  estimateRowHeights,
  deduplicateStandardReportCells,
  persistPreparedAcdStandardReports,
  pickTemplateSheet,
  trimDetachedBlocks,
  previewAcdStandardReports,
  type PreparedAcdStandardReport,
} from '../services/acdStandardReportImport.js'

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE account_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE rh_standard_reports (
      id TEXT PRIMARY KEY,
      account_set_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      source_file TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      default_col_width INTEGER DEFAULT 160,
      default_row_height INTEGER DEFAULT 34,
      col_widths TEXT,
      row_heights TEXT,
      UNIQUE(account_set_id, code)
    );
    CREATE TABLE rh_standard_report_cells (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      text_value TEXT,
      formula_text TEXT,
      cell_type TEXT NOT NULL DEFAULT 'text',
      format_text TEXT,
      style_key TEXT,
      side TEXT,
      merge_info TEXT,
      col_width TEXT,
      row_height TEXT,
      updated_at TEXT,
      UNIQUE(report_id, row_index, col_index)
    );
  `)
}

function report(
  code: string,
  name: string,
  value: string,
  sortOrder: number
): PreparedAcdStandardReport {
  return {
    code,
    name,
    sourceFile: `bb${code.padStart(5, '0')}.vts`,
    sortOrder,
    cells: [
      {
        rowIndex: 0,
        colIndex: 0,
        cellType: 'text',
        textValue: value,
        formulaText: null,
      },
    ],
  }
}

describe('ACD 标准报表选择性导入', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    createSchema(db)
    db.prepare('INSERT INTO account_sets (id, name) VALUES (?, ?)').run('as-1', '测试账套')
  })

  it('同位置公式优先于文本并过滤无效坐标', () => {
    const cells = deduplicateStandardReportCells([
      { rowIndex: 1, colIndex: 1, cellType: 'text', textValue: '旧文本', formulaText: null },
      { rowIndex: 1, colIndex: 1, cellType: 'formula', textValue: null, formulaText: '@ye(1001,99)' },
      { rowIndex: -1, colIndex: 0, cellType: 'text', textValue: '无效', formulaText: null },
    ])

    expect(cells).toHaveLength(1)
    expect(cells[0]?.cellType).toBe('formula')
  })

  it('同位置 @ 取数公式优先于 = 表达式', () => {
    // 合计行常常两种写法并存：@JQY 直接取数，或 SUM 上方各行。
    // @ 公式是账务口径的权威来源，重新导入不能把它换成单元格求和。
    const cells = deduplicateStandardReportCells([
      { rowIndex: 2, colIndex: 2, cellType: 'formula', textValue: null, formulaText: '=SUM(C6:C19)' },
      { rowIndex: 2, colIndex: 2, cellType: 'formula', textValue: null, formulaText: '@JQY(6001,97,99)' },
    ])

    expect(cells).toHaveLength(1)
    expect(cells[0]?.formulaText).toBe('@JQY(6001,97,99)')
  })

  it('只更新所选报表并保留原报表 ID，未选报表不变', () => {
    const initial = persistPreparedAcdStandardReports(db, 'as-1', [
      report('1', '资产负债表', '旧资产', 0),
      report('2', '利润表', '旧利润', 1),
    ])
    const oldAssetId = initial.find(item => item.code === '1')?.id
    const oldProfitId = initial.find(item => item.code === '2')?.id

    const updated = persistPreparedAcdStandardReports(
      db,
      'as-1',
      [report('1', '资产负债表（新）', '新资产', 0), report('2', '利润表（新）', '新利润', 1)],
      ['1']
    )

    expect(updated).toEqual([{ id: oldAssetId, code: '1', name: '资产负债表（新）' }])
    const reports = db
      .prepare('SELECT id, code, name FROM rh_standard_reports ORDER BY code')
      .all() as Array<{ id: string; code: string; name: string }>
    expect(reports).toEqual([
      { id: oldAssetId, code: '1', name: '资产负债表（新）' },
      { id: oldProfitId, code: '2', name: '利润表' },
    ])
    const profitCell = db
      .prepare('SELECT text_value FROM rh_standard_report_cells WHERE report_id = ?')
      .get(oldProfitId) as { text_value: string }
    expect(profitCell.text_value).toBe('旧利润')
  })

  it('伪造或重复报表编码被拒绝且不修改原数据', () => {
    persistPreparedAcdStandardReports(db, 'as-1', [report('1', '资产负债表', '原值', 0)])

    expect(() =>
      persistPreparedAcdStandardReports(db, 'as-1', [report('1', '新报表', '新值', 0)], ['9'])
    ).toThrow(AcdStandardReportImportError)
    expect(() =>
      persistPreparedAcdStandardReports(db, 'as-1', [report('1', '新报表', '新值', 0)], ['1', '1'])
    ).toThrow('选择的报表编码不能重复')

    const row = db
      .prepare(
        `SELECT r.name, c.text_value
         FROM rh_standard_reports r
         JOIN rh_standard_report_cells c ON c.report_id = r.id
         WHERE r.account_set_id = ? AND r.code = ?`
      )
      .get('as-1', '1') as { name: string; text_value: string }
    expect(row).toEqual({ name: '资产负债表', text_value: '原值' })
  })

  it('缺少报表目录时返回空预览和明确警告', () => {
    const preview = previewAcdStandardReports(Buffer.from('invalid-acd'))
    expect(preview.reports).toEqual([])
    expect(preview.warnings).toContain('ACD 中缺少 bbml.txt')
  })

  describe('pickTemplateSheet', () => {
    const cell = (formula: string | null) => ({
      rowIndex: 0,
      colIndex: 0,
      cellType: (formula ? 'formula' : 'text') as 'formula' | 'text',
      textValue: formula ? null : '文本',
      formulaText: formula,
    })

    it('第一个 sheet 没有公式时，应改选有公式的 sheet 并标记为 recovered', () => {
      // 还原真实缺陷：「资产负债表（老格式）」的 sheet[0] 是公司名/日期已填死的数据快照版（无公式），
      // 带 @ye()/@NC() 取数公式的模板版排在 sheet[1]，旧实现取第一个会丢掉全部 90 个公式。
      const snapshot = { index: 0, cells: [cell(null), cell(null), cell(null)] }
      const template = { index: 1, cells: [cell('@ye(1001,99)'), cell('@NC(1001)')] }

      expect(pickTemplateSheet([snapshot, template])).toEqual({
        sheet: template,
        recovered: true,
      })
    })

    it('第一个 sheet 已有公式时必须沿用它，即使后面的 sheet 公式更多', () => {
      // parseVtsSheets 的切分并不总是干净，某些 sheet 会把两个版本的报表粘在一起。
      // 无条件改取「公式最多」会给本来正常的报表（如「利润表（季报）」）引入杂质列，
      // 因此第一个 sheet 只要有公式就保持既有行为不变，且不得标记 recovered（否则会被裁孤岛）。
      const first = { index: 0, cells: [cell('@JQY(6001,97,99)')] }
      const merged = { index: 1, cells: [cell('@JQD(6001,97,99)'), cell('@JQJ(6401,97,99)'), cell(null)] }

      expect(pickTemplateSheet([first, merged])).toEqual({ sheet: first, recovered: false })
    })

    it('快照版只有 = 公式时不得压过带 @ 取数公式的模板版', () => {
      // 编译公式（行次的 =B19+1、合计的 =SUM(...)）在数据快照版里同样存在，
      // 若把「有没有公式」当判据，sheet[0] 会被误认成模板版，导致整列 @ 取数公式丢失。
      const snapshot = { index: 0, cells: [cell('=B19+1'), cell('=SUM(C6:C19)'), cell(null)] }
      const template = { index: 1, cells: [cell('@ye(1001,99)')] }

      expect(pickTemplateSheet([snapshot, template])).toEqual({
        sheet: template,
        recovered: true,
      })
    })

    it('整个 vts 都没有 @ 公式时，退回按公式总数计分', () => {
      // 纯计算表（只有单元格求和、无取数公式）不能因为找不到 @ 公式就被判成空表。
      const blank = { index: 0, cells: [cell(null)] }
      const computed = { index: 1, cells: [cell('=SUM(C6:C19)')] }

      expect(pickTemplateSheet([blank, computed])).toEqual({ sheet: computed, recovered: true })
    })

    it('所有 sheet 都没有公式时返回第一个非空 sheet', () => {
      // 「所有者权益（股东权益）变动表」即属此类，ACD 里本就不含取数公式。
      const first = { index: 0, cells: [cell(null)] }
      const second = { index: 1, cells: [cell(null), cell(null)] }

      expect(pickTemplateSheet([first, second])).toEqual({ sheet: first, recovered: false })
    })

    it('忽略空 sheet；全部为空时返回 undefined', () => {
      const empty = { index: 0, cells: [] }
      const filled = { index: 1, cells: [cell('@ye(1001,99)')] }

      expect(pickTemplateSheet([empty, filled]).sheet).toBe(filled)
      expect(pickTemplateSheet([empty]).sheet).toBeUndefined()
      expect(pickTemplateSheet([]).sheet).toBeUndefined()
    })
  })

  describe('trimDetachedBlocks', () => {
    const at = (rowIndex: number, colIndex: number) => ({
      rowIndex,
      colIndex,
      cellType: 'text' as const,
      textValue: 'x',
      formulaText: null,
    })

    it('裁掉隔着大片空白的孤岛内容', () => {
      // 还原「资产负债表（老格式）」：正文是稠密的一整块（真实报表 42 行 x 8 列，每行每列都有数据），
      // 之后隔着若干空列、空行才出现零星碎片，前端按最大行列推导网格于是被撑到 57x25。
      const body: ReturnType<typeof at>[] = []
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          body.push(at(row, col))
        }
      }
      const island = [at(12, 10), at(14, 12)]

      const kept = trimDetachedBlocks([...body, ...island])

      expect(kept).toEqual(body)
    })

    it('容忍正文内部的单行留白，不误裁', () => {
      // 「企业所得税申报表」正文里就存在单个空行，若阈值取 1 会把后半张表全部砍掉。
      const cells = [at(0, 0), at(1, 0), at(3, 0), at(4, 0), at(6, 0)]

      expect(trimDetachedBlocks(cells)).toEqual(cells)
    })

    it('正文连续的行列一格不动', () => {
      const cells = [at(0, 0), at(0, 1), at(1, 0), at(1, 1), at(2, 0)]

      expect(trimDetachedBlocks(cells)).toEqual(cells)
    })

    it('空输入原样返回', () => {
      expect(trimDetachedBlocks([])).toEqual([])
    })
  })

  describe('标题行合并固化', () => {
    const cell = (rowIndex: number, colIndex: number, text: string | null, formula: string | null = null) => ({
      rowIndex,
      colIndex,
      cellType: (formula ? 'formula' : 'text') as 'formula' | 'text',
      textValue: text,
      formulaText: formula,
    })

    it('标题行（该行仅一格且文字等于报表名）应写入跨列合并与居中样式', () => {
      // 这一步不能省：否则每次重新导入 ACD 都会把迁移固化好的合并冲掉
      const cells = [cell(0, 0, '资 产 负 债 表'), cell(2, 0, '货币资金'), cell(2, 3, null, '@ye(1001,99)')]
      applyTitleMerge(cells, '资产负债表')

      expect(JSON.parse(cells[0].mergeInfo!)).toEqual({ rowSpan: 1, colSpan: 4 })
      expect(cells[0].styleKey).toBe('align-center font-size-18 font-bold')
      expect(cells[1].mergeInfo).toBeUndefined()
    })

    it('文字与报表名对不上时不合并（如「资产负债表（老格式）」）', () => {
      const cells = [cell(0, 0, '资产负债表'), cell(1, 0, '资产'), cell(1, 1, '行次')]
      applyTitleMerge(cells, '资产负债表（老格式）')

      expect(cells[0].mergeInfo).toBeUndefined()
    })

    it('该行不止一格时不认作标题行', () => {
      const cells = [cell(0, 0, '资产负债表'), cell(0, 1, '会企01表')]
      applyTitleMerge(cells, '资产负债表')

      expect(cells[0].mergeInfo).toBeUndefined()
    })
  })

  describe('表格空白格补边框', () => {
    const cell = (rowIndex: number, colIndex: number, text: string | null, styleKey: string | null = null) => ({
      rowIndex,
      colIndex,
      cellType: 'text' as const,
      textValue: text,
      formulaText: null,
      styleKey,
    })

    it('补齐表格区域内缺失的位置——vts 不存空白格，不补就到处是断口', () => {
      // 还原「利润表（季报）」的实际形态：行次列(col=1)正文没有单元格记录
      const cells = [
        cell(0, 0, '利润表'),                        // 标题，无边框
        cell(1, 0, '项目', 'border-all'),
        cell(1, 1, '行次', 'border-all'),
        cell(1, 2, '本期金额', 'border-all'),
        cell(2, 0, '营业收入', 'border-all'),
        cell(2, 2, '100', 'border-all'),             // col=1 缺失
        cell(3, 0, '营业成本', 'border-all'),        // col=1、2 都缺失
      ]

      const filled = fillTableBorders(cells)

      const at = (r: number, c: number) => filled.find(x => x.rowIndex === r && x.colIndex === c)
      expect(at(2, 1)?.styleKey).toBe('border-all')
      expect(at(3, 1)?.styleKey).toBe('border-all')
      expect(at(3, 2)?.styleKey).toBe('border-all')
      // 补的是空格子，不能凭空造内容
      expect(at(3, 2)?.textValue).toBeNull()
      // 标题行在带框区域之外，保持原样不补
      expect(at(0, 1)).toBeUndefined()
      expect(at(0, 0)?.styleKey).toBeNull()
    })

    it('区域内已有格子若没边框，补上边框并保留原有样式', () => {
      const cells = [
        cell(0, 0, '项目', 'border-all'),
        cell(0, 1, '金额', 'border-all'),
        cell(1, 0, '收入', 'border-all'),
        cell(1, 1, '100', 'align-right'), // 同列有框，这一格漏了
      ]

      const filled = fillTableBorders(cells)
      const kept = filled.find(x => x.rowIndex === 1 && x.colIndex === 1)
      expect(kept?.styleKey).toBe('align-right border-all')
      expect(kept?.textValue).toBe('100')
    })

    it('已经设过单边框的格子不改成全边框', () => {
      const cells = [
        cell(0, 0, '项目', 'border-all'),
        cell(0, 1, '金额', 'align-right border-bottom'),
        cell(1, 0, '收入', 'border-all'),
        cell(1, 1, '100', 'border-all'),
      ]

      const filled = fillTableBorders(cells)
      expect(filled.find(x => x.rowIndex === 0 && x.colIndex === 1)?.styleKey).toBe('align-right border-bottom')
    })

    it('远处另一版报表的残留不会被算进表格范围', () => {
      const cells = [
        cell(0, 0, '项目', 'border-all'),
        cell(0, 1, '金额', 'border-all'),
        cell(0, 20, '另一版', 'border-all'),  // 中间隔着大片空列
      ]

      const filled = fillTableBorders(cells)
      // 只补到 col=1 为止，不会把 2~19 列全铺上
      expect(filled.filter(x => x.colIndex >= 2 && x.colIndex < 20)).toHaveLength(0)
    })

    it('没有任何边框信息时原样返回', () => {
      const cells = [cell(0, 0, '文字'), cell(1, 0, '文字2')]
      expect(fillTableBorders(cells)).toEqual(cells)
    })
  })

  describe('跨列居中换算成合并', () => {
    const cell = (rowIndex: number, colIndex: number, text: string | null, opts: Record<string, unknown> = {}) => ({
      rowIndex,
      colIndex,
      cellType: 'text' as const,
      textValue: text,
      formulaText: null,
      styleKey: 'border-all',
      ...opts,
    })

    /** 表格主体（经 fillTableBorders 后每格都带边框），共 width 列 */
    const body = (row: number, width: number) =>
      Array.from({ length: width }, (_, col) => cell(row, col, null))

    it('标题跨到表格右边界——老报表用「跨列居中」而非合并单元格实现跨列标题', () => {
      const title = cell(0, 0, '资 产 负 债 表', { styleKey: 'align-center', centerAcross: true })
      const cells = [title, ...body(1, 4), ...body(2, 4)]

      applyCenterAcross(cells)

      expect(JSON.parse(title.mergeInfo as string)).toEqual({ rowSpan: 1, colSpan: 4 })
    })

    it('跨到该行下一个有内容的格子之前', () => {
      const head = cell(0, 0, '本季数', { centerAcross: true })
      const next = cell(0, 3, '本年累计数')
      const cells = [head, cell(0, 1, null), cell(0, 2, null), next, ...body(1, 6)]

      applyCenterAcross(cells)
      expect(JSON.parse(head.mergeInfo as string).colSpan).toBe(3)
    })

    it('补边框造出来的空格子不算内容，不会挡住跨列', () => {
      const title = cell(0, 0, '利 润 表', { centerAcross: true })
      const cells = [
        title,
        cell(0, 1, null), // 补边框造出来的空格
        cell(0, 2, null),
        ...body(1, 3),
        ...body(2, 3),
      ]

      applyCenterAcross(cells)
      expect(JSON.parse(title.mergeInfo as string).colSpan).toBe(3)
    })

    it('已有合并的不覆盖', () => {
      const title = cell(0, 0, '标题', {
        centerAcross: true,
        mergeInfo: JSON.stringify({ rowSpan: 2, colSpan: 2 }),
      })
      const cells = [title, ...body(1, 4)]

      applyCenterAcross(cells)
      expect(JSON.parse(title.mergeInfo as string)).toEqual({ rowSpan: 2, colSpan: 2 })
    })
  })

  describe('列宽估算', () => {
    const cell = (rowIndex: number, colIndex: number, text: string | null) => ({
      rowIndex,
      colIndex,
      cellType: 'text' as const,
      textValue: text,
      formulaText: null,
      styleKey: 'border-all',
    })

    it('长文本列更宽、短文本列更窄', () => {
      const widths = estimateColumnWidths([
        cell(0, 0, '一、营业收入（本年累计数）'),
        cell(0, 1, '行次'),
      ])

      expect(widths[0]).toBeGreaterThan(widths[1])
      expect(widths[1]).toBeGreaterThanOrEqual(60)
    })

    it('公式不参与估宽——@JQY(6001,97,99) 比取数结果长得多', () => {
      const withFormula = estimateColumnWidths([
        { ...cell(0, 0, null), formulaText: '@JQY(6001,97,99)+JQY(6051,97,99)' },
      ])
      expect(withFormula[0]).toBe(60)
    })

    it('列宽有上下限', () => {
      const widths = estimateColumnWidths([cell(0, 0, 'x'.repeat(200))])
      expect(widths[0]).toBeLessThanOrEqual(360)
    })
  })

  describe('行高推算', () => {
    const cell = (rowIndex: number, colIndex: number, styleKey: string | null) => ({
      rowIndex,
      colIndex,
      cellType: 'text' as const,
      textValue: 'x',
      formulaText: null,
      styleKey,
    })

    it('行高跟着该行最大字号走——标题 32px 的字挤在 24px 行里会被截断', () => {
      const heights = estimateRowHeights([
        cell(0, 0, 'font-size-32 font-bold'),
        cell(1, 0, 'font-size-13'),
      ])

      expect(heights[0]).toBeGreaterThan(heights[1])
      expect(heights[0]).toBe(51) // 32 * 1.6
    })

    it('没有字号信息时用默认行高', () => {
      expect(estimateRowHeights([cell(0, 0, 'border-all')])[0]).toBe(24)
    })

    it('取该行最大字号，不是第一个', () => {
      const heights = estimateRowHeights([
        cell(0, 0, 'font-size-13'),
        cell(0, 1, 'font-size-26'),
      ])
      expect(heights[0]).toBe(42) // 26 * 1.6
    })

    it('行高有上下限', () => {
      expect(estimateRowHeights([cell(0, 0, 'font-size-200')])[0]).toBeLessThanOrEqual(96)
      expect(estimateRowHeights([cell(0, 0, 'font-size-6')])[0]).toBeGreaterThanOrEqual(24)
    })
  })

  describe('标题样式不覆盖还原出来的字号', () => {
    it('字体表已给出字号时，只补居中，不套用兜底的 18px', () => {
      const cells = [
        {
          rowIndex: 0,
          colIndex: 0,
          cellType: 'text' as const,
          textValue: '资 产 负 债 表',
          formulaText: null,
          styleKey: 'font-size-32 font-bold font-family-SimSun',
        },
        {
          rowIndex: 1,
          colIndex: 3,
          cellType: 'text' as const,
          textValue: 'x',
          formulaText: null,
          styleKey: 'border-all',
        },
      ]

      applyTitleMerge(cells, '资产负债表')

      // 真实字号 32px 必须保留，不能被 TITLE_STYLE_KEY 的 18px 顶掉
      expect(cells[0].styleKey).toContain('font-size-32')
      expect(cells[0].styleKey).toContain('align-center')
      expect(cells[0].styleKey).not.toContain('font-size-18')
    })

    it('没有字号信息时才用兜底的居中放大', () => {
      const cells = [
        {
          rowIndex: 0,
          colIndex: 0,
          cellType: 'text' as const,
          textValue: '资产负债表',
          formulaText: null,
          styleKey: null as string | null,
        },
        {
          rowIndex: 1,
          colIndex: 3,
          cellType: 'text' as const,
          textValue: 'x',
          formulaText: null,
          styleKey: 'border-all',
        },
      ]

      applyTitleMerge(cells, '资产负债表')
      expect(cells[0].styleKey).toContain('font-size-18')
    })
  })
})
