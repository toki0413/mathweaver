import { useState, useCallback } from 'react'
import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'

const CURRICULUM_LEVELS = [
  { value: '', label: '默认（群论）' },
  { value: 'group_theory', label: '群论（大学）' },
  { value: 'linear_algebra', label: '线性代数（大学）' },
  { value: 'number_theory', label: '数论（大学）' },
  { value: 'discrete_math', label: '离散数学（大学）' },
  { value: 'calculus', label: '积分学（大学）' },
  { value: 'high_school', label: '高中' },
  { value: 'middle_school', label: '初中' },
  { value: 'elementary', label: '小学' },
]

/** Map difficulty to a CSS modifier class name. */
function difficultyClass(d: number): string {
  if (d < 0.3) return 'success'
  if (d < 0.5) return ''
  if (d < 0.7) return 'warning'
  return 'danger'
}

/** Human-readable label for a difficulty band. */
function difficultyLabel(d: number): string {
  if (d < 0.25) return '热身'
  if (d < 0.45) return '基础'
  if (d < 0.6) return '标准'
  if (d < 0.75) return '进阶'
  return '挑战'
}

/** Map trend to a CSS class. */
function trendClass(trend: string): string {
  if (trend === 'rising') return 'success'
  if (trend === 'falling') return 'warning'
  return ''
}

export function GrillPanel() {
  const { grillState, startGrill, submitGrillAnswer, loading } = useStore()
  const { active, currentQuestion, difficulty, questionsAsked, encouragement, summary } = grillState

  const [answer, setAnswer] = useState('')
  const [showHint, setShowHint] = useState(false)
  const [answerStartTime, setAnswerStartTime] = useState<number>(Date.now())
  const [curriculumLevel, setCurriculumLevel] = useState<string>('')
  const [studentId] = useState(`grill_${Date.now().toString().slice(-6)}`)

  const handleStart = useCallback(() => {
    setAnswerStartTime(Date.now())
    setShowHint(false)
    setAnswer('')
    startGrill(studentId, curriculumLevel || undefined)
  }, [studentId, curriculumLevel, startGrill])

  const handleSubmit = useCallback(() => {
    if (!answer.trim() || !currentQuestion) return
    const rt = Date.now() - answerStartTime
    submitGrillAnswer(currentQuestion.qid, answer, rt)
    setAnswer('')
    setShowHint(false)
    setAnswerStartTime(Date.now())
  }, [answer, currentQuestion, answerStartTime, submitGrillAnswer])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const adaptive = summary?.adaptive
  const diffPct = Math.round(difficulty * 100)

  return (
    <section className="card grill-panel">
      <h2>Grill Me 面试模式</h2>
      <p className="card-desc">
        系统逐个提问，考察你对概念的理解。每题都有参考答案，先思考再查看。
      </p>

      {/* Start controls */}
      {!active && (
        <div className="grill-start-section">
          <div className="form-row">
            <label className="form-label" htmlFor="grill-level">课程级别</label>
            <select
              id="grill-level"
              className="select-input"
              value={curriculumLevel}
              onChange={(e) => setCurriculumLevel(e.target.value)}
            >
              {CURRICULUM_LEVELS.map((lvl) => (
                <option key={lvl.value} value={lvl.value}>
                  {lvl.label}
                </option>
              ))}
            </select>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
              {loading ? '启动中' : '开始面试'}
            </button>
          </div>
        </div>
      )}

      {/* Active grill session */}
      {active && (
        <>
          {/* Stats row: difficulty meter + progress */}
          <div className="grill-stats-row">
            {/* Difficulty meter */}
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

            {/* Progress */}
            <div className="grill-stat">
              <div className="grill-stat-label">已问</div>
              <div className="grill-stat-value-lg">{questionsAsked}</div>
              <div className="grill-stat-sub">
                {summary ? `正确 ${summary.correct_answers}/${summary.resolved_branches}` : ''}
              </div>
            </div>

            {/* Accuracy */}
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

            {/* Trend */}
            {adaptive && (
              <div className="grill-stat">
                <div className="grill-stat-label">趋势</div>
                <div className={`grill-stat-value-lg ${trendClass(adaptive.trend)}`}>
                  {adaptive.trend === 'rising' ? '\u2191' : adaptive.trend === 'falling' ? '\u2193' : '\u2014'}
                </div>
                <div className="grill-stat-sub">{adaptive.trend}</div>
              </div>
            )}
          </div>

          {/* Current question */}
          {currentQuestion ? (
            <div className="grill-question-section">
              {currentQuestion.concept_name && (
                <div className="grill-concept-tag">
                  {currentQuestion.concept_name}
                  {currentQuestion.branch_type !== 'concept' && (
                    <span className="badge badge-implicit">{currentQuestion.branch_type}</span>
                  )}
                </div>
              )}
              <div className="grill-question-text"><MathText>{currentQuestion.question}</MathText></div>

              {/* Recommended answer hint (blurred until clicked) */}
              {currentQuestion.recommended_answer && (
                <div
                  className={`hint-box ${showHint ? 'revealed' : 'blurred'}`}
                  onClick={() => !showHint && setShowHint(true)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !showHint) setShowHint(true) }}
                >
                  <div className="hint-label">
                    {showHint ? '参考答案' : '点击查看参考答案'}
                  </div>
                  <div className="hint-text"><MathText>{currentQuestion.recommended_answer}</MathText></div>
                </div>
              )}

              {/* Answer input */}
              <textarea
                className="text-input grill-answer-input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="输入你的回答..."
                rows={3}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <div className="btn-row">
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={loading || !answer.trim()}
                >
                  {loading ? '提交中' : '提交回答'}
                </button>
                <button className="btn btn-secondary" onClick={handleStart} disabled={loading}>
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
                <p className="empty-state">
                  {encouragement || '所有问题已回答完毕，点击"重新开始"再试一次。'}
                </p>
              )}
            </div>
          )}

          {/* Encouragement / feedback message */}
          {encouragement && currentQuestion && (
            <div className="grill-encouragement">
              <div className="grill-encouragement-label">系统反馈</div>
              <div className="grill-encouragement-text">{encouragement}</div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
