import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { authMiddleware, AuthRequest, operationLog } from '../middleware/index.js'
import { getDb } from '../db/index.js'
import { isVoucherVisibleInAccountScope } from '../services/accountAuthorization.js'

const router = Router()
router.use(authMiddleware)

// ===================== AI异常检测 =====================
router.post('/ai/anomaly-check', async (req: AuthRequest, res) => {
  const { voucher_id } = req.body
  const db = getDb()
  const aiConfig = db
    .prepare(
      'SELECT * FROM ai_config WHERE account_set_id=? OR account_set_id IS NULL ORDER BY account_set_id DESC LIMIT 1'
    )
    .get(req.accountSetId) as any

  if (!aiConfig?.enabled || !aiConfig?.api_key) {
    return res.status(400).json({ code: 400, message: 'AI功能未启用' })
  }

  const voucher = db.prepare('SELECT * FROM vouchers WHERE id=?').get(voucher_id) as any
  if (
    req.accountScope &&
    !isVoucherVisibleInAccountScope(db, req.accountScope, voucher_id, req.accountSetId || '')
  ) {
    return res.status(403).json({ code: 403, message: '无权查看该凭证' })
  }
  const entries = db
    .prepare(
      'SELECT ve.*, a.name as account_name FROM voucher_entries ve JOIN accounts a ON a.id=ve.account_id WHERE ve.voucher_id=?'
    )
    .all(voucher_id)

  try {
    const entryText = (entries as any[])
      .map(e => `${e.account_name}: ${e.direction === 'debit' ? '借' : '贷'} ${e.amount}`)
      .join('\n')
    const response = await fetch(aiConfig.api_url || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.api_key}`,
      },
      body: JSON.stringify({
        model: aiConfig.model || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              '你是一个行政事业单位财务审计助手。请检查以下凭证分录是否异常（如金额异常、科目使用不当、违反政府会计制度等），返回JSON格式：{anomaly: true/false, level: "high/medium/low", issues: ["问题1", "问题2"]}',
          },
          {
            role: 'user',
            content: `凭证号: ${voucher?.voucher_no}\n日期: ${voucher?.voucher_date}\n分录:\n${entryText}`,
          },
        ],
        maxOutputTokens: 200,
        temperature: 0.1,
      }),
    })
    const data = await response.json()
    let result = { anomaly: false, level: 'low', issues: [] }
    try {
      result = JSON.parse((data as any).choices?.[0]?.message?.content || '{}')
    } catch {
      /* ignore */
    }
    res.json({ code: 0, data: result })
  } catch (err: any) {
    res.status(500).json({ code: 500, message: 'AI服务调用失败: ' + err.message })
  }
})

// ===================== AI配置 =====================
router.get('/ai/config', (req: AuthRequest, res) => {
  const db = getDb()
  const config = db
    .prepare(
      'SELECT * FROM ai_config WHERE account_set_id=? OR account_set_id IS NULL ORDER BY account_set_id DESC LIMIT 1'
    )
    .get(req.accountSetId) as any
  if (!config) {
    return res.json({ code: 0, data: {} })
  }
  // 不返回明文密钥，仅返回「是否已配置」与末四位掩码，避免任意登录用户窃取 AI 密钥
  const { api_key, ...rest } = config
  res.json({
    code: 0,
    data: {
      ...rest,
      hasApiKey: !!api_key,
      api_key: api_key ? '****' + String(api_key).slice(-4) : '',
    },
  })
})

router.put('/ai/config', operationLog('配置AI', '系统管理'), (req: AuthRequest, res) => {
  const { provider, api_url, api_key, model, enabled, settings } = req.body
  const db = getDb()
  // 未提供新密钥（空或掩码回显 ****xxxx）时保留已存密钥，避免掩码把真实密钥覆盖掉
  const existing = db
    .prepare('SELECT api_key FROM ai_config WHERE account_set_id=? ORDER BY account_set_id DESC LIMIT 1')
    .get(req.accountSetId) as any
  const isMasked = typeof api_key === 'string' && api_key.startsWith('****')
  const finalApiKey = !api_key || isMasked ? (existing?.api_key ?? null) : api_key
  const id = uuidv4()
  db.prepare(
    `
    INSERT OR REPLACE INTO ai_config (id, account_set_id, provider, api_url, api_key, model, enabled, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    req.accountSetId,
    provider,
    api_url,
    finalApiKey,
    model,
    enabled ? 1 : 0,
    JSON.stringify(settings || {})
  )
  res.json({ code: 0, message: '保存成功' })
})

export default router
