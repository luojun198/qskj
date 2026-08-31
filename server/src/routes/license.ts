import { Router } from 'express'
import {
  activateLicense,
  getLicenseStatus,
  LICENSE_ERROR,
} from '../services/licenseService.js'
import { getMachineId } from '../services/machineId.js'

const router = Router()

router.get('/status', (_req, res) => {
  res.json({ code: 0, data: getLicenseStatus() })
})

router.get('/machine-id', (_req, res) => {
  res.json({ code: 0, data: { machineId: getMachineId() } })
})

router.post('/activate', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  if (!code) {
    return res.status(400).json({ code: 400, message: '请输入注册码' })
  }

  const result = activateLicense(code)
  if ('code' in result) {
    const status = result.code === LICENSE_ERROR.EXPIRED ? 402 : 400
    return res.status(status).json(result)
  }

  return res.json({
    code: 0,
    message: '激活成功',
    data: { expiresAt: result.expiresAt },
  })
})

export default router
