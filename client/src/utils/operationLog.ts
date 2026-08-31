/** 将操作日志详情中的 JSON 转为可读文案 */
export function formatLogDetail(detail?: string | null): string {
  if (!detail?.trim()) return '—'

  const trimmed = detail.trim()
  try {
    const parsed = JSON.parse(trimmed) as Record<string, any>
    
    // 处理新的增强版日志结构
    if (parsed && typeof parsed === 'object' && 'request' in parsed) {
      const { request, response, status } = parsed
      const body = request?.body || {}
      const query = request?.query || {}
      const params = request?.params || {}

      const parts: string[] = []

      // 1. 尝试从 body/query/params 中提取业务标识
      const code = body.code || query.code || params.code || body.account_code || body.asset_no
      const name = body.name || query.name || params.name || body.account_name || body.asset_name
      const summary = body.summary || query.summary
      const amount = body.amount || body.debit || body.credit || body.original_value

      if (code && name) parts.push(`[${code}] ${name}`)
      else if (code) parts.push(`编码: ${code}`)
      else if (name) parts.push(name)

      if (summary) parts.push(`摘要: ${summary}`)
      
      if (amount != null && amount !== 0) {
        const fmtAmt = typeof amount === 'number' 
          ? amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) 
          : amount
        parts.push(`金额: ${fmtAmt}`)
      }

      // 2. 补充特殊字段（如日期、数量等）
      if (body.biz_date || body.voucher_date) parts.push(`日期: ${body.biz_date || body.voucher_date}`)
      if (body.qty) parts.push(`数量: ${body.qty}`)

      // 3. 响应结果（如果不是简单的“成功”或空，且状态码不是 200）
      if (response && response !== '成功' && response !== '修改成功' && response !== '保存成功' && response !== '删除成功') {
        parts.push(`结果: ${response}`)
      } else if (status && status >= 400) {
        parts.push(`状态码: ${status}`)
      }

      const result = parts.join(' | ')
      return result || response || '—'
    }

    // 兼容旧版逻辑
    if (parsed && typeof parsed === 'object') {
      const data = parsed.data as Record<string, unknown> | undefined
      if (typeof data?.blockedReason === 'string' && data.blockedReason) {
        return data.blockedReason
      }
      if (typeof parsed.message === 'string' && parsed.message) {
        return parsed.message
      }
      if (data && typeof data.voucherNo === 'string') {
        return `凭证号：${data.voucherNo}`
      }
    }
  } catch {
    // 非 JSON 或截断 JSON，尝试正则提取关键信息
    const msgMatch = trimmed.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (msgMatch) {
      return msgMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
    }
  }

  return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed
}

/** 操作日志 IP 显示（本机回环地址友好展示） */
export function formatLogIp(ip?: string | null): string {
  const value = (ip || '').trim()
  if (!value) return '—'
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value === '127.0.0.1') {
    return '本机（127.0.0.1）'
  }
  if (value.startsWith('::ffff:')) {
    return value.replace('::ffff:', '')
  }
  return value
}
