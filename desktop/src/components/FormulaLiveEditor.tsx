import { useState, useMemo, useRef, useCallback, memo } from 'react'
import 'katex/dist/katex.min.css'
import { renderLatexWithErrors, type RenderResult } from '../utils/katex-render'

// ---------------------------------------------------------------------------
// FormulaLiveEditor
//
// 实时 LaTeX 编辑器：左右等宽分栏，左侧为 LaTeX 源码编辑区（monospace），
// 右侧通过 KaTeX 实时渲染预览。底部工具栏提供快捷模板插入（在光标位置）、
// 复制 LaTeX / 渲染 HTML、以及插入到对话/证明（onInsert 回调）。
//
// 样式类名统一以 `fle-` 为前缀，通过组件内 <style> 注入，复用 MathWeaver
// 的 CSS 变量（--bg / --bg2 / --bg3 / --ink / --muted / --accent / --err /
// --border / --mono / --serif）以贴合暗色主题，不写入 index.css。
// ---------------------------------------------------------------------------

/** 模板定义：label 为按钮文字，snippet 为待插入的 LaTeX 片段。 */
interface Template {
  label: string
  snippet: string
}

const TEMPLATES: Template[] = [
  { label: '分式', snippet: String.raw`\frac{}{}` },
  { label: '求和', snippet: String.raw`\sum_{}^{}` },
  { label: '积分', snippet: String.raw`\int_{}^{}` },
  { label: '极限', snippet: String.raw`\lim_{}` },
  { label: '矩阵', snippet: String.raw`\begin{pmatrix} & \\ & \end{pmatrix}` },
  { label: '根号', snippet: String.raw`\sqrt{}` },
  { label: '上下标', snippet: String.raw`^{} _{}` },
  { label: '组合', snippet: String.raw`\binom{}{}` },
]

/** 组件内联样式：所有 `fle-` 前缀类名集中在此。 */
const STYLES = `
.fle-root {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
  font-family: var(--serif);
  color: var(--ink);
}
.fle-split {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  min-height: 0;
}
.fle-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.fle-col-head {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg3);
}
.fle-col-title {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.fle-divider {
  background: var(--border);
  width: 1px;
  min-width: 1px;
}
.fle-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  padding: 12px 14px;
  tab-size: 2;
}
.fle-textarea::placeholder { color: var(--muted); }
.fle-textarea:focus { box-shadow: inset 0 0 0 1px var(--accent); }
.fle-preview-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}
.fle-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
}
.fle-preview .katex-display { margin: 0; }
.fle-preview .katex { color: var(--ink); }
.fle-preview-empty {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
  text-align: center;
}
.fle-error {
  flex-shrink: 0;
  margin: 0 12px 12px;
  padding: 8px 10px;
  border: 1px solid rgba(224, 108, 117, 0.3);
  border-radius: 2px;
  background: rgba(224, 108, 117, 0.08);
  color: var(--err);
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.fle-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg2);
  flex-wrap: wrap;
}
.fle-tpl-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.fle-tpl-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  margin-right: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
}
/* 提高特异性以覆盖全局 .btn 的 padding/font-size，使模板按钮更紧凑 */
.fle-tpl-group .fle-tpl-btn {
  padding: 3px 8px;
  font-size: 10px;
}
.fle-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.fle-toast {
  position: absolute;
  bottom: 50px;
  right: 12px;
  padding: 4px 10px;
  border-radius: 2px;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--ok);
  font-family: var(--mono);
  font-size: 11px;
  pointer-events: none;
  animation: fle-fade 1.6s ease forwards;
}
@keyframes fle-fade {
  0%   { opacity: 0; transform: translateY(4px); }
  15%  { opacity: 1; transform: translateY(0); }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .fle-toast { animation: none; }
}
`

/** 默认初始 LaTeX，便于首次进入即看到渲染效果。 */
const DEFAULT_LATEX = 'e^{i\\pi} + 1 = 0'

/** 默认编辑/预览分栏高度（px）。 */
const DEFAULT_HEIGHT = 320

export interface FormulaLiveEditorProps {
  /** 点击「插入到对话/证明」时回调，传入当前 LaTeX 源码。 */
  onInsert?: (latex: string) => void
  /** 初始 LaTeX 源码。 */
  initialLatex?: string
  /** 编辑/预览分栏区域高度（px）。 */
  height?: number
}

/**
 * 将 LaTeX 渲染为已净化的 HTML 字符串，并捕获语法错误信息。
 *
 * 渲染与净化逻辑统一由 `utils/katex-render` 提供，避免与 MathText 组件重复。
 */
function renderLatex(latex: string): RenderResult {
  return renderLatexWithErrors(latex, true)
}

function FormulaLiveEditorImpl({
  onInsert,
  initialLatex = DEFAULT_LATEX,
  height = DEFAULT_HEIGHT,
}: FormulaLiveEditorProps) {
  const [latex, setLatex] = useState<string>(initialLatex)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const toastSeq = useRef(0)
  const toastTimer = useRef<number | null>(null)
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null)

  // 实时渲染（含错误探测 + DOMPurify 净化）—— 仅依赖 latex，输入变化时重算。
  // 净化逻辑已内置于 renderLatex（utils/katex-render），此处无需再次处理。
  const { html, error } = useMemo<RenderResult>(() => renderLatex(latex), [latex])

  // 渲染结果已通过 DOMPurify 净化，可直接安全注入 DOM。
  const sanitizedHtml = html

  // 轻量复制反馈：1.6s 后自动清除。React 18 中组件卸载后的 setState
  // 为静默 no-op，故无需额外清理副作用。
  const flashToast = useCallback((msg: string) => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, msg })
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1600)
  }, [])

  /**
   * 在 textarea 当前光标位置插入模板片段（替换选区），并把光标移至首个
   * `{}` 占位符内部；若无占位符则置于片段末尾。
   *
   * 光标恢复在下一帧（requestAnimationFrame）执行，确保 React 已将新值
   * 提交到 textarea 后再设置选区，避免被受控组件的值更新覆盖。
   */
  const insertAtCursor = useCallback(
    (snippet: string) => {
      const ta = textareaRef.current
      if (!ta) {
        setLatex(prev => prev + snippet)
        return
      }
      const start = ta.selectionStart ?? latex.length
      const end = ta.selectionEnd ?? latex.length
      const next = latex.slice(0, start) + snippet + latex.slice(end)
      setLatex(next)

      const placeholderOffset = snippet.indexOf('{}')
      const cursorPos =
        placeholderOffset >= 0
          ? start + placeholderOffset + 1 // 落在 {} 两个花括号之间
          : start + snippet.length

      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(cursorPos, cursorPos)
      })
    },
    [latex],
  )

  const copyLatex = useCallback(async () => {
    if (!latex) return
    try {
      await navigator.clipboard.writeText(latex)
      flashToast('已复制 LaTeX')
    } catch {
      flashToast('复制失败')
    }
  }, [latex, flashToast])

  const copyHtml = useCallback(async () => {
    if (!html) return
    try {
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html], { type: 'text/plain' }),
        })
        await navigator.clipboard.write([item])
      } else {
        await navigator.clipboard.writeText(html)
      }
      flashToast('已复制渲染 HTML')
    } catch {
      try {
        await navigator.clipboard.writeText(html)
        flashToast('已复制渲染 HTML')
      } catch {
        flashToast('复制失败')
      }
    }
  }, [html, flashToast])

  const handleInsert = useCallback(() => {
    if (!onInsert || !latex.trim()) return
    onInsert(latex)
    flashToast('已插入到对话')
  }, [onInsert, latex, flashToast])

  const hasLatex = latex.trim().length > 0
  const canInsert = Boolean(onInsert) && hasLatex

  return (
    <div className="fle-root">
      <style>{STYLES}</style>

      <div className="fle-split" style={{ height }}>
        {/* 左：LaTeX 源码编辑区 */}
        <div className="fle-col">
          <div className="fle-col-head">
            <span className="fle-col-title">LaTeX 源码</span>
          </div>
          <textarea
            ref={textareaRef}
            className="fle-textarea"
            value={latex}
            onChange={e => setLatex(e.target.value)}
            placeholder="输入 LaTeX 公式，例如  \frac{a}{b}  或  \int_0^1 x^2 \, dx"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="LaTeX 源码编辑区"
          />
        </div>

        <div className="fle-divider" aria-hidden="true" />

        {/* 右：实时渲染预览 */}
        <div className="fle-col">
          <div className="fle-col-head">
            <span className="fle-col-title">实时预览</span>
          </div>
          <div className="fle-preview-wrap">
            <div className="fle-preview">
              {html ? (
                <span dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
              ) : (
                <span className="fle-preview-empty">预览区为空——在左侧输入 LaTeX 公式</span>
              )}
            </div>
            {error && (
              <div className="fle-error" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部工具栏：模板插入 + 操作按钮 */}
      <div className="fle-toolbar">
        <div className="fle-tpl-group" role="group" aria-label="公式模板">
          <span className="fle-tpl-label">模板</span>
          {TEMPLATES.map(tpl => (
            <button
              key={tpl.label}
              type="button"
              className="btn fle-tpl-btn"
              onClick={() => insertAtCursor(tpl.snippet)}
              title={`插入：${tpl.snippet}`}
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <div className="fle-actions">
          <button
            type="button"
            className="btn"
            onClick={copyLatex}
            disabled={!hasLatex}
            title="复制 LaTeX 源码到剪贴板"
          >
            复制 LaTeX
          </button>
          <button
            type="button"
            className="btn"
            onClick={copyHtml}
            disabled={!html}
            title="复制渲染结果 HTML 到剪贴板"
          >
            复制 HTML
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleInsert}
            disabled={!canInsert}
            title={onInsert ? '插入到对话/证明' : '未提供插入目标'}
          >
            插入到对话
          </button>
        </div>
      </div>

      {toast && (
        <div key={toast.id} className="fle-toast">
          {toast.msg}
        </div>
      )}
    </div>
  )
}

export const FormulaLiveEditor = memo(FormulaLiveEditorImpl)
