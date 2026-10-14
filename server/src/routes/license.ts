import { Router } from 'express'
import {
  activateLicense,
  getLicenseStatus,
  LICENSE_ERROR,
  listLicenseLog,
  listOnlineIdentities,
  ONLINE_WINDOW_MINUTES,
} from '../services/licenseService.js'
import { getMachineId } from '../services/machineId.js'
import { authMiddleware, peekTokenUserName, requirePermission } from '../middleware/auth.js'
import { toDisplayIp } from '../utils/requestIp.js'

const router = Router()

router.get('/status', (_req, res) => {
  res.json({ code: 0, data: getLicenseStatus() })
})

router.get('/machine-id', (_req, res) => {
  res.json({ code: 0, data: { machineId: getMachineId() } })
})

/** 系统设置「注册信息」：授权详情 + 当前在线用户 + 注册变动历史（需登录） */
router.get('/info', authMiddleware, requirePermission('system:init'), (_req, res) => {
  const online = listOnlineIdentities().map(o => ({
    ...o,
    loginIp: o.loginIp ? toDisplayIp(o.loginIp) : null,
  }))
  res.json({
    code: 0,
    data: {
      status: getLicenseStatus(),
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
      online,
      history: listLicenseLog(),
    },
  })
})

router.post('/activate', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  if (!code) {
    return res.status(400).json({ code: 400, message: '请输入注册码' })
  }

  const result = activateLicense(code, undefined, peekTokenUserName(req))
  if ('code' in result) {
    const status = result.code === LICENSE_ERROR.EXPIRED ? 402 : 400
    return res.status(status).json(result)
  }

  return res.json({
    code: 0,
    message: '激活成功',
    data: {
      expiresAt: result.expiresAt,
      modules: result.modules,
      maxConcurrent: result.maxConcurrent,
    },
  })
})

export default router
