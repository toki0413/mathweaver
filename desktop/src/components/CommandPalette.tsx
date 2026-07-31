import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { getCommandIcon } from './Icons'

export interface CommandAction {
  id: string
  label: string
  /** 键盘快捷键文本，例如 "⌘S" */
  hint?: string
  /** icon name (maps to SVG component via getCommandIcon) */
  icon?: string
  section: 'navigation' | 'action' | 'help'
  action: () => void
}

export interface CommandPaletteProps {
  commands: CommandAction[]
  /**
   * 外部受控打开：传入 true 时强制打开，传入 false 时强制关闭。
   * 不传则完全由 Cmd/Ctrl+K 自管理打开状态。
   */
  open?: boolean
  /** 关闭回调（Escape / 点击遮罩 / 执行命令后触发）。 */
  onClose?: () => void
}

const SECTION_ORDER: CommandAction['section'][] = ['navigation', 'action', 'help']

const SECTION_LABELS: Record<string, string> = {
  navigation: '导航',
  action: '操作',
  help: '帮助',
}

/**
 * 组件内嵌样式 —— 不写入 index.css，通过 <style> 注入以保持自包含。
 * 复用 MathWeaver 的 CSS 变量（--bg2 / --ink / --accent / --border ...）以贴合暗色主题。
 */
const PALETTE_CSS = `
.cmd-palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 30vh;
  background: rgba(0, 0, 0, 0.5);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}
.cmd-palette {
  width: 100%;
  max-width: 560px;
  margin: 0 16px;
  background: var(--bg2, #232323);
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 3px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  max-height: 55vh;
  overflow: hidden;
}
.cmd-palette-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink, #e8e6e3);
  font-family: var(--serif, Georgia, serif);
  font-size: 15px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border, #3a3a3a);
  box-sizing: border-box;
}
.cmd-palette-input::placeholder {
  color: var(--muted, #8a8884);
}
.cmd-palette-list {
  overflow-y: auto;
  padding: 6px 0 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--bg3, #2e2e2e) transparent;
}
.cmd-palette-list::-webkit-scrollbar { width: 6px; }
.cmd-palette-list::-webkit-scrollbar-thumb {
  background: var(--bg3, #2e2e2e);
  border-radius: 3px;
}
.cmd-palette-section { padding: 2px 0; }
.cmd-palette-section-label {
  padding: 8px 18px 4px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted, #8a8884);
}
.cmd-palette-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 18px;
  cursor: pointer;
  user-select: none;
}
.cmd-palette-item-selected {
  background: rgba(198, 120, 221, 0.18);
}
.cmd-palette-item-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent, #c678dd);
}
.cmd-palette-item-label {
  flex: 1;
  font-size: 14px;
  color: var(--ink, #e8e6e3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-palette-item-hint {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--muted, #8a8884);
  background: var(--bg3, #2e2e2e);
  border-radius: 3px;
  padding: 2px 7px;
}
.cmd-palette-empty {
  padding: 18px;
  text-align: center;
  font-size: 13px;
  color: var(--muted, #8a8884);
}
`

/**
 * Cmd/Ctrl+K 命令面板 —— 类似 VS Code / Raycast 的快速操作入口。
 *
 * 自管理打开状态（监听全局 Cmd/Ctrl+K 切换），同时支持外部受控
 * （`open` / `onClose`）。支持模糊搜索、方向键导航、回车执行、
 * Escape / 点击遮罩关闭。
 */
export function CommandPalette({ commands, open, onClose }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 用 ref 保存最新的 onClose 与 isOpen，避免全局 keydown 监听器闭包过期
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const isOpenRef = useRef(false)
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const closePalette = useCallback(() => {
    setIsOpen(false)
    onCloseRef.current?.()
  }, [])

  const openPalette = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setIsOpen(true)
  }, [])

  // 外部受控：open 变化时同步内部状态
  useEffect(() => {
    if (open === undefined) return
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }, [open])

  // 全局键盘监听：Cmd/Ctrl+K 切换，Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (isOpenRef.current) {
          closePalette()
        } else {
          openPalette()
        }
      } else if (e.key === 'Escape' && isOpenRef.current) {
        closePalette()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closePalette, openPalette])

  // 打开时自动聚焦搜索框
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
    }
  }, [isOpen])

  // query 变化时重置高亮到首项
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 过滤 + 按 section 分组 + 扁平索引（用于方向键导航）
  const { sections, flat, indexById } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands

    const buckets = new Map<string, CommandAction[]>()
    SECTION_ORDER.forEach(s => buckets.set(s, []))
    filtered.forEach(c => {
      const bucket = buckets.get(c.section)
      if (bucket) {
        bucket.push(c)
      } else {
        buckets.set(c.section, [c])
      }
    })

    const sections: { section: string; items: CommandAction[] }[] = []
    const flat: CommandAction[] = []
    buckets.forEach((items, section) => {
      if (items.length > 0) {
        sections.push({ section, items })
        flat.push(...items)
      }
    })

    const indexById = new Map<string, number>()
    flat.forEach((c, i) => indexById.set(c.id, i))

    return { sections, flat, indexById }
  }, [commands, query])

  // 列表收缩时夹紧 selectedIndex，避免越界
  useEffect(() => {
    if (flat.length > 0 && selectedIndex >= flat.length) {
      setSelectedIndex(0)
    }
  }, [flat, selectedIndex])

  // 高亮项滚动到可视区
  useEffect(() => {
    if (!isOpen) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, isOpen])

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length === 0) return
      setSelectedIndex(prev => (prev + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length === 0) return
      setSelectedIndex(prev => (prev - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = flat[selectedIndex]
      if (cmd) {
        cmd.action()
        closePalette()
      }
    }
    // Escape 由全局监听器统一处理，避免重复触发 onClose
  }

  const handleOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // 仅当按下的是遮罩本身（而非面板内部）时关闭
    if (e.target === e.currentTarget) {
      closePalette()
    }
  }

  const runCommand = (cmd: CommandAction) => {
    cmd.action()
    closePalette()
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PALETTE_CSS }} />
      {isOpen && (
        <div className="cmd-palette-overlay" onMouseDown={handleOverlayMouseDown}>
          <div className="cmd-palette" role="dialog" aria-modal="true" aria-label="命令面板">
            <input
              ref={inputRef}
              className="cmd-palette-input"
              type="text"
              placeholder="输入命令名称…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="cmd-palette-list" ref={listRef}>
              {flat.length === 0 ? (
                <div className="cmd-palette-empty">没有匹配的命令</div>
              ) : (
                sections.map(({ section, items }) => (
                  <div key={section} className="cmd-palette-section">
                    <div className="cmd-palette-section-label">
                      {SECTION_LABELS[section] ?? section}
                    </div>
                    {items.map(cmd => {
                      const idx = indexById.get(cmd.id) ?? 0
                      const selected = idx === selectedIndex
                      return (
                        <div
                          key={cmd.id}
                          data-index={idx}
                          className={
                            'cmd-palette-item' + (selected ? ' cmd-palette-item-selected' : '')
                          }
                          onMouseEnter={() => setSelectedIndex(idx)}
                          onClick={() => runCommand(cmd)}
                        >
                          {cmd.icon !== undefined && (
                            <span className="cmd-palette-item-icon">
                              {(() => {
                                const IconComp = getCommandIcon(cmd.icon)
                                return IconComp ? <IconComp size={16} /> : null
                              })()}
                            </span>
                          )}
                          <span className="cmd-palette-item-label">{cmd.label}</span>
                          {cmd.hint !== undefined && (
                            <span className="cmd-palette-item-hint">{cmd.hint}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
