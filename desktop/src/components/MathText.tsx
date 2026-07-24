import { memo, useMemo } from 'react'
import katex from 'katex'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'

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

// Configure DOMPurify to allow only KaTeX-safe HTML
// KaTeX output uses: span, mathml elements, aria attributes, class, style
const purifyConfig = {
  ALLOWED_TAGS: [
    'span', 'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
    'msubsup', 'mfrac', 'mroot', 'msqrt', 'mtable', 'mtr', 'mtd', 'mtext',
    'mspace', 'annotation', 'menclose', 'mover', 'munder', 'munderover',
  ],
  ALLOWED_ATTR: ['class', 'style', 'aria-hidden', 'aria-label', 'role', 'mathvariant'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
}

/**
 * Basic HTML escaper for SSR/test fallback.
 * In production (Electron renderer), DOMPurify sanitization is always used.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitize HTML using DOMPurify if available (browser/Electron renderer).
 * Falls back to HTML escaping in Node.js/SSR/test environments.
 */
function sanitizeHtml(html: string): string {
  // DOMPurify requires a DOM (window) to be fully initialized.
  // In Electron renderer (production), this is always the case.
  if (typeof DOMPurify?.sanitize === 'function') {
    return DOMPurify.sanitize(html, purifyConfig) as string
  }
  // Fallback: basic HTML escaping (strips all HTML tags, returns safe text)
  return escapeHtml(html)
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    const rawHtml = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
    })
    // Security: Sanitize KaTeX HTML output to prevent XSS
    return sanitizeHtml(rawHtml)
  } catch {
    // Security: Even fallback text is sanitized
    return sanitizeHtml(tex)
  }
}

interface Segment {
  type: 'text' | 'inline-math' | 'display-math'
  content: string
}

function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  let remaining = input

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
            <span
              key={i}
              dangerouslySetInnerHTML={{ __html: renderTex(seg.content, false) }}
            />
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
