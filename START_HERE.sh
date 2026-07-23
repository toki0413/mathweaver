#!/bin/bash
# MathWeaver 一键启动脚本
# 用法: ./START_HERE.sh

set -e

echo "════════════════════════════════════════════"
echo "  MathWeaver 一键启动"
echo "════════════════════════════════════════════"
echo ""

# ---------- 方式一: Docker ----------
if command -v docker &> /dev/null && command -v docker compose &> /dev/null; then
    echo "[1/3] 检测到 Docker，使用 Docker 一键部署..."
    echo ""
    echo "  前端: http://localhost:3000"
    echo "  后端: http://localhost:8000"
    echo "  API 文档: http://localhost:8000/docs"
    echo ""
    docker compose up --build
    exit 0
fi

# ---------- 方式二: 本地运行 ----------
echo "[1/3] 未检测到 Docker，使用本地运行模式..."
echo ""

# --- 后端 ---
echo "[2/3] 启动后端 (FastAPI)..."
cd "$(dirname "$0")/backend"

# 检查 Python 依赖
if ! python3 -c "import fastapi" &> /dev/null; then
    echo "  安装后端依赖..."
    pip install -e ".[dev]" --break-system-packages
fi

# 复制 .env 如果不存在
if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || true
    echo "  已创建 .env (Mock 模式，无需 LLM 密钥)"
fi

# 启动后端 (后台)
uvicorn mathweaver.api.app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "  后端已启动 (PID: $BACKEND_PID) → http://localhost:8000"

# --- 前端 ---
echo "[3/3] 启动前端..."
cd "$(dirname "$0")/frontend"

# 检查 node_modules
if [ ! -d node_modules ]; then
    echo "  安装前端依赖..."
    npm install
fi

# 如果 dist 不存在，先构建
if [ ! -d dist ]; then
    echo "  构建前端..."
    npm run build
fi

# 启动预览服务器
npx vite preview --host 0.0.0.0 --port 3000 &
FRONTEND_PID=$!
echo "  前端已启动 (PID: $FRONTEND_PID) → http://localhost:3000"
echo ""
echo "════════════════════════════════════════════"
echo "  MathWeaver 已启动！"
echo "  前端: http://localhost:3000"
echo "  后端: http://localhost:8000"
echo "  API 文档: http://localhost:8000/docs"
echo "════════════════════════════════════════════"
echo ""
echo "按 Ctrl+C 停止所有服务..."

# 捕获退出信号
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
