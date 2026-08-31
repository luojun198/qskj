@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\build-upgrade-package.ps1" -Root "%ROOT%"
if errorlevel 1 (
  echo.
  echo ERROR: Upgrade package build failed
  pause
  exit /b 1
)

pause
exit /b 0
