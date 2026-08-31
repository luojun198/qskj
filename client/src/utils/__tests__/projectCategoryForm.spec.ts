import { describe, expect, it } from 'vitest'
import {
  buildProjectCategoryFieldsPayload,
  nextProjectCategoryCode,
  normalizeProjectCategoryField,
} from '@/utils/projectCategoryForm'

describe('核算类别表单工具', () => {
  it('按现有 CAT 编码生成下一个类别编码', () => {
    expect(nextProjectCategoryCode([{ code: 'CAT001' }, { code: 'OTHER' }, { code: 'CAT009' }])).toBe('CAT010')
    expect(nextProjectCategoryCode([])).toBe('CAT001')
  })

  it('恢复已有字段的选项和三个配置开关', () => {
    expect(normalizeProjectCategoryField({
      field_key: 'region', field_name: '区域', field_type: 'select', options_json: '["华东","华南"]',
      show_in_voucher: 1, required_in_voucher: 0, required_in_archive: 1, sort_order: 2,
    })).toMatchObject({
      field_key: 'region', options_text: '华东,华南', show_in_voucher: true,
      required_in_voucher: false, required_in_archive: true, _persisted: true,
    })
  })

  it('保存时转换下拉选项、布尔开关和字段顺序', () => {
    const fields = [
      normalizeProjectCategoryField({ field_key: 'region', field_name: '区域', field_type: 'select', options_json: '["旧值"]' }),
      { ...normalizeProjectCategoryField({ field_key: 'budget', field_name: '预算', field_type: 'number' }), _persisted: false },
    ]
    fields[0].options_text = '华东, 华南,,'
    fields[0].show_in_voucher = true
    fields[0].required_in_archive = true
    expect(buildProjectCategoryFieldsPayload(fields)).toEqual([
      expect.objectContaining({ field_key: 'region', options_json: '["华东","华南"]', show_in_voucher: 1, required_in_archive: 1, sort_order: 0 }),
      expect.objectContaining({ field_key: 'budget', options_json: null, sort_order: 1 }),
    ])
  })
})
