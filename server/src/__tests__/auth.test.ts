import { describe, it, expect, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { generateToken } from '../middleware/auth.js'

describe('auth middleware', () => {
  // 设置测试环境变量
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-unit-tests'
  })

  describe('generateToken', () => {
    it('should generate valid JWT token', () => {
      const payload = {
        userId: 'user-123',
        userName: 'testuser',
        accountSetId: 'account-456',
        roleId: 'role-789',
        permissions: ['read', 'write'],
      }

      const token = generateToken(payload)
      expect(token).toBeTruthy()
      expect(typeof token).toBe('string')
    })

    it('should generate token that can be verified', () => {
      const payload = {
        userId: 'user-123',
        userName: 'testuser',
        accountSetId: 'account-456',
        roleId: 'role-789',
        permissions: ['read', 'write'],
      }

      const token = generateToken(payload)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

      expect(decoded.userId).toBe(payload.userId)
      expect(decoded.userName).toBe(payload.userName)
      expect(decoded.accountSetId).toBe(payload.accountSetId)
      expect(decoded.roleId).toBe(payload.roleId)
      expect(decoded.permissions).toEqual(payload.permissions)
    })

    it('should generate token with 8 hour expiration by default', () => {
      const payload = {
        userId: 'user-123',
        userName: 'testuser',
        accountSetId: 'account-456',
        roleId: 'role-789',
        permissions: ['*'],
      }

      const token = generateToken(payload)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

      expect(decoded.exp).toBeTruthy()
      expect(decoded.iat).toBeTruthy()
      expect(decoded.exp - decoded.iat).toBe(28800)
    })

    it('should generate token with 7 day expiration when remember is true', () => {
      const payload = {
        userId: 'user-123',
        userName: 'testuser',
        accountSetId: 'account-456',
        roleId: 'role-789',
        remember: true,
      }

      const token = generateToken(payload)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

      expect(decoded.remember).toBe(true)
      expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60)
    })

    it('should include all required fields in token', () => {
      const payload = {
        userId: 'user-123',
        userName: 'testuser',
        accountSetId: 'account-456',
        roleId: 'role-789',
        permissions: ['admin'],
      }

      const token = generateToken(payload)
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

      expect(decoded).toHaveProperty('userId')
      expect(decoded).toHaveProperty('userName')
      expect(decoded).toHaveProperty('accountSetId')
      expect(decoded).toHaveProperty('roleId')
      expect(decoded).toHaveProperty('permissions')
      expect(decoded).toHaveProperty('iat')
      expect(decoded).toHaveProperty('exp')
    })
  })
})
