# MathWeaver

多智能体数学认知操作系统 - 群论发现式学习 Demo

## 架构

```
mathweaver/
├── backend/                 # Python FastAPI 后端
│   ├── mathweaver/
│   │   ├── models/          # 四场状态域模型
│   │   ├── orchestrator/    # 四场耦合引擎 + 状态机
│   │   ├── agents/          # 六 Agent 基类
│   │   ├── counterexample/  # Z3 反例工坊（四层 Fallback）
│   │   ├── dag/             # 数学概念 DAG（群论种子）
│   │   └── api/             # FastAPI REST + WebSocket
│   ├── tests/               # 单元测试
│   ├── Dockerfile           # 后端容器镜像（多阶段构建）
│   ├── .dockerignore
│   └── pyproject.toml
├── frontend/                # React + TypeScript 前端
│   ├── src/
│   │   ├── components/      # Cayley表 / 四场仪表盘 / 聊天 / DAG树
│   │   └── stores/          # Zustand 状态管理
│   ├── Dockerfile           # 前端容器镜像（Node 构建 + nginx 运行）
│   └── nginx.conf           # 静态托管 + API/WebSocket 反向代理
├── desktop/                 # Electron 桌面应用
├── docker-compose.yml       # 一键部署（后端 + 前端）
├── .dockerignore
└── .github/workflows/ci.yml # CI：lint / test / build
```

## Quick Start with Docker（Docker 一键部署）

> 前置条件：已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose v2（`docker compose` 命令）。

```bash
# 1. 配置 LLM 密钥（可先保持 mock 模式直接体验，无需真实密钥）
cp backend/.env.example backend/.env

# 2. 构建并启动所有服务（后端 + 前端）
docker compose up --build
```

启动后即可访问：

| 服务 | 地址 |
|------|------|
| 前端 Web UI | http://localhost:3000 |
| 后端 API | http://localhost:8000 |
| 健康检查 | http://localhost:8000/api/health |
| API 文档（Swagger） | http://localhost:8000/docs |

说明：
- 后端 SQLite 数据库通过 volume 持久化到宿主机 `backend/data/` 目录。
- 前端容器使用 nginx 反向代理 `/api` 与 `/ws` 到后端，浏览器访问 `http://localhost:3000` 即可正常调用后端接口（无需关心跨域）。
- 停止服务：`docker compose down`；修改代码后重新构建：`docker compose up --build`。

## 快速启动

### 后端

```bash
cd backend
pip install -e ".[dev]" --break-system-packages
python -m pytest tests/ -v          # 运行测试
uvicorn mathweaver.api.app:app --host 0.0.0.0 --port 8000
```

### 前端

```bash
cd frontend
npm install
npx vite --host 0.0.0.0 --port 5173
```

打开 http://localhost:5173

## 核心功能

### 反例工坊 (Z3 四层 Fallback)

- **L1**: Z3 直接验证 Cayley 表的群公理（结合律/单位元/逆元/交换律）
- **L1 搜索**: Z3 自动搜索非结合运算（反例发现）
- **L2-L4**: LLM + Z3 / LLM + Lean / LLM-only（框架已就绪）

### 四场耦合引擎

- **知识场**: ZPD 灰色区域模型 (p∈[0.4,0.6])
- **认知场**: 响应时延 z-score → 认知负荷估计
- **情感场**: 焦虑指数 + 心流分数 → 情感状态
- **交互场**: 提示等级 + 脚手架淡出 → 挣扎检测

### 五种教学决策

1. `reduce_abstraction` - 认知过载时降低抽象层级
2. `emotional_support` - 焦虑时提供情感支持
3. `advance` - 心流状态且掌握度达标时推进
4. `guided_discovery` - ZPD 区域内继续引导发现
5. `provide_hint` - 挣扎时提供分级提示

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/dag` | 概念 DAG 节点 |
| POST | `/api/session/start` | 启动教学会话 |
| GET | `/api/session/state` | 四场状态快照 |
| POST | `/api/session/input` | 处理学生输入 |
| POST | `/api/forge/verify-group` | 验证 Cayley 表群公理 |
| POST | `/api/forge/find-non-associative` | Z3 搜索非结合运算 |
| WS | `/ws/teach` | WebSocket 实时教学 |

## 许可证

Apache 2.0 (核心框架) + CC BY-SA 4.0 (教育内容)
