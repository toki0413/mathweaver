import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { ReactNode } from 'react'
import { CayleyTable } from '@/components/CayleyTable'

/**
 * Render a React element to an HTML string.
 *
 * `jsdom` is not installed (and the task forbids installing new npm packages),
 * so we render via react-dom/server. CayleyTable derives its closure /
 * associativity badges during render through useMemo, so the initial server
 * render already contains every assertion target we need.
 */
function render(node: ReactNode): string {
  return renderToString(node)
}

const noop = () => {}

// S3 (symmetric group on 3 letters) multiplication table — a real 6x6 group.
const S3: number[][] = [
  [0, 1, 2, 3, 4, 5],
  [1, 0, 4, 5, 2, 3],
  [2, 5, 0, 4, 3, 1],
  [3, 4, 5, 0, 1, 2],
  [4, 3, 1, 2, 5, 0],
  [5, 2, 3, 1, 0, 4],
]

// Z3 — cyclic group of order 3.
const Z3: number[][] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
]

describe('CayleyTable', () => {
  it('loads the S3 preset as a valid 6x6 group (closed + associative)', () => {
    const html = render(<CayleyTable table={S3} size={6} onChange={noop} />)

    // All six row/column headers (0..5) and their cell inputs are rendered.
    for (let i = 0; i < 6; i++) {
      expect(html).toContain(`aria-label="元素 ${i} 与元素 0 的运算结果"`)
    }
    // S3 is a genuine group → closure and associativity both pass.
    expect(html).toContain('✓ 闭合')
    expect(html).toContain('✓ 结合律')
  })

  it('detects associativity for Z3 (cyclic group)', () => {
    const html = render(<CayleyTable table={Z3} size={3} onChange={noop} />)

    expect(html).toContain('✓ 闭合')
    expect(html).toContain('✓ 结合律')
    expect(html).not.toContain('非结合律')
  })

  it('detects non-associativity', () => {
    // `non-assoc` preset from App.tsx — closed but not associative.
    const nonAssoc: number[][] = [
      [0, 1, 2],
      [1, 1, 0],
      [2, 0, 2],
    ]

    const html = render(<CayleyTable table={nonAssoc} size={3} onChange={noop} />)

    expect(html).toContain('✓ 闭合')
    expect(html).toContain('✗ 非结合律')
  })

  it('detects closure violation for out-of-range cell values', () => {
    // Value 5 in a 3x3 table is outside [0, 2] → operation not closed.
    const notClosed: number[][] = [
      [0, 1, 5],
      [1, 2, 0],
      [2, 0, 1],
    ]

    const html = render(<CayleyTable table={notClosed} size={3} onChange={noop} />)

    expect(html).toContain('✗ 未闭合')
    // Closure failure also invalidates associativity (operation ill-defined).
    expect(html).toContain('✗ 非结合律')
  })

  it('exposes aria-label attributes for accessibility', () => {
    const html = render(<CayleyTable table={Z3} size={3} onChange={noop} />)

    // The <table> element carries an aria-label of the form "3×3 运算表".
    // Use a regex so the exact multiplication-sign byte does not matter.
    expect(html).toMatch(/aria-label="3.3 运算表"/)
    // The status region summarising the verification result is labelled.
    expect(html).toContain('aria-label="验证结果：')
    // Every cell input has a descriptive aria-label.
    expect(html).toContain('aria-label="元素 0 与元素 0 的运算结果"')
    expect(html).toContain('aria-label="元素 2 与元素 2 的运算结果"')
  })
})
