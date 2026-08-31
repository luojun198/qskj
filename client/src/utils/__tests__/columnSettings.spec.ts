import { describe, expect, it } from 'vitest'
import {
  mergeHiddenColumnVisibility,
  mergeColumnSettings,
  moveColumnSetting,
  serializeColumnSettings,
  type ColumnSetting,
} from '../columnSettings'

const defaults: ColumnSetting[] = [
  { key: 'code', label: '编号', visible: true, required: true },
  { key: 'name', label: '名称', visible: true },
  { key: 'remark', label: '备注', visible: false },
]

describe('columnSettings', () => {
  it('keeps the same hidden-set reference when visibility is unchanged', () => {
    const hidden = new Set(['remark'])
    const columns: ColumnSetting[] = [
      { key: 'name', label: '名称', visible: true },
      { key: 'remark', label: '备注', visible: false },
    ]

    expect(mergeHiddenColumnVisibility(hidden, columns, new Set(['name', 'remark']))).toBe(hidden)
  })

  it('兼容旧的可见列数组并保留隐藏状态', () => {
    expect(mergeColumnSettings(defaults, ['name', 'code'])).toEqual([
      { key: 'name', label: '名称', visible: true },
      { key: 'code', label: '编号', visible: true, required: true },
      { key: 'remark', label: '备注', visible: false },
    ])
  })

  it('兼容旧的对象数组、prop 字段并追加新列', () => {
    const saved = [
      { prop: 'remark', visible: true },
      { prop: 'deleted_column', visible: true },
      { prop: 'code', visible: false },
    ]
    expect(mergeColumnSettings(defaults, saved)).toEqual([
      { key: 'remark', label: '备注', visible: true },
      { key: 'code', label: '编号', visible: true, required: true },
      { key: 'name', label: '名称', visible: true },
    ])
  })

  it('兼容旧的键值显隐对象', () => {
    expect(mergeColumnSettings(defaults, { code: true, name: false, remark: true })).toEqual([
      { key: 'code', label: '编号', visible: true, required: true },
      { key: 'name', label: '名称', visible: false },
      { key: 'remark', label: '备注', visible: true },
    ])
  })

  it('支持置顶、上移、下移、置尾且不修改原数组', () => {
    const top = moveColumnSetting(defaults, 2, 'top')
    expect(top.map(c => c.key)).toEqual(['remark', 'code', 'name'])
    expect(moveColumnSetting(top, 0, 'up')).toBe(top)
    expect(moveColumnSetting(top, 0, 'down').map(c => c.key)).toEqual(['code', 'remark', 'name'])
    expect(moveColumnSetting(top, 0, 'bottom').map(c => c.key)).toEqual(['code', 'name', 'remark'])
    expect(defaults.map(c => c.key)).toEqual(['code', 'name', 'remark'])
  })

  it('序列化为带版本的有序设置', () => {
    expect(serializeColumnSettings(defaults)).toEqual({
      version: 2,
      columns: [
        { key: 'code', visible: true },
        { key: 'name', visible: true },
        { key: 'remark', visible: false },
      ],
    })
  })
})
