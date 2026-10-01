import { existsSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * 运行时根目录（数据 / 上传 / 日志 / 前端产物都以它为基准）。
 *
 * 不能用 process.cwd()：开发时 cwd = server/，部署时 cwd 取决于启动方式
 * （start.bat 会先 cd 到部署根目录，快捷方式 / 服务等其它启动方式就不一定），
 * 同一个目录用两套算法时，开发与部署结果不一致（附件写进一处、静态服务读另一处）。
 *
 * 也不能直接按本文件位置往上数：esbuild 打成单个 bundle.cjs 后，所有模块的
 * import.meta.url 都指向 bundle 文件本身（见 scripts/buildBundle.mjs 的 shim），
 * 源码里的目录层级不复存在。
 */
const MODULE_FILE = fileURLToPath(import.meta.url)
const MODULE_DIR = dirname(MODULE_FILE)
const IS_BUNDLE = /\.cjs$/i.test(MODULE_FILE)

function resolveAppRoot(): string {
  const execPath = process.execPath || ''

  // pkg exe：deploy/cw-finance.exe → deploy/
  if ((process as any).pkg) return dirname(execPath)

  // 便携 Node.js：deploy/node/node.exe → deploy/
  const execDir = dirname(execPath)
  if (execPath.toLowerCase().endsWith('node.exe') && basename(execDir).toLowerCase() === 'node') {
    return dirname(execDir)
  }

  if (IS_BUNDLE) {
    // 系统 Node 跑打包产物：
    //   deploy-final/server/bundle.cjs → deploy-final/
    //   server/dist/bundle.cjs（npm start）→ 项目根目录
    return basename(MODULE_DIR).toLowerCase() === 'dist'
      ? resolve(MODULE_DIR, '..', '..')
      : resolve(MODULE_DIR, '..')
  }

  // 源码运行（tsx / vitest）：server/src/utils/runtimePaths.ts → 项目根目录
  return resolve(MODULE_DIR, '..', '..', '..')
}

const APP_ROOT = resolveAppRoot()

export function getDeployDir(): string {
  return APP_ROOT
}

/** 上传目录：<根目录>/uploads/...sub（与 index.ts 的 /uploads 静态服务同源） */
export function getUploadsDir(...sub: string[]): string {
  return join(APP_ROOT, 'uploads', ...sub)
}

/**
 * 读取 / 删除已上传文件时用：优先新位置；不存在时回退到旧版按 cwd 存放的位置
 * （此前附件写在 <cwd>/uploads/...，开发环境 cwd = server/），都没有则返回新位置。
 */
export function resolveUploadFile(...sub: string[]): string {
  const primary = getUploadsDir(...sub)
  if (existsSync(primary)) return primary
  const legacy = join(process.cwd(), 'uploads', ...sub)
  if (legacy !== primary && existsSync(legacy)) return legacy
  return primary
}
