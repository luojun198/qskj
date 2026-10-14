import { exportStyledTable, type ExportColumnDef } from './exportStyledExcel'

/**
 * 「另存」通用实现：按 el-table 当前渲染的内容导出 Excel（所见即所得）。
 *
 * 适用于数据已全部在前端、列里有大量插槽渲染的列表 / 报表页（固定资产报表、领用归还、出纳汇总表等），
 * 免得每页再手写一份列定义。读取的是 DOM：
 * - 表头取叶子列（多级表头只取最底层，父级标题拼成「父-子」）；
 * - 跳过勾选列、序号以外的空标题列以及「操作」列；
 * - 数字（含千分位、负号、括号负数）按金额 / 数值写入，便于在 Excel 里继续求和；
 * - 表尾合计行（show-summary）一并导出。
 * 分页列表只导出当前页，需要全量的页面（如进销存单据列表）请单独取数后调用 exportStyledTable。
 */

type TableLike = { $el?: HTMLElement } | HTMLElement | null | undefined

const SKIP_LABELS = new Set(['操作', '操 作'])

function tableRoot(table: TableLike): HTMLElement | null {
  if (!table) return null
  if (table instanceof HTMLElement) return table
  return (table.$el as HTMLElement) || null
}

function cellText(cell: Element): string {
  const el = cell.querySelector('.cell') || cell
  // 输入框 / 下拉等可编辑单元格取当前值
  const input = el.querySelector('input, textarea') as HTMLInputElement | null
  if (input && !el.textContent?.trim()) return input.value || ''
  return (el.textContent || '').replace(/\s+/g, ' ').trim()
}

const NUMBER_RE = /^[-−]?[¥￥$]?\s*[-−]?\d{1,3}(,\d{3})*(\.\d+)?$|^[-−]?[¥￥$]?\s*\d+(\.\d+)?$|^\([¥￥$]?\d{1,3}(,\d{3})*(\.\d+)?\)$/

/** 把显示文本转成数值；不是数字返回 null（编码类如 1001、0001 保持文本，见 isCodeLike） */
function parseNumber(text: string): number | null {
  const t = text.trim()
  if (!t || !NUMBER_RE.test(t)) return null
  const negative = t.startsWith('(') || t.startsWith('-') || t.startsWith('−')
  const n = Number(t.replace(/[()¥￥$,\s\-−]/g, ''))
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function isCodeLike(label: string) {
  return /编码|代码|编号|单号|凭证号|号码|账号|科目|卡片|序列|批次|电话|手机|税号|日期|期间|年|月/.test(label)
}

interface LeafHeader {
  label: string
  colClass: string
  numeric: boolean
}

function readLeafHeaders(root: HTMLElement): LeafHeader[] {
  const headerTable = root.querySelector('.el-table__header-wrapper table, table.el-table__header')
  if (!headerTable) return []
  const rows = Array.from(headerTable.querySelectorAll('thead tr'))
  if (rows.length === 0) return []
  // 把多级表头展开成网格：grid[r][c] = 占据该格的 th
  const grid: Element[][] = rows.map(() => [])
  rows.forEach((tr, r) => {
    let c = 0
    Array.from(tr.children).forEach(th => {
      while (grid[r][c]) c++
      const colspan = Math.max(1, (th as HTMLTableCellElement).colSpan || 1)
      const rowspan = Math.max(1, (th as HTMLTableCellElement).rowSpan || 1)
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < colspan; dc++) grid[r + dr][c + dc] = th
      }
      c += colspan
    })
  })
  const last = grid[grid.length - 1]
  return last
    .map((leafTh, c) => {
      const parts: string[] = []
      for (let r = 0; r < grid.length; r++) {
        const th = grid[r][c]
        if (!th) continue
        const text = cellText(th)
        if (text && !parts.includes(text)) parts.push(text)
      }
      const colClass = Array.from(leafTh?.classList || []).find(x => /^el-table_\d+_column_\d+$/.test(x)) || ''
      return { label: parts.join('-'), colClass, numeric: false }
    })
    // el-table 表头末尾有一个滚动条占位列 gutter
    .filter((h, c) => !last[c]?.classList.contains('gutter') && !(last[c] as HTMLElement)?.classList.contains('el-table__cell--gutter'))
}

export interface ExportElTableOptions {
  fileName: string
  title?: string
  subtitle?: string
  sheetName?: string
}

export interface ElTableData {
  /** 保留下来的列（已去掉勾选 / 操作 / 全空列） */
  columns: Array<{ label: string; numeric: boolean; amount: boolean }>
  /** 行：数值列已转成 number，其余为文本 */
  rows: Array<Array<string | number>>
  /** 表尾合计行（show-summary），没有为 null */
  summary: Array<string | number> | null
}

const toCellValue = (text: string, numeric: boolean): string | number => {
  if (!numeric) return text
  const n = parseNumber(text)
  return n === null ? text : n
}

/** 读取 el-table 当前渲染的表头、数据行与合计行；没有数据行返回 null */
export function readElTable(table: TableLike): ElTableData | null {
  const root = tableRoot(table)
  if (!root) return null
  const headers = readLeafHeaders(root)
  const bodyRows = Array.from(root.querySelectorAll('.el-table__body-wrapper tbody > tr')).filter(
    tr => tr.classList.contains('el-table__row') || tr.querySelector('td.el-table__cell')
  )
  if (bodyRows.length === 0) return null

  const readRow = (tr: Element): string[] => {
    const cells = Array.from(tr.children) as HTMLTableCellElement[]
    const out: string[] = new Array(headers.length).fill('')
    // 优先按列 class 对齐（兼容 span-method 合并后缺格），对不上再按位置
    let pos = 0
    for (const td of cells) {
      const cls = Array.from(td.classList).find(x => /^el-table_\d+_column_\d+$/.test(x))
      let idx = cls ? headers.findIndex(h => h.colClass === cls) : -1
      if (idx < 0) idx = pos
      if (idx < headers.length) out[idx] = cellText(td)
      pos = idx + Math.max(1, td.colSpan || 1)
    }
    return out
  }

  const matrix = bodyRows.map(readRow)
  const footerTr = root.querySelector('.el-table__footer-wrapper tbody > tr, .el-table__footer tbody > tr')
  const footer = footerTr ? readRow(footerTr) : null

  // 需要保留的列：去掉勾选 / 展开 / 操作 / 全空标题列
  const keep = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => {
      const th = h.colClass ? root.querySelector(`th.${h.colClass}`) : null
      if (th && (th.querySelector('.el-checkbox') || th.classList.contains('el-table-column--selection'))) return false
      if (SKIP_LABELS.has(h.label.replace(/\s+/g, ' '))) return false
      if (!h.label && matrix.every(row => !row[i])) return false
      if (th?.classList.contains('el-table__expand-column')) return false
      return true
    })

  // 数值列判定：非编码类、且非空单元格全部能解析成数字
  keep.forEach(({ h, i }) => {
    if (isCodeLike(h.label)) return
    const values = matrix.map(row => row[i]).filter(v => v !== '' && v !== '-')
    h.numeric = values.length > 0 && values.every(v => parseNumber(v) !== null)
  })

  return {
    columns: keep.map(({ h, i }) => ({
      label: h.label || ' ',
      numeric: h.numeric,
      amount: h.numeric && matrix.some(row => /\.\d{2}$/.test(row[i] || '')),
    })),
    rows: matrix.map(row => keep.map(({ h, i }) => toCellValue(row[i] ?? '', h.numeric))),
    summary: footer ? keep.map(({ h, i }, k) => (k === 0 && !footer[i] ? '合计' : toCellValue(footer[i] || '', h.numeric))) : null,
  }
}

/** 导出 el-table 当前渲染内容；没有数据时返回 false */
export async function exportElTable(table: TableLike, options: ExportElTableOptions): Promise<boolean> {
  const data = readElTable(table)
  if (!data) return false
  const columns: ExportColumnDef<Array<string | number>>[] = data.columns.map((c, k) => ({
    label: c.label,
    align: c.numeric ? 'right' : 'left',
    type: c.numeric ? (c.amount ? 'amount' : 'number') : 'text',
    value: (row: Array<string | number>) => row[k],
  }))

  await exportStyledTable<Array<string | number>>({
    fileName: options.fileName.endsWith('.xlsx') ? options.fileName : `${options.fileName}.xlsx`,
    sheetName: options.sheetName || (options.title || 'Sheet1').slice(0, 30),
    title: options.title,
    subtitle: options.subtitle,
    columns,
    rows: data.rows,
    summaryValues: data.summary ? data.summary.map((v, k) => (k === 0 ? '合计' : v)) : undefined,
  })
  return true
}

/** 文件名里的日期戳 */
export function exportDateStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
