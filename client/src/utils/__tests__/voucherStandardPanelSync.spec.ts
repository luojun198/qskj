import { describe, it, expect, vi } from 'vitest'

vi.mock('vue-plugin-hiprint/dist/print-lock.css?url', () => ({ default: '' }))
vi.mock('vue-plugin-hiprint/dist/print-lock.css?raw', () => ({ default: '' }))

import { buildDefaultVoucherPanel } from '../printTemplateDefaultsHiprint'
// 服务端新建账套 / 模板升级迁移用的快照
import { VOUCHER_STANDARD_PANEL } from '../../../../server/src/services/voucherStandardPanel'

describe('标准凭证模板前后端一致', () => {
  it('服务端快照 = 前端内置默认排版（不一致时重新生成 server/src/services/voucherStandardPanel.ts）', () => {
    expect(JSON.parse(JSON.stringify(VOUCHER_STANDARD_PANEL))).toEqual(
      JSON.parse(JSON.stringify(buildDefaultVoucherPanel()))
    )
  })
})
