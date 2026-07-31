import { memo, useState, useRef, useDeferredValue, useTransition, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useStore } from '../stores/sessionStore'
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

// ---------------------------------------------------------------------------
// T-3.4: Historical narrative types & card component
// ---------------------------------------------------------------------------

export interface HistoricalEntry {
  title: string
  content: string
  score: number
}

interface HistoricalCardProps {
  entry: HistoricalEntry
}

const HistoricalCard = memo(function HistoricalCard({ entry }: HistoricalCardProps) {
  return (
    <div className="historical-card">
      <div className="historical-card-header">
        <span className="historical-card-icon" aria-hidden="true">
          {'\u2630'}
        </span>
        <span className="historical-card-title">{entry.title}</span>
        <span className="historical-card-score">
          {'\u2605'} {Math.round(entry.score * 100)}%
        </span>
      </div>
      <div className="historical-card-content">
        <MathText>{entry.content}</MathText>
      </div>
      <div className="historical-card-source">来源：HistoricalAgent 检索</div>
    </div>
  )
})

const CONJECTURE_TIMELINE_STYLES = `
.conjecture-input-section {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.conjecture-input {
  flex: 1;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--ink);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 7px 10px;
  outline: none;
  box-sizing: border-box;
}
.conjecture-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-subtle, hsla(285, 55%, 72%, 0.18));
}
.conjecture-input::placeholder { color: var(--muted); opacity: 0.8; }
.conjecture-submit-btn { white-space: nowrap; }
.conjecture-preview {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 10px;
  padding: 4px 8px;
  background: var(--bg3);
  border-radius: 3px;
}
.historical-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.historical-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent2, hsl(210, 60%, 68%));
  border-radius: 4px;
  padding: 10px 12px;
}
.historical-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.historical-card-icon {
  font-size: 14px;
  color: var(--accent2, hsl(210, 60%, 68%));
}
.historical-card-title {
  font-family: var(--serif);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  flex: 1;
}
.historical-card-score {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.historical-card-content {
  font-size: 12px;
  color: var(--ink);
  line-height: 1.5;
  margin-bottom: 6px;
}
.historical-card-source {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  font-style: italic;
}
.historical-loading {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  padding: 8px 0;
  text-align: center;
}
`

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

  // T-3.2: Conjecture input — useRef for transient value, useDeferredValue for debounce
  const [conjectureInput, setConjectureInput] = useState('')
  const deferredInput = useDeferredValue(conjectureInput)
  const conjectureValueRef = useRef('')
  const submitConjecture = useStore(s => s.submitConjecture)
  const conjectureLoading = useStore(s => s.conjectureState.loading)

  // T-3.4: Historical narrative entries, keyed by timeline step number
  const [historicalEntries, setHistoricalEntries] = useState<Record<number, HistoricalEntry[]>>({})
  const [historicalLoadingSteps, setHistoricalLoadingSteps] = useState<Set<number>>(new Set())
  const fetchedHistoricalRef = useRef<Set<number>>(new Set())
  const [, startHistoricalTransition] = useTransition()

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    conjectureValueRef.current = e.target.value
    setConjectureInput(e.target.value)
  }, [])

  const handleConjectureSubmit = useCallback(() => {
    const claim = conjectureValueRef.current.trim()
    if (!claim) return
    submitConjecture(claim)
    conjectureValueRef.current = ''
    setConjectureInput('')
  }, [submitConjecture])

  // T-3.4: Fetch historical narrative for a verified conjecture
  const fetchHistorical = useCallback(
    async (step: number, claim: string) => {
      if (fetchedHistoricalRef.current.has(step)) return
      fetchedHistoricalRef.current.add(step)
      setHistoricalLoadingSteps(prev => new Set(prev).add(step))
      try {
        const res = await fetch('/api/historical/narrative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim }),
        })
        if (res.ok) {
          const data = await res.json()
          // Handle both formats:
          // - Mock API: flat array [{ title, content, score }]
          // - Backend API: { narrative, entries: [{ title, content, score }] }
          const entries: HistoricalEntry[] = Array.isArray(data) ? data : (data?.entries ?? [])
          if (entries.length > 0) {
            startHistoricalTransition(() => {
              setHistoricalEntries(prev => ({ ...prev, [step]: entries }))
            })
          }
        }
      } catch {
        // Backend not available — no historical cards shown
      } finally {
        setHistoricalLoadingSteps(prev => {
          const next = new Set(prev)
          next.delete(step)
          return next
        })
      }
    },
    [startHistoricalTransition],
  )

  const toggleExpand = useCallback(
    (step: number, entry?: ConjectureEntry) => {
      const isCurrentlyExpanded = expandedSteps.has(step)
      setExpandedSteps(prev => {
        const next = new Set(prev)
        if (next.has(step)) {
          next.delete(step)
        } else {
          next.add(step)
        }
        return next
      })
      // T-3.4: fetch historical narrative when expanding a verified conjecture.
      // Called OUTSIDE the state updater to avoid side effects inside setState
      // (React StrictMode double-invokes updaters, which would cause double fetches).
      if (!isCurrentlyExpanded && entry && entry.verdict !== 'undecidable' && entry.claim) {
        fetchHistorical(step, entry.claim)
      }
    },
    [expandedSteps, fetchHistorical],
  )

  const hasTimeline = !!(timeline && timeline.length > 0)

  const count = totalConjectures ?? (timeline ? timeline.length : 0)
  const undecided = count - confirmed - refuted

  return (
    <div className="conjecture-timeline">
      <style>{CONJECTURE_TIMELINE_STYLES}</style>

      {/* T-3.2: Conjecture input — always visible, even when timeline is empty */}
      <div className="conjecture-input-section">
        <input
          className="conjecture-input"
          type="text"
          value={conjectureInput}
          onChange={handleInputChange}
          placeholder="我猜…"
          aria-label="输入猜想"
          onKeyDown={e => (e.key === 'Enter' ? handleConjectureSubmit() : null)}
        />
        <button
          type="button"
          className="btn btn-primary conjecture-submit-btn"
          onClick={handleConjectureSubmit}
          disabled={conjectureLoading || !conjectureInput.trim()}
        >
          {conjectureLoading ? '验证中…' : '提交猜想'}
        </button>
      </div>

      {/* Deferred input preview (useDeferredValue for debounce) */}
      {deferredInput.trim() !== '' ? (
        <div className="conjecture-preview">将提交：{deferredInput}</div>
      ) : null}

      {hasTimeline ? (
        <>
          {/* Summary bar with visual breakdown */}
          <div className="timeline-summary">
            <span className="summary-item">
              <span className="summary-dot summary-total" />共 {count}
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
                style={{ width: `${count > 0 ? (confirmed / count) * 100 : 0}%` }}
              />
              <div
                className="timeline-progress-fill refuted"
                style={{ width: `${count > 0 ? (refuted / count) * 100 : 0}%` }}
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

                    <div
                      className="timeline-counter-toggle"
                      onClick={() => toggleExpand(entry.step, entry)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? '收起详情' : '展开详情'}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleExpand(entry.step, entry)
                        }
                      }}
                    >
                      <span className="counter-toggle-icon">
                        {isExpanded ? '\u25BC' : '\u25B8'}
                      </span>
                      {hasCounterExample ? '反例' : '详情'}
                    </div>

                    {isExpanded ? (
                      <>
                        {hasCounterExample ? (
                          <div className="timeline-counter-example">
                            <MathText>{entry.counter_example ?? ''}</MathText>
                          </div>
                        ) : null}

                        {/* T-3.4: Historical narrative cards */}
                        {historicalLoadingSteps.has(entry.step) ? (
                          <div className="historical-loading">加载历史叙事中…</div>
                        ) : historicalEntries[entry.step] ? (
                          <div className="historical-cards">
                            {historicalEntries[entry.step].map((h, j) => (
                              <HistoricalCard key={j} entry={h} />
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
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
                        {j < chain.steps.length - 1 && (
                          <span className="chain-arrow">{'\u2192'}</span>
                        )}
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
        </>
      ) : (
        <div className="conjecture-timeline-empty">
          <div className="conjecture-empty-icon">?</div>
          <p>尚未提出猜想</p>
          <p className="conjecture-empty-hint">用「我猜…」来试探一个数学命题</p>
        </div>
      )}
    </div>
  )
}

export const ConjectureTimeline = memo(ConjectureTimelineImpl)
