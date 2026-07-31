#!/bin/bash
# MathWeaver 一键启动脚本
# 用法: ./START_HERE.sh

set -e

echo "════════════════════════════════════════════"
echo "  MathWeaver 一键启动"
echo "════════════════════════════════════════════"
echo ""

# ---------- 方式一: Docker（仅启动可选的 Python 后端） ----------
if command -v docker &> /dev/null && command -v docker compose &> /dev/null; then
    echo "[1/1] 检测到 Docker，使用 Docker 部署 Python 后端（开发模式）..."
    echo ""
    echo "  后端 API:  http://localhost:8000"
    echo "  API 文档:  http://localhost:8000/docs"
    echo "  Web UI:    请另开终端运行  cd desktop && npm install && npm run dev"
    echo ""
    docker compose up --build
    exit 0
fi

# ---------- 方式二: 本地运行（desktop/ Web 模式） ----------
echo "[1/2] 未检测到 Docker，使用本地运行模式..."
echo ""

# --- 桌面应用（Web 模式，内嵌后端） ---
echo "[2/2] 启动 desktop/ Web 模式..."
cd "$(dirname "$0")/desktop"

# 检查 node_modules
if [ ! -d node_modules ]; then
    echo "  安装依赖..."
    npm install
fi

echo ""
echo "════════════════════════════════════════════"
echo "  MathWeaver 启动中..."
echo "  Web UI:  http://localhost:5175"
echo "  按 Ctrl+C 停止服务"
echo "════════════════════════════════════════════"
echo ""

# 启动 Web 开发服务器（前台运行，默认 Mock LLM，无需额外配置）
npm run dev:web
