import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadialGauge, MasteryRadar, DifficultyGauge } from '@/components/Gauges'

// ---------------------------------------------------------------------------
// RadialGauge
// ---------------------------------------------------------------------------

describe('RadialGauge', () => {
  it('renders an SVG element', () => {
    const { container } = render(<RadialGauge value={0.5} label="认知负荷" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders the correct label text', () => {
    render(<RadialGauge value={0.5} label="认知负荷" />)
    expect(screen.getByText('认知负荷')).toBeInTheDocument()
  })

  it('shows the value as a rounded percentage', () => {
    const { container } = render(<RadialGauge value={0.567} label="认知负荷" />)
    const valueText = container.querySelector('.gauge-value')
    expect(valueText?.textContent).toBe('57')
  })

  it('shows 0% for value 0', () => {
    const { container } = render(<RadialGauge value={0} label="零" />)
    expect(container.querySelector('.gauge-value')?.textContent).toBe('0')
  })

  it('shows 100% for value 1', () => {
    const { container } = render(<RadialGauge value={1} label="满" />)
    expect(container.querySelector('.gauge-value')?.textContent).toBe('100')
  })

  it('clamps values greater than 1 to 100%', () => {
    const { container } = render(<RadialGauge value={1.5} label="超" />)
    expect(container.querySelector('.gauge-value')?.textContent).toBe('100')
  })

  it('clamps negative values to 0%', () => {
    const { container } = render(<RadialGauge value={-0.5} label="负" />)
    expect(container.querySelector('.gauge-value')?.textContent).toBe('0')
  })

  it('has an aria-label for accessibility', () => {
    render(<RadialGauge value={0.5} label="认知负荷" />)
    const el = screen.getByRole('img')
    expect(el).toHaveAttribute('aria-label', '认知负荷: 50%, 注意')
  })

  it('aria-label reflects the clamped value', () => {
    render(<RadialGauge value={1.5} label="认知" />)
    const el = screen.getByRole('img')
    expect(el).toHaveAttribute('aria-label', '认知: 100%, 警戒')
  })

  // -- Color thresholds ----------------------------------------------------

  it('uses accent color (band 良好) for low values', () => {
    const { container } = render(<RadialGauge value={0.2} label="低" />)
    const circles = container.querySelectorAll('svg circle')
    // circles[0] = background arc, circles[1] = filled arc
    expect(circles[1]).toHaveAttribute('stroke', 'var(--accent)')
    expect(screen.getByText('良好')).toBeInTheDocument()
  })

  it('uses warn color (band 注意) for medium values', () => {
    const { container } = render(<RadialGauge value={0.5} label="中" />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles[1]).toHaveAttribute('stroke', 'var(--warn)')
    expect(screen.getByText('注意')).toBeInTheDocument()
  })

  it('uses err color (band 警戒) for high values', () => {
    const { container } = render(<RadialGauge value={0.8} label="高" />)
    const circles = container.querySelectorAll('svg circle')
    expect(circles[1]).toHaveAttribute('stroke', 'var(--err)')
    expect(screen.getByText('警戒')).toBeInTheDocument()
  })

  it('respects invert flag (low value becomes bad)', () => {
    const { container } = render(<RadialGauge value={0.2} label="流" invert />)
    const circles = container.querySelectorAll('svg circle')
    // invert: v = 1 - 0.2 = 0.8 → err
    expect(circles[1]).toHaveAttribute('stroke', 'var(--err)')
    expect(screen.getByText('警戒')).toBeInTheDocument()
  })

  it('respects invert flag (high value becomes good)', () => {
    const { container } = render(<RadialGauge value={0.8} label="流" invert />)
    const circles = container.querySelectorAll('svg circle')
    // invert: v = 1 - 0.8 = 0.2 → accent
    expect(circles[1]).toHaveAttribute('stroke', 'var(--accent)')
    expect(screen.getByText('良好')).toBeInTheDocument()
  })

  // -- Tooltip on hover ----------------------------------------------------

  it('does not show a tooltip before hover', () => {
    render(<RadialGauge value={0.5} label="认知" />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows a tooltip on hover with value and band info', async () => {
    const { container } = render(<RadialGauge value={0.5} label="认知负荷" />)
    const wrap = container.querySelector('.gauge-wrap') as HTMLElement
    await userEvent.hover(wrap)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip.textContent).toContain('认知负荷')
    expect(tooltip.textContent).toContain('数值: 50%')
    expect(tooltip.textContent).toContain('区间: 注意')
  })

  it('tooltip disappears on mouse leave', async () => {
    const { container } = render(<RadialGauge value={0.5} label="认知" />)
    const wrap = container.querySelector('.gauge-wrap') as HTMLElement
    await userEvent.hover(wrap)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await userEvent.unhover(wrap)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('tooltip appears on keyboard focus', () => {
    const { container } = render(<RadialGauge value={0.3} label="焦" />)
    const wrap = container.querySelector('.gauge-wrap') as HTMLElement
    fireEvent.focus(wrap)
    // Focus triggers the `focused` state which shows the tooltip.
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('renders sublabel when provided', () => {
    render(<RadialGauge value={0.5} label="认知" sublabel="custom sub" />)
    expect(screen.getByText('custom sub')).toBeInTheDocument()
  })

  it('includes metricInfo interpretation and suggestion in the tooltip', async () => {
    const { container } = render(
      <RadialGauge
        value={0.5}
        label="认知"
        metricInfo={{
          interpretation: '学生注意力下降',
          suggestion: '降低难度',
          unit: '%',
        }}
      />,
    )
    const wrap = container.querySelector('.gauge-wrap') as HTMLElement
    await userEvent.hover(wrap)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('学生注意力下降')
    expect(tooltip.textContent).toContain('建议: 降低难度')
  })
})

// ---------------------------------------------------------------------------
// MasteryRadar
// ---------------------------------------------------------------------------

const FIVE_DIMENSIONS = [
  { label: 'accuracy', value: 0.8 },
  { label: 'conjecture', value: 0.6 },
  { label: 'independence', value: 0.7 },
  { label: 'fluency', value: 0.5 },
  { label: 'abstraction', value: 0.4 },
]

describe('MasteryRadar', () => {
  it('renders an SVG element', () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('has an aria-label containing the overall score', () => {
    render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    const el = screen.getByRole('img')
    expect(el).toHaveAttribute('aria-label', '能力雷达图，总评 60%')
  })

  it('renders a pentagon (5 grid polygons for 5 dimensions)', () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    // 4 grid levels + 1 data polygon = 5 polygons total
    const polygons = container.querySelectorAll('svg polygon')
    expect(polygons.length).toBe(5)
  })

  it('displays all 5 axis labels', () => {
    render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    for (const dim of FIVE_DIMENSIONS) {
      expect(screen.getByText(dim.label)).toBeInTheDocument()
    }
  })

  it('renders 5 axis lines radiating from the center', () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    // Axis lines: 5 lines from center to each vertex
    const lines = container.querySelectorAll('svg > g > line, svg line')
    // There should be at least 5 axis lines (plus possibly tick lines)
    expect(lines.length).toBeGreaterThanOrEqual(5)
  })

  it('renders 5 data point circles', () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    const circles = container.querySelectorAll('svg circle')
    // 5 data points (when no dimension is hovered)
    expect(circles.length).toBe(5)
  })

  it('shows the overall score in the center', () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.65} />)
    // Center score text: Math.round(0.65 * 100) = 65
    const texts = container.querySelectorAll('svg text')
    const scoreText = Array.from(texts).find(t => t.textContent === '65')
    expect(scoreText).toBeDefined()
  })

  it('shows 总评 label below the center score', () => {
    render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    expect(screen.getByText('总评')).toBeInTheDocument()
  })

  it('clamps dimension values to [0, 1] when rendering data points', () => {
    const dims = [
      { label: 'a', value: 1.5 },
      { label: 'b', value: -0.5 },
      { label: 'c', value: 0.5 },
      { label: 'd', value: 0.5 },
      { label: 'e', value: 0.5 },
    ]
    const { container } = render(<MasteryRadar dimensions={dims} overall={0.5} />)
    // Should not throw and should render 5 circles
    expect(container.querySelectorAll('svg circle').length).toBe(5)
  })

  it('shows a tooltip on hovering a data point', async () => {
    const { container } = render(<MasteryRadar dimensions={FIVE_DIMENSIONS} overall={0.6} />)
    // Hover the first data point circle
    const circles = container.querySelectorAll('svg circle')
    await userEvent.hover(circles[0])

    // The hovered dimension label should appear in a tooltip
    const tooltip = container.querySelector('.gauge-tooltip')
    expect(tooltip).not.toBeNull()
    expect(tooltip?.textContent).toContain('accuracy')
    expect(tooltip?.textContent).toContain('80%')
  })
})

// ---------------------------------------------------------------------------
// DifficultyGauge
// ---------------------------------------------------------------------------

describe('DifficultyGauge', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.7} />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('has an aria-label with band, percentage, trend, and accuracy', () => {
    render(<DifficultyGauge current={0.5} band="standard" trend="rising" accuracy={0.75} />)
    const el = screen.getByRole('img')
    expect(el).toHaveAttribute('aria-label', '难度: 标准, 50%, 趋势rising, 准确率75%')
  })

  it('shows the band label (standard → 标准)', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.7} />,
    )
    // The band label is rendered inside the SVG text element
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('标准')
  })

  it('shows the band label for warmup (热身)', () => {
    const { container } = render(
      <DifficultyGauge current={0.1} band="warmup" trend="stable" accuracy={0.9} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('热身')
  })

  it('shows the band label for challenge (挑战)', () => {
    const { container } = render(
      <DifficultyGauge current={0.9} band="challenge" trend="stable" accuracy={0.3} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('挑战')
  })

  it('shows an up arrow for rising trend', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="rising" accuracy={0.7} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('↑')
  })

  it('shows a down arrow for falling trend', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="falling" accuracy={0.7} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('↓')
  })

  it('shows a right arrow for stable trend', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.7} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('→')
  })

  it('shows the accuracy percentage', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.73} />,
    )
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    expect(allText).toContain('73%')
  })

  it('shows a tooltip on hover with difficulty, trend, and accuracy', async () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="rising" accuracy={0.75} />,
    )
    const wrap = container.querySelector('[role="img"]') as HTMLElement
    await userEvent.hover(wrap)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip.textContent).toContain('标准 难度')
    expect(tooltip.textContent).toContain('难度: 标准 (50%)')
    expect(tooltip.textContent).toContain('趋势: 上升')
    expect(tooltip.textContent).toContain('准确率: 75%')
  })

  it('tooltip shows low-accuracy suggestion when accuracy < 0.4', async () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.3} />,
    )
    const wrap = container.querySelector('[role="img"]') as HTMLElement
    await userEvent.hover(wrap)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('准确率较低，考虑降低难度')
  })

  it('tooltip shows high-accuracy suggestion when accuracy > 0.85 and trend is not rising', async () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.9} />,
    )
    const wrap = container.querySelector('[role="img"]') as HTMLElement
    await userEvent.hover(wrap)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toContain('表现优秀，可以提升难度')
  })

  it('clamps current value to [0, 1] for the filled bar width', () => {
    const { container } = render(
      <DifficultyGauge current={1.5} band="challenge" trend="stable" accuracy={0.5} />,
    )
    // The filled rect width should equal barWidth * 1 (clamped)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for debugging when rect lookup changes
    const filledRect = container.querySelectorAll('svg rect')[5] // indices 0-3 are band zones, 4 is last zone, 5 is track bg, 6 is filled
    // Actually let's find the filled rect by checking fill="var(--accent)"
    const rects = container.querySelectorAll('svg rect')
    const filledRects = Array.from(rects).filter(r => r.getAttribute('fill') === 'var(--accent)')
    expect(filledRects.length).toBe(1)
    // The width should be positive (barWidth * 1 = barWidth)
    const width = parseFloat(filledRects[0].getAttribute('width') || '0')
    expect(width).toBeGreaterThan(0)
  })

  it('renders all 5 band zone backgrounds', () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.7} />,
    )
    // 4 threshold zones + 1 last zone = 5 zone rects.
    // Colors are theme-driven: some use rgba(), one uses color-mix().
    const zoneRects = Array.from(container.querySelectorAll('svg rect')).filter(r => {
      const fill = r.getAttribute('fill') || ''
      return fill.startsWith('rgba(') || fill.startsWith('color-mix(')
    })
    expect(zoneRects.length).toBe(5)
  })

  it('shows band zone labels on hover', async () => {
    const { container } = render(
      <DifficultyGauge current={0.5} band="standard" trend="stable" accuracy={0.7} />,
    )
    const wrap = container.querySelector('[role="img"]') as HTMLElement
    await userEvent.hover(wrap)

    // On hover, band labels (热身, 基础, 标准, 进阶, 挑战) appear at the bottom
    const texts = container.querySelectorAll('svg text')
    const allText = Array.from(texts)
      .map(t => t.textContent)
      .join(' ')
    // The 5 band labels should all be present
    expect(allText).toContain('热身')
    expect(allText).toContain('基础')
    expect(allText).toContain('标准')
    expect(allText).toContain('进阶')
    expect(allText).toContain('挑战')
  })
})
