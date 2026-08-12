import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

// ============================================================================
// StreakBadge — Duolingo-style daily learning streak
// ----------------------------------------------------------------------------
// Tracks consecutive days of learning activity in localStorage and renders a
// flame badge. Exposes a `useStreak` hook (for triggering activity from
// anywhere in the app) and a `StreakBadge` component (for header display).
// ============================================================================

const STORAGE_KEY = 'mathweaver_streak'

/** Milestone streak counts that trigger a celebration animation. */
export const STREAK_MILESTONES = [7, 14, 30, 50, 100, 365] as const
const MILESTONE_SET = new Set<number>(STREAK_MILESTONES)

export interface StreakData {
  count: number
  lastActiveDate: string | null // YYYY-MM-DD (local timezone)
  bestStreak: number
}

// --- date helpers (local timezone, formatted as YYYY-MM-DD) ---
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function todayString(): string {
  return formatDate(new Date())
}
function yesterdayString(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return formatDate(d)
}
/** Whole-day difference (b - a) between two YYYY-MM-DD strings, local tz. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = new Date(ay, am - 1, ad)
  const db = new Date(by, bm - 1, bd)
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

function isMilestone(n: number): boolean {
  return MILESTONE_SET.has(n)
}
function nextMilestone(n: number): number {
  for (const m of STREAK_MILESTONES) {
    if (m > n) return m
  }
  return 0
}

// --- module-level singleton store (shared across all useStreak callers) ---
// Keeping the source of truth at module scope ensures that when App calls
// `recordActivity`, the StreakBadge instance (which also calls useStreak)
// stays in sync via the subscription listeners.
function readStorage(): StreakData {
  try {
    if (typeof localStorage === 'undefined') {
      return { count: 0, lastActiveDate: null, bestStreak: 0 }
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<StreakData>
      return {
        count: typeof p.count === 'number' && p.count >= 0 ? Math.floor(p.count) : 0,
        lastActiveDate: typeof p.lastActiveDate === 'string' ? p.lastActiveDate : null,
        bestStreak:
          typeof p.bestStreak === 'number' && p.bestStreak >= 0 ? Math.floor(p.bestStreak) : 0,
      }
    }
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return { count: 0, lastActiveDate: null, bestStreak: 0 }
}

let store: StreakData = readStorage()
const listeners = new Set<() => void>()

function sameStreak(a: StreakData, b: StreakData): boolean {
  return (
    a.count === b.count && a.lastActiveDate === b.lastActiveDate && a.bestStreak === b.bestStreak
  )
}
function persist(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
function emit(): void {
  listeners.forEach(fn => fn())
}
function commit(next: StreakData): void {
  // Skip emits when nothing changed — avoids redundant re-renders when
  // recordActivity is called repeatedly on the same day.
  if (sameStreak(next, store)) return
  store = next
  persist()
  emit()
}

/**
 * Record a learning activity (called from anywhere). Updates the streak
 * according to the last active date:
 *   - same day  → no change
 *   - yesterday → count + 1
 *   - otherwise → reset to 1 (new streak)
 * bestStreak is bumped whenever the current count exceeds it.
 */
function applyActivity(): void {
  const today = todayString()
  const last = store.lastActiveDate
  let nextCount: number
  if (last === today) {
    nextCount = store.count
  } else if (last === yesterdayString()) {
    nextCount = store.count + 1
  } else {
    nextCount = 1
  }
  commit({
    count: nextCount,
    lastActiveDate: today,
    bestStreak: Math.max(store.bestStreak, nextCount),
  })
}

/**
 * Passive re-check (mount + visibility regain). If the user missed a day
 * (last active is older than yesterday), the streak is considered broken:
 * the count resets to 0 while bestStreak is preserved. This makes the
 * "streak broken" detection idempotent — once broken, count is 0 so
 * subsequent re-checks are no-ops.
 */
function recheckBreak(): void {
  const today = todayString()
  const last = store.lastActiveDate
  if (last !== null && store.count > 0 && dayDiff(last, today) > 1) {
    commit({ count: 0, lastActiveDate: last, bestStreak: store.bestStreak })
  }
}

// Attach window focus / visibility listeners once (idempotent).
let focusListenersAttached = false
function ensureFocusListeners(): void {
  if (focusListenersAttached || typeof document === 'undefined') return
  focusListenersAttached = true
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') recheckBreak()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', recheckBreak)
}

// ============================================================================
// Hook
// ============================================================================

export interface UseStreakResult {
  /** Current consecutive-day streak (0 if broken / not yet started). */
  streak: number
  /** Longest streak ever achieved. */
  bestStreak: number
  /** Call when the user performs any learning activity. Stable reference. */
  recordActivity: () => void
  /** Days remaining until the next milestone (0 if past the last one). */
  daysUntilMilestone: number
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStreak(): UseStreakResult {
  const [snapshot, setSnapshot] = useState<StreakData>(() => ({ ...store }))

  useEffect(() => {
    // Refresh from storage on mount (covers changes made before subscribing),
    // then run a break re-check before taking the snapshot so the UI never
    // shows a stale "alive" count for an already-broken streak.
    store = readStorage()
    ensureFocusListeners()
    recheckBreak()
    setSnapshot({ ...store })
    const listener = (): void => setSnapshot({ ...store })
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const recordActivity = useCallback(() => {
    applyActivity()
  }, [])

  const daysUntilMilestone = useMemo(() => {
    const m = nextMilestone(snapshot.count)
    return m === 0 ? 0 : m - snapshot.count
  }, [snapshot.count])

  return {
    streak: snapshot.count,
    bestStreak: snapshot.bestStreak,
    recordActivity,
    daysUntilMilestone,
  }
}

// ============================================================================
// Visual component
// ============================================================================

interface StreakBadgeProps {
  /** Compact mode: just the flame icon + number (for header display). */
  compact?: boolean
}

// Confetti palette — echoes the theme tokens (warn / accent / ok) plus a few
// complementary warm hues so the celebration reads as festive.
const CONFETTI_COLORS = [
  'var(--warn)',
  'var(--accent)',
  'var(--ok)',
  '#d99a3b',
  '#8a6fbf',
  '#c97064',
]

interface ConfettiPiece {
  left: number
  delay: number
  duration: number
  color: string
  size: number
  rotate: number
}

function buildConfetti(count: number): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = []
  for (let i = 0; i < count; i++) {
    pieces.push({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 1.6 + Math.random() * 1.4,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 8,
      rotate: Math.random() * 360,
    })
  }
  return pieces
}

// CSS-only animations (no external libraries). Injected once via a <style>
// tag so the keyframes are available wherever the overlays render.
const KEYFRAMES = `
@keyframes streakConfettiFall {
  0%   { transform: translateY(-12vh) rotate(0deg);   opacity: 1; }
  100% { transform: translateY(112vh) rotate(720deg); opacity: 0.9; }
}
@keyframes streakMilestonePulse {
  0%, 100% { box-shadow: 0 0 0 0 hsla(35, 90%, 50%, 0.5); }
  50%      { box-shadow: 0 0 0 6px hsla(35, 90%, 50%, 0); }
}
@keyframes streakToastIn {
  0%   { opacity: 0; transform: translate(-50%, -10px); }
  100% { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes streakCelebrateText {
  0%   { transform: scale(0.6); opacity: 0; }
  30%  { transform: scale(1.15); opacity: 1; }
  70%  { transform: scale(1);    opacity: 1; }
  100% { transform: scale(1.05); opacity: 0; }
}
`

export function StreakBadge({ compact = false }: StreakBadgeProps) {
  const { streak, bestStreak, daysUntilMilestone } = useStreak()

  const [celebrateCount, setCelebrateCount] = useState<number | null>(null)
  const [breakLost, setBreakLost] = useState<number | null>(null)
  const prevStreakRef = useRef<number>(streak)
  const confetti = useMemo(
    () => (celebrateCount !== null ? buildConfetti(32) : []),
    [celebrateCount],
  )

  // Watch streak transitions: celebrate when a milestone is reached, and
  // surface a one-time toast when an existing streak (>= 2) is broken.
  // Both recheckBreak (mount / focus) and applyActivity (returning after a
  // missed day) can lower the count, so detecting any drop from >= 2 covers
  // every break path exactly once.
  useEffect(() => {
    const prev = prevStreakRef.current
    if (streak > prev && isMilestone(streak)) {
      setCelebrateCount(streak)
    }
    if (streak < prev && prev >= 2) {
      setBreakLost(prev)
    }
    prevStreakRef.current = streak
  }, [streak])

  // Auto-dismiss the milestone celebration overlay.
  useEffect(() => {
    if (celebrateCount === null) return
    const t = setTimeout(() => setCelebrateCount(null), 3600)
    return () => clearTimeout(t)
  }, [celebrateCount])

  // Auto-dismiss the streak-broken toast.
  useEffect(() => {
    if (breakLost === null) return
    const t = setTimeout(() => setBreakLost(null), 5500)
    return () => clearTimeout(t)
  }, [breakLost])

  const milestone = isMilestone(streak)
  const visible = streak >= 2
  const tooltip = `连续学习 ${streak} 天 · 最长记录 ${bestStreak} 天`

  return (
    <>
      <style>{KEYFRAMES}</style>

      {visible && (
        <span
          className="streak-flame-badge"
          title={tooltip}
          aria-label={tooltip}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: compact ? '4px' : '6px',
            padding: compact ? '3px 9px' : '5px 12px',
            borderRadius: '999px',
            background: 'var(--bg2)',
            border: `1px solid ${milestone ? 'var(--warn)' : 'var(--border)'}`,
            color: 'var(--warn)',
            fontWeight: 700,
            fontSize: compact ? '13px' : '14px',
            lineHeight: 1,
            userSelect: 'none',
            cursor: 'default',
            boxShadow: milestone
              ? '0 0 0 1px var(--warn), 0 2px 8px hsla(35, 80%, 45%, 0.25)'
              : '0 1px 3px hsla(35, 70%, 40%, 0.12)',
            animation: milestone ? 'streakMilestonePulse 1.8s ease-in-out infinite' : undefined,
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: compact ? '15px' : '17px',
              lineHeight: 1,
              display: 'inline-block',
              // Flame glow via text-shadow, driven by the --warn token.
              textShadow: '0 0 6px var(--warn), 0 0 12px var(--warn)',
              animation: milestone ? 'streakPop 0.4s ease-out' : undefined,
            }}
          >
            
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{streak}</span>
          {!compact && (
            <span
              style={{
                color: 'var(--muted)',
                fontWeight: 500,
                fontSize: '11px',
                marginLeft: '2px',
              }}
            >
              {daysUntilMilestone > 0
                ? `· 距下一里程碑 ${daysUntilMilestone} 天`
                : '· 已达最高里程碑'}
            </span>
          )}
        </span>
      )}

      {/* Milestone celebration overlay (CSS-only confetti) */}
      {celebrateCount !== null && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 9999,
            overflow: 'hidden',
            background:
              'radial-gradient(circle at 50% 28%, hsla(35, 90%, 50%, 0.08), transparent 60%)',
          }}
        >
          {confetti.map((p, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 0.6,
                background: p.color,
                borderRadius: '2px',
                transform: `rotate(${p.rotate}deg)`,
                animation: `streakConfettiFall ${p.duration}s linear ${p.delay}s forwards`,
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              top: '26%',
              left: '50%',
              transform: 'translateX(-50%)',
              textAlign: 'center',
              animation: 'streakCelebrateText 3.6s ease-out forwards',
            }}
          >
            <div style={{ fontSize: '54px', lineHeight: 1, textShadow: '0 0 18px var(--warn)' }}>
              
            </div>
            <div
              style={{
                marginTop: '8px',
                fontSize: '22px',
                fontWeight: 800,
                color: 'var(--accent)',
                textShadow: '0 1px 2px var(--bg2)',
              }}
            >
              连续学习 {celebrateCount} 天！
            </div>
            <div style={{ marginTop: '4px', fontSize: '13px', color: 'var(--ok)' }}>
              坚持就是胜利，继续保持！
            </div>
          </div>
        </div>
      )}

      {/* Streak-broken toast (one-time per break) */}
      {breakLost !== null && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 16px',
            background: 'var(--bg2)',
            border: '1px solid var(--warn)',
            borderRadius: '10px',
            boxShadow: '0 6px 24px rgba(60, 50, 30, 0.18)',
            color: 'var(--ink)',
            fontSize: '13px',
            maxWidth: '90vw',
            animation: 'streakToastIn 0.3s ease-out',
          }}
        >
          <span style={{ fontSize: '18px', filter: 'grayscale(0.3)' }}></span>
          <span>
            你的 <b style={{ color: 'var(--warn)' }}>{breakLost}</b> 天连续学习中断了，最长记录{' '}
            <b>{bestStreak}</b> 天。今天重新开始吧！
          </span>
        </div>
      )}
    </>
  )
}

export default StreakBadge
