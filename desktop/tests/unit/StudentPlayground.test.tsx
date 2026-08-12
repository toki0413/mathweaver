import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { StudentPlayground, BumpGame, MatchGame, ColorView } from '@/components/StudentPlayground'

// The playground plays sound on every interaction. Mock the sound singleton so
// tests never touch the Web Audio API (jsdom's stub lacks createBufferSource /
// createBiquadFilter needed by the 'whoosh' noise effect).
vi.mock('@/utils/sound', () => ({
  soundSystem: { play: vi.fn() },
}))

// Z2 — cyclic group of order 2.
const Z2: number[][] = [
  [0, 1],
  [1, 0],
]

// Z3 — cyclic group of order 3. Identity 0; inverses 0↔0, 1↔2 (commutative).
const Z3: number[][] = [
  [0, 1, 2],
  [1, 2, 0],
  [2, 0, 1],
]

// S3 — non-commutative 6x6 group.
const S3: number[][] = [
  [0, 1, 2, 3, 4, 5],
  [1, 0, 4, 5, 2, 3],
  [2, 5, 0, 4, 3, 1],
  [3, 4, 5, 0, 1, 2],
  [4, 3, 1, 2, 5, 0],
  [5, 2, 3, 1, 0, 4],
]

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * A match card button renders its number on both the back and the front face,
 * so its accessible name is e.g. "1 1" rather than "1". Locate the card by its
 * class and text content instead of by role name.
 */
function matchCard(n: number): HTMLElement {
  const cards = Array.from(document.querySelectorAll('.sp-match-card'))
  const card = cards.find(c => c.querySelector('.sp-card-back-num')?.textContent === String(n))
  if (!card) throw new Error(`match card ${n} not found`)
  return card as HTMLElement
}

// ---------------------------------------------------------------------------
// StudentPlayground — mode switching
// ---------------------------------------------------------------------------

describe('StudentPlayground', () => {
  it('renders bump mode by default', () => {
    render(<StudentPlayground table={Z3} size={3} ageLevel="tweens" />)
    // The bump element pool is present; the match grid is not.
    expect(document.querySelector('.sp-bump-pool')).not.toBeNull()
    expect(document.querySelector('.sp-match-grid')).toBeNull()
  })

  it('switches to match mode when the 逆元配对 tab is clicked', () => {
    render(<StudentPlayground table={Z3} size={3} ageLevel="tweens" />)
    fireEvent.click(screen.getByRole('button', { name: /逆元配对/ }))
    expect(document.querySelector('.sp-match-grid')).not.toBeNull()
    expect(document.querySelector('.sp-bump-pool')).toBeNull()
  })

  it('switches to color mode when the 颜色视图 tab is clicked', () => {
    render(<StudentPlayground table={Z3} size={3} ageLevel="tweens" />)
    fireEvent.click(screen.getByRole('button', { name: /颜色视图/ }))
    expect(document.querySelector('.sp-color-table')).not.toBeNull()
  })

  it('renders age-specific mode labels for kids', () => {
    render(<StudentPlayground table={Z3} size={3} ageLevel="kids" />)
    expect(screen.getByRole('button', { name: /碰一碰/ })).toBeInTheDocument()
    // "找搭档" appears both as a mode tab and as a guided-task button.
    expect(screen.getAllByRole('button', { name: /找搭档/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /彩色表/ })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// BumpGame
// ---------------------------------------------------------------------------

describe('BumpGame', () => {
  it('computes a∗b and shows the formal bridge after two selections', () => {
    render(<BumpGame table={Z3} size={3} ageLevel="tweens" />)
    // Select element 1 then element 2 → 1∗2 = 0 in Z3.
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByText('table[1][2] = 0')).toBeInTheDocument()
  })

  it('highlights the computation cell via onHighlightCell', () => {
    const onHighlightCell = vi.fn()
    render(<BumpGame table={Z3} size={3} ageLevel="tweens" onHighlightCell={onHighlightCell} />)
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    expect(onHighlightCell).toHaveBeenCalledWith({ row: 1, col: 2, type: 'computation' })
  })

  it('records recent computations in the history list', () => {
    render(<BumpGame table={Z2} size={2} ageLevel="tweens" />)
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    // 0∗1 = 1 in Z2 — the history list records the operation.
    const historyItems = document.querySelectorAll('.sp-history-item')
    expect(historyItems.length).toBe(1)
    expect(historyItems[0].textContent).toContain('0')
    expect(historyItems[0].textContent).toContain('1')
  })

  it('does not crash when choosing an element already in a slot (elements disabled)', () => {
    render(<BumpGame table={Z2} size={2} ageLevel="tweens" />)
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    // Both slots filled — further pool clicks are disabled.
    expect((screen.getByRole('button', { name: '0' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MatchGame
// ---------------------------------------------------------------------------

describe('MatchGame', () => {
  it('matches two inverse cards and shows the formal equation', () => {
    render(<MatchGame table={Z3} size={3} ageLevel="tweens" />)
    // In Z3, 1 and 2 are inverses (1∗2 = 0 = e).
    fireEvent.click(matchCard(1))
    fireEvent.click(matchCard(2))
    // The matched card gets the 'matched' class.
    expect(matchCard(1).className).toContain('matched')
    expect(matchCard(2).className).toContain('matched')
  })

  it('updates the progress counter after a successful match', () => {
    render(<MatchGame table={Z3} size={3} ageLevel="tweens" />)
    fireEvent.click(matchCard(1))
    fireEvent.click(matchCard(2))
    // Z3 has 2 unique pairs (0 self, 1-2); one is now matched.
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
  })

  it('does not match non-inverse cards', () => {
    render(<MatchGame table={Z3} size={3} ageLevel="tweens" />)
    // 0 and 1 are not inverses in Z3 (0∗1 = 1 ≠ 0).
    fireEvent.click(matchCard(0))
    fireEvent.click(matchCard(1))
    expect(matchCard(0).className).not.toContain('matched')
  })
})

// ---------------------------------------------------------------------------
// ColorView
// ---------------------------------------------------------------------------

describe('ColorView', () => {
  it('shows the commutativity badge for a symmetric table', () => {
    render(<ColorView table={Z3} size={3} ageLevel="tweens" />)
    expect(screen.getByText('· 满足交换律')).toBeInTheDocument()
  })

  it('shows the non-commutative badge for S3', () => {
    render(<ColorView table={S3} size={6} ageLevel="tweens" />)
    expect(screen.getByText('× 不满足交换律')).toBeInTheDocument()
  })

  it('shows the identity element badge', () => {
    render(<ColorView table={Z3} size={3} ageLevel="tweens" />)
    expect(screen.getByText('★ 单位元 = 0')).toBeInTheDocument()
  })

  it('toggles cell numbers on and off', () => {
    render(<ColorView table={Z3} size={3} ageLevel="tweens" />)
    const cells = document.querySelectorAll('.sp-color-cell')
    // Numbers are visible by default.
    expect(document.querySelectorAll('.sp-cell-num').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /数字/ }))
    expect(document.querySelectorAll('.sp-cell-num').length).toBe(0)
    expect(cells.length).toBe(3 * 3)
  })

  it('reports the hovered cell to onHighlightCell', () => {
    const onHighlightCell = vi.fn()
    render(<ColorView table={Z3} size={3} ageLevel="tweens" onHighlightCell={onHighlightCell} />)
    const cells = document.querySelectorAll('.sp-color-cell')
    // cells[0] is row 0, col 0 (value 0).
    fireEvent.mouseEnter(cells[0])
    expect(onHighlightCell).toHaveBeenCalledWith({ row: 0, col: 0, type: 'computation' })
    fireEvent.mouseLeave(cells[0])
    expect(onHighlightCell).toHaveBeenCalledWith(null)
  })
})
