import { createVerify, createSign } from 'crypto'

export interface LicensePayload {
  v: number
  mid: string
  exp: string
  iat: string
}

export function toBase64Url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64url')
}

export function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

export function encodeLicensePayload(payload: LicensePayload): string {
  return toBase64Url(JSON.stringify(payload))
}

export function decodeLicensePayload(encoded: string): LicensePayload {
  const raw = fromBase64Url(encoded).toString('utf8')
  const parsed = JSON.parse(raw) as LicensePayload
  if (
    typeof parsed.v !== 'number' ||
    typeof parsed.mid !== 'string' ||
    typeof parsed.exp !== 'string' ||
    typeof parsed.iat !== 'string'
  ) {
    throw new Error('INVALID_PAYLOAD')
  }
  return parsed
}

export function signLicensePayload(payloadEncoded: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(payloadEncoded)
  signer.end()
  return toBase64Url(signer.sign(privateKeyPem))
}

export function verifyLicenseSignature(
  payloadEncoded: string,
  signatureEncoded: string,
  publicKeyPem: string
): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(payloadEncoded)
    verifier.end()
    return verifier.verify(publicKeyPem, fromBase64Url(signatureEncoded))
  } catch {
    return false
  }
}

export function buildLicenseCode(payload: LicensePayload, privateKeyPem: string): string {
  const payloadEncoded = encodeLicensePayload(payload)
  const signature = signLicensePayload(payloadEncoded, privateKeyPem)
  return `${payloadEncoded}.${signature}`
}

/**
 * 控制台中的长注册码复制后可能夹带换行或零宽字符。
 * 注册码字符集本身不包含这些字符，验签前可安全移除。
 */
export function normalizeLicenseCode(code: string): string {
  return code.replace(/[\s\u200B-\u200D\uFEFF]/g, '')
}

export function parseLicenseCode(code: string): {
  payloadEncoded: string
  signatureEncoded: string
} {
  const normalized = normalizeLicenseCode(code)
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === normalized.length - 1) {
    throw new Error('INVALID_FORMAT')
  }
  return {
    payloadEncoded: normalized.slice(0, dotIndex),
    signatureEncoded: normalized.slice(dotIndex + 1),
  }
}

/** YYYY-MM-DD */
export function formatDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = parseDateOnlyEndOfDay(value)
  return !Number.isNaN(date.getTime())
}

/** 授权截止日期含当天，按本地时区 23:59:59.999 失效 */
export function parseDateOnlyEndOfDay(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 999)
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  return now.getTime() > parseDateOnlyEndOfDay(expiresAt).getTime()
}

export function daysRemaining(expiresAt: string, now = new Date()): number {
  const end = parseDateOnlyEndOfDay(expiresAt)
  const diffMs = end.getTime() - now.getTime()
  if (diffMs < 0) return 0
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000))
}
