import { readElTable } from './exportElTable'
import { exportDocSheet, type DocSheetSection } from './exportStyledExcel'

/**
 * 单据页「另存」：把页面当前显示的单据整张导出（所见即所得）。
 *
 * 适用于所有单据的编辑 / 查看页（进销存单据、订单变更、工单、质检、BOM……），不必逐页写字段定义：
 * - 表头字段：页面里可见的 el-form-item（标签 + 当前显示值：输入框、下拉、日期、单选 / 复选）；
 * - 明细：页面里可见的 el-table（不含弹窗、下拉里的表格），每张一节，带表尾合计；
 *   表格或其上层带 data-export-title 时用作小节标题。
 */

const EXCLUDE = '.el-dialog, .el-drawer, .el-popper, .el-popover, .el-message-box, [data-export-ignore]'

const visible = (el: Element) => (el as HTMLElement).offsetParent !== null && !el.closest(EXCLUDE)

const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()

/** 表单项当前显示的值 */
export function readFormItemValue(content: Element): string {
  const parts: string[] = []
  const select = content.querySelector('.el-select')
  if (select) {
    const tags = Array.from(select.querySelectorAll('.el-select__tags-text, .el-tag .el-tag__content')).map(t => clean(t.textContent)).filter(Boolean)
    if (tags.length) parts.push(tags.join('、'))
    else {
      const ph = select.querySelector('.el-select__placeholder')
      const placeholder = (select.querySelector('input') as HTMLInputElement | null)?.placeholder || ''
      const text = clean(ph?.textContent)
      // 没选值时显示的是占位提示（部分版本不带 is-transparent），不能当成值导出
      if (ph && !ph.classList.contains('is-transparent') && text && text !== placeholder && !/^请(选择|输入)/.test(text)) parts.push(text)
      else {
        const input = select.querySelector('input') as HTMLInputElement | null
        if (input?.value) parts.push(clean(input.value))
      }
    }
  }
  const radios = Array.from(content.querySelectorAll('.el-radio.is-checked, .el-radio-button.is-active')).map(r => clean(r.textContent))
  if (radios.length) parts.push(radios.join('、'))
  const checks = Array.from(content.querySelectorAll('.el-checkbox.is-checked')).map(c => clean(c.textContent)).filter(Boolean)
  if (checks.length) parts.push(checks.join('、'))
  const inputs = Array.from(content.querySelectorAll('input, textarea')).filter(i => {
    const el = i as HTMLInputElement
    return !el.closest('.el-select') && !['checkbox', 'radio', 'hidden', 'file'].includes(el.type) && el.offsetParent !== null
  }) as HTMLInputElement[]
  const values = inputs.map(i => clean(i.value)).filter(Boolean)
  if (values.length) parts.push(values.join(inputs.some(i => i.closest('.el-range-editor')) ? ' 至 ' : ' '))
  if (!parts.length && !select && !inputs.length) {
    // 纯文本展示（查看态常用 span / tag），去掉按钮与图标
    const clone = content.cloneNode(true) as HTMLElement
    clone.querySelectorAll('button, .el-button, .el-icon, .el-form-item__error, svg').forEach(n => n.remove())
    const text = clean(clone.textContent)
    if (text) parts.push(text)
  }
  return parts.join(' ')
}

export function collectDocFields(scope: HTMLElement): Array<{ label: string; value: string }> {
  return Array.from(scope.querySelectorAll('.el-form-item'))
    .filter(item => visible(item) && !item.closest('.el-table'))
    .map(item => {
      const label = clean(item.querySelector('.el-form-item__label')?.textContent).replace(/[:：*]+$/, '').replace(/^\*/, '')
      const content = item.querySelector('.el-form-item__content')
      return { label, value: content ? readFormItemValue(content) : '' }
    })
    .filter(f => f.label)
}

export function collectDocTables(scope: HTMLElement): DocSheetSection[] {
  const tables = Array.from(scope.querySelectorAll<HTMLElement>('.el-table'))
    .filter(t => visible(t) && !t.parentElement?.closest('.el-table'))
  const sections: DocSheetSection[] = []
  tables.forEach((t, i) => {
    const data = readElTable(t)
    if (!data) return
    const titled = t.closest('[data-export-title]') as HTMLElement | null
    let rows = data.rows
    let summary = data.summary
    // 单据明细常把「合计」画成表体最后一行（而非 el-table 表尾），按合计行输出
    const last = rows[rows.length - 1]
    if (!summary && last && last.slice(0, 3).some(v => v === '合计')) {
      summary = last
      rows = rows.slice(0, -1)
    }
    sections.push({
      title: titled?.dataset.exportTitle || (tables.length > 1 ? `明细${i + 1}` : undefined),
      columns: data.columns,
      rows,
      summary,
    })
  })
  return sections
}

/** 导出页面上的单据；没有任何字段和明细时返回 false */
export async function exportDocPage(scope: HTMLElement, options: { title: string; fileName: string; footer?: string }): Promise<boolean> {
  const fields = collectDocFields(scope)
  const sections = collectDocTables(scope)
  if (!fields.length && !sections.length) return false
  await exportDocSheet({ fileName: options.fileName, title: options.title, fields, sections, footer: options.footer })
  return true
}
