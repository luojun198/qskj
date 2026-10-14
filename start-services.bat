@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title CW Finance - Starting Services

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo ========================================
echo  CW Finance - Start Services
echo ========================================
echo.

echo [1/4] Releasing ports...
for %%p in (3105 5275) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        taskkill /PID %%a /F >nul 2>&1
    )
)
echo Done.
timeout /t 2 /nobreak >nul

echo.
echo [2/4] Starting backend...
start "CW Backend" cmd /k "cd /d "%ROOT%" && npm run dev:server"
timeout /t 4 /nobreak >nul

echo.
echo [3/4] Starting frontend...
start "CW Frontend" cmd /k "cd /d "%ROOT%" && npm run dev:client"
for /L %%i in (1,1,120) do (
    netstat -ano | findstr ":5275 " | findstr "LISTENING" >nul 2>&1 && goto :fe_ready
    timeout /t 1 /nobreak >nul
)
:fe_ready

echo.
echo [4/4] Opening homepage in Microsoft Edge...
start msedge http://localhost:5275

echo.
echo ========================================
echo  All services started successfully!
echo  Frontend : http://localhost:5275
echo  Backend  : http://localhost:3105
echo  (cw0523 分支独立端口，可与原项目 cw 同时运行)
echo ========================================
echo.
