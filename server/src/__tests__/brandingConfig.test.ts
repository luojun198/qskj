import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  DEFAULT_BRAND_SUBTITLE,
  DEFAULT_BRAND_TITLE,
  readGlobalBranding,
  upsertGlobalBrandParam,
  validateBrandParam,
} from '../services/brandingConfig.js'

describe('brandingConfig', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE system_params (
        id TEXT PRIMARY KEY,
        account_set_id TEXT,
        param_key TEXT NOT NULL,
        param_value TEXT,
        UNIQUE(account_set_id, param_key)
      );
    `)
  })

  it('无配置时返回默认品牌文案', () => {
    expect(readGlobalBranding(db)).toEqual({
      title: DEFAULT_BRAND_TITLE,
      subtitle: DEFAULT_BRAND_SUBTITLE,
      logoUrl: null,
    })
  })

  it('应读写全局品牌参数', () => {
    upsertGlobalBrandParam(db, 'brand_title', '测试标题')
    upsertGlobalBrandParam(db, 'brand_subtitle', '测试副标题')
    upsertGlobalBrandParam(db, 'brand_logo_url', '/uploads/branding/logo.png')
    expect(readGlobalBranding(db)).toEqual({
      title: '测试标题',
      subtitle: '测试副标题',
      logoUrl: '/uploads/branding/logo.png',
    })
  })

  it('应校验品牌参数', () => {
    expect(validateBrandParam('brand_title', '')).toContain('不能为空')
    expect(validateBrandParam('brand_logo_url', '/uploads/branding/logo.png')).toBeNull()
    expect(validateBrandParam('brand_logo_url', '/etc/passwd')).toContain('无效')
  })
})
