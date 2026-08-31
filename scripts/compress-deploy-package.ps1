param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Set-Location $Root

$versionInfoPath = Join-Path $Root 'client\public\version.json'
if (-not (Test-Path $versionInfoPath)) {
    throw "version.json not found: $versionInfoPath. Run build-deploy.bat first."
}
$versionInfo = Get-Content $versionInfoPath -Raw | ConvertFrom-Json
$version = $versionInfo.version
$build = $versionInfo.build
$outDir = Join-Path $Root 'deploy-output'
$zipName = "cw-deploy-v${version}-b${build}.zip"
$zipPath = Join-Path $outDir $zipName
$deployDir = Join-Path $Root 'deploy-final'
$buildDeployBat = Join-Path $Root 'build-deploy.bat'

if (-not $SkipBuild) {
    Write-Host ''
    Write-Host 'Running full build (build-deploy.bat) before zip ...'
    Write-Host ''
    if (-not (Test-Path $buildDeployBat)) {
        throw "build-deploy.bat not found: $buildDeployBat"
    }
    cmd /c "`"$buildDeployBat`""
    if ($LASTEXITCODE -ne 0) {
        throw "build-deploy.bat failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $deployDir)) {
    throw 'deploy-final not found. Run build-deploy.bat first (or omit -SkipBuild).'
}

$deployDbPath = Join-Path $deployDir 'data\finance.db'
$deployStartPath = Join-Path $deployDir 'start.bat'
$deployEnvPath = Join-Path $deployDir 'server\.env'

if (-not (Test-Path $deployDbPath) -or (Get-Item $deployDbPath).Length -eq 0) {
    throw 'deploy-final/data/finance.db is missing or empty. Re-run build-deploy.bat.'
}
if (-not (Test-Path $deployStartPath)) {
    throw 'deploy-final/start.bat is missing. Re-run build-deploy.bat.'
}
if (-not (Test-Path $deployEnvPath)) {
    throw 'deploy-final/server/.env is missing. Re-run build-deploy.bat.'
}

$deployStart = Get-Content $deployStartPath -Raw
if (
    -not $deployStart.Contains('set "DB_PATH=%ROOT%data\finance.db"') -or
    -not $deployStart.Contains('if not exist "%DB_PATH%" (')
) {
    throw 'deploy-final/start.bat does not force the bundled database path. Re-run build-deploy.bat.'
}

$deployEnv = Get-Content $deployEnvPath -Raw
if ($deployEnv -match '(?m)^\s*DB_PATH\s*=') {
    throw 'deploy-final/server/.env must not contain DB_PATH. Re-run build-deploy.bat.'
}

$stampPath = Join-Path $deployDir 'BUILD_STAMP.json'
if (-not (Test-Path $stampPath)) {
    Write-Warning 'BUILD_STAMP.json missing; deploy-final may be from an old pack script. Re-run build-deploy.bat.'
} else {
    $stamp = Get-Content $stampPath -Raw | ConvertFrom-Json
    if ($stamp.inSyncWithProjectDist -eq $false) {
        throw "deploy-final is out of sync with project dist. Re-run build-deploy.bat. Details: $($stamp.mismatches -join '; ')"
    }
    if ($stamp.dbInSyncWithDev -eq $false) {
        throw "deploy-final database differs from dev data/finance.db. Report/print templates may be stale. Re-run build-deploy.bat or scripts\sync-deploy-data.bat. Details: $($stamp.mismatches -join '; ')"
    }
    Write-Host "Deploy stamp: $($stamp.builtAtLocal) commit=$($stamp.gitCommit) dbInSync=$($stamp.dbInSyncWithDev)"
}

$clientIndexDeploy = Join-Path $deployDir 'client\dist\index.html'
$clientIndexProject = Join-Path $Root 'client\dist\index.html'
if ((Test-Path $clientIndexDeploy) -and (Test-Path $clientIndexProject)) {
    $a = (Get-FileHash $clientIndexDeploy -Algorithm SHA256).Hash
    $b = (Get-FileHash $clientIndexProject -Algorithm SHA256).Hash
    if ($a -ne $b) {
        throw 'deploy-final/client/dist/index.html differs from client/dist/index.html. Run build-deploy.bat before compressing.'
    }
}

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host ''
Write-Host 'Compressing deploy-final ...'
Write-Host $zipPath
Write-Host ''
Write-Host 'Tip: Do NOT use Explorer right-click zip on deploy-final (may fail with Temp path errors).'
Write-Host ''

# Prefer tar.exe zip (faster; avoids Explorer Temp folder issues with Compress-Archive)
$tarExe = Join-Path $env:WINDIR 'System32\tar.exe'
if (-not (Test-Path $tarExe)) {
    $tarExe = $null
    $tarCmd = Get-Command tar -ErrorAction SilentlyContinue
    if ($tarCmd) { $tarExe = $tarCmd.Source }
}
if (-not $tarExe) {
    Write-Warning 'tar not found, falling back to Compress-Archive (slower, may fail on long paths).'
    Compress-Archive -Path $deployDir -DestinationPath $zipPath -CompressionLevel Optimal -Force
} else {
    $deployParent = Split-Path -Parent $deployDir
    $deployName = Split-Path -Leaf $deployDir
    Push-Location $deployParent
    try {
        & $tarExe -a -c -f $zipPath $deployName
        if ($LASTEXITCODE -ne 0) {
            throw "tar failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

$sizeBytes = (Get-Item $zipPath).Length
$sizeMB = [math]::Round($sizeBytes / 1MB, 2)
$sha256 = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

$manifest = @{
    version     = $version
    build       = $build
    releasedAt  = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    packageName = $zipName
    sha256      = $sha256
    size        = $sizeBytes
    notes       = "CW Finance deploy package v$version build $build"
    deployStamp = if (Test-Path $stampPath) { (Get-Content $stampPath -Raw | ConvertFrom-Json).builtAt } else { $null }
} | ConvertTo-Json

Set-Content -Path (Join-Path $outDir 'latest.json') -Value $manifest -Encoding UTF8

Write-Host 'ZIP SUCCESS'
Write-Host "Zip    : $zipPath"
Write-Host "Size   : $sizeMB MB"
Write-Host "SHA256 : $sha256"
Write-Host "Manifest includes deployStamp from BUILD_STAMP.json when present."
