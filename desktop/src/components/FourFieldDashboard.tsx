import { memo, useState } from 'react'

/**
 * FourFieldDashboard — displays the four-field cognitive state model.
 *
 * Enhanced features:
 * - Clickable field items with detailed explanations
 * - Tooltip on hover showing metric interpretation
 * - Color-coded values with band indicators
 * - Collapsible sections
 * - Accessibility labels
 * - Actionable decision box with context-aware buttons
 * - All metric items are interactive (hover tooltip + click-to-pin panel)
 */

interface FourFields {
  knowledge: {
    current_node_id: string | null
    mastery_estimate: number
    zpd_lower: number
    zpd_upper: number
    prerequisite_gaps: string[]
    in_zpd: boolean
    ready_to_advance: boolean
  }
  cognitive: {
    response_time_ms: number
    rt_zscore: number
    cognitive_load: number
    state: string
    is_overloaded: boolean
  }
  emotional: {
    anxiety_index: number
    flow_score: number
    state: string
    is_anxious: boolean
    in_flow: boolean
  }
  interaction: {
    current_hint_level: number
    consecutive_correct: number
    scaffold_fade_threshold: number
    should_fade_scaffold: boolean
    is_struggling: boolean
  }
}

interface Props {
  fields: FourFields | null
  decision: { action: string; reason: string } | null
  onAction?: (action: string) => void
}

// Metric explanations for tooltips and the pinned detail panel
const METRIC_EXPLANATIONS = {
  mastery_estimate: {
    title: '掌握度',
    desc: '学生对当前概念节点的掌握程度估计',
    good: '掌握良好，可以考虑进入下一阶段',
    warn: '部分掌握，需要继续练习',
    bad: '尚未掌握，需要更多基础练习',
  },
  zpd: {
    title: '最近发展区',
    desc: '学生的最佳学习难度区间',
    good: '当前内容在最近发展区内',
    warn: '接近上限，注意不要超载',
    bad: '超出最近发展区，需要降低难度',
  },
  in_zpd: {
    title: '在最近发展区内',
    desc: '当前学习内容是否落在学生的最近发展区内',
    good: '内容难度适中，最利于学习',
    warn: '处于边缘，注意调整',
    bad: '超出或低于最近发展区，学习效率低',
  },
  prerequisite_gaps: {
    title: '前置知识缺口',
    desc: '学习当前节点所需但尚未掌握的前置知识点',
    good: '前置知识完备，可继续推进',
    warn: '存在少量缺口，建议补充',
    bad: '缺口较多，需回补基础',
  },
  cognitive_load: {
    title: '认知负荷',
    desc: '当前工作记忆的占用程度',
    good: '负荷适中，学习效率最佳',
    warn: '负荷偏高，建议简化任务',
    bad: '负荷过载，需要休息或降低难度',
  },
  rt_zscore: {
    title: '反应时 z 分数',
    desc: '学生响应时间相对自身基线的标准化得分',
    good: '响应速度正常',
    warn: '略偏慢，可能存在犹豫',
    bad: '显著偏慢，可能认知困难',
  },
  cognitive_state: {
    title: '认知状态',
    desc: '当前认知加工的整体状态判断',
    good: '状态良好，可高效学习',
    warn: '出现疲劳或分散迹象',
    bad: '认知过载，需要调整',
  },
  is_overloaded: {
    title: '认知过载',
    desc: '当前认知负荷是否超过工作记忆容量',
    good: '未过载，负荷可控',
    warn: '接近过载阈值',
    bad: '已过载，需立即减负或休息',
  },
  anxiety: {
    title: '焦虑指数',
    desc: '学生的情绪焦虑程度',
    good: '情绪稳定',
    warn: '轻微焦虑，需要鼓励',
    bad: '焦虑过高，需要降低压力',
  },
  flow: {
    title: '心流分数',
    desc: '学生是否处于沉浸学习状态',
    good: '处于心流状态，学习效率最佳',
    warn: '接近心流，可调整挑战难度',
    bad: '尚未进入心流',
  },
  emotional_state: {
    title: '情感状态',
    desc: '学生当前情绪状态的分类判断',
    good: '处于积极或心流状态',
    warn: '情绪波动，需要关注',
    bad: '焦虑或挫败，需情绪支持',
  },
  in_flow: {
    title: '心流中',
    desc: '学生是否处于沉浸、专注的心流状态',
    good: '处于心流，学习体验最佳',
    warn: '接近心流，可优化挑战匹配',
    bad: '未进入心流',
  },
  hint_level: {
    title: '提示级别',
    desc: '当前提供的脚手架提示等级',
    good: '独立完成，无需提示',
    warn: '需要部分提示',
    bad: '高度依赖提示',
  },
  consecutive_correct: {
    title: '连续正确次数',
    desc: '学生连续答对的次数，反映熟练度趋势',
    good: '连续正确，掌握稳固',
    warn: '波动较大，需要巩固',
    bad: '连续出错，需要支持',
  },
  should_fade_scaffold: {
    title: '应淡出脚手架',
    desc: '是否达到可减少提示、提升自主性的条件',
    good: '可逐步减少提示，促进独立',
    warn: '接近淡出阈值',
    bad: '仍需维持当前提示等级',
  },
  is_struggling: {
    title: '挣扎状态',
    desc: '学生在当前任务上是否表现出明显困难',
    good: '进展顺利',
    warn: '出现困难迹象，关注支持',
    bad: '明显挣扎，需要干预',
  },
} as const

// Decision action button configuration: keyword matchers -> button definition
const DECISION_BUTTONS = [
  {
    keys: ['continue', 'advance'],
    label: '继续',
    cls: 'decision-btn-continue',
    action: 'continue',
  },
  {
    keys: ['review', 'prerequisite'],
    label: '查看前置缺口',
    cls: 'decision-btn-review',
    action: 'review',
  },
  {
    keys: ['reduce', 'lower', 'simplify'],
    label: '降低难度',
    cls: 'decision-btn-reduce',
    action: 'reduce',
  },
  {
    keys: ['pause', 'rest'],
    label: '休息',
    cls: 'decision-btn-pause',
    action: 'pause',
  },
] as const

function FourFieldDashboardBase({ fields, decision, onAction }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [hoveredMetric, setHoveredMetric] = useState<string | null>(null)
  const [pinnedMetric, setPinnedMetric] = useState<string | null>(null)

  if (!fields) {
    return (
      <div className="card">
        <h2>四场状态</h2>
        <div className="dashboard-empty">
          <div className="dashboard-empty-icon">{'\u25CB'}</div>
          <p>开始会话后显示认知状态</p>
        </div>
      </div>
    )
  }

  const { knowledge: k, cognitive: c, emotional: e, interaction: i } = fields

  const cls = (ok: boolean, warn?: boolean) =>
    ok ? 'ok' : warn ? 'warn' : 'err'

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section))
  }

  // Shared interaction props for every field-item: hover tooltip + click-to-pin
  const metricProps = (key: string, ariaLabel: string) => ({
    className: `field-item interactive${pinnedMetric === key ? ' pinned' : ''}`,
    onMouseEnter: () => setHoveredMetric(key),
    onMouseLeave: () => setHoveredMetric(null),
    onFocus: () => setHoveredMetric(key),
    onBlur: () => setHoveredMetric(null),
    onClick: () => setPinnedMetric((prev) => (prev === key ? null : key)),
    tabIndex: 0,
    role: 'button',
    'aria-label': ariaLabel,
    'aria-pressed': pinnedMetric === key,
  })

  // Resolve which decision buttons apply to the current decision action
  const decisionButtons = decision
    ? DECISION_BUTTONS.filter((b) =>
        b.keys.some((kw) => decision.action.toLowerCase().includes(kw)),
      )
    : []

  const renderExplanation = (key: string) => {
    const exp = METRIC_EXPLANATIONS[key as keyof typeof METRIC_EXPLANATIONS]
    if (!exp) return null
    return (
      <>
        <div className="metric-explanation-title">{exp.title}</div>
        <div className="metric-explanation-desc">{exp.desc}</div>
        <div className="metric-explanation-bands">
          <div className="metric-explanation-band ok">
            <span>良好:</span> {exp.good}
          </div>
          <div className="metric-explanation-band warn">
            <span>注意:</span> {exp.warn}
          </div>
          <div className="metric-explanation-band err">
            <span>异常:</span> {exp.bad}
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="card four-field-dashboard">
      <h2>
        四场状态 <span className="card-hint">悬停查看、点击固定指标解释</span>
      </h2>

      {decision && (
        <div className="decision-box">
          <div className="decision-action">{decision.action}</div>
          <div className="decision-reason">{decision.reason}</div>
          {decisionButtons.length > 0 && (
            <div className="decision-actions">
              {decisionButtons.map((b) => (
                <button
                  key={b.action}
                  className={`decision-btn ${b.cls}`}
                  onClick={() => onAction?.(b.action)}
                  disabled={!onAction}
                  aria-label={`${b.label}（${b.action}）`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Knowledge section */}
      <div className={`field-section ${expandedSection === 'knowledge' ? 'expanded' : ''}`}>
        <h3
          className="field-section-header"
          onClick={() => toggleSection('knowledge')}
          role="button"
          tabIndex={0}
          aria-expanded={expandedSection === 'knowledge'}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleSection('knowledge') } }}
        >
          <span className="field-section-toggle">{expandedSection === 'knowledge' ? '\u25BC' : '\u25B8'}</span>
          知识
          <span className={`field-section-status ${k.ready_to_advance ? 'ok' : k.in_zpd ? 'warn' : 'err'}`}>
            {k.ready_to_advance ? '可进阶' : k.in_zpd ? '在 ZPD' : '需基础'}
          </span>
        </h3>
        <div className="field-panel">
          <div {...metricProps('mastery_estimate', `掌握度: ${(k.mastery_estimate * 100).toFixed(0)}%`)}>
            <div className="label">掌握度</div>
            <div className={`value ${cls(k.mastery_estimate > 0.6, k.mastery_estimate > 0.3)}`}>
              {(k.mastery_estimate * 100).toFixed(0)}%
              <div className="mini-bar">
                <div
                  className={`mini-bar-fill ${cls(k.mastery_estimate > 0.6, k.mastery_estimate > 0.3)}`}
                  style={{ width: `${k.mastery_estimate * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div {...metricProps('zpd', `最近发展区: [${k.zpd_lower}, ${k.zpd_upper}]`)}>
            <div className="label">ZPD</div>
            <div className={`value ${k.in_zpd ? 'warn' : 'err'}`}>
              [{k.zpd_lower}, {k.zpd_upper}]
            </div>
          </div>
          <div {...metricProps('in_zpd', `在最近发展区内: ${k.in_zpd ? '是' : '否'}`)}>
            <div className="label">在 ZPD</div>
            <div className={`value ${k.in_zpd ? 'warn' : ''}`}>{k.in_zpd ? '是' : '否'}</div>
          </div>
          <div {...metricProps('prerequisite_gaps', `前置知识缺口: ${k.prerequisite_gaps.length} 个`)}>
            <div className="label">前置缺口</div>
            <div className="value">{k.prerequisite_gaps.length > 0 ? `${k.prerequisite_gaps.length} 个` : '无'}</div>
          </div>
        </div>
        {expandedSection === 'knowledge' && (
          <div className="field-detail">
            {k.prerequisite_gaps.length > 0 && (
              <div className="field-detail-row">
                <span className="field-detail-label">缺口节点:</span>
                <span className="field-detail-value">{k.prerequisite_gaps.join(', ')}</span>
              </div>
            )}
            <div className="field-detail-row">
              <span className="field-detail-label">当前节点:</span>
              <span className="field-detail-value">{k.current_node_id || '无'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Cognitive section */}
      <div className={`field-section ${expandedSection === 'cognitive' ? 'expanded' : ''}`}>
        <h3
          className="field-section-header"
          onClick={() => toggleSection('cognitive')}
          role="button"
          tabIndex={0}
          aria-expanded={expandedSection === 'cognitive'}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleSection('cognitive') } }}
        >
          <span className="field-section-toggle">{expandedSection === 'cognitive' ? '\u25BC' : '\u25B8'}</span>
          认知
          <span className={`field-section-status ${!c.is_overloaded ? 'ok' : 'err'}`}>
            {c.state}
          </span>
        </h3>
        <div className="field-panel">
          <div {...metricProps('cognitive_load', `认知负荷: ${(c.cognitive_load * 100).toFixed(0)}%`)}>
            <div className="label">负荷</div>
            <div className={`value ${cls(!c.is_overloaded, c.cognitive_load <= 0.7)}`}>
              {(c.cognitive_load * 100).toFixed(0)}%
              <div className="mini-bar">
                <div
                  className={`mini-bar-fill ${cls(!c.is_overloaded, c.cognitive_load <= 0.7)}`}
                  style={{ width: `${c.cognitive_load * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div {...metricProps('rt_zscore', `反应时 z 分数: ${c.rt_zscore.toFixed(2)}`)}>
            <div className="label">RT z</div>
            <div className={`value ${c.rt_zscore > 1.5 ? 'err' : ''}`}>{c.rt_zscore.toFixed(2)}</div>
          </div>
          <div {...metricProps('cognitive_state', `认知状态: ${c.state}`)}>
            <div className="label">状态</div>
            <div className="value">{c.state}</div>
          </div>
          <div {...metricProps('is_overloaded', `认知过载: ${c.is_overloaded ? '是' : '否'}`)}>
            <div className="label">过载</div>
            <div className={`value ${c.is_overloaded ? 'err' : 'ok'}`}>{c.is_overloaded ? '是' : '否'}</div>
          </div>
        </div>
        {expandedSection === 'cognitive' && (
          <div className="field-detail">
            <div className="field-detail-row">
              <span className="field-detail-label">响应时间:</span>
              <span className="field-detail-value">{(c.response_time_ms / 1000).toFixed(1)}s</span>
            </div>
            <div className="field-detail-row">
              <span className="field-detail-label">z 分数:</span>
              <span className="field-detail-value">{c.rt_zscore > 1.5 ? '显著偏慢' : '正常范围'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Emotional section */}
      <div className={`field-section ${expandedSection === 'emotional' ? 'expanded' : ''}`}>
        <h3
          className="field-section-header"
          onClick={() => toggleSection('emotional')}
          role="button"
          tabIndex={0}
          aria-expanded={expandedSection === 'emotional'}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleSection('emotional') } }}
        >
          <span className="field-section-toggle">{expandedSection === 'emotional' ? '\u25BC' : '\u25B8'}</span>
          情感
          <span className={`field-section-status ${e.in_flow ? 'ok' : e.is_anxious ? 'err' : 'warn'}`}>
            {e.state}
          </span>
        </h3>
        <div className="field-panel">
          <div {...metricProps('anxiety', `焦虑指数: ${(e.anxiety_index * 100).toFixed(0)}%`)}>
            <div className="label">焦虑</div>
            <div className={`value ${cls(!e.is_anxious)}`}>
              {(e.anxiety_index * 100).toFixed(0)}%
              <div className="mini-bar">
                <div
                  className={`mini-bar-fill ${cls(!e.is_anxious)}`}
                  style={{ width: `${e.anxiety_index * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div {...metricProps('flow', `心流分数: ${(e.flow_score * 100).toFixed(0)}%`)}>
            <div className="label">心流</div>
            <div className={`value ${e.in_flow ? 'ok' : ''}`}>
              {(e.flow_score * 100).toFixed(0)}%
              <div className="mini-bar">
                <div
                  className={`mini-bar-fill ${e.in_flow ? 'ok' : ''}`}
                  style={{ width: `${e.flow_score * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div {...metricProps('emotional_state', `情感状态: ${e.state}`)}>
            <div className="label">状态</div>
            <div className={`value ${e.state === 'flow' ? 'ok' : e.state === 'anxious' ? 'err' : ''}`}>{e.state}</div>
          </div>
          <div {...metricProps('in_flow', `心流中: ${e.in_flow ? '是' : '否'}`)}>
            <div className="label">心流中</div>
            <div className={`value ${e.in_flow ? 'ok' : ''}`}>{e.in_flow ? '是' : '否'}</div>
          </div>
        </div>
      </div>

      {/* Interaction section */}
      <div className={`field-section ${expandedSection === 'interaction' ? 'expanded' : ''}`}>
        <h3
          className="field-section-header"
          onClick={() => toggleSection('interaction')}
          role="button"
          tabIndex={0}
          aria-expanded={expandedSection === 'interaction'}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleSection('interaction') } }}
        >
          <span className="field-section-toggle">{expandedSection === 'interaction' ? '\u25BC' : '\u25B8'}</span>
          交互
          <span className={`field-section-status ${!i.is_struggling ? 'ok' : 'warn'}`}>
            {i.is_struggling ? '挣扎中' : '顺利'}
          </span>
        </h3>
        <div className="field-panel">
          <div {...metricProps('hint_level', `提示级别: L${i.current_hint_level}`)}>
            <div className="label">提示级</div>
            <div className="value">{i.current_hint_level > 0 ? `L${i.current_hint_level}` : '-'}</div>
          </div>
          <div {...metricProps('consecutive_correct', `连续正确: ${i.consecutive_correct} 次`)}>
            <div className="label">连续正确</div>
            <div className={`value ${i.consecutive_correct >= 3 ? 'ok' : ''}`}>{i.consecutive_correct}</div>
          </div>
          <div {...metricProps('should_fade_scaffold', `应淡出脚手架: ${i.should_fade_scaffold ? '是' : '否'}`)}>
            <div className="label">淡出</div>
            <div className={`value ${i.should_fade_scaffold ? 'ok' : ''}`}>{i.should_fade_scaffold ? '是' : '否'}</div>
          </div>
          <div {...metricProps('is_struggling', `挣扎状态: ${i.is_struggling ? '是' : '否'}`)}>
            <div className="label">挣扎</div>
            <div className={`value ${i.is_struggling ? 'warn' : 'ok'}`}>{i.is_struggling ? '是' : '否'}</div>
          </div>
        </div>
        {expandedSection === 'interaction' && (
          <div className="field-detail">
            <div className="field-detail-row">
              <span className="field-detail-label">淡出阈值:</span>
              <span className="field-detail-value">连续正确 {i.scaffold_fade_threshold} 次后减少提示</span>
            </div>
          </div>
        )}
      </div>

      {/* Metric explanation tooltip (hover) */}
      {hoveredMetric && METRIC_EXPLANATIONS[hoveredMetric as keyof typeof METRIC_EXPLANATIONS] && (
        <div className="metric-explanation" role="tooltip">
          <div className="metric-explanation-title">
            {METRIC_EXPLANATIONS[hoveredMetric as keyof typeof METRIC_EXPLANATIONS].title}
          </div>
          <div className="metric-explanation-desc">
            {METRIC_EXPLANATIONS[hoveredMetric as keyof typeof METRIC_EXPLANATIONS].desc}
          </div>
        </div>
      )}

      {/* Pinned explanation panel (click-to-toggle, persistent) */}
      {pinnedMetric && METRIC_EXPLANATIONS[pinnedMetric as keyof typeof METRIC_EXPLANATIONS] && (
        <div className="metric-explanation-pinned" role="status">
          <button
            className="metric-explanation-close"
            onClick={() => setPinnedMetric(null)}
            aria-label="关闭指标解释"
          >
            {'\u2715'}
          </button>
          {renderExplanation(pinnedMetric)}
        </div>
      )}
    </div>
  )
}

export const FourFieldDashboard = memo(FourFieldDashboardBase)
