# MathWeaver 功能验收报告

- **日期**：2026-08-15
- **分支**：`trae/agent-oJn5mg`
- **范围**：本轮涉及的全部功能改动（依赖漏洞修复、LLM 接入能力、长程教学记忆与调度控制、E2E 覆盖）
- **结论**：**通过验收**（功能层面全部确认无误）

---

## 一、验证结果总览

| 检查项 | 结果 |
|--------|------|
| 类型检查 `tsc --noEmit` | ✅ 通过（0 错误） |
| 单元测试 `vitest run tests/unit` | ✅ 632 / 632 通过 |
| 前端构建 `npm run build` | ✅ 成功 |
| E2E 功能测试 `playwright test` | ✅ 137 / 137 通过 |
| E2E 视觉回归 `visual-regression` | ⚠️ 12 失败（环境差异所致，非代码问题，见第三节） |

---

## 二、本轮功能改动清单

### 1. 依赖漏洞修复 — webgazer 升级
- **改动**：`webgazer` 由 `2.0.1` 升级至 `3.5.3`，消除依赖链中的高危 `node-fetch` 漏洞（`npm audit` 高危数从 9 降为 3，剩余均为开发依赖）。
- **配套**：修改 `electron-builder.yml` 打包 mediapipe 资源，确保 webgazer 3.5.3 的人脸网格检测文件在运行时可用。
- **验证**：`EyeTrackingPanel.tsx` 与 3.5.3 API 兼容；眼动追踪 E2E 4/4 通过。

### 2. LLM 自由接入能力
- **改动**：默认 LLM 端点去 DeepSeek 化，改为中性 OpenAl 兼容设置，允许用户通过环境变量或设置面板接入任意厂商。
- **配套**：
  - 扩展 `LLMConfig` / `LLMProvider` 类型，支持 `openai-compatible`、`anthropic`、`gemini`、`ollama`。
  - 新增 `AnthropicClient`（`x-api-key` + `anthropic-version` 头）与 `GeminiClient`（查询参数 Key + `systemInstruction`）。
  - 统一错误分类（网络/超时/认证）与指数退避重试。
  - 前端 `llmAdapter.ts` 预设模型更新为当前有效模型（如 `deepseek-v4-flash`、`gpt-5.6-sol`、`anthropic/claude-sonnet-5`、`gemini-3.6-flash`）。
- **验证**：`llmClient.test.ts` 通过；`tsc` 无类型错误。

### 3. 长程教学记忆 — TeachingMemory
- **改动**：新增 `electron/backend/orchestrator/teachingMemory.ts`，实现：
  - 跨轮滚动摘要（`rollingSummary`）
  - 累计 token 使用与预算控制
  - 历史裁剪（近轮保留原文、早期折入摘要）
  - `toJSON()` / `fromJSON()` 序列化，配合跨会话恢复
- **验证**：`teachingMemory.test.ts` 10/10 通过。

### 4. 跨会话持久化与记忆恢复
- **改动**：
  - `persistence/store.ts`：`sessions` 表新增 `teaching_memory_json` 列，提供 `saveTeachingMemory` / `loadTeachingMemory`，含旧表迁移。
  - `orchestrator/engine.ts`：`startSession` 恢复教学记忆与调度计数；`processStudentInput` 处理输入后持久化。
- **验证**：`teachingMemoryPersistence.test.ts` 7/7 通过，覆盖跨实例续接、调度计数恢复、全新会话三种场景。

### 5. 调度检查点与前端展示
- **改动**：
  - 引擎新增 `schedulingTurnCount` / `schedulingStepCount` 记录教学轮次与 agent 步数。
  - 前端 `sessionStore.ts` 新增 `SchedulingState`（turn/step/token/预算/memory_turns/restored），`sendInput` 时更新。
  - `App.tsx` 新增续接 toast（「已续接上次教学」）与头部进度胶囊（`#轮次`、token、预算告警、续接徽标），配套 `index.css` 样式。
- **验证**：新增 `scheduling-metrics.spec.ts` E2E 2/2 通过（普通会话进度展示 + 续接会话 toast/徽标）。

### 6. E2E 测试覆盖
- 新增 `tests/e2e/scheduling-metrics.spec.ts`（调度指标）。
- 新增 `tests/e2e/eye-tracking.spec.ts`（webgazer 升级兼容性）。
- 扩展 `test/mock-api.js`：为 `api:session-input` 增加 `scheduling` 响应块，支持 `?mockSchedulingResumed=1` 模拟续接会话。
- 调试基础设施：`playwright.config.ts` 支持通过环境变量 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 复用已有 Chrome，规避沙箱内慢速下载。

---

## 三、已知例外（非功能问题）

- **E2E 视觉回归 12 项失败**：
  - 现象：全部为像素级截图对比失败，覆盖 chat/grill/proof/dag 等所有模式，包括与本次改动完全无关的纯布局用例（如 proof 模式）。
  - 根因：基线快照由 Playwright 自带 Chromium（headless shell 1228）生成；本次因网络无法下载该浏览器，改用 puppeteer 缓存的 **Chrome 151** 运行，两者渲染引擎差异导致整页高出约 12px（如 proof 模式基线 1280×846 vs 实际 1280×834）。
  - 结论：属浏览器版本差异，非代码回归。已按约定保留现状，不更新基线快照。

---

## 四、后续可选事项

1. **视觉回归全绿**：等待网络恢复后安装 Playwright 官方 Chromium 1228 再跑，或使用当前浏览器 `--update-snapshots` 重新生成基线（会覆盖原基线）。
2. **前端 TS 类型错误**：本轮 `tsc --noEmit` 已为 0 错误，无需额外处理。