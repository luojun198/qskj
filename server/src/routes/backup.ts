import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  accessSync,
  constants,
  copyFileSync,
} from 'fs'
import { resolve, join, basename } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import multer from 'multer'
import Database from 'better-sqlite3'
import { getDb, DB_PATH, initDatabase, closeAndResetDb, DEPLOY_DIR } from '../db/index.js'
import {
  formatCompatibilityUpgradeSummary,
  upgradeDatabaseCompatibility,
  type CompatibilityUpgradeResult,
} from '../db/databaseCompatibility.js'
import {
  BACKUP_ATTACHMENT_TABLE,
  detectBackupScope,
  formatAccountSetRestoreSummary,
  restoreSingleAccountSetFromBackup,
} from '../services/accountSetBackupRestore.js'
import {
  authMiddleware,
  AuthRequest,
  requirePermission,
  operationLog,
} from '../middleware/index.js'

const execAsync = promisify(exec)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })

const router = Router()
router.use(authMiddleware)

// ===================== 备份设置 =====================

// 备份设置默认值
const DEFAULT_SETTINGS = {
  enabled: false,
  schedule: 'daily', // daily / weekly / monthly
  time: '02:00', // HH:MM
  backupPath: '', // 空则使用默认路径
  retention: 30, // 保留天数
}

// 验证备份路径是否有效
function validateBackupPath(path: string): { valid: boolean; message: string } {
  if (!path || path.trim() === '') {
    return { valid: true, message: '将使用默认备份路径' }
  }

  const resolvedPath = resolve(path)

  // 检查路径是否存在
  if (!existsSync(resolvedPath)) {
    try {
      // 尝试创建目录
      mkdirSync(resolvedPath, { recursive: true })
    } catch (err: any) {
      return { valid: false, message: `无法创建备份目录: ${err.message}` }
    }
  }

  // 检查是否是目录
  try {
    const stats = statSync(resolvedPath)
    if (!stats.isDirectory()) {
      return { valid: false, message: '备份路径必须是一个目录，而不是文件' }
    }
  } catch (err: any) {
    return { valid: false, message: `无法访问备份路径: ${err.message}` }
  }

  // 检查是否可写
  try {
    accessSync(resolvedPath, constants.W_OK)
  } catch (err: any) {
    return { valid: false, message: '备份路径不可写，请检查目录权限' }
  }

  // 尝试创建测试文件以确保真正可写
  const testFile = join(resolvedPath, `.test_${Date.now()}.tmp`)
  try {
    writeFileSync(testFile, 'test')
    unlinkSync(testFile)
  } catch (err: any) {
    return { valid: false, message: `备份路径写入测试失败: ${err.message}` }
  }

  return { valid: true, message: '备份路径有效' }
}

// 验证数据库文件是否有效
function validateDatabaseFile(filePath: string): { valid: boolean; message: string } {
  try {
    // 检查文件是否存在
    if (!existsSync(filePath)) {
      return { valid: false, message: '文件不存在' }
    }

    // 检查文件大小（至少应该有 SQLite 文件头的大小）
    const stats = statSync(filePath)
    if (stats.size < 100) {
      return { valid: false, message: '文件太小，不是有效的数据库文件' }
    }

    // 读取文件头，检查 SQLite 魔数
    const buffer = readFileSync(filePath, { encoding: null })
    const header = buffer.slice(0, 16).toString('utf8')
    if (!header.startsWith('SQLite format 3')) {
      return { valid: false, message: '不是有效的 SQLite 数据库文件' }
    }

    // 尝试打开数据库并执行简单查询
    let testDb: Database.Database | null = null
    try {
      testDb = new Database(filePath, { readonly: true })

      // 检查是否有 account_sets 表（验证数据库结构）
      const tables = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_sets'")
        .all()

      if (tables.length === 0) {
        return { valid: false, message: '数据库结构不兼容：缺少 account_sets 表' }
      }

      // 检查是否有数据
      const accountSets = testDb.prepare('SELECT COUNT(*) as count FROM account_sets').get() as any
      if (accountSets.count === 0) {
        return { valid: false, message: '数据库中没有账套数据' }
      }

      return { valid: true, message: '数据库文件有效' }
    } finally {
      if (testDb) {
        testDb.close()
      }
    }
  } catch (err: any) {
    return { valid: false, message: `数据库验证失败: ${err.message}` }
  }
}

// 获取备份设置
router.get('/backups/settings', (req: AuthRequest, res) => {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key LIKE 'backup:%'"
    )
    .all(req.accountSetId) as any[]

  const settings: any = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    const key = row.param_key.replace('backup:', '')
    try {
      settings[key] = JSON.parse(row.param_value)
    } catch {
      settings[key] = row.param_value
    }
  }
  res.json({ code: 0, data: settings })
})

// 打开系统文件夹选择器
router.get('/backups/select-folder', async (req: AuthRequest, res) => {
  try {
    const platform = process.platform
    let folderPath = ''

    if (platform === 'win32') {
      // Windows: 使用 PowerShell 的 FolderBrowserDialog
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = "选择备份文件夹"
        $dialog.ShowNewFolderButton = $true
        $result = $dialog.ShowDialog()
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
          Write-Output $dialog.SelectedPath
        }
      `
      const { stdout } = await execAsync(`powershell -Command "${script.replace(/\n/g, '; ')}"`)
      folderPath = stdout.trim()
    } else if (platform === 'darwin') {
      // macOS: 使用 osascript
      const script = `osascript -e 'POSIX path of (choose folder with prompt "选择备份文件夹")'`
      const { stdout } = await execAsync(script)
      folderPath = stdout.trim()
    } else {
      // Linux: 使用 zenity
      try {
        const { stdout } = await execAsync(
          'zenity --file-selection --directory --title="选择备份文件夹"'
        )
        folderPath = stdout.trim()
      } catch (err: any) {
        // zenity 可能未安装，返回错误
        return res.status(500).json({
          code: 500,
          message: '系统未安装文件选择器工具（zenity），请手动输入路径',
        })
      }
    }

    if (!folderPath) {
      return res.json({ code: 0, data: null, message: '用户取消选择' })
    }

    res.json({ code: 0, data: folderPath })
  } catch (err: any) {
    console.error('打开文件夹选择器失败:', err)
    res.status(500).json({ code: 500, message: `打开文件夹选择器失败: ${err.message}` })
  }
})

// 保存备份设置
router.put(
  '/backups/settings',
  requirePermission('system:backup'),
  operationLog('保存备份设置', '数据安全'),
  (req: AuthRequest, res) => {
    const { enabled, schedule, time, backupPath, retention } = req.body
    const db = getDb()

    // 验证备份路径
    const validation = validateBackupPath(backupPath || '')
    if (!validation.valid) {
      return res.status(400).json({ code: 400, message: validation.message })
    }

    const params = [
      { key: 'backup:enabled', value: String(!!enabled) },
      { key: 'backup:schedule', value: String(schedule || 'daily') },
      { key: 'backup:time', value: String(time || '02:00') },
      { key: 'backup:backupPath', value: String(backupPath || '') },
      { key: 'backup:retention', value: String(Number(retention) || 30) },
    ]

    for (const p of params) {
      const existing = db
        .prepare('SELECT id FROM system_params WHERE account_set_id=? AND param_key=?')
        .get(req.accountSetId, p.key)
      if (existing) {
        db.prepare(
          'UPDATE system_params SET param_value=? WHERE account_set_id=? AND param_key=?'
        ).run(p.value, req.accountSetId, p.key)
      } else {
        db.prepare(
          'INSERT INTO system_params (id, account_set_id, param_key, param_value) VALUES (?, ?, ?, ?)'
        ).run(uuidv4(), req.accountSetId, p.key, p.value)
      }
    }

    // 重启调度器
    updateScheduler(db)

    res.json({ code: 0, message: '备份设置已保存' })
  }
)

// ===================== 备份记录 =====================

router.get('/backups', (req: AuthRequest, res) => {
  const db = getDb()

  // 分页参数
  const page = parseInt(req.query.page as string) || 1
  const pageSize = parseInt(req.query.pageSize as string) || 20
  const offset = (page - 1) * pageSize

  // 时间筛选参数
  const startDate = req.query.start_date as string
  const endDate = req.query.end_date as string

  // 完整备份为全库备份，记录列表不按当前账套过滤
  let whereClause = 'WHERE 1=1'
  const params: any[] = []

  if (startDate) {
    whereClause += ' AND DATE(b.created_at) >= ?'
    params.push(startDate)
  }
  if (endDate) {
    whereClause += ' AND DATE(b.created_at) <= ?'
    params.push(endDate)
  }

  // 查询总数
  const total =
    (db.prepare(`SELECT COUNT(*) as cnt FROM backups b ${whereClause}`).get(...params) as any)
      ?.cnt || 0

  // 查询分页数据
  const list = db
    .prepare(
      `
    SELECT b.*,
           u.nickname as operator_name,
           u.username as operator_username,
           a.name as account_set_name
    FROM backups b
    LEFT JOIN users u ON b.created_by = u.id
    LEFT JOIN account_sets a ON b.account_set_id = a.id
    ${whereClause}
    ORDER BY b.created_at DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(...params, pageSize, offset)

  res.json({ code: 0, data: list, total })
})

// 备份统计
router.get('/backups/stats', (req: AuthRequest, res) => {
  const db = getDb()
  const total =
    ((db.prepare('SELECT COUNT(*) as cnt FROM backups').get() as any)?.cnt || 0) as number
  const totalSize =
    ((db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM backups').get() as any)?.total ||
      0) as number
  const autoCount =
    ((db.prepare("SELECT COUNT(*) as cnt FROM backups WHERE type='auto'").get() as any)?.cnt ||
      0) as number
  const manualCount =
    ((db.prepare("SELECT COUNT(*) as cnt FROM backups WHERE type='manual'").get() as any)?.cnt ||
      0) as number
  const lastBackup = db
    .prepare('SELECT created_at, filename FROM backups ORDER BY created_at DESC LIMIT 1')
    .get() as any

  res.json({
    code: 0,
    data: {
      total,
      totalSize,
      autoCount,
      manualCount,
      lastBackupTime: lastBackup?.created_at || null,
      lastBackupFilename: lastBackup?.filename || null,
    },
  })
})

// 格式化日期时间为 YYYYMMDD_HHMMSS
function formatBackupTime(d: Date): string {
  const yyyy = d.getFullYear()
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}${MM}${dd}_${hh}${mm}${ss}`
}

// 执行备份（内部/定时调度调用）
async function doBackup(
  accountSetId: string,
  type: 'manual' | 'auto',
  userId?: string,
  customPath?: string,
  options?: { filenamePrefix?: string }
): Promise<{
  id: string
  filename: string
  filepath: string
  size: number
  error?: string
} | null> {
  const db = getDb()

  // 确定备份路径：优先使用自定义路径，否则使用系统设置
  let baseDir: string
  if (customPath) {
    baseDir = resolve(customPath)
  } else {
    const backupPathSetting =
      (
        db
          .prepare(
            "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='backup:backupPath'"
          )
          .get(accountSetId) as any
      )?.param_value || ''

    // 如果配置的路径包含 Windows 盘符（如 C:\），但当前系统不是 Windows，则使用默认路径
    if (
      backupPathSetting &&
      backupPathSetting.match(/^[A-Z]:\\/i) &&
      process.platform !== 'win32'
    ) {
      console.warn(
        `配置的备份路径是 Windows 路径 "${backupPathSetting}"，但当前系统是 ${process.platform}，使用默认路径`
      )
      baseDir = resolve(DEPLOY_DIR, 'backups')
    } else {
      baseDir = backupPathSetting ? resolve(backupPathSetting) : resolve(DEPLOY_DIR, 'backups')
    }
  }

  // 验证备份路径（如果是自定义路径才验证，系统默认路径跳过验证）
  if (customPath) {
    const validation = validateBackupPath(customPath)
    if (!validation.valid) {
      console.error('Backup path validation failed:', validation.message)
      return { id: '', filename: '', filepath: '', size: 0, error: validation.message }
    }
  }

  // 确保目录存在
  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
  } catch (err: any) {
    const errorMsg = `无法创建备份目录: ${err.message}`
    console.error(errorMsg)
    return { id: '', filename: '', filepath: '', size: 0, error: errorMsg }
  }

  const id = uuidv4()
  const now = new Date()
  const timeStr = formatBackupTime(now)
  const filename = options?.filenamePrefix
    ? `${options.filenamePrefix}_${timeStr}.db`
    : type === 'auto'
      ? `自动备份_${timeStr}.db`
      : `手动备份_${timeStr}.db`
  const filepath = join(baseDir, filename)

  return new Promise(resolve => {
    const currentDb = getDb()
    currentDb
      .backup(filepath)
      .then(() => {
        const stats = statSync(filepath)
        db.prepare(
          `
        INSERT INTO backups (id, account_set_id, filename, filepath, size, type, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'success')
      `
        ).run(id, accountSetId, filename, filepath, stats.size, type, userId || null)

        // 清理过期备份
        cleanupOldBackups(accountSetId)

        resolve({ id, filename, filepath, size: stats.size })
      })
      .catch((err: Error) => {
        const errorMsg = `备份失败: ${err.message}`
        db.prepare(
          `
        INSERT INTO backups (id, account_set_id, filename, filepath, size, type, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'failed')
      `
        ).run(id, accountSetId, filename, filepath, 0, type, userId || null)
        console.error('Backup failed:', errorMsg)
        resolve({ id: '', filename: '', filepath: '', size: 0, error: errorMsg })
      })
  })
}

/** 恢复前先强制完整备份，再从指定文件覆盖当前库 */
async function restoreDatabaseFromFile(params: {
  accountSetId: string
  userId?: string
  sourcePath: string
}): Promise<{ preBackupFilename: string; compatibilityUpgrade: CompatibilityUpgradeResult }> {
  const { accountSetId, userId, sourcePath } = params

  const preBackup = await doBackup(accountSetId, 'manual', userId, undefined, {
    filenamePrefix: '恢复前备份',
  })
  if (!preBackup?.id || preBackup.error) {
    throw new Error(preBackup?.error || '恢复前自动备份失败')
  }

  const validation = validateDatabaseFile(sourcePath)
  if (!validation.valid) {
    throw new Error(`备份文件无效: ${validation.message}`)
  }

  const db = getDb()
  const tempBackupPath = `${DB_PATH}.restore_backup_${Date.now()}.tmp`
  try {
    await db.backup(tempBackupPath)
  } catch (err: any) {
    throw new Error(`无法创建临时备份: ${err.message}`)
  }

  try {
    closeAndResetDb()
    const backupData = readFileSync(sourcePath)
    writeFileSync(DB_PATH, backupData)
    initDatabase()
    const compatibilityUpgrade = upgradeDatabaseCompatibility()

    try {
      unlinkSync(tempBackupPath)
    } catch {
      /* ignore */
    }

    return { preBackupFilename: preBackup.filename, compatibilityUpgrade }
  } catch (err: any) {
    try {
      copyFileSync(tempBackupPath, DB_PATH)
      unlinkSync(tempBackupPath)
      initDatabase()
    } catch (rollbackErr: any) {
      console.error('回滚失败:', rollbackErr)
    }
    throw new Error(`恢复失败: ${err.message}`)
  }
}

// 清理过期备份
function cleanupOldBackups(accountSetId: string) {
  const db = getDb()
  const retention = Number(
    (
      db
        .prepare(
          "SELECT param_value FROM system_params WHERE account_set_id=? AND param_key='backup:retention'"
        )
        .get(accountSetId) as any
    )?.param_value || 30
  )

  // 如果设置为 0，表示永久保存，不删除任何备份
  if (retention === 0) {
    return
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retention)

  const oldBackups = db
    .prepare(
      "SELECT id, filepath FROM backups WHERE account_set_id=? AND type='auto' AND created_at < ?"
    )
    .all(accountSetId, cutoff.toISOString()) as any[]

  for (const b of oldBackups) {
    try {
      if (existsSync(b.filepath)) unlinkSync(b.filepath)
    } catch {
      /* ignore */
    }
  }
  if (oldBackups.length > 0) {
    db.prepare("DELETE FROM backups WHERE account_set_id=? AND type='auto' AND created_at < ?").run(
      accountSetId,
      cutoff.toISOString()
    )
  }
}

// 单账套备份（只导出当前账套的数据）
router.post(
  '/backups/account-set',
  requirePermission('system:backup'),
  operationLog('单账套备份', '数据安全'),
  async (req: AuthRequest, res) => {
    try {
      const result = await doAccountSetBackup(req.accountSetId!, req.userId)

      if (!result || result.error) {
        return res.status(500).json({ code: 500, message: result?.error || '备份失败' })
      }

      // 返回文件流供下载
      const backupFilePath = result.filepath

      if (!existsSync(backupFilePath)) {
        return res.status(404).json({ code: 404, message: `备份文件不存在: ${backupFilePath}` })
      }

      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(result.filename)}"`
      )
      res.setHeader('Content-Length', result.size)
      if (result.stats) {
        res.setHeader('X-Backup-Stats', encodeURIComponent(JSON.stringify(result.stats)))
      }

      const fileStream = readFileSync(backupFilePath)

      // 发送文件后删除临时文件
      res.on('finish', () => {
        try {
          unlinkSync(backupFilePath)
        } catch (err) {
          console.error('删除临时备份文件失败:', err)
        }
      })

      return res.send(fileStream)
    } catch (err: any) {
      res.status(500).json({ code: 500, message: '单账套备份失败: ' + err.message })
    }
  }
)

// 手动备份（完整数据库备份）
router.post(
  '/backups',
  requirePermission('system:backup'),
  operationLog('手动备份', '数据安全'),
  async (req: AuthRequest, res) => {
    try {
      const { customPath, download } = req.body

      // 如果提供了自定义路径，验证其有效性
      if (customPath) {
        const validation = validateBackupPath(customPath)
        if (!validation.valid) {
          return res
            .status(400)
            .json({ code: 400, message: `自定义路径无效: ${validation.message}` })
        }
      }

      const result = await doBackup(req.accountSetId!, 'manual', req.userId, customPath)

      if (!result || result.error) {
        return res
          .status(500)
          .json({ code: 500, message: result?.error || '备份失败，请检查备份路径设置' })
      }

      // 如果请求下载，返回文件流
      if (download || req.headers.accept?.includes('application/octet-stream')) {
        const backupFilePath = result.filepath

        if (!existsSync(backupFilePath)) {
          return res.status(404).json({ code: 404, message: `备份文件不存在: ${backupFilePath}` })
        }

        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(result.filename)}"`
        )
        res.setHeader('Content-Length', result.size)

        const fileStream = readFileSync(backupFilePath)
        return res.send(fileStream)
      }

      // 否则返回 JSON 响应
      res.json({
        code: 0,
        message: `备份成功！文件名: ${result.filename}，大小: ${(result.size / 1024 / 1024).toFixed(2)} MB`,
        data: result,
      })
    } catch (err: any) {
      res.status(500).json({ code: 500, message: '备份失败: ' + err.message })
    }
  }
)

// 恢复备份
router.post(
  '/backups/:id/restore',
  requirePermission('system:restore'),
  operationLog('恢复备份', '数据安全'),
  async (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const backup = db.prepare('SELECT * FROM backups WHERE id=?').get(id) as any
    if (!backup) {
      return res.status(404).json({ code: 404, message: '备份文件不存在' })
    }
    if (!existsSync(backup.filepath)) {
      return res.status(404).json({ code: 404, message: '备份文件已丢失' })
    }

    try {
      const result = await restoreDatabaseFromFile({
        accountSetId: req.accountSetId!,
        userId: req.userId,
        sourcePath: backup.filepath,
      })
      const compatibilitySummary = formatCompatibilityUpgradeSummary(result.compatibilityUpgrade)
      res.json({
        code: 0,
        message: `恢复成功，已自动备份当前数据为「${result.preBackupFilename}」。${compatibilitySummary}。请重新登录`,
        data: {
          requireRelogin: true,
          preBackupFilename: result.preBackupFilename,
          compatibilityUpgrade: result.compatibilityUpgrade,
        },
      })
    } catch (err: any) {
      res.status(500).json({ code: 500, message: err.message || '恢复失败' })
    }
  }
)

// 删除备份
router.delete(
  '/backups/:id',
  requirePermission('system:backup'),
  operationLog('删除备份', '数据安全'),
  (req: AuthRequest, res) => {
    const { id } = req.params
    const db = getDb()
    const backup = db.prepare('SELECT * FROM backups WHERE id=?').get(id) as any
    if (backup && existsSync(backup.filepath)) {
      try {
        unlinkSync(backup.filepath)
      } catch {
        /* ignore */
      }
    }
    db.prepare('DELETE FROM backups WHERE id=?').run(id)
    res.json({ code: 0, message: '删除成功' })
  }
)

// ===================== 上传备份并恢复 =====================

router.post(
  '/backups/restore-upload',
  upload.single('file'),
  requirePermission('system:restore'),
  operationLog('上传备份恢复', '数据安全'),
  async (req: AuthRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '请选择备份文件' })
    }

    // 检查文件扩展名
    const ext = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'))
    if (ext !== '.db' && ext !== '.sqlite' && ext !== '.sqlite3') {
      return res
        .status(400)
        .json({ code: 400, message: '不支持的文件类型，仅支持 .db / .sqlite / .sqlite3 文件' })
    }

    // 将上传的文件保存到临时位置进行验证
    const tempUploadPath = `${DB_PATH}.upload_${Date.now()}.tmp`
    try {
      writeFileSync(tempUploadPath, req.file.buffer)
    } catch (err: any) {
      return res.status(500).json({ code: 500, message: `保存上传文件失败: ${err.message}` })
    }

    // 验证上传的文件是否为有效的数据库
    const validation = validateDatabaseFile(tempUploadPath)
    if (!validation.valid) {
      try {
        unlinkSync(tempUploadPath)
      } catch {
        /* ignore */
      }
      return res.status(400).json({ code: 400, message: `上传文件无效: ${validation.message}` })
    }

    let backupScope
    try {
      backupScope = detectBackupScope(tempUploadPath)
    } catch (err: any) {
      try {
        unlinkSync(tempUploadPath)
      } catch {
        /* ignore */
      }
      return res.status(400).json({ code: 400, message: err.message || '无法识别备份文件' })
    }

    // 单账套备份：合并恢复到当前账套，避免全库覆盖导致数据“丢失”
    if (backupScope.type === 'single_account_set') {
      try {
        const preBackup = await doBackup(req.accountSetId!, 'manual', req.userId, undefined, {
          filenamePrefix: '单账套恢复前备份',
        })
        if (!preBackup?.id || preBackup.error) {
          throw new Error(preBackup?.error || '恢复前自动备份失败')
        }

        const stats = restoreSingleAccountSetFromBackup({
          targetAccountSetId: req.accountSetId!,
          sourcePath: tempUploadPath,
          userId: req.userId,
        })

        try {
          unlinkSync(tempUploadPath)
        } catch {
          /* ignore */
        }

        const summary = formatAccountSetRestoreSummary(stats)
        return res.json({
          code: 0,
          message: `单账套恢复成功，已导入到当前账套「${stats.sourceAccountSetName || '未知'}」：${summary}。恢复前已自动备份为「${preBackup.filename}」`,
          data: {
            restoreType: 'single_account_set',
            preBackupFilename: preBackup.filename,
            stats,
          },
        })
      } catch (err: any) {
        try {
          unlinkSync(tempUploadPath)
        } catch {
          /* ignore */
        }
        return res.status(500).json({ code: 500, message: err.message || '单账套恢复失败' })
      }
    }

    try {
      const result = await restoreDatabaseFromFile({
        accountSetId: req.accountSetId!,
        userId: req.userId,
        sourcePath: tempUploadPath,
      })

      try {
        unlinkSync(tempUploadPath)
      } catch {
        /* ignore */
      }

      const compatibilitySummary = formatCompatibilityUpgradeSummary(result.compatibilityUpgrade)
      res.json({
        code: 0,
        message: `恢复成功，已自动备份当前数据为「${result.preBackupFilename}」。${compatibilitySummary}。请重新登录`,
        data: {
          requireRelogin: true,
          preBackupFilename: result.preBackupFilename,
          compatibilityUpgrade: result.compatibilityUpgrade,
        },
      })
    } catch (err: any) {
      try {
        unlinkSync(tempUploadPath)
      } catch {
        /* ignore */
      }
      res.status(500).json({ code: 500, message: err.message || '恢复失败' })
    }
  }
)

// ===================== 定时备份调度器 =====================

// 各账套的定时器
const schedulerTimers: Map<string, NodeJS.Timeout> = new Map()

// Node setTimeout 内部以 32 位整数存毫秒，>2^31-1 (≈24.85 天) 会立即触发。
// 取 23 天作上限留足安全余量；超过时分段重排。
const MAX_TIMEOUT_MS = 23 * 24 * 60 * 60 * 1000

/**
 * 设定一个目标时间的定时器，自动处理 setTimeout 32-bit 溢出。
 */
function scheduleAt(accountSetId: string, when: Date, fn: () => void): NodeJS.Timeout {
  const delay = when.getTime() - Date.now()
  if (delay <= 0) {
    return setTimeout(fn, 0)
  }
  if (delay <= MAX_TIMEOUT_MS) {
    return setTimeout(fn, delay)
  }
  // 分段：先等 MAX_TIMEOUT_MS 再重新评估剩余等待
  return setTimeout(() => {
    schedulerTimers.set(accountSetId, scheduleAt(accountSetId, when, fn))
  }, MAX_TIMEOUT_MS)
}

/**
 * 计算下次备份时间
 */
function calculateNextBackupTime(schedule: string, time: string): Date {
  const now = new Date()
  const [hour, min] = time.split(':').map(Number)
  const next = new Date(now)
  next.setHours(hour || 2, min || 0, 0, 0)

  if (schedule === 'daily') {
    // 每天备份：如果今天的时间已过，设置为明天
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
  } else if (schedule === 'weekly') {
    // 每周一备份
    const dayOfWeek = next.getDay()
    const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek
    next.setDate(next.getDate() + daysUntilMonday)
    if (next <= now) {
      next.setDate(next.getDate() + 7)
    }
  } else if (schedule === 'monthly') {
    // 每月1号备份
    next.setDate(1)
    if (next <= now) {
      next.setMonth(next.getMonth() + 1)
    }
  }

  return next
}

/**
 * 为指定账套设置定时备份
 */
function scheduleBackupForAccountSet(accountSetId: string, schedule: string, time: string) {
  // 清除旧的定时器
  const oldTimer = schedulerTimers.get(accountSetId)
  if (oldTimer) {
    clearTimeout(oldTimer)
  }

  // 计算下次备份时间
  const nextBackupTime = calculateNextBackupTime(schedule, time)

  console.log(
    `[AutoBackup] Scheduled for account_set ${accountSetId}: ${nextBackupTime.toLocaleString('zh-CN')} (${schedule}, ${time})`
  )

  // 设置定时器（分段处理超长 delay，避免 32-bit 溢出立即触发）
  const timer = scheduleAt(accountSetId, nextBackupTime, () => {
    console.log(`[AutoBackup] Executing backup for account_set ${accountSetId}`)
    doBackup(accountSetId, 'auto')
      .then(result => {
        if (result) {
          console.log(
            `[AutoBackup] Success: ${result.filename} (${result.size} bytes) for account_set ${accountSetId}`
          )
        }
      })
      .catch(err => {
        console.error(`[AutoBackup] Failed for account_set ${accountSetId}:`, err)
      })
      .finally(() => {
        // 备份完成后，重新调度下次备份
        const db = getDb()
        const config = db
          .prepare(
            "SELECT param_key, param_value FROM system_params WHERE account_set_id = ? AND param_key IN ('backup:enabled','backup:schedule','backup:time')"
          )
          .all(accountSetId) as any[]

        const cfg: any = {}
        for (const row of config) {
          const key = row.param_key.replace('backup:', '')
          cfg[key] = row.param_value
        }

        if (cfg.enabled === 'true') {
          scheduleBackupForAccountSet(accountSetId, cfg.schedule || 'daily', cfg.time || '02:00')
        }
      })
  })

  schedulerTimers.set(accountSetId, timer)
}

/**
 * 更新调度器（当备份设置改变时调用）
 */
function updateScheduler(db: ReturnType<typeof getDb>) {
  const rows = db
    .prepare(
      "SELECT account_set_id, param_key, param_value FROM system_params WHERE param_key IN ('backup:enabled','backup:schedule','backup:time')"
    )
    .all() as any[]

  // 按账套分组
  const configs: Map<string, any> = new Map()
  for (const row of rows) {
    if (!configs.has(row.account_set_id)) {
      configs.set(row.account_set_id, {})
    }
    const key = row.param_key.replace('backup:', '')
    configs.get(row.account_set_id)[key] = row.param_value
  }

  // 清理已禁用的账套定时器
  for (const [accountSetId, timer] of schedulerTimers) {
    const cfg = configs.get(accountSetId)
    if (!cfg || cfg.enabled !== 'true') {
      clearTimeout(timer)
      schedulerTimers.delete(accountSetId)
      console.log(`[AutoBackup] Disabled for account_set ${accountSetId}`)
    }
  }

  // 为启用的账套设置定时器
  for (const [accountSetId, cfg] of configs) {
    if (cfg.enabled === 'true') {
      scheduleBackupForAccountSet(accountSetId, cfg.schedule || 'daily', cfg.time || '02:00')
    }
  }
}

/**
 * 数据库清理瘦身：清理旧日志 + 重建索引 + 回收空间
 */
router.post('/database/cleanup', requirePermission('system:backup'), (req: AuthRequest, res) => {
  try {
    const db = getDb()
    const beforePages = db.prepare('PRAGMA page_count').get() as { page_count: number }
    const freelist = db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }

    // 1. 清理30天前的操作日志
    const deletedLogs = db
      .prepare("DELETE FROM operation_logs WHERE created_at < datetime('now', '-30 days')")
      .run()

    // 2. 重建 FTS 索引
    try {
      db.exec("INSERT INTO vouchers_fts(vouchers_fts) VALUES('rebuild')")
    } catch (_) {}
    try {
      db.exec("INSERT INTO voucher_entries_fts(voucher_entries_fts) VALUES('rebuild')")
    } catch (_) {}

    // 3. VACUUM 回收空间
    db.exec('VACUUM')

    const afterPages = db.prepare('PRAGMA page_count').get() as { page_count: number }
    const pageSize = 4096
    const savedBytes = (beforePages.page_count - afterPages.page_count) * pageSize

    res.json({
      code: 0,
      message: '数据库清理完成',
      data: {
        beforePages: beforePages.page_count,
        afterPages: afterPages.page_count,
        savedBytes,
        freedPages: beforePages.page_count - afterPages.page_count,
        deletedLogs: deletedLogs.changes,
        freelistPages: freelist.freelist_count,
      },
    })
  } catch (error) {
    console.error('[cleanup] error:', error)
    res
      .status(500)
      .json({ code: 500, message: error instanceof Error ? error.message : '清理失败' })
  }
})

/**
 * 启动调度器
 */
function startScheduler() {
  try {
    const db = getDb()
    updateScheduler(db)
    console.log('[AutoBackup] Scheduler started')
  } catch (e) {
    console.warn('[AutoBackup] Scheduler deferred - DB not ready yet')
  }
}

function insertRowsIntoTable(
  targetDb: Database.Database,
  table: string,
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0) return
  const cols = Object.keys(rows[0]).join(', ')
  const placeholders = Object.keys(rows[0])
    .map(() => '?')
    .join(', ')
  const insertStmt = targetDb.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`)
  for (const row of rows) {
    insertStmt.run(...Object.values(row))
  }
}

function copyRowsByAccountSetId(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  table: string,
  accountSetId: string
) {
  try {
    const rows = sourceDb
      .prepare(`SELECT * FROM ${table} WHERE account_set_id = ?`)
      .all(accountSetId) as Record<string, unknown>[]
    insertRowsIntoTable(targetDb, table, rows)
  } catch {
    // 表可能不存在或没有 account_set_id 字段
  }
}

function collectAccountSetUserIds(sourceDb: Database.Database, accountSetId: string): string[] {
  const userIds = new Set<string>()

  const addValue = (value: unknown) => {
    if (typeof value === 'string' && value) {
      userIds.add(value)
    }
  }

  try {
    for (const row of sourceDb
      .prepare('SELECT DISTINCT user_id FROM user_roles WHERE account_set_id = ?')
      .all(accountSetId) as Array<{ user_id: string }>) {
      addValue(row.user_id)
    }
  } catch {
    // user_roles 可能不存在
  }

  for (const row of sourceDb
    .prepare('SELECT id FROM users WHERE account_set_id = ?')
    .all(accountSetId) as Array<{ id: string }>) {
    addValue(row.id)
  }

  for (const row of sourceDb
    .prepare(
      'SELECT DISTINCT owner_user_id FROM roles WHERE account_set_id = ? AND owner_user_id IS NOT NULL'
    )
    .all(accountSetId) as Array<{ owner_user_id: string }>) {
    addValue(row.owner_user_id)
  }

  for (const row of sourceDb
    .prepare(
      `SELECT DISTINCT user_id FROM (
        SELECT maker_id AS user_id FROM vouchers WHERE account_set_id = ? AND maker_id IS NOT NULL
        UNION SELECT auditor_id FROM vouchers WHERE account_set_id = ? AND auditor_id IS NOT NULL
        UNION SELECT poster_id FROM vouchers WHERE account_set_id = ? AND poster_id IS NOT NULL
      )`
    )
    .all(accountSetId, accountSetId, accountSetId) as Array<{ user_id: string }>) {
    addValue(row.user_id)
  }

  try {
    for (const row of sourceDb
      .prepare(
        'SELECT DISTINCT created_by AS user_id FROM voucher_templates WHERE account_set_id = ? AND created_by IS NOT NULL'
      )
      .all(accountSetId) as Array<{ user_id: string }>) {
      addValue(row.user_id)
    }
  } catch {
    // voucher_templates 可能不存在
  }

  return [...userIds]
}

// 单账套备份函数：只导出指定账套的数据
export type AccountSetBackupStats = {
  auxCategories: number
  auxItems: number
  accounts: number
  vouchers: number
  initBalances: number
  reportDefinitions: number
  voucherAttachments: number
  /** 实际写入备份库内嵌表的附件文件数 */
  attachmentFilesEmbedded: number
}

export function formatAccountSetBackupStatsSummary(stats: AccountSetBackupStats): string {
  const parts = [`科目 ${stats.accounts} 个`]
  if (stats.vouchers > 0) parts.push(`凭证 ${stats.vouchers} 张`)
  if (stats.auxCategories > 0 || stats.auxItems > 0) {
    parts.push(`辅助类目 ${stats.auxCategories} 个、辅助项目 ${stats.auxItems} 条`)
  }
  if (stats.initBalances > 0) parts.push(`期初 ${stats.initBalances} 条`)
  if (stats.reportDefinitions > 0) parts.push(`动态报表 ${stats.reportDefinitions} 个`)
  if (stats.voucherAttachments > 0) {
    const embedded = stats.attachmentFilesEmbedded
    const missing = stats.voucherAttachments - embedded
    if (missing > 0) {
      parts.push(
        `附件 ${stats.voucherAttachments} 条（已打包 ${embedded} 个，${missing} 个源文件缺失）`
      )
    } else {
      parts.push(`附件 ${stats.voucherAttachments} 条（已打包 ${embedded} 个文件）`)
    }
  }
  return parts.join('，')
}

function countAccountSetBackupRows(db: Database.Database, accountSetId: string): AccountSetBackupStats {
  const count = (sql: string, ...params: unknown[]) =>
    ((db.prepare(sql).get(...params) as { c: number } | undefined)?.c || 0) as number

  const reportDefinitions = tableExistsInDb(db, 'report_definitions')
    ? count('SELECT COUNT(*) as c FROM report_definitions WHERE account_set_id = ?', accountSetId)
    : 0
  const voucherAttachments = tableExistsInDb(db, 'voucher_attachments')
    ? count('SELECT COUNT(*) as c FROM voucher_attachments WHERE account_set_id = ?', accountSetId)
    : 0

  return {
    auxCategories: count('SELECT COUNT(*) as c FROM aux_categories WHERE account_set_id = ?', accountSetId),
    auxItems: count('SELECT COUNT(*) as c FROM aux_items WHERE account_set_id = ?', accountSetId),
    accounts: count('SELECT COUNT(*) as c FROM accounts WHERE account_set_id = ?', accountSetId),
    vouchers: count('SELECT COUNT(*) as c FROM vouchers WHERE account_set_id = ?', accountSetId),
    initBalances: count('SELECT COUNT(*) as c FROM init_balances WHERE account_set_id = ?', accountSetId),
    reportDefinitions,
    voucherAttachments,
    attachmentFilesEmbedded: 0,
  }
}

function tableExistsInDb(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined
  return !!row?.name
}

function embedAttachmentFilesInBackupDb(
  sourceDb: Database.Database,
  backupDb: Database.Database,
  accountSetId: string
): number {
  try {
    backupDb.exec(
      `CREATE TABLE IF NOT EXISTS ${BACKUP_ATTACHMENT_TABLE} (
        filename TEXT PRIMARY KEY,
        content BLOB NOT NULL
      )`
    )

    const attachments = sourceDb
      .prepare('SELECT filename FROM voucher_attachments WHERE account_set_id = ?')
      .all(accountSetId) as Array<{ filename: string }>

    if (attachments.length === 0) return 0

    const insert = backupDb.prepare(
      `INSERT OR REPLACE INTO ${BACKUP_ATTACHMENT_TABLE} (filename, content) VALUES (?, ?)`
    )
    const uploadDir = join(DEPLOY_DIR, 'uploads', 'attachments')
    let embedded = 0

    for (const att of attachments) {
      const safeName = basename(att.filename)
      if (!safeName || safeName.includes('..')) continue
      const filePath = join(uploadDir, safeName)
      if (existsSync(filePath)) {
        insert.run(safeName, readFileSync(filePath))
        embedded++
      }
    }
    return embedded
  } catch (err) {
    console.warn('嵌入凭证附件到备份库失败:', err)
    return 0
  }
}

function copyReportDefinitionTables(
  sourceDb: Database.Database,
  targetDb: Database.Database,
  accountSetId: string
) {
  const reportDefs = sourceDb
    .prepare('SELECT * FROM report_definitions WHERE account_set_id = ?')
    .all(accountSetId) as Record<string, unknown>[]
  insertRowsIntoTable(targetDb, 'report_definitions', reportDefs)

  const defIds = reportDefs.map(row => row.id).filter(Boolean) as string[]
  if (defIds.length === 0) return

  const placeholders = defIds.map(() => '?').join(', ')
  const sheets = sourceDb
    .prepare(`SELECT * FROM report_sheets WHERE report_definition_id IN (${placeholders})`)
    .all(...defIds) as Record<string, unknown>[]
  insertRowsIntoTable(targetDb, 'report_sheets', sheets)

  const sheetIds = sheets.map(row => row.id).filter(Boolean) as string[]
  if (sheetIds.length > 0) {
    const sheetPh = sheetIds.map(() => '?').join(', ')
    const cells = sourceDb
      .prepare(`SELECT * FROM report_cells WHERE report_sheet_id IN (${sheetPh})`)
      .all(...sheetIds) as Record<string, unknown>[]
    insertRowsIntoTable(targetDb, 'report_cells', cells)
  }

  const sources = sourceDb
    .prepare(`SELECT * FROM report_template_sources WHERE report_definition_id IN (${placeholders})`)
    .all(...defIds) as Record<string, unknown>[]
  insertRowsIntoTable(targetDb, 'report_template_sources', sources)

  copyRowsByAccountSetId(sourceDb, targetDb, 'report_formula_functions', accountSetId)
}

async function doAccountSetBackup(
  accountSetId: string,
  userId?: string
): Promise<{
  id: string
  filename: string
  filepath: string
  size: number
  stats?: AccountSetBackupStats
  error?: string
} | null> {
  const db = getDb()

  // 获取账套信息
  const accountSet = db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId) as any
  if (!accountSet) {
    return { id: '', filename: '', filepath: '', size: 0, error: '账套不存在' }
  }

  const now = new Date()
  const timeStr = formatBackupTime(now)
  const filename = `${accountSet.name}_${timeStr}.db`
  const tempDir = resolve(DEPLOY_DIR, 'backups', 'temp')

  // 确保临时目录存在
  try {
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }
  } catch (err: any) {
    return {
      id: '',
      filename: '',
      filepath: '',
      size: 0,
      error: `无法创建临时目录: ${err.message}`,
    }
  }

  const filepath = join(tempDir, filename)

  try {
    // 创建新的数据库文件
    const newDb = new Database(filepath)

    // 复制表结构（只复制必要的表）
    const tables = [
      'account_sets',
      'users',
      'roles',
      'user_roles',
      'role_account_scopes',
      'user_account_scopes',
      'user_login_sessions',
      'accounts',
      'voucher_types',
      'aux_categories',
      'aux_category_fields',
      'aux_items',
      'init_balances',
      'vouchers',
      'voucher_entries',
      'transfer_types',
      'transfer_items',
      'report_templates',
      'report_template_items',
      'report_definitions',
      'report_sheets',
      'report_cells',
      'report_template_sources',
      'report_formula_functions',
      'print_templates',
      'voucher_templates',
      'voucher_attachments',
      'account_balances',
      'period_closing',
      'budget_surplus_adjustments',
      'cash_flow_items',
      'auto_transfer_runs',
      'ai_config',
      'system_params',
      'operation_logs',
    ]

    // 获取表结构并创建
    for (const table of tables) {
      try {
        const createSql = db
          .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`)
          .get(table) as any

        if (createSql?.sql) {
          newDb.exec(createSql.sql)
        }
      } catch (err) {
        console.warn(`跳过表 ${table}:`, err)
      }
    }

    // 复制索引
    const indexes = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`)
      .all() as any[]

    for (const idx of indexes) {
      try {
        newDb.exec(idx.sql)
      } catch (err) {
        // 忽略索引创建错误
      }
    }

    // 复制数据（只复制当前账套的数据，顺序需满足外键依赖）
    let attachmentFilesEmbedded = 0
    const transaction = newDb.transaction(() => {
      // 1. 账套信息
      const accountSetData = db.prepare('SELECT * FROM account_sets WHERE id = ?').get(accountSetId)
      if (accountSetData) {
        insertRowsIntoTable(newDb, 'account_sets', [accountSetData as Record<string, unknown>])
      }

      // 2. 用户（含角色关联、凭证制单人/审核人/过账人等引用）
      const userIds = collectAccountSetUserIds(db, accountSetId)
      if (userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(', ')
        const users = db
          .prepare(`SELECT * FROM users WHERE id IN (${placeholders})`)
          .all(...userIds) as Record<string, unknown>[]
        insertRowsIntoTable(newDb, 'users', users)
      }

      // 3. 角色
      copyRowsByAccountSetId(db, newDb, 'roles', accountSetId)

      // 4. 用户角色关联
      copyRowsByAccountSetId(db, newDb, 'user_roles', accountSetId)

      // 5. 凭证类型（必须在 vouchers 之前）
      copyRowsByAccountSetId(db, newDb, 'voucher_types', accountSetId)

      // 6. 科目
      copyRowsByAccountSetId(db, newDb, 'accounts', accountSetId)

      // 7. 辅助核算
      copyRowsByAccountSetId(db, newDb, 'aux_categories', accountSetId)
      const auxCategoryFields = db
        .prepare(
          'SELECT acf.* FROM aux_category_fields acf INNER JOIN aux_categories ac ON acf.category_id = ac.id WHERE ac.account_set_id = ?'
        )
        .all(accountSetId) as Record<string, unknown>[]
      insertRowsIntoTable(newDb, 'aux_category_fields', auxCategoryFields)
      copyRowsByAccountSetId(db, newDb, 'aux_items', accountSetId)

      // 8. 期初余额
      copyRowsByAccountSetId(db, newDb, 'init_balances', accountSetId)

      // 9. 结转类型（必须在 transfer_items 之前）
      copyRowsByAccountSetId(db, newDb, 'transfer_types', accountSetId)

      // 10. 凭证与分录
      copyRowsByAccountSetId(db, newDb, 'vouchers', accountSetId)
      copyRowsByAccountSetId(db, newDb, 'voucher_entries', accountSetId)

      // 11. 其余账套数据（按外键顺序）
      const otherTables = [
        'transfer_items',
        'report_templates',
        'report_template_items',
        'print_templates',
        'voucher_templates',
        'voucher_attachments',
        'account_balances',
        'period_closing',
        'budget_surplus_adjustments',
        'cash_flow_items',
        'auto_transfer_runs',
        'ai_config',
        'role_account_scopes',
        'user_account_scopes',
        'system_params',
      ]

      copyReportDefinitionTables(db, newDb, accountSetId)

      for (const table of otherTables) {
        copyRowsByAccountSetId(db, newDb, table, accountSetId)
      }

      attachmentFilesEmbedded = embedAttachmentFilesInBackupDb(db, newDb, accountSetId)
    })

    transaction()
    const backupStats = countAccountSetBackupRows(db, accountSetId)
    backupStats.attachmentFilesEmbedded = attachmentFilesEmbedded
    newDb.close()

    const fileStats = statSync(filepath)
    const id = uuidv4()

    return { id, filename, filepath, size: fileStats.size, stats: backupStats }
  } catch (err: any) {
    const errorMsg = `单账套备份失败: ${err.message}`
    console.error(errorMsg, err)
    return { id: '', filename: '', filepath: '', size: 0, error: errorMsg }
  }
}

// 导出供 server/index.ts 调用（服务器重启时刷新调度器）
export { startScheduler, updateScheduler, doBackup, doAccountSetBackup }

export default router
