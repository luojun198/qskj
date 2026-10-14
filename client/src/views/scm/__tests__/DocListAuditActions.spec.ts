import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('SCM 单据列表审核操作', () => {
  it('审核与反审核常驻工具条，按可执行状态启用（客户反馈：序时簿列表即可审核 / 反审核）', () => {
    const source = readFileSync(resolve(__dirname, '../DocList.vue'), 'utf8')
    expect(source).toContain(':disabled="!actionState.audit.enabled"')
    expect(source).toContain(':disabled="!actionState.unaudit.enabled"')
  })
})
