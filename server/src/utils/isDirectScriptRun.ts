import { basename } from 'path'

/**
 * 判断当前进程是不是直接运行指定脚本（`node --import tsx/esm src/scripts/xxx.ts`）。
 *
 * 只按「入口文件名 === 脚本名」判断，不要比较 import.meta.url：
 * - 打进 bundle.cjs 后，所有模块的 import.meta.url 都是 bundle 本身，
 *   「basename(入口) === basename(import.meta.url)」恒成立，脚本会在服务启动时被执行；
 * - `import.meta.url === \`file://${argv[1]}\`` 在 Windows 上永不成立（反斜杠 / 盘符前少一个斜杠），
 *   在 Linux 跑 bundle 时却恒成立。
 */
export function isDirectScriptRun(scriptName: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return basename(entry).replace(/\.(cjs|mjs|js|ts)$/i, '') === scriptName
}
