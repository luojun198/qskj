import { describe, expect, it } from 'vitest'
import { getTabPolicy, getViewKey } from '@/utils/viewKey'

describe('viewKey', () => {
  it('同一只读功能的不同记录复用标签身份', () => {
    expect(getViewKey('/scm/docs/1', 'acct', 'ScmDocView'))
      .toBe(getViewKey('/scm/docs/2', 'acct', 'ScmDocView'))
    expect(getViewKey('/asset/detail/1', 'acct', 'AssetDetail'))
      .toBe(getViewKey('/asset/detail/2', 'acct', 'AssetDetail'))
  })

  it('模块导航统一复用一个标签', () => {
    expect(getViewKey('/group/采购管理', 'acct', 'GroupNav'))
      .toBe(getViewKey('/group/生产管理', 'acct', 'GroupNav'))
  })

  it('同一购销报表工作台切换报表时复用标签', () => {
    expect(getViewKey('/scm/report/purchase/summary', 'acct', 'ScmPurchaseSummaryReport'))
      .toBe(getViewKey('/scm/report/purchase/detail', 'acct', 'ScmPurchaseDetailReport'))
    expect(getViewKey('/scm/report/purchase/detail', 'acct', 'ScmPurchaseDetailReport'))
      .toBe(getViewKey('/scm/report/buysell?kind=purchase', 'acct', 'ScmBuySellReport'))
    expect(getViewKey('/scm/report/sales/summary', 'acct', 'ScmSalesSummaryReport'))
      .not.toBe(getViewKey('/scm/report/purchase/summary', 'acct', 'ScmPurchaseSummaryReport'))
  })

  it('不同编辑记录保持独立标签', () => {
    expect(getViewKey('/scm/docs/1/edit', 'acct', 'ScmDocEdit'))
      .not.toBe(getViewKey('/scm/docs/2/edit', 'acct', 'ScmDocEdit'))
    expect(getTabPolicy('ScmDocEdit')).toEqual({ kind: 'editor', evictable: false })
  })

  it('同一单据类型的列表、新增、查看和编辑复用同一标签', () => {
    const list = getViewKey('/scm/docs?doc_type=PI', 'acct', 'ScmDocList')
    expect(getViewKey('/scm/docs/new?doc_type=PI', 'acct', 'ScmDocNew')).toBe(list)
    expect(getViewKey('/scm/docs/D1?nav_list_doc_type=PI', 'acct', 'ScmDocView')).toBe(list)
    expect(getViewKey('/scm/docs/D1/edit?nav_list_doc_type=PI', 'acct', 'ScmDocEdit')).toBe(list)
    expect(getViewKey('/scm/docs/new?doc_type=PO', 'acct', 'ScmDocNew')).not.toBe(list)
  })

  it('单据列表区分类型和预收预付模式', () => {
    expect(getViewKey('/scm/docs?doc_type=RCV', 'acct', 'ScmDocList'))
      .not.toBe(getViewKey('/scm/docs?doc_type=RCV&payment_mode=advance', 'acct', 'ScmDocList'))
  })

  it('打印模板设计器新建与保存后带 id 的地址共用标签', () => {
    expect(getViewKey('/base/print-template/design', 'acct', 'PrintTemplateDesigner'))
      .toBe(getViewKey('/base/print-template/design/abc', 'acct', 'PrintTemplateDesigner'))
    expect(getViewKey('/base/print-template/design?preset=standard', 'acct', 'PrintTemplateDesigner'))
      .toBe(getViewKey('/base/print-template/design/abc', 'acct', 'PrintTemplateDesigner'))
    expect(getTabPolicy('PrintTemplateDesigner')).toEqual({ kind: 'editor', evictable: false })
  })

  it('固定页和只读动态页返回正确策略', () => {
    expect(getTabPolicy('Dashboard')).toEqual({ kind: 'fixed', evictable: false })
    expect(getTabPolicy('ScmMrPushPreview')).toEqual({ kind: 'transient', evictable: true })
    expect(getTabPolicy('ScmDocList')).toEqual({ kind: 'normal', evictable: true })
  })
})
