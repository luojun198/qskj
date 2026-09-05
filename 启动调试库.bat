@echo off
setlocal enabledelayedexpansion
title CW Finance - Debug DB Start

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "START_LOCK=%TEMP%\cw-finance-debug-start.lock"
set "START_LOG=%TEMP%\cw-finance-debug-start.log"
set "PROCESS_STATE=%TEMP%\cw-finance-dev-processes.json"
set "NPM_CMD="
set "PROJECT_PORTS=3105 5275"
:: License/activation debug database, isolated from start-dev.bat (finance-0523.db).
set "DEV_DB_PATH=%ROOT%\data\finance-lic-test.db"

>"%START_LOG%" echo [%date% %time%] CW Finance debug launcher started. ROOT=%ROOT% DB_PATH=%DEV_DB_PATH%

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

if exist "%START_LOCK%" (
    powershell.exe -NoProfile -Command "$lock = Join-Path $env:TEMP 'cw-finance-debug-start.lock'; if ((Get-Date) - (Get-Item -LiteralPath $lock).LastWriteTime -gt [TimeSpan]::FromMinutes(2)) { Remove-Item -LiteralPath $lock -Recurse -Force }" >nul 2>&1
)
2>nul mkdir "%START_LOCK%"
if errorlevel 1 (
    echo CW Finance debug launcher is already starting. Duplicate launch ignored.
    exit /b 0
)

echo.
echo ========================================
echo   CW Finance - Debug DB (license test)
echo ========================================
echo.

:: Services must be down before the database file can be deleted, otherwise
:: SQLite keeps a handle open and the rebuild fails halfway.
echo [1/4] Releasing ports %PROJECT_PORTS% ...
for %%p in (%PROJECT_PORTS%) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        taskkill /PID %%a /T /F >nul 2>&1
    )
)
ping -n 3 -w 1000 127.0.0.1 >nul
>>"%START_LOG%" echo [%date% %time%] Ports released.

echo [2/4] Rebuilding a blank unregistered database ...
del /f /q "%DEV_DB_PATH%" "%DEV_DB_PATH%-wal" "%DEV_DB_PATH%-shm" >nul 2>&1
if exist "%DEV_DB_PATH%" (
    echo [ERROR] Could not delete the old debug database: %DEV_DB_PATH%
    echo Some process still holds it open. Close the CW Backend window and retry.
    >>"%START_LOG%" echo [%date% %time%] ERROR: debug database still locked.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)

set "DB_PATH=%DEV_DB_PATH%"
set "SCHEMA_DIR=src/db"
pushd "%ROOT%\server"
call "%NPM_CMD%" run db:init >>"%START_LOG%" 2>&1
if errorlevel 1 (
    popd
    echo [ERROR] Database schema initialization failed. See %START_LOG%
    >>"%START_LOG%" echo [%date% %time%] ERROR: db:init failed.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)
call "%NPM_CMD%" run db:migrate >>"%START_LOG%" 2>&1
if errorlevel 1 (
    popd
    echo [ERROR] Database migration failed. See %START_LOG%
    >>"%START_LOG%" echo [%date% %time%] ERROR: db:migrate failed.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)
popd
set "DB_PATH="
set "SCHEMA_DIR="
echo       Blank database created: data\finance-lic-test.db
>>"%START_LOG%" echo [%date% %time%] Blank database rebuilt.
echo.

echo [3/4] Starting backend and frontend ...
>>"%START_LOG%" echo [%date% %time%] Forced clean restart requested. Ports=%PROJECT_PORTS%

:: Shares the process state file with start-dev.bat so either launcher can take over.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\restart-dev-processes.ps1" -ProjectRoot "%ROOT%" -NpmCommand "%NPM_CMD%" -StateFile "%PROCESS_STATE%" -PortList "%PROJECT_PORTS%" -DatabasePath "%DEV_DB_PATH%" >>"%START_LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to clean or start CW Finance processes.
    >>"%START_LOG%" echo [%date% %time%] ERROR: process cleanup/start failed.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)

echo       Backend and frontend launched.
>>"%START_LOG%" echo [%date% %time%] Old processes cleaned and new service roots launched.
echo.

echo [4/4] Waiting for servers to be ready ...

set "READY=0"
for /L %%i in (1,1,30) do (
    if !READY! equ 0 (
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
    echo   CW Finance on a BLANK UNREGISTERED DB
    echo   Database : data\finance-lic-test.db
    echo   Frontend : http://localhost:5275
    echo   Backend  : http://localhost:3105
    echo   Account  : admin / admin123
    echo   Note     : this database is wiped on every launch
    echo ========================================
    echo.
    >>"%START_LOG%" echo [%date% %time%] Both services are ready.
) else (
    echo.
    echo [ERROR] Services did not become ready within 30 seconds.
    echo Check the CW Backend / CW Frontend windows for the exact error.
    echo Launcher log: %START_LOG%
    >>"%START_LOG%" echo [%date% %time%] ERROR: services not ready after 30 seconds.
    rmdir "%START_LOCK%" >nul 2>&1
    pause
    exit /b 1
)

echo.
echo Opening homepage ...
rmdir "%START_LOCK%" >nul 2>&1
start "" "http://localhost:5275"
>>"%START_LOG%" echo [%date% %time%] Browser opened; launcher finished.
echo Launcher finished. This window will close automatically ...
ping -n 3 -w 1000 127.0.0.1 >nul
exit /b 0
