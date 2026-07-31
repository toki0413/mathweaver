import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties, FC } from 'react'
import {
  SparkleIcon,
  StarIcon,
  GraduationIcon,
  CrownIcon,
  DumbbellIcon,
  type IconProps,
} from './Icons'
import { ACHIEVEMENTS, checkAchievements, getMissions, type AgeLevel } from '../utils/ageAdapt'

interface AchievementSystemProps {
  consecutiveCorrect: number
  masteryEstimate: number // 0..1
  questionsAsked: number
  // 引导任务数据（来自 GuidedDiscoveryPanel，用于"冒险成就"分组）
  guidedMissionsCompleted?: number
  guidedStarsCollected?: number
  guidedModesCompleted?: number
  ageLevel?: AgeLevel
}

interface Badge {
  id: string
  label: string
  icon: FC<IconProps>
  earned: boolean
}

const STREAK_MILESTONES = [3, 5, 10]
const RING_SIZE = 80
const RING_RADIUS = 30
const RING_STROKE = 6
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const PARTICLE_COUNT = 12
const PARTICLE_DISTANCE = 90
const CELEBRATION_DURATION = 2500

/**
 * 学习成就与进度反馈系统。
 *
 * - 连对 3 / 5 / 10 次时弹出庆祝遮罩（粒子向外飞散，2.5s 后自动消失）
 * - 圆环展示掌握度，颜色随区间变化（红 / 黄 / 绿），挂载与数值变化时平滑填充
 * - 徽章按条件点亮（badge-earned）或置灰（badge-locked）
 * - 横向进度条展示距下一里程碑（连对 5 次或掌握度 +10%）的进度
 *
 * 样式由外部 CSS 通过以下 className 提供：achievement-system、streak-celebration、
 * celebration-text、celebration-particle、mastery-ring、mastery-ring-bg、
 * mastery-ring-fill、mastery-ring-text、badge-grid、achievement-badge、
 * badge-earned、badge-locked、badge-icon、badge-label、progress-milestone。
 */
export function AchievementSystem({
  consecutiveCorrect,
  masteryEstimate,
  questionsAsked,
  guidedMissionsCompleted = 0,
  guidedStarsCollected = 0,
  guidedModesCompleted = 0,
  ageLevel,
}: AchievementSystemProps) {
  const [showCelebration, setShowCelebration] = useState(false)
  const [lastStreak, setLastStreak] = useState(consecutiveCorrect)
  const [lastMastery, setLastMastery] = useState(0)
  const [celebrationText, setCelebrationText] = useState('')

  // 监听连对次数，当其“上升至”里程碑（3/5/10）时触发庆祝
  useEffect(() => {
    if (consecutiveCorrect > lastStreak && STREAK_MILESTONES.includes(consecutiveCorrect)) {
      setCelebrationText(`连对 ${consecutiveCorrect} 次!`)
      setShowCelebration(true)
    }
    if (consecutiveCorrect !== lastStreak) {
      setLastStreak(consecutiveCorrect)
    }
  }, [consecutiveCorrect, lastStreak])

  // 庆祝遮罩 2.5s 后自动消失
  useEffect(() => {
    if (!showCelebration) return
    const timer = window.setTimeout(() => setShowCelebration(false), CELEBRATION_DURATION)
    return () => window.clearTimeout(timer)
  }, [showCelebration])

  // 掌握度环：挂载时从 0 填充，数值变化时从旧值过渡到新值
  useEffect(() => {
    const id = requestAnimationFrame(() => setLastMastery(masteryEstimate))
    return () => cancelAnimationFrame(id)
  }, [masteryEstimate])

  // 徽章计算（按条件判定是否点亮）— "学习成就"分组，基于后端数据
  const badges = useMemo<Badge[]>(
    () => [
      { id: 'beginner', label: '初学者', icon: SparkleIcon, earned: questionsAsked >= 1 },
      { id: 'skilled', label: '熟练', icon: StarIcon, earned: consecutiveCorrect >= 3 },
      { id: 'expert', label: '专家', icon: GraduationIcon, earned: consecutiveCorrect >= 5 },
      { id: 'master', label: '大师', icon: CrownIcon, earned: masteryEstimate > 0.7 },
      { id: 'persistent', label: '坚持不懈', icon: DumbbellIcon, earned: questionsAsked >= 10 },
    ],
    [questionsAsked, consecutiveCorrect, masteryEstimate],
  )

  // "冒险成就"分组：基于 ageAdapt 的 ACHIEVEMENTS，用引导任务数据计算解锁状态
  const guidedUnlocked = useMemo(() => {
    const totalMissions = ageLevel ? getMissions(ageLevel).length : 0
    return new Set(
      checkAchievements(
        guidedMissionsCompleted,
        guidedStarsCollected,
        guidedModesCompleted,
        totalMissions,
      ),
    )
  }, [guidedMissionsCompleted, guidedStarsCollected, guidedModesCompleted, ageLevel])

  // 掌握度环：百分比、颜色区间、环偏移量
  const masteryPercent = Math.round(masteryEstimate * 100)
  const ringColor =
    masteryPercent < 30 ? 'var(--err)' : masteryPercent <= 60 ? 'var(--warn)' : 'var(--ok)'
  const ringOffset = RING_CIRCUMFERENCE - lastMastery * RING_CIRCUMFERENCE

  // 距下一里程碑的进度：连对 5 次 或 掌握度 +10%，取更接近完成者展示
  const { progressPercent, milestoneLabel } = useMemo(() => {
    const nextStreak = Math.ceil((consecutiveCorrect + 1) / 5) * 5
    const prevStreak = nextStreak - 5
    const streakProgress =
      nextStreak === prevStreak ? 1 : (consecutiveCorrect - prevStreak) / (nextStreak - prevStreak)

    const clampedMastery = Math.min(Math.max(masteryEstimate, 0), 1)
    let masteryProgress: number
    let nextMasteryPct: number
    if (clampedMastery >= 1) {
      masteryProgress = 1
      nextMasteryPct = 100
    } else {
      const nextMastery = Math.ceil((clampedMastery + 1e-4) / 0.1) * 0.1
      const prevMastery = nextMastery - 0.1
      masteryProgress = (clampedMastery - prevMastery) / (nextMastery - prevMastery)
      nextMasteryPct = Math.round(nextMastery * 100)
    }

    if (streakProgress >= masteryProgress) {
      return {
        progressPercent: Math.min(100, Math.max(0, Math.round(streakProgress * 100))),
        milestoneLabel: `下一里程碑：连对 ${nextStreak} 次`,
      }
    }
    return {
      progressPercent: Math.min(100, Math.max(0, Math.round(masteryProgress * 100))),
      milestoneLabel: `下一里程碑：掌握度 ${nextMasteryPct}%`,
    }
  }, [consecutiveCorrect, masteryEstimate])

  // 庆祝粒子：沿圆周均匀方向向外飞散
  const particles = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (360 / PARTICLE_COUNT) * i
      const rad = (angle * Math.PI) / 180
      return {
        tx: Math.cos(rad) * PARTICLE_DISTANCE,
        ty: Math.sin(rad) * PARTICLE_DISTANCE,
        delay: i * 0.04,
      }
    })
  }, [])

  return (
    <div className="achievement-system" style={{ position: 'relative' }}>
      {/* 连对庆祝遮罩：绝对定位、不拦截指针事件 */}
      {showCelebration && (
        <div
          className="streak-celebration"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div className="celebration-text">{celebrationText}</div>
          {particles.map((p, i) => (
            <div
              key={i}
              className="celebration-particle"
              style={
                {
                  '--tx': `${p.tx}px`,
                  '--ty': `${p.ty}px`,
                  '--delay': `${p.delay}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {/* 掌握度进度环：80x80，半径 30，描边 6 */}
      <div
        className="mastery-ring"
        style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE }}
      >
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <circle
            className="mastery-ring-bg"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="var(--bg3)"
            strokeWidth={RING_STROKE}
          />
          <circle
            className="mastery-ring-fill"
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            style={{
              stroke: ringColor,
              strokeDashoffset: ringOffset,
              transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s ease',
            }}
          />
        </svg>
        <div
          className="mastery-ring-text"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {masteryPercent}%
        </div>
      </div>

      {/* 成就徽章 — 分两组：学习成就（后端数据）+ 冒险成就（引导任务） */}

      {/* 学习成就 — 原有 badges，基于后端数据 */}
      <div
        style={{
          fontSize: '0.72rem',
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: '10px 0 6px',
        }}
      >
        学习成就
      </div>
      <div className="badge-grid">
        {badges.map(badge => {
          const BadgeIcon = badge.icon
          return (
            <div
              key={badge.id}
              className={`achievement-badge ${badge.earned ? 'badge-earned' : 'badge-locked'}`}
            >
              <div className="badge-icon">
                <BadgeIcon size={18} />
              </div>
              <div className="badge-label">{badge.label}</div>
            </div>
          )
        })}
      </div>

      {/* 冒险成就 — ageAdapt ACHIEVEMENTS，基于引导任务数据 */}
      {ageLevel && (
        <>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              margin: '12px 0 6px',
            }}
          >
            冒险成就
          </div>
          <div className="badge-grid">
            {ACHIEVEMENTS.map(a => {
              const unlocked = guidedUnlocked.has(a.id)
              return (
                <div
                  key={a.id}
                  className={`achievement-badge ${unlocked ? 'badge-earned' : 'badge-locked'}`}
                  title={`${a.title[ageLevel]} — ${a.desc[ageLevel]}`}
                >
                  <div
                    className="badge-icon"
                    style={{
                      fontSize: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {unlocked ? a.icon : '🔒'}
                  </div>
                  <div className="badge-label">{a.title[ageLevel]}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* 距下一里程碑的进度条 */}
      <div className="progress-milestone">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
            fontSize: '0.72rem',
            color: 'var(--muted)',
          }}
        >
          <span>{milestoneLabel}</span>
          <span>{progressPercent}%</span>
        </div>
        <div
          style={{
            width: '100%',
            height: 8,
            background: 'var(--bg3)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressPercent}%`,
              height: '100%',
              background: 'var(--accent)',
              borderRadius: 4,
              transition: 'width 0.6s ease',
            }}
          />
        </div>
      </div>
    </div>
  )
}
