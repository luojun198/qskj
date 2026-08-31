import { describe, expect, it } from 'vitest'
import {
  getDataRowsPerPage,
  normalizePrintTemplateElements,
} from '../printTemplate'

describe('printTemplate normalize', () => {
  it('将旧版对象格式转为元素数组', () => {
    const legacy = {
      title: { type: 'title', text: '记账凭证', fontSize: 20, fontWeight: 'bold', align: 'center' },
      info: { type: 'info', fields: ['voucher_no', 'date'], fontSize: 12 },
      table: {
        type: 'table',
        columns: [
          { field: 'summary', label: '摘要', width: '30%' },
          { field: 'account', label: '会计科目', width: '30%' },
        ],
      },
    }

    const elements = normalizePrintTemplateElements(legacy)
    expect(Array.isArray(elements)).toBe(true)
    expect(elements.length).toBeGreaterThan(0)
    expect(elements.some(el => el.type === 'table')).toBe(true)
    expect(elements.some(el => el.type === 'title')).toBe(true)
  })

  it('printRows 至少保证每页 1 行明细', () => {
    const elements = normalizePrintTemplateElements([
      {
        id: 't1',
        type: 'table',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        fontSize: 12,
        fontWeight: 'normal',
        align: 'left',
        printRows: 1,
        columns: [{ field: 'summary', label: '摘要', width: '100%', visible: true }],
      },
    ])
    const tpl = { elements }
    expect(getDataRowsPerPage(tpl)).toBe(1)
  })
})
