/**
 * 构建「注册机」工具包：pkg 打包 exe + 复制私钥 + 生成启动 bat 与使用说明
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import iconv from 'iconv-lite'

/** bat 与 txt 用 GBK + CRLF 写出：脚本内 chcp 65001 会让 set /p 读不到输入，只能沿用系统默认代码页 */
function writeGbkCrlf(path, content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  writeFileSync(path, iconv.encode(normalized, 'gbk'))
}

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

const LAUNCHER_BAT = `@echo off
setlocal enabledelayedexpansion
title CW Finance - 注册码生成器

:: 本文件为 GBK 编码：脚本里预先 chcp 65001 会让 set /p 读不到输入，
:: 因此保持系统默认代码页问答，只在调用 exe（UTF-8 输出）时临时切到 65001。
:: 双击直接进入交互问答；也支持命令行传参：
::   生成注册码.bat A1B2C3D4E5F6 2027-12-31 gl,cashier 5   （最后一项为最大并发人数，0/省略 = 不限）
set "MACHINE_ID=%~1"
set "EXPIRES=%~2"
:: cmd 默认把逗号也当参数分隔符，模块列表按空格重新切一次才能保住 gl,cashier 这种写法
set "MODULES="
set "CONCURRENT="
for /f "tokens=1,2,3,4 delims= " %%a in ("%*") do (
    set "MODULES=%%c"
    set "CONCURRENT=%%d"
)

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\\" set "ROOT=%ROOT:~0,-1%"
set "GENERATOR=%ROOT%\\generate-license.exe"
set "PRIVATE_KEY=%ROOT%\\license-private.pem"

echo.
echo ========================================
echo   CW Finance 注册码生成器
echo ========================================
echo.

if not exist "%GENERATOR%" (
    echo [错误] 未找到 generate-license.exe，请确认与本文件在同一目录。
    goto FAIL
)
if not exist "%PRIVATE_KEY%" (
    echo [错误] 未找到私钥 license-private.pem，请放到与本文件相同的目录。
    goto FAIL
)

:: 计数上限用于输入流意外结束时退出，避免无人值守场景下空转
set /a TRY=0
:ASK_MACHINE_ID
if defined MACHINE_ID goto ASK_EXPIRES_INIT
set /a TRY+=1
if !TRY! gtr 5 (
    echo [错误] 未获取到机器码，已退出。
    goto FAIL
)
set /p "MACHINE_ID=请输入用户机器码（12 位，激活页可复制）: "
if not defined MACHINE_ID echo [提示] 机器码不能为空，请重新输入。
goto ASK_MACHINE_ID

:ASK_EXPIRES_INIT
set /a TRY=0
:ASK_EXPIRES
if defined EXPIRES goto ASK_MODULES
set /a TRY+=1
if !TRY! gtr 5 (
    echo [错误] 未获取到截止日期，已退出。
    goto FAIL
)
set /p "EXPIRES=请输入授权截止日期 YYYY-MM-DD（含当天）: "
if not defined EXPIRES echo [提示] 截止日期不能为空，请重新输入。
goto ASK_EXPIRES

:ASK_MODULES
if defined MODULES goto ASK_CONCURRENT
echo.
echo ---------- 可授权模块 ----------
echo   1. 总账        (gl)
echo   2. 出纳管理    (cashier)
echo   3. 固定资产    (asset)
echo   4. 进销存      (scm)
echo   5. 生产管理    (production)
echo   6. 委外管理    (outsource)
echo --------------------------------
echo 多选用逗号分隔，例如: 1,2  或  gl,cashier
echo 直接回车 = 授权全部模块
echo.
set /p "MODULES=请输入授权模块: "
if not defined MODULES set "MODULES=all"

:ASK_CONCURRENT
if defined CONCURRENT goto GENERATE
echo.
echo ---------- 并发授权 ----------
echo 最多允许多少人同时在线（正整数）；直接回车 = 不限制
set /p "CONCURRENT=请输入最大并发在线人数: "
if not defined CONCURRENT set "CONCURRENT=0"

:GENERATE
:: exe 输出为 UTF-8，切到 65001 才不会乱码；打印完再切回原代码页
set "OLD_CP="
for /f "tokens=2 delims=:" %%c in ('chcp') do set "OLD_CP=%%c"
set "OLD_CP=!OLD_CP: =!"
chcp 65001 >nul
echo.
"%GENERATOR%" -m "%MACHINE_ID%" -e "%EXPIRES%" -M "%MODULES%" -c "%CONCURRENT%" -k "%PRIVATE_KEY%"
set "TOOL_EXIT=!errorlevel!"
if defined OLD_CP chcp !OLD_CP! >nul

if not "!TOOL_EXIT!"=="0" (
    echo.
    echo [失败] 注册码生成失败，请检查上方提示后重试。
    goto FAIL
)
echo 注册码已复制到剪贴板（如提示复制成功），也可手动完整复制上方内容。
echo.
pause
exit /b 0

:FAIL
echo.
pause
exit /b 1
`

const USAGE_TXT = `CW Finance 注册机 使用说明
========================================

一、这是什么
    根据客户的「机器码」生成注册码。注册码与机器码绑定，
    换一台电脑无法使用；同时限定有效期和可用模块。

二、目录内容
    generate-license.exe   注册码生成程序（目标电脑无需安装 Node.js）
    license-private.pem    私钥（务必妥善保管，切勿外发）
    生成注册码.bat         双击启动，按提示操作
    使用说明.txt           本文件

三、操作步骤
    1. 客户打开软件激活页，复制页面上的 12 位机器码发给你
    2. 双击「生成注册码.bat」
    3. 依次输入：
         机器码       例如 A1B2C3D4E5F6
         截止日期     例如 2027-12-31（含当天）
         授权模块     输入编号或 key，逗号分隔；直接回车 = 全部
         并发人数     最多同时在线人数（正整数）；直接回车 = 不限制
    4. 把生成的注册码整行复制发给客户（程序已尝试写入剪贴板）
    5. 客户在激活页粘贴并点击「激活」即可

四、可授权模块
    1. 总账        gl           凭证、账簿、辅助核算、报表、会计科目
    2. 出纳管理    cashier      出纳录单、账户余额表、流水账、结算方式
    3. 固定资产    asset        资产卡片、折旧、盘点、资产档案
    4. 进销存      scm          采购、销售、库存、往来及相关档案
    5. 生产管理    production   BOM、MRP、生产计划、报工、领料与成品入库
    6. 委外管理    outsource    委外计划、委外发货入库、委外执行表

    说明：
      - 系统管理、账套管理、备份恢复不受模块限制，任何授权都可用
      - 生产 / 委外依赖进销存，只勾这两项时程序会自动补上进销存
      - 旧版注册码（无模块信息）视为授权全部模块

五、命令行用法（可选）
    生成注册码.bat A1B2C3D4E5F6 2027-12-31 gl,cashier 5
    generate-license.exe -m A1B2C3D4E5F6 -e 2027-12-31 -M all -c 5

六、注意事项
    - 私钥 license-private.pem 是发码的唯一凭据，请单独备份，不要交给客户
    - 续期、增加模块或调整并发人数：重新生成一个新注册码，客户在
      「系统管理 → 系统设置 → 注册信息」页（或激活页）重新提交即可覆盖
    - 并发授权按「用户 + IP」去重统计在线人数，登录时校验；旧注册码视为不限制
    - 客户更换电脑或更换主要硬件后机器码会变，需要重新发码
`

if (!existsSync(sourceScript)) {
  console.error('缺少源脚本:', sourceScript)
  process.exit(1)
}

mkdirSync(toolDir, { recursive: true })

// SKIP_PKG=1 时只刷新 bat / 说明书等文本产物，便于改文案后快速重出包
const skipPkg = process.env.SKIP_PKG === '1'
if (skipPkg) {
  console.log('[1/3] 跳过 pkg 打包 (SKIP_PKG=1)')
} else {
  console.log('[1/3] 打包 generate-license.exe (pkg node18-win-x64)...')
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
}

console.log('[2/3] 复制私钥 license-private.pem...')
const keySource = privateKeySources.find(p => existsSync(p))
if (!keySource) {
  console.warn('      警告: 未找到私钥，请手动将 license-private.pem 放入 注册机 目录')
  console.warn('      生成方法: node -e "require(\'crypto\').generateKeyPairSync(...)" 或见 tools/license-generator/README.md')
} else {
  copyFileSync(keySource, privateKeyDest)
  console.log('      OK:', privateKeyDest)
}

console.log('[3/3] 生成 生成注册码.bat 与 使用说明.txt ...')
writeGbkCrlf(join(toolDir, '生成注册码.bat'), LAUNCHER_BAT)
writeGbkCrlf(join(toolDir, '使用说明.txt'), USAGE_TXT)
console.log('      OK')

console.log('')
console.log('注册机工具包已就绪:', toolDir)
console.log('  - generate-license.exe')
console.log('  - license-private.pem', keySource ? '(已复制)' : '(需手动放置)')
console.log('  - 生成注册码.bat')
console.log('  - 使用说明.txt')
console.log('')
console.log('可将整个「注册机」文件夹复制到无 Node 环境的电脑使用。')
