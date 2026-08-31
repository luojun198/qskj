import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('SCM 单据列表表格渲染', () => {
  it('动态列使用 formatter，避免 Element Plus 在渲染外调用默认插槽', () => {
    const source = readFileSync(resolve(__dirname, '../DocList.vue'), 'utf8')

    expect(source).toMatch(/:formatter="\(?row(?:: any)?\)? => formatDocColumn\(row, column\.key\)"/)
    expect(source).not.toContain('<template #default="{ row }">')
  })
})
