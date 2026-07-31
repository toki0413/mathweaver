import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { ReactNode } from 'react'
import { MathText } from '@/components/MathText'

/**
 * Render a React element to an HTML string.
 *
 * We use react-dom/server instead of a DOM testing library because `jsdom` is
 * not installed in this project (and the task forbids installing new npm
 * packages). `renderToString` produces the same markup a browser would see on
 * first paint, which is enough to assert text content, KaTeX output, and XSS
 * escaping.
 */
function render(node: ReactNode): string {
  return renderToString(node)
}

describe('MathText', () => {
  it('renders plain text verbatim without invoking KaTeX', () => {
    const html = render(<MathText>hello world</MathText>)

    expect(html).toContain('hello world')
    // Plain text must not trigger KaTeX rendering.
    expect(html).not.toContain('katex')
  })

  it('renders inline math $...$ through KaTeX', () => {
    const html = render(<MathText>square of $x^2$ here</MathText>)

    // Surrounding plain text is preserved.
    expect(html).toContain('square of')
    expect(html).toContain('here')
    // KaTeX output container is present.
    expect(html).toContain('katex')
    // Inline math must NOT use the display-mode wrapper.
    expect(html).not.toContain('katex-display')
  })

  it('renders display math $$...$$ through KaTeX in display mode', () => {
    const html = render(<MathText>eq: $$x^2 + y^2 = r^2$$</MathText>)

    // Display-mode KaTeX wraps output in a `katex-display` container.
    expect(html).toContain('katex-display')
    expect(html).toContain('katex')
  })

  it('escapes malicious plain text so no executable markup reaches the DOM (XSS)', () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)>'

    const html = render(<MathText>{payload}</MathText>)

    // React escapes text segments — no raw, executable tags survive. The `<`
    // and `>` are turned into entities, so neither a <script> element nor an
    // <img> element is ever created. (The literal text `onerror=` may still
    // appear as inert text inside the escaped run, but with no surrounding
    // element it cannot fire — that is why we assert against the tag, not the
    // attribute name.)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<img[^>]*onerror/i)
    // The escaped representation should be present instead.
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })

  it('does not let scripts embedded inside math segments execute', () => {
    // KaTeX parses `$...$` as TeX. `<script>` is invalid TeX; with
    // `throwOnError: false` KaTeX emits an error annotation rather than a
    // live script element, and MathText feeds KaTeX output through
    // dangerouslySetInnerHTML only for math segments.
    const html = render(
      <MathText>
        $<script>alert(1)</script>$
      </MathText>,
    )

    // No raw, executable <script> tag should appear in the rendered output.
    expect(html).not.toMatch(/<script[^>]*>/i)
    // KaTeX still produces its container (error output is also KaTeX markup).
    expect(html).toContain('katex')
  })
})
