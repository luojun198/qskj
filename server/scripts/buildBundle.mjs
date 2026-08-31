import * as esbuild from 'esbuild'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const ABS_DIR = resolve(dirname(__filename), '..')

// 便携部署：CJS 格式；native 模块和 path/filepath 相关 external
const externals = [
  'better-sqlite3',
  'iconv-lite',
  'exceljs',
  ...builtinModules,
  ...builtinModules.map(m => 'node:' + m),
  'path', 'path/posix', 'path/win32',
  'process', 'util', 'os',
]

await esbuild.build({
  entryPoints: [resolve(ABS_DIR, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  outfile: resolve(ABS_DIR, 'dist/bundle.cjs'),
  format: 'cjs',
  target: 'node18',
  external: externals,
  loader: { '.ts': 'ts' },
  sourcemap: false,
  minify: false,
  // CJS format has no import.meta.url; inject a shim that resolves
  // to the directory of the entry point at runtime.
  define: {
    'import.meta.url': '__import_meta_url_shim__',
  },
  banner: {
    js: `var __import_meta_url_shim__ = require('url').pathToFileURL(__filename).href;`,
  },
})

console.log('Bundle created: dist/bundle.cjs')
