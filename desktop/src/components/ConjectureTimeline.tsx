import { memo, useState } from 'react'
import { MathText } from './MathText'

/**
 * ConjectureTimeline — visualizes the student's conjecture journey
 * as a vertical timeline, showing each conjecture, its verdict,
 * and refinement chains (conjecture -> refutation -> correction).
 *
 * Enhanced features:
 * - Hover highlights on timeline entries
 * - Expand/collapse for counter-examples
 * - Animated entry transitions
 * - Accessibility labels
 */

export interface ConjectureEntry {
  step: number
  claim: string
  verdict: 'confirmed' | 'refuted' | 'undecidable'
  counter_example?: string | null
  timestamp?: string
  is_refinement?: boolean
}

export interface RefinementChain {
  steps: number[]
  claim: string
}

interface ConjectureTimelineProps {
  timeline: ConjectureEntry[]
  refinementChains?: RefinementChain[]
  totalConjectures?: number
  confirmed?: number
  refuted?: number
}

const verdictConfig = {
  confirmed: {
    label: '成立',
    color: 'var(--ok)',
    symbol: '\u2713',
    bg: 'rgba(152, 195, 121, 0.1)',
    className: 'verdict-confirmed',
  },
  refuted: {
    label: '被反驳',
    color: 'var(--err)',
    symbol: '\u2717',
    bg: 'rgba(224, 108, 117, 0.08)',
    className: 'verdict-refuted',
  },
  undecidable: {
    label: '待定',
    color: 'var(--warn)',
    symbol: '?',
    bg: 'rgba(229, 192, 123, 0.1)',
    className: 'verdict-undecidable',
  },
}

function ConjectureTimelineImpl({
  timeline,
  refinementChains = [],
  totalConjectures,
  confirmed = 0,
  refuted = 0,
}: ConjectureTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [hoveredChain, setHoveredChain] = useState<number | null>(null)

  if (!timeline || timeline.length === 0) {
    return (
      <div className="conjecture-timeline-empty">
        <div className="conjecture-empty-icon">?</div>
        <p>尚未提出猜想</p>
        <p className="conjecture-empty-hint">用「我猜…」来试探一个数学命题</p>
      </div>
    )
  }

  const count = totalConjectures ?? timeline.length
  const undecided = count - confirmed - refuted

  const toggleExpand = (step: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step)
      else next.add(step)
      return next
    })
  }

  return (
    <div className="conjecture-timeline">
      {/* Summary bar with visual breakdown */}
      <div className="timeline-summary">
        <span className="summary-item">
          <span className="summary-dot summary-total" />
          共 {count}
        </span>
        <span className="summary-item">
          <span className="summary-dot summary-confirmed" />
          成立 {confirmed}
        </span>
        <span className="summary-item">
          <span className="summary-dot summary-refuted" />
          反驳 {refuted}
        </span>
        {undecided > 0 && (
          <span className="summary-item">
            <span className="summary-dot summary-undecided" />
            待定 {undecided}
          </span>
        )}
        {/* Progress bar */}
        <div className="timeline-progress">
          <div
            className="timeline-progress-fill confirmed"
            style={{ width: `${(confirmed / count) * 100}%` }}
          />
          <div
            className="timeline-progress-fill refuted"
            style={{ width: `${(refuted / count) * 100}%` }}
          />
        </div>
      </div>

      <div className="timeline-track">
        <div className="timeline-line" />

        {timeline.map((entry, i) => {
          const cfg = verdictConfig[entry.verdict] || verdictConfig.undecidable
          const isExpanded = expandedSteps.has(entry.step)
          const hasCounterExample = entry.counter_example && entry.counter_example.trim()

          return (
            <div
              key={i}
              className={`timeline-entry ${cfg.className} ${entry.is_refinement ? 'is-refinement' : ''}`}
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              {/* Timeline dot */}
              <div className={`timeline-dot ${cfg.className}`}>
                <span className="timeline-dot-symbol">{cfg.symbol}</span>
              </div>

              {/* Entry card */}
              <div className={`timeline-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="timeline-card-header">
                  <span className="timeline-step">#{entry.step}</span>
                  {entry.is_refinement && (
                    <span className="timeline-refinement-badge">修正</span>
                  )}
                  <span className={`timeline-verdict ${cfg.className}`}>
                    {cfg.symbol} {cfg.label}
                  </span>
                </div>

                <div className="timeline-claim">
                  <MathText>{entry.claim}</MathText>
                </div>

                {hasCounterExample && (
                  <div
                    className="timeline-counter-toggle"
                    onClick={() => toggleExpand(entry.step)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? '收起反例' : '展开反例'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleExpand(entry.step)
                      }
                    }}
                  >
                    <span className="counter-toggle-icon">{isExpanded ? '\u25BC' : '\u25B8'}</span>
                    反例
                  </div>
                )}

                {hasCounterExample && isExpanded && (
                  <div className="timeline-counter-example">
                    <MathText>{entry.counter_example ?? ''}</MathText>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {refinementChains.length > 0 && (
        <div className="refinement-chains-section">
          <div className="refinement-chains-label">修正链</div>
          {refinementChains.map((chain, i) => (
            <div
              key={i}
              className={`refinement-chain ${hoveredChain === i ? 'chain-hovered' : ''}`}
              onMouseEnter={() => setHoveredChain(i)}
              onMouseLeave={() => setHoveredChain(null)}
            >
              <div className="chain-steps">
                {chain.steps.map((s, j) => (
                  <span key={j} className="chain-step">
                    <span className="chain-step-num">#{s}</span>
                    {j < chain.steps.length - 1 && <span className="chain-arrow">{'\u2192'}</span>}
                  </span>
                ))}
              </div>
              <div className="chain-claim">
                <MathText>{chain.claim}</MathText>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const ConjectureTimeline = memo(ConjectureTimelineImpl)
