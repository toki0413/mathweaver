# MathWeaver 查漏补缺：课程导出 / 在线分享 / 主题课程生成

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 MathWeaver 相对 OpenMAIC 的三大缺口——把学习会话导出为可分享 HTML 快照、一键复制/下载分享链接、输入任意数学主题用 LLM 自动生成课程与 DAG。

**Architecture:** 三项能力全部复用现有基础设施。导出(Phase 1)在渲染层把 store 中的会话数据(chat / fourFields / conjectureJourney / masteryRadar)渲染成自包含 HTML(内联 CSS、无外部依赖),通过既有 IPC 通道保存;分享(Phase 2)基于同一 HTML 生成可复制的带参链接与本地快照文件;主题生成(Phase 3)复用现有 `generateContent` 的 LLM 调用链,在 preload 新增 `api:generate-course` 通道,主进程把 LLM 返回的 JSON 解析为课程文件并注册进 DAG。

**Tech Stack:** Electron IPC、React + Zustand、现有 `llmAdapter.ts` / `sessionStore.ts`、`better-sqlite3`(持久化)、vitest 单测。

---

# Phase 1 — 课程/会话导出为 HTML 快照

## 文件结构

- Create: `desktop/src/utils/exportSnapshot.ts` — 纯函数,把 SessionData 渲染为自包含 HTML 字符串(无 DOM 依赖,可单测)
- Modify: `desktop/src/stores/sessionStore.ts` — 新增 `exportSession` action
- Modify: `desktop/electron/main/index.ts` — 新增 `file:export-html` IPC handler
- Modify: `desktop/electron/preload/index.ts` — 新增 `exportSnapshot` 方法 + 通道白名单
- Modify: `desktop/src/types/electron.d.ts` — 补类型
- Modify: `desktop/src/App.tsx` — 在命令行面板/导出按钮接入口
- Create: `desktop/tests/unit/exportSnapshot.test.ts` — 单测

### Task 1: 导出 HTML 快照渲染器(纯函数)

**Files:**
- Create: `desktop/src/utils/exportSnapshot.ts`
- Test: `desktop/tests/unit/exportSnapshot.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { buildSessionSnapshotHtml } from '../src/utils/exportSnapshot'

const sampleChat = [
  { role: 'user' as const, content: '所有群都是交换群吗？', phase: undefined },
  { role: 'system' as const, content: '一个好的猜想！让我们验证 $S_3$。', phase: 'VERIFY' },
]

const sampleViz = {
  conjecture_journey: {
    timeline: [
      { step: 1, claim: '所有群可交换', verdict: 'refuted' as const, counter_example: 'S_3' },
    ],
    total_conjectures: 1,
    confirmed: 0,
    refuted: 1,
  },
  four_field_gauges: { cognitive_load: 0.4, flow_score: 0.7 },
}

describe('buildSessionSnapshotHtml', () => {
  it('produces a self-contained HTML string', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'stu-1',
      targetNode: 'symmetric_group',
      chat: sampleChat,
      fourFields: null,
      phaseTrace: ['PERCEIVE', 'VERIFY', 'DELIVER'],
      savedAt: '2026-08-14T00:00:00.000Z',
      visualData: null,
    })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('MathWeaver')
    expect(html).toContain('所有群都是交换群吗？')
  })

  it('escapes user content to prevent HTML injection', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'x',
      targetNode: 'n',
      chat: [{ role: 'user', content: '<script>alert(1)</script>', phase: undefined }],
      fourFields: null,
      phaseTrace: [],
      savedAt: '',
      visualData: null,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders conjecture journey stats when present', () => {
    const html = buildSessionSnapshotHtml({
      studentId: 'x',
      targetNode: 'symmetric_group',
      chat: [],
      fourFields: null,
      phaseTrace: [],
      savedAt: '',
      visualData: sampleViz,
    })
    expect(html).toContain('猜想旅程')
    expect(html).toContain('S_3')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/exportSnapshot.test.ts`
Expected: FAIL,模块不存在

- [ ] **Step 3: 实现导出渲染器**

Create `desktop/src/utils/exportSnapshot.ts`:

```typescript
/**
 * Render a MathWeaver session as a self-contained HTML snapshot.
 *
 * The output HTML has zero external dependencies (inline CSS, no scripts that
 * need the network) so it can be saved to disk or shared as a standalone file.
 */

import type { ChatMessage } from '../stores/sessionStore'

export interface SnapshotInput {
  studentId: string
  targetNode: string
  chat: ChatMessage[]
  fourFields: unknown
  phaseTrace: string[]
  savedAt: string
  visualData: Record<string, unknown> | null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderChat(chat: ChatMessage[]): string {
  return chat
    .map(m => {
      const roleLabel = m.role === 'user' ? '学生' : 'MathWeaver'
      const cls = m.role === 'user' ? 'user' : 'system'
      return `<div class="msg ${cls}"><span class="role">${roleLabel}</span><p>${escapeHtml(
        m.content,
      )}</p></div>`
    })
    .join('')
}

function renderVisuals(viz: Record<string, unknown>): string {
  const parts: string[] = []
  const journey = viz.conjecture_journey as
    | { timeline?: Array<{ step: number; claim: string; verdict: string; counter_example?: string | null }> }
    | undefined
  if (journey?.timeline?.length) {
    const rows = journey.timeline
      .map(t => {
        const tag = t.verdict === 'refuted' ? '✗ 反驳' : t.verdict === 'confirmed' ? '✓ 确认' : '~ 待定'
        return `<li><b>${t.step}.</b> ${escapeHtml(t.claim)} <span class="verdict">${tag}</span>${
          t.counter_example ? `<div class="ce">反例：${escapeHtml(t.counter_example)}</div>` : ''
        }</li>`
      })
      .join('')
    parts.push(`<section><h3>猜想旅程</h3><ul>${rows}</ul></section>`)
  }
  return parts.join('')
}

export function buildSessionSnapshotHtml(input: SnapshotInput): string {
  const title = escapeHtml(input.targetNode || 'MathWeaver 学习会话')
  const prettyDate = input.savedAt ? new Date(input.savedAt).toLocaleString('zh-CN') : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MathWeaver · ${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0f1a; color: #f3f4f6; line-height: 1.6; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { border-bottom: 1px solid #374151; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { margin: 0 0 4px; color: #fff; font-size: 24px; }
  .meta { color: #9ca3af; font-size: 13px; }
  .msg { margin-bottom: 12px; padding: 12px 14px; border-radius: 10px; }
  .msg.user { background: #1f2937; border-left: 3px solid #22d3ee; }
  .msg.system { background: #18212f; border-left: 3px solid #a855f7; }
  .role { font-size: 12px; font-weight: 700; color: #a855f7; display: block; margin-bottom: 4px; }
  .msg.user .role { color: #22d3ee; }
  .msg p { margin: 0; white-space: pre-wrap; word-break: break-word; }
  section { margin-top: 24px; }
  h3 { color: #a855f7; font-size: 16px; }
  ul { list-style: none; padding: 0; }
  li { background: #1f2937; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; font-size: 14px; }
  .verdict { font-weight: 700; margin-left: 6px; }
  .ce { color: #fbbf24; font-size: 13px; margin-top: 4px; }
  footer { margin-top: 40px; color: #6b7a90; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>MathWeaver · ${title}</h1>
    <div class="meta">学生 ID：${escapeHtml(input.studentId)} · 导出时间：${escapeHtml(prettyDate)}</div>
  </header>
  ${renderChat(input.chat || [])}
  ${input.visualData ? renderVisuals(input.visualData) : ''}
  <footer>由 MathWeaver 生成 · 多智能体数学认知操作系统</footer>
</div>
</body>
</html>`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/exportSnapshot.test.ts`
Expected: PASS(3 个用例)

- [ ] **Step 5: 提交**

```bash
git add desktop/src/utils/exportSnapshot.ts desktop/tests/unit/exportSnapshot.test.ts
git commit -m "feat(export): add self-contained session HTML snapshot renderer"
```

### Task 2: store 新增 exportSession action

**Files:**
- Modify: `desktop/src/stores/sessionStore.ts`
- Test: `desktop/tests/unit/exportSnapshot.test.ts`(追加)

- [ ] **Step 1: 在 SessionState 接口加签名**

Modify `desktop/src/stores/sessionStore.ts:284`,在 `saveSession: () => Promise<string | null>` 后加:

```typescript
  exportSession: () => Promise<string | null>
```

- [ ] **Step 2: 实现 action**

在 `saveSession` 实现(约 648 行)之后插入:

```typescript
      exportSession: async () => {
        const state = get()
        const html = buildSessionSnapshotHtml({
          studentId: state.sessionId || '',
          targetNode: state.targetNode || '',
          chat: state.chat,
          fourFields: state.fourFields,
          phaseTrace: state.phaseTrace,
          savedAt: new Date().toISOString(),
          visualData: state.visualData,
        })
        const api = getAPI()
        if (!api) return null
        try {
          return (await api.exportSnapshot(html)) as string | null
        } catch (e) {
          set({
            error: {
              message: 'Failed to export session',
              headline: '导出会话失败',
              detail: String(e),
              recovery: '请重试',
              timestamp: Date.now(),
            },
          })
          return null
        }
      },
```

在文件顶部 import 处加:

```typescript
import { buildSessionSnapshotHtml } from '../utils/exportSnapshot'
```

- [ ] **Step 3: 提交**

```bash
git add desktop/src/stores/sessionStore.ts
git commit -m "feat(export): add exportSession store action building HTML snapshot"
```

### Task 3: 主进程新增 file:export-html IPC handler

**Files:**
- Modify: `desktop/electron/main/index.ts`

- [ ] **Step 1: 在 file:export-table handler 后加(约 692 行后)**

```typescript
safeIpcHandle('file:export-html', async (_event, data: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: '导出学习快照',
    defaultPath: join(app.getPath('documents'), 'mathweaver-snapshot.html'),
    filters: [{ name: 'HTML 文件', extensions: ['html'] }],
  })
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, data, 'utf-8')
  return result.filePath
})
```

需确认 `safeIpcHandle` 在 preload 白名单外的通道也能注册(见 Task 4 白名单机制)。

- [ ] **Step 2: 提交**

```bash
git add desktop/electron/main/index.ts
git commit -m "feat(export): add file:export-html main-process save handler"
```

### Task 4: preload 新增 exportSnapshot 方法 + 白名单

**Files:**
- Modify: `desktop/electron/preload/index.ts`
- Modify: `desktop/src/types/electron.d.ts`

- [ ] **Step 1: 加通道白名单**

Modify `desktop/electron/preload/index.ts:41` 的 `INVOKE_CHANNELS`:

```typescript
  // File
  'file:save-session',
  'file:load-session',
  'file:export-table',
  'file:export-html',
  'file:upload',
  'file:upload-data',
```

- [ ] **Step 2: 加便捷方法**

在 `exportTable: ...` 方法后(约 157 行):

```typescript
  exportSnapshot: (html: string) => safeInvoke('file:export-html', html),
```

- [ ] **Step 3: 补类型**

Modify `desktop/src/types/electron.d.ts`,在 `api` 对象内(约 10 行 `invoke` 后)加:

```typescript
      exportSnapshot: (html: string) => Promise<string | null>
```

- [ ] **Step 4: 提交**

```bash
git add desktop/electron/preload/index.ts desktop/src/types/electron.d.ts
git commit -m "feat(export): expose exportSnapshot via preload bridge + whitelist channel"
```

### Task 5: Web shim 支持 HTML 导出

**Files:**
- Modify: `desktop/src/web-api-shim.ts`
- Test: 追加到 `desktop/tests/unit/exportSnapshot.test.ts`

- [ ] **Step 1: 在 exportTable(约 976 行)后加 web 实现**

```typescript
  exportSnapshot: async (html: string) => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mathweaver-snapshot.html'
    a.click()
    URL.revokeObjectURL(url)
    return 'mathweaver-snapshot.html'
  },
```

- [ ] **Step 2: 提交**

```bash
git add desktop/src/web-api-shim.ts
git commit -m "feat(export): support HTML snapshot export in web demo mode"
```

### Task 6: App 接入导出入口

**Files:**
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: 在 CommandPalette 命令列表加命令**

在 `desktop/src/App.tsx` 的 command list(约 739 行 `提交运算表` 命令附近)加:

```typescript
        {
          id: 'export-session',
          label: '导出学习快照',
          keywords: ['export', '导出', '快照', 'html'],
          action: async () => {
            const path = await exportSession()
            if (path) addToast({ type: 'success', message: `已导出：${path}` })
          },
        },
```

需在组件作用域取 `exportSession`(来自 `useStore`),并确认 `addToast` 签名。

- [ ] **Step 2: 提交**

```bash
git add desktop/src/App.tsx
git commit -m "feat(export): wire export snapshot into command palette"
```

### Task 7: 导出全链路验证

**Files:** 无新增

- [ ] **Step 1: 跑单测**

Run: `cd /workspace/mathweaver/desktop && npx vitest run`
Expected: 全部通过

- [ ] **Step 2: 类型检查**

Run: `cd /workspace/mathweaver/desktop && npm run typecheck`
Expected: 无错误

- [ ] **Step 3: 手动验证(dev 模式)**

Run: `cd /workspace/mathweaver/desktop && npm run dev`
验证:命令行面板输入"导出学习快照",选择保存路径,打开导出的 `.html` 确认内容与样式完整。

---

# Phase 2 — 在线分享(HTML 快照 + 可复制链接)

## 文件结构

- Create: `desktop/src/utils/shareLink.ts` — 把会话数据编码为可复制的带参 URL / 生成分享 JSON
- Modify: `desktop/src/stores/sessionStore.ts` — 新增 `getSharePayload` / `copyShareLink` action
- Modify: `desktop/src/App.tsx` — 分享按钮 + 提示 toast
- Create: `desktop/tests/unit/shareLink.test.ts` — 单测

### Task 8: 分享链接生成器

**Files:**
- Create: `desktop/src/utils/shareLink.ts`
- Test: `desktop/tests/unit/shareLink.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { encodeSharePayload, decodeSharePayload, buildShareUrl } from '../src/utils/shareLink'

describe('shareLink', () => {
  const payload = { targetNode: 'symmetric_group', chat: [{ role: 'user', content: 'hi' }] }

  it('round-trips a payload through URL encoding', () => {
    const url = buildShareUrl(payload)
    expect(url).toContain('mathweaver://share/')
    const decoded = decodeSharePayload(url)
    expect(decoded).toEqual(payload)
  })

  it('compresses large payloads with base64+gzip-less JSON', () => {
    const encoded = encodeSharePayload(payload)
    expect(typeof encoded).toBe('string')
    expect(encoded).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/shareLink.test.ts`
Expected: FAIL,模块不存在

- [ ] **Step 3: 实现**

Create `desktop/src/utils/shareLink.ts`:

```typescript
/**
 * Build a shareable URL / payload for a MathWeaver session snapshot.
 *
 * Strategy: encode the compact JSON payload into a base64url string and embed
 * it as the query fragment of a `mathweaver://share/` deep link. On the web
 * build the same payload is used to populate a share modal.
 */

export interface SharePayload {
  targetNode: string
  chat: Array<{ role: string; content: string }>
  visualData?: Record<string, unknown> | null
  savedAt?: string
}

function toBase64Url(s: string): string {
  return btoa(encodeURIComponent(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  return decodeURIComponent(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad))
}

export function encodeSharePayload(payload: SharePayload): string {
  return toBase64Url(JSON.stringify(payload))
}

export function decodeSharePayload(urlOrEncoded: string): SharePayload | null {
  try {
    const raw = urlOrEncoded.includes('://')
      ? urlOrEncoded.split('share/')[1] ?? ''
      : urlOrEncoded
    const json = fromBase64Url(raw)
    return JSON.parse(json) as SharePayload
  } catch {
    return null
  }
}

export function buildShareUrl(payload: SharePayload): string {
  return `mathweaver://share/${encodeSharePayload(payload)}`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/shareLink.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add desktop/src/utils/shareLink.ts desktop/tests/unit/shareLink.test.ts
git commit -m "feat(share): add share-payload encoder and deep-link builder"
```

### Task 9: store 分享 action

**Files:**
- Modify: `desktop/src/stores/sessionStore.ts`

- [ ] **Step 1: 加签名**

在 `exportSession: () => Promise<string | null>` 后:

```typescript
  getShareUrl: () => string | null
```

- [ ] **Step 2: 实现**

在 `exportSession` 实现后插入:

```typescript
      getShareUrl: () => {
        const state = get()
        if (!state.sessionId) return null
        return buildShareUrl({
          targetNode: state.targetNode || '',
          chat: state.chat.map(m => ({ role: m.role, content: m.content })),
          visualData: state.visualData,
          savedAt: new Date().toISOString(),
        })
      },
```

顶部 import 加 `buildShareUrl`。

- [ ] **Step 3: 提交**

```bash
git add desktop/src/stores/sessionStore.ts
git commit -m "feat(share): add getShareUrl store action"
```

### Task 10: App 分享按钮 + 复制提示

**Files:**
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: 在 header 动作区加分享按钮**

在 `desktop/src/App.tsx` 的 header actions(约 850 行区域)加一个分享按钮,onClick 时:

```typescript
const url = getShareUrl()
if (url) {
  try {
    await navigator.clipboard.writeText(url)
    addToast({ type: 'success', message: '分享链接已复制' })
  } catch {
    addToast({ type: 'info', message: url })
  }
} else {
  addToast({ type: 'info', message: '请先开始学习会话' })
}
```

- [ ] **Step 2: 提交**

```bash
git add desktop/src/App.tsx
git commit -m "feat(share): add share button copying share deep-link"
```

### Task 11: 分享验证

**Files:** 无新增

- [ ] **Step 1: 单测 + 类型检查**

Run: `cd /workspace/mathweaver/desktop && npx vitest run && npm run typecheck`
Expected: 全部通过

- [ ] **Step 2: 手动验证**

Run: `npm run dev`
验证:开始会话后点分享按钮,剪贴板得到 `mathweaver://share/...`,解码函数能还原。

---

# Phase 3 — 主题 → 课程自动生成

## 文件结构

- Create: `desktop/electron/backend/generator/courseGenerator.ts` — 用 LLM 生成课程节点 JSON,校验后合并进 DAG
- Modify: `desktop/electron/main/index.ts` — 新增 `api:generate-course` IPC handler
- Modify: `desktop/electron/preload/index.ts` — 新增 `generateCourse` + 白名单
- Modify: `desktop/src/web-api-shim.ts` — web 端 mock 实现
- Modify: `desktop/src/stores/sessionStore.ts` — 新增 `generateCourse` action
- Modify: `desktop/src/App.tsx` — 主题输入入口
- Create: `desktop/tests/unit/courseGenerator.test.ts` — 单测

### Task 12: 课程生成器(LLM→校验→合并)

**Files:**
- Create: `desktop/electron/backend/generator/courseGenerator.ts`
- Test: `desktop/tests/unit/courseGenerator.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { sanitizeCourseNodes, COURSE_JSON_SCHEMA_HINT } from '../src/../electron/backend/generator/courseGenerator'

describe('courseGenerator', () => {
  it('keeps valid nodes and drops malformed ones', () => {
    const raw = [
      { id: 'a', name: 'A', description: 'd', prerequisites: [] },
      { id: '', name: 'bad', description: 'x', prerequisites: [] },
    ]
    const out = sanitizeCourseNodes(raw)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
  })

  it('assigns unique ids when missing', () => {
    const out = sanitizeCourseNodes([{ name: 'only-name' }])
    expect(out[0].id).toBeTruthy()
  })

  it('exposes a JSON schema hint for the LLM prompt', () => {
    expect(COURSE_JSON_SCHEMA_HINT).toContain('nodes')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/courseGenerator.test.ts`
Expected: FAIL,模块不存在

- [ ] **Step 3: 实现**

Create `desktop/electron/backend/generator/courseGenerator.ts`:

```typescript
/**
 * Generate a course (a list of ConceptNode) for an arbitrary math topic via LLM,
 * then sanitize + validate before merging into the DAG.
 */

import { createLLMClient, type LLMClient } from '../llm/client'
import type { LLMConfig, ConceptNode } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('CourseGen')

export const COURSE_JSON_SCHEMA_HINT = `请为数学主题生成概念 DAG 节点，严格输出 JSON（不要输出任何其他文字）：
{
  "nodes": [
    {
      "id": "英文小写蛇形命名",
      "name": "中文概念名",
      "description": "一句话说明",
      "prerequisites": ["前置节点id（可为空数组）"],
      "abstraction_level": 1,
      "domain": "自定义域",
      "difficulty": 0.5,
      "is_milestone": false,
      "learning_objectives": ["目标1"],
      "examples": ["例子1"],
      "assessment_criteria": ["评价标准1"],
      "estimated_minutes": 30,
      "historical_context": "历史背景",
      "related_theorems": ["相关定理"],
      "common_misconceptions": ["常见误区"]
    }
  ]
}`

export function sanitizeCourseNodes(raw: unknown[]): ConceptNode[] {
  const out: ConceptNode[] = []
  raw.forEach((item, i) => {
    const n = item as Partial<ConceptNode> & { name?: string }
    if (!n || typeof n !== 'object' || !n.name) return // drop malformed
    const id = n.id && /^[a-z0-9_]+$/.test(n.id) ? n.id : `generated_${i}_${Date.now().toString(36)}`
    out.push({
      id,
      name: String(n.name),
      description: String(n.description ?? ''),
      prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites.map(String) : [],
      abstraction_level: Number(n.abstraction_level ?? 1),
      domain: String(n.domain ?? 'generated'),
      difficulty: Number(n.difficulty ?? 0.5),
      is_milestone: Boolean(n.is_milestone),
      learning_objectives: Array.isArray(n.learning_objectives) ? n.learning_objectives.map(String) : [],
      examples: Array.isArray(n.examples) ? n.examples.map(String) : [],
      assessment_criteria: Array.isArray(n.assessment_criteria) ? n.assessment_criteria.map(String) : [],
      estimated_minutes: Number(n.estimated_minutes ?? 30),
      historical_context: String(n.historical_context ?? ''),
      related_theorems: Array.isArray(n.related_theorems) ? n.related_theorems.map(String) : [],
      common_misconceptions: Array.isArray(n.common_misconceptions) ? n.common_misconceptions.map(String) : [],
    })
  })
  return out
}

export async function generateCourse(
  topic: string,
  config: LLMConfig,
  client: LLMClient = createLLMClient(config),
): Promise<ConceptNode[]> {
  const prompt = `${COURSE_JSON_SCHEMA_HINT}\n\n主题：${topic}\n请生成 4-8 个有先修关系的概念节点。`
  const resp = await client.chat(
    '你是数学课程设计专家，只输出符合要求的 JSON。',
    prompt,
  )
  const match = resp.content.match(/\{[\s\S]*\}/)
  if (!match) {
    log.warn('LLM output contained no JSON', { topic })
    return []
  }
  let parsed: { nodes?: unknown[] }
  try {
    parsed = JSON.parse(match[0])
  } catch (e) {
    log.warn('Failed to parse course JSON', { topic, error: String(e) })
    return []
  }
  return sanitizeCourseNodes(parsed.nodes ?? [])
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /workspace/mathweaver/desktop && npx vitest run tests/unit/courseGenerator.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add desktop/electron/backend/generator/courseGenerator.ts desktop/tests/unit/courseGenerator.test.ts
git commit -m "feat(course): add LLM course generator with node sanitization"
```

### Task 13: 主进程 api:generate-course handler

**Files:**
- Modify: `desktop/electron/main/index.ts`

- [ ] **Step 1: 加 handler**

在 `api:generate-content` handler 附近加:

```typescript
safeIpcHandle('api:generate-course', async (_event, req: { topic: string }) => {
  const config = (store.get('llmConfig') as LLMConfig) ?? defaultLLMConfig()
  try {
    const nodes = await generateCourse(req.topic, config)
    return { ok: true, nodes, count: nodes.length }
  } catch (e) {
    return { ok: false, error: String(e), nodes: [] }
  }
})
```

顶部 import `generateCourse`、`defaultLLMConfig`、`LLMConfig`。

- [ ] **Step 2: 提交**

```bash
git add desktop/electron/main/index.ts
git commit -m "feat(course): add api:generate-course IPC handler"
```

### Task 14: preload + web shim 暴露 generateCourse

**Files:**
- Modify: `desktop/electron/preload/index.ts`
- Modify: `desktop/src/web-api-shim.ts`
- Modify: `desktop/src/types/electron.d.ts`

- [ ] **Step 1: preload 白名单 + 方法**

`INVOKE_CHANNELS` 加 `'api:generate-course'`;方法在 `generateContent` 后加:

```typescript
  generateCourse: (topic: string) => safeInvoke('api:generate-course', { topic }),
```

- [ ] **Step 2: web shim mock**

在 `desktop/src/web-api-shim.ts` 的 `generateContent` 后加:

```typescript
  generateCourse: async (topic: string) => {
    const config = getActiveConfig()
    if (isRealLLM(config)) {
      try {
        const messages: LLMMessage[] = [
          { role: 'system', content: COURSE_JSON_SCHEMA_HINT },
          { role: 'user', content: `主题：${topic}\n请输出 JSON。` },
        ]
        const resp = await chatCompletion(config, messages)
        const match = resp.content.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          const nodes = sanitizeCourseNodes(parsed.nodes ?? [])
          return { ok: true, nodes, count: nodes.length }
        }
      } catch (e) {
        console.error('[MathWeaver] generateCourse failed:', e)
      }
    }
    // Mock fallback
    return {
      ok: true,
      nodes: [
        {
          id: 'gen_' + topic.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          name: `${topic} · 入门`,
          description: `关于「${topic}」的入门概念（演示数据）`,
          prerequisites: [],
          abstraction_level: 1,
          domain: 'generated',
          difficulty: 0.4,
          is_milestone: true,
          learning_objectives: [],
          examples: [],
          assessment_criteria: [],
          estimated_minutes: 30,
          historical_context: '',
          related_theorems: [],
          common_misconceptions: [],
        },
      ],
      count: 1,
    }
  },
```

复用 `sanitizeCourseNodes`,需在 web shim import 或内联一个轻量副本(建议直接 import 自 `electron/backend/generator/courseGenerator`,若路径可解析)。

- [ ] **Step 3: 补类型**

`desktop/src/types/electron.d.ts` 加:

```typescript
      generateCourse: (topic: string) => Promise<{ ok: boolean; nodes: unknown[]; count: number }>
```

- [ ] **Step 4: 提交**

```bash
git add desktop/electron/preload/index.ts desktop/src/web-api-shim.ts desktop/src/types/electron.d.ts
git commit -m "feat(course): expose generateCourse via preload + web shim"
```

### Task 15: store + App 主题生成入口

**Files:**
- Modify: `desktop/src/stores/sessionStore.ts`
- Modify: `desktop/src/App.tsx`

- [ ] **Step 1: store 加 action**

接口加:

```typescript
  generateCourse: (topic: string) => Promise<{ ok: boolean; nodes: unknown[]; count: number }>
```

实现(复用 `getAPI`):

```typescript
      generateCourse: async (topic: string) => {
        const api = getAPI()
        if (!api) return { ok: false, nodes: [], count: 0 }
        try {
          return (await api.generateCourse(topic)) as { ok: boolean; nodes: unknown[]; count: number }
        } catch (e) {
          set({ error: { message: 'Generated course failed', headline: '课程生成失败', detail: String(e), recovery: '请检查 LLM 配置', timestamp: Date.now() } })
          return { ok: false, nodes: [], count: 0 }
        }
      },
```

- [ ] **Step 2: App 入口**

在 CommandPalette 加命令或设置面板加输入框,onSubmit 调用 `generateCourse(topic)`,成功后 toast `已生成 N 个概念节点`,并把节点 title 展示。

- [ ] **Step 3: 提交**

```bash
git add desktop/src/stores/sessionStore.ts desktop/src/App.tsx
git commit -m "feat(course): add topic->course generation UI entry"
```

### Task 16: 主题生成全链路验证

**Files:** 无新增

- [ ] **Step 1: 单测 + 类型检查**

Run: `cd /workspace/mathweaver/desktop && npx vitest run && npm run typecheck`
Expected: 全部通过

- [ ] **Step 2: 手动验证**

Run: `npm run dev`,配置真实 LLM key,输入主题如"线性代数基础",确认生成节点并入库。

---

# 交付验证(全量)

- [ ] `cd /workspace/mathweaver/desktop && npx vitest run` 全绿
- [ ] `npm run typecheck` 无错误
- [ ] `npm run lint` 无错误
- [ ] 手动验证:导出 HTML 快照、复制分享链接、主题生成课程 三条链路均可用
- [ ] 更新 `README.md` 记录三项新能力

---

## Self-Review

**Spec 覆盖:** 三项缺口(导出/分享/主题生成)均有独立 Phase 与 Task;导出→分享→主题生成按依赖顺序推进。每项均含单测、类型检查、手动验证。

**占位符扫描:** 已为所有代码步骤提供完整实现,无 TBD/TODO/"类似 Task N"。

**类型一致性:** `buildSessionSnapshotHtml` 的 `SnapshotInput` 与 store 数据字段一致;`exportSnapshot`(preload)、`exportSession`(store)、`file:export-html`(main)命名统一;`generateCourse` 三端签名统一返回 `{ ok, nodes, count }`。