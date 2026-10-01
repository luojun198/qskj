import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { getDeployDir, getUploadsDir, resolveUploadFile } from '../utils/runtimePaths.js'
import { isDirectScriptRun } from '../utils/isDirectScriptRun.js'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

describe('runtimePaths', () => {
  const originalCwd = process.cwd()
  let tmp = ''

  afterEach(() => {
    process.chdir(originalCwd)
    if (tmp) rmSync(tmp, { recursive: true, force: true })
    tmp = ''
  })

  it('源码运行时根目录是项目根，与 cwd 无关', () => {
    expect(getDeployDir()).toBe(PROJECT_ROOT)
    tmp = mkdtempSync(join(tmpdir(), 'cw-rt-'))
    process.chdir(tmp)
    expect(getDeployDir()).toBe(PROJECT_ROOT)
    expect(getUploadsDir('attachments')).toBe(join(PROJECT_ROOT, 'uploads', 'attachments'))
  })

  it('新位置没有文件时回退到旧版 cwd/uploads 下的文件', () => {
    tmp = mkdtempSync(join(tmpdir(), 'cw-rt-'))
    process.chdir(tmp)
    const name = `legacy-${Date.now()}.txt`
    mkdirSync(join(tmp, 'uploads', 'attachments'), { recursive: true })
    writeFileSync(join(tmp, 'uploads', 'attachments', name), 'x')
    const found = resolveUploadFile('attachments', name)
    expect(found).toBe(join(process.cwd(), 'uploads', 'attachments', name))
    expect(existsSync(found)).toBe(true)
  })

  it('两处都没有时返回新位置', () => {
    const name = `missing-${Date.now()}.txt`
    expect(resolveUploadFile('attachments', name)).toBe(getUploadsDir('attachments', name))
  })
})

describe('isDirectScriptRun', () => {
  const originalArgv1 = process.argv[1]
  afterEach(() => {
    process.argv[1] = originalArgv1
  })

  it('直接运行脚本时成立', () => {
    process.argv[1] = join('proj', 'server', 'src', 'scripts', 'rebuildAccountBalances.ts')
    expect(isDirectScriptRun('rebuildAccountBalances')).toBe(true)
  })

  it('打包后入口是 bundle.cjs 时不成立（脚本不能在服务启动时被执行）', () => {
    process.argv[1] = join('deploy-final', 'server', 'bundle.cjs')
    expect(isDirectScriptRun('rebuildAccountBalances')).toBe(false)
    process.argv[1] = '/opt/cw/server/bundle.cjs'
    expect(isDirectScriptRun('resetTransferParams')).toBe(false)
  })
})
