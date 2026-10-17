/**
 * SEC-4：/uploads/attachments 下的附件需要登录才能取回。
 * <img>/<iframe>/<a> 不能带 Authorization 头，这里把当前登录 token 拼到查询参数 t 上，
 * 服务端 attachmentAuth 中间件按同一套会话校验。其他 /uploads 路径（logo、打印模板图片）不处理。
 */
export function withAttachmentToken(path: string | null | undefined): string {
  if (!path) return ''
  if (!path.includes('/uploads/attachments/')) return path
  let token = ''
  try {
    token = localStorage.getItem('token') || ''
  } catch {
    /* 隐私模式等读不到时按无 token 处理 */
  }
  if (!token) return path
  return `${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`
}
