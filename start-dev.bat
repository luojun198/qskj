@echo off
setlocal enabledelayedexpansion
title CW Finance - One-Click Dev Start

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "START_LOCK=%TEMP%\cw-finance-dev-start.lock"
set "START_LOG=%TEMP%\cw-finance-dev-start.log"
set "PROCESS_STATE=%TEMP%\cw-finance-dev-processes.json"
set "NPM_CMD="
set "PROJECT_PORTS=3105 5275"
set "DEV_DB_PATH=%ROOT%\data\finance-0523.db"

>"%START_LOG%" echo [%date% %time%] CW Finance launcher started. ROOT=%ROOT% DB_PATH=%DEV_DB_PATH%

if not exist "%DEV_DB_PATH%" (
    echo [ERROR] Development database was not found: %DEV_DB_PATH%
    >>"%START_LOG%" echo [%date% %time%] ERROR: development database not found: %DEV_DB_PATH%
    pause
    exit /b 1
)

:: Resolve npm.cmd explicitly. Shortcuts do not always inherit the same PATH as an open terminal.
for /f "delims=" %%N in ('where npm.cmd 2^>nul') do (
    if not defined NPM_CMD set "NPM_CMD=%%N"
)
if not defined NPM_CMD (
    echo [ERROR] npm.cmd was not found. Please install Node.js or repair PATH.
    >>"%START_LOG%" echo [%date% %time%] ERROR: npm.cmd not found.
    echo Log: %START_LOG%
    pause
    exit /b 1
)
>>"%START_LOG%" echo [%date% %time%] npm.cmd=%NPM_CMD%

:: Remove an abandoned lock older than two minutes, then allow only one launcher instance.
:: The lock is acquired before checking ports so a rapid double-click opens at most one homepage.
if exist "%START_LOCK%" (
    powershell.exe -NoProfile -Command "$lock = Join-Path $env:TEMP 'cw-finance-dev-start.lock'; if ((Get-Date) - (Get-Item -LiteralPath $lock).LastWriteTime -gt [TimeSpan]::FromMinutes(2)) { Remove-Item -LiteralPath $lock -Recurse -Force }" >nul 2>&1
)
2>nul mkdir "%START_LOCK%"
if errorlevel 1 (
    echo CW Finance is already starting. Duplicate launch ignored.
    exit /b 0
)

echo.
echo ========================================
echo   CW Finance - One-Click Dev Start
echo ========================================
echo.

:: -------------------------------------------------------
::  Step 1: Stop old project trees, release ports, and launch one clean service set
:: -------------------------------------------------------
echo [1/3] Cleaning old processes and restarting services ...
>>"%START_LOG%" echo [%date% %time%] Forced clean restart requested. Ports=%PROJECT_PORTS%

:: Recorded root PIDs let the next launch stop complete npm/watch trees quickly and safely.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\restart-dev-processes.ps1" -ProjectRoot "%ROOT%" -NpmCommand "%NPM_CMD%" -StateFile "%PROCESS_STATE%" -PortList "%PROJECT_PORTS%" -DatabasePath "%DEV_DB_PATH%" >>"%START_LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to clean or start CW Finance processes.
    >>"%START_LOG%" echo [%date% %time%] ERROR: process cleanup/start failed.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)

echo       Old processes stopped; backend and frontend launched.
>>"%START_LOG%" echo [%date% %time%] Old processes cleaned and new service roots launched.
echo.

:: -------------------------------------------------------
::  Step 2: Wait for backend and frontend to become ready
:: -------------------------------------------------------
echo [2/3] Waiting for servers to be ready ...

set "READY=0"
for /L %%i in (1,1,120) do (
    if !READY! equ 0 (
        :: Check both ports are listening
        netstat -aon | findstr ":3105 " | findstr "LISTENING" >nul 2>&1
        if !errorlevel! equ 0 (
            netstat -aon | findstr ":5275 " | findstr "LISTENING" >nul 2>&1
            if !errorlevel! equ 0 (
                set "READY=1"
            )
        )
        if !READY! equ 0 (
            ping -n 2 -w 1000 127.0.0.1 >nul
        )
    )
)

if %READY% equ 1 (
    echo       Servers are ready!
    echo.
    echo ========================================
    echo   CW Finance is running! ^(cw0523 分支独立端口^)
    echo   Frontend : http://localhost:5275
    echo   Backend  : http://localhost:3105
    echo   Account  : admin / admin123
    echo ========================================
    echo.
    >>"%START_LOG%" echo [%date% %time%] Both services are ready.
) else (
    echo.
    echo [ERROR] Services did not become ready within 120 seconds.
    echo Check the CW Backend / CW Frontend windows for the exact error.
    echo Launcher log: %START_LOG%
    >>"%START_LOG%" echo [%date% %time%] ERROR: services not ready after 120 seconds.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)

echo.
echo [3/3] Opening homepage ...
rmdir "%START_LOCK%" >nul 2>&1
start "" "http://localhost:5275"
>>"%START_LOG%" echo [%date% %time%] Browser opened; launcher finished.
echo Launcher finished. This window will close automatically ...
ping -n 3 -w 1000 127.0.0.1 >nul
exit /b 0
