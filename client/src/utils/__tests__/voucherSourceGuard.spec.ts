import { describe, it, expect } from 'vitest'
import { isAssetVoucher, getAssetVoucherLockMessage } from '../voucherSourceGuard'

describe('voucherSourceGuard', () => {
  it('只识别 asset_ 前缀来源', () => {
    expect(isAssetVoucher({ source: 'asset_depr' })).toBe(true)
    expect(isAssetVoucher({ source: 'cashier' })).toBe(false)
    expect(isAssetVoucher({ source: null })).toBe(false)
    expect(isAssetVoucher(undefined)).toBe(false)
  })

  it('折旧凭证提示反折旧，未知资产来源给通用提示，非资产凭证返回 null', () => {
    expect(getAssetVoucherLockMessage({ source: 'asset_depr' }, '编辑')).toContain('取消折旧')
    expect(getAssetVoucherLockMessage({ source: 'asset_depr' }, '删除')).toMatch(/不允许删除/)
    expect(getAssetVoucherLockMessage({ source: 'asset_xxx' }, '删除')).toContain('固定资产模块')
    expect(getAssetVoucherLockMessage({ source: 'manual' }, '删除')).toBeNull()
  })

  it('评审 P2：出纳凭证不可在凭证页删除，可编辑', () => {
    expect(getAssetVoucherLockMessage({ source: 'cashier' }, '删除')).toContain('出纳')
    expect(getAssetVoucherLockMessage({ source: 'cashier' }, '编辑')).toBeNull()
  })
})
