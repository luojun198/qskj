import type { FieldElement, PrintTemplate } from '@/types/print'
import { mmToPt, type HiprintTemplate } from '@/utils/printTemplateHiprint'
import { VOUCHER_TABLE_COLUMNS, VOUCHER_TABLE_FIELD, VOUCHER_TEXT_FIELDS } from '@/utils/hiprintVoucherProvider'

const FIELD_TEST_DATA: Record<string, string> = Object.fromEntries(
  VOUCHER_TEXT_FIELDS.map(f => [f.field, f.testData])
)
import { normalizePrintTemplateElements } from '@/utils/printTemplate'

const FIELD_MAP: Record<string, string> = {
  title: 'doc_title',
  account_set_name: 'account_set_name',
  unit_name: 'account_set_name',
  voucher_no: 'voucher_no_text',
  date: 'date_text',
  attachments: 'attachments_text',
  total_debit: 'total_debit_text',
  total_credit: 'total_credit_text',
  signature_maker: 'maker_text',
  signature_auditor: 'auditor_text',
  signature_poster: 'poster_text',
  signature_supervisor: 'supervisor_text',
}

export function isHiprintTemplate(row: { panel?: unknown } | null | undefined): boolean {
  const panel = row?.panel as { panels?: unknown[] } | null | undefined
  return !!(panel && Array.isArray(panel.panels) && panel.panels.length > 0)
}

export function isLegacyPrintTemplate(row: { panel?: unknown; elements?: unknown } | null | undefined): boolean {
  if (isHiprintTemplate(row)) return false
  const elements = row?.elements
  return Array.isArray(elements) && elements.length > 0
}

function parseColumnWidth(width: string | undefined, tableWidthPt: number, fallbackCount: number): number {
  if (!width) return Math.round(tableWidthPt / Math.max(fallbackCount, 1))
  const trimmed = String(width).trim()
  if (trimmed.endsWith('%')) {
    const pct = Number.parseFloat(trimmed)
    return Number.isFinite(pct) ? Math.round((tableWidthPt * pct) / 100) : Math.round(tableWidthPt / fallbackCount)
  }
  const mm = Number.parseFloat(trimmed)
  return Number.isFinite(mm) && mm > 0 ? mmToPt(mm) : Math.round(tableWidthPt / fallbackCount)
}

function textElement(
  field: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {}
) {
  return {
    options: {
      left: mmToPt(x),
      top: mmToPt(y),
      width: mmToPt(width),
      height: mmToPt(height || 7),
      hideTitle: true,
      ...(field ? { field } : {}),
      ...extra,
    },
    printElementType: { type: 'text' },
  }
}

export function migrateElementsToHiprintPanel(template: {
  paper_width: number
  paper_height: number
  paper_size?: string
  elements?: unknown
}): { panel: HiprintTemplate; warnings: string[] } {
  const warnings: string[] = []
  const elements = normalizePrintTemplateElements(
    template.elements || [],
    template.paper_width,
    template.paper_height
  ) as FieldElement[]

  const printElements: unknown[] = []

  for (const el of elements) {
    if (el.type === 'table') {
      const tableWidthPt = mmToPt(el.width || template.paper_width)
      const cols = (el.columns || []).filter(c => c.visible !== false)
      const mappedCols = (cols.length > 0 ? cols : VOUCHER_TABLE_COLUMNS.map(c => ({
        field: c.field,
        label: c.title,
        width: `${c.width}`,
        align: c.align as 'left' | 'right',
      }))).map(col => ({
        title: col.label || col.field,
        field: col.field === 'account' ? 'account_name' : col.field,
        width: parseColumnWidth(col.width, tableWidthPt, cols.length || 4),
        align: col.align || 'left',
        colspan: 1,
      }))

      printElements.push({
        options: {
          left: mmToPt(el.x),
          top: mmToPt(el.y),
          width: tableWidthPt,
          field: VOUCHER_TABLE_FIELD,
          tableHeaderRepeat: 'first',
          fontSize: el.fontSize || 11,
          columns: [mappedCols],
        },
        printElementType: { type: 'table' },
      })
      continue
    }

    if (el.type === 'total_label' || el.type === 'voucher_type') {
      printElements.push(
        textElement(undefined, el.x, el.y, el.width, el.height, {
          content: el.type === 'total_label' ? '合计' : el.text || '',
          fontSize: el.fontSize || 11,
          fontWeight: el.fontWeight === 'bold' ? '700' : '400',
          textAlign: el.align || 'left',
        })
      )
      continue
    }

    if (el.type === 'text') {
      printElements.push(
        textElement(undefined, el.x, el.y, el.width, el.height, {
          content: el.text || '',
          fontSize: el.fontSize || 11,
          fontWeight: el.fontWeight === 'bold' ? '700' : '400',
          textAlign: el.align || 'left',
        })
      )
      continue
    }

    const field = FIELD_MAP[el.type]
    if (!field) {
      warnings.push(`未识别的元素类型 ${el.type}，已跳过`)
      continue
    }

    printElements.push(
      textElement(field, el.x, el.y, el.width, el.height, {
        fontSize: el.fontSize || 11,
        fontWeight: el.fontWeight === 'bold' ? '700' : '400',
        textAlign: el.align || 'left',
        testData: el.text || FIELD_TEST_DATA[field],
        title: el.text || FIELD_TEST_DATA[field],
      })
    )
  }

  const paperSize = template.paper_size === 'A4' || template.paper_size === 'a4'
    ? 'A4'
    : template.paper_size === 'A5' || template.paper_size === 'a5'
      ? 'A5'
      : 'other'

  return {
    panel: {
      panels: [
        {
          index: 0,
          paperType: paperSize,
          width: template.paper_width,
          height: template.paper_height,
          paperHeader: mmToPt(8),
          paperFooter: mmToPt(Math.max(template.paper_height - 8, 20)),
          printElements,
        },
      ],
    },
    warnings,
  }
}

export function buildUpgradedTemplatePayload(template: PrintTemplate) {
  const { panel, warnings } = migrateElementsToHiprintPanel(template)
  return {
    payload: {
      name: template.name,
      paper_size: String(template.paper_size).toLowerCase() === 'a4' ? 'A4' : String(template.paper_size).toLowerCase() === 'a5' ? 'A5' : template.paper_size,
      paper_width: template.paper_width,
      paper_height: template.paper_height,
      margin_top: template.margin_top,
      margin_bottom: template.margin_bottom,
      margin_left: template.margin_left,
      margin_right: template.margin_right,
      elements: template.elements || [],
      template_type: template.template_type || 'voucher',
      template_key: template.template_key || 'voucher:standard',
      panel,
    },
    warnings,
  }
}
