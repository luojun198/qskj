/**
 * vue-plugin-hiprint 适配层
 * - 懒加载 hiprint（UMD 重包，含 jQuery/jspdf/html2canvas，不进首屏）
 * - 提供「单 HTML 元素面板」构造，用于把账册/报表的二维表格 HTML 交给 hiprint
 *   统一走预览 / 打印 / 导出 PDF / 套打底图通道。
 */
import type { HiprintPanel } from '@/types/print'

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
          providers: [new mod.defaultElementTypeProvider()],
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
  const marginPt = mmToPt(marginMm)

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
      left: marginPt,
      top: marginPt,
      width: widthPt - marginPt * 2,
      height: heightPt - marginPt * 2,
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
    paperHeader: marginPt,
    paperFooter: heightPt - marginPt,
    printElements,
    ...(background ? { background } : {}),
  }

  // hiprint PrintTemplate 的 template 选项需要 { panels: [...] }
  return { panels: [panel] }
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
  /** 返回行内联样式（如小计行加粗底色），可选 */
  rowStyle?: (row: T, index: number) => string
  /** 表尾合计行（已是字符串数组，与列对应），可选 */
  footer?: string[]
}

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
    rowStyle,
    footer,
  } = opts
  const columnCount = Math.max(columns.length, 1)
  const fittedFontSize = columnCount >= 16 ? 7 : columnCount >= 12 ? 8 : columnCount >= 9 ? 9 : 10
  const fittedHeaderPadding = columnCount >= 12 ? '2px 1px' : '3px 2px'
  const fittedCellPadding = columnCount >= 12 ? '2px 1px' : '2px 3px'
  const thBase = `border:1px solid #000;padding:${fitToPage ? fittedHeaderPadding : '4px 6px'};font-size:${fitToPage ? `${fittedFontSize}px` : '12px'};line-height:1.25;white-space:normal;overflow-wrap:anywhere;${monochrome ? 'color:#000;' : 'background:#f2f2f2;'}font-weight:600;box-sizing:border-box;`
  const tdBase = `border:1px solid #000;padding:${fitToPage ? fittedCellPadding : '3px 6px'};font-size:${fitToPage ? `${fittedFontSize}px` : '12px'};line-height:1.3;${monochrome ? 'color:#000;' : ''}box-sizing:border-box;`

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

  const foot = footer
    ? `<tr>${footer
        .map(
          (v, idx) =>
            `<td style="${tdBase}font-weight:600;${monochrome ? '' : 'background:#fafafa;'}text-align:${columns[idx]?.align || 'left'};">${escapeHtml(v)}</td>`
        )
        .join('')}</tr>`
    : ''

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
    <div style="text-align:center;font-size:18px;font-weight:700;letter-spacing:2px;margin-bottom:4px;">${escapeHtml(title)}</div>
    ${subtitleLines
      .map(
        (line, index) =>
          `<div style="text-align:center;font-size:12px;color:${monochrome ? '#000' : '#333'};margin-bottom:${index === subtitleLines.length - 1 ? '8px' : '3px'};">${escapeHtml(line)}</div>`
      )
      .join('')}
    <table class="cw-print-table" style="border-collapse:collapse;width:100%;max-width:100%;${fitToPage ? 'table-layout:fixed;' : ''}box-sizing:border-box;font-variant-numeric:tabular-nums;">
      ${colgroup}
      <thead>${headerHtml}</thead>
      <tbody>${body}${foot}</tbody>
    </table>
  </div>`
}
