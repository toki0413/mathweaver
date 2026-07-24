import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'

export interface MathSymbolPaletteProps {
  /** 点击符号时回调，将符号文本与可选 LaTeX 命令传出 */
  onInsert: (symbol: string, latex?: string) => void
  /** 触发方式：'button' 渲染内置按钮（默认），'manual' 完全由外部 open 控制 */
  trigger?: 'button' | 'manual'
  /** 外部受控打开状态：true 强制打开，false 强制关闭，不传则自管理 */
  open?: boolean
  /** 打开/关闭状态变化回调 */
  onOpenChange?: (open: boolean) => void
}

interface MathSymbol {
  /** Unicode 字符 */
  char: string
  /** LaTeX 命令，如 \\forall */
  latex: string
  /** 符号名称（英文标识，用于搜索与 React key） */
  name: string
  /** 含义描述 */
  desc: string
  /** 所属类别 */
  category: SymbolCategory
}

const CATEGORY_ORDER = [
  '逻辑',
  '集合论',
  '代数',
  '关系',
  '箭头',
  '希腊字母',
] as const
type SymbolCategory = (typeof CATEGORY_ORDER)[number]

/** 全部数学符号 —— 按需求指定的类别与字符组织。
 *  注意：→ 与 ↔ 同时出现在「逻辑」和「箭头」两个类别中，因此以
 *  (category, name) 作为唯一标识，而非 char。 */
const SYMBOLS: MathSymbol[] = [
  // ── 逻辑 ──────────────────────────────────────────────
  { char: '∀', latex: '\\forall', name: 'forall', desc: '对于所有 / 任意', category: '逻辑' },
  { char: '∃', latex: '\\exists', name: 'exists', desc: '存在', category: '逻辑' },
  { char: '¬', latex: '\\neg', name: 'not', desc: '非 / 逻辑否定', category: '逻辑' },
  { char: '∧', latex: '\\wedge', name: 'and', desc: '逻辑与 (合取)', category: '逻辑' },
  { char: '∨', latex: '\\vee', name: 'or', desc: '逻辑或 (析取)', category: '逻辑' },
  { char: '→', latex: '\\rightarrow', name: 'implies', desc: '蕴含', category: '逻辑' },
  { char: '↔', latex: '\\leftrightarrow', name: 'iff', desc: '当且仅当', category: '逻辑' },
  { char: '⟹', latex: '\\implies', name: 'Implies', desc: '推导出 (长)', category: '逻辑' },
  { char: '⟸', latex: '\\Longleftarrow', name: 'Impliedby', desc: '由…推导', category: '逻辑' },
  { char: '⟺', latex: '\\iff', name: 'iff-long', desc: '等价 (长)', category: '逻辑' },

  // ── 集合论 ────────────────────────────────────────────
  { char: '∈', latex: '\\in', name: 'in', desc: '属于', category: '集合论' },
  { char: '∉', latex: '\\notin', name: 'notin', desc: '不属于', category: '集合论' },
  { char: '⊆', latex: '\\subseteq', name: 'subseteq', desc: '子集或相等', category: '集合论' },
  { char: '⊂', latex: '\\subset', name: 'subset', desc: '真子集', category: '集合论' },
  { char: '∪', latex: '\\cup', name: 'union', desc: '并集', category: '集合论' },
  { char: '∩', latex: '\\cap', name: 'intersection', desc: '交集', category: '集合论' },
  { char: '∅', latex: '\\emptyset', name: 'emptyset', desc: '空集', category: '集合论' },
  { char: '𝒫', latex: '\\mathcal{P}', name: 'powerset', desc: '幂集', category: '集合论' },

  // ── 代数 ──────────────────────────────────────────────
  { char: '∘', latex: '\\circ', name: 'compose', desc: '函数复合', category: '代数' },
  { char: '≅', latex: '\\cong', name: 'cong', desc: '同构', category: '代数' },
  { char: '⊕', latex: '\\oplus', name: 'oplus', desc: '直和 / 异或', category: '代数' },
  { char: '⊗', latex: '\\otimes', name: 'otimes', desc: '张量积', category: '代数' },
  { char: '≡', latex: '\\equiv', name: 'equiv', desc: '等价 / 同余', category: '代数' },

  // ── 关系 ──────────────────────────────────────────────
  { char: '=', latex: '=', name: 'eq', desc: '等于', category: '关系' },
  { char: '≠', latex: '\\neq', name: 'neq', desc: '不等于', category: '关系' },
  { char: '≤', latex: '\\leq', name: 'leq', desc: '小于等于', category: '关系' },
  { char: '≥', latex: '\\geq', name: 'geq', desc: '大于等于', category: '关系' },
  { char: '≈', latex: '\\approx', name: 'approx', desc: '约等于', category: '关系' },
  { char: '∼', latex: '\\sim', name: 'sim', desc: '相似 / 等价关系', category: '关系' },

  // ── 箭头 ──────────────────────────────────────────────
  { char: '→', latex: '\\rightarrow', name: 'rightarrow', desc: '右箭头', category: '箭头' },
  { char: '←', latex: '\\leftarrow', name: 'leftarrow', desc: '左箭头', category: '箭头' },
  { char: '↔', latex: '\\leftrightarrow', name: 'leftrightarrow', desc: '双向箭头', category: '箭头' },
  { char: '↑', latex: '\\uparrow', name: 'uparrow', desc: '上箭头', category: '箭头' },
  { char: '↓', latex: '\\downarrow', name: 'downarrow', desc: '下箭头', category: '箭头' },
  { char: '⇒', latex: '\\Rightarrow', name: 'Rightarrow', desc: '双线右箭头', category: '箭头' },
  { char: '⇐', latex: '\\Leftarrow', name: 'Leftarrow', desc: '双线左箭头', category: '箭头' },

  // ── 希腊字母 ──────────────────────────────────────────
  { char: 'α', latex: '\\alpha', name: 'alpha', desc: '阿尔法', category: '希腊字母' },
  { char: 'β', latex: '\\beta', name: 'beta', desc: '贝塔', category: '希腊字母' },
  { char: 'γ', latex: '\\gamma', name: 'gamma', desc: '伽马', category: '希腊字母' },
  { char: 'δ', latex: '\\delta', name: 'delta', desc: '德尔塔', category: '希腊字母' },
  { char: 'θ', latex: '\\theta', name: 'theta', desc: '西塔', category: '希腊字母' },
  { char: 'λ', latex: '\\lambda', name: 'lambda', desc: '兰姆达', category: '希腊字母' },
  { char: 'μ', latex: '\\mu', name: 'mu', desc: '缪', category: '希腊字母' },
  { char: 'π', latex: '\\pi', name: 'pi', desc: '派', category: '希腊字母' },
  { char: 'σ', latex: '\\sigma', name: 'sigma', desc: '西格马', category: '希腊字母' },
  { char: 'φ', latex: '\\phi', name: 'phi', desc: '斐', category: '希腊字母' },
  { char: 'ψ', latex: '\\psi', name: 'psi', desc: '普西', category: '希腊字母' },
  { char: 'ω', latex: '\\omega', name: 'omega', desc: '欧米伽', category: '希腊字母' },
]

const MAX_RECENT = 8

/**
 * 组件内嵌样式 —— 不写入 index.css，通过 <style> 注入以保持自包含。
 * 复用 MathWeaver 的 CSS 变量（--bg / --bg2 / --bg3 / --ink / --muted /
 * --accent / --border / --mono / --serif）以贴合暗色主题。
 */
const PALETTE_CSS = `
.msp-wrap {
  position: relative;
  display: inline-block;
}
.msp-trigger {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 2px;
  background: transparent;
  color: var(--muted, #8a8884);
  font-family: var(--serif, Georgia, serif);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s, border-color 0.15s;
}
.msp-trigger:hover {
  color: var(--ink, #e8e6e3);
  border-color: var(--muted, #8a8884);
}
.msp-trigger.active {
  color: var(--accent, #c678dd);
  border-color: var(--accent, #c678dd);
}
.msp-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 340px;
  background: var(--bg2, #232323);
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 3px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  z-index: 200;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
  animation: msp-in 0.16s ease;
}
@keyframes msp-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.msp-search {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, #3a3a3a);
}
.msp-search-input {
  width: 100%;
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 2px;
  background: var(--bg, #1a1a1a);
  color: var(--ink, #e8e6e3);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  padding: 6px 8px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.msp-search-input:focus {
  border-color: var(--accent, #c678dd);
}
.msp-search-input::placeholder {
  color: var(--muted, #8a8884);
}
.msp-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--bg3, #2e2e2e) transparent;
}
.msp-scroll::-webkit-scrollbar { width: 5px; }
.msp-scroll::-webkit-scrollbar-track { background: transparent; }
.msp-scroll::-webkit-scrollbar-thumb {
  background: var(--bg3, #2e2e2e);
  border-radius: 3px;
}
.msp-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--muted, #8a8884);
}
.msp-section { padding: 2px 0; }
.msp-section-label {
  padding: 6px 12px 3px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted, #8a8884);
}
.msp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: 2px;
  padding: 0 8px 4px;
}
.msp-sym {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--ink, #e8e6e3);
  font-family: var(--serif, Georgia, serif);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.msp-sym:hover {
  background: var(--bg3, #2e2e2e);
  border-color: var(--border, #3a3a3a);
}
.msp-sym:active {
  color: var(--accent, #c678dd);
}
.msp-sym.recent {
  background: rgba(198, 120, 221, 0.08);
}
.msp-sym.recent:hover {
  background: rgba(198, 120, 221, 0.16);
}
.msp-status {
  border-top: 1px solid var(--border, #3a3a3a);
  padding: 6px 12px;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--muted, #8a8884);
  min-height: 26px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
}
.msp-status-latex {
  color: var(--accent, #c678dd);
}
.msp-status-desc {
  color: var(--ink, #e8e6e3);
}
.msp-empty {
  padding: 20px 16px;
  text-align: center;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
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
 * 数学符号快捷插入面板 —— 浮动面板，通过按钮点击或 Ctrl+/ 键盘快捷键展开/收起。
 *
 * 功能：
 * - 符号按类别分组（逻辑 / 集合论 / 代数 / 关系 / 箭头 / 希腊字母）
 * - 搜索框按符号名称、LaTeX 命令或含义过滤
 * - 点击符号调用 onInsert 回调，将符号文本插入到当前焦点输入框
 * - 记录最近使用的 8 个符号（按 char 去重，最新在前）
 * - 每个符号 hover 时在底部状态栏显示 LaTeX 命令与含义（同时提供原生 title 提示）
 *
 * 浮动面板定位在触发按钮上方，最大高度 320px，内部可滚动，暗色主题。
 *
 * 自管理打开状态（监听全局 Ctrl+/ 切换、Escape 关闭、点击外部关闭），
 * 同时支持外部受控（`open` / `onOpenChange`）。
 */
function MathSymbolPaletteImpl({
  onInsert,
  trigger = 'button',
  open,
  onOpenChange,
}: MathSymbolPaletteProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<MathSymbol[]>([])
  const [hovered, setHovered] = useState<MathSymbol | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 用 ref 保存最新的回调，避免全局监听器闭包过期
  const onInsertRef = useRef(onInsert)
  useEffect(() => {
    onInsertRef.current = onInsert
  })
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })
  const isOpenRef = useRef(false)
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const openPanel = useCallback(() => {
    setIsOpen(true)
    onOpenChangeRef.current?.(true)
  }, [])

  const closePanel = useCallback(() => {
    setIsOpen(false)
    onOpenChangeRef.current?.(false)
  }, [])

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev
      onOpenChangeRef.current?.(next)
      return next
    })
  }, [])

  // 外部受控：open 变化时同步内部状态
  useEffect(() => {
    if (open === undefined) return
    setIsOpen(open)
  }, [open])

  // 全局键盘监听：Ctrl+/ (或 Cmd+/) 切换，Escape 关闭
  // Ctrl+/ 是控制序列而非可打印字符，因此在输入框中也可安全触发
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key === '/'
      ) {
        e.preventDefault()
        togglePanel()
      } else if (e.key === 'Escape' && isOpenRef.current) {
        closePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel, closePanel])

  // 点击面板外部时关闭
  useEffect(() => {
    if (!isOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closePanel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen, closePanel])

  // 打开时自动聚焦搜索框；关闭时重置搜索与 hover 状态
  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => searchRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
    setQuery('')
    setHovered(null)
  }, [isOpen])

  const handleInsert = useCallback((sym: MathSymbol) => {
    onInsertRef.current?.(sym.char, sym.latex)
    // 按 char 去重并置于首位，保留最近 MAX_RECENT 个
    setRecent((prev) => {
      const filtered = prev.filter((s) => s.char !== sym.char)
      return [sym, ...filtered].slice(0, MAX_RECENT)
    })
  }, [])

  // 过滤 + 按类别分组
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (s: MathSymbol): boolean => {
      if (!q) return true
      return (
        s.char.toLowerCase().includes(q) ||
        s.latex.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      )
    }
    const filtered = q ? SYMBOLS.filter(match) : SYMBOLS

    const buckets = new Map<string, MathSymbol[]>()
    CATEGORY_ORDER.forEach((c) => buckets.set(c, []))
    filtered.forEach((s) => {
      const bucket = buckets.get(s.category)
      if (bucket) {
        bucket.push(s)
      } else {
        buckets.set(s.category, [s])
      }
    })

    const result: { category: string; items: MathSymbol[] }[] = []
    buckets.forEach((items, category) => {
      if (items.length > 0) {
        result.push({ category, items })
      }
    })
    return result
  }, [query])

  // 仅在无搜索词时显示「最近使用」
  const showRecent = recent.length > 0 && !query.trim()
  const hasResults = sections.length > 0 || showRecent

  const showButton = trigger === 'button'

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PALETTE_CSS }} />
      <div className="msp-wrap" ref={wrapperRef}>
        {showButton && (
          <button
            type="button"
            className={'msp-trigger' + (isOpen ? ' active' : '')}
            onClick={togglePanel}
            aria-label="数学符号面板"
            aria-expanded={isOpen}
            title="数学符号 (Ctrl+/)"
          >
            {'\u03a3'}
          </button>
        )}
        {isOpen && (
          <div className="msp-panel" role="dialog" aria-label="数学符号面板">
            <div className="msp-search">
              <input
                ref={searchRef}
                className="msp-search-input"
                type="text"
                placeholder="搜索符号 / LaTeX / 含义…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="msp-scroll">
              {showRecent && (
                <div className="msp-section">
                  <div className="msp-section-label">最近使用</div>
                  <div className="msp-grid">
                    {recent.map((s) => (
                      <button
                        key={'recent-' + s.name}
                        type="button"
                        className="msp-sym recent"
                        onClick={() => handleInsert(s)}
                        onMouseEnter={() => setHovered(s)}
                        onMouseLeave={() => setHovered(null)}
                        title={s.latex + ' — ' + s.desc}
                      >
                        {s.char}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {hasResults ? (
                sections.map(({ category, items }) => (
                  <div key={category} className="msp-section">
                    <div className="msp-section-label">{category}</div>
                    <div className="msp-grid">
                      {items.map((s) => (
                        <button
                          key={category + '-' + s.name}
                          type="button"
                          className="msp-sym"
                          onClick={() => handleInsert(s)}
                          onMouseEnter={() => setHovered(s)}
                          onMouseLeave={() => setHovered(null)}
                          title={s.latex + ' — ' + s.desc}
                        >
                          {s.char}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="msp-empty">没有匹配的符号</div>
              )}
            </div>
            <div className="msp-status">
              {hovered ? (
                <>
                  <span className="msp-status-latex">{hovered.latex}</span>
                  <span>{'—'}</span>
                  <span className="msp-status-desc">{hovered.desc}</span>
                </>
              ) : (
                '悬停查看 LaTeX 与含义'
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export const MathSymbolPalette = memo(MathSymbolPaletteImpl)
