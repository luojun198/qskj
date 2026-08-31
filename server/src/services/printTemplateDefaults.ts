import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'

/** 默认批量/凭证打印模版名称 */
export const DEFAULT_BATCH_PRINT_TEMPLATE_NAME = '标准模版'

const CONTENT_WIDTH_MM = 200

export interface DefaultPrintTemplateConfig {
  name: string
  paper_size: 'custom'
  paper_width: number
  paper_height: number
  margin_top: number
  margin_bottom: number
  margin_left: number
  margin_right: number
  elements: unknown[]
}

function elementId(prefix: string, seq: number, salt: string): string {
  return `${prefix}_${salt}_${seq}`
}

/** 构建标准凭证打印模版元素（220×140mm 紧凑布局，供单张/批量打印共用） */
export function buildStandardBatchPrintTemplateElements(salt = String(Date.now())): unknown[] {
  let seq = 0
  const uid = (prefix: string) => elementId(prefix, seq++, salt)
  const CW = CONTENT_WIDTH_MM

  return [
    {
      id: uid('title'),
      type: 'title',
      x: 50,
      y: 0,
      width: 100,
      height: 9,
      fontSize: 16,
      fontWeight: 'bold',
      align: 'center',
      text: '记 账 凭 证',
    },
    {
      id: uid('account_set_name'),
      type: 'account_set_name',
      x: 60,
      y: 10,
      width: 80,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'center',
    },
    {
      id: uid('text_decor'),
      type: 'text',
      x: 0,
      y: 16,
      width: CW,
      height: 3,
      fontSize: 5,
      fontWeight: 'normal',
      align: 'center',
      text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    },
    {
      id: uid('text_seq_label'),
      type: 'text',
      x: 0,
      y: 21,
      width: 18,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'right',
      text: '凭证字号：',
    },
    {
      id: uid('voucher_no'),
      type: 'voucher_no',
      x: 19,
      y: 21,
      width: 40,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_date_label'),
      type: 'text',
      x: 140,
      y: 21,
      width: 18,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'right',
      text: '日　　期：',
    },
    {
      id: uid('date'),
      type: 'date',
      x: 159,
      y: 21,
      width: 41,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
      dateFormat: 'YYYY年MM月DD日',
    },
    {
      id: uid('text_unit_label'),
      type: 'text',
      x: 0,
      y: 28,
      width: 18,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'right',
      text: '单位名称：',
    },
    {
      id: uid('unit_name'),
      type: 'unit_name',
      x: 19,
      y: 28,
      width: 70,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_attach_label'),
      type: 'text',
      x: 140,
      y: 28,
      width: 18,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'right',
      text: '附件张数：',
    },
    {
      id: uid('attachments'),
      type: 'attachments',
      x: 159,
      y: 28,
      width: 12,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_attach_suffix'),
      type: 'text',
      x: 172,
      y: 28,
      width: 6,
      height: 5,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
      text: '张',
    },
    {
      id: uid('table'),
      type: 'table',
      x: 0,
      y: 35,
      width: CW,
      height: 45,
      fontSize: 9,
      fontWeight: 'normal',
      align: 'left',
      borderWidth: 1,
      rowHeight: 6,
      printRows: 6,
      showHeader: true,
      numberFormat: 'thousand',
      columns: [
        { field: 'summary', label: '摘　　要', width: '30%', align: 'left', visible: true },
        { field: 'account_code', label: '科目代码', width: '12%', align: 'center', visible: true },
        { field: 'account_name', label: '科目名称', width: '23%', align: 'left', visible: true },
        { field: 'debit', label: '借方金额', width: '17.5%', align: 'right', visible: true },
        { field: 'credit', label: '贷方金额', width: '17.5%', align: 'right', visible: true },
      ],
    },
    {
      id: uid('text_maker_label'),
      type: 'text',
      x: 0,
      y: 84,
      width: 12,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'right',
      text: '制单：',
    },
    {
      id: uid('signature_maker'),
      type: 'signature_maker',
      x: 13,
      y: 84,
      width: 30,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_auditor_label'),
      type: 'text',
      x: 50,
      y: 84,
      width: 12,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'right',
      text: '审核：',
    },
    {
      id: uid('signature_auditor'),
      type: 'signature_auditor',
      x: 63,
      y: 84,
      width: 30,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_poster_label'),
      type: 'text',
      x: 100,
      y: 84,
      width: 12,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'right',
      text: '记账：',
    },
    {
      id: uid('signature_poster'),
      type: 'signature_poster',
      x: 113,
      y: 84,
      width: 30,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_supervisor_label'),
      type: 'text',
      x: 150,
      y: 84,
      width: 12,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'right',
      text: '主管：',
    },
    {
      id: uid('signature_supervisor'),
      type: 'signature_supervisor',
      x: 163,
      y: 84,
      width: 30,
      height: 5,
      fontSize: 8,
      fontWeight: 'normal',
      align: 'left',
    },
    {
      id: uid('text_bottom_decor'),
      type: 'text',
      x: 0,
      y: 92,
      width: CW,
      height: 3,
      fontSize: 5,
      fontWeight: 'normal',
      align: 'center',
      text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    },
  ]
}

/** 默认批量打印模版完整配置 */
export function buildDefaultBatchPrintTemplateConfig(): DefaultPrintTemplateConfig {
  return {
    name: DEFAULT_BATCH_PRINT_TEMPLATE_NAME,
    paper_size: 'custom',
    paper_width: 220,
    paper_height: 140,
    margin_top: 10,
    margin_bottom: 10,
    margin_left: 10,
    margin_right: 10,
    elements: buildStandardBatchPrintTemplateElements(),
  }
}

function hasPrintTemplatesTable(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='print_templates'`)
    .get() as { name?: string } | undefined
  return Boolean(row?.name)
}

/**
 * 为账套确保存在默认批量打印模版（幂等）。
 * 若已有 is_default=1 的模版则跳过；若仅有非默认模版仍会补建默认模版。
 */
export function ensureDefaultPrintTemplateForAccountSet(
  db: Database.Database,
  accountSetId: string
): { created: boolean; id?: string } {
  if (!hasPrintTemplatesTable(db)) {
    return { created: false }
  }

  const existingDefault = db
    .prepare(
      `SELECT id FROM print_templates WHERE account_set_id = ? AND is_default = 1 LIMIT 1`
    )
    .get(accountSetId) as { id?: string } | undefined

  if (existingDefault?.id) {
    return { created: false, id: existingDefault.id }
  }

  const config = buildDefaultBatchPrintTemplateConfig()
  const templateId = uuidv4()
  const elementsJson = JSON.stringify(config.elements)
  const cols = db.prepare(`PRAGMA table_info(print_templates)`).all() as Array<{ name: string }>
  const colNames = new Set(cols.map(c => c.name))
  const hasTimestamps = colNames.has('created_at') && colNames.has('updated_at')

  if (hasTimestamps) {
    db.prepare(
      `INSERT INTO print_templates
       (id, account_set_id, name, paper_size, paper_width, paper_height,
        margin_top, margin_bottom, margin_left, margin_right, elements, is_default,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).run(
      templateId,
      accountSetId,
      config.name,
      config.paper_size,
      config.paper_width,
      config.paper_height,
      config.margin_top,
      config.margin_bottom,
      config.margin_left,
      config.margin_right,
      elementsJson
    )
  } else {
    db.prepare(
      `INSERT INTO print_templates
       (id, account_set_id, name, paper_size, paper_width, paper_height,
        margin_top, margin_bottom, margin_left, margin_right, elements, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      templateId,
      accountSetId,
      config.name,
      config.paper_size,
      config.paper_width,
      config.paper_height,
      config.margin_top,
      config.margin_bottom,
      config.margin_left,
      config.margin_right,
      elementsJson
    )
  }

  return { created: true, id: templateId }
}
