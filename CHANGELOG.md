# Changelog

All notable changes to MathWeaver will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed
- 清理 `App.tsx` 中 8 个未使用的图标导入（TrophyIcon、SparkleIcon、GraduationIcon、CrownIcon、BookIcon、CheckIcon、TrashIcon、InfoIcon）
- 移除 `ErrorBoundary.tsx` 中未使用的 `React` 默认导入
- 修复 `ImageInput.tsx` 中 `any` 类型与 `@ts-ignore` 指令：使用类型断言替代 `any`，使用 `as unknown as` 替代 `@ts-ignore`
- 修复 `FormulaLiveEditor.tsx` 中重复的 DOMPurify 净化逻辑（现由共享模块统一处理）

### Added
- 添加 `LICENSE` 文件（Apache-2.0）
- 添加 `CHANGELOG.md` 变更日志

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
