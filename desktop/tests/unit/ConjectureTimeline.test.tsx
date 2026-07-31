import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import {
  ConjectureTimeline,
  type ConjectureEntry,
  type RefinementChain,
} from '@/components/ConjectureTimeline'
import { useStore } from '@/stores/sessionStore'

// ---------------------------------------------------------------------------
// Mock the Zustand session store.
//
// ConjectureTimeline only consumes `submitConjecture` and
// `conjectureState.loading`. We forward every selector to a mutable state
// object so individual tests can flip `conjectureLoading` on/off.
// ---------------------------------------------------------------------------
const { mockState } = vi.hoisted(() => ({
  mockState: {
    submitConjecture: () => Promise.resolve(),
    conjectureState: { entries: [], loading: false, error: null },
  },
}))

vi.mock('@/stores/sessionStore', () => ({
  useStore: Object.assign(
    vi.fn((selector?: (s: typeof mockState) => unknown) =>
      typeof selector === 'function' ? selector(mockState) : mockState,
    ),
    { getState: () => mockState },
  ),
}))

function resetStore(overrides: Partial<typeof mockState> = {}) {
  mockState.submitConjecture = vi.fn().mockResolvedValue(undefined)
  mockState.conjectureState = { entries: [], loading: false, error: null }
  Object.assign(mockState, overrides)
  vi.mocked(useStore).mockClear()
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_TIMELINE: ConjectureEntry[] = [
  {
    step: 1,
    claim: '所有偶数都可分解为两个素数之和',
    verdict: 'confirmed',
    counter_example: null,
  },
  {
    step: 2,
    claim: '所有奇数都是素数',
    verdict: 'refuted',
    counter_example: '9 = 3 × 3 不是素数',
  },
  {
    step: 3,
    claim: '哥德巴赫猜想成立',
    verdict: 'undecidable',
  },
]

describe('ConjectureTimeline', () => {
  // -------------------------------------------------------------------------
  // Input section
  // -------------------------------------------------------------------------

  it('renders the conjecture input with placeholder "我猜…" and aria-label "输入猜想"', () => {
    render(<ConjectureTimeline timeline={[]} />)

    const input = screen.getByPlaceholderText('我猜…')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-label', '输入猜想')
  })

  it('disables the submit button when the input is empty', () => {
    render(<ConjectureTimeline timeline={[]} />)

    const submitBtn = screen.getByRole('button', { name: '提交猜想' })
    expect(submitBtn).toBeDisabled()
  })

  it('enables the submit button once text is typed and submits the claim', async () => {
    const user = userEvent.setup()
    render(<ConjectureTimeline timeline={[]} />)

    const input = screen.getByLabelText('输入猜想')
    const submitBtn = screen.getByRole('button', { name: '提交猜想' })

    await user.type(input, '任意三角形内角和为 180 度')
    expect(submitBtn).not.toBeDisabled()

    await user.click(submitBtn)

    expect(mockState.submitConjecture).toHaveBeenCalledTimes(1)
    expect(mockState.submitConjecture).toHaveBeenCalledWith('任意三角形内角和为 180 度')
    // The input is cleared after submission, disabling the button again.
    expect(input).toHaveValue('')
    expect(submitBtn).toBeDisabled()
  })

  it('submits the conjecture when pressing Enter inside the input', () => {
    render(<ConjectureTimeline timeline={[]} />)

    const input = screen.getByLabelText('输入猜想')
    fireEvent.change(input, { target: { value: '素数有无穷多个' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockState.submitConjecture).toHaveBeenCalledWith('素数有无穷多个')
  })

  it('does not submit an empty (whitespace-only) conjecture', () => {
    render(<ConjectureTimeline timeline={[]} />)

    const input = screen.getByLabelText('输入猜想')
    fireEvent.change(input, { target: { value: '    ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockState.submitConjecture).not.toHaveBeenCalled()
  })

  it('shows the deferred-input preview while typing', async () => {
    render(<ConjectureTimeline timeline={[]} />)

    const input = screen.getByLabelText('输入猜想')
    fireEvent.change(input, { target: { value: '费马大定理' } })

    await waitFor(() => {
      expect(screen.getByText(/将提交：费马大定理/)).toBeInTheDocument()
    })
  })

  it('disables submit and shows "验证中…" while conjectureLoading is true', () => {
    resetStore({
      conjectureState: { entries: [], loading: true, error: null },
    })

    render(<ConjectureTimeline timeline={[]} />)

    const submitBtn = screen.getByRole('button', { name: '验证中…' })
    expect(submitBtn).toBeDisabled()
  })

  // -------------------------------------------------------------------------
  // Empty timeline
  // -------------------------------------------------------------------------

  it('renders the empty-state message but keeps the input section visible when the timeline is empty', () => {
    render(<ConjectureTimeline timeline={[]} />)

    // Input still present.
    expect(screen.getByLabelText('输入猜想')).toBeInTheDocument()
    // Empty-state copy.
    expect(screen.getByText('尚未提出猜想')).toBeInTheDocument()
    expect(screen.getByText(/用「我猜…」来试探一个数学命题/)).toBeInTheDocument()
    // No summary bar.
    expect(screen.queryByText(/共 /)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Timeline entries
  // -------------------------------------------------------------------------

  it('renders one timeline-entry per entry passed via props', () => {
    const { container } = render(<ConjectureTimeline timeline={SAMPLE_TIMELINE} />)

    const entries = container.querySelectorAll('.timeline-entry')
    expect(entries).toHaveLength(3)

    // Step badges and claims are rendered.
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('所有偶数都可分解为两个素数之和')).toBeInTheDocument()
    expect(screen.getByText('所有奇数都是素数')).toBeInTheDocument()
  })

  it('renders the verdict label and symbol for each entry', () => {
    const { container } = render(<ConjectureTimeline timeline={SAMPLE_TIMELINE} />)

    const entries = container.querySelectorAll('.timeline-entry')
    // confirmed -> ✓ 成立, refuted -> ✗ 被反驳, undecidable -> ? 待定
    expect(within(entries[0] as HTMLElement).getByText(/成立/)).toBeInTheDocument()
    expect(within(entries[1] as HTMLElement).getByText(/被反驳/)).toBeInTheDocument()
    expect(within(entries[2] as HTMLElement).getByText(/待定/)).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Summary bar
  // -------------------------------------------------------------------------

  it('shows the summary bar with correct total, confirmed and refuted counts', () => {
    render(
      <ConjectureTimeline
        timeline={SAMPLE_TIMELINE}
        totalConjectures={5}
        confirmed={2}
        refuted={1}
      />,
    )

    // count = totalConjectures = 5; undecided = 5 - 2 - 1 = 2.
    expect(screen.getByText('共 5')).toBeInTheDocument()
    expect(screen.getByText('成立 2')).toBeInTheDocument()
    expect(screen.getByText('反驳 1')).toBeInTheDocument()
    expect(screen.getByText('待定 2')).toBeInTheDocument()
  })

  it('falls back to timeline length for the total when totalConjectures is omitted', () => {
    render(<ConjectureTimeline timeline={SAMPLE_TIMELINE} confirmed={1} refuted={1} />)

    expect(screen.getByText('共 3')).toBeInTheDocument()
    expect(screen.getByText('成立 1')).toBeInTheDocument()
    expect(screen.getByText('反驳 1')).toBeInTheDocument()
    // 3 - 1 - 1 = 1 undecided.
    expect(screen.getByText('待定 1')).toBeInTheDocument()
  })

  it('omits the undecided summary item when there are no undecided conjectures', () => {
    render(
      <ConjectureTimeline
        timeline={SAMPLE_TIMELINE}
        totalConjectures={2}
        confirmed={1}
        refuted={1}
      />,
    )

    expect(screen.getByText('共 2')).toBeInTheDocument()
    expect(screen.queryByText(/待定 \d+/)).not.toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Expand / collapse
  // -------------------------------------------------------------------------

  it('toggles the expanded class and aria-expanded when an entry is expanded', () => {
    // Use an undecidable entry so expanding does not kick off the async
    // historical-narrative fetch (which would settle outside `act`). The
    // counter-example is rendered for any verdict when present.
    const { container } = render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '一个命题',
            verdict: 'undecidable',
            counter_example: '反例 X',
          },
        ]}
      />,
    )

    const card = container.querySelector('.timeline-card') as HTMLElement
    expect(card).not.toHaveClass('expanded')

    const toggle = screen.getByRole('button', { name: '展开详情' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    const expandedCard = container.querySelector('.timeline-card') as HTMLElement
    expect(expandedCard).toHaveClass('expanded')
    expect(screen.getByRole('button', { name: '收起详情' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    // The counter-example is now visible.
    expect(screen.getByText('反例 X')).toBeInTheDocument()

    // Collapse again.
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    const collapsedCard = container.querySelector('.timeline-card') as HTMLElement
    expect(collapsedCard).not.toHaveClass('expanded')
  })

  it('expands the entry via keyboard (Enter / Space) on the toggle', () => {
    const { container } = render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '键盘可达的命题',
            verdict: 'undecidable',
            counter_example: null,
          },
        ]}
      />,
    )

    const toggle = screen.getByRole('button', { name: '展开详情' })
    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(container.querySelector('.timeline-card')).toHaveClass('expanded')

    fireEvent.keyDown(toggle, { key: ' ' })
    expect(container.querySelector('.timeline-card')).not.toHaveClass('expanded')
  })

  // -------------------------------------------------------------------------
  // Historical narrative cards (T-3.4)
  // -------------------------------------------------------------------------

  it('fetches and displays historical narrative cards when a verified entry is expanded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            title: '欧拉与代数基本定理',
            content: 'e^{iπ}+1=0',
            score: 0.95,
          },
        ],
      }),
    )

    render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '欧拉恒等式成立',
            verdict: 'confirmed',
            counter_example: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    // fetch is called against the historical narrative endpoint.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/historical/narrative',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    // The historical card title, content, score and source appear.
    expect(await screen.findByText('欧拉与代数基本定理')).toBeInTheDocument()
    expect(screen.getByText('e^{iπ}+1=0')).toBeInTheDocument()
    expect(screen.getByText(/95%/)).toBeInTheDocument()
    expect(screen.getByText('来源：HistoricalAgent 检索')).toBeInTheDocument()
  })

  it('handles the backend { entries: [...] } response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          narrative: '背景',
          entries: [{ title: '高斯', content: '内容', score: 0.5 }],
        }),
      }),
    )

    render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '高斯引理',
            verdict: 'refuted',
            counter_example: '反例',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    expect(await screen.findByText('高斯')).toBeInTheDocument()
  })

  it('does not fetch historical narrative for undecidable entries', async () => {
    vi.stubGlobal('fetch', vi.fn())

    render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '未决命题',
            verdict: 'undecidable',
            counter_example: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    // Give any pending microtasks a chance to fire.
    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  it('shows a loading indicator while historical narrative is being fetched', async () => {
    let resolveJson: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise(resolve => {
            resolveJson = resolve
          }),
      ),
    )

    render(
      <ConjectureTimeline
        timeline={[
          {
            step: 1,
            claim: '可证命题',
            verdict: 'confirmed',
            counter_example: null,
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    expect(await screen.findByText('加载历史叙事中…')).toBeInTheDocument()

    // Resolve the fetch; the loading indicator should disappear.
    resolveJson({ ok: true, json: async () => [] })
    await waitFor(() => {
      expect(screen.queryByText('加载历史叙事中…')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Refinement chains
  // -------------------------------------------------------------------------

  it('renders refinement chains when provided', () => {
    const chains: RefinementChain[] = [{ steps: [2, 4], claim: '修正后的命题' }]

    const { container } = render(
      <ConjectureTimeline timeline={SAMPLE_TIMELINE} refinementChains={chains} />,
    )

    const chainSection = container.querySelector('.refinement-chains-section') as HTMLElement
    expect(chainSection).not.toBeNull()

    expect(screen.getByText('修正链')).toBeInTheDocument()
    // Scope to the chain section so the "#2" badge does not clash with the
    // timeline entry whose step is also 2.
    expect(within(chainSection).getByText('#2')).toBeInTheDocument()
    expect(within(chainSection).getByText('#4')).toBeInTheDocument()
    expect(within(chainSection).getByText('修正后的命题')).toBeInTheDocument()
  })

  it('does not render the refinement-chains section when there are no chains', () => {
    render(<ConjectureTimeline timeline={SAMPLE_TIMELINE} />)

    expect(screen.queryByText('修正链')).not.toBeInTheDocument()
  })
})
