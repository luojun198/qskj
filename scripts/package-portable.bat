@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo 财务记账系统 - Portable Node.js 部署打包
echo ========================================
echo.

:: 设置变量
set "DEPLOY_DIR=deploy-portable"
set "NODE_VERSION=18.20.5"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"

echo [1/8] 清理旧部署目录...
if exist "%DEPLOY_DIR%" (
    rmdir /s /q "%DEPLOY_DIR%"
)
mkdir "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%\client"
mkdir "%DEPLOY_DIR%\server"
mkdir "%DEPLOY_DIR%\data"
mkdir "%DEPLOY_DIR%\uploads"

echo [2/8] 下载 Node.js %NODE_VERSION% 运行时...
if not exist "node-v%NODE_VERSION%-win-x64.zip" (
    echo 正在下载 Node.js...
    powershell -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile 'node-v%NODE_VERSION%-win-x64.zip'"
    if errorlevel 1 (
        echo 错误: Node.js 下载失败
        echo 请手动下载: %NODE_URL%
        pause
        exit /b 1
    )
)

echo [3/8] 解压 Node.js...
powershell -Command "Expand-Archive -Path 'node-v%NODE_VERSION%-win-x64.zip' -DestinationPath '.' -Force"
move "node-v%NODE_VERSION%-win-x64" "%DEPLOY_DIR%\node" >nul

echo [4/8] 构建前端...
call npx vite build --config client/vite.config.ts
if errorlevel 1 (
    echo 错误: 前端构建失败
    exit /b 1
)

echo [5/8] 构建后端 bundle...
cd server
call node scripts/buildBundle.mjs
if errorlevel 1 (
    echo 错误: 后端构建失败
    exit /b 1
)
cd ..

echo [6/8] 安装生产依赖（Node %NODE_VERSION%）...
cd server
set "PATH=%cd%\..\%DEPLOY_DIR%\node;%PATH%"
call ..\%DEPLOY_DIR%\node\npm.cmd install --production --ignore-scripts
if errorlevel 1 (
    echo 错误: 依赖安装失败
    exit /b 1
)
cd ..

echo [7/8] 复制文件到部署目录...
:: 复制后端 bundle
copy "server\dist\bundle.cjs" "%DEPLOY_DIR%\server\" >nul

:: 复制 node_modules
xcopy "server\node_modules" "%DEPLOY_DIR%\server\node_modules\" /E /I /Y >nul

:: 复制前端静态文件
xcopy "client\dist\*" "%DEPLOY_DIR%\client\dist\" /E /I /Y >nul

:: 复制数据库 schema
copy "server\schema.sql" "%DEPLOY_DIR%\server\" >nul

echo [8/8] 创建启动脚本...
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
echo set "PATH=%%~dp0node;%%PATH%%"
echo node server\bundle.cjs
echo pause
) > "%DEPLOY_DIR%\start.bat"

:: 创建说明文档
(
echo # 财务记账系统 - Windows Server 2012 Portable 部署包
echo.
echo ## 系统要求
echo.
echo - Windows Server 2012 或更高版本
echo - 无需安装 Node.js 或其他依赖
echo - 至少 150MB 可用磁盘空间
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
echo deploy-portable/
echo ├── node/                   # Node.js %NODE_VERSION% 运行时（便携式）
echo │   ├── node.exe
echo │   └── npm.cmd
echo ├── server/
echo │   ├── bundle.cjs          # 后端代码
echo │   ├── schema.sql          # 数据库结构
echo │   └── node_modules/       # 生产依赖
echo ├── client/
echo │   └── dist/               # 前端静态文件
echo ├── data/                   # 数据库文件（首次运行自动创建）
echo ├── uploads/                # 文件上传目录
echo ├── start.bat               # 启动脚本
echo └── README.md               # 本说明文档
echo ```
echo.
echo ## 配置说明
echo.
echo ### 修改端口
echo.
echo 编辑 `start.bat`，在 `node server\bundle.cjs` 前添加：
echo.
echo ```batch
echo set PORT=8080
echo node server\bundle.cjs
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
echo ## 技术信息
echo.
echo - Node.js 版本: %NODE_VERSION% ^(便携式^)
echo - 数据库: SQLite 3 ^(better-sqlite3 v12.8.0^)
echo - 前端框架: Vue 3 + Element Plus
echo - 后端框架: Express.js
echo.
echo ## 功能特性
echo.
echo - 凭证管理（录入、审核、查询）
echo - 账簿查询（总账、明细账、余额表、日记账）
echo - 报表生成（资产负债表、收入费用表、现金流量表等）
echo - 辅助核算（部门、项目、往来单位、个人、功能分类）
echo - 系统管理（账套、用户、角色、权限）
echo - 数据备份与恢复
echo - AI 辅助功能（智能摘要、异常检测）
echo.
echo ## 更新日志
echo.
echo ### v1.0.0 ^(%date%^)
echo.
echo - 初始发布
echo - 支持 Windows Server 2012
echo - 零依赖部署（包含 Node.js %NODE_VERSION% 运行时）
echo - 包含完整的财务记账功能
echo - 使用 portable Node.js 方式解决原生模块兼容性问题
) > "%DEPLOY_DIR%\README.md"

echo.
echo ========================================
echo 打包完成！
echo ========================================
echo.
echo 部署目录: %DEPLOY_DIR%
echo Node.js 版本: %NODE_VERSION%
echo 启动脚本: %DEPLOY_DIR%\start.bat
echo.
echo 下一步:
echo 1. 测试部署包: cd %DEPLOY_DIR% ^&^& start.bat
echo 2. 压缩打包: 右键 %DEPLOY_DIR% ^> 发送到 ^> 压缩文件
echo 3. 部署到目标服务器
echo.
pause
