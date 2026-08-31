/**
 * hiprint 默认模板构造（凭证）。
 * 用户可在「打印模版管理 → 套打设计器」里基于此默认模板拖拽微调、叠加底图。
 */
import type { HiprintTemplate } from '@/utils/printTemplateHiprint'
import type { VoucherPrintData } from '@/types/print'

const PX_PER_MM = 3.7795275591
const mm = (v: number) => Math.round(v * PX_PER_MM)

function fmtAmount(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return ''
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * 把后端 VoucherPrintData 转换成 hiprint 打印数据（扁平对象 + entries 表格数组）。
 */
export function voucherToHiprintData(v: VoucherPrintData): Record<string, unknown> {
  const entries = (v.pageEntries || v.entries || []).map(e => ({
    summary: e.summary || '',
    account_name: e.account_name || '',
    account_code: e.account_code || '',
    debit: fmtAmount(e.debit),
    credit: fmtAmount(e.credit),
  }))
  return {
    doc_title: '记 账 凭 证',
    account_set_name: v.account_set_name || '',
    voucher_no_text: `${v.voucher_type || '记'}-${v.voucher_no || ''}`,
    date_text: v.date || '',
    attachments_text: v.attachments ? `附单据 ${v.attachments} 张` : '',
    entries,
    total_debit_text: fmtAmount(v.pageDebit ?? v.total_debit),
    total_credit_text: fmtAmount(v.pageCredit ?? v.total_credit),
    maker_text: `制单：${v.maker || v.created_by || ''}`,
    auditor_text: `审核：${v.auditor || ''}`,
    poster_text: `记账：${v.poster || ''}`,
    supervisor_text: `主管：${v.supervisor || ''}`,
  }
}

/**
 * 记账凭证默认 hiprint 模板（A5 横向 210×148mm 近似常见凭证纸）。
 * 字段全部绑定到 voucherToHiprintData 的 key，便于叠加在底图上做套打。
 */
export function buildDefaultVoucherPanel(): HiprintTemplate {
  const W = 210
  const H = 148
  const left = mm(12)
  const right = mm(W - 12)
  const innerW = right - left

  const text = (
    field: string,
    l: number,
    t: number,
    w: number,
    extra: Record<string, unknown> = {}
  ) => ({
    options: {
      left: l,
      top: t,
      height: mm(7),
      width: w,
      field,
      fontSize: 11,
      hideTitle: true,
      ...extra,
    },
    printElementType: { type: 'text' },
  })

  return {
    panels: [
      {
        index: 0,
        paperType: 'other',
        width: W,
        height: H,
        paperHeader: mm(8),
        paperFooter: mm(H - 8),
        printElements: [
          // 标题
          text('doc_title', left, mm(8), innerW, {
            fontSize: 20,
            fontWeight: 'bold',
            textAlign: 'center',
            letterSpacing: 4,
          }),
          // 单位 / 凭证字号 / 日期
          text('account_set_name', left, mm(20), mm(70)),
          text('voucher_no_text', mm(W - 70), mm(20), mm(58), { textAlign: 'right' }),
          text('date_text', mm(W / 2 - 25), mm(20), mm(50), { textAlign: 'center' }),
          // 分录表
          {
            options: {
              left,
              top: mm(28),
              width: innerW,
              field: 'entries',
              tableHeaderRepeat: 'first',
              fontSize: 11,
              columns: [
                [
                  { title: '摘要', field: 'summary', width: innerW * 0.32, align: 'left', colspan: 1 },
                  { title: '会计科目', field: 'account_name', width: innerW * 0.32, align: 'left', colspan: 1 },
                  { title: '借方金额', field: 'debit', width: innerW * 0.18, align: 'right', colspan: 1 },
                  { title: '贷方金额', field: 'credit', width: innerW * 0.18, align: 'right', colspan: 1 },
                ],
              ],
            },
            printElementType: { type: 'table' },
          },
          // 合计（对齐借方/贷方两列）
          text('total_debit_text', left + Math.round(innerW * 0.64), mm(108), Math.round(innerW * 0.18), { textAlign: 'right' }),
          text('total_credit_text', left + Math.round(innerW * 0.82), mm(108), Math.round(innerW * 0.18), { textAlign: 'right' }),
          // 页脚签名
          text('maker_text', left, mm(120), mm(45)),
          text('auditor_text', mm(60), mm(120), mm(45)),
          text('poster_text', mm(110), mm(120), mm(45)),
          text('supervisor_text', mm(155), mm(120), mm(45)),
          text('attachments_text', mm(W - 60), mm(20), mm(48), { textAlign: 'right', fontSize: 10 }),
        ],
      },
    ],
  }
}
