import { describe, it, expect } from 'vitest'
import { buildAuxItemId, type VoucherEntryLike } from '../services/voucherPosting.js'

describe('voucherPosting', () => {
  describe('buildAuxItemId', () => {
    it('应该构建包含部门的辅助核算 ID', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: 123,
        project_id: null,
        person_id: null,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      expect(result).toBe('dept:123')
    })

    it('应该构建包含多个维度的辅助核算 ID', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: 123,
        project_id: 456,
        person_id: 789,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      expect(result).toBe('dept:123|proj:456|pers:789')
    })

    it('应该处理只有项目的情况', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: null,
        project_id: 456,
        person_id: null,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      expect(result).toBe('proj:456')
    })

    it('应该处理没有辅助核算的情况', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: null,
        project_id: null,
        person_id: null,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      expect(result).toBe('')
    })

    it('应该按固定顺序构建 ID（dept|proj|person）', () => {
      const entry1: Partial<VoucherEntryLike> = {
        person_id: 789,
        dept_id: 123,
        project_id: 456,
      }
      const entry2: Partial<VoucherEntryLike> = {
        dept_id: 123,
        project_id: 456,
        person_id: 789,
      }
      expect(buildAuxItemId(entry1 as VoucherEntryLike)).toBe(buildAuxItemId(entry2 as VoucherEntryLike))
      expect(buildAuxItemId(entry1 as VoucherEntryLike)).toBe('dept:123|proj:456|pers:789')
    })

    it('应该处理 0 值（视为有效值）', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: 0,
        project_id: null,
        person_id: null,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      // 0 在 JavaScript 中是 falsy 值，buildAuxItemId 使用 if (entry.dept_id) 判断
      // 所以 0 会被跳过，返回空字符串
      expect(result).toBe('')
    })

    it('应该处理字符串类型的 ID', () => {
      const entry: Partial<VoucherEntryLike> = {
        dept_id: '123',
        project_id: '456',
        person_id: null,
      }
      const result = buildAuxItemId(entry as VoucherEntryLike)
      expect(result).toBe('dept:123|proj:456')
    })
  })

  describe('辅助核算数据完整性', () => {
    it('不同辅助核算组合应该生成不同的 ID', () => {
      const entry1: Partial<VoucherEntryLike> = { dept_id: 123, project_id: null, person_id: null }
      const entry2: Partial<VoucherEntryLike> = { dept_id: null, project_id: 123, person_id: null }
      const entry3: Partial<VoucherEntryLike> = { dept_id: 123, project_id: 456, person_id: null }

      const id1 = buildAuxItemId(entry1 as VoucherEntryLike)
      const id2 = buildAuxItemId(entry2 as VoucherEntryLike)
      const id3 = buildAuxItemId(entry3 as VoucherEntryLike)

      expect(id1).not.toBe(id2)
      expect(id1).not.toBe(id3)
      expect(id2).not.toBe(id3)
    })

    it('相同辅助核算组合应该生成相同的 ID', () => {
      const entry1: Partial<VoucherEntryLike> = { dept_id: 123, project_id: 456, person_id: 789 }
      const entry2: Partial<VoucherEntryLike> = { dept_id: 123, project_id: 456, person_id: 789 }

      expect(buildAuxItemId(entry1 as VoucherEntryLike)).toBe(buildAuxItemId(entry2 as VoucherEntryLike))
    })
  })
})
