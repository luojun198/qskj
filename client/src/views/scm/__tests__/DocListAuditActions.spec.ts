import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('SCM 单据列表审核操作', () => {
  it('审核与反审核按可执行状态互斥显示', () => {
    const source = readFileSync(resolve(__dirname, '../DocList.vue'), 'utf8')
    expect(source).toContain('v-if="actionState.audit.enabled"')
    expect(source).toContain('v-if="actionState.unaudit.enabled"')
  })
})
