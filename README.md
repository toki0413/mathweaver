# MathWeaver

多智能体数学认知操作系统 - 群论发现式学习 Demo

## 架构

```
mathweaver/
├── desktop/                 # Electron 桌面应用（v0.3.0 主前端，含内嵌 TypeScript 后端）
│   ├── src/                 # React + TypeScript UI（Cayley表 / 四场仪表盘 / 聊天 / DAG树 …）
│   ├── electron/            # 主进程 + preload + 内嵌后端（agents / dag / forge / orchestrator …）
│   ├── tests/               # 单元测试 + Playwright e2e
│   └── package.json
├── backend/                 # Python FastAPI 后端（可选 · 开发模式）
│   ├── mathweaver/
│   │   ├── models/          # 四场状态域模型
│   │   ├── orchestrator/    # 四场耦合引擎 + 状态机
│   │   ├── agents/          # 七 Agent 基类
│   │   ├── counterexample/  # 反例工坊（四层 Fallback）
│   │   ├── dag/             # 数学概念 DAG（群论种子）
│   │   └── api/             # FastAPI REST + WebSocket
│   ├── tests/               # 单元测试
│   ├── Dockerfile           # 后端容器镜像（多阶段构建）
│   ├── .dockerignore
│   └── pyproject.toml
├── docs/                    # 设计文档与截图
├── docker-compose.yml       # 一键部署（Python 后端容器，开发模式）
├── .dockerignore
└── .github/workflows/ci.yml # CI：lint / test / build
```

> 说明：`desktop/` 是 v0.3.0 起的唯一前端入口（Electron 桌面应用，自带内嵌后端，可独立运行）。
> `backend/`（Python FastAPI）为可选的开发模式，用于服务端联调或容器化部署，普通使用无需启动。

## 快速启动

```bash
cd desktop
npm install
npm run dev
```

启动后 Electron 桌面应用窗口将自动打开，默认使用内嵌后端 + Mock LLM，无需额外配置即可体验。

## Docker 部署（可选 · Python 后端开发模式）

> 前置条件：已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose v2（`docker compose` 命令）。
>
> MathWeaver 的主入口是 `desktop/` 桌面应用（见上文「快速启动」）。Docker 仅用于在容器中运行可选的 Python FastAPI 后端（开发模式 / 服务端联调）。

```bash
# 1. 配置 LLM 密钥（可先保持 mock 模式直接体验，无需真实密钥）
cp backend/.env.example backend/.env

# 2. 构建并启动 Python 后端服务
docker compose up --build
```

启动后即可访问：

| 服务 | 地址 |
|------|------|
| 后端 API | http://localhost:8000 |
| 健康检查 | http://localhost:8000/api/health |
| API 文档（Swagger） | http://localhost:8000/docs |

说明：
- 后端 SQLite 数据库通过 volume 持久化到宿主机 `backend/data/` 目录。
- 停止服务：`docker compose down`；修改代码后重新构建：`docker compose up --build`。
- UI 请使用 `desktop/` 桌面应用（`npm run dev`），不再提供独立的前端容器。

## 核心功能

### 反例工坊（四层 Fallback）

- **L1**: 暴力枚举直接验证 Cayley 表的群公理（结合律/单位元/逆元/交换律）
- **L1 搜索**: 暴力枚举自动搜索非结合运算（反例发现）
- **L2-L4**: LLM + 暴力枚举验证 / LLM + 启发式验证 / LLM-only（框架已就绪）

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

### 会话沉淀与分享（v0.5.1）

- **导出学习快照** — 将整段会话渲染为自包含 HTML（内联 CSS、零外部依赖），可离线保存、独立阅读
- **一键分享链接** — 会话数据编码为 `mathweaver://share/` 深链，一键复制、随时展开
- **主题课程生成** — 输入任意数学主题，LLM 自动产出带先修关系的概念 DAG 并合并进课程图谱

## 设计哲学与理论根基

MathWeaver 的设计植根于两条理论脉络：

- **新数学运动的历史反思** — Bourbaki 结构主义教育实验 (1958–1975) 的失败教训。详见 [`docs/new-math-reflection.md`](docs/new-math-reflection.md)
- **数学思维能力的六维框架** — 基于 ER Bem《数学思维能力的训练》(1985) 的六种核心思维能力（分析、设想、归纳、模拟、类比、逻辑推理），映射到 MathWeaver 的七 Agent 架构。详见 [`docs/thinking-abilities-framework.md`](docs/thinking-abilities-framework.md)

核心信条：**"结构是终点，不是起点。"** 先让学习者在具体问题中获得直觉，再用形式化工具帮助他们看见直觉背后的结构。

## API 端点

> 以下端点属于可选的 Python 后端（开发模式）。Electron 桌面应用使用内嵌后端，无需调用这些接口。

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/dag` | 概念 DAG 节点 |
| POST | `/api/session/start` | 启动教学会话 |
| GET | `/api/session/state` | 四场状态快照 |
| POST | `/api/session/input` | 处理学生输入 |
| POST | `/api/forge/verify-group` | 验证 Cayley 表群公理 |
| POST | `/api/forge/find-non-associative` | 暴力枚举搜索非结合运算 |
| WS | `/ws/teach` | WebSocket 实时教学 |

## 许可证

Apache 2.0 (核心框架) + CC BY-SA 4.0 (教育内容)
