import { useState, useMemo, useCallback } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { soundSystem } from '../utils/sound'
import { WARMUP_PUZZLES } from '../data/warmupPuzzles'
import type { PuzzleCategory, WarmupPuzzle } from '../data/warmupPuzzles'

/**
 * WarmupPuzzles — 每日热身谜题卡片
 *
 * 承结构主义与新数学运动传统：每堂课以一组热身谜题开场——
 * 逻辑谜题、物理脑筋急转弯、数学小把戏、语言谜题。这些谜题本身不是群论，
 * 但它们训练的是代数思维所需的底层能力（约束推理、对称性观察、自指与不动点、
 * 群作用直觉），并在「群论连接」一栏里点明与代数结构的联系。
 *
 * 功能：
 *  1. 每日谜题卡片（按日期确定性地选出一道「今日谜题」）
 *  2. 类别图标 + 难度徽章
 *  3. 「显示提示」按钮 — 揭示提示
 *  4. 「揭晓答案」按钮 — 揭示答案 + 解析 + 群论连接
 *  5. 「下一题」按钮 — 循环切换当前年龄段的谜题
 *  6. 年龄自适应（从 props 读取 ageLevel，过滤对应难度）
 *  7. 进度统计（已看题数 / 总题数）
 *  8. 内联 CSS（Theorema 设计哲学：暖白底、琥珀强调、衬线标题）
 *
 * 样式类名统一以 `wp-` 为前缀，通过组件内 <style> 注入，复用全局 CSS 变量。
 */

// ---------------------------------------------------------------------------
// 类别元数据 — 图标、标签、强调色
// ---------------------------------------------------------------------------

interface CategoryMeta {
  icon: string
  /** 各年龄段的类别名称 */
  label: Record<AgeLevel, string>
  /** 强调色（与暖白底和谐） */
  color: string
}

const CATEGORY_META: Record<PuzzleCategory, CategoryMeta> = {
  logic: {
    icon: '🔍',
    label: { kids: '逻辑', tweens: '逻辑推理', teens: 'Logic' },
    color: '#5c6b8c', // 青黛蓝
  },
  math: {
    icon: '🔢',
    label: { kids: '数学', tweens: '数学', teens: 'Math' },
    color: '#b8862e', // 赭石 / 琥珀
  },
  physics: {
    icon: '⚡',
    label: { kids: '物理', tweens: '物理', teens: 'Physics' },
    color: '#4a7c59', // 竹绿
  },
  linguistic: {
    icon: '📝',
    label: { kids: '语言', tweens: '语言', teens: 'Linguistic' },
    color: '#9e6b3e', // 棕琥珀
  },
  trick: {
    icon: '🎭',
    label: { kids: '小把戏', tweens: '思维把戏', teens: 'Trick' },
    color: '#9e2b22', // 深朱砂
  },
}

// ---------------------------------------------------------------------------
// 难度徽章文案
// ---------------------------------------------------------------------------

const DIFFICULTY_LABEL: Record<AgeLevel, string> = {
  kids: '小学 · 8-10 岁',
  tweens: '初中 · 11-13 岁',
  teens: '高中+ · 14 岁以上',
}

const DIFFICULTY_BADGE: Record<AgeLevel, string> = {
  kids: '小学',
  tweens: '初中',
  teens: '高中+',
}

// ---------------------------------------------------------------------------
// 年龄自适应界面文案
// ---------------------------------------------------------------------------

interface UiText {
  title: string
  subtitle: string
  dailyBadge: string
  questionLabel: string
  showHint: string
  hideHint: string
  revealAnswer: string
  hideAnswer: string
  nextPuzzle: string
  prevPuzzle: string
  hintLabel: string
  answerLabel: string
  explanationLabel: string
  connectionLabel: string
  progressLabel: string
  emptyState: string
}

function getUiText(level: AgeLevel): UiText {
  if (level === 'kids') {
    return {
      title: '每日热身谜题',
      subtitle: '像小侦探一样，先动动脑筋再开始今天的数学冒险！',
      dailyBadge: '今日谜题',
      questionLabel: '谜题',
      showHint: '看提示',
      hideHint: '收起提示',
      revealAnswer: '揭晓答案',
      hideAnswer: '收起答案',
      nextPuzzle: '下一题',
      prevPuzzle: '上一题',
      hintLabel: '小提示',
      answerLabel: '答案',
      explanationLabel: '为什么？',
      connectionLabel: '和数学大家族的关系',
      progressLabel: '已看',
      emptyState: '这个年龄段暂时还没有谜题哦～',
    }
  }
  if (level === 'tweens') {
    return {
      title: '每日热身谜题',
      subtitle: '逻辑、物理、数学、语言——四类小谜题热身，开启今天的探索。',
      dailyBadge: '今日谜题',
      questionLabel: '题目',
      showHint: '显示提示',
      hideHint: '收起提示',
      revealAnswer: '揭晓答案',
      hideAnswer: '收起答案',
      nextPuzzle: '下一题',
      prevPuzzle: '上一题',
      hintLabel: '提示',
      answerLabel: '答案',
      explanationLabel: '解析',
      connectionLabel: '与代数思维的联系',
      progressLabel: '已完成',
      emptyState: '该年龄段暂无谜题。',
    }
  }
  return {
    title: 'Daily Warm-up Puzzles',
    subtitle: 'Logic, physics, math & linguistic puzzles — warm up your algebraic intuition.',
    dailyBadge: 'Daily',
    questionLabel: 'Puzzle',
    showHint: 'Show Hint',
    hideHint: 'Hide Hint',
    revealAnswer: 'Reveal Answer',
    hideAnswer: 'Hide Answer',
    nextPuzzle: 'Next Puzzle',
    prevPuzzle: 'Previous',
    hintLabel: 'Hint',
    answerLabel: 'Answer',
    explanationLabel: 'Explanation',
    connectionLabel: 'Connection to Group Theory',
    progressLabel: 'Seen',
    emptyState: 'No puzzles available for this age level.',
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  ageLevel: AgeLevel
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function WarmupPuzzles({ ageLevel }: Props) {
  const ui = useMemo(() => getUiText(ageLevel), [ageLevel])

  // 按年龄过滤谜题
  const puzzles = useMemo<WarmupPuzzle[]>(
    () => WARMUP_PUZZLES.filter(p => p.difficulty === ageLevel),
    [ageLevel],
  )

  // 「今日谜题」索引 — 按日期确定性选取（每天换一道）
  const dailyIndex = useMemo(() => {
    const dayIndex = Math.floor(Date.now() / 86_400_000) // 自纪元以来的天数
    return puzzles.length > 0 ? dayIndex % puzzles.length : 0
  }, [puzzles.length])

  const [current, setCurrent] = useState<number>(dailyIndex)
  const [showHint, setShowHint] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  // 已看过的谜题 id 集合（用于进度统计）
  const [seen, setSeen] = useState<Set<string>>(() => new Set([puzzles[dailyIndex]?.id]))

  const puzzle = puzzles[current]
  const total = puzzles.length

  // --- 切换到指定索引的谜题 ---
  const goTo = useCallback(
    (index: number) => {
      if (total === 0) return
      const next = ((index % total) + total) % total // 安全取模，处理负数
      setCurrent(next)
      setShowHint(false)
      setShowAnswer(false)
      soundSystem.play('whoosh')
      setSeen(prev => {
        const updated = new Set(prev)
        updated.add(puzzles[next].id)
        return updated
      })
    },
    [total, puzzles],
  )

  const handleNext = useCallback(() => {
    goTo(current + 1)
  }, [goTo, current])

  const handlePrev = useCallback(() => {
    goTo(current - 1)
  }, [goTo, current])

  const handleHint = useCallback(() => {
    const next = !showHint
    setShowHint(next)
    soundSystem.play(next ? 'pop' : 'click')
  }, [showHint])

  const handleAnswer = useCallback(() => {
    const next = !showAnswer
    setShowAnswer(next)
    if (next) {
      // 揭晓答案时播放「发现」音效，并在答案已显示时补一个正确音
      soundSystem.play('discover')
      setTimeout(() => soundSystem.play('correct'), 220)
    } else {
      soundSystem.play('click')
    }
  }, [showAnswer])

  const progress = total > 0 ? seen.size / total : 0

  // --- 空状态防御 ---
  if (total === 0 || !puzzle) {
    return (
      <>
        <style>{WARMUP_CSS}</style>
        <div className="wp-root">
          <div className="wp-empty">{ui.emptyState}</div>
        </div>
      </>
    )
  }

  const cat = CATEGORY_META[puzzle.category]
  const isDaily = current === dailyIndex

  return (
    <>
      <style>{WARMUP_CSS}</style>
      <div className="wp-root">
        {/* 标题区 */}
        <div className="wp-header">
          <div className="wp-header-main">
            <h2 className="wp-title">{ui.title}</h2>
            <p className="wp-subtitle">{ui.subtitle}</p>
          </div>

          {/* 进度统计 */}
          <div className="wp-progress">
            <div className="wp-progress-text">
              {ui.progressLabel} {seen.size} / {total}
            </div>
            <div className="wp-progress-bar">
              <div className="wp-progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        </div>

        {/* 谜题卡片 */}
        <div className="wp-card" style={{ '--wp-accent': cat.color } as React.CSSProperties}>
          {/* 卡片头部：类别图标 + 标签 + 难度徽章 + 今日标记 + 计数 */}
          <div className="wp-card-top">
            <div className="wp-cat">
              <span className="wp-cat-icon" aria-hidden>
                {cat.icon}
              </span>
              <span className="wp-cat-label">{cat.label[ageLevel]}</span>
            </div>

            <div className="wp-card-meta">
              {isDaily && (
                <span className="wp-daily-badge" title={ui.dailyBadge}>
                  ✦ {ui.dailyBadge}
                </span>
              )}
              <span className="wp-diff-badge">{DIFFICULTY_BADGE[ageLevel]}</span>
              <span className="wp-counter">
                {current + 1} / {total}
              </span>
            </div>
          </div>

          {/* 题目区 */}
          <div className="wp-question-block">
            <div className="wp-section-label">{ui.questionLabel}</div>
            <div className="wp-question">{puzzle.question}</div>
          </div>

          {/* 操作按钮区 */}
          <div className="wp-actions">
            <button
              className={`wp-btn wp-btn-hint ${showHint ? 'active' : ''}`}
              onClick={handleHint}
              style={{ '--wp-accent': cat.color } as React.CSSProperties}
            >
              <span aria-hidden>{showHint ? '▾' : '▸'}</span>
              {showHint ? ui.hideHint : ui.showHint}
            </button>

            <button
              className={`wp-btn wp-btn-answer ${showAnswer ? 'active' : ''}`}
              onClick={handleAnswer}
            >
              <span aria-hidden>{showAnswer ? '▾' : '▸'}</span>
              {showAnswer ? ui.hideAnswer : ui.revealAnswer}
            </button>
          </div>

          {/* 提示区 */}
          {showHint && (
            <div className="wp-reveal wp-hint">
              <div className="wp-reveal-label">
                <span aria-hidden>💡</span> {ui.hintLabel}
              </div>
              <div className="wp-reveal-body">{puzzle.hint}</div>
            </div>
          )}

          {/* 答案 + 解析 + 群论连接 */}
          {showAnswer && (
            <div className="wp-reveal wp-answer">
              <div className="wp-reveal-label">
                <span aria-hidden>✓</span> {ui.answerLabel}
              </div>
              <div className="wp-answer-text">{puzzle.answer}</div>

              <div className="wp-reveal-label wp-sub-label">
                <span aria-hidden>📖</span> {ui.explanationLabel}
              </div>
              <div className="wp-reveal-body">{puzzle.explanation}</div>

              {puzzle.connectionToGroupTheory && (
                <>
                  <div className="wp-reveal-label wp-sub-label">
                    <span aria-hidden>
                      <GroupIcon />
                    </span>{' '}
                    {ui.connectionLabel}
                  </div>
                  <div className="wp-connection">{puzzle.connectionToGroupTheory}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 导航区 */}
        <div className="wp-nav">
          <button className="wp-nav-btn" onClick={handlePrev} disabled={total <= 1}>
            <span aria-hidden>←</span> {ui.prevPuzzle}
          </button>

          <div className="wp-dots">
            {puzzles.map((p, i) => (
              <button
                key={p.id}
                className={`wp-dot ${i === current ? 'active' : ''} ${seen.has(p.id) ? 'seen' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`${i + 1}`}
                title={`${i + 1} / ${total}`}
              />
            ))}
          </div>

          <button className="wp-nav-btn wp-nav-next" onClick={handleNext} disabled={total <= 1}>
            {ui.nextPuzzle} <span aria-hidden>→</span>
          </button>
        </div>

        {/* 难度说明 */}
        <div className="wp-diff-note">{DIFFICULTY_LABEL[ageLevel]}</div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 一个极小的「群论连接」装饰图标 — 用衬线字母 G 表示代数结构
// ---------------------------------------------------------------------------

function GroupIcon() {
  return <span className="wp-glyph">𝒢</span>
}

// ===========================================================================
// 内联 CSS — Theorema 设计哲学：暖白底 · 琥珀强调 · 衬线标题
// 复用全局 CSS 变量（--bg, --bg2, --ink, --muted, --serif, --border 等）
// ===========================================================================

const WARMUP_CSS = `
.wp-root {
  --wp-amber: #b8862e;        /* 赭石 / 琥珀主强调 */
  --wp-amber-soft: rgba(184, 134, 46, 0.10);
  --wp-amber-border: rgba(184, 134, 46, 0.30);
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: var(--sans);
  color: var(--ink);
}

/* === 标题区 === */
.wp-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.wp-header-main {
  flex: 1 1 auto;
  min-width: 200px;
}
.wp-title {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.5px;
  margin: 0;
  line-height: 1.25;
}
.wp-subtitle {
  font-size: 13px;
  color: var(--muted);
  margin: 4px 0 0;
  line-height: 1.6;
}

/* === 进度 === */
.wp-progress {
  flex: 0 0 auto;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-progress-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--wp-amber);
  text-align: right;
  white-space: nowrap;
}
.wp-progress-bar {
  height: 6px;
  background: var(--bg3, #e8e0d0);
  border-radius: 999px;
  overflow: hidden;
}
.wp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4a843, var(--wp-amber));
  border-radius: 999px;
  transition: width 0.4s ease;
}

/* === 谜题卡片 === */
.wp-card {
  position: relative;
  background: var(--bg2, #faf6ed);
  border: 1px solid var(--border);
  border-left: 4px solid var(--wp-accent, var(--wp-amber));
  border-radius: var(--r-lg, 14px);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04));
  transition: box-shadow 0.2s ease;
}
.wp-card:hover {
  box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.05));
}

/* 卡片顶部 */
.wp-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.wp-cat {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-cat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--wp-amber-soft);
  font-size: 18px;
  line-height: 1;
}
.wp-cat-label {
  font-family: var(--serif);
  font-size: 15px;
  font-weight: 700;
  color: var(--wp-accent, var(--wp-amber));
  letter-spacing: 0.3px;
}
.wp-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-daily-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--wp-amber);
  background: var(--wp-amber-soft);
  border: 1px solid var(--wp-amber-border);
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.wp-diff-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--bg3, #e8e0d0);
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.wp-counter {
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #6b6b6b);
  font-variant-numeric: tabular-nums;
}

/* === 题目 === */
.wp-question-block {
  margin-bottom: 14px;
}
.wp-section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--faint, #6b6b6b);
  margin-bottom: 6px;
}
.wp-question {
  font-size: 15px;
  line-height: 1.75;
  color: var(--ink);
  white-space: pre-wrap;
  font-family: var(--serif);
}

/* === 操作按钮 === */
.wp-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  background: var(--bg, #f5f0e6);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--t-fast, 120ms ease);
  font-family: var(--sans);
}
.wp-btn:hover {
  border-color: var(--wp-accent, var(--wp-amber));
  color: var(--wp-accent, var(--wp-amber));
}
.wp-btn:active {
  transform: scale(0.97);
}
.wp-btn-hint {
  border-color: var(--border);
}
.wp-btn-answer.active,
.wp-btn-hint.active {
  background: var(--wp-amber-soft);
  border-color: var(--wp-amber-border);
  color: var(--wp-amber);
}

/* === 揭示区 === */
.wp-reveal {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: var(--r-md, 10px);
  animation: wp-fade-in 0.3s ease;
}
@keyframes wp-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.wp-hint {
  background: rgba(92, 107, 140, 0.07);
  border: 1px solid rgba(92, 107, 140, 0.20);
}
.wp-answer {
  background: var(--wp-amber-soft);
  border: 1px solid var(--wp-amber-border);
}
.wp-reveal-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--muted);
  margin-bottom: 6px;
}
.wp-hint .wp-reveal-label { color: #5c6b8c; }
.wp-answer .wp-reveal-label { color: var(--wp-amber); }
.wp-sub-label { margin-top: 12px; }
.wp-reveal-body {
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--ink);
  white-space: pre-wrap;
}
.wp-answer-text {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--wp-amber);
  line-height: 1.6;
  margin-bottom: 4px;
}
.wp-connection {
  font-size: 13px;
  line-height: 1.75;
  color: var(--muted);
  background: rgba(74, 124, 89, 0.06);
  border-left: 3px solid #4a7c59;
  padding: 10px 12px;
  border-radius: 0 var(--r-sm, 6px) var(--r-sm, 6px) 0;
  white-space: pre-wrap;
}
.wp-glyph {
  font-family: var(--serif);
  font-size: 14px;
  color: #4a7c59;
}

/* === 导航 === */
.wp-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.wp-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm, 6px);
  background: var(--bg2, #faf6ed);
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--t-fast, 120ms ease);
  font-family: var(--sans);
}
.wp-nav-btn:hover:not(:disabled) {
  border-color: var(--wp-amber);
  color: var(--wp-amber);
  background: var(--wp-amber-soft);
}
.wp-nav-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.wp-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wp-nav-next {
  color: var(--wp-amber);
  border-color: var(--wp-amber-border);
  background: var(--wp-amber-soft);
}

/* 圆点导航 */
.wp-dots {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  flex: 1;
}
.wp-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: none;
  background: var(--bg3, #e8e0d0);
  cursor: pointer;
  padding: 0;
  transition: all var(--t-fast, 120ms ease);
}
.wp-dot.seen {
  background: rgba(184, 134, 46, 0.45);
}
.wp-dot.active {
  background: var(--wp-amber);
  transform: scale(1.35);
  box-shadow: 0 0 0 3px var(--wp-amber-soft);
}
.wp-dot:hover {
  transform: scale(1.2);
}

/* === 难度说明 === */
.wp-diff-note {
  font-size: 11px;
  color: var(--faint, #6b6b6b);
  text-align: center;
  letter-spacing: 0.3px;
}

/* === 空状态 === */
.wp-empty {
  padding: 32px;
  text-align: center;
  color: var(--faint, #6b6b6b);
  font-size: 14px;
  background: var(--bg2, #faf6ed);
  border: 1px dashed var(--border);
  border-radius: var(--r-lg, 14px);
}

/* === 响应式 === */
@media (max-width: 600px) {
  .wp-title { font-size: 19px; }
  .wp-question { font-size: 14px; }
  .wp-card { padding: 14px 14px; }
  .wp-nav-btn { padding: 7px 10px; font-size: 12px; }
  .wp-progress { min-width: 120px; }
  .wp-dot { width: 8px; height: 8px; }
}
`
