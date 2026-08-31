import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, dirname, extname } from 'path'
import multer from 'multer'
import { getDb, ensureAccountSetSecurityBootstrap, getDeployDir } from '../db/index.js'
import {
  authMiddleware,
  requirePermission,
  AuthRequest,
  operationLog,
} from '../middleware/index.js'
import { buildSystemLogsQuery, buildSystemUsersQuery, getUserRoles } from '../services/systemQuery.js'
import {
  importAcdTemplateToAccountSet,
  type ImportStats,
} from '../scripts/importAcdToCurrentAccountSet.js'
async function importExcelReportsFromTemplate(...args: any[]) {
  const module = await import('../services/standardTemplateImport.js')
  return (module.importExcelReportsFromTemplate as any)(...args)
}
import { listImportableExcelFiles } from '../utils/reportTemplateFiles.js'
import { syncAcdReportFormulasToAccountSet } from '../services/acdReportFormulaSync.js'
import systemReinitializeRoutes from './systemReinitialize.js'
import { PERMISSIONS, PERMISSION_MODULES } from '../db/permissions.js'
import {
  getRoleAccountScopePayload,
  getUserAccountScopePayload,
  saveRoleAccountScopes,
  saveUserAccountScopes,
} from '../services/accountAuthorization.js'
import {
  ACCOUNTING_STANDARD_PARAM_KEY,
  inferAccountingStandardFromTemplateId,
  validateSystemParamEntry,
  validateDashboardRuleConfigAgainstAccounts,
  getAccountingStandardParam,
  getDashboardCategoryRulesParam,
  getDashboardRuleConfigParam,
  parseDashboardRuleConfigJson,
  isAccountingStandardParam,
} from '../services/accountingStandard.js'
import {
  getDashboardCategoryConfig,
  getResolvedAccountingStandardName,
  buildPresetDashboardCategoryRules,
  buildPresetDashboardBudgetRules,
} from '../services/dashboardCategoryConfig.js'
import { resolveAccountingStandard } from '../services/staticReportConfig.js'
import {
  allocateAccountSetCode,
  bootstrapNewAccountSetDefaults,
  readAccountSetStartDate,
  resolveAccountSetStartDate,
  syncAccountSetStartDate,
  isValidAccountSetStartDate,
} from '../services/accountSetDefaults.js'
import { cleanupAccountSetCascade } from '../services/accountSetCleanup.js'
import {
  readGlobalBranding,
  upsertGlobalBrandParam,
  validateBrandParam,
  BRAND_LOGO_URL_KEY,
  BRAND_TITLE_KEY,
  BRAND_SUBTITLE_KEY,
} from '../services/brandingConfig.js'

const router = Router()

const brandUploadDir = join(getDeployDir(), 'uploads', 'branding')
const brandUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(brandUploadDir)) mkdirSync(brandUploadDir, { recursive: true })
      cb(null, brandUploadDir)
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.png'
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'].includes(ext) ? ext : '.png'
      cb(null, `logo${safeExt}`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('仅支持图片文件'))
  },
})

/** 登录页 / 导航栏品牌展示（无需登录） */
router.get('/branding', (_req, res) => {
  const db = getDb()
  res.json({ code: 0, data: readGlobalBranding(db) })
})

router.use(authMiddleware)

// ===================== 账套管理 =====================

router.get('/account-sets', (req: AuthRequest, res) => {
  const db = getDb()
  const accountSetColumns = db.prepare('PRAGMA table_info(account_sets)').all() as Array<{
    name: string
  }>
  const hasCreatedAt = accountSetColumns.some(column => column.name === 'created_at')
  // 使用固定白名单，不拼接用户输入
  const orderBy = hasCreatedAt ? 'created_at DESC' : 'name ASC'
  const list = db
    .prepare(
      hasCreatedAt
        ? 'SELECT * FROM account_sets ORDER BY created_at DESC'
        : 'SELECT * FROM account_sets ORDER BY name ASC'
    )
    .all() as any[]
  // 附带每个账套的科目级数和科目长度
  const result = list.map(row => {
    const levels = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='account_levels' LIMIT 1`
      )
      .get(row.id) as any
    const lengths = db
      .prepare(
        `SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='account_code_lengths' LIMIT 1`
      )
      .get(row.id) as any
    return {
      ...row,
      account_levels: levels ? parseInt(levels.param_value) || 6 : 6,
      account_code_lengths: lengths
        ? (() => {
            try {
              return JSON.parse(lengths.param_value)
            } catch {
              return [4, 2, 2, 2, 2, 2]
            }
          })()
        : [4, 2, 2, 2, 2, 2],
    }
  })
  res.json({ code: 0, data: result })
})

router.post(
  '/account-sets',
  requirePermission('system:account'),
  operationLog('创建账套', '系统管理'),
  async (req: AuthRequest, res) => {
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
    if (req.body?.template_type === 'standard') {
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

    // 写入科目级数和科目长度到 system_params
    const finalLevels = account_levels || 6
    const finalLengths = Array.isArray(account_code_lengths)
      ? account_code_lengths
      : [4, 2, 2, 2, 2, 2]
    db.prepare(
      `INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)`
    ).run(uuidv4(), id, 'account_levels', String(finalLevels))
    db.prepare(
      `INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)`
    ).run(uuidv4(), id, 'account_code_lengths', JSON.stringify(finalLengths.slice(0, finalLevels)))

    bootstrapNewAccountSetDefaults(db, id, {
      start_date: normalizedStartDate,
      fiscal_year: fiscalYear,
      unit_name: name,
    })

    // 自动创建超级管理员 admin/admin123
    ensureAccountSetSecurityBootstrap(id)

    res.json({ code: 0, message: '创建成功，已自动创建管理员账号 admin/admin123', data: { id } })
  }
)

router.put(
  '/account-sets/:id',
  requirePermission('system:account'),
  operationLog('修改账套', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const {
      name,
      code,
      credit_code,
      fiscal_year,
      start_date,
      unit_leader,
      chief_accountant,
      status,
    } = req.body
    const db = getDb()
    // 名称重复校验（排除自身）
    if (name) {
      const existingName = db
        .prepare('SELECT id FROM account_sets WHERE name = ? AND id != ?')
        .get(name, id)
      if (existingName) {
        return res.status(400).json({ code: 400, message: '账套名称已存在' })
      }
    }
    // 编码重复校验（排除自身）
    if (code) {
      const existingCode = db
        .prepare('SELECT id FROM account_sets WHERE code = ? AND id != ?')
        .get(code, id)
      if (existingCode) {
        return res.status(400).json({ code: 400, message: '账套编码已存在' })
      }
    }
    db.prepare(
      `
    UPDATE account_sets SET name=?, code=?, credit_code=?, fiscal_year=?, start_date=?, unit_leader=?, chief_accountant=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `
    ).run(
      name,
      code,
      credit_code,
      fiscal_year,
      start_date,
      unit_leader,
      chief_accountant,
      status,
      id
    )
    if (start_date) {
      syncAccountSetStartDate(db, id, resolveAccountSetStartDate(start_date, fiscal_year))
    }
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/account-sets/:id',
  requirePermission('system:account'),
  operationLog('删除账套', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { password } = req.body || {}
    const db = getDb()
    // 校验admin密码
    const adminUser = db
      .prepare("SELECT password FROM users WHERE username = 'admin' AND account_set_id = ?")
      .get(id) as any
    if (!adminUser) {
      return res.status(400).json({ code: 400, message: '未找到该账套的管理员账号' })
    }
    if (!password || !bcrypt.compareSync(password, adminUser.password)) {
      return res.status(400).json({ code: 400, message: '管理员密码错误' })
    }
    try {
      cleanupAccountSetCascade(db, id)
    } catch (err: any) {
      const msg = String(err?.message || err)
      if (msg.includes('FOREIGN KEY')) {
        return res.status(500).json({
          code: 500,
          message: '删除账套失败：存在未清理的关联数据，请联系管理员或升级至最新版本后重试',
        })
      }
      return res.status(500).json({ code: 500, message: '删除账套失败: ' + msg })
    }
    res.json({ code: 0, message: '删除成功' })
  }
)

// ===================== 账套模板 =====================

// Helper: resolve template directories based on runtime environment
function getTemplateDirs(): string[] {
  const cwd = process.cwd()
  // Deploy mode: cwd = deploy-final/, templates in deploy-final/模版/
  // Dev mode: cwd = project root or server/, templates in project 模版/
  return [join(cwd, '模版'), resolve(cwd, '..', '模版')]
}

// Helper: resolve standard template directories
function getStandardTemplateDirs(): string[] {
  const deployDir = getDeployDir()
  return [
    join(deployDir, '标准模版'),
    join(process.cwd(), '标准模版'),
    resolve(process.cwd(), '..', '标准模版'),
  ]
}

// Helper: scan standard templates (folders with ACD + Excel files)
function scanStandardTemplates(): Array<{
  id: string
  name: string
  description: string
  acdFile: string
  excelFiles: Array<{ name: string; path: string }>
}> {
  const dirs = getStandardTemplateDirs()
  const templates: Array<{
    id: string
    name: string
    description: string
    acdFile: string
    excelFiles: Array<{ name: string; path: string }>
  }> = []
  const seen = new Set<string>()

  for (const dir of dirs) {
    if (!existsSync(dir)) continue

    const subDirs = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())

    for (const subDir of subDirs) {
      const subDirPath = join(dir, subDir.name)
      const files = readdirSync(subDirPath)

      const acdFile = files.find(f => f.toLowerCase().endsWith('.acd'))
      if (!acdFile) continue

      if (seen.has(subDir.name)) continue
      seen.add(subDir.name)

      const excelFiles = listImportableExcelFiles(subDirPath)

      templates.push({
        id: subDir.name,
        name: subDir.name,
        description: `包含 1 个 ACD 文件和 ${excelFiles.length} 个报表模板`,
        acdFile: join(subDirPath, acdFile),
        excelFiles,
      })
    }
  }

  return templates
}

// Helper: find template file path by template id (filename)
function findTemplateFile(templateId: string): string | null {
  const templateDirs = getTemplateDirs()
  for (const dir of templateDirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.acd'))
    for (const file of files) {
      if (file.toLowerCase() === templateId.toLowerCase()) {
        return join(dir, file)
      }
    }
  }
  return null
}

// Helper: find Excel files in the same directory as a template file
function findExcelFilesInTemplateDir(
  templateFilePath: string
): Array<{ name: string; path: string }> {
  return listImportableExcelFiles(dirname(templateFilePath))
}

// 获取可用模板列表
router.get('/account-set-templates', (req: AuthRequest, res) => {
  const templates: Array<{ id: string; name: string; file: string; description: string }> = []

  const templateDirs = getTemplateDirs()
  const seen = new Set<string>()

  for (const dir of templateDirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.acd'))
    for (const file of files) {
      const filePath = join(dir, file)
      // Derive a readable template name from the filename
      const baseName = file
        .replace(/\.acd$/i, '')
        .replace(/^[a-zA-Z0-9]+/, '') // Remove leading ASCII like "zw60xx"
        .replace(/\d{6,8}$/, '') // Remove trailing date like 20260417
      const displayName = baseName.trim() || file
      const id = file.toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      templates.push({
        id,
        name: displayName,
        file: filePath,
        description: `预设${displayName}会计科目、结转关系及报表`,
      })
    }
  }

  res.json({ code: 0, data: templates })
})

// 获取标准模板列表
router.get('/standard-account-set-templates', (req: AuthRequest, res) => {
  try {
    const templates = scanStandardTemplates()
    res.json({ code: 0, data: templates })
  } catch (error: any) {
    res.status(500).json({ code: 500, message: error.message })
  }
})

// 从模板创建账套
router.post(
  '/account-sets/from-template',
  requirePermission('system:account'),
  operationLog('从模板创建账套', '系统管理'),
  async (req: AuthRequest, res) => {
    const {
      name,
      code,
      credit_code,
      fiscal_year,
      start_date,
      unit_leader,
      chief_accountant,
      template_id,
    } = req.body
    if (!name) {
      return res.status(400).json({ code: 400, message: '名称不能为空' })
    }
    if (!template_id) {
      return res.status(400).json({ code: 400, message: '请选择模板' })
    }

    const db = getDb()
    // 名称重复校验
    const existingName = db.prepare('SELECT id FROM account_sets WHERE name = ?').get(name)
    if (existingName) {
      return res.status(400).json({ code: 400, message: '账套名称已存在' })
    }
    const finalCode = allocateAccountSetCode(db, code)

    // Resolve template file path from template_id (filename)
    const templateFilePath = findTemplateFile(template_id)
    if (!templateFilePath) {
      return res.status(400).json({ code: 400, message: '模板文件不存在' })
    }

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

    // 自动创建超级管理员 admin/admin123
    ensureAccountSetSecurityBootstrap(id)

    bootstrapNewAccountSetDefaults(db, id, {
      start_date: normalizedStartDate,
      fiscal_year: fiscalYear,
      unit_name: name,
    })
    db.prepare(
      `INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)`
    ).run(
      uuidv4(),
      id,
      ACCOUNTING_STANDARD_PARAM_KEY,
      inferAccountingStandardFromTemplateId(template_id)
    )

    // Read ACD template and import (no vouchers, no init balances)
    try {
      const acdBuffer = readFileSync(templateFilePath)
      const stats = importAcdTemplateToAccountSet(id, acdBuffer)

      // Import Excel files from the same template directory
      const excelFiles = findExcelFilesInTemplateDir(templateFilePath)
      let reportStats: any = { total: 0, success: 0, failed: 0, results: [] }
      let acdFormulaStats: any = null
      if (excelFiles.length > 0) {
        try {
          reportStats = await importExcelReportsFromTemplate(db, id, excelFiles)
          acdFormulaStats = syncAcdReportFormulasToAccountSet(db as any, id, acdBuffer)
          console.log('[模板] Excel 报表导入完成:', reportStats)
        } catch (err: any) {
          console.error('[模板] Excel 报表导入失败:', err.message)
          reportStats = {
            total: excelFiles.length,
            success: 0,
            failed: excelFiles.length,
            results: [],
            error: err.message,
          }
        }
      }

      res.json({
        code: 0,
        message: '从模板创建成功，已自动创建管理员账号 admin/admin123',
        data: {
          id,
          imported: {
            accounts: stats.accounts.inserted + stats.accounts.updated,
            transferTypes: stats.transferTypes.types,
            transferItems: stats.transferTypes.items,
            voucherTypes: stats.voucherTypes.inserted + stats.voucherTypes.updated,
            reportDefinitions: stats.reportTemplates.definitions,
          },
          reportStats,
          acdFormulaStats,
        },
      })
    } catch (err: any) {
      console.error('Template import error:', err)
      // Account set was created but template import failed — still return success with warning
      res.json({
        code: 0,
        message: '账套已创建，但模板导入部分失败: ' + (err.message || '未知错误'),
        data: { id },
      })
    }
  }
)

// 从标准模板创建账套
router.post(
  '/account-sets/from-standard-template',
  requirePermission('system:account'),
  operationLog('从标准模板创建账套', '系统管理'),
  async (req: AuthRequest, res) => {
    const {
      name,
      code,
      credit_code,
      fiscal_year,
      start_date,
      unit_leader,
      chief_accountant,
      standard_template_id,
    } = req.body

    if (!name) {
      return res.status(400).json({ code: 400, message: '名称不能为空' })
    }
    if (!standard_template_id) {
      return res.status(400).json({ code: 400, message: '请选择标准模板' })
    }

    // 查找标准模板
    const templates = scanStandardTemplates()
    const template = templates.find(t => t.id === standard_template_id)
    if (!template) {
      return res.status(404).json({ code: 404, message: '标准模板不存在' })
    }

    const db = getDb()
    const id = uuidv4()
    const finalCode = allocateAccountSetCode(db, code)
    const fiscalYear = fiscal_year || new Date().getFullYear()
    const normalizedStartDate = resolveAccountSetStartDate(start_date, fiscalYear)

    // 创建账套
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

    // 创建管理员账号
    ensureAccountSetSecurityBootstrap(id)

    bootstrapNewAccountSetDefaults(db, id, {
      start_date: normalizedStartDate,
      fiscal_year: fiscalYear,
      unit_name: name,
    })

    // 导入 ACD 文件（会自动推断并设置科目编码长度）
    let acdStats: any = {}
    let acdBuffer: Buffer
    try {
      acdBuffer = readFileSync(template.acdFile)
      acdStats = importAcdTemplateToAccountSet(id, acdBuffer)
    } catch (err: any) {
      console.error('ACD import error:', err)
      // ACD 导入失败，删除账套
      db.prepare('DELETE FROM account_sets WHERE id = ?').run(id)
      return res.status(500).json({
        code: 500,
        message: 'ACD 导入失败: ' + (err.message || '未知错误'),
      })
    }

    // 批量导入 Excel 报表。报表导入失败不能让已创建账套返回 500。
    let reportStats: any = { total: 0, success: 0, failed: 0, results: [] }
    let acdFormulaStats: any = null
    try {
      reportStats = await importExcelReportsFromTemplate(db, id, template.excelFiles)
      acdFormulaStats = syncAcdReportFormulasToAccountSet(db as any, id, acdBuffer)
    } catch (err: any) {
      console.error('[标准模板] Excel 报表导入失败:', err)
      reportStats = {
        total: template.excelFiles.length,
        success: 0,
        failed: template.excelFiles.length,
        results: [],
        error: err.message || '未知错误',
      }
    }

    res.json({
      code: 0,
      message: reportStats.failed > 0
        ? '从标准模板创建成功，但报表导入部分失败'
        : '从标准模板创建成功',
      data: {
        id,
        accountSetId: id,
        name,
        code: finalCode,
        start_date: readAccountSetStartDate(db, id),
        acdStats: {
          accounts: acdStats.accounts?.inserted + acdStats.accounts?.updated || 0,
          transferTypes: acdStats.transferTypes?.types || 0,
          transferItems: acdStats.transferTypes?.items || 0,
          voucherTypes: acdStats.voucherTypes?.inserted + acdStats.voucherTypes?.updated || 0,
          auxiliaryItems: acdStats.auxiliaryData?.totalItems || 0,
        },
        reportStats,
        acdFormulaStats,
      },
    })
  }
)

// ===================== 用户管理 =====================

router.get('/users', (req: AuthRequest, res) => {
  const db = getDb()
  const query = buildSystemUsersQuery({
    currentAccountSetId: req.accountSetId || '',
  })
  const rawList = db.prepare(query.sql).all(...query.params) as any[]
  
  const list = rawList.map(user => {
    let customPermissions = null
    if (user.custom_permissions) {
      try {
        customPermissions = JSON.parse(user.custom_permissions)
      } catch {
        customPermissions = []
      }
    }
    
    // 查询用户的所有角色
    const userRoles = getUserRoles(db, user.id, user.account_set_id)
    const roleIds = userRoles.map(r => r.role_id)
    const roleNames = userRoles.map(r => r.role_name).join(', ')
    
    return {
      ...user,
      custom_permissions: customPermissions,
      role_ids: roleIds,
      role_names: roleNames,
    }
  })
  
  res.json({ code: 0, data: list })
})

router.post(
  '/users',
  requirePermission('system:user'),
  operationLog('创建用户', '系统管理'),
  (req: AuthRequest, res) => {
    const { username, password, nickname, role_id, role_ids, email, phone, custom_permissions } = req.body
    const accountSetId = req.accountSetId!
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码不能为空' })
    }
    
    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? AND account_set_id = ?')
      .get(username, accountSetId)
    if (existing) {
      return res.status(400).json({ code: 400, message: '用户名已存在' })
    }
    
    // 处理角色列表（优先使用 role_ids，向后兼容 role_id）
    let roleList: string[] = []
    if (role_ids && Array.isArray(role_ids) && role_ids.length > 0) {
      roleList = role_ids
    } else if (role_id) {
      roleList = [role_id]
    }
    
    // 验证至少有角色或自定义权限
    const hasCustomPerms = custom_permissions && Array.isArray(custom_permissions) && custom_permissions.length > 0
    if (roleList.length === 0 && !hasCustomPerms) {
      return res.status(400).json({ code: 400, message: '必须至少指定一个角色或自定义权限' })
    }
    
    // 验证所有角色存在性
    if (roleList.length > 0) {
      const placeholders = roleList.map(() => '?').join(',')
      const roles = db
        .prepare(`SELECT id FROM roles WHERE id IN (${placeholders}) AND account_set_id = ?`)
        .all(...roleList, accountSetId) as any[]
      if (roles.length !== roleList.length) {
        return res.status(400).json({ code: 400, message: '部分角色不存在或不属于当前账套' })
      }
    }
    
    const id = uuidv4()
    const hash = bcrypt.hashSync(password, 10)
    const customPermsJson = hasCustomPerms ? JSON.stringify(custom_permissions) : null
    
    // 使用事务插入用户和角色关联
    db.transaction(() => {
      // 插入用户（role_id 设为第一个角色，向后兼容）
      db.prepare(
        `
      INSERT INTO users (id, username, password, nickname, role_id, account_set_id, email, phone, custom_permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      ).run(id, username, hash, nickname || username, roleList[0] || null, accountSetId, email, phone, customPermsJson)
      
      // 批量插入 user_roles 记录
      if (roleList.length > 0) {
        const insertUserRole = db.prepare(
          'INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)'
        )
        for (const roleId of roleList) {
          insertUserRole.run(uuidv4(), id, roleId, accountSetId)
        }
      }
    })()
    
    res.json({ code: 0, message: '创建成功', data: { id } })
  }
)

router.put(
  '/users/:id',
  requirePermission('system:user'),
  operationLog('修改用户', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { password, nickname, role_id, role_ids, status, email, phone, custom_permissions } = req.body
    const db = getDb()
    const accountSetId = req.accountSetId!
    const existingUser = db
      .prepare('SELECT id FROM users WHERE id = ? AND account_set_id = ?')
      .get(id, accountSetId)
    if (!existingUser) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }
    
    // 处理角色列表（优先使用 role_ids，向后兼容 role_id）
    let roleList: string[] | undefined
    if (role_ids !== undefined) {
      if (Array.isArray(role_ids)) {
        roleList = role_ids
      } else {
        return res.status(400).json({ code: 400, message: 'role_ids 必须是数组' })
      }
    } else if (role_id !== undefined) {
      roleList = role_id ? [role_id] : []
    }
    
    // 验证所有角色存在性
    if (roleList && roleList.length > 0) {
      const placeholders = roleList.map(() => '?').join(',')
      const roles = db
        .prepare(`SELECT id FROM roles WHERE id IN (${placeholders}) AND account_set_id = ?`)
        .all(...roleList, accountSetId) as any[]
      if (roles.length !== roleList.length) {
        return res.status(400).json({ code: 400, message: '部分角色不存在或不属于当前账套' })
      }
    }
    
    // 构建更新语句
    const updates: string[] = []
    const params: any[] = []
    
    if (password) {
      updates.push('password=?')
      params.push(bcrypt.hashSync(password, 10))
    }
    if (nickname !== undefined) {
      updates.push('nickname=?')
      params.push(nickname)
    }
    if (roleList !== undefined) {
      updates.push('role_id=?')
      params.push(roleList[0] || null)
    }
    if (status !== undefined) {
      updates.push('status=?')
      params.push(status)
    }
    if (email !== undefined) {
      updates.push('email=?')
      params.push(email)
    }
    if (phone !== undefined) {
      updates.push('phone=?')
      params.push(phone)
    }
    if (custom_permissions !== undefined) {
      updates.push('custom_permissions=?')
      params.push(Array.isArray(custom_permissions) ? JSON.stringify(custom_permissions) : null)
    }
    
    // 使用事务更新用户和角色关联
    db.transaction(() => {
      // 更新用户基本信息
      if (updates.length > 0) {
        updates.push("updated_at=datetime('now')")
        params.push(id, accountSetId)
        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id=? AND account_set_id=?`
        db.prepare(sql).run(...params)
      }
      
      // 更新角色关联
      if (roleList !== undefined) {
        // 删除旧的角色关联
        db.prepare('DELETE FROM user_roles WHERE user_id = ? AND account_set_id = ?')
          .run(id, accountSetId)
        
        // 插入新的角色关联
        if (roleList.length > 0) {
          const insertUserRole = db.prepare(
            'INSERT INTO user_roles (id, user_id, role_id, account_set_id) VALUES (?, ?, ?, ?)'
          )
          for (const roleId of roleList) {
            insertUserRole.run(uuidv4(), id, roleId, accountSetId)
          }
        }
      }
    })()
    
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/users/:id',
  requirePermission('system:user'),
  operationLog('删除用户', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    
    // 查询用户信息及其角色信息
    const user = db
      .prepare(`
        SELECT u.id, u.role_id, r.is_personal
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = ? AND u.account_set_id = ?
      `)
      .get(id, req.accountSetId) as any
    
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }
    
    // 使用事务删除用户及其个人角色
    db.transaction(() => {
      // 删除用户
      db.prepare('DELETE FROM users WHERE id = ? AND account_set_id = ?')
        .run(id, req.accountSetId)
      
      // 如果使用的是个人角色，同时删除该角色
      if (user.role_id && user.is_personal === 1) {
        db.prepare('DELETE FROM roles WHERE id = ? AND account_set_id = ?')
          .run(user.role_id, req.accountSetId)
      }
    })()
    
    res.json({ code: 0, message: '删除成功' })
  }
)

router.get(
  '/users/:id/account-scopes',
  requirePermission('system:user'),
  (req: AuthRequest, res) => {
    const db = getDb()
    const user = db
      .prepare('SELECT id FROM users WHERE id=? AND account_set_id=?')
      .get(req.params.id, req.accountSetId)
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }
    const data = getUserAccountScopePayload(db, req.params.id, req.accountSetId!)
    res.json({ code: 0, data })
  }
)

router.put(
  '/users/:id/account-scopes',
  requirePermission('system:user'),
  operationLog('配置用户科目授权', '系统管理'),
  (req: AuthRequest, res) => {
    const { enabled, account_ids } = req.body
    const db = getDb()
    const user = db
      .prepare('SELECT id FROM users WHERE id=? AND account_set_id=?')
      .get(req.params.id, req.accountSetId)
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }
    saveUserAccountScopes(db, req.params.id, req.accountSetId!, {
      enabled: !!enabled,
      account_ids: Array.isArray(account_ids) ? account_ids : [],
    })
    res.json({ code: 0, message: '科目授权已保存' })
  }
)

// ===================== 权限定义 =====================

router.get('/permissions', (req: AuthRequest, res) => {
  // 按模块分组返回完整权限列表
  const grouped = PERMISSION_MODULES.map(mod => ({
    module: mod.key,
    moduleName: mod.name,
    permissions: PERMISSIONS.filter(p => p.module === mod.key).map(p => ({
      code: p.code,
      name: p.name,
      acdCode: p.acdCode,
    })),
  })).filter(g => g.permissions.length > 0)
  res.json({ code: 0, data: grouped })
})

// 获取可用权限列表（根据账套来源过滤）
router.get('/permissions/available', (req: AuthRequest, res) => {
  const db = getDb()

  // 检查该账套是否从 ACD 导入
  const accountSet = db
    .prepare('SELECT import_source FROM account_sets WHERE id = ?')
    .get(req.accountSetId) as any

  let availablePermissions = PERMISSIONS

  // ACD 导入的账套：除有 acdCode 的权限外，CW 原生模块（出纳/资产）的权限也应可授予，
  // 否则新增的出纳/资产权限（无 acdCode）会被隐藏、无法授权。
  if (accountSet?.import_source === 'acd') {
    const CW_NATIVE_MODULES = new Set(['cashier', 'asset'])
    availablePermissions = PERMISSIONS.filter(p => p.acdCode || CW_NATIVE_MODULES.has(p.module))
  }

  // 按模块分组返回
  const grouped = PERMISSION_MODULES.map(mod => ({
    module: mod.key,
    moduleName: mod.name,
    permissions: availablePermissions
      .filter(p => p.module === mod.key)
      .map(p => ({
        code: p.code,
        name: p.name,
        acdCode: p.acdCode,
      })),
  })).filter(g => g.permissions.length > 0)

  res.json({ code: 0, data: grouped })
})

// ===================== 角色管理 =====================

router.get('/roles', (req: AuthRequest, res) => {
  const db = getDb()
  const list = db
    .prepare('SELECT * FROM roles WHERE account_set_id = ? AND (is_personal IS NULL OR is_personal = 0) ORDER BY is_system DESC, created_at')
    .all(req.accountSetId)
  res.json({ code: 0, data: list })
})

router.post(
  '/roles',
  requirePermission('system:role'),
  operationLog('创建角色', '系统管理'),
  (req: AuthRequest, res) => {
    const { name, code, description, permissions } = req.body
    const accountSetId = req.accountSetId!
    if (!name || !code) {
      return res.status(400).json({ code: 400, message: '名称和编码不能为空' })
    }
    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM roles WHERE account_set_id = ? AND code = ?')
      .get(accountSetId, code)
    if (existing) {
      return res.status(400).json({ code: 400, message: '角色编码已存在' })
    }
    const id = uuidv4()
    db.prepare(
      'INSERT INTO roles (id, account_set_id, name, code, description, permissions) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, accountSetId, name, code, description, JSON.stringify(permissions || []))
    res.json({ code: 0, message: '创建成功', data: { id } })
  }
)

router.put(
  '/roles/:id',
  requirePermission('system:role'),
  operationLog('修改角色', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const { name, description, permissions } = req.body
    const db = getDb()
    const role = db
      .prepare('SELECT * FROM roles WHERE id=? AND account_set_id=?')
      .get(id, req.accountSetId) as any
    if (!role) {
      return res.status(404).json({ code: 404, message: '角色不存在' })
    }
    if (role.is_personal) {
      return res.status(400).json({ code: 400, message: '个人角色不能编辑' })
    }
    const result = db
      .prepare(
        'UPDATE roles SET name=?, description=?, permissions=? WHERE id=? AND account_set_id=?'
      )
      .run(name, description, JSON.stringify(permissions || []), id, req.accountSetId)
    if (result.changes === 0) {
      return res.status(404).json({ code: 404, message: '角色不存在' })
    }
    res.json({ code: 0, message: '更新成功' })
  }
)

router.delete(
  '/roles/:id',
  requirePermission('system:role'),
  operationLog('删除角色', '系统管理'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const role = db
      .prepare('SELECT * FROM roles WHERE id=? AND account_set_id=?')
      .get(id, req.accountSetId) as any
    if (!role) {
      return res.status(404).json({ code: 404, message: '角色不存在' })
    }
    if (role.is_personal) {
      return res.status(400).json({ code: 400, message: '个人角色不能删除' })
    }
    if (role.is_system) {
      return res.status(400).json({ code: 400, message: '系统内置角色无法删除' })
    }
    const used = db
      .prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ? AND account_set_id = ?')
      .get(id, req.accountSetId) as any
    if (used?.count > 0) {
      return res.status(400).json({ code: 400, message: '该角色已被使用，无法删除' })
    }
    db.prepare('DELETE FROM roles WHERE id = ? AND account_set_id = ?').run(id, req.accountSetId)
    res.json({ code: 0, message: '删除成功' })
  }
)

router.get(
  '/roles/:id/account-scopes',
  requirePermission('system:role'),
  (req: AuthRequest, res) => {
    const db = getDb()
    const role = db
      .prepare('SELECT id FROM roles WHERE id=? AND account_set_id=?')
      .get(req.params.id, req.accountSetId)
    if (!role) {
      return res.status(404).json({ code: 404, message: '角色不存在' })
    }
    const data = getRoleAccountScopePayload(db, req.params.id, req.accountSetId!)
    res.json({ code: 0, data })
  }
)

router.put(
  '/roles/:id/account-scopes',
  requirePermission('system:role'),
  operationLog('配置角色科目授权', '系统管理'),
  (req: AuthRequest, res) => {
    const { enabled, account_ids } = req.body
    const db = getDb()
    const role = db
      .prepare('SELECT id, is_personal FROM roles WHERE id=? AND account_set_id=?')
      .get(req.params.id, req.accountSetId) as { id: string; is_personal: number } | undefined
    if (!role) {
      return res.status(404).json({ code: 404, message: '角色不存在' })
    }
    if (role.is_personal) {
      return res.status(400).json({ code: 400, message: '个人角色不能配置科目授权' })
    }
    saveRoleAccountScopes(db, req.params.id, req.accountSetId!, {
      enabled: !!enabled,
      account_ids: Array.isArray(account_ids) ? account_ids : [],
    })
    res.json({ code: 0, message: '科目授权已保存' })
  }
)

// ===================== 系统参数 =====================

router.get('/dashboard-rules-preview', (req: AuthRequest, res) => {
  const db = getDb()
  const standard = String(req.query.standard || '').trim()
  if (!standard || !isAccountingStandardParam(standard) || standard === 'custom') {
    return res.status(400).json({ code: 400, message: '无效的会计准则参数' })
  }

  const resolved =
    standard === 'auto'
      ? resolveAccountingStandard(db, req.accountSetId!)
      : standard

  if (resolved === 'custom') {
    return res.status(400).json({ code: 400, message: '无法预览自定义准则' })
  }

  const financial = buildPresetDashboardCategoryRules(db, req.accountSetId!, resolved)
  const budget = buildPresetDashboardBudgetRules(db, req.accountSetId!, resolved)
  res.json({
    code: 0,
    data: { version: 2, customized: false, financial, budget },
  })
})

router.put(
  '/branding',
  requirePermission('system:init'),
  operationLog('修改品牌设置', '系统管理'),
  (req: AuthRequest, res) => {
    const { title, subtitle } = req.body as { title?: string; subtitle?: string }
    const titleErr = validateBrandParam(BRAND_TITLE_KEY, String(title ?? ''))
    if (titleErr) return res.status(400).json({ code: 400, message: titleErr })
    const subtitleErr = validateBrandParam(BRAND_SUBTITLE_KEY, String(subtitle ?? ''))
    if (subtitleErr) return res.status(400).json({ code: 400, message: subtitleErr })
    const db = getDb()
    upsertGlobalBrandParam(db, BRAND_TITLE_KEY, String(title).trim())
    upsertGlobalBrandParam(db, BRAND_SUBTITLE_KEY, String(subtitle).trim())
    res.json({ code: 0, message: '保存成功', data: readGlobalBranding(db) })
  }
)

router.post(
  '/branding/logo',
  requirePermission('system:init'),
  brandUpload.single('file'),
  operationLog('上传品牌 LOGO', '系统管理'),
  (req: AuthRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择 LOGO 图片' })
    }
    const logoUrl = `/uploads/branding/${req.file.filename}`
    const db = getDb()
    upsertGlobalBrandParam(db, BRAND_LOGO_URL_KEY, logoUrl)
    res.json({ code: 0, message: '上传成功', data: readGlobalBranding(db) })
  }
)

router.delete(
  '/branding/logo',
  requirePermission('system:init'),
  operationLog('恢复默认品牌 LOGO', '系统管理'),
  (_req: AuthRequest, res) => {
    const db = getDb()
    upsertGlobalBrandParam(db, BRAND_LOGO_URL_KEY, '')
    res.json({ code: 0, message: '已恢复默认 LOGO', data: readGlobalBranding(db) })
  }
)

router.get('/params', (req: AuthRequest, res) => {
  const db = getDb()
  // 一律使用当前登录账套，忽略 query.accountSetId，避免跨账套读取参数
  const asId = req.accountSetId
  const rawList = db
    .prepare(`SELECT * FROM system_params WHERE account_set_id IS NULL OR account_set_id = ?`)
    .all(asId)
  const paramMap = new Map<string, any>()
  for (const item of rawList as any[]) {
    const existing = paramMap.get(item.param_key)
    if (!existing || item.account_set_id === asId) {
      paramMap.set(item.param_key, item)
    }
  }

  // 附带账套基本信息（建账日期）
  const accountSet = db
    .prepare('SELECT name, start_date FROM account_sets WHERE id = ?')
    .get(asId) as any

  // 当前会计区间：取最新凭证的 year/period，若无凭证则取 fiscal_year + 当前月
  const latestVoucher = db
    .prepare(
      'SELECT year, period FROM vouchers WHERE account_set_id = ? AND status = ? ORDER BY year DESC, period DESC LIMIT 1'
    )
    .get(asId, 'posted') as any
  let currentYear: number
  let currentPeriod: number
  if (latestVoucher) {
    currentYear = latestVoucher.year
    currentPeriod = latestVoucher.period
  } else {
    const as = db.prepare('SELECT fiscal_year FROM account_sets WHERE id = ?').get(asId) as any
    currentYear = as?.fiscal_year || new Date().getFullYear()
    currentPeriod = new Date().getMonth() + 1
  }

  // 使用单位名称：优先读 system_params 中的 unit_name，没有则回退到账套名称
  const unitNameParam = paramMap.get('unit_name') as any
  const unitName = unitNameParam?.param_value || accountSet?.name || ''
  const dashboardConfig = getDashboardCategoryConfig(db, asId as string)
  const startDate = readAccountSetStartDate(db, asId as string)

  const startDateParam = paramMap.get('start_date')
  if (!startDateParam) {
    paramMap.set('start_date', {
      account_set_id: asId,
      param_key: 'start_date',
      param_value: startDate,
      description: '建账日期',
    })
  } else if (!isValidAccountSetStartDate(startDateParam.param_value)) {
    startDateParam.param_value = startDate
  }
  const list = Array.from(paramMap.values())

  res.json({
    code: 0,
    data: list,
    meta: {
      unit_name: unitName,
      start_date: startDate,
      current_year: currentYear,
      current_period: currentPeriod,
      resolved_accounting_standard_name: getResolvedAccountingStandardName(db, asId as string),
      dashboard_rules_editable: true,
      dashboard_effective_rules: dashboardConfig.rules,
      dashboard_effective_rule_config: dashboardConfig.ruleConfig,
      dashboard_category_rules: getDashboardCategoryRulesParam(db, asId as string),
      dashboard_rule_config: getDashboardRuleConfigParam(db, asId as string),
    },
  })
})

router.put(
  '/params',
  requirePermission('system:account'),
  operationLog('修改系统参数', '系统管理'),
  (req: AuthRequest, res) => {
    const { params } = req.body
    const db = getDb()
    const paramList = Array.isArray(params) ? params : []
    for (const p of paramList) {
      const error = validateSystemParamEntry(p.param_key, String(p.param_value ?? ''), paramList)
      if (error) {
        return res.status(400).json({ code: 400, message: error })
      }
      if (p.param_key === 'dashboard_category_rules') {
        try {
          const config = parseDashboardRuleConfigJson(p.param_value)
          const accountError = validateDashboardRuleConfigAgainstAccounts(
            db,
            req.accountSetId!,
            config
          )
          if (accountError) return res.status(400).json({ code: 400, message: accountError })
        } catch {
          return res.status(400).json({ code: 400, message: '首页取数规则 JSON 格式无效' })
        }
      }
    }
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)'
    )
    for (const p of paramList) {
      // 一律写入当前登录账套，忽略请求体中的 account_set_id，避免跨账套写参数
      const targetAccountSetId = req.accountSetId
      const id = p.account_set_id === targetAccountSetId && p.id ? p.id : uuidv4()
      upsert.run(id, targetAccountSetId, p.param_key, p.param_value)
    }
    res.json({ code: 0, message: '保存成功' })
  }
)

// ===================== 结转类型管理 =====================

router.get('/transfer-types', (req: AuthRequest, res) => {
  const db = getDb()
  const rawList = db
    .prepare('SELECT * FROM transfer_types WHERE account_set_id = ? ORDER BY code')
    .all(req.accountSetId) as any[]
  // 转换字段名为驼峰格式
  const list = rawList.map(item => ({
    id: item.id,
    code: item.code,
    name: item.name,
    voucherType: item.voucher_type,
    periodType: item.period_type || 'monthly',
  }))
  res.json({ code: 0, data: list })
})

router.put(
  '/transfer-types',
  requirePermission('base:transfer'),
  operationLog('修改结转类型', '系统管理'),
  (req: AuthRequest, res) => {
    const { types } = req.body
    const db = getDb()

    // 先删除当前账套旧的类型
    db.prepare('DELETE FROM transfer_types WHERE account_set_id = ?').run(req.accountSetId)

    // 插入新的类型
    const insert = db.prepare(
      'INSERT INTO transfer_types (id, code, name, voucher_type, period_type, account_set_id) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const t of types) {
      insert.run(
        t.id || uuidv4(),
        t.code,
        t.name,
        t.voucherType || '结转',
        t.periodType || 'monthly',
        req.accountSetId
      )
    }

    res.json({ code: 0, message: '保存成功' })
  }
)

// ===================== 结转配置项管理 =====================

router.get('/transfer-items', (req: AuthRequest, res) => {
  const db = getDb()
  const rawList = db
    .prepare('SELECT * FROM transfer_items WHERE account_set_id = ? ORDER BY type_code, sort_order')
    .all(req.accountSetId) as any[]
  // 转换字段名为驼峰格式
  const list = rawList.map(item => ({
    id: item.id,
    typeCode: item.type_code,
    summary: item.summary,
    fromCode: item.from_code,
    fromName: item.from_name,
    toCode: item.to_code,
    toName: item.to_name,
    transferType: item.transfer_type,
    ratio: item.ratio,
  }))
  res.json({ code: 0, data: list })
})

router.put(
  '/transfer-items',
  requirePermission('base:transfer'),
  operationLog('修改结转配置', '系统管理'),
  (req: AuthRequest, res) => {
    const { items } = req.body
    const db = getDb()

    // 先删除当前账套旧的配置项
    db.prepare('DELETE FROM transfer_items WHERE account_set_id = ?').run(req.accountSetId)

    // 插入新的配置项
    const insert = db.prepare(
      `INSERT INTO transfer_items
     (id, type_code, summary, from_code, from_name, to_code, to_name, transfer_type, ratio, sort_order, account_set_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    items.forEach((item: any, index: number) => {
      insert.run(
        item.id || uuidv4(),
        item.typeCode,
        item.summary,
        item.fromCode,
        item.fromName,
        item.toCode,
        item.toName,
        item.transferType || 'all',
        item.ratio || 100,
        index,
        req.accountSetId
      )
    })

    res.json({ code: 0, message: '保存成功' })
  }
)

// ===================== 操作日志 =====================

router.get('/logs/options', (req: AuthRequest, res) => {
  const db = getDb()
  const accountSetId = req.accountSetId || ''

  const actions = db
    .prepare(
      `SELECT DISTINCT action FROM operation_logs
       WHERE account_set_id = ? AND action != ''
       ORDER BY action`
    )
    .all(accountSetId)
    .map((row: any) => row.action)

  const modules = db
    .prepare(
      `SELECT DISTINCT module FROM operation_logs
       WHERE account_set_id = ? AND module != ''
       ORDER BY module`
    )
    .all(accountSetId)
    .map((row: any) => row.module)

  const ipAddresses = db
    .prepare(
      `SELECT DISTINCT ip_address FROM operation_logs
       WHERE account_set_id = ? AND ip_address != ''
       ORDER BY ip_address`
    )
    .all(accountSetId)
    .map((row: any) => row.ip_address)

  res.json({ code: 0, data: { actions, modules, ipAddresses } })
})

router.get('/logs', (req: AuthRequest, res) => {
  const db = getDb()
  const {
    page = 1,
    pageSize = 50,
    user_id,
    action,
    module,
    ip_address,
    start_date,
    end_date,
  } = req.query
  const query = buildSystemLogsQuery({
    accountSetId: req.accountSetId || '',
    page: Number(page),
    pageSize: Number(pageSize),
    userId: user_id as string | undefined,
    action: action as string | undefined,
    module: module as string | undefined,
    ipAddress: ip_address as string | undefined,
    startDate: start_date as string | undefined,
    endDate: end_date as string | undefined,
  })

  const total = (db.prepare(query.countSql).get(...query.countParams) as any).count
  const list = db.prepare(query.listSql).all(...query.listParams)
  res.json({ code: 0, data: list, total })
})

router.post(
  '/cleanup-balances',
  operationLog('清理余额脏数据', '系统管理'),
  (req: AuthRequest, res) => {
    const db = getDb()
    const { year, period } = req.body
    const y = Number(year) || new Date().getFullYear()
    const p = Number(period) || new Date().getMonth() + 1

    const result = db.transaction(() => {
      const deleted = db
        .prepare(
          `
      DELETE FROM account_balances
      WHERE account_set_id=? AND year=? AND period=?
        AND current_debit = 0 AND current_credit = 0
        AND COALESCE(init_balance, 0) = 0
    `
        )
        .run(req.accountSetId, y, p)

      const fixed = db
        .prepare(
          `
      UPDATE account_balances
      SET current_debit = 0, current_credit = 0
      WHERE account_set_id=? AND year=? AND period=?
        AND (current_debit < 0 OR current_credit < 0)
    `
        )
        .run(req.accountSetId, y, p)

      return { deletedRows: deleted.changes, fixedRows: fixed.changes }
    })()

    res.json({
      code: 0,
      message: `清理完成：删除空行${result.deletedRows}条，修复负数行${result.fixedRows}条`,
      data: result,
    })
  }
)

router.use(systemReinitializeRoutes)

export default router
