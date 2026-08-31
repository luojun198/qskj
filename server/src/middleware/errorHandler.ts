import { Request, Response, NextFunction } from 'express'
import { log } from '../utils/logger.js'
import { humanizeError } from '../utils/errorMessage.js'

/**
 * 自定义业务错误类
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: number,
    message: string,
    public isOperational = true
  ) {
    super(message)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // 记录错误日志
  log.error('Error occurred', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  })

  // 如果是自定义业务错误
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
    })
  }

  // 数据库错误（better-sqlite3 约束码在 err.code，不在 message；用统一中文化工具判定）
  if (String((err as any).code || '').startsWith('SQLITE_') || err.message.includes('constraint failed') || err.message.includes('database')) {
    return res.status(400).json({
      code: 400,
      message: humanizeError(err),
    })
  }

  // JWT 错误
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      code: 401,
      message: 'Token 无效',
    })
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      code: 401,
      message: '登录已过期',
    })
  }

  // 请求体过大（express.json / body-parser）
  if (
    (err as any).type === 'entity.too.large' ||
    err.message.includes('request entity too large')
  ) {
    return res.status(413).json({
      code: 413,
      message: '导入数据量过大，请分批导入或减少单次行数',
    })
  }

  // Multer 文件上传错误
  if (err.message.includes('File too large')) {
    return res.status(400).json({
      code: 400,
      message: '文件大小超出限制',
    })
  }

  if (err.message.includes('Unexpected field')) {
    return res.status(400).json({
      code: 400,
      message: '文件字段名不正确',
    })
  }

  // 默认服务器错误：非生产环境也走中文化（避免把英文技术错误/堆栈弹给用户）
  return res.status(500).json({
    code: 500,
    message: humanizeError(err),
  })
}

/**
 * 异步路由处理器包装函数
 * 自动捕获 async 函数中的错误并传递给错误处理中间件
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * 404 处理中间件
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  res.status(404).json({
    code: 404,
    message: `路由不存在: ${req.method} ${req.path}`,
  })
}
