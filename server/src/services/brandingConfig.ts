import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'

export const BRAND_TITLE_KEY = 'brand_title'
export const BRAND_SUBTITLE_KEY = 'brand_subtitle'
export const BRAND_LOGO_URL_KEY = 'brand_logo_url'

export const DEFAULT_BRAND_TITLE = '盛于智'
export const DEFAULT_BRAND_SUBTITLE = '行政事业单位财务专业版'

export type BrandingConfig = {
  title: string
  subtitle: string
  logoUrl: string | null
}

function readGlobalParam(db: Database.Database, paramKey: string): string | null {
  const row = db
    .prepare(
      `SELECT param_value FROM system_params
       WHERE account_set_id IS NULL AND param_key = ? LIMIT 1`
    )
    .get(paramKey) as { param_value?: string } | undefined
  const value = row?.param_value?.trim()
  return value || null
}

export function readGlobalBranding(db: Database.Database): BrandingConfig {
  return {
    title: readGlobalParam(db, BRAND_TITLE_KEY) || DEFAULT_BRAND_TITLE,
    subtitle: readGlobalParam(db, BRAND_SUBTITLE_KEY) || DEFAULT_BRAND_SUBTITLE,
    logoUrl: readGlobalParam(db, BRAND_LOGO_URL_KEY),
  }
}

export function upsertGlobalBrandParam(
  db: Database.Database,
  paramKey: string,
  paramValue: string
) {
  const existing = db
    .prepare(
      `SELECT id FROM system_params WHERE account_set_id IS NULL AND param_key = ? LIMIT 1`
    )
    .get(paramKey) as { id: string } | undefined
  const id = existing?.id || uuidv4()
  db.prepare(
    `INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, NULL, ?, ?)`
  ).run(id, paramKey, paramValue)
}

export function validateBrandParam(paramKey: string, paramValue: string): string | null {
  if (paramKey === BRAND_TITLE_KEY) {
    const text = paramValue.trim()
    if (!text) return '主标题不能为空'
    if (text.length > 24) return '主标题不能超过 24 个字符'
    return null
  }
  if (paramKey === BRAND_SUBTITLE_KEY) {
    const text = paramValue.trim()
    if (!text) return '副标题不能为空'
    if (text.length > 48) return '副标题不能超过 48 个字符'
    return null
  }
  if (paramKey === BRAND_LOGO_URL_KEY) {
    const text = paramValue.trim()
    if (!text) return null
    if (!text.startsWith('/uploads/branding/')) {
      return 'LOGO 路径无效'
    }
    if (text.length > 512) return 'LOGO 路径过长'
    return null
  }
  return null
}
