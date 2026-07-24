import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'system'
  content: string
  phase?: string
}

interface ChatPanelProps {
  /** Called with the quoted message text when the user clicks "引用". */
  onQuote?: (text: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLAPSE_THRESHOLD = 300
const PREVIEW_LENGTH = 200
const NEAR_BOTTOM_PX = 80
const COPY_FEEDBACK_MS = 2000

// Scoped styles for the new interactive bits. Kept inside the component file
// so the feature is self-contained; class names are prefixed with `cw-` to
// avoid collisions with the global stylesheet.
const SCOPED_CSS = `
.cw-msg { position: relative; }

.cw-msg-actions {
  position: absolute;
  top: 6px;
  right: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 1;
}
.cw-msg:hover .cw-msg-actions,
.cw-msg:focus-within .cw-msg-actions { opacity: 1; }

.cw-action-btn {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg2);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.cw-action-btn:hover { color: var(--ink); border-color: var(--muted); }
.cw-action-btn.copied { color: var(--ok); border-color: var(--ok); }

.cw-expand-btn {
  display: inline-block;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.cw-expand-btn:hover { text-decoration: underline; }

.cw-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cw-search-input { flex: 1; min-width: 0; }
.cw-search-count {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}

.cw-quote-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 10px;
  border-left: 3px solid var(--accent);
  background: var(--bg3);
  border-radius: 0 2px 2px 0;
}
.cw-quote-main { flex: 1; min-width: 0; }
.cw-quote-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--accent);
  margin-bottom: 2px;
}
.cw-quote-text {
  font-size: 12px;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60px;
  overflow: hidden;
}
`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ChatPanelBase({ onQuote }: ChatPanelProps) {
  const chat = useStore((s) => s.chat)
  const loading = useStore((s) => s.loading)

  // Search / filter
  const [searchTerm, setSearchTerm] = useState('')
  const term = searchTerm.trim().toLowerCase()

  // Quote reply
  const [quotedText, setQuotedText] = useState<string | null>(null)

  // Copy feedback (index of the message currently showing "已复制")
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  // Long-message expansion (keyed by stable chat index)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  // Auto-scroll
  const chatBoxRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  // -------------------------------------------------------------------------
  // Derived: filtered message list (preserves original indices)
  // -------------------------------------------------------------------------
  const filtered = useMemo(() => {
    const result: { msg: ChatMessage; i: number }[] = []
    for (let i = 0; i < chat.length; i++) {
      const msg = chat[i]
      if (!term || msg.content.toLowerCase().includes(term)) {
        result.push({ msg, i })
      }
    }
    return result
  }, [chat, term])

  // -------------------------------------------------------------------------
  // Auto-scroll to bottom when new messages arrive, but only if the user is
  // already near the bottom (so we don't yank the view while they read).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = chatBoxRef.current
    if (!el) return
    if (nearBottomRef.current && !term) {
      el.scrollTop = el.scrollHeight
    }
  }, [chat, loading, term])

  // Clear any pending copy-feedback timer on unmount.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleScroll = () => {
    const el = chatBoxRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    nearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_PX
  }

  const handleCopy = (i: number, content: string) => {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopiedIndex(i)
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current)
        }
        copyTimerRef.current = window.setTimeout(() => {
          setCopiedIndex((prev) => (prev === i ? null : prev))
        }, COPY_FEEDBACK_MS)
      })
      .catch(() => {
        /* silently ignore clipboard errors */
      })
  }

  const handleQuote = (content: string) => {
    setQuotedText(content)
    onQuote?.(content)
  }

  const toggleExpand = (i: number) => {
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="card">
      <style>{SCOPED_CSS}</style>

      <h2>记录</h2>

      {/* Search / filter */}
      <div className="cw-search-row">
        <input
          className="text-input cw-search-input"
          type="text"
          placeholder="搜索消息..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="搜索聊天记录"
        />
        {term && (
          <span className="cw-search-count">
            找到 {filtered.length} 条匹配
          </span>
        )}
      </div>

      <div
        className="chat-box"
        ref={chatBoxRef}
        onScroll={handleScroll}
      >
        {chat.length === 0 && (
          <p className="desc">提交运算表或输入问题开始</p>
        )}
        {chat.length > 0 && filtered.length === 0 && (
          <p className="desc">没有匹配的消息</p>
        )}

        {filtered.map(({ msg, i }) => {
          const isLong = msg.content.length > COLLAPSE_THRESHOLD
          const isExpanded = !!expanded[i]
          const showFull = !isLong || isExpanded
          const displayContent = showFull
            ? msg.content
            : msg.content.slice(0, PREVIEW_LENGTH) + '...'
          const copied = copiedIndex === i

          return (
            <div key={i} className={`chat-msg ${msg.role} cw-msg`}>
              {/* Hover-revealed action buttons (top-right) */}
              <div className="cw-msg-actions">
                <button
                  type="button"
                  className={`cw-action-btn${copied ? ' copied' : ''}`}
                  onClick={() => handleCopy(i, msg.content)}
                  title="复制"
                >
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  className="cw-action-btn"
                  onClick={() => handleQuote(msg.content)}
                  title="引用"
                >
                  引用
                </button>
              </div>

              <div className="role">
                {msg.role === 'user' ? 'student' : 'system'}
                {msg.phase && msg.role === 'system' && (
                  <span
                    className="badge badge-warning"
                    style={{ marginLeft: '6px' }}
                  >
                    {msg.phase}
                  </span>
                )}
              </div>

              <div className="content">
                <MathText>{displayContent}</MathText>
                {isLong && (
                  <button
                    type="button"
                    className="cw-expand-btn"
                    onClick={() => toggleExpand(i)}
                  >
                    {isExpanded ? '收起' : '展开全部'}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            处理中
          </div>
        )}
      </div>

      {/* Quote reply bar (shown above the input area) */}
      {quotedText && (
        <div className="cw-quote-bar">
          <div className="cw-quote-main">
            <div className="cw-quote-label">引用</div>
            <div className="cw-quote-text">
              <MathText>{quotedText}</MathText>
            </div>
          </div>
          <button
            type="button"
            className="cw-action-btn"
            onClick={() => setQuotedText(null)}
            title="取消引用"
          >
            取消
          </button>
        </div>
      )}
    </div>
  )
}

export const ChatPanel = memo(ChatPanelBase)
