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
  VOUCHER_SUMMARY_LABEL_FORMATTER_SRC,
  VOUCHER_TABLE_FIELD,
  applyVoucherHeaderAlign,
  applyVoucherTableRows,
} from '@/utils/hiprintVoucherProvider'
// 以 URL 形式拿到 print-lock.css：hiprint 浏览器打印时要从 <link media="print"> 复制样式进打印 iframe
import printLockCssUrl from 'vue-plugin-hiprint/dist/print-lock.css?url'
// print-lock.css 原文：浏览器打印时内联进打印 iframe（见 hiprintBrowserPrintOptions）
import printLockCssRaw from 'vue-plugin-hiprint/dist/print-lock.css?raw'

type HiprintModule = typeof import('vue-plugin-hiprint')

let hiprintModulePromise: Promise<HiprintModule> | null = null
let initialized = false

const PRINT_LOCK_LINK_ID = 'cw-hiprint-print-lock'

/**
 * 在 <head> 挂一个 `<link rel="stylesheet" media="print" href="…print-lock.css">`。
 *
 * hiprint 的浏览器打印（`$.fn.hiwprint`）会新建一个隐藏 iframe，只把当前文档里
 * `link[media=print]` 且 href 含 `print-lock.css` 的样式链接复制进去；
 * 用 `import '…/print-lock.css'` 引入时 Vite 注入的是 <style>（或不带 media 的 <link>），
 * iframe 里完全没有 hiprint 样式：分录表网格线丢失、@page 纸张失效、页码挤到第二页，
 * 打印结果与设计器/预览对不上。这里补一个 media="print" 的 link 让 hiprint 能找到。
 */
function ensurePrintLockLink() {
  if (typeof document === 'undefined') return
  if (document.getElementById(PRINT_LOCK_LINK_ID)) return
  const link = document.createElement('link')
  link.id = PRINT_LOCK_LINK_ID
  link.rel = 'stylesheet'
  link.media = 'print'
  link.href = printLockCssUrl
  document.head.appendChild(link)
}

/**
 * 项目对 hiprint 样式的覆盖（与 assets/styles.css 里的 `.hiprint-printElement-table thead` 保持一致）。
 * 打印 iframe 不会继承页面上的全局样式表，需要通过 hiprint 的 styleHandler 显式带进去。
 */
const HIPRINT_PRINT_OVERRIDE_CSS =
  '<style>.hiprint-printElement-table thead{background:transparent!important}</style>'

/**
 * 传给 `tp.print(data, options, printOptions)` 第三参的浏览器打印选项。
 *
 * print-lock.css 全文以内联 <style> 经 styleHandler 带进打印 iframe：hiprint 只复制
 * href 含 `print-lock.css` 的 link，而生产构建会把文件名加哈希（`print-lock-xxxx.css`），
 * 匹配不上 → iframe 里没有表格边框样式，部署环境打印凭证无网格线（开发环境不加哈希，看不出来）。
 */
export function hiprintBrowserPrintOptions() {
  ensurePrintLockLink()
  return { styleHandler: () => `<style>${printLockCssRaw}</style>` + HIPRINT_PRINT_OVERRIDE_CSS }
}

/** 懒加载并初始化 hiprint（全局只初始化一次） */
export async function loadHiprint(): Promise<HiprintModule> {
  if (!hiprintModulePromise) {
    hiprintModulePromise = (async () => {
      const mod = await import('vue-plugin-hiprint')
      // 引入设计/打印锁定样式（屏幕上的设计器 / 预览用）
      await import('vue-plugin-hiprint/dist/print-lock.css')
      // 打印 iframe 用的 media="print" 链接
      ensurePrintLockLink()
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
 * 给表格元素里 `tableSummary === 'sum'` 的列注入合计单元格渲染函数，
 * `tableSummary === 'text'` 的标签列注入「过次页 / 合计」标签渲染函数。
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
    if (col.tableSummaryFormatter) return entry
    if (col.tableSummary === 'sum') return { ...col, tableSummaryFormatter: VOUCHER_SUMMARY_FORMATTER_SRC }
    // 标签格：切页后按数据显示「过次页 / 合计」
    if (col.tableSummary === 'text') return { ...col, tableSummaryFormatter: VOUCHER_SUMMARY_LABEL_FORMATTER_SRC }
    return entry
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
 * 分录表列头统一水平居中（补 halign，老模板不用重存）。不改入参。
 */
export function centerVoucherHeaderCells<T>(template: T): T {
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
            options?: Record<string, any>
            printElementType?: { type?: string; columns?: unknown[] }
          }
          const o = e?.options
          if (e?.printElementType?.type !== 'table' || !o || o.field !== VOUCHER_TABLE_FIELD) return el
          const fix = (cols: unknown) =>
            Array.isArray(cols) ? cols.map(row => (Array.isArray(row) ? applyVoucherHeaderAlign(row) : row)) : cols
          return {
            ...e,
            options: { ...o, columns: fix(o.columns) },
            printElementType: { ...e.printElementType, columns: fix(e.printElementType.columns) },
          }
        }),
      }
    }),
  } as T
}

/**
 * 固定行数的分录表：渲染前按当前公式重算「列头 / 表体 / 合计行统一行高」。
 *
 * 行高随模板 JSON 保存（tableBodyRowHeight / tableHeaderRowHeight），但公式改过
 * （早先只均分表体、列头与合计行用 hiprint 默认 18pt），已保存的老模板里存的是旧值、
 * 也没有列头行高。这里按 maxRows 重算一遍，不用重新保存模板打印就能对齐。不改入参。
 */
export function applyVoucherUniformRowHeights<T>(template: T): T {
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
          const e = el as { options?: Record<string, any>; printElementType?: { type?: string } }
          const o = e?.options
          if (e?.printElementType?.type !== 'table' || !o || o.field !== VOUCHER_TABLE_FIELD) return el
          const rows = Math.floor(Number(o.maxRows) || 0)
          if (rows <= 0) return el
          return { ...e, options: applyVoucherTableRows(o, { rows }) }
        }),
      }
    }),
  } as T
}

/** hiprint 内置纸张类型（hinnn.instance 里的 A0~A8 / B0~B8），@page size 认得这些关键字 */
const HIPRINT_PAPER_TYPE_RE = /^[AB]\d$/i

/**
 * 自定义纸张（项目里存成 `paperType: 'other'`）在打印时要把 paperType 清掉。
 *
 * hiprint 的 `getPrintSizeStyle()` 只要 paperType 非空就直接拼成 `@page { size: other landscape }`，
 * 这不是合法的 CSS 尺寸，整条 @page 会被浏览器丢弃 → 打印对话框按打印机默认纸张（一般 A4）
 * 出纸，210×148 的凭证纸就对不上模板。paperType 为空时 hiprint 才会按面板宽高输出
 * `size: 210mm 148mm`。只在渲染前处理、不改落库的模板 JSON。
 */
export function normalizeCustomPaperType<T>(template: T): T {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  if (!Array.isArray(panels)) return template
  return {
    ...(template as object),
    panels: panels.map(panel => {
      const p = panel as HiprintPanel
      if (!p || typeof p !== 'object') return panel
      if (!p.paperType || HIPRINT_PAPER_TYPE_RE.test(p.paperType)) return panel
      const { paperType: _omit, ...rest } = p
      void _omit
      return rest
    }),
  } as T
}

/**
 * 渲染（预览 / 打印 / 导出 PDF）前对面板做的全部归一化处理。
 * 调用方只要记住这一个函数即可，不用逐个记得要调哪几步。
 */
export function normalizePanelForRender<T>(template: T): T {
  return placeVoucherPageText(disableVoucherPaperNumber(
    normalizeCustomPaperType(
      injectVoucherSummaryFormatter(
        applyVoucherUniformRowHeights(centerVoucherHeaderCells(pinDesignedPanelElements(template)))
      )
    )
  ))
}

/** 页次格宽（pt），够放「12/12」 */
const PAGE_TEXT_WIDTH_PT = 48

/**
 * 凭证多页时的页次（1/2）贴着分录表右边框放在凭证号那一行，不和凭证号挤在一起、右侧也不留空。
 * - 模板里已放了「页次」字段（设计器拖入）：按设计位置，不动
 * - 该位置已被「附单据」或「[记] 字第 1 号」占着：改绑 *_page_text，在其后面接着显示页次
 * - 否则按凭证号那格的行高 / 字号补一个页次元素，右端对齐表格右边框
 * 只在渲染前处理，不改落库模板；老模板不用重存。
 */
export function placeVoucherPageText<T>(template: T): T {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  if (!Array.isArray(panels)) return template
  return {
    ...(template as object),
    panels: panels.map(panel => {
      const p = panel as HiprintPanel
      const els = (p?.printElements || []) as Array<{ options?: Record<string, any>; printElementType?: unknown }>
      const table = findVoucherTableOptions(p)
      const byField = (f: string) => els.find(e => e?.options?.field === f)
      // 凭证号所在行：老模板是 voucher_no_text，标准模板是 voucher_word_text（[记] 字第 1 号）
      const noEl = byField('voucher_no_text') || byField('voucher_word_text')
      if (!table || !noEl?.options || byField('page_text')) return panel
      const right = Number(table.left || 0) + Number(table.width || 0)
      const top = Number(noEl.options.top || 0)
      const height = Number(noEl.options.height || 20)
      const zoneLeft = right - PAGE_TEXT_WIDTH_PT
      const occupies = (o: Record<string, any> | undefined) =>
        !!o &&
        Number(o.left || 0) + Number(o.width || 0) > zoneLeft &&
        Number(o.left || 0) < right &&
        Number(o.top || 0) < top + height &&
        Number(o.top || 0) + Number(o.height || 0) > top
      // 右端已被占用：在占位元素文字后面接着显示页次（数据里备好了合并字段）
      const merged: Record<string, string> = {
        attachments_text: 'attachments_page_text',
        voucher_word_text: 'voucher_word_page_text',
      }
      const occupant = els.find(e => merged[e?.options?.field] && occupies(e.options))
      if (occupant?.options) {
        const field = merged[occupant.options.field]
        return {
          ...p,
          printElements: els.map(e => (e === occupant ? { ...e, options: { ...occupant.options, field } } : e)),
        }
      }
      const pageEl = {
        ...noEl,
        options: {
          ...noEl.options,
          field: 'page_text',
          testData: '1/2',
          title: '页次',
          left: zoneLeft,
          width: PAGE_TEXT_WIDTH_PT,
          textAlign: 'right',
          fixed: true,
        },
      }
      return { ...p, printElements: [...els, pageEl] }
    }),
  } as T
}

/** 面板里的凭证分录表元素（field = entries 的 table），没有返回 null */
function findVoucherTableOptions(panel: unknown): Record<string, any> | null {
  const els = (panel as HiprintPanel | null)?.printElements
  if (!Array.isArray(els)) return null
  for (const el of els) {
    const e = el as { options?: Record<string, any>; printElementType?: { type?: string } }
    if (e?.printElementType?.type === 'table' && e.options?.field === VOUCHER_TABLE_FIELD) return e.options
  }
  return null
}

/**
 * 凭证面板关掉 hiprint 自带页码。
 *
 * 页码画在距纸底 22pt 处，纸面高度又正好等于模板高度；打印机纸型或不可打印边距稍小一点，
 * 页码就被挤到下一张纸，凭空多出一张空白页。凭证多页时页次改由 placeVoucherPageText 贴表格右边框显示。
 */
export function disableVoucherPaperNumber<T>(template: T): T {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  if (!Array.isArray(panels)) return template
  return {
    ...(template as object),
    panels: panels.map(panel =>
      findVoucherTableOptions(panel) ? { ...(panel as object), paperNumberDisabled: true } : panel
    ),
  } as T
}

/** 每张凭证纸放几行分录：取模板分录表的固定行数，未固定时用 fallback */
export function voucherRowsPerPage(template: unknown, fallback: number): number {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  const opts = Array.isArray(panels) ? findVoucherTableOptions(panels[0]) : null
  const rows = Math.floor(Number(opts?.maxRows) || 0)
  return rows > 0 ? rows : fallback
}

/** 模板第一块面板的纸张宽高（mm），取不到返回 null */
export function panelSizeMm(template: unknown): { width: number; height: number } | null {
  const panels = (template as { panels?: Array<{ width?: unknown; height?: unknown }> } | null | undefined)
    ?.panels
  const p = Array.isArray(panels) ? panels[0] : null
  const width = Number(p?.width)
  const height = Number(p?.height)
  return width > 0 && height > 0 ? { width, height } : null
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
  printHtmlInIframe(
    `<style>
@page { size: ${dim.width}mm ${dim.height}mm; margin: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm; }
html, body { margin: 0; padding: 0; background: #fff; }
</style>`,
    html,
    options.title
  )
}

/** 新建隐藏 iframe 写入完整文档并调起浏览器打印，打印结束后自动移除 */
function printHtmlInIframe(headHtml: string, bodyHtml: string, title?: string) {
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
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title || '打印')}</title>` +
      `${headHtml}</head><body>${bodyHtml}</body></html>`
  )
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
  return renderElementsToPdfBlob([element], dim)
}

/** 多个纸面元素各截一页，合成一个多页 PDF（合打凭证用） */
export async function renderElementsToPdfBlob(
  elements: HTMLElement[],
  dim: { width: number; height: number }
): Promise<Blob> {
  if (elements.length === 0) throw new Error('无可导出内容')
  const html2canvasMod = await import('@wtto00/html2canvas')
  const html2canvas =
    (html2canvasMod as { default?: (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement> })
      .default || (html2canvasMod as unknown as (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>)
  const jspdfMod = (await import('jspdf')) as { jsPDF?: new (opts: Record<string, unknown>) => any; default?: { jsPDF?: new (opts: Record<string, unknown>) => any } }
  const JsPDF = jspdfMod.jsPDF || jspdfMod.default?.jsPDF
  if (!html2canvas || !JsPDF) throw new Error('当前环境不支持导出 PDF')

  const pdf = new JsPDF({
    orientation: dim.width > dim.height ? 'l' : 'p',
    unit: 'mm',
    format: [dim.width, dim.height],
  })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  for (let i = 0; i < elements.length; i++) {
    const canvas = await html2canvas(elements[i], {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    })
    if (i > 0) pdf.addPage([dim.width, dim.height], dim.width > dim.height ? 'l' : 'p')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH)
  }
  const blob = pdf.output('blob')
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('PDF 文件生成失败')
  return blob
}

// ============ 凭证合打（一张 A4 纵向上下各打一张凭证） ============

/** 合打时每张凭证可占的高度：半张 A4 */
export const MERGE_A4_HALF_MM = 148.5

/** 取模板第一块面板的纸高（mm），取不到返回 0 */
export function panelHeightMm(template: unknown): number {
  const panels = (template as { panels?: Array<{ height?: unknown }> } | null | undefined)?.panels
  const h = Number(Array.isArray(panels) ? panels[0]?.height : 0)
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** 模板纸高不超过半张 A4 才能合打（0 = 未知，按可合打处理） */
export function canMergeA4(template: unknown): boolean {
  return panelHeightMm(template) <= MERGE_A4_HALF_MM + 0.01
}

/**
 * 合打纸面样式：预览与打印 iframe 共用。
 * hiprint 纸面自带 page-break-after: always，合打时改为由 A4 容器分页。
 */
export const MERGE_SHEET_CSS = `
.cw-merge-sheet{width:210mm;height:297mm;overflow:hidden;background:#fff;box-sizing:border-box;page-break-after:always;break-after:page;position:relative}
.cw-merge-sheet:last-child{page-break-after:auto;break-after:auto}
.cw-merge-half{width:210mm;height:${MERGE_A4_HALF_MM}mm;overflow:hidden;box-sizing:border-box}
.cw-merge-half + .cw-merge-half{border-top:1px dashed #c0c4cc}
.cw-merge-half .hiprint-printPaper{page-break-after:auto!important;break-after:auto!important}
`

const MERGE_STYLE_ID = 'cw-merge-sheet-style'

/** 屏幕预览用：在 <head> 注入一次合打纸面样式 */
export function ensureMergeSheetStyle() {
  if (typeof document === 'undefined' || document.getElementById(MERGE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MERGE_STYLE_ID
  style.textContent = MERGE_SHEET_CSS
  document.head.appendChild(style)
}

/**
 * 把容器里 hiprint 渲染出的 `.hiprint-printPaper` 纸面按顺序每 2 个装进一个 A4 容器。
 * 奇数张时最后一张 A4 下半页留空。返回生成的 A4 容器数。
 */
export function groupPapersIntoA4Sheets(container: HTMLElement): number {
  const papers = Array.from(container.querySelectorAll<HTMLElement>('.hiprint-printPaper'))
  if (papers.length === 0) return 0
  const doc = container.ownerDocument
  const root = doc.createElement('div')
  root.className = 'hiprint-printTemplate cw-merge-root'
  let sheet: HTMLElement | null = null
  papers.forEach((paper, i) => {
    if (i % 2 === 0) {
      sheet = doc.createElement('div')
      sheet.className = 'cw-merge-sheet'
      root.appendChild(sheet)
    }
    const half = doc.createElement('div')
    half.className = 'cw-merge-half'
    half.appendChild(paper)
    sheet!.appendChild(half)
  })
  container.innerHTML = ''
  container.appendChild(root)
  return root.children.length
}

/** 浏览器打印合打后的 A4 纸面（HTML 为 groupPapersIntoA4Sheets 处理后的容器内容） */
export function printMergedSheets(sheetsHtml: string, title?: string) {
  printHtmlInIframe(
    `<style>${printLockCssRaw}</style>${HIPRINT_PRINT_OVERRIDE_CSS}` +
      `<style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}${MERGE_SHEET_CSS}</style>`,
    sheetsHtml,
    title
  )
}

// ============ 凭证单张打印：防撑高 + 纸张适配 ============

const PX_PER_PT = 96 / 72
const PX_PER_MM = 96 / 25.4
/** 缩字下限（pt）：再小打出来就认不清了，仍放不下的部分裁掉 */
const FIT_MIN_PT = 6
/** 折行时的行距：收紧到 1.05，默认行高（28pt）下 8.5pt 左右就能排 3 行 */
const FIT_WRAP_LINE_HEIGHT = 1.05
const FIT_STEP_PT = 0.5
/** 表格边框占高（px） */
const FIT_BORDER_ALLOWANCE_PX = 1.5

/** 单元格目标高度（px）：优先取内联 height（hiprint 按 tableBodyRowHeight 写成 pt），没有就用当前高度 */
function cellTargetHeightPx(td: HTMLElement): number {
  const m = /^([\d.]+)(pt|px)$/.exec((td.style.height || '').trim())
  if (m) return m[2] === 'pt' ? parseFloat(m[1]) * PX_PER_PT : parseFloat(m[1])
  return td.clientHeight
}

/**
 * 分录表单元格防撑高：长摘要 / 科目名在固定行高里折成多行会把行撑高，
 * 合计行、签章行就被顶出纸面。这里在渲染后的 DOM 上逐格处理：
 * 单行放不下时改为折行（行高够就排 2~3 行），从原字号开始逐级缩小（步长 0.5pt，下限 6pt），
 * 取「能装进行高的最大字号」——宁可多折几行也不先把字缩小；到下限仍放不下的部分裁掉。
 * 行高始终保持模板值。需要容器已挂在文档里（要测量尺寸），返回处理过的单元格数。
 */
export function fitVoucherTableCells(container: HTMLElement): number {
  const win = container.ownerDocument.defaultView
  if (!win) return 0
  const cells = container.querySelectorAll<HTMLTableCellElement>(
    '.hiprint-printElement-table-content tbody td, .hiprint-printElement-table-content tfoot td'
  )
  let fitted = 0
  cells.forEach(td => {
    if (!td.textContent || !td.textContent.trim()) return
    if (td.querySelector(':scope > .cw-cell-fit')) return
    const cs = win.getComputedStyle(td)
    // 单元格 height 是 border-box；合并边框下 computed border 读出来是 0，实际仍占 1px，统一预留
    const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + FIT_BORDER_ALLOWANCE_PX
    const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    // 先量宽度（此时还没改 nowrap，列宽是表格按列定义排出来的）；
    // 行高以模板写在单元格上的 height（如 28pt）为准，此刻的 clientHeight 可能已被折行撑高
    const maxW = td.clientWidth - padH
    const maxH = cellTargetHeightPx(td) - padV
    if (maxW <= 0 || maxH <= 0) return
    const doc = td.ownerDocument
    const box = doc.createElement('div')
    box.className = 'cw-cell-fit'
    // transition:none：全局样式给所有元素挂了 `transition: all 0.01ms`，宽度 / 缩放改了要等下一帧才生效，
    // 循环里同步测量会一直拿到旧值
    box.style.cssText = `width:${maxW}px;overflow:hidden;transition:none;`
    const inner = doc.createElement('div')
    inner.style.cssText = 'white-space:nowrap;line-height:1.15;transform-origin:0 0;transition:none;'
    while (td.firstChild) inner.appendChild(td.firstChild)
    box.appendChild(inner)
    td.appendChild(box)
    // 缩字用 transform: scale，而不是 font-size / zoom：中文版 Chrome 有 12px 最小字号，
    // font-size 与 zoom 缩到 12px 以下都会被抬回去，只有 transform 不受影响。
    // 内层按 1/scale 放宽排版宽度，缩放后正好等于格宽（宽度必须钉死，否则 nowrap 长文本会把
    // 自动布局的表格列撑宽，量出来永远「放得下」）；外层固定宽度并裁切，占位高度手动给。
    const basePt = parseFloat(cs.fontSize) / PX_PER_PT || 11
    let scale = 1
    const applyScale = (pt: number) => {
      scale = pt / basePt
      inner.style.width = `${maxW / scale}px`
      inner.style.transform = scale === 1 ? '' : `scale(${scale})`
    }
    applyScale(basePt)
    // transform 不影响 offset / scroll 尺寸，以下都在内层未缩放的坐标里比较
    const overflowsW = () => inner.scrollWidth > inner.clientWidth + 1
    if (!overflowsW()) {
      // 放得下：拆掉包装，原样保留
      while (inner.firstChild) td.insertBefore(inner.firstChild, box)
      box.remove()
      return
    }
    fitted++
    // overflow-wrap:anywhere：中文照常逐字换行，英文单词 / 单据号只在一行放不下时才拆开
    inner.style.whiteSpace = 'normal'
    inner.style.overflowWrap = 'anywhere'
    inner.style.lineHeight = String(FIT_WRAP_LINE_HEIGHT)
    let pt = basePt
    const overflows = () => overflowsW() || inner.scrollHeight * scale > maxH + 0.5
    while (overflows() && pt - FIT_STEP_PT >= FIT_MIN_PT) {
      pt -= FIT_STEP_PT
      applyScale(pt)
    }
    // 外层占位高度 = 缩放后的内容高度（不超过行高），让单元格的垂直居中照常生效
    box.style.height = `${Math.min(inner.offsetHeight * scale, maxH)}px`
  })
  return fitted
}

/**
 * 凭证打印的纸张模式：
 * - fit：适应打印机纸张。@page 不写 size → 浏览器打印面板保留「布局（横/纵）」与打印机自身纸型，
 *   每张凭证用 SVG viewBox 等比缩放到整页（不拉伸、不变形）
 * - actual：按凭证纸 1:1。@page 写模板宽高，适合打印机里已建好凭证纸型、要精确套打的电脑
 */
export type VoucherPaperMode = 'fit' | 'actual'

export const VOUCHER_PAPER_MODE_STORAGE_KEY = 'cw.voucherPrint.paperMode'

/** 本电脑记住的纸张模式（localStorage 不可用时回退 fit） */
export function loadVoucherPaperMode(): VoucherPaperMode {
  try {
    return localStorage.getItem(VOUCHER_PAPER_MODE_STORAGE_KEY) === 'actual' ? 'actual' : 'fit'
  } catch {
    return 'fit'
  }
}

export function saveVoucherPaperMode(mode: VoucherPaperMode) {
  try {
    localStorage.setItem(VOUCHER_PAPER_MODE_STORAGE_KEY, mode)
  } catch {
    /* 隐私模式等写不进去时忽略，下次回到默认 */
  }
}

// ============ 凭证打印边距（本电脑记忆） ============

/** 四向边距（mm）= 纸边到凭证内容边缘的距离 */
export interface VoucherPrintMargins {
  top: number
  bottom: number
  left: number
  right: number
}

export const VOUCHER_MARGINS_STORAGE_KEY = 'cw.voucherPrint.margins'
export const VOUCHER_MARGIN_MIN_MM = 0
export const VOUCHER_MARGIN_MAX_MM = 80

function clampMargin(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(Math.round(n * 10) / 10, VOUCHER_MARGIN_MIN_MM), VOUCHER_MARGIN_MAX_MM)
}

export function normalizeVoucherMargins(m: Partial<VoucherPrintMargins> | null | undefined): VoucherPrintMargins {
  return {
    top: clampMargin(m?.top),
    bottom: clampMargin(m?.bottom),
    left: clampMargin(m?.left),
    right: clampMargin(m?.right),
  }
}

/** 本电脑保存的边距；没调过返回 null（= 用模板自身边距） */
export function loadVoucherMargins(): VoucherPrintMargins | null {
  try {
    const raw = localStorage.getItem(VOUCHER_MARGINS_STORAGE_KEY)
    return raw ? normalizeVoucherMargins(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** 传 null 清除（恢复模板默认） */
export function saveVoucherMargins(m: VoucherPrintMargins | null) {
  try {
    if (m) localStorage.setItem(VOUCHER_MARGINS_STORAGE_KEY, JSON.stringify(normalizeVoucherMargins(m)))
    else localStorage.removeItem(VOUCHER_MARGINS_STORAGE_KEY)
  } catch {
    /* 隐私模式等写不进去时忽略 */
  }
}

/** 模板内容的外包框（mm，相对纸张左上角） */
export interface ContentBoxMm {
  left: number
  top: number
  right: number
  bottom: number
}

const PT_TO_MM = 25.4 / 72

/** 第一块面板所有元素的外包框：最小 left/top 到最大 right/bottom（元素坐标是 pt） */
export function panelContentBoxMm(template: unknown): ContentBoxMm | null {
  const panels = (template as { panels?: unknown[] } | null | undefined)?.panels
  const els = Array.isArray(panels) ? (panels[0] as HiprintPanel | undefined)?.printElements : null
  if (!Array.isArray(els) || els.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of els) {
    const o = (el as { options?: Record<string, any> })?.options
    if (!o) continue
    const l = Number(o.left) || 0
    const t = Number(o.top) || 0
    left = Math.min(left, l)
    top = Math.min(top, t)
    right = Math.max(right, l + (Number(o.width) || 0))
    bottom = Math.max(bottom, t + (Number(o.height) || 0))
  }
  if (!Number.isFinite(left) || right <= left || bottom <= top) return null
  const r = (pt: number) => Math.round(pt * PT_TO_MM * 10) / 10
  return { left: r(left), top: r(top), right: r(right), bottom: r(bottom) }
}

/** 模板自身的边距（没调过时弹窗里显示的值） */
export function templateVoucherMargins(
  box: ContentBoxMm,
  paper: { width: number; height: number }
): VoucherPrintMargins {
  return normalizeVoucherMargins({
    top: box.top,
    left: box.left,
    right: paper.width - box.right,
    bottom: paper.height - box.bottom,
  })
}

/**
 * 边距 → 纸面内容层的变换：把内容外包框放进「纸张减四边边距」的区域，左上角贴住左 / 上边距。
 * 区域够大时原尺寸平移；装不下时等比缩小（取宽、高里更紧的一边），从不放大、不拉伸。
 * 变换是先缩放（原点为纸张左上角）再平移，所以平移量 = 目标边距 - 外包框起点 × 缩放比。
 */
export function computeVoucherMarginTransform(
  m: VoucherPrintMargins,
  box: ContentBoxMm,
  paper: { width: number; height: number }
): { translateX: number; translateY: number; scale: number } {
  const boxW = box.right - box.left
  const boxH = box.bottom - box.top
  const availW = paper.width - m.left - m.right
  const availH = paper.height - m.top - m.bottom
  const scale = Math.round(Math.max(Math.min(1, availW / boxW, availH / boxH), 0.1) * 10000) / 10000
  const r = (n: number) => Math.round(n * 1000) / 1000 || 0
  return {
    translateX: r(m.left - box.left * scale),
    translateY: r(m.top - box.top * scale),
    scale,
  }
}

/**
 * 把边距套到容器里每张纸面的内容层（.hiprint-printPaper-content）上。
 * 纸面本身尺寸不变（overflow:hidden），预览即打印：打印走的就是这份 DOM。可重复调用。
 */
export function applyVoucherMargins(
  container: HTMLElement,
  m: VoucherPrintMargins,
  box: ContentBoxMm,
  paper: { width: number; height: number }
) {
  const t = computeVoucherMarginTransform(m, box, paper)
  const identity = Math.abs(t.translateX) < 0.05 && Math.abs(t.translateY) < 0.05 && t.scale === 1
  container.querySelectorAll<HTMLElement>('.hiprint-printPaper-content').forEach(el => {
    el.style.transformOrigin = '0 0'
    el.style.transform = identity ? '' : `translate(${t.translateX}mm, ${t.translateY}mm) scale(${t.scale})`
  })
}

/** fit 模式下纸边留白（mm）：避开打印机不可打印区域，免得表格外框被裁 */
export const VOUCHER_FIT_INSET_MM = 4
/** actual 模式下纸面高度的安全余量（mm）：防止四舍五入 / 打印机纸型略小时溢出成两页 */
export const VOUCHER_ACTUAL_SAFE_MM = 0.5

/**
 * 生成凭证打印文档的 head 与 body（纯函数，便于测试）。
 * papersHtml：各 `.hiprint-printPaper` 的 outerHTML，每个是一张凭证纸。
 */
export function buildVoucherPrintDocument(
  papersHtml: string[],
  opts: { mode: VoucherPaperMode; widthMm: number; heightMm: number }
): { head: string; body: string } {
  const { mode, widthMm, heightMm } = opts
  const base = `<style>${printLockCssRaw}</style>${HIPRINT_PRINT_OVERRIDE_CSS}`
  if (mode === 'actual') {
    const safeH = Math.max(heightMm - VOUCHER_ACTUAL_SAFE_MM, 1)
    return {
      head:
        base +
        `<style>@page{size:${widthMm}mm ${heightMm}mm;margin:0}` +
        `html,body{margin:0;padding:0;background:#fff}` +
        // hiprint 自己已把纸面渲染成「模板高 - 1mm」，这里只封顶、不抬高
        `.hiprint-printPaper{max-height:${safeH}mm!important;overflow:hidden}` +
        `.hiprint-printPaper:last-child{page-break-after:auto!important;break-after:auto!important}</style>`,
      body: `<div class="hiprint-printTemplate">${papersHtml.join('')}</div>`,
    }
  }
  const wPx = +(widthMm * PX_PER_MM).toFixed(2)
  const hPx = +(heightMm * PX_PER_MM).toFixed(2)
  const pages = papersHtml
    .map(
      paper =>
        `<div class="cw-fit-page"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wPx} ${hPx}" ` +
        `width="100%" height="100%" preserveAspectRatio="xMidYMin meet">` +
        `<foreignObject x="0" y="0" width="${wPx}" height="${hPx}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" class="hiprint-printTemplate">${paper}</div>` +
        `</foreignObject></svg></div>`
    )
    .join('')
  return {
    head:
      base +
      // 不写 size：纸型与横纵交给打印面板 / 打印机；页框 = 整页减留白，SVG 等比缩放填满
      `<style>@page{margin:0}html,body{margin:0;padding:0;background:#fff}` +
      `.cw-fit-page{width:100vw;height:100vh;padding:${VOUCHER_FIT_INSET_MM}mm;box-sizing:border-box;` +
      `overflow:hidden;page-break-after:always;break-after:page}` +
      `.cw-fit-page:last-child{page-break-after:auto;break-after:auto}` +
      `.cw-fit-page>svg{display:block;width:100%;height:100%}` +
      `.cw-fit-page .hiprint-printPaper{page-break-after:auto!important;break-after:auto!important}</style>`,
    body: pages,
  }
}

/** 把容器里已渲染（并已防撑高）的凭证纸面按纸张模式送浏览器打印 */
export function printVoucherPapers(
  container: HTMLElement,
  opts: { mode: VoucherPaperMode; widthMm: number; heightMm: number; title?: string }
) {
  const papers = Array.from(container.querySelectorAll<HTMLElement>('.hiprint-printPaper')).map(
    p => p.outerHTML
  )
  if (papers.length === 0) throw new Error('无可打印内容')
  const doc = buildVoucherPrintDocument(papers, opts)
  printHtmlInIframe(doc.head, doc.body, opts.title)
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
