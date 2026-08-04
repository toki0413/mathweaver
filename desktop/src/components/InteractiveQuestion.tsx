import { useState, useMemo, useCallback, useEffect } from 'react'
import { MathText } from './MathText'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionType = 'choice' | 'truefalse' | 'matching' | 'open'

interface ChoiceOption {
  label: string // "A", "B", "C", "D"
  text: string
}

interface MatchPair {
  id: string
  left: string
  right: string
  shuffledRight: string
}

export interface InteractiveQuestionProps {
  question: string
  recommendedAnswer?: string
  /** Called with the user's answer text when submitted */
  onSubmit: (answer: string) => void
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Scoped CSS — prefixed `iq-` to avoid collisions
// ---------------------------------------------------------------------------

const SCOPED_CSS = `
.iq-wrapper { width: 100%; }

.iq-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
  letter-spacing: 0.03em;
}
.iq-type-badge.choice {
  background: hsla(222, 35%, 36%, 0.1);
  color: var(--accent);
  border: 1px solid hsla(222, 35%, 36%, 0.25);
}
.iq-type-badge.truefalse {
  background: hsla(35, 70%, 40%, 0.1);
  color: var(--warn);
  border: 1px solid hsla(35, 70%, 40%, 0.25);
}
.iq-type-badge.matching {
  background: hsla(38, 55%, 38%, 0.1);
  color: var(--accent2);
  border: 1px solid hsla(38, 55%, 38%, 0.25);
}
.iq-type-badge.open {
  background: var(--bg3);
  color: var(--muted);
  border: 1px solid var(--border);
}

/* === Choice question === */
.iq-choice-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.iq-choice-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 2px solid var(--border);
  border-radius: 10px;
  background: var(--bg2);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}
.iq-choice-option:hover {
  border-color: var(--accent);
  background: var(--accent-subtle);
  transform: translateX(2px);
}
.iq-choice-option.selected {
  border-color: var(--accent);
  background: var(--accent-subtle);
  box-shadow: 0 0 0 3px hsla(222, 35%, 36%, 0.12);
}
.iq-choice-label {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  background: var(--bg3);
  color: var(--muted);
  transition: all 0.2s ease;
}
.iq-choice-option:hover .iq-choice-label,
.iq-choice-option.selected .iq-choice-label {
  background: var(--accent);
  color: var(--accent-text);
}
.iq-choice-text {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
  padding-top: 3px;
}

/* === True/False question === */
.iq-tf-container {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}
.iq-tf-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 12px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--bg2);
  cursor: pointer;
  transition: all 0.25s ease;
  user-select: none;
}
.iq-tf-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}
.iq-tf-btn.true-btn:hover {
  border-color: var(--ok);
  background: var(--ok-bg);
}
.iq-tf-btn.false-btn:hover {
  border-color: var(--err);
  background: var(--err-bg);
}
.iq-tf-btn.true-btn.selected {
  border-color: var(--ok);
  background: var(--ok-bg);
  box-shadow: 0 0 0 3px hsla(142, 40%, 32%, 0.15);
}
.iq-tf-btn.false-btn.selected {
  border-color: var(--err);
  background: var(--err-bg);
  box-shadow: 0 0 0 3px hsla(5, 60%, 42%, 0.15);
}
.iq-tf-icon {
  font-size: 28px;
  line-height: 1;
}
.iq-tf-label {
  font-weight: 700;
  font-size: 15px;
}

/* === Matching question === */
.iq-match-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
}
.iq-match-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.iq-match-item {
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--bg2);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 13px;
  user-select: none;
  position: relative;
}
.iq-match-item:hover {
  border-color: var(--accent2);
}
.iq-match-item.selected-left {
  border-color: var(--accent2);
  background: hsla(38, 55%, 38%, 0.08);
  box-shadow: 0 0 0 3px hsla(38, 55%, 38%, 0.12);
}
.iq-match-item.matched {
  border-color: var(--ok);
  background: var(--ok-bg);
  opacity: 0.7;
  cursor: default;
}
.iq-match-item.matched::after {
  content: '✓';
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ok);
  font-weight: 700;
}
.iq-match-line {
  position: absolute;
  pointer-events: none;
  z-index: 5;
}
.iq-match-pair-num {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent2);
  color: white;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  line-height: 18px;
  margin-right: 4px;
}

/* === Submit button === */
.iq-submit-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.iq-submit-btn {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.iq-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.iq-submit-btn.primary {
  background: var(--accent);
  color: var(--accent-text);
}
.iq-submit-btn.primary:not(:disabled):hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}

/* === Mode toggle === */
.iq-mode-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.iq-mode-btn {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg2);
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.iq-mode-btn.active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: var(--accent);
}
.iq-mode-btn:hover:not(.active) {
  border-color: var(--border-strong);
  color: var(--ink);
}

@media (max-width: 520px) {
  .iq-match-grid {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .iq-tf-container {
    flex-direction: row;
  }
}
`

// ---------------------------------------------------------------------------
// Question type detection
// ---------------------------------------------------------------------------

function detectQuestionType(question: string, recommendedAnswer?: string): QuestionType {
  const q = question.toLowerCase().trim()

  // True/False: questions asking to judge correctness
  const trueFalsePatterns = [
    /判断.*(对错|正误|是否)/,
    /是否(正确|成立|为真)/,
    /下列.*(说法|命题|断言).*是否/,
    /^判断[：:]/,
    /对错题/,
  ]
  if (trueFalsePatterns.some(p => p.test(q))) return 'truefalse'

  // Matching: questions with "对应", "匹配", "连线"
  const matchingPatterns = [/将.*对应/, /匹配/, /连线/, /把.*和.*对应起来/]
  if (matchingPatterns.some(p => p.test(q))) return 'matching'

  // Choice: detect options in question text
  const hasLetterOptions = /[A-D][.、．)]\s/.test(question)
  const hasNumOptions = /[①②③④⑤]/.test(question) || /[（(][1-4][)）]/.test(question)
  if (hasLetterOptions || hasNumOptions) return 'choice'

  // Also check if recommended answer is very short (likely true/false)
  if (recommendedAnswer) {
    const ans = recommendedAnswer.trim().toLowerCase()
    if (['是', '否', '对', '错', '正确', '错误', '成立', '不成立', '真', '假'].includes(ans)) {
      return 'truefalse'
    }
  }

  return 'open'
}

// ---------------------------------------------------------------------------
// Parse choice options from question text
// ---------------------------------------------------------------------------

function parseChoiceOptions(question: string): ChoiceOption[] {
  const options: ChoiceOption[] = []

  // Pattern: "A. text" or "A、text" or "A) text"
  const letterPattern = /([A-D])[.、．)]\s*(.+?)(?=[A-D][.、．)]|$)/g
  let match
  while ((match = letterPattern.exec(question)) !== null) {
    options.push({
      label: match[1],
      text: match[2].trim(),
    })
  }

  if (options.length >= 2) return options

  // Pattern: ① ② ③ ④
  const circledPattern = /([①②③④⑤])\s*(.+?)(?=[①②③④⑤]|$)/g
  while ((match = circledPattern.exec(question)) !== null) {
    const num = '①②③④⑤'.indexOf(match[1]) + 1
    options.push({
      label: String.fromCharCode(64 + num), // A, B, C, D, E
      text: match[2].trim(),
    })
  }

  if (options.length >= 2) return options

  // Pattern: (1) (2) (3)
  const parenPattern = /[（(]([1-4])[)）]\s*(.+?)(?=[（(][1-4][)）]|$)/g
  while ((match = parenPattern.exec(question)) !== null) {
    const num = parseInt(match[1])
    options.push({
      label: String.fromCharCode(64 + num),
      text: match[2].trim(),
    })
  }

  return options
}

// ---------------------------------------------------------------------------
// Parse matching pairs from question text
// ---------------------------------------------------------------------------

function parseMatchPairs(question: string): MatchPair[] {
  const pairs: MatchPair[] = []

  // Try to find "X ↔ Y" or "X → Y" or "X: Y" patterns
  const arrowPattern = /(.+?)\s*[↔→:：]\s*(.+?)(?=[\n;；]|$)/g
  let match
  let idx = 0
  while ((match = arrowPattern.exec(question)) !== null) {
    const left = match[1].trim()
    const right = match[2].trim()
    if (left.length > 0 && right.length > 0 && left.length < 50) {
      pairs.push({
        id: `pair_${idx}`,
        left,
        right,
        shuffledRight: right,
      })
      idx++
    }
  }

  // Shuffle the right column
  if (pairs.length > 1) {
    const rights = pairs.map(p => p.right)
    for (let i = rights.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rights[i], rights[j]] = [rights[j], rights[i]]
    }
    pairs.forEach((p, i) => (p.shuffledRight = rights[i]))
  }

  return pairs
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InteractiveQuestion: React.FC<InteractiveQuestionProps> = ({
  question,
  recommendedAnswer,
  onSubmit,
  disabled,
}) => {
  const detectedType = useMemo(
    () => detectQuestionType(question, recommendedAnswer),
    [question, recommendedAnswer],
  )
  const [activeType, setActiveType] = useState<QuestionType>(detectedType)

  // Reset when question changes
  useEffect(() => {
    setActiveType(detectedType)
    setSelectedChoice(null)
    setSelectedTF(null)
    setSelectedLeft(null)
    setMatchedPairs({})
  }, [question, detectedType])

  // Choice state
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)

  // True/False state
  const [selectedTF, setSelectedTF] = useState<boolean | null>(null)

  // Matching state
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null)
  const [matchedPairs, setMatchedPairs] = useState<Record<string, string>>({})
  const matchPairs = useMemo(() => parseMatchPairs(question), [question])
  const matchRightOptions = useMemo(
    () => matchPairs.map(p => ({ id: p.id, text: p.shuffledRight })),
    [matchPairs],
  )

  // Open-ended state
  const [openAnswer, setOpenAnswer] = useState('')

  const choiceOptions = useMemo(() => parseChoiceOptions(question), [question])

  const handleSubmit = useCallback(() => {
    if (activeType === 'choice' && selectedChoice) {
      onSubmit(selectedChoice)
    } else if (activeType === 'truefalse' && selectedTF !== null) {
      onSubmit(selectedTF ? '正确' : '错误')
    } else if (activeType === 'matching') {
      // Build answer from matched pairs
      const parts: string[] = []
      for (const pair of matchPairs) {
        const matched = matchedPairs[pair.id]
        if (matched) {
          parts.push(`${pair.left} → ${matched}`)
        }
      }
      if (parts.length > 0) {
        onSubmit(parts.join('; '))
      }
    } else if (activeType === 'open' && openAnswer.trim()) {
      onSubmit(openAnswer.trim())
    }
  }, [activeType, selectedChoice, selectedTF, matchedPairs, matchPairs, openAnswer, onSubmit])

  const canSubmit = useMemo(() => {
    if (disabled) return false
    switch (activeType) {
      case 'choice':
        return !!selectedChoice
      case 'truefalse':
        return selectedTF !== null
      case 'matching':
        return Object.keys(matchedPairs).length === matchPairs.length && matchPairs.length > 0
      case 'open':
        return !!openAnswer.trim()
    }
  }, [activeType, selectedChoice, selectedTF, matchedPairs, matchPairs, openAnswer, disabled])

  // -- Matching interaction handler --
  const handleMatchClick = useCallback(
    (side: 'left' | 'right', id: string, text: string) => {
      if (side === 'left') {
        // If already matched, unmatch
        if (matchedPairs[id]) {
          setMatchedPairs(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
          return
        }
        setSelectedLeft(id)
      } else {
        // Right side clicked
        if (!selectedLeft) return

        // Check if this right text is already used by another pair
        const alreadyUsed = Object.entries(matchedPairs).find(([_, val]) => val === text)
        if (alreadyUsed) {
          // Unmatch the previous pairing
          setMatchedPairs(prev => {
            const next = { ...prev }
            delete next[alreadyUsed[0]]
            return next
          })
        }

        // Create the match
        setMatchedPairs(prev => ({ ...prev, [selectedLeft]: text }))
        setSelectedLeft(null)
      }
    },
    [selectedLeft, matchedPairs],
  )

  const getPairNumber = useCallback(
    (leftId: string): number | null => {
      const idx = matchPairs.findIndex(p => p.id === leftId)
      if (idx === -1) return null
      const matchEntry = Object.entries(matchedPairs).find(([key]) => key === leftId)
      if (!matchEntry) return null
      return idx + 1
    },
    [matchPairs, matchedPairs],
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="iq-wrapper">
      <style>{SCOPED_CSS}</style>

      {/* Type badge + mode toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span className={`iq-type-badge ${activeType}`}>
          {activeType === 'choice' && '🔘 选择题'}
          {activeType === 'truefalse' && '⚖ 判断题'}
          {activeType === 'matching' && '🔗 匹配题'}
          {activeType === 'open' && '✍ 简答题'}
        </span>

        {/* Allow switching to open-ended mode for any question type */}
        {activeType !== 'open' && (
          <div className="iq-mode-toggle">
            <button
              className="iq-mode-btn"
              onClick={() => setActiveType('open')}
              title="切换为自由输入模式"
            >
              ✍ 自由输入
            </button>
          </div>
        )}
        {activeType === 'open' && detectedType !== 'open' && (
          <div className="iq-mode-toggle">
            <button
              className="iq-mode-btn active"
              onClick={() => setActiveType(detectedType)}
              title="返回交互模式"
            >
              ← 返回交互模式
            </button>
          </div>
        )}
      </div>

      {/* === Choice === */}
      {activeType === 'choice' && choiceOptions.length >= 2 && (
        <>
          <div className="iq-choice-grid">
            {choiceOptions.map(opt => (
              <div
                key={opt.label}
                className={`iq-choice-option ${selectedChoice === opt.label ? 'selected' : ''}`}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && setSelectedChoice(opt.label)}
                onKeyDown={e => {
                  if (!disabled && (e.key === 'Enter' || e.key === ' '))
                    setSelectedChoice(opt.label)
                }}
              >
                <span className="iq-choice-label">{opt.label}</span>
                <span className="iq-choice-text">
                  <MathText>{opt.text}</MathText>
                </span>
              </div>
            ))}
          </div>
          <div className="iq-submit-row">
            <button className="iq-submit-btn primary" onClick={handleSubmit} disabled={!canSubmit}>
              提交选择
            </button>
          </div>
        </>
      )}

      {/* Fallback: if choice parsing failed, show open input */}
      {activeType === 'choice' && choiceOptions.length < 2 && (
        <OpenAnswerInput
          value={openAnswer}
          onChange={setOpenAnswer}
          onSubmit={handleSubmit}
          canSubmit={canSubmit}
          disabled={disabled}
        />
      )}

      {/* === True/False === */}
      {activeType === 'truefalse' && (
        <>
          <div className="iq-tf-container">
            <div
              className={`iq-tf-btn true-btn ${selectedTF === true ? 'selected' : ''}`}
              role="button"
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && setSelectedTF(true)}
              onKeyDown={e => {
                if (!disabled && (e.key === 'Enter' || e.key === ' ')) setSelectedTF(true)
              }}
            >
              <span className="iq-tf-icon">✓</span>
              <span className="iq-tf-label">正确</span>
            </div>
            <div
              className={`iq-tf-btn false-btn ${selectedTF === false ? 'selected' : ''}`}
              role="button"
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && setSelectedTF(false)}
              onKeyDown={e => {
                if (!disabled && (e.key === 'Enter' || e.key === ' ')) setSelectedTF(false)
              }}
            >
              <span className="iq-tf-icon">✗</span>
              <span className="iq-tf-label">错误</span>
            </div>
          </div>
          <div className="iq-submit-row">
            <button className="iq-submit-btn primary" onClick={handleSubmit} disabled={!canSubmit}>
              确认判断
            </button>
          </div>
        </>
      )}

      {/* === Matching === */}
      {activeType === 'matching' && matchPairs.length >= 2 && (
        <>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
            点击左侧条目，再点击右侧对应答案进行配对
          </div>
          <div className="iq-match-grid">
            {/* Left column */}
            <div className="iq-match-col">
              {matchPairs.map(pair => {
                const isMatched = !!matchedPairs[pair.id]
                const isSelected = selectedLeft === pair.id
                const pairNum = getPairNumber(pair.id)
                return (
                  <div
                    key={pair.id}
                    className={`iq-match-item ${isSelected ? 'selected-left' : ''} ${isMatched ? 'matched' : ''}`}
                    role="button"
                    tabIndex={disabled || isMatched ? -1 : 0}
                    onClick={() =>
                      !disabled && !isMatched && handleMatchClick('left', pair.id, pair.left)
                    }
                    onKeyDown={e => {
                      if (!disabled && !isMatched && (e.key === 'Enter' || e.key === ' '))
                        handleMatchClick('left', pair.id, pair.left)
                    }}
                  >
                    {pairNum && <span className="iq-match-pair-num">{pairNum}</span>}
                    <MathText>{pair.left}</MathText>
                  </div>
                )
              })}
            </div>
            {/* Right column (shuffled) */}
            <div className="iq-match-col">
              {matchRightOptions.map((opt, i) => {
                const isUsed = Object.values(matchedPairs).includes(opt.text)
                return (
                  <div
                    key={i}
                    className={`iq-match-item ${isUsed ? 'matched' : ''}`}
                    role="button"
                    tabIndex={disabled || isUsed ? -1 : 0}
                    onClick={() =>
                      !disabled && !isUsed && handleMatchClick('right', opt.id, opt.text)
                    }
                    onKeyDown={e => {
                      if (!disabled && !isUsed && (e.key === 'Enter' || e.key === ' '))
                        handleMatchClick('right', opt.id, opt.text)
                    }}
                  >
                    <MathText>{opt.text}</MathText>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="iq-submit-row">
            <button className="iq-submit-btn primary" onClick={handleSubmit} disabled={!canSubmit}>
              提交配对 ({Object.keys(matchedPairs).length}/{matchPairs.length})
            </button>
          </div>
        </>
      )}

      {/* Fallback: if matching parsing failed */}
      {activeType === 'matching' && matchPairs.length < 2 && (
        <OpenAnswerInput
          value={openAnswer}
          onChange={setOpenAnswer}
          onSubmit={handleSubmit}
          canSubmit={canSubmit}
          disabled={disabled}
        />
      )}

      {/* === Open-ended === */}
      {activeType === 'open' && (
        <OpenAnswerInput
          value={openAnswer}
          onChange={setOpenAnswer}
          onSubmit={handleSubmit}
          canSubmit={canSubmit}
          disabled={disabled}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Open-ended answer input (reused sub-component)
// ---------------------------------------------------------------------------

interface OpenAnswerInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  canSubmit: boolean
  disabled?: boolean
}

const OpenAnswerInput: React.FC<OpenAnswerInputProps> = ({
  value,
  onChange,
  onSubmit,
  canSubmit,
  disabled,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <>
      <textarea
        className="text-input grill-answer-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="输入你的回答..."
        rows={3}
        onKeyDown={handleKeyDown}
        autoFocus
        disabled={disabled}
      />
      <div className="iq-submit-row">
        <button className="iq-submit-btn primary" onClick={onSubmit} disabled={!canSubmit}>
          提交回答
        </button>
      </div>
    </>
  )
}
