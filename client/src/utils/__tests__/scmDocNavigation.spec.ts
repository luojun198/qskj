import { describe, expect, it } from 'vitest'
import {
  createScmDocEditSnapshot,
  getScmDocPagerState,
  readScmDocNavContext,
  scmDocumentRoute,
  scmDownstreamDocRoute,
  scmDownstreamMrpRoute,
  scmDownstreamProductionPlanRoute,
  scmProductionPlanOrderRoute,
  scmSalesDispatchDraftRoute,
  scmDocNavContextToDetailQuery,
  scmDocNavContextToIdsParams,
  scmDocNavContextToListQuery,
  canEditScmDocument,
  isScmDocumentFormRoute,
  isScmMrpFormRoute,
} from '@/utils/scmDocNavigation'

describe('进销存单据快捷切换', () => {
  it('销售订单下推销售出库直接进入带来源的新建出库单', () => {
    expect(scmSalesDispatchDraftRoute('SOA1')).toEqual({
      name: 'ScmDocNew',
      query: { doc_type: 'SO', source_doc_id: 'SOA1' },
    })
  })

  it('下推草稿直接进入编辑页，已审核单据保持查看页', () => {
    expect(scmDownstreamDocRoute('D1', 'draft')).toEqual({
      name: 'ScmDocEdit', params: { id: 'D1' },
    })
    expect(scmDownstreamDocRoute('D2', 'audited', { from: 'trace' })).toEqual({
      name: 'ScmDocView', params: { id: 'D2' }, query: { from: 'trace' },
    })
    expect(scmDownstreamMrpRoute('M1', 'draft')).toEqual({
      name: 'ScmMrpEdit', params: { id: 'M1' },
    })
    expect(scmDownstreamMrpRoute('M2', 'audited')).toEqual({
      name: 'ScmMrpView', params: { id: 'M2' },
    })
    expect(scmDownstreamProductionPlanRoute('P1', 'draft')).toEqual({
      name: 'ScmProductionPlanEdit', params: { id: 'P1' },
    })
    expect(scmDownstreamProductionPlanRoute('P2', 'released')).toEqual({
      name: 'ScmProductionOrder', params: { id: 'P2' },
    })
    expect(scmProductionPlanOrderRoute('P3', 'outsource')).toEqual({
      name: 'ScmProductionOrder', params: { id: 'P3' }, query: { plan_type: 'outsource' },
    })
  })

  it('通用列表打开 MRP 时进入专用页面并保留列表上下文', () => {
    const query = { nav_from_list: '1', nav_list_doc_type: 'MRP', nav_fixed_doc_type: '1' }
    expect(scmDocumentRoute('M1', 'MRP', 'draft', query)).toEqual({
      name: 'ScmMrpEdit', params: { id: 'M1' }, query,
    })
    expect(scmDocumentRoute('M2', 'MRP', 'audited', query)).toEqual({
      name: 'ScmMrpView', params: { id: 'M2' }, query,
    })
    expect(scmDocumentRoute('D1', 'SOa', 'audited', query)).toEqual({
      name: 'ScmDocView', params: { id: 'D1' }, query,
    })
  })

  it('仅草稿且具备对应业务域权限的单据可进入编辑状态', () => {
    expect(canEditScmDocument('PO', 'draft', ['scm:purchase'])).toBe(true)
    expect(canEditScmDocument('SOa', 'draft', ['scm:purchase'])).toBe(false)
    expect(canEditScmDocument('SOa', 'audited', ['scm:sale'])).toBe(false)
    expect(canEditScmDocument('MRP', 'draft', ['scm:outsource'])).toBe(true)
    expect(canEditScmDocument('MRP', 'draft', ['scm:sale'])).toBe(false)
    expect(canEditScmDocument('PI', 'draft', ['*'])).toBe(true)
  })

  it('导航按权限将草稿分流到编辑或查看页', () => {
    expect(scmDocumentRoute('D1', 'PI', 'draft', undefined, ['scm:purchase'])).toEqual({
      name: 'ScmDocEdit', params: { id: 'D1' },
    })
    expect(scmDocumentRoute('D1', 'PI', 'draft', undefined, ['scm:sale'])).toEqual({
      name: 'ScmDocView', params: { id: 'D1' },
    })
    expect(scmDocumentRoute('M1', 'MRP', 'draft', undefined, ['scm:production'])).toEqual({
      name: 'ScmMrpEdit', params: { id: 'M1' },
    })
  })

  it('往返保留列表筛选、页码和固定类型入口', () => {
    const context = {
      from_list: true,
      fixed_doc_type: true,
      list_doc_type: 'PO',
      warehouse_code: 'W01',
      partner_code: 'SUP01',
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      page: 3,
    } as const
    const detailQuery = scmDocNavContextToDetailQuery(context)
    expect(readScmDocNavContext(detailQuery as any)).toEqual(context)
    expect(scmDocNavContextToListQuery(context, 'PO')).toEqual({
      doc_type: 'PO', warehouse_code: 'W01', partner_code: 'SUP01',
      start_date: '2026-07-01', end_date: '2026-07-31', page: '3',
    })
    expect(scmDocNavContextToIdsParams('PO', context)).toEqual({
      doc_type: 'PO', warehouse_code: 'W01', partner_code: 'SUP01', status: undefined,
      start_date: '2026-07-01', end_date: '2026-07-31', payment_mode: undefined,
    })
  })

  it('通用列表的类型过滤使用 filter_doc_type，不改变菜单固定入口语义', () => {
    expect(scmDocNavContextToListQuery({ from_list: true, list_doc_type: 'AS', fixed_doc_type: false }, 'AS'))
      .toEqual({ filter_doc_type: 'AS' })
  })

  it('正确计算首尾边界和单张单据状态', () => {
    expect(getScmDocPagerState(['A'], 'A')).toEqual({ index: 0, total: 1, canPrevious: false, canNext: false })
    expect(getScmDocPagerState(['A', 'B', 'C'], 'B')).toEqual({ index: 1, total: 3, canPrevious: true, canNext: true })
    expect(getScmDocPagerState(['A', 'B'], 'X')).toEqual({ index: -1, total: 2, canPrevious: false, canNext: false })
  })

  it('编辑快照忽略自动空白行和界面临时字段，但识别可保存修改', () => {
    const base = {
      form: { doc_type: 'PI', warehouse_code: 'W01', field_values: { channel: '直采' } },
      lines: [
        { id: 'L1', item_code: 'M01', qty: 2, price: 10, _stock: 99, item_name: '物料一' },
        { item_code: '', qty: null, _stock: 0 },
      ],
      selectedBom: '', paymentSources: [], advanceAmount: 0, advanceRemark: '',
    }
    const sameBusinessData = {
      ...base,
      lines: [
        { id: 'L1', item_code: 'M01', qty: 2, price: 10, _stock: 1, item_name: '新名称' },
        { item_code: '', qty: null, _stock: 888 },
      ],
    }
    expect(createScmDocEditSnapshot(sameBusinessData)).toBe(createScmDocEditSnapshot(base))
    expect(createScmDocEditSnapshot({ ...base, lines: [{ id: 'L1', item_code: 'M01', qty: 3, price: 10 }] }))
      .not.toBe(createScmDocEditSnapshot(base))
  })
})

describe('MRP form route boundary', () => {
  it('only reacts to MRP form routes', () => {
    expect(isScmMrpFormRoute('ScmMrpNew')).toBe(true)
    expect(isScmMrpFormRoute('ScmMrpEdit')).toBe(true)
    expect(isScmMrpFormRoute('ScmMrpView')).toBe(true)
    expect(isScmMrpFormRoute('ScmDocEdit')).toBe(false)
    expect(isScmMrpFormRoute('ScmProductionOrder')).toBe(false)
  })
})

describe('SCM document form route boundary', () => {
  it('does not treat a production order route as a document form route', () => {
    expect(isScmDocumentFormRoute('ScmDocNew')).toBe(true)
    expect(isScmDocumentFormRoute('ScmDocEdit')).toBe(true)
    expect(isScmDocumentFormRoute('ScmDocView')).toBe(true)
    expect(isScmDocumentFormRoute('ScmProductionOrder')).toBe(false)
    expect(isScmDocumentFormRoute('ScmProductionPlanEdit')).toBe(false)
  })
})
