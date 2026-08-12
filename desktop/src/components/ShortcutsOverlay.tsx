import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'

export interface ShortcutItem {
  /** 键位序列，如 ['Cmd', 'K'] 或 ['Shift', 'Enter'] 或 ['?'] */
  keys: string[]
  /** 快捷键描述 */
  description: string
  /** 所属类别，如「导航」「输入」「证明」「全局」 */
  category: string
}

export interface ShortcutsOverlayProps {
  /** 自定义快捷键列表，按 category 自动分组 */
  shortcuts: ShortcutItem[]
  /** 外部受控打开状态：true 强制打开，false 强制关闭，不传则自管理 */
  open?: boolean
  /** 关闭回调（Escape / 点击遮罩 / 再次按 ? 时触发） */
  onClose?: () => void
}

/**
 * 组件内嵌样式 —— 不写入 index.css，通过 <style> 注入以保持自包含。
 * 复用 MathWeaver 的 CSS 变量以贴合暗色主题。
 */
const OVERLAY_CSS = `
.sco-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  animation: sco-fade 0.18s ease;
}
@keyframes sco-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.sco-card {
  width: 560px;
  max-width: 92vw;
  max-height: 80vh;
  background: var(--bg2, #232323);
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 4px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sco-pop 0.2s ease;
}
@keyframes sco-pop {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
.sco-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #3a3a3a);
}
.sco-title {
  font-family: var(--serif, Georgia, serif);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink, #e8e6e3);
}
.sco-title-hint {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 400;
  color: var(--muted, #8a8884);
  margin-left: 8px;
}
.sco-close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 2px;
  background: transparent;
  color: var(--muted, #8a8884);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, border-color 0.15s;
}
.sco-close:hover {
  color: var(--ink, #e8e6e3);
  border-color: var(--muted, #8a8884);
}
.sco-close:active {
  color: var(--accent, #c4392f);
  border-color: var(--accent, #c4392f);
}
.sco-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 20px 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--bg3, #2e2e2e) transparent;
}
.sco-body::-webkit-scrollbar { width: 5px; }
.sco-body::-webkit-scrollbar-track { background: transparent; }
.sco-body::-webkit-scrollbar-thumb {
  background: var(--bg3, #2e2e2e);
  border-radius: 3px;
}
.sco-body::-webkit-scrollbar-thumb:hover {
  background: var(--muted, #8a8884);
}
.sco-category {
  margin-bottom: 18px;
}
.sco-category:last-child {
  margin-bottom: 0;
}
.sco-category-label {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent, #c4392f);
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border, #3a3a3a);
}
.sco-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 0;
}
.sco-desc {
  font-family: var(--serif, Georgia, serif);
  font-size: 13px;
  color: var(--ink, #e8e6e3);
  line-height: 1.5;
}
.sco-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.sco-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 500;
  color: var(--ink, #e8e6e3);
  background: var(--bg3, #2e2e2e);
  border: 1px solid var(--border, #3a3a3a);
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 2px 7px;
  min-width: 22px;
  min-height: 22px;
  line-height: 1;
}
.sco-plus {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--muted, #8a8884);
  user-select: none;
}
.sco-footer {
  padding: 10px 20px;
  border-top: 1px solid var(--border, #3a3a3a);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--muted, #8a8884);
  text-align: center;
}
.sco-empty {
  padding: 32px 16px;
  text-align: center;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--muted, #8a8884);
}
`

/** 判断事件目标是否为可编辑元素（输入框 / 文本域 / contenteditable） */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

/**
 * 键盘快捷键帮助浮层 —— 通过 ? 键（Shift+/）触发显示，Escape 或点击遮罩关闭。
 *
 * 功能：
 * - 模态浮层，居中显示，最大宽度 560px
 * - 快捷键按 category 自动分组，保留首次出现顺序
 * - 每个快捷键显示键位（kbd 徽章）与描述
 * - 支持自定义快捷键列表传入
 *
 * 自管理打开状态：监听全局 ? 键打开（在输入框中按下 ? 不会触发，以避免
 * 干扰文本输入），Escape 关闭，再次按 ? 也可关闭。同时支持外部受控
 * （`open` / `onClose`）。
 */
function ShortcutsOverlayImpl({ shortcuts, open, onClose }: ShortcutsOverlayProps) {
  const [isOpen, setIsOpen] = useState(false)

  // 用 ref 保存最新的回调与状态，避免全局监听器闭包过期
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const isOpenRef = useRef(false)
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const closeOverlay = useCallback(() => {
    setIsOpen(false)
    onCloseRef.current?.()
  }, [])

  const toggleOverlay = useCallback(() => {
    setIsOpen(prev => {
      const next = !prev
      if (!next) {
        onCloseRef.current?.()
      }
      return next
    })
  }, [])

  // 外部受控：open 变化时同步内部状态
  useEffect(() => {
    if (open === undefined) return
    setIsOpen(open)
  }, [open])

  // 全局键盘监听：? 键切换（输入框中不触发），Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ? 键：Shift+/ 产生 '?'。在可编辑元素中不触发，以允许正常输入问号
      if (e.key === '?' && !isEditable(e.target)) {
        e.preventDefault()
        toggleOverlay()
      } else if (e.key === 'Escape' && isOpenRef.current) {
        e.preventDefault()
        closeOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleOverlay, closeOverlay])

  // 打开时锁定 body 滚动，关闭时恢复
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  // 按类别分组，保留首次出现顺序
  const grouped = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, ShortcutItem[]>()
    shortcuts.forEach(item => {
      if (!map.has(item.category)) {
        map.set(item.category, [])
        order.push(item.category)
      }
      map.get(item.category)!.push(item)
    })
    return order.map(category => ({ category, items: map.get(category)! }))
  }, [shortcuts])

  // 点击遮罩（而非卡片内部）时关闭
  const handleBackdropMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        closeOverlay()
      }
    },
    [closeOverlay],
  )

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: OVERLAY_CSS }} />
      {isOpen && (
        <div className="sco-backdrop" onMouseDown={handleBackdropMouseDown}>
          <div className="sco-card" role="dialog" aria-modal="true" aria-label="键盘快捷键">
            <div className="sco-header">
              <div>
                <span className="sco-title">键盘快捷键</span>
                <span className="sco-title-hint">按 ? 打开 / Esc 关闭</span>
              </div>
              <button
                type="button"
                className="sco-close"
                onClick={closeOverlay}
                aria-label="关闭快捷键帮助"
              >
                {'\u2715'}
              </button>
            </div>
            <div className="sco-body">
              {grouped.length === 0 ? (
                <div className="sco-empty">暂无快捷键</div>
              ) : (
                grouped.map(({ category, items }) => (
                  <div key={category} className="sco-category">
                    <div className="sco-category-label">{category}</div>
                    {items.map((item, idx) => (
                      <div key={category + '-' + idx} className="sco-row">
                        <span className="sco-desc">{item.description}</span>
                        <span className="sco-keys">
                          {item.keys.map((k, i) => (
                            <span key={i}>
                              {i > 0 && <span className="sco-plus">{'+'}</span>}
                              <kbd className="sco-kbd">{k}</kbd>
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="sco-footer">MathWeaver — 数学认知操作系统</div>
          </div>
        </div>
      )}
    </>
  )
}

export const ShortcutsOverlay = memo(ShortcutsOverlayImpl)
