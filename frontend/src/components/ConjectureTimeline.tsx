import { memo } from 'react'
import { MathText } from './MathText'

/**
 * ConjectureTimeline — visualizes the student's conjecture journey
 * as a horizontal timeline, showing each conjecture, its verdict,
 * and refinement chains (conjecture → refutation → correction).
 *
 * Data comes from the backend's conjecture_journey visual data.
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
    color: 'var(--accent)',
    symbol: '✓',
    bg: 'var(--accent-soft, rgba(176, 74, 48, 0.12))',
  },
  refuted: {
    label: '被反驳',
    color: 'var(--danger, #B04A30)',
    symbol: '✗',
    bg: 'var(--danger-soft, rgba(176, 74, 48, 0.08))',
  },
  undecidable: {
    label: '待定',
    color: 'var(--warning, #C8923A)',
    symbol: '?',
    bg: 'rgba(200, 146, 58, 0.12)',
  },
}

function ConjectureTimelineImpl({
  timeline,
  refinementChains = [],
  totalConjectures,
  confirmed = 0,
  refuted = 0,
}: ConjectureTimelineProps) {
  if (!timeline || timeline.length === 0) {
    return (
      <div className="conjecture-timeline-empty" style={{ padding: '1rem', color: 'var(--ink-soft, #6B6155)', fontSize: '0.85rem' }}>
        尚未提出猜想。用「我猜…」来试探一个数学命题。
      </div>
    )
  }

  const count = totalConjectures ?? timeline.length

  return (
    <div className="conjecture-timeline" style={{ padding: '0.5rem 0' }}>
      {/* Summary header */}
      <div className="timeline-summary" style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '0.75rem',
        fontSize: '0.75rem',
        color: 'var(--ink-soft, #6B6155)',
      }}>
        <span>共 {count} 个猜想</span>
        <span style={{ color: 'var(--accent)' }}>成立 {confirmed}</span>
        <span style={{ color: 'var(--danger, #B04A30)' }}>反驳 {refuted}</span>
      </div>

      {/* Timeline */}
      <div className="timeline-track" style={{ position: 'relative', paddingLeft: '1.5rem' }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute',
          left: '0.5rem',
          top: 0,
          bottom: 0,
          width: '1px',
          background: 'var(--surface-sunk, #D5CFC0)',
        }} />

        {timeline.map((entry, i) => {
          const cfg = verdictConfig[entry.verdict] || verdictConfig.undecidable
          return (
            <div
              key={i}
              className="timeline-entry"
              style={{
                position: 'relative',
                marginBottom: '0.75rem',
                paddingBottom: '0.5rem',
              }}
            >
              {/* Dot on the line */}
              <div style={{
                position: 'absolute',
                left: '-1.05rem',
                top: '0.15rem',
                width: '0.7rem',
                height: '0.7rem',
                borderRadius: '50%',
                background: cfg.bg,
                border: `2px solid ${cfg.color}`,
              }} />

              {/* Content card */}
              <div style={{
                background: cfg.bg,
                borderRadius: '4px',
                padding: '0.4rem 0.6rem',
                borderLeft: `2px solid ${cfg.color}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.15rem' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--ink-soft, #6B6155)', fontWeight: 600 }}>
                    #{entry.step}
                  </span>
                  {entry.is_refinement && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--ink-soft, #6B6155)', fontStyle: 'italic' }}>
                      修正
                    </span>
                  )}
                  <span style={{
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: cfg.color,
                    marginLeft: 'auto',
                  }}>
                    {cfg.symbol} {cfg.label}
                  </span>
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--ink, #181715)', lineHeight: 1.4 }}>
                  <MathText>{entry.claim}</MathText>
                </div>

                {entry.counter_example && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-soft, #6B6155)', marginTop: '0.2rem' }}>
                    反例：<MathText>{entry.counter_example}</MathText>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Refinement chains */}
      {refinementChains.length > 0 && (
        <div className="refinement-chains" style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--surface-sunk, #D5CFC0)' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--ink-soft, #6B6155)', marginBottom: '0.3rem' }}>
            修正链
          </div>
          {refinementChains.map((chain, i) => (
            <div key={i} style={{ fontSize: '0.72rem', color: 'var(--ink-soft, #6B6155)', marginBottom: '0.2rem' }}>
              {chain.steps.map((s, j) => (
                <span key={j}>
                  #{s}{j < chain.steps.length - 1 ? ' → ' : ''}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const ConjectureTimeline = memo(ConjectureTimelineImpl)
