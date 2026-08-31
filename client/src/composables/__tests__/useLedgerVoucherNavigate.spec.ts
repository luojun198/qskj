import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canNavigateToEditVoucher,
  resolveLedgerVoucherId,
} from '../useLedgerVoucherNavigate'

vi.mock('@/utils/permission', () => ({
  hasPermission: vi.fn(),
}))

import { hasPermission } from '@/utils/permission'

describe('useLedgerVoucherNavigate', () => {
  beforeEach(() => {
    vi.mocked(hasPermission).mockReset()
  })

  it('resolveLedgerVoucherId 返回凭证 id', () => {
    expect(resolveLedgerVoucherId({ voucher_id: 'v1' })).toBe('v1')
    expect(resolveLedgerVoucherId({})).toBeNull()
  })

  it('无权限或特殊行不可跳转', () => {
    vi.mocked(hasPermission).mockReturnValue(false)
    expect(canNavigateToEditVoucher({ voucher_id: 'v1' })).toBe(false)

    vi.mocked(hasPermission).mockReturnValue(true)
    expect(canNavigateToEditVoucher({ voucher_id: 'v1', is_opening_balance: true })).toBe(
      false
    )
    expect(canNavigateToEditVoucher({ voucher_id: 'v1', is_carry_forward: true })).toBe(false)
  })

  it('有凭证录入权限且为普通流水行可跳转', () => {
    vi.mocked(hasPermission).mockReturnValue(true)
    expect(canNavigateToEditVoucher({ voucher_id: 'v1', voucher_status: 'draft' })).toBe(true)
  })
})
