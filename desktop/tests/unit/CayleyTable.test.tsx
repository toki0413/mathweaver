import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { CayleyTable } from '@/components/CayleyTable'

const noop = () => {}

// S3 (symmetric group on 3 letters) — a real 6x6 group.
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

// Closed but not associative (and commutative).
const NON_ASSOC: number[][] = [
  [0, 1, 2],
  [1, 1, 0],
  [2, 0, 2],
]

// Closed but not commutative: table[1][0]=0 ≠ table[0][1]=1.
const NON_COMMUTATIVE: number[][] = [
  [0, 1, 2],
  [0, 2, 1],
  [2, 1, 0],
]

// Not closed: value 5 outside [0,2].
const NOT_CLOSED: number[][] = [
  [0, 1, 5],
  [1, 2, 0],
  [2, 0, 1],
]

// Z2 — small table that becomes a valid group once (0,0) is fixed to 0.
// Initially: not closed (5) and no identity row, so every axiom is un-satisfied.
const BROKEN_Z2: number[][] = [
  [5, 1],
  [1, 0],
]

/**
 * Stateful wrapper so that edits actually propagate back into the `table` prop
 * the way a real parent would. This lets the axiom badges re-evaluate after
 * fireEvent.change on a cell input.
 */
function StatefulCayley({
  initialTable,
  onChange,
  ...rest
}: {
  initialTable: number[][]
  onChange?: (r: number, c: number, v: number) => void
} & Omit<ComponentProps<typeof CayleyTable>, 'table' | 'onChange'>) {
  const [table, setTable] = useState(initialTable)
  return (
    <CayleyTable
      {...rest}
      table={table}
      onChange={(r, c, v) => {
        setTable(prev => {
          const next = prev.map(row => [...row])
          next[r][c] = v
          return next
        })
        onChange?.(r, c, v)
      }}
    />
  )
}

function cellInput(row: number, col: number): HTMLInputElement {
  return screen.getByLabelText(`元素 ${row} 与元素 ${col} 的运算结果`) as HTMLInputElement
}

describe('CayleyTable — structure & axiom detection', () => {
  it('loads the S3 preset as a valid 6x6 group (closed + associative)', () => {
    render(<CayleyTable table={S3} size={6} onChange={noop} />)

    for (let i = 0; i < 6; i++) {
      expect(screen.getByLabelText(`元素 ${i} 与元素 0 的运算结果`)).toBeInTheDocument()
    }
    // Success summary for a genuine group.
    expect(screen.getByText(/运算表定义了一个群（非交换群）/)).toBeInTheDocument()
  })

  it('detects associativity for Z3 and reports a commutative group', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} />)

    expect(screen.getByText(/运算表定义了一个交换群/)).toBeInTheDocument()
    expect(screen.getByText('✓ 闭合')).toBeInTheDocument()
    expect(screen.getByText('✓ 结合律')).toBeInTheDocument()
    expect(screen.getByText('✓ 交换律')).toBeInTheDocument()
  })

  it('detects non-associativity and shows the violating triple detail', () => {
    render(<CayleyTable table={NON_ASSOC} size={3} onChange={noop} />)

    expect(screen.getByText('× 非结合律')).toBeInTheDocument()
    expect(screen.getByText(/结合律违反/)).toBeInTheDocument()
  })

  it('detects closure violation and shows the out-of-range note', () => {
    render(<CayleyTable table={NOT_CLOSED} size={3} onChange={noop} />)

    expect(screen.getByText('× 未闭合')).toBeInTheDocument()
    expect(screen.getByText(/表格中存在超出范围的值/)).toBeInTheDocument()
  })

  it('exposes accessibility labels on the grid and cells', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} />)

    expect(screen.getByRole('grid')).toHaveAccessibleName(/3.3 运算表/)
    expect(screen.getByRole('status')).toHaveAccessibleName(/验证结果/)
    expect(cellInput(0, 0)).toBeInTheDocument()
    expect(cellInput(2, 2)).toBeInTheDocument()
  })
})

describe('CayleyTable — cell editing', () => {
  it('commits an in-range edit through onChange', () => {
    const onChange = vi.fn()
    render(<StatefulCayley initialTable={Z3} size={3} onChange={onChange} />)

    fireEvent.change(cellInput(0, 1), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0, 1, 0)
  })

  it('skips the empty transient string but commits the next parsed digit', () => {
    const onChange = vi.fn()
    render(<StatefulCayley initialTable={Z3} size={3} onChange={onChange} />)

    const input = cellInput(0, 1)
    // Clearing the input produces an empty string → parseInt is NaN → no commit.
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
    // Typing a new digit commits the parsed value.
    fireEvent.change(input, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith(0, 1, 2)
  })

  it('flips the closure badge to 未闭合 when an edit puts a value out of range', () => {
    render(<StatefulCayley initialTable={Z3} size={3} />)

    fireEvent.change(cellInput(0, 1), { target: { value: '9' } })
    expect(screen.getByText('× 未闭合')).toBeInTheDocument()
    expect(screen.getByText(/表格中存在超出范围的值/)).toBeInTheDocument()
  })
})

describe('CayleyTable — color mode', () => {
  it('renders cells without inline colors by default', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} />)

    const td = cellInput(0, 0).closest('td')!
    expect(td.getAttribute('style')).toBeNull()
  })

  it('paints cells and text when colorMode is enabled', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} colorMode />)

    const td = cellInput(0, 0).closest('td')!
    expect(td.getAttribute('style')).toContain('background:')
  })

  it('renders the toggle button and fires onToggleColorMode when clicked', () => {
    const onToggle = vi.fn()
    render(<CayleyTable table={Z3} size={3} onChange={noop} onToggleColorMode={onToggle} />)

    const toggle = screen.getByRole('button', { name: 'OFF' })
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('does not render the toggle when onToggleColorMode is absent', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} />)
    expect(screen.queryByRole('button', { name: /OFF/ })).not.toBeInTheDocument()
  })
})

describe('CayleyTable — axiom badges & highlighting', () => {
  it('toggles the closure badge highlight on click', () => {
    render(<CayleyTable table={NOT_CLOSED} size={3} onChange={noop} />)

    const badge = screen.getByRole('button', { name: '× 未闭合' })
    fireEvent.click(badge)
    fireEvent.keyDown(badge, { key: 'Enter' })
    expect(badge).toBeInTheDocument()
  })

  it('highlights the non-commutative badge and reveals the violation pair', () => {
    render(<CayleyTable table={NON_COMMUTATIVE} size={3} onChange={noop} />)

    const badge = screen.getByRole('button', { name: '× 非交换' })
    fireEvent.click(badge)
    expect(screen.getByText(/交换律违反/)).toBeInTheDocument()

    fireEvent.click(badge)
    expect(badge).toBeInTheDocument()
  })

  it('shows the inverse badge and the missing-inverse detail for a non-group table', () => {
    render(<CayleyTable table={NOT_CLOSED} size={3} onChange={noop} />)

    // Not closed → inverses are undefined, badge reports missing.
    expect(screen.getByRole('button', { name: '× 逆元缺失' })).toBeInTheDocument()
  })
})

describe('CayleyTable — discovery callback', () => {
  it('skips discovery on mount but fires it when an edit completes the group', () => {
    const onDiscovery = vi.fn()
    render(<StatefulCayley initialTable={BROKEN_Z2} size={2} onDiscovery={onDiscovery} />)

    // Mount with a broken table fires nothing.
    expect(onDiscovery).not.toHaveBeenCalled()

    // Fix the out-of-range cell (0,0) to 0 → Z2, a valid group.
    fireEvent.change(cellInput(0, 0), { target: { value: '0' } })

    // All five axioms transitioned from un-satisfied to satisfied.
    expect(onDiscovery).toHaveBeenCalled()
    for (const p of ['closure', 'associativity', 'identity', 'inverses', 'commutativity']) {
      expect(onDiscovery).toHaveBeenCalledWith(p)
    }
  })
})

describe('CayleyTable — verification animation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sweeps cells and then highlights the associativity violation triple', () => {
    const { rerender } = render(<CayleyTable table={NON_ASSOC} size={3} onChange={noop} />)

    act(() =>
      rerender(<CayleyTable table={NON_ASSOC} size={3} onChange={noop} verifyTrigger={1} />),
    )

    // Reveal the violating triple after the per-cell sweep completes (3×3=9 steps).
    act(() => {
      vi.advanceTimersByTime(9 * 50)
    })
    expect(screen.getByText(/结合律违反/)).toBeInTheDocument()

    // The 3s highlight timer then clears the animation.
    act(() => {
      vi.advanceTimersByTime(3000)
    })
  })

  it('does nothing when verifyTrigger is 0 or undefined', () => {
    render(<CayleyTable table={Z3} size={3} onChange={noop} verifyTrigger={0} />)
    expect(screen.getByText(/运算表定义了一个交换群/)).toBeInTheDocument()
  })
})
