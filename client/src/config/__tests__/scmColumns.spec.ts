import { describe, it, expect } from 'vitest'
import { LIST_ALL_COLS, LIST_OPT_COLS, LIST_CUSTOM_COL_PREFIX, listColsForType } from '../scmColumns'

const keysOf = (cols: Array<{ key: string }>) => cols.map(c => c.key)

describe('listColsForType', () => {
  it('未配置字段的类型（库里 header_fields/line_fields 为 NULL，如销售出库）：客户/仓库/业务员/价税合计等全部可用', () => {
    const keys = keysOf(listColsForType('SO', { header_fields: null, line_fields: null }))
    for (const k of ['partner', 'warehouse', 'biz_person', 'dept_code', 'contract_no', 'payment_type', 'invoice_no', 'currency', 'total_with_tax', 'total_tax',
      'io_category', 'settle_account', 'invoice_type', 'invoice_date', 'exchange_rate', 'due_date', 'created_at', 'audited_at', 'updated_at', 'source_doc_no', 'voucher_no', 'print_count']) {
      expect(keys, k).toContain(k)
    }
  })

  it('类型记录不存在（undefined）也按未配置处理', () => {
    expect(keysOf(listColsForType('SO', undefined))).toContain('partner')
  })

  it('特定类型下不出现仅「全部」视图有意义的「类型」列，也不出现仅 TR 的「调入仓库」', () => {
    const keys = keysOf(listColsForType('SO', undefined))
    expect(keys).not.toContain('doc_type')
    expect(keys).not.toContain('dest_warehouse')
    expect(keysOf(listColsForType('TR', undefined))).toContain('dest_warehouse')
  })

  it('「全部」视图：所有标准列都可用，自定义字段不出现', () => {
    const cols = listColsForType('', undefined, [{ field_key: 'x', field_name: 'X', position: 'header' }])
    expect(keysOf(cols)).toEqual(LIST_ALL_COLS.map(c => c.key).filter(k => !k.startsWith('pl_')))
  })

  it('已配置的类型（付款单 PAY）仍按 header_fields 白名单：有往来单位/付款方式/结算方式/币别，无仓库/业务员/价税合计', () => {
    const keys = keysOf(listColsForType('PAY', {
      header_fields: JSON.stringify(['partner', 'payment', 'settle_account', 'currency', 'remark']),
      line_fields: JSON.stringify(['source_doc', 'amount', 'remark']),
    }))
    expect(keys).toEqual(expect.arrayContaining(['partner', 'payment_type', 'settle_account', 'currency', 'exchange_rate', 'remark']))
    expect(keys).not.toContain('warehouse')
    expect(keys).not.toContain('biz_person')
    expect(keys).not.toContain('total_with_tax')
    // 与配置无关的通用列始终可用
    expect(keys).toEqual(expect.arrayContaining(['doc_no', 'doc_date', 'total_amount', 'maker', 'auditor', 'status', 'source_doc_no', 'voucher_no']))
  })

  it("header_fields 明确声明为 '[]' 视为已配置且无表头字段（缺料单 MR）", () => {
    const keys = keysOf(listColsForType('MR', { header_fields: '[]', line_fields: null }))
    expect(keys).not.toContain('partner')
    expect(keys).not.toContain('warehouse')
    expect(keys).toContain('doc_no')
  })

  it('价税合计/税额：line_fields 已配置但不含税列时不可用，含 tax_amount 时可用', () => {
    expect(keysOf(listColsForType('RS', { header_fields: null, line_fields: JSON.stringify(['item', 'qty']) }))).not.toContain('total_with_tax')
    expect(keysOf(listColsForType('RS', { header_fields: null, line_fields: JSON.stringify(['item', 'qty', 'tax_amount']) }))).toContain('total_with_tax')
  })

  it('下推数量与已下推金额仅对有下推链路的类型可用', () => {
    expect(keysOf(listColsForType('SOa', undefined))).toEqual(expect.arrayContaining(['push', 'push_amount']))
    expect(keysOf(listColsForType('PO', undefined))).toEqual(expect.arrayContaining(['push', 'push_amount']))
    expect(keysOf(listColsForType('MR', undefined))).toEqual(expect.arrayContaining(['push', 'push_amount']))
    expect(keysOf(listColsForType('SO', undefined))).not.toContain('push')
    expect(keysOf(listColsForType('SO', undefined))).not.toContain('push_amount')
    expect(LIST_ALL_COLS.find(c => c.key === 'push')?.label).toBe('已下推数量')
    expect(LIST_ALL_COLS.find(c => c.key === 'push_amount')?.label).toBe('已下推金额')
  })

  it('自定义字段：仅表头/表尾且未被全局隐藏，key 带 cf: 前缀并按位置分组；表体字段不进列表', () => {
    const cols = listColsForType('SO', undefined, [
      { field_key: 'h1', field_name: '表头字段1', position: 'header' },
      { field_key: 'f1', field_name: '表尾字段1', position: 'footer' },
      { field_key: 'b1', field_name: '表体字段1', position: 'body' },
      { field_key: 'h2', field_name: '已隐藏', position: 'header', is_visible: 0 },
    ])
    const custom = cols.filter(c => c.key.startsWith(LIST_CUSTOM_COL_PREFIX))
    expect(custom.map(c => c.key)).toEqual(['cf:h1', 'cf:f1'])
    expect(custom.map(c => c.group)).toEqual(['表头字段', '表尾字段'])
  })
})

describe('LIST_ALL_COLS', () => {
  it('key 唯一，且保留历史上已保存的列 key（兼容已有列方案 / 本地列设置）', () => {
    const keys = keysOf(LIST_ALL_COLS)
    expect(new Set(keys).size).toBe(keys.length)
    for (const legacy of ['doc_no', 'doc_date', 'doc_type', 'partner', 'warehouse', 'biz_person', 'dept_code', 'contract_no', 'payment_type', 'invoice_no',
      'total_qty', 'total_amount', 'total_with_tax', 'currency', 'maker', 'auditor', 'push', 'status', 'remark',
      'io_category', 'transport_method', 'settle_account', 'discount_rate', 'expect_date', 'credit_days', 'tax_rate', 'operator']) {
      expect(keys, legacy).toContain(legacy)
    }
  })

  it('默认显示列保持原样（新增列一律默认不显示），单据号为必选', () => {
    const visible = LIST_ALL_COLS.filter(c => c.visible).map(c => c.key)
    // 例外：订单关联单号（linked_docs / linked_payments）仅采购 / 销售订单可用，收付款核销信息 4 列仅收付款单可用，均为客户明确要求默认可见
    // 已下推金额（push_amount）与已下推数量一并默认可见；组装单成品明细列（pl_*，仅 AS 的成品明细视图）同样默认可见
    expect(visible.sort()).toEqual(['pl_item_code', 'pl_item_name', 'pl_spec', 'pl_unit', 'pl_qty', 'pl_fee', 'pl_amount','doc_date', 'doc_no', 'doc_type', 'partner', 'push', 'push_amount', 'status', 'total_amount', 'total_qty', 'total_with_tax', 'warehouse', 'linked_docs', 'linked_payments', 'verified_amount', 'unverified_amount', 'verify_nos', 'pay_linked_docs'].sort())
    expect(LIST_ALL_COLS.filter(c => ['linked_docs', 'linked_payments'].includes(c.key)).every(c => c.onlyTypes?.join() === 'PO,SOa')).toBe(true)
    expect(LIST_ALL_COLS.filter(c => ['verified_amount', 'unverified_amount', 'verify_nos', 'pay_linked_docs'].includes(c.key)).every(c => c.onlyTypes?.join() === 'RCV,PAY')).toBe(true)
    expect(LIST_ALL_COLS.filter(c => c.required).map(c => c.key)).toEqual(['doc_no'])
  })

  it('列方案可隐藏项不含必选列与「类型」列', () => {
    const keys = keysOf(LIST_OPT_COLS)
    expect(keys).not.toContain('doc_no')
    expect(keys).not.toContain('doc_type')
    expect(keys).toContain('partner')
  })
})
