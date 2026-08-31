import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { licenseMiddleware } from '../middleware/licenseMiddleware.js'

function mockReq(path: string, method = 'POST') {
  return { path, method } as any
}

function mockRes() {
  const res: any = {}
  res.statusCode = 200
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  return res
}

describe('licenseMiddleware', () => {
  let prevSkip: string | undefined

  beforeEach(() => {
    prevSkip = process.env.LICENSE_SKIP
    delete process.env.LICENSE_SKIP
  })

  afterEach(() => {
    if (prevSkip === undefined) {
      delete process.env.LICENSE_SKIP
    } else {
      process.env.LICENSE_SKIP = prevSkip
    }
  })

  it('登录页新建账套接口在未激活时应放行', () => {
    const paths = [
      '/api/auth/account-sets/create',
      '/api/auth/account-sets/create-from-standard-template',
      '/api/auth/account-sets',
      '/api/auth/standard-account-set-templates',
    ]
    for (const path of paths) {
      const req = mockReq(path)
      const res = mockRes()
      let nextCalled = false
      licenseMiddleware(req, res, () => {
        nextCalled = true
      })
      expect(nextCalled, path).toBe(true)
      expect(res.statusCode).toBe(200)
    }
  })
})
