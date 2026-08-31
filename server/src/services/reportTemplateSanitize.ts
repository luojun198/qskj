import ExcelJS from 'exceljs'
import JSZip from 'jszip'

export type SheetBounds = {
  minRow: number
  maxRow: number
  minCol: number
  maxCol: number
}

/** 模板中实际有内容/公式的单元格（不含仅带边框的空格） */
export function isTemplateDataCell(cell: ExcelJS.Cell): boolean {
  const value = cell.value
  if (value == null || value === '') return false
  if (typeof value === 'object') {
    const v = value as {
      formula?: unknown
      sharedFormula?: unknown
      richText?: Array<{ text?: string }>
      text?: string
      result?: unknown
    }
    if (v.formula != null || v.sharedFormula != null) return true
    if (Array.isArray(v.richText) && v.richText.some(seg => seg.text?.trim())) return true
    if (v.text != null && String(v.text).trim() !== '') return true
    if (v.result != null && String(v.result).trim() !== '') return true
    return false
  }
  return true
}

export function collectTemplateDataCellKeys(worksheet: ExcelJS.Worksheet): Set<string> {
  const keys = new Set<string>()
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (isTemplateDataCell(cell)) {
        keys.add(`${rowNumber - 1}:${colNumber - 1}`)
      }
    })
  })
  return keys
}

export function computeWorksheetBounds(worksheet: ExcelJS.Worksheet): SheetBounds | null {
  let minRow = Infinity
  let maxRow = -1
  let minCol = Infinity
  let maxCol = -1

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!isTemplateDataCell(cell)) return
      const r = rowNumber - 1
      const c = colNumber - 1
      if (r < minRow) minRow = r
      if (r > maxRow) maxRow = r
      if (c < minCol) minCol = c
      if (c > maxCol) maxCol = c
    })
  })

  if (maxRow < 0) return null
  return { minRow, maxRow, minCol, maxCol }
}

/** 清除内容区外的单元格，避免 Excel 渲染多余网格，且不破坏区内样式 */
export function clearWorksheetOutsideBounds(worksheet: ExcelJS.Worksheet, bounds: SheetBounds) {
  const maxRow1 = bounds.maxRow + 1
  const maxCol1 = bounds.maxCol + 1

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > maxRow1) {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.value = null
        cell.style = {}
      })
      return
    }

    for (let colNumber = maxCol1 + 1; colNumber <= worksheet.columnCount; colNumber++) {
      const cell = row.getCell(colNumber)
      cell.value = null
      cell.style = {}
    }
  })

  if (Array.isArray(worksheet.columns) && worksheet.columns.length > maxCol1) {
    worksheet.columns = worksheet.columns.slice(0, maxCol1)
  }

  const model = (
    worksheet as ExcelJS.Worksheet & {
      model?: { rows?: unknown[]; cols?: unknown[] }
    }
  ).model
  if (model?.rows && model.rows.length > maxRow1) {
    model.rows = model.rows.slice(0, maxRow1)
  }
  if (model?.cols && Array.isArray(model.cols) && model.cols.length > maxCol1) {
    model.cols = model.cols.slice(0, maxCol1)
  }
}

export type SanitizeTemplateOptions = {
  /** 保留的 sheet 名（不含"(定义)"后缀）；不指定时保留首个 sheet */
  keepSheetName?: string
}

/**
 * 净化报表模板工作簿：
 *   1. 仅保留首个（或指定）sheet，删除其他 sheet 及其引用
 *   2. 计算保留 sheet 的内容边界，清除边界外的脏数据/样式
 *   3. 清理跨 sheet 的 definedNames（保留指向保留 sheet 的）
 *
 * 返回净化后的 xlsx Buffer。
 */
export async function sanitizeTemplateWorkbook(
  buffer: Buffer,
  options: SanitizeTemplateOptions = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)

  if (workbook.worksheets.length === 0) {
    return buffer
  }

  // 1) 选定要保留的 sheet
  const trimName = (s: string) => s.replace(/\(定义\)$/g, '').trim()
  const keepName = options.keepSheetName ? trimName(options.keepSheetName) : null

  let keptSheet: ExcelJS.Worksheet | null = null
  if (keepName) {
    keptSheet =
      workbook.getWorksheet(keepName) ||
      workbook.worksheets.find(ws => trimName(ws.name) === keepName) ||
      null
  }
  if (!keptSheet) {
    keptSheet = workbook.worksheets[0]
  }

  // 2) 删除其余 sheet
  const keepId = keptSheet.id
  const toRemove = workbook.worksheets
    .filter(ws => ws.id !== keepId)
    .map(ws => ws.id)
  for (const id of toRemove) {
    workbook.removeWorksheet(id)
  }

  // 3) 清除保留 sheet 边界外的脏数据
  const bounds = computeWorksheetBounds(keptSheet)
  if (bounds) {
    clearWorksheetOutsideBounds(keptSheet, bounds)
  }

  // 3b) 关闭保留 sheet 的网格线显示（财务报表通常用显式边框，不显示默认网格）
  const sheetWithViews = keptSheet as ExcelJS.Worksheet & {
    views?: Array<{ showGridLines?: boolean }>
  }
  if (Array.isArray(sheetWithViews.views) && sheetWithViews.views.length > 0) {
    sheetWithViews.views = sheetWithViews.views.map(v => ({ ...v, showGridLines: false }))
  } else {
    sheetWithViews.views = [{ showGridLines: false }]
  }

  // 4) 清理 definedNames：ExcelJS 把 defined names 挂在 cell 上，
  //    删除其他 sheet 后框架已自动清理对应引用；这里再保险一遍。
  const workbookModel = (workbook as ExcelJS.Workbook & {
    definedNames?: { model?: Array<{ name: string; ranges: string[] }> }
  }).definedNames
  const defModel = workbookModel?.model
  if (Array.isArray(defModel)) {
    const sheetName = keptSheet.name
    const escapedName = sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const entry of defModel) {
      entry.ranges = entry.ranges.filter(range => {
        const m = range.match(/^'?([^'!]+)'?!/)
        if (!m) return true
        return m[1] === sheetName || m[1].replace(/''/g, "'") === sheetName
      })
      void escapedName
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  const ejsBuffer = Buffer.from(arrayBuffer)

  // 5) 通过 JSZip 做最终 XML 级裁剪：修正 dimension、删除超界 col/row/cell/mergeCell。
  //    ExcelJS 写出时可能保留原 dimension 与列定义，导致 Excel 显示的"使用范围"仍延伸到脏区。
  if (!bounds) return ejsBuffer
  return await trimXlsxToBounds(ejsBuffer, bounds)
}

function columnIndexToLetters(colIndex: number): string {
  let n = colIndex + 1
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

function columnLettersToNumber(colLetters: string): number {
  let n = 0
  for (const ch of colLetters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

function boundsToDimensionRef(bounds: SheetBounds): string {
  const start = `${columnIndexToLetters(bounds.minCol)}${bounds.minRow + 1}`
  const end = `${columnIndexToLetters(bounds.maxCol)}${bounds.maxRow + 1}`
  return `${start}:${end}`
}

/** 对 xlsx 保留 sheet 的 XML 做最终裁剪（dimension / cols / rows / mergeCells）。 */
async function trimXlsxToBounds(buffer: Buffer, bounds: SheetBounds): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  // 保留 sheet 已经是唯一 sheet（前面已 removeWorksheet），定位它的 worksheet xml
  const sheetFiles = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort()
  if (sheetFiles.length === 0) return buffer

  const maxRow1 = bounds.maxRow + 1
  const maxCol1 = bounds.maxCol + 1
  const ref = boundsToDimensionRef(bounds)

  // 仅处理第一个（也应是唯一的）worksheet xml
  const sheetPath = sheetFiles[0]
  const file = zip.files[sheetPath]
  if (!file) return buffer
  let xml = await file.async('string')

  // dimension
  if (/<dimension[^>]*\sref="/i.test(xml)) {
    xml = xml.replace(/(<dimension[^>]*\sref=")[^"]*(")/i, `$1${ref}$2`)
  } else {
    xml = xml.replace(/<sheetViews/i, `<dimension ref="${ref}"/>\n<sheetViews`)
  }

  // cols：保留 min <= maxCol1 的列定义，并追加一条隐藏列覆盖到 XFD（列 16384），
  // 让 Excel/WPS 物理上不渲染右侧空列，彻底消除"多余网格"。
  const XLSX_MAX_COL = 16384
  const hiddenTrailingCol =
    maxCol1 < XLSX_MAX_COL
      ? `<col min="${maxCol1 + 1}" max="${XLSX_MAX_COL}" width="0" hidden="1" customWidth="1"/>`
      : ''
  const colsReplacer = (full: string) => {
    const colTags = [...full.matchAll(/<col\b[^/]*\/>/g)].map(match => match[0])
    const kept = colTags
      .filter(tag => {
        const min = Number(tag.match(/\bmin="(\d+)"/)?.[1] ?? 1)
        return min <= maxCol1
      })
      .map(tag =>
        tag.replace(/\bmax="(\d+)"/, (_, max) => `max="${Math.min(Number(max), maxCol1)}"`)
      )
    return `<cols>${kept.join('')}${hiddenTrailingCol}</cols>`
  }
  if (/<cols>[\s\S]*?<\/cols>/.test(xml)) {
    xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, colsReplacer)
  } else if (hiddenTrailingCol) {
    // 模板原本没有 <cols>，仍插入隐藏尾列
    xml = xml.replace(/<sheetData/, `<cols>${hiddenTrailingCol}</cols><sheetData`)
  }

  // mergeCells：丢弃越界合并
  xml = xml.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, block => {
    const items = [...block.matchAll(/<mergeCell ref="([^"]+)"/g)]
      .map(match => match[1])
      .filter(refValue => {
        const [startRef, endRef = startRef] = refValue.split(':')
        const startCol = columnLettersToNumber(startRef.replace(/\d+/g, ''))
        const endCol = columnLettersToNumber(endRef.replace(/\d+/g, ''))
        const startRow = Number(startRef.replace(/[A-Z]+/gi, ''))
        const endRow = Number(endRef.replace(/[A-Z]+/gi, ''))
        return startCol <= maxCol1 && endCol <= maxCol1 && startRow <= maxRow1 && endRow <= maxRow1
      })
    if (items.length === 0) return ''
    return `<mergeCells count="${items.length}">${items
      .map(refValue => `<mergeCell ref="${refValue}"/>`)
      .join('')}</mergeCells>`
  })

  // rows / cells：超 maxRow1 的整行丢掉；行内列号 > maxCol1 的 cell 丢掉
  xml = xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (rowXml, rowNumStr) => {
    const rowNum = Number(rowNumStr)
    if (rowNum > maxRow1) return ''

    let row = rowXml.replace(/\bspans="(\d+):(\d+)"/, (_, start, end) => {
      return `spans="${start}:${Math.min(Number(end), maxCol1)}"`
    })

    row = row.replace(/<c r="([A-Z]+)(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi, cellXml => {
      const refMatch = cellXml.match(/<c r="([A-Z]+)/i)
      if (!refMatch) return cellXml
      return columnLettersToNumber(refMatch[1]) > maxCol1 ? '' : cellXml
    })

    return row
  })

  zip.file(sheetPath, xml)

  return Buffer.from(
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  )
}
