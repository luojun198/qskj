import { Router } from 'express'
import { getDb } from '../db/index.js'
import { authMiddleware, AuthRequest } from '../middleware/index.js'
import {
  buildAiSummaryEntryText,
  buildAiSummaryRequestBody,
  extractAiSummary,
  getAiSummaryApiUrl,
  isAiSummaryEnabled,
} from '../services/voucherEntry.js'

const router = Router()
router.use(authMiddleware)

// ===================== AI辅助：智能摘要 =====================

router.post('/vouchers/ai/summary', async (req: AuthRequest, res) => {
  const { entries } = req.body
  const db = getDb()
  const aiConfig = db
    .prepare(
      'SELECT * FROM ai_config WHERE account_set_id=? OR account_set_id IS NULL ORDER BY account_set_id DESC LIMIT 1'
    )
    .get(req.accountSetId) as any

  if (!isAiSummaryEnabled(aiConfig)) {
    return res.status(400).json({ code: 400, message: 'AI功能未启用或未配置' })
  }

  try {
    const entryText = buildAiSummaryEntryText(entries)
    const response = await fetch(getAiSummaryApiUrl(aiConfig), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aiConfig.api_key}`,
      },
      body: JSON.stringify(
        buildAiSummaryRequestBody({
          model: aiConfig.model,
          entryText,
        })
      ),
    })
    const data = await response.json()
    const summary = extractAiSummary(data)
    res.json({ code: 0, data: { summary } })
  } catch (err: any) {
    res.status(500).json({ code: 500, message: 'AI服务调用失败: ' + err.message })
  }
})

export default router
