import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const docFormSource = readFileSync(resolve(__dirname, '../DocForm.vue'), 'utf8')
const sourcePickerSource = readFileSync(resolve(__dirname, '../../../components/scm/SourceDocPicker.vue'), 'utf8')
const apiSource = readFileSync(resolve(__dirname, '../../../api/scm.ts'), 'utf8')

describe('采购入库明细采购订单号', () => {
  it('采购入库表格和列设置均提供采购订单号', () => {
    expect(docFormSource).toContain(`v-if="form.doc_type === 'PI'" column-key="purchase_order_no" label="采购订单号"`)
    expect(docFormSource).toContain(`{ key: 'purchase_order_no', label: '采购订单号', available: () => form.value.doc_type === 'PI' }`)
  })

  it('详情、单来源和多来源新建流程均带入采购订单号', () => {
    expect(docFormSource).toContain(`purchase_order_no: l.purchase_order_no || ''`)
    expect(docFormSource).toContain(`purchase_order_no: form.value.doc_type === 'PI' ? s.doc_no : undefined`)
    expect(docFormSource).toContain(`purchase_order_no: form.value.doc_type === 'PI' ? row.source_doc_no : row.purchase_order_no`)
  })

  it('反向选择采购订单时带入采购订单号', () => {
    expect(sourcePickerSource).toContain(`purchase_order_no: props.sourceDocType === 'PO' && props.detailSource === 'self' ? r.doc_no : undefined`)
  })

  it('明细接口类型声明采购订单号字段', () => {
    expect(apiSource).toContain(`purchase_order_no?: string;`)
  })
})
