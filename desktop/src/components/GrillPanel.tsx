import { useState, useCallback, useEffect } from 'react'
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

// 分级提示配色（内联样式，避免依赖外部 CSS）
const L1_STYLE = { backgroundColor: '#e8f5e9', borderColor: '#4caf50', color: '#2e7d32' }
const L2_STYLE = { backgroundColor: '#fffde7', borderColor: '#fbc02d', color: '#f57f17' }
const ANSWER_STYLE = { backgroundColor: '#fff3e0', borderColor: '#fb8c00', color: '#e65100' }

export function GrillPanel() {
  const grillState = useStore((s) => s.grillState)
  const startGrill = useStore((s) => s.startGrill)
  const submitGrillAnswer = useStore((s) => s.submitGrillAnswer)
  const loading = useStore((s) => s.loading)
  const backendReady = useStore((s) => s.backendReady)
  const { active, currentQuestion, difficulty, questionsAsked, encouragement, summary } = grillState

  const [answer, setAnswer] = useState('')
  // 0 = 隐藏, 1 = L1 提示, 2 = L2 提示, 3 = 完整答案
  const [hintLevel, setHintLevel] = useState(0)
  const [answerStartTime, setAnswerStartTime] = useState<number>(Date.now())
  const [curriculumLevel, setCurriculumLevel] = useState<string>('')
  const [studentId] = useState(`grill_${Date.now().toString().slice(-6)}`)

  const handleStart = useCallback(() => {
    setAnswerStartTime(Date.now())
    setHintLevel(0)
    setAnswer('')
    startGrill(studentId, curriculumLevel || undefined)
  }, [studentId, curriculumLevel, startGrill])

  const handleSubmit = useCallback(() => {
    if (!answer.trim() || !currentQuestion) return
    const rt = Date.now() - answerStartTime
    submitGrillAnswer(currentQuestion.qid, answer, rt)
    setAnswer('')
    setHintLevel(0)
    setAnswerStartTime(Date.now())
  }, [answer, currentQuestion, answerStartTime, submitGrillAnswer])

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

  // 由参考答案派生分级提示
  const recommendedAnswer = currentQuestion?.recommended_answer ?? ''
  const l1Hint = recommendedAnswer.length > 30 ? recommendedAnswer.slice(0, 30) + '...' : recommendedAnswer
  const l2Hint = recommendedAnswer.length > 80 ? recommendedAnswer.slice(0, 80) + '...' : recommendedAnswer

  return (
    <section className="card grill-panel">
      <h2>Grill 面试模式</h2>
      <p className="desc">
        系统逐个提问，考察你对概念的理解。每题都有参考答案，先思考再查看。
      </p>

      {!active && (
        <div className="grill-start-section">
          <div className="form-group">
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
            <button className="btn btn-primary" onClick={handleStart} disabled={loading || !backendReady}>
              {loading ? '启动中' : '开始面试'}
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
                {summary ? `正确 ${summary.correct_answers}/${summary.resolved_branches}` : ''}
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
                  {adaptive.trend === 'rising' ? '\u2191' : adaptive.trend === 'falling' ? '\u2193' : '\u2014'}
                </div>
                <div className="grill-stat-sub">{adaptive.trend}</div>
              </div>
            )}
          </div>

          {currentQuestion ? (
            <div className="grill-question-section">
              {currentQuestion.concept_name && (
                <div className="grill-concept-tag">
                  {currentQuestion.concept_name}
                  {currentQuestion.branch_type !== 'concept' && (
                    <span className="badge badge-warning" style={{ marginLeft: '6px' }}>{currentQuestion.branch_type}</span>
                  )}
                </div>
              )}
              <div className="grill-question-text"><MathText>{currentQuestion.question}</MathText></div>

              {currentQuestion.recommended_answer && (
                <div className="hint-section">
                  {hintLevel === 0 ? (
                    <div className="hint-buttons btn-row">
                      <button
                        className="btn btn-hint-l1"
                        style={L1_STYLE}
                        onClick={() => setHintLevel(1)}
                      >
                        L1 提示
                      </button>
                      <button
                        className="btn btn-hint-l2"
                        style={L2_STYLE}
                        onClick={() => setHintLevel(2)}
                      >
                        L2 提示
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
                          <div className="hint-text"><MathText>{l1Hint}</MathText></div>
                        </div>
                      )}
                      {hintLevel >= 2 && (
                        <div className="hint-box hint-l2" style={L2_STYLE}>
                          <div className="hint-label">L2 提示</div>
                          <div className="hint-text"><MathText>{l2Hint}</MathText></div>
                        </div>
                      )}
                      {hintLevel === 3 && (
                        <div className="hint-box hint-answer" style={ANSWER_STYLE}>
                          <div className="hint-label">参考答案</div>
                          <div className="hint-text"><MathText>{currentQuestion.recommended_answer}</MathText></div>
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
        </>
      )}
    </section>
  )
}
