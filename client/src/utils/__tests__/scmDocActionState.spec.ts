import { describe, expect, it } from 'vitest'
import {
  canShowStandardPushAction,
  canGenerateDownstream,
  downstreamActionLabel,
  normalizePushProgress,
  pushProgressLabel,
} from '../scmDoc'

describe('供应链下推动作状态', () => {
  it('仅实际存在下推流程的标准单据显示下推入口', () => {
    expect(canShowStandardPushAction('PO')).toBe(true)
    expect(canShowStandardPushAction('PL')).toBe(false)
    expect(canShowStandardPushAction('SOa')).toBe(false)
  })

  it('全部下推后隐藏生成动作', () => {
    expect(canGenerateDownstream('audited', 'PO', 'full')).toBe(false)
    expect(canGenerateDownstream('audited', 'MR', 'full')).toBe(false)
    expect(pushProgressLabel('full')).toBe('已下推完成')
  })

  it('部分下推保留继续下推动作', () => {
    expect(canGenerateDownstream('audited', 'PQ', 'part')).toBe(true)
    expect(downstreamActionLabel('PQ', 'part')).toBe('继续下推采购订单')
    expect(pushProgressLabel('part')).toBe('部分下推')
  })

  it('草稿及不参与下推的单据不可生成下游', () => {
    expect(canGenerateDownstream('draft', 'PO', 'none')).toBe(false)
    expect(canGenerateDownstream('audited', 'PI', 'none')).toBe(false)
    expect(normalizePushProgress(undefined)).toBe('none')
  })
})
