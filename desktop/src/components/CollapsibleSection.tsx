import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { ChevronDownIcon } from './Icons'

interface CollapsibleSectionProps {
  title: string
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: string
}

/**
 * A progressively-disclosed section.
 * Used to group secondary tools without overwhelming the main column.
 *
 * Accessibility: when collapsed, the content container receives the `inert`
 * attribute so that its descendants are removed from the accessibility tree
 * and the focus (tab) order. This prevents axe violations inside collapsed
 * sections and ensures Tab navigation skips hidden content.
 */
export function CollapsibleSection({
  title,
  hint,
  children,
  defaultOpen = false,
  badge,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  // useState 只在挂载时读一次 defaultOpen，需用 useEffect 同步外部更新
  useEffect(() => {
    setOpen(defaultOpen)
  }, [defaultOpen])
  const headerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Sync the `inert` property on the content container.
  // Using a ref + useEffect because @types/react does not include `inert`
  // as a known JSX prop in older versions.
  useEffect(() => {
    if (contentRef.current) {
      // The DOM `inert` property is a boolean; setting it removes the
      // element and its descendants from the accessibility tree and tab order.
      contentRef.current.inert = !open
    }
  }, [open])

  const toggle = useCallback(() => {
    setOpen(p => {
      const next = !p
      // When opening, scroll the header into view so the expanded content is visible
      if (next && headerRef.current) {
        requestAnimationFrame(() => {
          // block: 'nearest' 避免标题被 sticky header 遮挡
          headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
      return next
    })
  }, [])

  return (
    <div className={`collapsible-section ${open ? 'open' : ''}`}>
      <button ref={headerRef} className="collapsible-header" onClick={toggle} aria-expanded={open}>
        <ChevronDownIcon size={14} className="collapsible-chevron" />
        <span className="collapsible-title">{title}</span>
        {hint && <span className="collapsible-hint">{hint}</span>}
        {badge && <span className="collapsible-badge">{badge}</span>}
      </button>
      <div
        ref={contentRef}
        className="collapsible-content"
        style={{
          maxHeight: open ? '9999px' : '0px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease',
        }}
      >
        <div className="collapsible-body">{children}</div>
      </div>
    </div>
  )
}
