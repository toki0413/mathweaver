import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * MathText — renders text containing inline ($...$) and display ($$...$$)
 * LaTeX math expressions using KaTeX.
 *
 * Non-math text is rendered as plain text, preserving the manuscript
 * typography established by the design system.
 */

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
    })
  } catch {
    return tex
  }
}

interface Segment {
  type: 'text' | 'inline-math' | 'display-math'
  content: string
}

function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  let remaining = input

  // Pattern: $$...$$ (display), $...$ (inline)
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(remaining)) !== null) {
    // Text before the match
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

  // Remaining text
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
