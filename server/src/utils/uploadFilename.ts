/**
 * multer 按 latin1 解析 multipart 文件名，浏览器发来的 UTF-8 中文名会变成乱码（如「å¤...」），这里还原。
 * 只有「按 latin1 取字节 → UTF-8 解码 → 再编码」能原样往返时才替换，避免误伤本来就正常的名字。
 */
export function fixGarbledFilename(str: string): string {
  if (!str || typeof str !== 'string') return str
  const latin1Buf = Buffer.from(str, 'latin1')
  const fixed = new TextDecoder('utf-8', { fatal: false }).decode(latin1Buf)
  if (fixed && fixed !== str) {
    const reencoded = Buffer.from(fixed, 'utf-8')
    if (reencoded.equals(latin1Buf)) return fixed
  }
  return str
}
