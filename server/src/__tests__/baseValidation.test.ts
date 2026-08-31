import { describe, it, expect } from 'vitest'
import { buildWhereClause } from '../services/baseValidation.js'

describe('baseValidation', () => {
  describe('buildWhereClause', () => {
    it('should return empty string for empty conditions', () => {
      const result = buildWhereClause([])
      expect(result).toBe('')
    })

    it('should build WHERE clause with single condition', () => {
      const result = buildWhereClause(['account_set_id = ?'])
      expect(result).toBe(' WHERE account_set_id = ?')
    })

    it('should build WHERE clause with multiple conditions', () => {
      const result = buildWhereClause(['account_set_id = ?', 'is_enabled = ?'])
      expect(result).toBe(' WHERE account_set_id = ? AND is_enabled = ?')
    })

    it('should join conditions with AND', () => {
      const result = buildWhereClause(['a = ?', 'b = ?', 'c = ?'])
      expect(result).toBe(' WHERE a = ? AND b = ? AND c = ?')
    })
  })
})
