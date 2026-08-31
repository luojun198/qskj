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

echo [1/3] Building frontend ...
call npm run build:deploy --workspace=client
if errorlevel 1 exit /b 1

echo [2/3] Building backend bundle ...
cd /d "%ROOT%\server"
node scripts\buildBundle.mjs
if errorlevel 1 exit /b 1
cd /d "%ROOT%"

echo [3/3] Syncing into deploy-final ...
copy /y "%ROOT%\server\dist\bundle.cjs" "%ROOT%\%DEPLOY%\server\" >nul
if exist "%ROOT%\%DEPLOY%\client\dist" rmdir /s /q "%ROOT%\%DEPLOY%\client\dist"
mkdir "%ROOT%\%DEPLOY%\client\dist"
xcopy "%ROOT%\client\dist\*" "%ROOT%\%DEPLOY%\client\dist\" /E /I /Y >nul

node "%ROOT%\scripts\write-deploy-build-stamp.cjs" "%ROOT%" "%DEPLOY%"
if errorlevel 2 (
    echo ERROR: artifact sync verification failed
    exit /b 1
)
if errorlevel 1 exit /b 1

echo.
echo OK: deploy-final updated (code only). Run start.bat or compress zip when ready.
echo NOTE: data\finance.db and 标准模版 were NOT updated. If you changed report/print templates,
echo       run scripts\sync-deploy-data.bat before delivering the package.
exit /b 0
