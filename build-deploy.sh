#!/bin/bash
set -e

# ============================================================
#  财务记账系统 - macOS/Linux 部署包构建脚本
# ============================================================

echo ""
echo "========================================"
echo "  CW Finance - Build Deployment Package"
echo "========================================"
echo ""

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="deploy-final"

# ---------- Step 1: 构建前端 ----------
echo "[1/4] Building frontend (Vite) ..."
cd "$PROJ_DIR/client"
npm run build
echo "      OK"
echo ""

# ---------- Step 2: 构建后端 bundle ----------
echo "[2/4] Building backend bundle (esbuild) ..."
cd "$PROJ_DIR/server"
node scripts/buildBundle.mjs
echo "      OK"
echo ""

# ---------- Step 3: 准备部署目录 ----------
echo "[3/4] Preparing deploy directory ..."
cd "$PROJ_DIR"
rm -rf "$DEPLOY"
mkdir -p "$DEPLOY/client"
mkdir -p "$DEPLOY/server"
mkdir -p "$DEPLOY/data"
mkdir -p "$DEPLOY/uploads"
echo "      OK"
echo ""

# ---------- Step 4: 安装生产依赖 ----------
echo "[4/4] Installing production dependencies ..."
cd "$PROJ_DIR/server"
cp package.json "$PROJ_DIR/$DEPLOY/server/"
cd "$PROJ_DIR/$DEPLOY/server"
npm install --omit=dev

# 验证 better-sqlite3 二进制
if [ ! -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
    echo "ERROR: better-sqlite3 binary not found!"
    exit 1
fi
echo "      OK (better-sqlite3 binary verified)"
echo ""

# ---------- 复制文件 ----------
echo "Copying files ..."
cd "$PROJ_DIR"

# 后端 bundle
cp "server/dist/bundle.cjs" "$DEPLOY/server/"

# 数据库 schema
cp "server/schema.sql" "$DEPLOY/server/"

# 前端静态文件
cp -r "client/dist" "$DEPLOY/client/"

echo "      OK"
echo ""

# ---------- 创建启动脚本 ----------
echo "Creating start script ..."
cat > "$DEPLOY/start.sh" << 'EOF'
#!/bin/bash
echo "========================================"
echo "  CW Finance Server - Starting..."
echo "========================================"
echo ""
echo "  URL: http://localhost:3005"
echo "  User: admin / admin123"
echo ""
echo "  Press Ctrl+C to stop"
echo "========================================"
echo ""

cd "$(dirname "$0")"
node server/bundle.cjs
EOF

chmod +x "$DEPLOY/start.sh"

# ---------- 完成 ----------
echo ""
echo "========================================"
echo "  BUILD SUCCESS"
echo "========================================"
echo ""
echo "  Output : $DEPLOY/"
echo "  Start  : $DEPLOY/start.sh"
echo ""
echo "  Next steps:"
echo "  1. cd $DEPLOY"
echo "  2. ./start.sh"
echo "  3. Open http://localhost:3005"
echo "  4. Login: admin / admin123"
echo ""
