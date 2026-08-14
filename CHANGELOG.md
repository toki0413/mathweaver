# Changelog

All notable changes to MathWeaver will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] - 2026-08-14

### Added — 会话沉淀与分享
- **导出学习快照**：`exportSnapshot` 将整段会话渲染为自包含 HTML（内联 CSS、零外部依赖），经 `file:export-html` IPC 保存到本地，可离线阅读。新增 `src/utils/exportSnapshot.ts` 与单测
- **一键分享链接**：`shareLink` 把会话数据编码为 `mathweaver://share/` 深链，一键复制随时展开。新增 `src/utils/shareLink.ts`、store `getShareUrl` action 与单测
- **主题课程生成**：`courseGenerator` 输入任意数学主题，经 LLM 产出带先修关系的概念 DAG，校验后合并进课程图谱。新增 `electron/backend/generator/courseGenerator.ts`、`api:generate-course` IPC 与单测
- 新增 E2E 测试 `gap-fill-features.spec.ts` 覆盖以上三条链路

## [0.4.5] - 2026-08-11

### Fixed — 产业级发布差距修复
- 修复 Webgazer 资源路径：`electron-builder.yml` 中 `webgazer.all.js` 不存在，改为指向 `webgazer.js`（webgazer@2.0.1 实际入口），眼动追踪功能在打包后可用
- CI 移除 `desktop-e2e` job 的 `continue-on-error: true`，E2E 测试现在为阻断性
- Release workflow `ci-gate` 加入 E2E 测试 + 无障碍审计，发布前必须通过

### Added — 产业级基础设施
- 代码签名基础设施：CI/CD build job 注入 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`，证书存在时自动签名 + macOS 公证
- 崩溃监控：集成 Electron `crashReporter`（native crash 收集，支持远程上传）+ `render-process-gone` / `unresponsive` / `responsive` 渲染进程状态监控
- 性能监控：`did-finish-load` 事件记录启动耗时到日志
- 无障碍 CI 审计：独立 a11y 测试步骤 + HTML 报告上传（30 天保留）
- 隐私政策文档 `PRIVACY.md`：本地数据存储说明、第三方数据传输说明、崩溃报告策略、数据删除指南

### Changed — 质量门槛提升
- 覆盖率阈值从 35% 提升至 40%（statements 40 / branches 38 / functions 42 / lines 40）
- Release CI Gate 使用 `test:coverage` 替代 `test`，强制检查覆盖率
- CI 工作流 E2E 测试改为阻断性，失败即阻止 CI 通过

## [0.4.4] - 2026-08-08

### Added — 数学建模实验室 + GeoChat 设计理念集成
- 新增「建模」模式（`ModelingLab.tsx`）：第五个主模式标签页，画板优先布局
  - 5 个数学模型预设：Lotka-Volterra 捕食-被捕食、SIR 传染病、阻尼谐振子、Logistic 增长、Cayley 图可视化
  - 实时参数滑块：拖动即更新，无需刷新（RK4 数值积分）
  - 预测-验证循环：先预测参数变化结果，再绘图验证对比
  - 「解释数学路径」面板：每次参数变化生成结构化解释（构造 + 推理 + 参数效应）
  - 运行快照 (Run Ledger)：记录参数历史，支持回放与对比
  - Cayley 图模型直接连接群论核心：节点=群元素，边=生成元乘法
- 新增 `ModelIcon` 图标（`Icons.tsx`）
- 新增 E2E 测试：建模模式画布渲染 + 参数滑块 + Cayley 图切换
- 集成 GeoChat (tiwe0/GeoChat) 设计理念：
  - 画板优先 (Canvas first)：可视化是主工作区，控件框定而非争夺注意力
  - 解释数学路径：每个输出包含构造 + 推理 + 工具活动三件套
  - 可验证构造：模型从结构化定义生成，而非自由发挥
  - 运行快照入账：每步参数变化可回溯

### Added — 水墨宣纸主题 (ink-wash)
- 桌面端 `index.css` `:root` 全面切换为水墨色板：
  - 宣纸底色（#f5f0e6 / #faf6ed / #e8e0d0）
  - 墨分五色文字层级（浓墨 #1a1a1a / 重墨 #3d3d3d / 淡墨 #6b6b6b / 清墨 #8a8a8a）
  - 朱砂红强调色（#c4392f）+ 竹绿语义色（#4a7c59）+ 青黛蓝辅助色（#5c6b8c）
  - 宋体为主字体栈（Noto Serif SC / Songti SC / STSong）
  - 极淡墨影阴影 + 宣纸纹理背景
  - Grill 提示色同步更新为水墨语义
- Pitch 端新增 `ink-wash.css` 主题并设为默认
- Kids 模式保留独立亮色主题覆盖（不随主主题变化）

### Changed — 技术债务清理
- **移除 Lean 形式化证明集成**：Lean 过重，L3 层统一替换为「LLM + 启发式验证」
  - `forge.py` / `forge.ts`：`L3_LLM_LEAN` → `L3_LLM_HEURISTIC`，值改为 `"L3: LLM + heuristic verify"`
  - `test_forge.py` / `forge.test.ts`：同步更新断言与引用
  - README.md、pitch HTML、proposal HTML、docs/*.md：所有 Lean 架构引用替换为启发式验证
  - 竞品对比表中 `Lean / Coq` 列保留（作为竞品参照）
- 提取 KaTeX/DOMPurify 渲染逻辑为共享工具模块 `utils/katex-render.ts`，消除 `MathText.tsx` 与 `FormulaLiveEditor.tsx` 间的重复代码
- 合并重复的 `electron.d.ts` 类型声明为单一 `types/electron.d.ts`，消除 `window.api` 与 `window.electronAPI` 的类型冲突
- 修复 `performance.ts` 中 React 导入位置（从文件中部移至顶部）
- 将 `performance.ts` 中 `console.log` 调试输出降级为 `console.debug`，减少生产环境控制台噪音
- 将 `electron-store` 从 devDependencies 移至 dependencies（生产代码依赖该包）
- 修复 CI/CD `release.yml` 中 `electron-builder` 与 `softprops/action-gh-release` 双重发布冲突（添加 `--publish never`）
- 运行 `npm audit fix` 修复自动可修复的安全漏洞

### Added — 安全与配置测试覆盖
- 新增 `crypto.test.ts`：加密模块单元测试（encrypt/decrypt 往返、向后兼容、错误处理、机器 ID 持久化）
- 新增 `config.test.ts`：配置模块单元测试（环境变量访问器、LLM 配置、双前缀支持）

### Fixed
- 清理 `App.tsx` 中 8 个未使用的图标导入（TrophyIcon、SparkleIcon、GraduationIcon、CrownIcon、BookIcon、CheckIcon、TrashIcon、InfoIcon）
- 移除 `ErrorBoundary.tsx` 中未使用的 `React` 默认导入
- 修复 `ImageInput.tsx` 中 `any` 类型与 `@ts-ignore` 指令：使用类型断言替代 `any`，使用 `as unknown as` 替代 `@ts-ignore`
- 修复 `FormulaLiveEditor.tsx` 中重复的 DOMPurify 净化逻辑（现由共享模块统一处理）

### Added
- 添加 `LICENSE` 文件（Apache-2.0）
- 添加 `CHANGELOG.md` 变更日志

## [0.4.3] - 2026-08-08

### Added
- 核心模块单元测试覆盖（crypto / config 等）
- E2E 测试修复与完善

### Changed
- CI Gate 流水线强化：typecheck / lint / format:check / unit / build 全量门禁

## [0.4.2] - 2026-08-04

### Fixed
- 错误恢复机制全面优化
- 加载状态（loading states）完善
- 空状态（empty states）UI 改进

## [0.4.1] - 2026-08-04

### Changed
- UI/UX 全面打磨
- 无障碍 (a11y) 改进
- 内容真实性修复

## [0.4.0] - 2026-08-02

### Added — 多模型 LLM 接入
- 支持 DeepSeek / OpenAI / Claude / Gemini / Kimi / GLM / Ollama 等多家 LLM 提供商
- OpenAI 兼容协议统一接入
- 环境变量双前缀支持（`LLM_*` / `MATHWEAVER_LLM_*`）

## [0.3.1] - 2026-07-31

### Fixed
- 修复桌面端 CI 失败：TypeScript 类型检查 + ESLint + 格式化
- 提交遗漏的 E2E 测试修复，E2E 设为非阻塞

### Changed
- 重构 pitch 文件：新增质量与可靠性专页，更新统计数据

## [0.3.0] - 2026-07-25

### Added — Phase 3 高级功能
- Three.js 3D 对称群可视化（`SymmetryGroup3D.tsx`）：S4 置换立方体 + A5 二十面体交互探索
- Manim 动画播放器（`ManimPlayer.tsx`）：预置动画目录 + 播放控制
- 眼动追踪认知负荷面板（`EyeTrackingPanel.tsx`）：注视热力图 + 注意力分析
- 图片 OCR 输入（`ImageInput.tsx`）：基于 Tesseract.js 的数学题图片识别
- 语音输入（`VoiceInput.tsx`）：Web Speech API 实时转写
- 数学符号面板（`MathSymbolPalette.tsx`）：常用 LaTeX 符号快捷输入
- 公式实时编辑器（`FormulaLiveEditor.tsx`）：LaTeX 源码 + KaTeX 实时预览
- 可视化分步求解器（`VisualStepSolver.tsx`）
- 课程映射器（`CurriculumMapper.tsx`）：跨课程结构对照
- 闪卡复习系统（`FlashcardSystem.tsx`）
- 白板（`WhiteboardPad.tsx`）+ 模式构建器（`PatternBuilder.tsx`）
- 命令面板（`CommandPalette.tsx`）+ 快捷键系统（`ShortcutsOverlay.tsx`）
- 成就系统（`AchievementSystem.tsx`）+ Toast 通知（`ToastSystem.tsx`）
- 引导覆盖层（`OnboardingOverlay.tsx`）+ 设置面板（`SettingsPanel.tsx`）
- ErrorBoundary 全局错误边界 + 性能监控工具（`performance.ts`）
- 国际化支持（7 种语言：中/英/日/韩/德/法/西）
- 交互式探索器（`InteractiveExplorer.tsx`）：运算表 → 群性质自动检测
- 代码分割（React.lazy + Suspense）：重型组件按需加载

### Changed
- 桌面端从 15+ 组件扩展到 30+ React 组件
- 支持懒加载减少初始 JS 传输量
- 统一 CSS 变量主题系统

### Infrastructure
- CI 流水线（`.github/workflows/ci.yml`）：lint / test / build
- Release 流水线（`.github/workflows/release.yml`）：跨平台构建 + GitHub Release
- E2E 测试套件：无障碍 / 视觉回归 / 性能 / 错误韧性 / API 契约 / 响应式

## [0.2.1] - 2026-07-24

### Infrastructure
- 为所有平台添加 zip 打包目标
- 启用 asar 打包 + npmRebuild

## [0.2.0] - 2026-07-10

### Added — Phase 2 桌面应用
- Electron 桌面应用（main / preload / renderer 三进程架构）
- 安全最佳实践：contextIsolation 开启、nodeIntegration 关闭、sandbox 模式
- IPC 桥接：菜单保存/加载会话、设置、引导
- 本地 SQLite 数据持久化

### Changed
- 前端从纯 Web 扩展为 Electron 桌面 + Web 双端
- Zustand 状态管理引入会话持久化

## [0.1.0] - 2026-06-28

### Added — 初始发布
- 七 Agent 架构（Perception / Abstraction / CounterExample / Epistemic / Historical / Meta / Collaboration）
- 四场耦合引擎（知识场 / 认知场 / 情感场 / 交互场）
- 五种教学决策（reduce_abstraction / emotional_support / advance / guided_discovery / provide_hint）
- Z3 反例工坊四层 Fallback（L1 验证 / L1 搜索 / L2 LLM+Z3 / L4 LLM-only）
- 概念 DAG（193 节点，8 课程层级）
- Grill 自适应难度训练（五 band：warmup → challenge）
- 证明助手（苏格拉底提示 + 逐步验证 + 贪心多匹配）
- 猜想处理器（提取 → 检验 → 裁决 → 追问）
- Historical Agent（BM25 检索 + 叙事编织）
- FastAPI REST + WebSocket 实时教学
- React + TypeScript 前端
- Docker Compose 一键部署
- 后端单元测试（7 文件，352 测试）

---

*教育内容（课程数据、文档）采用 CC BY-SA 4.0 许可。*
