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
    | {
        timeline?: Array<{
          step: number
          claim: string
          verdict: string
          counter_example?: string | null
        }>
      }
    | undefined
  if (journey?.timeline?.length) {
    const rows = journey.timeline
      .map(t => {
        const tag =
          t.verdict === 'refuted' ? '✗ 反驳' : t.verdict === 'confirmed' ? '✓ 确认' : '~ 待定'
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
