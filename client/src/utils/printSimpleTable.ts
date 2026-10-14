/**
 * 通用列表打印：把「标题 + 表格 + 合计行」写入隐藏 iframe 后调用打印，
 * 只打印数据本身（window.print() 会把导航、工具条一起打出来）。
 * 表格带完整网格线，横向内容较多时自动用横向纸张。
 */
export interface PrintColumn<T = any> {
  label: string
  align?: 'left' | 'center' | 'right'
  value: (row: T) => string | number | null | undefined
}

export interface PrintSimpleTableOptions<T = any> {
  title: string
  subtitle?: string
  columns: PrintColumn<T>[]
  rows: T[]
  /** 合计行，与 columns 一一对应 */
  summary?: Array<string | number | null | undefined>
  /** 列数超过该值时横向打印，默认 8 */
  landscapeOver?: number
}

const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildPrintTableHtml<T>(opts: PrintSimpleTableOptions<T>): string {
  const landscape = opts.columns.length > (opts.landscapeOver ?? 8)
  const cell = (tag: 'th' | 'td', text: unknown, align?: string) =>
    `<${tag}${align && align !== 'left' ? ` style="text-align:${align}"` : ''}>${esc(text)}</${tag}>`
  const head = opts.columns.map(c => cell('th', c.label, 'center')).join('')
  const body = opts.rows.map(r => `<tr>${opts.columns.map(c => cell('td', c.value(r), c.align)).join('')}</tr>`).join('')
  const foot = opts.summary
    ? `<tr class="sum">${opts.columns.map((c, i) => cell('td', opts.summary![i], c.align)).join('')}</tr>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>
@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm 10mm; }
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 11px; color: #000; margin: 0; }
h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
.sub { text-align: center; font-size: 11px; margin-bottom: 8px; color: #333; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #000; padding: 3px 4px; word-break: break-all; }
th { background: #f0f0f0; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
tr.sum td { font-weight: bold; }
</style></head><body>
<h1>${esc(opts.title)}</h1>${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}${foot}</tbody></table>
</body></html>`
}

export function printSimpleTable<T>(opts: PrintSimpleTableOptions<T>): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { iframe.remove(); return }
  doc.open()
  doc.write(buildPrintTableHtml(opts))
  doc.close()
  const cleanup = () => setTimeout(() => iframe.remove(), 1000)
  iframe.contentWindow!.onafterprint = cleanup
  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    cleanup()
  }, 50)
}
