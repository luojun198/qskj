@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0\.."
set "ROOT=%CD%"
set "DEPLOY=deploy-final"

if not exist "%ROOT%\%DEPLOY%\node\node.exe" (
    echo ERROR: deploy-final is incomplete. Run build-deploy.bat first.
    exit /b 1
)

if not exist "%ROOT%\data\finance.db" (
    echo ERROR: Dev database not found: %ROOT%\data\finance.db
    exit /b 1
)

echo [1/3] Syncing dev database to deploy-final ...
"%ROOT%\%DEPLOY%\node\node.exe" "%ROOT%\scripts\copy-dev-db-to-deploy.cjs" "%ROOT%" "%ROOT%\%DEPLOY%"
if errorlevel 1 exit /b 1

echo [2/3] Syncing standard templates ...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\copy-deploy-templates.ps1" "%ROOT%" "%DEPLOY%"
if errorlevel 1 exit /b 1

echo [3/3] Updating BUILD_STAMP ...
node "%ROOT%\scripts\write-deploy-build-stamp.cjs" "%ROOT%" "%DEPLOY%"
if errorlevel 1 exit /b 1

echo.
echo OK: deploy-final data + templates synced from dev environment.
echo      Run start.bat or build-and-package.bat when ready.
exit /b 0
