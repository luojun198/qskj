import { describe, it, expect } from 'vitest'
import { isAssetVoucher, isScmDocVoucher, getAssetVoucherLockMessage } from '../voucherSourceGuard'

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
    // 各类固定资产凭证出错时统一指向「凭证管理」
    for (const source of ['asset_purchase', 'asset_depr', 'asset_change', 'asset_impairment', 'asset_disposal', 'asset_inventory']) {
      expect(getAssetVoucherLockMessage({ source }, '删除')).toContain('凭证管理')
    }
    expect(getAssetVoucherLockMessage({ source: 'manual' }, '删除')).toBeNull()
  })

  it('评审 P2：出纳凭证不可在凭证页删除，可编辑', () => {
    expect(getAssetVoucherLockMessage({ source: 'cashier' }, '删除')).toContain('出纳')
    expect(getAssetVoucherLockMessage({ source: 'cashier' }, '编辑')).toBeNull()
  })

  it('进销存单据凭证不可编辑 / 直接删除，差异结转凭证不在此列', () => {
    expect(isScmDocVoucher({ source: 'scm_so' })).toBe(true)
    expect(isScmDocVoucher({ source: 'scm_variance' })).toBe(false)
    expect(isScmDocVoucher({ source: 'cashier' })).toBe(false)
    expect(getAssetVoucherLockMessage({ source: 'scm_pi' }, '编辑')).toContain('业务凭证中心')
    expect(getAssetVoucherLockMessage({ source: 'scm_rcv' }, '删除')).toContain('不允许删除')
    expect(getAssetVoucherLockMessage({ source: 'scm_variance' }, '编辑')).toBeNull()
  })
})
