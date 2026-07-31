import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'
import { InteractiveQuestion } from './InteractiveQuestion'
import { CURRICULUM_LEVELS_WITH_DEFAULT as CURRICULUM_LEVELS } from '../constants/curriculum'
import { soundSystem } from '../utils/sound'

function difficultyClass(d: number): string {
  if (d < 0.3) return 'success'
  if (d < 0.5) return ''
  if (d < 0.7) return 'warning'
  return 'danger'
}

function difficultyLabel(d: number): string {
  if (d < 0.25) return '热身'
  if (d < 0.45) return '基础'
  if (d < 0.6) return '标准'
  if (d < 0.75) return '进阶'
  return '挑战'
}

function trendClass(trend: string): string {
  if (trend === 'rising') return 'success'
  if (trend === 'falling') return 'warning'
  return ''
}

// 分级提示配色（使用 CSS 变量，支持暗色主题）
const L1_STYLE = {
  backgroundColor: 'var(--hint-l1-bg)',
  borderColor: 'var(--hint-l1-border)',
  color: 'var(--hint-l1-text)',
}
const L2_STYLE = {
  backgroundColor: 'var(--hint-l2-bg)',
  borderColor: 'var(--hint-l2-border)',
  color: 'var(--hint-l2-text)',
}
const ANSWER_STYLE = {
  backgroundColor: 'var(--hint-answer-bg)',
  borderColor: 'var(--hint-answer-border)',
  color: 'var(--hint-answer-text)',
}

interface GrillPanelProps {
  /** 答对时触发，传入当前连对次数（供父组件驱动吉祥物动画等） */
  onCorrect?: (streak: number) => void
  /** 答错时触发 */
  onWrong?: () => void
  /** 提交回答时触发（用于记录每日学习活动，驱动连续学习徽章） */
  onActivity?: () => void
}

export function GrillPanel({ onCorrect, onWrong, onActivity }: GrillPanelProps) {
  const grillState = useStore(s => s.grillState)
  const startGrill = useStore(s => s.startGrill)
  const submitGrillAnswer = useStore(s => s.submitGrillAnswer)
  const loading = useStore(s => s.loading)
  const backendReady = useStore(s => s.backendReady)
  const { active, currentQuestion, difficulty, questionsAsked, encouragement, summary } = grillState

  const [answer, setAnswer] = useState('')
  // 0 = 隐藏, 1 = L1 提示, 2 = L2 提示, 3 = 完整答案
  const [hintLevel, setHintLevel] = useState(0)
  const [answerStartTime, setAnswerStartTime] = useState<number>(Date.now())
  const [curriculumLevel, setCurriculumLevel] = useState<string>('')
  const [studentId] = useState(`grill_${Date.now().toString().slice(-6)}`)

  // --- 即时正反馈：连击计数、庆祝动画、音效 ---
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationText, setCelebrationText] = useState('')
  const [prevCorrectCount, setPrevCorrectCount] = useState(0)
  const [prevStreakWrong, setPrevStreakWrong] = useState(0)
  const [streak, setStreak] = useState(0)
  // --- 错题重问机制：记录答错的题目，会话结束时重新出现 ---
  const [wrongQuestions, setWrongQuestions] = useState<
    Array<{ qid: string; question: string; concept_name?: string }>
  >([])
  const [isReAskPhase, setIsReAskPhase] = useState(false)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleStart = useCallback(() => {
    setAnswerStartTime(Date.now())
    setHintLevel(0)
    setAnswer('')
    startGrill(studentId, curriculumLevel || undefined)
  }, [studentId, curriculumLevel, startGrill])

  const handleSubmit = useCallback(() => {
    if (!answer.trim() || !currentQuestion) return
    onActivity?.()
    const rt = Date.now() - answerStartTime
    submitGrillAnswer(currentQuestion.qid, answer, rt)
    setAnswer('')
    setHintLevel(0)
    setAnswerStartTime(Date.now())
  }, [answer, currentQuestion, answerStartTime, submitGrillAnswer, onActivity])

  // Submit handler for InteractiveQuestion — accepts the answer string directly
  const handleInteractiveSubmit = useCallback(
    (ans: string) => {
      if (!ans.trim() || !currentQuestion) return
      onActivity?.()
      const rt = Date.now() - answerStartTime
      submitGrillAnswer(currentQuestion.qid, ans, rt)
      setAnswer('')
      setHintLevel(0)
      setAnswerStartTime(Date.now())
    },
    [currentQuestion, answerStartTime, submitGrillAnswer, onActivity],
  )

  // 新问题到达时重置提示等级
  useEffect(() => {
    setHintLevel(0)
  }, [currentQuestion?.qid])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const adaptive = summary?.adaptive
  const diffPct = Math.round(difficulty * 100)

  // 答对检测：correct_answers 增加时（与下一题同时到达）触发庆祝动画 + 音效
  useEffect(() => {
    if (!summary) return
    const currentCorrect = summary.correct_answers
    if (currentCorrect > prevCorrectCount) {
      const newStreak = adaptive?.streak_correct ?? streak + 1
      setStreak(newStreak)
      const messages = ['✓ 正确！', '太棒了！', '答对了！', '干得漂亮！']
      setCelebrationText(
        newStreak >= 3
          ? `${newStreak} 连对！🔥`
          : messages[Math.floor(Math.random() * messages.length)],
      )
      setShowCelebration(true)
      soundSystem.play('correct')
      onCorrect?.(newStreak)
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current)
      celebrationTimerRef.current = setTimeout(() => setShowCelebration(false), 1500)
    } else if (currentCorrect < prevCorrectCount) {
      // 会话重置或回退：清空连击
      setStreak(0)
    }
    setPrevCorrectCount(currentCorrect)
    // 依赖仅 correct_answers：每次答对才求值，避免重复触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.correct_answers])

  // 答错检测：streak_wrong 增加时播放轻柔错误音并通知父组件（与答对路径互斥）
  useEffect(() => {
    const currentWrong = adaptive?.streak_wrong ?? 0
    if (currentWrong > prevStreakWrong) {
      setStreak(0)
      soundSystem.play('wrong')
      onWrong?.()
      // Save wrong question for re-ask
      if (currentQuestion) {
        setWrongQuestions(prev => [
          ...prev,
          {
            qid: currentQuestion.qid,
            question: currentQuestion.question,
            concept_name: currentQuestion.concept_name,
          },
        ])
      }
    }
    setPrevStreakWrong(currentWrong)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adaptive?.streak_wrong])

  // 卸载时清理庆祝动画定时器，避免 setState after unmount
  useEffect(() => {
    return () => {
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current)
    }
  }, [])

  // 语义提示生成 - 不会在句子或语义单元中间断开
  const recommendedAnswer = currentQuestion?.recommended_answer ?? ''
  const l1Hint = useMemo(() => {
    if (!recommendedAnswer) return ''
    // 尝试获取第一个完整句子
    const sentenceEnd = recommendedAnswer.search(/[。！？.!?;]/)
    if (sentenceEnd !== -1 && sentenceEnd <= 60) {
      return recommendedAnswer.slice(0, sentenceEnd + 1)
    }
    // 回退到第一个逗号断点
    const commaBreak = recommendedAnswer.search(/[，,；;]/)
    if (commaBreak !== -1 && commaBreak <= 50) {
      return recommendedAnswer.slice(0, commaBreak + 1) + '...'
    }
    // 最后手段：按词边界截断
    if (recommendedAnswer.length <= 50) return recommendedAnswer
    const cut = recommendedAnswer.lastIndexOf(' ', 50)
    return recommendedAnswer.slice(0, cut > 20 ? cut : 50) + '...'
  }, [recommendedAnswer])

  const l2Hint = useMemo(() => {
    if (!recommendedAnswer) return ''
    // 尝试获取前两句
    const firstEnd = recommendedAnswer.search(/[。！？.!?;]/)
    if (firstEnd !== -1) {
      const secondEnd = recommendedAnswer.slice(firstEnd + 1).search(/[。！？.!?;]/)
      if (secondEnd !== -1 && firstEnd + secondEnd <= 150) {
        return recommendedAnswer.slice(0, firstEnd + secondEnd + 2)
      }
      return recommendedAnswer.slice(0, firstEnd + 1) + '...'
    }
    if (recommendedAnswer.length <= 120) return recommendedAnswer
    const cut = recommendedAnswer.lastIndexOf(' ', 120)
    return recommendedAnswer.slice(0, cut > 60 ? cut : 120) + '...'
  }, [recommendedAnswer])

  return (
    <section className="card grill-panel">
      <h2>挑战模式</h2>
      <p className="desc">系统逐个提问，测试你对概念的理解。每题都有参考答案，先思考再查看提示。</p>

      {!active && (
        <div className="grill-start-section">
          <div className="form-group">
            <label className="form-label" htmlFor="grill-level">
              课程级别
            </label>
            <select
              id="grill-level"
              className="select-input"
              value={curriculumLevel}
              onChange={e => setCurriculumLevel(e.target.value)}
            >
              {CURRICULUM_LEVELS.map(lvl => (
                <option key={lvl.value} value={lvl.value}>
                  {lvl.label}
                </option>
              ))}
            </select>
          </div>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={loading || !backendReady}
            >
              {loading ? '启动中' : '开始挑战'}
            </button>
          </div>
        </div>
      )}

      {active && (
        <>
          <div className="grill-stats-row">
            <div className="grill-stat">
              <div className="grill-stat-label">难度</div>
              <div className="difficulty-meter">
                <div
                  className={`difficulty-meter-fill ${difficultyClass(difficulty)}`}
                  style={{ width: `${diffPct}%` }}
                />
              </div>
              <div className="grill-stat-value">
                {diffPct}% — {difficultyLabel(difficulty)}
              </div>
            </div>

            <div className="grill-stat">
              <div className="grill-stat-label">已问</div>
              <div className="grill-stat-value-lg">{questionsAsked}</div>
              <div className="grill-stat-sub">
                {summary ? `已完成 ${summary.correct_answers}/${summary.resolved_branches}` : ''}
              </div>
            </div>

            {adaptive && (
              <div className="grill-stat">
                <div className="grill-stat-label">正确率</div>
                <div className="grill-stat-value-lg">
                  {Math.round(adaptive.accuracy_rate * 100)}%
                </div>
                <div className="grill-stat-sub">
                  连对 {adaptive.streak_correct} — 连错 {adaptive.streak_wrong}
                </div>
              </div>
            )}

            {adaptive && (
              <div className="grill-stat">
                <div className="grill-stat-label">趋势</div>
                <div className={`grill-stat-value-lg ${trendClass(adaptive.trend)}`}>
                  {adaptive.trend === 'rising'
                    ? '\u2191'
                    : adaptive.trend === 'falling'
                      ? '\u2193'
                      : '\u2014'}
                </div>
                <div className="grill-stat-sub">{adaptive.trend}</div>
              </div>
            )}
          </div>

          {streak >= 2 && (
            <div
              key={streak}
              className="streak-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginTop: '4px',
                padding: '4px 12px',
                background: 'rgba(229, 192, 123, 0.2)',
                border: '1px solid var(--warn, #e5c07b)',
                borderRadius: '20px',
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--warn, #e5c07b)',
                animation: 'streakPop 0.3s ease-out',
              }}
            >
              🔥 {streak} 连对！
            </div>
          )}

          <div
            className="grill-progress-bar"
            style={{
              margin: '8px 0 12px',
              padding: '8px 12px',
              background: 'var(--bg2, #1a2330)',
              borderRadius: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '6px',
                fontSize: '12px',
                color: 'var(--muted, #8b95a5)',
              }}
            >
              <span>本次挑战进度</span>
              <span>
                第 {questionsAsked} 题
                {summary?.total_branches ? ` / ${summary.total_branches}` : ''}
              </span>
            </div>
            <div
              style={{
                height: '6px',
                background: 'var(--bg3, #212d3d)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min((questionsAsked / (summary?.total_branches || 10)) * 100, 100)}%`,
                  background: 'linear-gradient(90deg, var(--ok, #98c379), var(--accent, #c89665))',
                  borderRadius: '3px',
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            {summary && (
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  marginTop: '4px',
                  fontSize: '11px',
                  color: 'var(--muted, #8b95a5)',
                }}
              >
                <span style={{ color: 'var(--ok, #98c379)' }}>
                  ✓ {summary.correct_answers} 正确
                </span>
                <span>共 {questionsAsked} 题</span>
              </div>
            )}
          </div>

          {wrongQuestions.length > 0 && !isReAskPhase && (
            <div
              style={{
                margin: '8px 0',
                padding: '8px 12px',
                background: 'rgba(224, 108, 117, 0.1)',
                border: '1px solid rgba(224, 108, 117, 0.3)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--danger, #e06c75)',
              }}
            >
              📌 还有 {wrongQuestions.length} 道错题将在结束时重新出现
            </div>
          )}

          {isReAskPhase && wrongQuestions.length > 0 ? (
            <div className="grill-reask-section">
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(229, 192, 123, 0.1)',
                  borderRadius: '8px',
                  marginBottom: '12px',
                }}
              >
                <div
                  style={{ fontWeight: 700, color: 'var(--warn, #e5c07b)', marginBottom: '4px' }}
                >
                  🔄 错题复习 ({wrongQuestions.length} 道剩余)
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted, #8b95a5)' }}>
                  之前答错的问题，再来一次！
                </div>
              </div>
              <div className="grill-question-text">
                <MathText>{wrongQuestions[0].question}</MathText>
              </div>
              <textarea
                className="text-input grill-answer-input"
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                placeholder="输入你的答案..."
                onKeyDown={handleKeyDown}
                rows={3}
              />
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    // Remove this question from the re-ask queue
                    setWrongQuestions(prev => prev.slice(1))
                    setAnswer('')
                    if (wrongQuestions.length <= 1) {
                      setIsReAskPhase(false)
                      // Optionally end the session
                    }
                  }}
                  disabled={!answer.trim()}
                >
                  提交复习答案
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setWrongQuestions(prev => prev.slice(1))
                    setAnswer('')
                    if (wrongQuestions.length <= 1) {
                      setIsReAskPhase(false)
                    }
                  }}
                >
                  跳过
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            <div className="grill-question-section">
              {currentQuestion.concept_name && (
                <div className="grill-concept-tag">
                  {currentQuestion.concept_name}
                  {currentQuestion.branch_type !== 'concept' && (
                    <span className="badge badge-warning" style={{ marginLeft: '6px' }}>
                      {currentQuestion.branch_type}
                    </span>
                  )}
                </div>
              )}
              <div className="grill-question-text">
                <MathText>{currentQuestion.question}</MathText>
              </div>

              {currentQuestion.recommended_answer && (
                <div className="hint-section">
                  {hintLevel === 0 ? (
                    <div className="hint-buttons btn-row">
                      <button
                        className="btn btn-hint-l1"
                        style={L1_STYLE}
                        onClick={() => setHintLevel(1)}
                      >
                        💡 方向提示
                      </button>
                      <button
                        className="btn btn-hint-l2"
                        style={L2_STYLE}
                        onClick={() => setHintLevel(2)}
                      >
                        📝 详细提示
                      </button>
                      <button
                        className="btn btn-hint-answer"
                        style={ANSWER_STYLE}
                        onClick={() => setHintLevel(3)}
                      >
                        查看答案
                      </button>
                    </div>
                  ) : (
                    <div className="hint-revealed">
                      {hintLevel >= 1 && (
                        <div className="hint-box hint-l1" style={L1_STYLE}>
                          <div className="hint-label">L1 提示</div>
                          <div className="hint-text">
                            <MathText>{l1Hint}</MathText>
                          </div>
                        </div>
                      )}
                      {hintLevel >= 2 && (
                        <div className="hint-box hint-l2" style={L2_STYLE}>
                          <div className="hint-label">L2 提示</div>
                          <div className="hint-text">
                            <MathText>{l2Hint}</MathText>
                          </div>
                        </div>
                      )}
                      {hintLevel === 3 && (
                        <div className="hint-box hint-answer" style={ANSWER_STYLE}>
                          <div className="hint-label">参考答案</div>
                          <div className="hint-text">
                            <MathText>{currentQuestion.recommended_answer}</MathText>
                          </div>
                        </div>
                      )}
                      <div className="btn-row">
                        <button className="btn btn-sm" onClick={() => setHintLevel(0)}>
                          收起
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <InteractiveQuestion
                question={currentQuestion.question}
                recommendedAnswer={currentQuestion.recommended_answer}
                onSubmit={handleInteractiveSubmit}
                disabled={loading}
              />
              <div className="btn-row">
                <button className="btn" onClick={handleStart} disabled={loading}>
                  重新开始
                </button>
              </div>
            </div>
          ) : (
            <div className="grill-question-section">
              {loading ? (
                <div className="loading">
                  <div className="spinner" />
                  正在生成下一个问题
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  {encouragement || '所有问题已回答完毕，点击"重新开始"再试一次。'}
                </p>
              )}
            </div>
          )}

          {encouragement && currentQuestion && (
            <div className="grill-encouragement">
              <div className="grill-encouragement-label">系统反馈</div>
              <div className="grill-encouragement-text">{encouragement}</div>
            </div>
          )}

          {active && (
            <div style={{ marginTop: '12px', textAlign: 'center' }}>
              <button
                className="btn"
                onClick={() => {
                  if (wrongQuestions.length > 0 && !isReAskPhase) {
                    setIsReAskPhase(true)
                  }
                }}
                style={{
                  padding: '6px 16px',
                  fontSize: '13px',
                  border: '1px solid var(--border, #2d3a4d)',
                  borderRadius: '6px',
                  background: 'var(--bg2, #1a2330)',
                  color: 'var(--muted, #8b95a5)',
                  cursor: 'pointer',
                }}
              >
                {wrongQuestions.length > 0
                  ? `结束并复习错题 (${wrongQuestions.length})`
                  : '结束挑战'}
              </button>
            </div>
          )}
        </>
      )}

      {showCelebration && (
        <div
          className="celebration-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(152, 195, 121, 0.15)',
            borderRadius: 'inherit',
            pointerEvents: 'none',
            animation: 'celebrationFade 1.5s ease-out forwards',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: 'var(--ok, #98c379)',
              textShadow: '0 0 20px rgba(152, 195, 121, 0.5)',
            }}
          >
            {celebrationText}
          </div>
        </div>
      )}
    </section>
  )
}
