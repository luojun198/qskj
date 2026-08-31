# CW Finance - 构建客户端增量升级包
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-Location $Root

$pkg = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$build = Get-Date -Format 'yyyyMMddHHmm'
$outDir = Join-Path $Root 'upgrade-output'
$staging = Join-Path $outDir "cw-upgrade-v${version}-b${build}"
$zipPath = Join-Path $outDir "cw-upgrade-v${version}-b${build}.zip"

Write-Host ''
Write-Host '========================================'
Write-Host '  CW Finance - Build Upgrade Package'
Write-Host '========================================'
Write-Host ''

Write-Host '[1/4] Building frontend ...'
npm run build:deploy --workspace=client
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }

Write-Host '[2/4] Building backend bundle ...'
Push-Location (Join-Path $Root 'server')
node scripts/buildBundle.mjs
if ($LASTEXITCODE -ne 0) { throw 'Backend bundle failed' }
Pop-Location

Write-Host '[3/4] Staging upgrade files ...'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $staging 'files\server') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging 'files\client\dist') -Force | Out-Null

Copy-Item (Join-Path $Root 'server\dist\bundle.cjs') (Join-Path $staging 'files\server\bundle.cjs') -Force
Copy-Item (Join-Path $Root 'client\dist\*') (Join-Path $staging 'files\client\dist') -Recurse -Force
Copy-Item (Join-Path $Root 'scripts\upgrade-client.bat') (Join-Path $staging 'upgrade.bat') -Force

$versionJsonPretty = @{
    version = $version
    build   = $build
    releasedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    note    = '增量升级包：仅更新 server/bundle.cjs 与 client/dist，不覆盖 data 与 uploads'
} | ConvertTo-Json
Set-Content -Path (Join-Path $staging 'VERSION.json') -Value $versionJsonPretty -Encoding UTF8

$readme = @"
CW Finance 增量升级包
====================

版本: $version
构建: $build

【使用步骤】
1. 关闭正在运行的财务系统（关闭 start.bat 窗口）
2. 将整个文件夹解压到任意位置（例如 D:\cw-upgrade）
3. 双击运行 upgrade.bat
4. 输入 deploy-final 安装目录（含 start.bat 的文件夹）
5. 按提示完成升级并启动

【说明】
- 仅更新程序文件，不会覆盖 data\finance.db 与 uploads\
- 升级前会自动备份旧程序到 安装目录\updates\backup\
- 也可命令行指定目录: upgrade.bat "D:\path\to\deploy-final"

【也可拖放】
upgrade.bat "D:\deploy-final"
"@
Set-Content -Path (Join-Path $staging '升级说明.txt') -Value $readme -Encoding UTF8

Write-Host '[4/4] Creating zip ...'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -Force

# latest manifest for future update server
$manifest = @{
    version = $version
    build = $build
    releasedAt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    notes = "CW Finance v$version (build $build)"
    packageName = (Split-Path $zipPath -Leaf)
    sha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item $zipPath).Length
} | ConvertTo-Json
Set-Content -Path (Join-Path $outDir 'latest.json') -Value $manifest -Encoding UTF8

Write-Host ''
Write-Host '========================================'
Write-Host '  BUILD SUCCESS'
Write-Host '========================================'
Write-Host ''
Write-Host "  Zip     : $zipPath"
Write-Host "  Folder  : $staging"
Write-Host "  Manifest: $(Join-Path $outDir 'latest.json')"
Write-Host ''
Write-Host '  发给客户: 上传 zip，解压后运行 upgrade.bat'
Write-Host ''
