import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('部署包数据库配置', () => {
  it('部署环境不写入依赖工作目录的相对数据库路径', () => {
    const script = readFileSync(resolve(__dirname, '../../../../build-deploy.bat'), 'utf8')

    expect(script).not.toContain('echo DB_PATH=')
    expect(script).not.toContain('DB_PATH=../data/finance.db')
    expect(script).not.toContain('DB_PATH=../data/finance-0523.db')
  })

  it('启动脚本强制使用部署包内数据库并在数据库缺失时停止', () => {
    const script = readFileSync(resolve(__dirname, '../../../../build-deploy.bat'), 'utf8')

    expect(script).toContain('echo set "ROOT=%%~dp0"')
    expect(script).toContain('echo set "DB_PATH=%%ROOT%%data\\finance.db"')
    // 不能把含路径的 echo 放进括号块：目录名带 ")" 如 deploy-final(2) 会让 cmd 解析失败而闪退
    expect(script).toContain('echo if exist "%%DB_PATH%%" goto db_ok')
    expect(script).toContain('echo echo ERROR: Bundled database not found: %%DB_PATH%%')
  })

  it('追加部署说明时不会覆盖已经生成的环境变量', () => {
    const script = readFileSync(resolve(__dirname, '../../../../build-deploy.bat'), 'utf8')
    const branchComment = script.split(/\r?\n/).find(line => line.includes('cw0523'))

    expect(branchComment).toContain('>> "%DEPLOY%\\server\\.env"')
  })

  it('便携 Node 复制失败时立即终止打包', () => {
    const script = readFileSync(resolve(__dirname, '../../../../build-deploy.bat'), 'utf8')

    expect(script).toContain('if not exist "%ROOT%\\%DEPLOY%\\node\\node.exe" (')
    expect(script).toContain('ERROR: Portable Node.js copy failed')
  })

  it('生成端口清理脚本时正确转义 PowerShell 数组右括号', () => {
    const script = readFileSync(resolve(__dirname, '../../../../build-deploy.bat'), 'utf8')

    expect(script).toContain('echo $ports = @(3105, 5275^)')
  })

  it('压缩前拒绝数据库路径配置错误或缺少包内数据库的部署目录', () => {
    const script = readFileSync(
      resolve(__dirname, '../../../../scripts/compress-deploy-package.ps1'),
      'utf8'
    )

    expect(script).toContain("$deployDbPath = Join-Path $deployDir 'data\\finance.db'")
    expect(script).toContain("$deployStartPath = Join-Path $deployDir 'start.bat'")
    expect(script).toContain("$deployEnvPath = Join-Path $deployDir 'server\\.env'")
    expect(script).toContain(
      "throw 'deploy-final/start.bat does not force the bundled database path. Re-run build-deploy.bat.'"
    )
    expect(script).toContain(
      "throw 'deploy-final/server/.env must not contain DB_PATH. Re-run build-deploy.bat.'"
    )
  })
})

describe('本地开发启动数据库配置', () => {
  it('cw0523 启动脚本使用分支独立数据库', () => {
    const script = readFileSync(resolve(__dirname, '../../../../start-dev.bat'), 'utf8')

    expect(script).toContain('set "DEV_DB_PATH=%ROOT%\\data\\finance-0523.db"')
    expect(script).not.toContain('set "DEV_DB_PATH=%ROOT%\\data\\finance.db"')
  })
})
