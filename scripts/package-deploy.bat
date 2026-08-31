@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo 财务记账系统 - Windows Server 2012 部署打包
echo ========================================
echo.

:: 设置变量
set "DEPLOY_DIR=deploy-win2012"
set "TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"

echo [1/6] 清理旧部署目录...
if exist "%DEPLOY_DIR%" (
    rmdir /s /q "%DEPLOY_DIR%"
)
mkdir "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%\client"
mkdir "%DEPLOY_DIR%\server"
mkdir "%DEPLOY_DIR%\data"
mkdir "%DEPLOY_DIR%\uploads"

echo [2/6] 构建前端...
call npm run build --workspace=client
if errorlevel 1 (
    echo 错误: 前端构建失败
    exit /b 1
)

echo [3/6] 构建后端...
cd server
call npm run pkg:build
if errorlevel 1 (
    echo 错误: 后端构建失败
    exit /b 1
)
cd ..

echo [4/6] 复制文件到部署目录...
:: 复制可执行文件
copy "server\dist\cw-finance.exe" "%DEPLOY_DIR%\" >nul
if errorlevel 1 (
    echo 错误: 复制可执行文件失败
    exit /b 1
)

:: 复制前端静态文件
xcopy "client\dist\*" "%DEPLOY_DIR%\client\dist\" /E /I /Y >nul
if errorlevel 1 (
    echo 错误: 复制前端文件失败
    exit /b 1
)

:: 复制数据库 schema
copy "server\schema.sql" "%DEPLOY_DIR%\server\" >nul
if errorlevel 1 (
    echo 错误: 复制 schema 文件失败
    exit /b 1
)

echo [5/6] 创建启动脚本...
(
echo @echo off
echo chcp 65001 ^>nul
echo title 财务记账系统服务器
echo echo ========================================
echo echo 财务记账系统 - 启动中...
echo echo ========================================
echo echo.
echo echo 服务器地址: http://localhost:3005
echo echo 默认账户: admin / admin123
echo echo.
echo echo 按 Ctrl+C 停止服务器
echo echo ========================================
echo echo.
echo cw-finance.exe
echo pause
) > "%DEPLOY_DIR%\start.bat"

echo [6/6] 创建说明文档...
(
echo # 财务记账系统 - Windows Server 2012 部署包
echo.
echo ## 系统要求
echo.
echo - Windows Server 2012 或更高版本
echo - 无需安装 Node.js 或其他依赖
echo - 至少 100MB 可用磁盘空间
echo.
echo ## 部署步骤
echo.
echo 1. 将整个文件夹复制到目标服务器
echo 2. 双击 `start.bat` 启动服务器
echo 3. 浏览器访问 http://localhost:3005
echo 4. 使用默认账户登录: admin / admin123
echo.
echo ## 目录结构
echo.
echo ```
echo deploy-win2012/
echo ├── cw-finance.exe          # 服务器可执行文件（包含 Node.js 运行时）
echo ├── start.bat               # 启动脚本
echo ├── README.md               # 本说明文档
echo ├── client/
echo │   └── dist/               # 前端静态文件
echo ├── server/
echo │   └── schema.sql          # 数据库结构文件
echo ├── data/                   # 数据库文件目录（首次运行自动创建）
echo └── uploads/                # 文件上传目录
echo ```
echo.
echo ## 配置说明
echo.
echo ### 修改端口
echo.
echo 如需修改默认端口（3005），编辑 `start.bat`：
echo.
echo ```batch
echo set PORT=8080
echo cw-finance.exe
echo ```
echo.
echo ### 数据库位置
echo.
echo 数据库文件默认保存在 `data/finance.db`，首次运行自动创建。
echo.
echo ## 备份与恢复
echo.
echo ### 备份
echo.
echo 1. 停止服务器
echo 2. 复制 `data/` 目录到安全位置
echo 3. 复制 `uploads/` 目录（如有上传文件）
echo.
echo ### 恢复
echo.
echo 1. 停止服务器
echo 2. 将备份的 `data/` 目录覆盖当前目录
echo 3. 将备份的 `uploads/` 目录覆盖当前目录
echo 4. 重新启动服务器
echo.
echo ## 故障排查
echo.
echo ### 端口被占用
echo.
echo 错误信息: `Error: listen EADDRINUSE: address already in use :::3005`
echo.
echo 解决方法:
echo 1. 修改 `start.bat` 中的端口号
echo 2. 或关闭占用 3005 端口的程序
echo.
echo ### 数据库锁定
echo.
echo 错误信息: `database is locked`
echo.
echo 解决方法:
echo 1. 确保只有一个服务器实例在运行
echo 2. 删除 `data/finance.db-shm` 和 `data/finance.db-wal` 文件
echo 3. 重新启动服务器
echo.
echo ### 无法访问
echo.
echo 1. 检查防火墙是否允许 3005 端口
echo 2. 检查服务器是否正常启动（查看命令行窗口）
echo 3. 尝试使用 http://127.0.0.1:3005 访问
echo.
echo ## 技术支持
echo.
echo - 构建时间: %TIMESTAMP%
echo - Node.js 版本: 18.x（内置）
echo - 数据库: SQLite 3
echo.
echo ## 更新日志
echo.
echo ### v1.0.0 ^(%date%^)
echo.
echo - 初始发布
echo - 支持 Windows Server 2012
echo - 零依赖部署
echo - 包含完整的财务记账功能
) > "%DEPLOY_DIR%\README.md"

echo.
echo ========================================
echo 打包完成！
echo ========================================
echo.
echo 部署目录: %DEPLOY_DIR%
echo 可执行文件: %DEPLOY_DIR%\cw-finance.exe
echo 启动脚本: %DEPLOY_DIR%\start.bat
echo.
echo 下一步:
echo 1. 测试部署包: cd %DEPLOY_DIR% ^&^& start.bat
echo 2. 压缩打包: 右键 %DEPLOY_DIR% ^> 发送到 ^> 压缩文件
echo 3. 部署到目标服务器
echo.
pause
