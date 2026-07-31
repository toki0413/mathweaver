import { memo, useMemo } from 'react'
import 'katex/dist/katex.min.css'
import { renderTex } from '../utils/katex-render'

/**
 * MathText — renders text containing inline ($...$) and display ($$...$$)
 * LaTeX math expressions using KaTeX.
 *
 * Security: All KaTeX HTML output is sanitized through DOMPurify before
 * being injected via dangerouslySetInnerHTML. This prevents XSS attacks
 * where malicious LaTeX input could inject arbitrary HTML/JS into the DOM.
 * KaTeX's `strict: false` mode is kept for user-friendliness, but the
 * DOMPurify layer ensures no script tags, event handlers, or other
 * dangerous elements survive sanitization.
 *
 * In environments without a DOM (SSR, unit tests), DOMPurify may not be
 * fully initialized, so a basic HTML escaper is used as fallback. Production
 * always runs in Electron's renderer process where DOMPurify is fully functional.
 */

interface Segment {
  type: 'text' | 'inline-math' | 'display-math'
  content: string
}

function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  const remaining = input

  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: remaining.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      segments.push({ type: 'display-math', content: match[1] })
    } else if (match[2] !== undefined) {
      segments.push({ type: 'inline-math', content: match[2] })
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < remaining.length) {
    segments.push({ type: 'text', content: remaining.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: input }]
}

interface MathTextProps {
  children: string
  className?: string
}

function MathTextImpl({ children, className }: MathTextProps) {
  const segments = useMemo(() => parseSegments(children), [children])

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'inline-math') {
          return (
            <span key={i} dangerouslySetInnerHTML={{ __html: renderTex(seg.content, false) }} />
          )
        }
        if (seg.type === 'display-math') {
          return (
            <span
              key={i}
              className="math-display"
              style={{ display: 'block', margin: '0.5em 0', overflowX: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderTex(seg.content, true) }}
            />
          )
        }
        return <span key={i}>{seg.content}</span>
      })}
    </span>
  )
}

export const MathText = memo(MathTextImpl)
