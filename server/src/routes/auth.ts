import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs'
import multer from 'multer'
import { join } from 'path'
import { getDb, ensureAccountSetSecurityBootstrap, getDeployDir } from '../db/index.js'
import {
  generateToken,
  authMiddleware,
  requirePermission,
  AuthRequest,
  asyncHandler,
} from '../middleware/index.js'
import { operationLog } from '../middleware/index.js'
import { acdImportService } from '../services/acdImport.js'
import {
  createAccountSetFromStandardTemplate,
  listStandardTemplatesForClient,
  StandardTemplateCreateError,
} from '../services/standardTemplateAccountSet.js'
import { getStandardTemplateGroups } from '../services/standardTemplateScan.js'
import Database from 'better-sqlite3'
import { getRequestIp, toDisplayIp } from '../utils/requestIp.js'
import {
  expireStaleLoginSessions,
  findOtherIpActiveSession,
  forceOtherIpActiveSessions,
  isSessionIdleExpired,
  listActiveLoginSessions,
} from '../services/loginSession.js'
import { log } from '../utils/logger.js'
import { listActiveUsersForAccountSet } from '../services/loginUsers.js'
import {
  resolvePrimaryUserRole,
  resolveUserPermissions,
  userHasLoginPermissionConfig,
} from '../services/userRoleLinks.js'
import {
  allocateAccountSetCode,
  applyAccountCodeConfigToDb,
  bootstrapNewAccountSetDefaults,
  resolveAccountSetStartDate,
  syncAccountSetStartDate,
} from '../services/accountSetDefaults.js'
import { importSingleAccountSetBackupAsNewAccountSet } from '../services/accountSetBackupRestore.js'
import { repairDatabaseReferentialIntegrity } from '../services/databaseIntegrityRepair.js'

// 备份上传存储（uploads 目录在 deploy 根目录）
const uploadDir = join(getDeployDir(), 'uploads')
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true })

// 允许的文件类型
const ALLOWED_BACKUP_MIMES = ['application/x-sqlite3', 'application/octet-stream']
const ALLOWED_BACKUP_EXTENSIONS = ['.db', '.sqlite', '.sqlite3', '.acd']

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 1, // 单次只允许上传一个文件
  },
  fileFilter: (req, file, cb) => {
    // 检查文件扩展名
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'))
    if (!ALLOWED_BACKUP_EXTENSIONS.includes(ext)) {
      return cb(new Error(`不支持的文件类型，仅允许: ${ALLOWED_BACKUP_EXTENSIONS.join(', ')}`))
    }
    cb(null, true)
  },
})

const router = Router()

// 获取账套列表（公开，无需认证）
router.get('/account-sets', (req, res) => {
  try {
    const db = getDb()
    const accountSetColumns = db.prepare('PRAGMA table_info(account_sets)').all() as Array<{
      name: string
    }>
    const hasStatus = accountSetColumns.some(column => column.name === 'status')
    const hasCreatedAt = accountSetColumns.some(column => column.name === 'created_at')
    const orderBy = hasCreatedAt ? 'created_at DESC' : 'name ASC'
    const whereClause = hasStatus ? "WHERE status = 'active'" : ''
    const list = db
      .prepare(`SELECT id, name, code FROM account_sets ${whereClause} ORDER BY ${orderBy}`)
      .all()
    res.json({ code: 0, data: list })
  } catch (err) {
    log.error('account-sets list failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ code: 500, message: '获取账套列表失败' })
  }
})

// 获取标准模版列表（公开，无需认证）：目录来自「标准模版/catalog.json」+ 子目录扫描
router.get('/standard-account-set-templates', (req, res) => {
  try {
    res.json({
      code: 0,
      data: listStandardTemplatesForClient(),
      groups: getStandardTemplateGroups(),
    })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 从标准模版创建账套（公开，无需认证）
router.post(
  '/account-sets/create-from-standard-template',
  asyncHandler(async (req, res) => {
    const db = getDb()
    try {
      const result = await createAccountSetFromStandardTemplate(db, req.body || {})
      res.json({
        code: 0,
        message: result.reportStats?.failed > 0
          ? '从标准模板创建成功，已自动创建管理员账号 admin/admin123，但 Excel 报表导入部分失败'
          : '从标准模板创建成功，已自动创建管理员账号 admin/admin123',
        data: {
          id: result.id,
          name: result.name,
          code: result.code,
          start_date: result.start_date,
          template: result.template,
          accounting_standard: result.accounting_standard,
          acdStats: result.acdStats,
          standardReports: result.standardReports,
          reportStats: result.reportStats,
          warnings: result.warnings,
        },
      })
    } catch (err: any) {
      if (err instanceof StandardTemplateCreateError) {
        return res.status(err.status).json({ code: err.status, message: err.message })
      }
      console.error('[标准模版] 创建账套失败:', err)
      log.error('account-sets/create-from-standard-template failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return res.status(500).json({
        code: 500,
        message: '创建账套失败: ' + (err?.message || '未知错误'),
      })
    }
  })
)

// 新增账套（公开，无需认证，用于登录页面）
router.post('/account-sets/create', (req, res) => {
  try {
    const {
      name,
      code,
      credit_code,
      fiscal_year,
      start_date,
      unit_leader,
      chief_accountant,
      account_levels,
      account_code_lengths,
    } = req.body
    if (req.body?.use_template === true) {
      return res.status(400).json({ code: 400, message: '请选择标准模板，不能创建空账套' })
    }
    if (!name) {
      return res.status(400).json({ code: 400, message: '名称不能为空' })
    }
    const db = getDb()
    // 名称重复校验
    const existingName = db.prepare('SELECT id FROM account_sets WHERE name = ?').get(name)
    if (existingName) {
      return res.status(400).json({ code: 400, message: '账套名称已存在' })
    }
    const finalCode = allocateAccountSetCode(db, code)
    const id = uuidv4()
    const fiscalYear = fiscal_year || new Date().getFullYear()
    const normalizedStartDate = resolveAccountSetStartDate(start_date, fiscalYear)
    db.prepare(
      `
    INSERT INTO account_sets (id, name, code, credit_code, fiscal_year, start_date, unit_leader, chief_accountant)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    ).run(
      id,
      name,
      finalCode,
      credit_code,
      fiscalYear,
      normalizedStartDate,
      unit_leader,
      chief_accountant
    )

    applyAccountCodeConfigToDb(db, id, account_levels, account_code_lengths)

    bootstrapNewAccountSetDefaults(db, id, {
      start_date: normalizedStartDate,
      fiscal_year: fiscalYear,
      unit_name: name,
    })

    // 自动创建超级管理员 admin/admin123
    ensureAccountSetSecurityBootstrap(id)

    res.json({
      code: 0,
      message: '创建成功，已自动创建管理员账号 admin/admin123',
      data: { id, name, code: finalCode },
    })
  } catch (err: any) {
    log.error('account-sets/create failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return res.status(500).json({
      code: 500,
      message: '创建账套失败: ' + (err?.message || '未知错误'),
    })
  }
})

// 获取指定账套的用户列表（公开，用于登录页面显示用户名建议）
router.get('/users-by-account-set/:accountSetId', (req, res) => {
  const { accountSetId } = req.params
  if (!/^[0-9a-f-]{36}$/i.test(accountSetId)) {
    return res.status(400).json({ code: 400, message: '无效的账套ID' })
  }

  try {
    const users = listActiveUsersForAccountSet(accountSetId)
    res.json({ code: 0, data: users })
  } catch (err) {
    log.error('users-by-account-set failed', {
      accountSetId,
      error: err instanceof Error ? err.message : String(err),
    })
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 验证码
router.get('/captcha', (req, res) => {
  const captchaId = uuidv4()
  // 生成简单数学运算验证码
  const num1 = Math.floor(Math.random() * 10) + 1
  const num2 = Math.floor(Math.random() * 10) + 1
  const captchaText = `${num1}+${num2}=?`
  const captchaAnswer = String(num1 + num2)
  // 存储验证码答案（生产环境用Redis）
  const db = getDb()
  db.prepare(
    'INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, NULL, ?, ?)'
  ).run(uuidv4(), `captcha:${captchaId}`, captchaAnswer)
  // 返回SVG格式简单验证码
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect fill="#f0f0f0" width="120" height="40" rx="5"/><text x="10" y="28" font-family="Arial" font-size="18" fill="#333">${num1} + ${num2} = ?</text></svg>`
  res.json({
    captchaId,
    captchaUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  })
})

// 登录
router.post('/login', async (req, res) => {
  const { username, password, targetAccountSetId, forceLogin, rememberMe } = req.body
  // 密码允许是空串（ACD 里未设密码的用户），但必须是字符串，不能整个字段缺失
  if (!username || typeof password !== 'string') {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' })
  }
  if (!targetAccountSetId) {
    return res.status(400).json({ code: 400, message: '请选择账套' })
  }

  const db = getDb()
  repairDatabaseReferentialIntegrity(db)

  const targetSet = db
    .prepare('SELECT * FROM account_sets WHERE id = ?')
    .get(targetAccountSetId) as any
  if (!targetSet) {
    return res.status(400).json({ code: 400, message: '账套不存在' })
  }
  if (targetSet.status === 'inactive') {
    return res.status(400).json({ code: 400, message: '该账套已停用，无法登录' })
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND account_set_id = ?')
    .get(username, targetAccountSetId) as any

  if (!user) {
    return res.status(401).json({ code: 401, message: '用户名或密码错误' })
  }

  // 检查账号锁定
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(403).json({ code: 403, message: '账号已被锁定，请稍后再试' })
  }

  // 检查是否禁用
  if (user.status === 'disabled') {
    return res.status(403).json({ code: 403, message: '账号已被禁用' })
  }

  // 验证密码。ACD 导入的用户可能本来就没设密码（users.password 为空串），
  // 这类账号密码留空即可登录；但只接受空密码，不能被任意密码蒙混过去。
  const storedPassword = String(user.password ?? '')
  const valid = storedPassword === '' ? password === '' : bcrypt.compareSync(password, storedPassword)
  if (!valid) {
    const attempts = (user.failed_attempts || 0) + 1
    if (attempts >= 5) {
      db.prepare(
        "UPDATE users SET failed_attempts = ?, locked_until = datetime('now', '+30 minute') WHERE id = ?"
      ).run(attempts, user.id)
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id)
    }
    return res.status(401).json({ code: 401, message: '用户名或密码错误' })
  }

  // 切换账套校验：用户必须属于该账套
  const effectiveAccountSetId = user.account_set_id
  if (user.account_set_id !== targetAccountSetId) {
    return res.status(403).json({ code: 403, message: '您没有权限登录该账套' })
  }

  // 验证用户权限配置：至少有一个角色或自定义权限，且解析后非空
  if (!userHasLoginPermissionConfig(db, user, effectiveAccountSetId)) {
    return res.status(403).json({
      code: 403,
      message: '该用户未配置权限，无法登录，请联系管理员',
    })
  }

  const permissionsPreview = resolveUserPermissions(db, {
    userId: user.id,
    accountSetId: effectiveAccountSetId,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })
  if (permissionsPreview.length === 0) {
    return res.status(403).json({
      code: 403,
      message: '该用户未配置有效权限，无法登录，请联系管理员',
    })
  }

  // 获取账套信息
  const accountSet = targetSet
  const currentLoginIp = getRequestIp(req)
  const userAgent = req.get('user-agent') || ''
  const lastLoginTime = user.last_login_at || null
  const lastLoginIp = user.last_login_ip ? toDisplayIp(user.last_login_ip) : null

  expireStaleLoginSessions(db, user.id, effectiveAccountSetId)
  const activeSessions = listActiveLoginSessions(db, user.id, effectiveAccountSetId).filter(
    session => !isSessionIdleExpired(db, session.last_seen_at, !!rememberMe)
  )
  const otherIpSession = findOtherIpActiveSession(activeSessions, currentLoginIp, db)

  if (otherIpSession && !forceLogin) {
    const activeLoginIp = otherIpSession.login_ip ? toDisplayIp(otherIpSession.login_ip) : 'unknown'
    return res.status(409).json({
      code: 40901,
      message: `该账号已在 IP ${activeLoginIp} 登录，是否强制登录？`,
      data: {
        activeLoginIp,
        activeLoginAt: otherIpSession.login_at,
        activeLastSeenAt: otherIpSession.last_seen_at,
        lastLoginTime,
        lastLoginIp,
        currentLoginIp,
      },
    })
  }

  let forcedOldLoginIp: string | null = null
  if (forceLogin) {
    forcedOldLoginIp = forceOtherIpActiveSessions(
      db,
      activeSessions,
      currentLoginIp,
      currentLoginIp
    )
  }

  const sessionId = uuidv4()
  db.prepare(
    `INSERT INTO user_login_sessions (
      id, account_set_id, user_id, username, login_ip, user_agent, login_at, last_seen_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'active')`
  ).run(sessionId, effectiveAccountSetId, user.id, user.username, currentLoginIp, userAgent)

  // 更新登录信息
  db.prepare(
    "UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, failed_attempts = 0 WHERE id = ?"
  ).run(currentLoginIp, user.id)

  const token = generateToken({
    userId: user.id,
    userName: user.nickname || user.username,
    accountSetId: effectiveAccountSetId,
    roleId: user.role_id,
    sessionId,
    remember: !!rememberMe,
  })

  const permissions = resolveUserPermissions(db, {
    userId: user.id,
    accountSetId: effectiveAccountSetId,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })

  const primaryRole = resolvePrimaryUserRole(db, {
    userId: user.id,
    accountSetId: effectiveAccountSetId,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })

  res.json({
    code: 0,
    message: '登录成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: primaryRole?.code,
      roleName: primaryRole?.name,
      permissions,
    },
    accountSetId: accountSet?.id,
    accountSetName: accountSet?.name,
    lastLoginTime,
    lastLoginIp,
    currentLoginIp,
    forcedLogin: !!forceLogin,
    forcedOldLoginIp,
  })
})

// 获取用户信息
router.get('/userinfo', authMiddleware, (req: AuthRequest, res) => {
  const db = getDb()
  const user = db
    .prepare(
      'SELECT u.* FROM users u WHERE u.id = ? AND u.account_set_id = ?'
    )
    .get(req.userId, req.accountSetId) as any
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' })
  }

  const accountSet = db
    .prepare('SELECT name FROM account_sets WHERE id = ?')
    .get(req.accountSetId) as { name: string } | undefined

  const permissions = req.permissions || []
  const primaryRole = resolvePrimaryUserRole(db, {
    userId: user.id,
    accountSetId: req.accountSetId!,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })

  const accountScopeRestricted = req.accountScope?.restricted && !req.accountScope?.bypass
  const allowedAccountIds =
    accountScopeRestricted && req.accountScope
      ? Array.from(req.accountScope.allowedAccountIds)
      : undefined

  res.json({
    code: 0,
    data: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: primaryRole?.code || '',
      roleName: primaryRole?.name || '',
      accountSetId: user.account_set_id,
      accountSetName: accountSet?.name || '',
      permissions,
      account_scope_restricted: !!accountScopeRestricted,
      allowed_account_ids: allowedAccountIds,
    },
  })
})

// 登出
router.post('/logout', authMiddleware, (req: AuthRequest, res) => {
  if (req.sessionId) {
    const db = getDb()
    db.prepare(
      `UPDATE user_login_sessions
       SET status = 'logout', last_seen_at = datetime('now')
       WHERE id = ? AND status = 'active'`
    ).run(req.sessionId)
  }
  res.json({ code: 0, message: '已退出登录' })
})

// 切换操作员：固定当前账套，只重新认证当前账套下的其他用户
router.post('/switch-operator', authMiddleware, (req: AuthRequest, res) => {
  const { username, password, forceLogin } = req.body
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '请选择操作员并输入密码' })
  }
  if (!req.accountSetId) {
    return res.status(400).json({ code: 400, message: '当前账套无效，请重新登录' })
  }

  const db = getDb()
  const accountSet = db
    .prepare('SELECT * FROM account_sets WHERE id = ?')
    .get(req.accountSetId) as any
  if (!accountSet) {
    return res.status(404).json({ code: 404, message: '账套不存在' })
  }
  if (accountSet.status === 'inactive') {
    return res.status(400).json({ code: 400, message: '该账套已停用，无法切换操作员' })
  }

  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND account_set_id = ?')
    .get(username, req.accountSetId) as any
  if (!user) {
    return res.status(401).json({ code: 401, message: '操作员或密码错误' })
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(403).json({ code: 403, message: '账号已被锁定，请稍后再试' })
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ code: 403, message: '账号已被禁用' })
  }

  const valid = bcrypt.compareSync(password, user.password)
  if (!valid) {
    const attempts = (user.failed_attempts || 0) + 1
    if (attempts >= 5) {
      db.prepare(
        "UPDATE users SET failed_attempts = ?, locked_until = datetime('now', '+30 minute') WHERE id = ?"
      ).run(attempts, user.id)
    } else {
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id)
    }
    return res.status(401).json({ code: 401, message: '操作员或密码错误' })
  }

  if (!userHasLoginPermissionConfig(db, user, req.accountSetId)) {
    return res.status(403).json({
      code: 403,
      message: '该用户未配置权限，无法登录，请联系管理员',
    })
  }

  const permissions = resolveUserPermissions(db, {
    userId: user.id,
    accountSetId: req.accountSetId,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })

  if (permissions.length === 0) {
    return res.status(403).json({
      code: 403,
      message: '该用户未配置有效权限，无法登录，请联系管理员',
    })
  }

  const primaryRole = resolvePrimaryUserRole(db, {
    userId: user.id,
    accountSetId: req.accountSetId,
    roleId: user.role_id,
    customPermissions: user.custom_permissions,
  })

  const currentLoginIp = getRequestIp(req)
  const userAgent = req.get('user-agent') || ''
  const lastLoginTime = user.last_login_at || null
  const lastLoginIp = user.last_login_ip ? toDisplayIp(user.last_login_ip) : null

  expireStaleLoginSessions(db, user.id, req.accountSetId)
  const activeSessions = listActiveLoginSessions(
    db,
    user.id,
    req.accountSetId,
    req.sessionId || undefined
  ).filter(session => !isSessionIdleExpired(db, session.last_seen_at, req.remember))
  const otherIpSession = findOtherIpActiveSession(activeSessions, currentLoginIp, db)

  if (otherIpSession && !forceLogin) {
    const activeLoginIp = otherIpSession.login_ip ? toDisplayIp(otherIpSession.login_ip) : 'unknown'
    return res.status(409).json({
      code: 40901,
      message: `该操作员已在 IP ${activeLoginIp} 登录，是否强制登录？`,
      data: {
        activeLoginIp,
        activeLoginAt: otherIpSession.login_at,
        activeLastSeenAt: otherIpSession.last_seen_at,
        lastLoginTime,
        lastLoginIp,
        currentLoginIp,
      },
    })
  }

  let forcedOldLoginIp: string | null = null
  if (forceLogin) {
    forcedOldLoginIp = forceOtherIpActiveSessions(
      db,
      activeSessions,
      currentLoginIp,
      currentLoginIp
    )
  }

  if (req.sessionId) {
    db.prepare(
      `UPDATE user_login_sessions
       SET status = 'logout', last_seen_at = datetime('now')
       WHERE id = ? AND status = 'active'`
    ).run(req.sessionId)
  }

  const sessionId = uuidv4()
  db.prepare(
    `INSERT INTO user_login_sessions (
      id, account_set_id, user_id, username, login_ip, user_agent, login_at, last_seen_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'active')`
  ).run(sessionId, req.accountSetId, user.id, user.username, currentLoginIp, userAgent)

  db.prepare(
    "UPDATE users SET last_login_at = datetime('now'), last_login_ip = ?, failed_attempts = 0 WHERE id = ?"
  ).run(currentLoginIp, user.id)

  const token = generateToken({
    userId: user.id,
    userName: user.nickname || user.username,
    accountSetId: req.accountSetId,
    roleId: user.role_id,
    sessionId,
    remember: req.remember,
    permissions,
  })

  res.json({
    code: 0,
    message: '切换操作员成功',
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: primaryRole?.code || '',
      roleName: primaryRole?.name || '自定义权限',
      permissions,
    },
    accountSetId: accountSet.id,
    accountSetName: accountSet.name,
    lastLoginTime,
    lastLoginIp,
    currentLoginIp,
    forcedLogin: !!forceLogin,
    forcedOldLoginIp,
  })
})

// 切换账套
router.post('/switch-account-set', authMiddleware, (req: AuthRequest, res) => {
  const { account_set_id } = req.body
  if (!account_set_id) {
    return res.status(400).json({ code: 400, message: '账套ID不能为空' })
  }
  const db = getDb()

  // 校验当前用户是否属于目标账套
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId) as any
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' })
  }
  if (user.account_set_id !== account_set_id) {
    return res.status(403).json({ code: 403, message: '您没有权限访问该账套' })
  }

  // 校验目标账套是否存在且可用
  const accountSet = db
    .prepare('SELECT * FROM account_sets WHERE id = ?')
    .get(account_set_id) as any
  if (!accountSet) {
    return res.status(404).json({ code: 404, message: '账套不存在' })
  }
  if (accountSet.status === 'inactive') {
    return res.status(400).json({ code: 400, message: '该账套已停用，无法切换' })
  }

  // 返回切换账套信息，前端跳转到登录页重新认证
  res.json({
    code: 0,
    message: '切换成功，请重新登录',
    username: user.username,
    accountSetId: accountSet.id,
    accountSetName: accountSet.name,
  })
})

// ===================== 备份导入 =====================
// 上传备份文件并导入为新账套（登录前使用，无需认证）
router.post('/backup-import', upload.single('file'), (req: any, res) => {
  const { name, fiscal_year, start_date } = req.body as any

  if (!req.file) {
    return res.status(400).json({ code: 400, message: '请上传备份文件' })
  }
  if (!name) {
    return res.status(400).json({ code: 400, message: '账套名称不能为空' })
  }

  const backupPath = req.file.path

  try {
    const result = importSingleAccountSetBackupAsNewAccountSet({
      sourcePath: backupPath,
      name,
      fiscalYear: fiscal_year ? Number(fiscal_year) : undefined,
      startDate: start_date,
    })

    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    res.json({
      code: 0,
      message: '备份导入成功',
      data: {
        id: result.accountSetId,
        name,
        code: result.code,
        fiscal_year: result.fiscalYear,
        backupAccountSetName: result.stats.sourceAccountSetName,
        imported: {
          accounts: result.stats.accounts,
          vouchers: result.stats.vouchers,
          entries: result.stats.voucherEntries,
          initBalances: result.stats.initBalances,
          auxCategories: result.stats.auxCategories,
          auxItems: result.stats.auxItems,
          users: result.stats.users || 0,
        },
      },
    })
  } catch (err: any) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    console.error('Backup import error:', err)
    res.status(500).json({ code: 500, message: '导入失败: ' + err.message })
  }
})

// ===================== ACD 账套导入 =====================
// 上传润衡ACD备份文件并导入为新账套（需要认证 + 账套管理权限）
// ===================== ACD 导入（无需认证，用于登录页面导入）=====================
router.post('/acd-import', upload.single('file'), async (req: AuthRequest, res) => {
  const { name } = req.body as any

  if (!req.file) {
    return res.status(400).json({ code: 400, message: '请上传ACD文件' })
  }
  if (!name) {
    return res.status(400).json({ code: 400, message: '账套名称不能为空' })
  }

  // 自动生成账套编码（使用时间戳）
  const code = `AS${Date.now()}`

  const acdPath = req.file.path

  try {
    // Read the uploaded file as buffer
    const acdBuffer = readFileSync(acdPath)

    // Basic validation: ACD files should be zlib-compressed and contain 'rhsj' marker
    const marker = Buffer.from('rhsj\\')
    if (!acdBuffer.includes(marker)) {
      return res
        .status(400)
        .json({ code: 400, message: '无效的ACD文件格式，请确认是润衡财务软件导出的.acd文件' })
    }

    const fiscalYear = new Date().getFullYear()
    const startDate = `${fiscalYear}-01-01`

    const result = await acdImportService({
      acdBuffer,
      name,
      code,
      fiscalYear,
      startDate,
    })

    // Clean up temp file
    try {
      unlinkSync(acdPath)
    } catch {
      /* ignore */
    }

    const { stats } = result
    res.json({
      code: 0,
      message: 'ACD账套导入成功',
      data: {
        id: result.accountSetId,
        name: result.name,
        code: result.code,
        fiscal_year: result.fiscalYear,
        start_date: result.startDate,
        imported: {
          accounts: stats.accounts.inserted + stats.accounts.updated,
          initBalances: stats.initBalances.inserted,
          transferTypes: stats.transferTypes.types,
          transferItems: stats.transferTypes.items,
          vouchers: stats.vouchers.vouchers,
          voucherEntries: stats.vouchers.entries,
          reportDefinitions: stats.reportTemplates.definitions,
          standardReports: result.standardReports,
        },
        warnings: stats.warnings,
      },
    })
  } catch (err: any) {
    // Clean up temp file
    try {
      unlinkSync(acdPath)
    } catch {
      /* ignore */
    }
    console.error('ACD import error:', err)
    const message = String(err?.message || err)

    // 缺表/缺列说明本地库结构落后于程序，这类英文原文会被 humanizeError 统一
    // 兜底成「数据处理失败」，前台看不出所以然；这里换成纯中文提示，
    // 让它原样透传，并指明具体缺的是什么、怎么修。
    const schemaGap = message.match(/no such (?:table|column):\s*([\w.]+)/i)
    if (schemaGap) {
      return res.status(500).json({
        code: 500,
        message: `ACD导入失败：当前数据库缺少「${schemaGap[1]}」，结构版本落后于程序。请重启服务让系统自动补建缺失结构后重试；若仍失败请联系管理员`,
      })
    }

    const hint =
      message.includes('malformed') || message.includes('损坏')
        ? '。若数据库已损坏，请停止服务并删除 data 目录下的 finance.db、finance.db-wal、finance.db-shm 后重新启动'
        : ''
    res.status(500).json({ code: 500, message: 'ACD导入失败: ' + message + hint })
  }
})

export default router
