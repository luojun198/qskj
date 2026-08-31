import { describe, expect, it } from 'vitest'
import { extractEntryAuxSelections } from '../utils/auxItemId.js'

describe('extractEntryAuxSelections', () => {
  it('从固定列与 aux_data 提取辅助项目', () => {
    const selections = extractEntryAuxSelections(
      {
        person_id: 'p1',
        aux_data: JSON.stringify({ project: { id: 'proj1', name: '项目A' } }),
      },
      ['person', 'project', 'dept']
    )
    expect(selections).toEqual([
      { categoryCode: 'person', itemId: 'p1' },
      { categoryCode: 'project', itemId: 'proj1' },
    ])
  })
})
