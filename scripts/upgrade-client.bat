@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

title CW Finance 程序升级
echo.
echo ========================================
echo   CW Finance - 一键升级
echo ========================================
echo.

set "PATCH_ROOT=%~dp0"
if "%PATCH_ROOT:~-1%"=="\" set "PATCH_ROOT=%PATCH_ROOT:~0,-1%"

set "INSTALL_DIR=%~1"
if "%INSTALL_DIR%"=="" (
  set /p "INSTALL_DIR=请输入安装目录（含 start.bat，例如 D:\cw\deploy-final）: "
)
if "%INSTALL_DIR%"=="" (
  echo [错误] 未指定安装目录
  pause
  exit /b 1
)
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"

if not exist "%INSTALL_DIR%\start.bat" (
  echo [错误] 未找到 %INSTALL_DIR%\start.bat
  echo 请确认路径为 deploy-final 安装根目录
  pause
  exit /b 1
)

if not exist "%PATCH_ROOT%\files\server\bundle.cjs" (
  echo [错误] 升级包不完整，缺少 files\server\bundle.cjs
  pause
  exit /b 1
)
if not exist "%PATCH_ROOT%\files\client\dist\index.html" (
  echo [错误] 升级包不完整，缺少 files\client\dist
  pause
  exit /b 1
)

for /f "tokens=1-3 delims=/:. " %%a in ("%date%") do set "STAMP=%%a%%b%%c"
for /f "tokens=1-3 delims=:. " %%a in ("%time%") do set "STAMP=!STAMP!%%a%%b"
set "STAMP=!STAMP: =0!"
set "BACKUP_DIR=%INSTALL_DIR%\updates\backup\!STAMP!"

echo 安装目录: %INSTALL_DIR%
echo 备份目录: %BACKUP_DIR%
echo.

echo [1/4] 停止占用端口 3005 的进程 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(3005); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -and $_ -ne $PID) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } }; Start-Sleep -Seconds 2"
echo       完成
echo.

echo [2/4] 备份当前程序 ...
mkdir "%BACKUP_DIR%\server" 2>nul
mkdir "%BACKUP_DIR%\client" 2>nul
if exist "%INSTALL_DIR%\server\bundle.cjs" copy /y "%INSTALL_DIR%\server\bundle.cjs" "%BACKUP_DIR%\server\" >nul
if exist "%INSTALL_DIR%\client\dist" xcopy "%INSTALL_DIR%\client\dist" "%BACKUP_DIR%\client\dist\" /E /I /Y /Q >nul
if exist "%INSTALL_DIR%\VERSION.json" copy /y "%INSTALL_DIR%\VERSION.json" "%BACKUP_DIR\" >nul
echo       完成
echo.

echo [3/4] 覆盖新版本文件 ...
copy /y "%PATCH_ROOT%\files\server\bundle.cjs" "%INSTALL_DIR%\server\bundle.cjs" >nul
if errorlevel 1 (
  echo [错误] 无法写入 server\bundle.cjs，请确认已关闭程序且目录可写
  pause
  exit /b 1
)
if not exist "%INSTALL_DIR%\client\dist" mkdir "%INSTALL_DIR%\client\dist"
xcopy "%PATCH_ROOT%\files\client\dist" "%INSTALL_DIR%\client\dist\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo [错误] 无法写入 client\dist
  pause
  exit /b 1
)
copy /y "%PATCH_ROOT%\VERSION.json" "%INSTALL_DIR%\VERSION.json" >nul
echo       完成
echo.

echo [4/4] 升级完成
type "%PATCH_ROOT%\VERSION.json"
echo.
echo 数据目录 data\ 与 uploads\ 未改动。
echo 备份位置: %BACKUP_DIR%
echo.
set /p "LAUNCH=是否立即启动系统？(Y/N，默认 Y): "
if /i "!LAUNCH!"=="N" (
  echo 请稍后手动运行 start.bat
  pause
  exit /b 0
)
start "" "%INSTALL_DIR%\start.bat"
echo 已启动，浏览器访问 http://127.0.0.1:3005
pause
exit /b 0
