import { useState } from 'react'
import type { AgeLevel } from '../utils/ageAdapt'
import { AGE_LEVELS } from '../utils/ageAdapt'

interface AgeSelectorProps {
  level: AgeLevel
  onChange: (level: AgeLevel) => void
  compact?: boolean
}

/**
 * AgeSelector — 年龄等级选择器
 *
 * 让学习者（或家长/老师）选择年龄等级，
 * 整个产品的语言风格、引导内容、术语表达都会随之适配。
 *
 * compact 模式用于 header 等空间有限的位置。
 */
export function AgeSelector({ level, onChange, compact }: AgeSelectorProps) {
  const [expanded, setExpanded] = useState(false)

  if (compact) {
    const current = AGE_LEVELS.find(a => a.id === level)!
    return (
      <div className="age-selector-compact" onBlur={() => setExpanded(false)} tabIndex={0}>
        <button
          className="age-selector-trigger"
          onClick={() => setExpanded(!expanded)}
          title={current.desc}
        >
          <span className="age-selector-emoji">{current.emoji}</span>
          <span className="age-selector-label">{current.label}</span>
          <span className="age-selector-arrow">{expanded ? '▾' : '▸'}</span>
        </button>
        {expanded && (
          <div className="age-selector-dropdown">
            {AGE_LEVELS.map(a => (
              <button
                key={a.id}
                className={`age-selector-option${a.id === level ? ' active' : ''}`}
                onClick={() => {
                  onChange(a.id)
                  setExpanded(false)
                }}
              >
                <span className="age-selector-emoji">{a.emoji}</span>
                <div className="age-selector-option-text">
                  <span className="age-selector-option-label">{a.label}</span>
                  <span className="age-selector-option-range">{a.range}</span>
                </div>
                {a.id === level && <span className="age-selector-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Full mode — for onboarding or settings
  return (
    <div className="age-selector-full">
      <div className="age-selector-question">选择你的年龄等级</div>
      <div className="age-selector-cards">
        {AGE_LEVELS.map(a => (
          <button
            key={a.id}
            className={`age-selector-card${a.id === level ? ' active' : ''}`}
            onClick={() => onChange(a.id)}
          >
            <span className="age-selector-card-emoji">{a.emoji}</span>
            <span className="age-selector-card-label">{a.label}</span>
            <span className="age-selector-card-range">{a.range}</span>
            <span className="age-selector-card-desc">{a.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default AgeSelector
