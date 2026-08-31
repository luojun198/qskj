/**
 * 构建「注册机」工具包：pkg 打包 exe + 复制私钥
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const toolDir = join(root, '注册机')
const sourceScript = join(root, 'scripts', 'license-generator-tool.cjs')
const outputExe = join(toolDir, 'generate-license.exe')
const privateKeySources = [
  join(root, 'tools', 'license-keys', 'license-private.pem'),
  join(toolDir, 'license-private.pem'),
]
const privateKeyDest = join(toolDir, 'license-private.pem')

if (!existsSync(sourceScript)) {
  console.error('缺少源脚本:', sourceScript)
  process.exit(1)
}

console.log('[1/2] 打包 generate-license.exe (pkg node18-win-x64)...')
const pkgResult = spawnSync(
  'npx',
  ['pkg', sourceScript, '--targets', 'node18-win-x64', '--output', outputExe],
  { cwd: root, stdio: 'inherit', shell: true }
)
if (pkgResult.status !== 0) {
  console.error('pkg 打包失败')
  process.exit(pkgResult.status ?? 1)
}

if (!existsSync(outputExe)) {
  console.error('未生成 exe:', outputExe)
  process.exit(1)
}
console.log('      OK:', outputExe)

console.log('[2/2] 复制私钥 license-private.pem...')
const keySource = privateKeySources.find(p => existsSync(p))
if (!keySource) {
  console.warn('      警告: 未找到私钥，请手动将 license-private.pem 放入 注册机 目录')
  console.warn('      生成方法: node -e "require(\'crypto\').generateKeyPairSync(...)" 或见 tools/license-generator/README.md')
} else {
  copyFileSync(keySource, privateKeyDest)
  console.log('      OK:', privateKeyDest)
}

console.log('')
console.log('注册机工具包已就绪:', toolDir)
console.log('  - generate-license.exe')
console.log('  - license-private.pem', keySource ? '(已复制)' : '(需手动放置)')
console.log('  - 生成注册码.bat')
console.log('  - 使用说明.txt')
console.log('')
console.log('可将整个「注册机」文件夹复制到无 Node 环境的电脑使用。')
