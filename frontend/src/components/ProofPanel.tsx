import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'

const CURRICULUM_LEVELS = [
  { value: 'group_theory', label: '群论（大学）' },
  { value: 'linear_algebra', label: '线性代数（大学）' },
  { value: 'number_theory', label: '数论（大学）' },
  { value: 'discrete_math', label: '离散数学（大学）' },
  { value: 'calculus', label: '积分学（大学）' },
  { value: 'high_school', label: '高中' },
  { value: 'middle_school', label: '初中' },
  { value: 'elementary', label: '小学' },
]

/** Human-readable label for a raw theorem id like "identity_unique". */
function formatTheoremName(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function ProofPanel() {
  const { proofState, fetchTheorems, submitProof, loading } = useStore()
  const { theorems, currentResult, selectedTheorem } = proofState

  const [steps, setSteps] = useState<string[]>([''])
  const [curriculumLevel, setCurriculumLevel] = useState<string>('group_theory')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTheorems(curriculumLevel)
  }, [curriculumLevel, fetchTheorems])

  useEffect(() => {
    if (theorems.length > 0 && !selectedTheorem) {
      useStore.getState().setSelectedTheorem(theorems[0])
    }
  }, [theorems, selectedTheorem])

  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, ''])
  }, [])

  const removeStep = useCallback((idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const updateStep = useCallback((idx: number, value: string) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? value : s)))
  }, [])

  const handleSubmit = useCallback(() => {
    const validSteps = steps.map((s) => s.trim()).filter(Boolean)
    if (!selectedTheorem) {
      setError('请先选择一个定理')
      return
    }
    if (validSteps.length === 0) {
      setError('请至少写一个证明步骤')
      return
    }
    setError(null)
    submitProof(selectedTheorem, validSteps, curriculumLevel)
  }, [steps, selectedTheorem, curriculumLevel, submitProof])

  const progressParts = currentResult?.progress?.split('/') ?? []
  const matched = parseInt(progressParts[0]) || 0
  const total = parseInt(progressParts[1]) || 0
  const progressPct = total > 0 ? (matched / total) * 100 : 0

  return (
    <section className="card">
      <h2>证明验证</h2>
      <p className="card-desc">
        选择定理，逐步写出你的证明，系统会逐步验证并提供苏格拉底式提示。
      </p>

      {/* Curriculum level selector */}
      <div className="form-row">
        <label className="form-label" htmlFor="proof-level">课程级别</label>
        <select
          id="proof-level"
          className="select-input"
          value={curriculumLevel}
          onChange={(e) => {
            setCurriculumLevel(e.target.value)
            useStore.getState().setSelectedTheorem(null)
          }}
        >
          {CURRICULUM_LEVELS.map((lvl) => (
            <option key={lvl.value} value={lvl.value}>
              {lvl.label}
            </option>
          ))}
        </select>
      </div>

      {/* Theorem selector */}
      <div className="form-row">
        <label className="form-label" htmlFor="proof-theorem">选择定理</label>
        <select
          id="proof-theorem"
          className="select-input"
          value={selectedTheorem ?? ''}
          onChange={(e) => useStore.getState().setSelectedTheorem(e.target.value)}
        >
          <option value="" disabled>
            {theorems.length === 0 ? '加载中' : '请选择定理'}
          </option>
          {theorems.map((id) => (
            <option key={id} value={id}>
              {formatTheoremName(id)}
            </option>
          ))}
        </select>
      </div>

      {/* Theorem environment */}
      {selectedTheorem && (
        <div className="theorem-env">
          <span className="theorem-label">定理</span>
          <div className="theorem-statement">
            <MathText>{formatTheoremName(selectedTheorem)}</MathText>
          </div>
        </div>
      )}

      {/* Proof steps editor */}
      <div>
        <h3>证明步骤</h3>
        {steps.map((step, idx) => (
          <div key={idx} className="step-editor-row">
            <span className="step-number">{idx + 1}</span>
            <textarea
              className="text-input step-textarea"
              value={step}
              onChange={(e) => updateStep(idx, e.target.value)}
              placeholder={`第 ${idx + 1} 步：写出你的推导...`}
              rows={2}
            />
            {steps.length > 1 && (
              <button
                className="btn-icon"
                onClick={() => removeStep(idx)}
                title="删除此步骤"
                aria-label="删除此步骤"
              >
                {'\u00d7'}
              </button>
            )}
          </div>
        ))}
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={addStep}>
            {'\u002b'} 添加步骤
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !selectedTheorem}
          >
            {loading ? '验证中' : '提交验证'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">
          {error}
        </div>
      )}

      {/* Results display */}
      {currentResult && (
        <div className="proof-results">
          <h3>
            验证结果
            {currentResult.is_complete && <span className="qed complete" title="Q.E.D." />}
          </h3>

          {/* Overall feedback */}
          <div
            className={`alert ${currentResult.is_complete ? 'alert-success' : 'alert-warning'}`}
          >
            <MathText>{currentResult.overall_feedback}</MathText>
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="progress-section">
              <div className="progress-label">
                进度 {currentResult.progress} 步
              </div>
              <div className="progress-bar-track">
                <div
                  className={`progress-bar-fill ${currentResult.is_complete ? 'stat-bar-fill success' : 'stat-bar-fill'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Per-step results */}
          {currentResult.steps.length > 0 && (
            <div className="step-results">
              <h3>步骤详情</h3>
              {currentResult.steps.map((step) => (
                <div
                  key={step.step_number}
                  className={`step-result ${step.is_valid ? 'valid' : 'invalid'}`}
                >
                  <div className="step-result-header">
                    <span className="step-result-icon">
                      {step.is_valid ? '\u2713' : '\u2717'}
                    </span>
                    <span className="step-result-num">第 {step.step_number} 步</span>
                  </div>
                  <div className="step-result-claim"><MathText>{step.claim}</MathText></div>
                  {step.justification && (
                    <div className="step-result-just">{step.justification}</div>
                  )}
                  <div className="step-result-feedback"><MathText>{step.feedback}</MathText></div>
                  {/* Implicit steps covered */}
                  {step.implicit_steps.length > 0 && (
                    <div className="implicit-steps">
                      <span className="badge badge-implicit">
                        隐含覆盖 {step.implicit_steps.length} 步
                      </span>
                      {step.implicit_steps.map((impl, i) => (
                        <div key={i} className="implicit-step-item">
                          {impl}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Missing steps */}
          {currentResult.missing_steps.length > 0 && (
            <div className="missing-steps">
              <h3>
                <span className="badge badge-warning">缺失步骤</span>
              </h3>
              {currentResult.missing_steps.map((ms, i) => (
                <div key={i} className="missing-step-item">
                  <span className="missing-icon">{'\u26a0'}</span>
                  {ms}
                </div>
              ))}
            </div>
          )}

          {/* Socratic hint */}
          {currentResult.socratic_hint && (
            <div className="socratic-hint">
              <div className="socratic-hint-label">苏格拉底提示</div>
              <div className="socratic-hint-text"><MathText>{currentResult.socratic_hint}</MathText></div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
