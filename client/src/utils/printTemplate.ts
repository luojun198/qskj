/**
 * 打印模版工具函数
 */

import type {
  FieldElement,
  FieldElementType,
  PrintTemplate,
  PrintTemplateElements,
  TableColumn,
} from '@/types/print'

function createElementId(type: string): string {
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createFieldElement(
  type: FieldElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<FieldElement> = {}
): FieldElement {
  return {
    id: createElementId(type),
    type,
    x,
    y,
    width,
    height,
    fontSize: 12,
    fontWeight: 'normal',
    align: 'left',
    ...options,
  }
}

function defaultTableColumns(): TableColumn[] {
  return [
    {
      field: 'summary',
      label: '摘要',
      width: '30%',
      align: 'left',
      verticalAlign: 'middle',
      visible: true,
    },
    {
      field: 'account_code',
      label: '科目代码',
      width: '12%',
      align: 'center',
      verticalAlign: 'middle',
      visible: true,
    },
    {
      field: 'account_name',
      label: '科目名称',
      width: '23%',
      align: 'left',
      verticalAlign: 'middle',
      visible: true,
    },
    {
      field: 'debit',
      label: '借方金额',
      width: '17.5%',
      align: 'right',
      verticalAlign: 'middle',
      visible: true,
    },
    {
      field: 'credit',
      label: '贷方金额',
      width: '17.5%',
      align: 'right',
      verticalAlign: 'middle',
      visible: true,
    },
  ]
}

/** 旧版 table.columns 字段映射到新字段 */
function normalizeTableColumns(columns: TableColumn[] | undefined): TableColumn[] {
  if (!columns?.length) return defaultTableColumns()

  return columns.map(col => {
    let field = col.field
    if (field === 'account') field = 'account_name'
    return {
      ...col,
      field,
      visible: col.visible !== false,
      align: col.align || 'left',
      verticalAlign: col.verticalAlign || 'middle',
    }
  })
}

/** 新版设计器预设布局（mm 坐标，适配 220×140 凭证纸） */
export function getDefaultFieldElements(
  legacy?: PrintTemplateElements,
  contentWidth = 200
): FieldElement[] {
  const titleText = legacy?.title?.text || '记账凭证'
  const tableColumns = normalizeTableColumns(legacy?.table?.columns as TableColumn[] | undefined)
  const tableFontSize = legacy?.table?.fontSize || 9

  const presetElements: FieldElement[] = [
    createFieldElement('title', 50, 2, 100, 10, {
      text: titleText,
      fontSize: legacy?.title?.fontSize || 16,
      fontWeight: (legacy?.title?.fontWeight as 'normal' | 'bold') || 'bold',
      align: (legacy?.title?.align as 'left' | 'center' | 'right') || 'center',
    }),
    createFieldElement('account_set_name', 60, 12, 80, 6, {
      fontSize: 9,
      align: 'center',
    }),
    createFieldElement('voucher_no', 0, 20, 50, 6, {
      fontSize: legacy?.info?.fontSize || 9,
      align: 'left',
    }),
    createFieldElement('date', contentWidth - 50, 20, 50, 6, {
      fontSize: legacy?.info?.fontSize || 9,
      align: 'right',
      dateFormat: 'YYYY-MM-DD',
    }),
    createFieldElement('table', 0, 28, contentWidth, 50, {
      fontSize: tableFontSize,
      borderWidth: legacy?.table?.borderWidth || 1,
      showHeader: true,
      rowHeight: 6,
      printRows: 6,
      numberFormat: 'thousand',
      columns: tableColumns,
    }),
  ]

  const sigY = 82
  presetElements.push(
    createFieldElement('signature_maker', 0, sigY, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_auditor', 50, sigY, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_poster', 100, sigY, 45, 6, { fontSize: 9, align: 'center' }),
    createFieldElement('signature_supervisor', 150, sigY, 45, 6, { fontSize: 9, align: 'center' })
  )

  return presetElements
}

function isLegacyTemplateElements(elements: unknown): elements is PrintTemplateElements {
  return !!elements && typeof elements === 'object' && !Array.isArray(elements)
}

/** 将旧版对象格式或空数据转为新版元素数组 */
export function normalizePrintTemplateElements(
  elements: unknown,
  paperWidth = 220,
  paperHeight = 140
): FieldElement[] {
  if (Array.isArray(elements) && elements.length > 0) {
    return elements.map(el => ({
      ...el,
      columns: el.type === 'table' ? normalizeTableColumns(el.columns) : el.columns,
      printRows: el.type === 'table' ? Math.max(2, el.printRows || 6) : el.printRows,
    }))
  }

  if (isLegacyTemplateElements(elements)) {
    const marginLeft = 10
    const marginRight = 10
    const contentWidth = Math.max(100, paperWidth - marginLeft - marginRight)
    void paperHeight
    return getDefaultFieldElements(elements, contentWidth)
  }

  return getDefaultFieldElements()
}

export function normalizePrintTemplate<T extends Pick<PrintTemplate, 'elements' | 'paper_width' | 'paper_height'>>(
  template: T
): T & { elements: FieldElement[] } {
  return {
    ...template,
    elements: normalizePrintTemplateElements(
      template.elements,
      template.paper_width,
      template.paper_height
    ),
  }
}

export function getTableElementFromTemplate(template: Pick<PrintTemplate, 'elements'>): FieldElement | undefined {
  const elements = normalizePrintTemplateElements(template.elements)
  return elements.find(el => el.type === 'table')
}

/** 每页明细行数（不含合计行），至少 1 行 */
export function getDataRowsPerPage(template: Pick<PrintTemplate, 'elements'>): number {
  const tableEl = getTableElementFromTemplate(template)
  const printRows = Math.max(2, tableEl?.printRows || 6)
  return Math.max(1, printRows - 1)
}

/**
 * 获取默认打印模版元素配置（旧版对象结构，仅供历史脚本参考）
 */
export function getDefaultTemplateElements(): PrintTemplateElements {
  return {
    title: {
      type: 'title',
      text: '记账凭证',
      fontSize: 20,
      fontWeight: 'bold',
      align: 'center',
      marginBottom: 10,
    },
    info: {
      type: 'info',
      fields: ['voucher_no', 'date', 'voucher_type', 'attachments'],
      fontSize: 12,
      marginBottom: 10,
    },
    table: {
      type: 'table',
      columns: [
        { field: 'summary', label: '摘要', width: '30%' },
        { field: 'account', label: '会计科目', width: '30%' },
        { field: 'debit', label: '借方金额', width: '20%', align: 'right' },
        { field: 'credit', label: '贷方金额', width: '20%', align: 'right' },
      ],
      fontSize: 12,
      borderWidth: 1,
      marginBottom: 10,
    },
    total: {
      type: 'total',
      fontSize: 12,
      fontWeight: 'bold',
      marginBottom: 15,
    },
    signature: {
      type: 'signature',
      fields: [
        { label: '制单', field: 'created_by' },
        { label: '审核', field: 'auditor' },
        { label: '记账', field: 'poster' },
        { label: '主管', field: 'supervisor' },
      ],
      fontSize: 12,
    },
  }
}

/**
 * 格式化金额（保留两位小数，千分位分隔）
 */
export function formatAmount(amount: number): string {
  if (amount === 0) return '0.00'
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 格式化日期
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}年${month}月${day}日`
}

/**
 * 获取纸张尺寸（mm）
 */
export function getPaperSize(size: string): { width: number; height: number } {
  switch (size) {
    case 'A4':
      return { width: 210, height: 297 }
    case 'A5':
      return { width: 148, height: 210 }
    default:
      return { width: 220, height: 140 }
  }
}

/** 在独立窗口中打印指定选择器的内容，避免对话框遮罩导致卡死 */
export function openPrintWindow(options: {
  itemSelector: string
  title?: string
  expandSelector?: string
}) {
  const printItems = document.querySelectorAll(options.itemSelector)
  if (!printItems.length) {
    throw new Error('未找到可打印的内容')
  }

  const contents = Array.from(printItems)
    .map(el => el.outerHTML)
    .join('\n')

  const allStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map(el => el.outerHTML)
    .join('\n')

  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    if (options.expandSelector) {
      const previewArea = document.querySelector(options.expandSelector) as HTMLElement | null
      if (previewArea) {
        previewArea.style.setProperty('height', 'auto', 'important')
        previewArea.style.setProperty('overflow', 'visible', 'important')
        previewArea.style.setProperty('max-height', 'none', 'important')
      }
    }
    void document.body.offsetHeight
    window.print()
    return
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${options.title || '打印'}</title>
      ${allStyles}
      <style>
        @page { margin: 0; }
        body {
          font-family: 'SimSun', 'STSong', serif;
          font-size: 12pt;
          margin: 0;
          padding: 20px;
          background: #fff;
        }
        .preview-item {
          page-break-after: always;
          margin-bottom: 0;
        }
        .preview-item:last-child {
          page-break-after: auto;
        }
      </style>
    </head>
    <body>
      ${contents}
      <script>
        window.onload = function() { window.print(); window.close(); }
      <\/script>
    </body>
    </html>
  `)
  printWindow.document.close()
}

/**
 * 触发浏览器打印（兼容旧调用）
 */
export function triggerPrint() {
  window.print()
}
