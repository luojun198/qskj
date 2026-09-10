/**
 * vue-plugin-hiprint 适配层
 * - 懒加载 hiprint（UMD 重包，含 jQuery/jspdf/html2canvas，不进首屏）
 * - 提供「单 HTML 元素面板」构造，用于把账册/报表的二维表格 HTML 交给 hiprint
 *   统一走预览 / 打印 / 导出 PDF / 套打底图通道。
 */
import type { HiprintPanel } from '@/types/print'
import {
  createVoucherPrintProvider,
  VOUCHER_SUMMARY_FORMATTER_SRC,
} from '@/utils/hiprintVoucherProvider'

type HiprintModule = typeof import('vue-plugin-hiprint')

let hiprintModulePromise: Promise<HiprintModule> | null = null
let initialized = false

/** 懒加载并初始化 hiprint（全局只初始化一次） */
export async function loadHiprint(): Promise<HiprintModule> {
  if (!hiprintModulePromise) {
    hiprintModulePromise = (async () => {
      const mod = await import('vue-plugin-hiprint')
      // 引入设计/打印锁定样式
      await import('vue-plugin-hiprint/dist/print-lock.css')
      if (!initialized) {
        try {
          // 关闭自动 socket 连接，避免本地未装打印服务时反复报错
          mod.hiPrintPlugin?.disAutoConnect?.()
        } catch {
          /* 忽略 */
        }
        mod.hiprint.init({
          providers: [new mod.defaultElementTypeProvider(), createVoucherPrintProvider(mod.hiprint)],
        })
        initialized = true
      }
      return mod
    })()
  }
  return hiprintModulePromise
}

/**
 * mm 转 pt（hiprint 元素坐标/尺寸的单位是 pt：1mm = 72/25.4 pt ≈ 2.8346pt）。
 *
 * hiprint 的 panel.width/height 以 mm 存储，但元素 options 的
 * left/top/width/height 以及 panel 的 paperHeader/paperFooter 都按 pt 使用
 * （displayWidth()/displayLeft() 直接拼 "pt" 后缀，边界检查用 hinnn.mm.toPt
 * 把 panel 宽高也转成 pt 比较）。因此传入这些字段时必须用 pt，否则会被放大约
 * 1.33 倍（96/72），导致内容比纸张可打印区域更宽，打印时右侧溢出、被裁切。
 */
export function mmToPt(mm: number): number {
  return Math.round((mm * 72) / 25.4)
}

export interface BuildHtmlPanelOptions {
  html: string
  /** 纸张：A4 / A5 / 或自定义 mm 宽高 */
  paperType?: string
  widthMm?: number
  heightMm?: number
  /** 纸张方向；横向时交换预设纸张的宽高 */
  orientation?: 'portrait' | 'landscape'
  /** 套打底图 URL */
  background?: string | null
  /** 页边距（mm） */
  marginMm?: number
  /** 四向页边距（mm）；给了就按各边分别处理，未给则沿用 marginMm */
  marginsMm?: { top: number; bottom: number; left: number; right: number }
}

/** hiprint 模板（PrintTemplate 的 template 选项）：含 panels 数组 */
export interface HiprintTemplate {
  panels: HiprintPanel[]
}

/**
 * 构造一个只含单个 html 元素的 hiprint 模板（含 panels 数组，可直接喂给 PrintTemplate）。
 * 账册/报表的二维表格（含合并标题）直接以 HTML 形式注入，1:1 还原现有渲染。
 */
export function buildSingleHtmlPanel(options: BuildHtmlPanelOptions): HiprintTemplate {
  const {
    html,
    paperType = 'A4',
    widthMm,
    heightMm,
    orientation = 'portrait',
    background,
    marginMm = 8,
    marginsMm,
  } = options

  // A4: 210x297mm；A5: 148x210mm；自定义用传入 mm
  const presetWidth: Record<string, number> = { A4: 210, A5: 148, A3: 297 }
  const presetHeight: Record<string, number> = { A4: 297, A5: 210, A3: 420 }
  const baseWidth = widthMm || presetWidth[paperType] || 210
  const baseHeight = heightMm || presetHeight[paperType] || 297
  const shouldSwap = orientation === 'landscape' && baseHeight > baseWidth
  const wMm = shouldSwap ? baseHeight : baseWidth
  const hMm = shouldSwap ? baseWidth : baseHeight

  // 元素坐标/尺寸单位为 pt（hiprint 内部坐标单位）；panel 的 width/height 单位为 mm
  const widthPt = mmToPt(wMm)
  const heightPt = mmToPt(hMm)
  const edgePt = {
    top: mmToPt(marginsMm?.top ?? marginMm),
    bottom: mmToPt(marginsMm?.bottom ?? marginMm),
    left: mmToPt(marginsMm?.left ?? marginMm),
    right: mmToPt(marginsMm?.right ?? marginMm),
  }

  const printElements: unknown[] = []

  // 套打底图：以整页 image 元素铺底（panel.background 仅设计器可见、不打印，故用 image 元素）
  if (background) {
    printElements.push({
      options: {
        left: 0,
        top: 0,
        width: widthPt,
        height: heightPt,
        src: background,
        fit: 'fill',
      },
      printElementType: { title: '底图', type: 'image' },
    })
  }

  printElements.push({
    options: {
      left: edgePt.left,
      top: edgePt.top,
      width: widthPt - edgePt.left - edgePt.right,
      height: heightPt - edgePt.top - edgePt.bottom,
      field: 'content',
      content: html,
      fit: 'auto',
    },
    printElementType: { title: '报表内容', type: 'html' },
  })

  const panel: HiprintPanel = {
    index: 0,
    paperType,
    width: wMm,
    height: hMm,
    paperHeader: edgePt.top,
    paperFooter: heightPt - edgePt.bottom,
    printElements,
    ...(background ? { background } : {}),
  }

  // hiprint PrintTemplate 的 template 选项需要 { panels: [...] }
  return { panels: [panel] }
}

/**
 * hiprint 打印/预览时元素纵坐标并不照搬设计坐标：
 * `BasePrintElement.getBeginPrintTopInPaperByReferenceElement()` 里，只有
 * `isHeaderOrFooter()`（top < paperHeader 或 top >= paperFooter）和 `isFixed()`
 * （options.fixed）的元素用设计 top，其余元素的 top = 上一个元素「实际渲染后的底边」
 * + 设计时的间距。分录表按真实行数撑高后，排在它后面的合计行、制单/审核/记账/主管
 * 就会整体下移，于是「设计器画布」和「示例预览 / 打印」对不上（横向一致、纵向错位）。
 *
 * 套打凭证要的是「所见即所得」：格子位置由纸张决定，不能被数据行数推着走。
 * 因此渲染前把除表格/HTML 之外的元素统一标记 fixed，强制使用设计坐标。
 * 表格自身不能钉死（它要分页、要按行数增高），HTML 元素（账册/报表整页内容）同理。
 */
const FLOWING_ELEMENT_TYPES = new Set(['table', 'html'])

export function pinDesignedPanelElements<T>(template: T): T {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  if (!Array.isArray(panels)) return template
  return {
    ...(template as object),
    panels: panels.map(panel => {
      const p = panel as HiprintPanel
      const els = p?.printElements
      if (!Array.isArray(els)) return panel
      return {
        ...p,
        printElements: els.map(el => {
          const e = el as { options?: Record<string, unknown>; printElementType?: { type?: string } }
          const type = e?.printElementType?.type
          if (!e?.options || (type && FLOWING_ELEMENT_TYPES.has(type))) return el
          return { ...e, options: { ...e.options, fixed: true } }
        }),
      }
    }),
  } as T
}

/**
 * 给表格元素里 `tableSummary === 'sum'` 的列注入合计单元格渲染函数。
 *
 * hiprint 内置的求和用 `Number(cellValue)` 解析，而分录表的金额是带千分位的字符串
 * （'1,000.00'），Number 出来是 NaN，整列合计就废了。VOUCHER_SUMMARY_FORMATTER_SRC
 * 去掉千分位后重新求和并格式化，见其函数注释。
 *
 * 只在渲染前注入、不落库：模板 JSON 里只保存 hiprint 原生的 tableSummary* 配置，
 * 因此**已保存的老模板**（包括用户直接用 hiprint 原生「底部聚合类型」下拉配的）
 * 同样能拿到正确数字。同样不修改入参。
 */
function injectSummaryFormatterInColumns(columns: unknown): unknown {
  if (!Array.isArray(columns)) return columns
  return columns.map(entry => {
    // options.columns 是「每层表头一个数组」的二维结构，递归到叶子列
    if (Array.isArray(entry)) return injectSummaryFormatterInColumns(entry)
    const col = entry as Record<string, unknown> | null
    if (!col || typeof col !== 'object') return entry
    if (Array.isArray((col as { columns?: unknown }).columns)) {
      return { ...col, columns: injectSummaryFormatterInColumns((col as { columns: unknown }).columns) }
    }
    if (col.tableSummary !== 'sum' || col.tableSummaryFormatter) return entry
    return { ...col, tableSummaryFormatter: VOUCHER_SUMMARY_FORMATTER_SRC }
  })
}

export function injectVoucherSummaryFormatter<T>(template: T): T {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  if (!Array.isArray(panels)) return template
  return {
    ...(template as object),
    panels: panels.map(panel => {
      const p = panel as HiprintPanel
      const els = p?.printElements
      if (!Array.isArray(els)) return panel
      return {
        ...p,
        printElements: els.map(el => {
          const e = el as {
            options?: Record<string, unknown>
            printElementType?: { type?: string; columns?: unknown }
          }
          if (e?.printElementType?.type !== 'table') return el
          const next: typeof e = { ...e }
          if (e.options?.columns) {
            next.options = { ...e.options, columns: injectSummaryFormatterInColumns(e.options.columns) }
          }
          // createTableFooter 取的是表头构建阶段派生出来的 rowColumns，两处都写更保险
          if (e.printElementType?.columns) {
            next.printElementType = {
              ...e.printElementType,
              columns: injectSummaryFormatterInColumns(e.printElementType.columns),
            }
          }
          return next
        }),
      }
    }),
  } as T
}

/**
 * 渲染（预览 / 打印 / 导出 PDF）前对面板做的全部归一化处理。
 * 调用方只要记住这一个函数即可，不用逐个记得要调哪几步。
 */
export function normalizePanelForRender<T>(template: T): T {
  return injectVoucherSummaryFormatter(pinDesignedPanelElements(template))
}

/** 把单 HTML 面板需要的打印数据（绑定 field=content） */
export function buildHtmlPrintData(html: string): Record<string, unknown> {
  return { content: html }
}

interface HiprintPdfTemplate {
  toPdf: (
    printData: unknown,
    fileName: string,
    options: { isDownload: false; type: 'blob' }
  ) => PromiseLike<Blob>
}

/**
 * 使用 hiprint 当前真实提供的 toPdf API 生成 PDF Blob。
 * 禁止插件内部直接下载，交由调用方统一处理文件名、成功提示和异常。
 */
export async function renderHiprintPdfBlob(
  template: HiprintPdfTemplate,
  printData: unknown,
  fileName: string
): Promise<Blob> {
  if (!template || typeof template.toPdf !== 'function') {
    throw new Error('当前打印组件不支持导出 PDF')
  }
  const blob = await Promise.resolve(
    template.toPdf(printData, fileName, { isDownload: false, type: 'blob' })
  )
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('PDF 文件生成失败')
  }
  return blob
}

const PAPER_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  A3: [297, 420],
}

export function paperDimensionsMm(
  paperType = 'A4',
  orientation: 'portrait' | 'landscape' = 'portrait'
) {
  const pair = PAPER_MM[paperType] || PAPER_MM.A4
  const landscape = orientation === 'landscape'
  return {
    width: landscape ? pair[1] : pair[0],
    height: landscape ? pair[0] : pair[1],
  }
}

export function wrapRawPrintPaper(
  html: string,
  options: {
    paperType?: string
    orientation?: 'portrait' | 'landscape'
    marginsMm?: { top: number; bottom: number; left: number; right: number }
  } = {}
) {
  const dim = paperDimensionsMm(options.paperType, options.orientation)
  const margin = options.marginsMm || { top: 8, bottom: 8, left: 8, right: 8 }
  return (
    `<div class="cw-raw-paper" style="width:${dim.width}mm;min-height:${dim.height}mm;` +
    `padding:${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm;` +
    `background:#fff;box-sizing:border-box;">${html}</div>`
  )
}

/** 不经 hiprint 拆表，直接把 HTML 送给浏览器打印 */
export function printRawHtml(
  html: string,
  options: {
    paperType?: string
    orientation?: 'portrait' | 'landscape'
    marginsMm?: { top: number; bottom: number; left: number; right: number }
    title?: string
  } = {}
) {
  const dim = paperDimensionsMm(options.paperType, options.orientation)
  const margin = options.marginsMm || { top: 8, bottom: 8, left: 8, right: 8 }
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    throw new Error('无法创建打印窗口')
  }
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${options.title || '打印'}</title>
<style>
@page { size: ${dim.width}mm ${dim.height}mm; margin: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm; }
html, body { margin: 0; padding: 0; background: #fff; }
</style></head><body>${html}</body></html>`)
  doc.close()
  const win = iframe.contentWindow
  if (!win) {
    iframe.remove()
    throw new Error('无法创建打印窗口')
  }
  const cleanup = () => iframe.remove()
  win.addEventListener('afterprint', cleanup)
  window.setTimeout(() => {
    win.focus()
    win.print()
    window.setTimeout(cleanup, 3000)
  }, 50)
}

/** 把预览纸面截成 PDF，避免 hiprint 再解析表格把网格拆掉 */
export async function renderElementToPdfBlob(
  element: HTMLElement,
  dim: { width: number; height: number }
): Promise<Blob> {
  const html2canvasMod = await import('@wtto00/html2canvas')
  const html2canvas =
    (html2canvasMod as { default?: (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement> })
      .default || (html2canvasMod as unknown as (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>)
  const jspdfMod = (await import('jspdf')) as { jsPDF?: new (opts: Record<string, unknown>) => any; default?: { jsPDF?: new (opts: Record<string, unknown>) => any } }
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default?.jsPDF
  if (!html2canvas || !JsPDF) throw new Error('当前环境不支持导出 PDF')

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
  })
  const pdf = new JsPDF({
    orientation: dim.width > dim.height ? 'l' : 'p',
    unit: 'mm',
    format: [dim.width, dim.height],
  })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH)
  const blob = pdf.output('blob')
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('PDF 文件生成失败')
  return blob
}

// ============ 账册/列表类的自包含 HTML 表格构造 ============

export interface PrintColumn<T = any> {
  label: string
  align?: 'left' | 'center' | 'right'
  width?: string
  /** 单元格渲染，返回纯文本（会被转义） */
  render: (row: T, index: number) => string
}

export interface PrintHeaderCell {
  label: string
  align?: 'left' | 'center' | 'right'
  width?: string
  colspan?: number
  rowspan?: number
}

export interface BuildTablePrintOptions<T = any> {
  title: string
  subtitle?: string | string[]
  columns: PrintColumn<T>[]
  rows: T[]
  /** 多级表头；未传时按 columns 自动生成单行表头 */
  headerRows?: PrintHeaderCell[][]
  /** 纯黑白模式：白底、黑字、黑色边框，不输出任何底色 */
  monochrome?: boolean
  /** 按打印面板宽度固定表格布局，避免宽表超出 A4 可打印区域 */
  fitToPage?: boolean
  /**
   * 正文字号（px）。传入后优先使用，不再按列数压到过小字号。
   * 未传且 fitToPage 时，最低约 11px，保证直接打印可读。
   */
  fontSize?: number
  /** 返回行内联样式（如小计行加粗底色），可选 */
  rowStyle?: (row: T, index: number) => string
  /** 表尾合计行（已是字符串数组，与列对应），可选 */
  footer?: string[]
  /** 合计行之前的小计行（如外币表按币种小计），每行与列对应，可选 */
  footerSubtotals?: string[][]
}

/** 小/中/大 对应正文字号（px） */
export const PRINT_FONT_SIZE_MAP = { small: 10, medium: 12, large: 14 } as const
export type PrintFontSizeKey = keyof typeof PRINT_FONT_SIZE_MAP

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 由列定义 + 数据行构造自包含 HTML 表格（内联样式），供 hiprint html 元素套打。
 * 账册各视图把自己的 el-table 列逻辑映射成 PrintColumn[] 即可复用。
 */
export function buildTablePrintHtml<T = any>(opts: BuildTablePrintOptions<T>): string {
  const {
    title,
    subtitle,
    columns,
    rows,
    headerRows,
    monochrome = false,
    fitToPage = false,
    fontSize,
    rowStyle,
    footer,
    footerSubtotals,
  } = opts
  const columnCount = Math.max(columns.length, 1)
  // 历史 fitToPage 会把宽表压到 7–10px，直接打印过小；默认抬到可读区间
  const autoFitted =
    columnCount >= 16 ? 11 : columnCount >= 12 ? 11 : columnCount >= 9 ? 12 : 12
  const bodyFontSize = fontSize && fontSize > 0 ? fontSize : fitToPage ? autoFitted : 12
  const headerFontSize = Math.min(bodyFontSize + 1, bodyFontSize >= 14 ? 15 : bodyFontSize + 1)
  const fittedHeaderPadding = bodyFontSize <= 10 ? '2px 2px' : bodyFontSize <= 12 ? '3px 4px' : '4px 5px'
  const fittedCellPadding = bodyFontSize <= 10 ? '2px 2px' : bodyFontSize <= 12 ? '3px 4px' : '4px 5px'
  const thBase = `border:1px solid #000;padding:${fitToPage ? fittedHeaderPadding : '4px 6px'};font-size:${headerFontSize}px;line-height:1.25;white-space:normal;overflow-wrap:anywhere;${monochrome ? 'color:#000;' : 'background:#f2f2f2;'}font-weight:600;box-sizing:border-box;`
  const tdBase = `border:1px solid #000;padding:${fitToPage ? fittedCellPadding : '3px 6px'};font-size:${bodyFontSize}px;line-height:1.3;${monochrome ? 'color:#000;' : ''}box-sizing:border-box;`

  const headerHtml = headerRows
    ? headerRows
        .map(
          row =>
            `<tr>${row
              .map(
                cell =>
                  `<th${cell.colspan ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan ? ` rowspan="${cell.rowspan}"` : ''} style="${thBase}text-align:${cell.align || 'center'};${!fitToPage && cell.width ? `width:${cell.width};` : ''}">${escapeHtml(cell.label)}</th>`
              )
              .join('')}</tr>`
        )
        .join('')
    : `<tr>${columns
        .map(
          c =>
            `<th style="${thBase}text-align:${c.align || 'center'};${!fitToPage && c.width ? `width:${c.width};` : ''}">${escapeHtml(c.label)}</th>`
        )
        .join('')}</tr>`

  const body = rows
    .map((row, i) => {
      const rawExtra = rowStyle ? rowStyle(row, i) : ''
      const extra = monochrome
        ? rawExtra.replace(/(?:background(?:-color)?|color)\s*:[^;]+;?/gi, '')
        : rawExtra
      const tds = columns
        .map(
          c =>
            `<td style="${tdBase}text-align:${c.align || 'left'};${fitToPage && c.align === 'right' ? 'white-space:nowrap;' : fitToPage ? 'white-space:normal;overflow-wrap:anywhere;word-break:break-word;' : ''}${extra}">${escapeHtml(c.render(row, i))}</td>`
        )
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')

  const footRow = (values: string[]) =>
    `<tr>${values
      .map(
        (v, idx) =>
          `<td style="${tdBase}font-weight:600;${monochrome ? '' : 'background:#fafafa;'}text-align:${columns[idx]?.align || 'left'};">${escapeHtml(v)}</td>`
      )
      .join('')}</tr>`
  const foot =
    (footerSubtotals || []).map(footRow).join('') + (footer ? footRow(footer) : '')

  const subtitleLines = subtitle ? (Array.isArray(subtitle) ? subtitle : [subtitle]) : []
  const colgroup = fitToPage
    ? `<colgroup>${columns
        .map(
          column =>
            `<col style="width:${column.width || `${100 / Math.max(columns.length, 1)}%`};" />`
        )
        .join('')}</colgroup>`
    : ''

  return `<div class="cw-table-print-root" style="font-family:'SimSun','宋体',serif;width:100%;max-width:100%;overflow:hidden;box-sizing:border-box;">
    <style>
      .cw-table-print-root .cw-print-table thead { display: table-header-group; }
      .cw-table-print-root .cw-print-table tr { break-inside: avoid; page-break-inside: avoid; }
    </style>
    <div style="text-align:center;font-size:${Math.max(16, bodyFontSize + 6)}px;font-weight:700;letter-spacing:2px;margin-bottom:4px;">${escapeHtml(title)}</div>
    ${subtitleLines
      .map(
        (line, index) =>
          `<div style="text-align:center;font-size:${Math.max(11, bodyFontSize)}px;color:${monochrome ? '#000' : '#333'};margin-bottom:${index === subtitleLines.length - 1 ? '8px' : '3px'};">${escapeHtml(line)}</div>`
      )
      .join('')}
    <table class="cw-print-table" style="border-collapse:collapse;width:100%;max-width:100%;${fitToPage ? 'table-layout:fixed;' : ''}box-sizing:border-box;font-variant-numeric:tabular-nums;">
      ${colgroup}
      <thead>${headerHtml}</thead>
      <tbody>${body}${foot}</tbody>
    </table>
  </div>`
}
