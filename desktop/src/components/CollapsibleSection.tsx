import { useState, useCallback, type ReactNode } from 'react'
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
 */
export function CollapsibleSection({
  title,
  hint,
  children,
  defaultOpen = false,
  badge,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  const toggle = useCallback(() => setOpen(p => !p), [])

  return (
    <div className={`collapsible-section ${open ? 'open' : ''}`}>
      <button className="collapsible-header" onClick={toggle} aria-expanded={open}>
        <ChevronDownIcon size={14} className="collapsible-chevron" />
        <span className="collapsible-title">{title}</span>
        {hint && <span className="collapsible-hint">{hint}</span>}
        {badge && <span className="collapsible-badge">{badge}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  )
}
