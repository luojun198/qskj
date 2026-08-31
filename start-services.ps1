# 释放所有端口并启动服务脚本
# Release ports and start services script

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "释放端口并启动服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 定义要释放的端口
$ports = @(3000, 5000, 8080, 8000, 9000, 5173, 5174)

# 释放端口
Write-Host "`n[1/4] 释放端口..." -ForegroundColor Yellow
foreach ($port in $ports) {
    $processes = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    if ($processes) {
        foreach ($pid in $processes) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  ✓ 已关闭端口 $port 上的进程 (PID: $pid)" -ForegroundColor Green
            }
            catch {
                Write-Host "  ✗ 无法关闭端口 $port 上的进程" -ForegroundColor Red
            }
        }
    }
}

# 等待端口释放
Start-Sleep -Seconds 2

# 启动服务
Write-Host "`n[2/4] 启动后端服务..." -ForegroundColor Yellow
$projectPath = "D:\kf\cw0423"
Set-Location $projectPath

# 启动后端
Start-Process -FilePath "npm" -ArgumentList "run dev:server" -NoNewWindow -PassThru | Out-Null
Write-Host "  ✓ 后端服务已启动" -ForegroundColor Green

# 等待后端启动
Start-Sleep -Seconds 3

Write-Host "`n[3/4] 启动前端服务..." -ForegroundColor Yellow
# 启动前端
Start-Process -FilePath "npm" -ArgumentList "run dev:client" -NoNewWindow -PassThru | Out-Null
Write-Host "  ✓ 前端服务已启动" -ForegroundColor Green

# 等待前端启动
Start-Sleep -Seconds 3

# 创建桌面快捷方式
Write-Host "`n[4/4] 创建桌面快捷方式..." -ForegroundColor Yellow
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "启动财务系统.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$projectPath\start-services.ps1`""
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = "C:\Windows\System32\powershell.exe,0"
$shortcut.Save()
Write-Host "  ✓ 快捷方式已创建: $shortcutPath" -ForegroundColor Green

# 打开浏览器
Write-Host "`n[5/5] 打开主页..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$homepage = "http://localhost:5173"
Start-Process -FilePath "msedge.exe" -ArgumentList $homepage
Write-Host "  ✓ 已在 Microsoft Edge 中打开: $homepage" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "所有操作已完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "前端地址: http://localhost:5173" -ForegroundColor Green
Write-Host "后端地址: http://localhost:5000" -ForegroundColor Green
