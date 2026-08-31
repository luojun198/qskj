@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo ========================================
echo   CW Finance - Build + Zip Package
echo ========================================
echo.

call "%ROOT%\build-deploy.bat"
if errorlevel 1 (
    echo.
    echo ERROR: build-deploy.bat failed
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\compress-deploy-package.ps1" -Root "%ROOT%" -SkipBuild
if errorlevel 1 (
    echo.
    echo ERROR: compress-deploy-package.ps1 failed
    pause
    exit /b 1
)

echo.
echo Full deploy zip is under deploy-output\ (see latest.json)
echo.
pause
exit /b 0
