// 首先加载环境变量
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// 兼容开发模式（__dirname = server/src/）和部署模式（__dirname = deploy-final/server/）
const envPath = existsSync(join(__dirname, '.env'))
  ? join(__dirname, '.env')
  : join(__dirname, '..', '.env')
dotenv.config({ path: envPath })

// JWT_SECRET 弱值检查：生产环境硬阻断启动，开发环境仅告警
const DEFAULT_JWT_SECRETS = new Set([
  'your-secret-key-change-this-in-production',
  'change-me',
  'changeme',
  'secret',
  '',
])
const _jwtSecretCheck = (process.env.JWT_SECRET || '').trim()
if (!_jwtSecretCheck || DEFAULT_JWT_SECRETS.has(_jwtSecretCheck) || _jwtSecretCheck.length < 16) {
  const _jwtMsg =
    'JWT_SECRET 当前为默认/弱值或过短（<16 字符）。请在 server/.env 中设置为足够长的随机字符串，' +
    '否则任何知晓默认值的人都能伪造登录 token。'
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    // 生产环境不允许以弱密钥启动，直接退出，强制运维修正
    console.error('[SECURITY FATAL] ' + _jwtMsg)
    process.exit(1)
  }
  console.warn('[SECURITY WARN] ' + _jwtMsg)
}

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { basename, resolve } from 'path'
import { initDatabase, getDeployDir, getDb } from './db/index.js'
import { expireAllStaleLoginSessions } from './services/loginSession.js'
import {
  formatCompatibilityUpgradeSummary,
  upgradeDatabaseCompatibility,
} from './db/databaseCompatibility.js'
import { initDefaultAccountSet } from './scripts/seedAccounts.js'
import { initDefaultPrintTemplate } from './scripts/initPrintTemplate.js'
import { log } from './utils/logger.js'
import { initTaskQueue } from './services/taskQueue.js'

// 路由
import authRoutes from './routes/auth.js'
import systemRoutes from './routes/system.js'
import baseRoutes from './routes/base.js'
import baseAccountRoutes from './routes/baseAccount.js'
import baseVoucherTypeRoutes from './routes/baseVoucherType.js'
import baseProjectRoutes from './routes/baseProject.js'
import baseInitBalanceRoutes from './routes/baseInitBalance.js'
import basePrintTemplateRoutes from './routes/basePrintTemplate.js'
import baseKeyboardShortcutsRoutes from './routes/baseKeyboardShortcuts.js'
import baseCashFlowRoutes from './routes/baseCashFlow.js'
import voucherRoutes from './routes/voucher.js'
import voucherAuditRoutes from './routes/voucherAudit.js'
import voucherPostingRoutes from './routes/voucherPosting.js'
import voucherBatchRoutes from './routes/voucherBatch.js'
import voucherPeriodRoutes from './routes/voucherPeriod.js'
import voucherAiRoutes from './routes/voucherAi.js'
import voucherAutoTransferRoutes from './routes/voucherAutoTransfer.js'
import voucherTemplateRoutes from './routes/voucherTemplate.js'
import taskRoutes from './routes/task.js'
import sharedTasksRoutes from './routes/sharedTasks.js'
import ledgerRoutes from './routes/ledger.js'
import ledgerStandardReportRoutes from './routes/ledgerStandardReport.js'
import reportRoutes from './routes/report.js'
import exportRoutes from './routes/export.js'
// 以下静态报表路由已废弃（前端改用动态报表 DynamicReport + report_definitions 表）
// import reportBalanceSheetRoutes from './routes/reportBalanceSheet.js'
// import reportIncomeStatementRoutes from './routes/reportIncomeStatement.js'
// import reportEquityRoutes from './routes/reportEquity.js'
// import reportAuxRoutes from './routes/reportAux.js'
// 仅保留静态现金流量表（估算口径，前端入口：report/cash-flow）
import reportCashFlowRoutes from './routes/reportCashFlow.js'
import reportAiRoutes from './routes/reportAi.js'
import reportTemplateRoutes from './routes/reportTemplate.js'
import dashboardRoutes from './routes/dashboard.js'
import cashierRoutes from './routes/cashierJournal.js'
import fixedAssetRoutes from './routes/fixedAsset.js'
import scmBaseRoutes from './routes/scmBase.js'
import scmDocRoutes from './routes/scmDoc.js'
import scmColSchemeRoutes from './routes/scmColScheme.js'
import scmSalesReportRoutes from './routes/scmSalesReport.js'
import acdExportRoutes from './routes/acdExport.js'
import cashierImportRoutes from './routes/cashierImport.js'
import backupRoutes from './routes/backup.js'
import licenseRoutes from './routes/license.js'
import { licenseMiddleware } from './middleware/licenseMiddleware.js'

// 便携部署：process.execPath = deploy/node/node.exe，client/dist 在 deploy/client/dist/
// pkg 部署：process.pkg 标识，client/dist 在 exe 同目录/client/dist/
// 开发环境：client/dist 在项目根目录 client/dist/
function getExeDir(): string {
  if ((process as any).pkg) {
    // pkg exe: deploy/cw-finance.exe → deploy/
    return dirname(process.execPath)
  }
  // 便携 Node.js: execPath = deploy/node/node.exe
  // 系统安装的 Node.js: execPath = C:\Program Files\nodejs\node.exe
  // 区分方式：execPath 的父目录名是 "node" 则为便携式
  const execPath = process.execPath || ''
  const execDir = dirname(execPath)
  if (execPath.endsWith('node.exe') && basename(execDir).toLowerCase() === 'node') {
    return dirname(execDir)
  }
  // 开发：arg = server/src/index.ts
  const arg = process.argv[1]
  if (arg) {
    // tsx dev: arg = server/src/index.ts → server/src → server → cw/
    // bundle:  arg = server/dist/bundle.cjs → server/dist → server → cw/
    const scriptDir = dirname(arg)
    const serverDir = dirname(scriptDir)
    return dirname(serverDir)
  }
  return process.cwd()
}

const EXE_DIR = getExeDir()

const app = express()
// 当前分支(cw0523)独立端口 3105，与原项目 cw(3005)可同时运行
const PORT = process.env.PORT || 3105

// 文件上传中间件
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // 接受所有文件类型
    cb(null, true)
  },
})

// 中间件（批量导入核算项目/科目/期初等可能超过 10MB，默认放宽至 50MB，可通过 JSON_BODY_LIMIT 调整）
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '50mb'
app.use(cors())
app.use(express.json({ limit: JSON_BODY_LIMIT }))
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }))

// 请求日志
app.use((req, res, next) => {
  const start = Date.now()
  const originalEnd = res.end.bind(res)
  ;(res as any).end = (...args: any[]) => {
    const duration = Date.now() - start
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${duration}`)
    return originalEnd(...args)
  }
  res.on('finish', () => {
    const duration = Date.now() - start
    if (duration >= 200) {
      const responseSize = Number(res.getHeader('content-length') || 0)
      log.http(
        `${req.method} ${req.route?.path || req.path} ${res.statusCode} ${duration}ms ${responseSize}B`
      )
    }
  })
  next()
})

// === 启动顺序：数据库 → 兼容升级 → 默认数据 → API 路由 → 监听 ===
initDatabase()
log.info('数据库初始化完成')

try {
  const compatibility = upgradeDatabaseCompatibility()
  log.info(`数据库兼容升级：${formatCompatibilityUpgradeSummary(compatibility)}`)
  if (!compatibility.after.isCompatible) {
    log.warn('数据库仍存在未自动修复的结构差异', compatibility.after.issues)
  }
} catch (error) {
  log.error('数据库兼容升级失败:', error)
}

initTaskQueue()

if (process.env.SEED_DEFAULT_ACCOUNT_SET !== 'false') {
  initDefaultAccountSet('行政事业单位财务账套')
  log.info('默认账套初始化完成')
} else {
  log.info('已跳过默认账套初始化')
}

try {
  initDefaultPrintTemplate()
  log.info('默认打印模版初始化完成')
} catch (error) {
  log.error('默认打印模版初始化失败:', error)
}

function readDeployBuildStamp(): Record<string, unknown> | null {
  const stampPath = join(EXE_DIR, 'BUILD_STAMP.json')
  if (!existsSync(stampPath)) return null
  try {
    return JSON.parse(readFileSync(stampPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

// 健康检查（须在挂载 /api 全局 auth 的路由之前注册）
app.get('/api/health', (req, res) => {
  const stamp = readDeployBuildStamp()
  res.json({
    code: 0,
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...(stamp
      ? {
          version: stamp.version,
          build: stamp.build,
          mode: stamp.mode,
          gitCommit: stamp.gitCommit,
          builtAtLocal: stamp.builtAtLocal,
          clientIndexHash:
            typeof stamp.clientIndexHash === 'string'
              ? stamp.clientIndexHash.slice(0, 8)
              : undefined,
        }
      : {}),
  })
})

// 全局：出错响应的 message 统一中文化——拦截 res.json，把各路由 catch 后透传的底层技术错误
// （SQLite 约束、英文堆栈等）替换成中文友好提示；仅处理出错响应(非 0 code / >=400 状态)，成功响应不动。
import { humanizeError } from './utils/errorMessage.js'
app.use((_req, res, next) => {
  const origJson = res.json.bind(res)
  ;(res as any).json = (body: any) => {
    try {
      if (body && typeof body === 'object' && typeof body.message === 'string'
        && (res.statusCode >= 400 || (typeof body.code === 'number' && body.code !== 0))) {
        body.message = humanizeError(body.message)
      }
    } catch { /* 保底：任何异常都不影响正常响应 */ }
    return origJson(body)
  }
  next()
})

// 软件授权（公开接口，须在 licenseMiddleware 之前注册）
app.use('/api/license', licenseRoutes)

// 全局授权校验（白名单见 licenseMiddleware.ts）
app.use(licenseMiddleware)

// API路由
app.use('/api/auth', authRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/base', baseRoutes)
app.use('/api/base/keyboard-shortcuts', baseKeyboardShortcutsRoutes)
app.use('/api/base/cash-flow-items', baseCashFlowRoutes)
app.use('/api/base', baseAccountRoutes)
app.use('/api/base', baseVoucherTypeRoutes)
app.use('/api/base', baseProjectRoutes)
app.use('/api/base', baseInitBalanceRoutes)
app.use('/api/base', basePrintTemplateRoutes)
app.use('/api', sharedTasksRoutes)
app.use('/api/voucher', voucherRoutes)
app.use('/api/voucher', voucherAuditRoutes)
app.use('/api/voucher', voucherPostingRoutes)
app.use('/api/voucher', voucherBatchRoutes)
app.use('/api/voucher', voucherPeriodRoutes)
app.use('/api/voucher', voucherAiRoutes)
app.use('/api/voucher', voucherAutoTransferRoutes)
app.use('/api/voucher', taskRoutes)
app.use('/api/voucher-templates', voucherTemplateRoutes)
app.use('/api/ledger', ledgerRoutes)
app.use('/api/ledger/standard-reports', ledgerStandardReportRoutes)
app.use('/api/report', reportRoutes)
app.use('/api/export', exportRoutes)
// 以下静态报表路由已废弃
// app.use('/api/report', reportBalanceSheetRoutes)
// app.use('/api/report', reportIncomeStatementRoutes)
// app.use('/api/report', reportEquityRoutes)
// app.use('/api/report', reportAuxRoutes)
app.use('/api/report', reportCashFlowRoutes)
app.use('/api/report', reportAiRoutes)
app.use('/api/report', reportTemplateRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/security', backupRoutes)
app.use('/api', cashierRoutes)
app.use('/api', fixedAssetRoutes)
app.use('/api', scmBaseRoutes)
app.use('/api', scmDocRoutes)
app.use('/api', scmColSchemeRoutes)
app.use('/api', scmSalesReportRoutes)
app.use('/api', acdExportRoutes)
app.use('/api', cashierImportRoutes)

// 静态文件服务（前端页面）
const clientDist = resolve(EXE_DIR, 'client', 'dist')
app.use('/uploads', express.static(resolve(getDeployDir(), 'uploads')))
app.use(
  express.static(clientDist, {
    setHeaders(res, filePath) {
      const fileName = basename(filePath)
      if (fileName === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      } else if (/[-.][a-zA-Z0-9_-]{8,}\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?)$/.test(fileName)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  })
)

// SPA fallback: 所有非API路由返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.sendFile(resolve(clientDist, 'index.html'))
})

// 404 处理（必须在所有路由之后）
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
app.use(notFoundHandler)

// 全局错误处理中间件（必须在最后）
app.use(errorHandler)

const server = app.listen(PORT, () => {
  try {
    const expiredCount = expireAllStaleLoginSessions(getDb())
    if (expiredCount > 0) {
      log.info(`已清理 ${expiredCount} 条过期登录会话`)
    }
  } catch (error) {
    log.warn('启动时会话清理失败（不影响服务）:', error)
  }
  log.info(`财务记账系统服务已启动: http://localhost:${PORT}`)
  log.info(`API地址: http://localhost:${PORT}/api`)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    log.error(`端口 ${PORT} 已被占用，后端服务可能已经在运行。请关闭重复启动的服务后再重试。`)
    process.exit(0)
  }
  throw error
})
