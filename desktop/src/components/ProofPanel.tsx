import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../stores/sessionStore'
import { MathText } from './MathText'
import { DragDropProofSteps } from './DragDropProofSteps'

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

function formatTheoremName(id: string): string {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function ProofPanel() {
  const proofState = useStore((s) => s.proofState)
  const fetchTheorems = useStore((s) => s.fetchTheorems)
  const submitProof = useStore((s) => s.submitProof)
  const loading = useStore((s) => s.loading)
  const backendReady = useStore((s) => s.backendReady)
  const { theorems, currentResult, selectedTheorem } = proofState

  const [steps, setSteps] = useState<string[]>([''])
  const [curriculumLevel, setCurriculumLevel] = useState<string>('group_theory')
  const [error, setError] = useState<string | null>(null)

  // Container ref for querying step textareas rendered by DragDropProofSteps.
  const stepsContainerRef = useRef<HTMLDivElement>(null)

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

  const reorderSteps = useCallback((newSteps: string[]) => {
    setSteps(newSteps)
  }, [])

  // Append a new step pre-filled with the given text.
  // Used by missing-steps, implicit-steps, and socratic-hint interactions.
  const insertStep = useCallback((text: string) => {
    setSteps((prev) => [...prev, text])
  }, [])

  // Smoothly scroll to (and focus) the textarea for the given step index.
  // DragDropProofSteps renders textareas with class `ddps-step-textarea`.
  const scrollToStep = useCallback((idx: number) => {
    const container = stepsContainerRef.current
    if (!container) return
    const textareas = container.querySelectorAll<HTMLTextAreaElement>('.ddps-step-textarea')
    const el = textareas[idx]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
    }
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
      <p className="desc">
        选择定理，逐步写出你的证明，系统会逐步验证并提供苏格拉底式提示。
      </p>

      <div className="form-group">
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

      <div className="form-group">
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

      {selectedTheorem && (
        <div className="theorem-env">
          <span className="theorem-label">定理</span>
          <div className="theorem-statement">
            <MathText>{formatTheoremName(selectedTheorem)}</MathText>
          </div>
        </div>
      )}

      <div>
        <h3>证明步骤 <span className="card-hint">拖动 ⠿ 手柄重新排序</span></h3>
        <div ref={stepsContainerRef}>
          <DragDropProofSteps
            steps={steps}
            onReorder={reorderSteps}
            onEdit={updateStep}
            onRemove={removeStep}
          />
        </div>
        <div className="btn-row">
          <button className="btn" onClick={addStep}>
            {'\u002b'} 添加步骤
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !selectedTheorem || !backendReady}
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

      {currentResult && (
        <div className="proof-results">
          <h3>
            验证结果
            {currentResult.is_complete && <span className="qed complete" title="Q.E.D." />}
          </h3>

          <div
            className={`alert ${currentResult.is_complete ? 'alert-success' : 'alert-warning'}`}
          >
            <MathText>{currentResult.overall_feedback}</MathText>
          </div>

          {total > 0 && (
            <div className="progress-section">
              <div className="progress-label">
                进度 {currentResult.progress} 步
              </div>
              <div className="progress-bar-track">
                <div
                  className={`progress-bar-fill ${currentResult.is_complete ? 'success' : ''}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {currentResult.steps.length > 0 && (
            <div className="step-results">
              <h3>步骤详情</h3>
              {currentResult.steps.map((step) => {
                // step.step_number is 1-based; map it to the 0-based steps array index.
                const targetIdx = Math.max(0, step.step_number - 1)
                return (
                  <div
                    key={step.step_number}
                    className={`step-result step-result-clickable ${step.is_valid ? 'valid' : 'invalid'}`}
                    data-step-idx={targetIdx}
                    title="点击跳转到该步骤编辑器"
                    onClick={() => scrollToStep(targetIdx)}
                  >
                    <div className="step-result-header">
                      <span className="step-result-icon">
                        {step.is_valid ? '\u2713' : '\u2717'}
                      </span>
                      <span className="step-result-num">第 {step.step_number} 步</span>
                      <span className="step-edit-link" title="跳转到该步骤编辑器">
                        {'\u2192'} 编辑
                      </span>
                    </div>
                    <div className="step-result-claim"><MathText>{step.claim}</MathText></div>
                    {step.justification && (
                      <div className="step-result-just">{step.justification}</div>
                    )}
                    <div className="step-result-feedback"><MathText>{step.feedback}</MathText></div>
                    {step.implicit_steps.length > 0 && (
                      <div className="implicit-steps">
                        <span className="badge badge-warning">
                          隐含覆盖 {step.implicit_steps.length} 步
                        </span>
                        {step.implicit_steps.map((impl, i) => (
                          <div key={i} className="implicit-step-item">
                            <span className="implicit-step-text">{impl}</span>
                            <button
                              className="btn btn-small"
                              title="插入为新步骤"
                              onClick={(e) => {
                                e.stopPropagation()
                                insertStep(impl)
                              }}
                            >
                              插入
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {currentResult.missing_steps.length > 0 && (
            <div className="missing-steps">
              <h3>
                <span className="badge badge-warning">缺失步骤</span>
              </h3>
              {currentResult.missing_steps.map((ms, i) => (
                <button
                  key={i}
                  type="button"
                  className="missing-step-item missing-step-clickable"
                  title="点击插入此步骤"
                  onClick={() => insertStep(ms)}
                >
                  <span className="missing-icon">{'\u002b'}</span>
                  {ms}
                </button>
              ))}
            </div>
          )}

          {currentResult.socratic_hint && (
            <div className="socratic-hint">
              <div className="socratic-hint-label">苏格拉底提示</div>
              <div className="socratic-hint-text"><MathText>{currentResult.socratic_hint}</MathText></div>
              <button
                type="button"
                className="btn"
                title="插入此提示作为新步骤，帮助开始"
                onClick={() =>
                  insertStep(`（需要补充：${currentResult.socratic_hint}）`)
                }
              >
                需要更多提示
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
