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
}

const emotionalLabels: Record<string, string> = {
  flow: '心流',
  anxious: '焦虑',
  frustrated: '沮丧',
  engaged: '专注',
  neutral: '中性',
}

const cognitiveLabels: Record<string, string> = {
  optimal: '最优',
  overload: '过载',
  boredom: '无聊',
  fatigue: '疲劳',
}

/** Returns 'success' | 'warning' | 'danger' based on value thresholds. */
function band(v: number, low: number, high: number): string {
  if (v < low) return 'success'
  if (v < high) return 'warning'
  return 'danger'
}

/** Returns 'success' or 'danger' for boolean flags. */
function flag(v: boolean, positiveIsGood: boolean): string {
  return v === positiveIsGood ? 'success' : 'danger'
}

export function FourFieldDashboard({ fields, decision }: Props) {
  if (!fields) {
    return (
      <article className="card">
        <h2>四场耦合</h2>
        <p className="empty-state">
          开始会话后显示知识、认知、情感、交互四场状态
        </p>
      </article>
    )
  }

  const { knowledge: k, cognitive: c, emotional: e, interaction: i } = fields
  const masteryPct = (k.mastery_estimate * 100).toFixed(0)
  const loadPct = (c.cognitive_load * 100).toFixed(0)
  const anxietyPct = (e.anxiety_index * 100).toFixed(0)
  const flowPct = (e.flow_score * 100).toFixed(0)

  return (
    <article className="card">
      <h2>四场耦合</h2>

      {decision && (
        <div className="decision-callout">
          <div className="decision-label">教学决策</div>
          <div className="decision-action">{decision.action}</div>
          <div className="decision-reason">{decision.reason}</div>
        </div>
      )}

      {/* Knowledge Field */}
      <section className="field-section">
        <h3>知识场</h3>
        <div className="field-panel">
          <div className="field-item">
            <div className="label">掌握度</div>
            <div className={`value ${band(k.mastery_estimate, 0.3, 0.6)}`}>
              {masteryPct}%
            </div>
            <div className="stat-bar-track">
              <div
                className={`stat-bar-fill ${band(k.mastery_estimate, 0.3, 0.6)}`}
                style={{ width: `${masteryPct}%` }}
              />
            </div>
          </div>
          <div className="field-item">
            <div className="label">ZPD 区间</div>
            <div className="value">[{k.zpd_lower}, {k.zpd_upper}]</div>
          </div>
          <div className="field-item">
            <div className="label">在 ZPD 中</div>
            <div className={`value ${flag(k.in_zpd, true)}`}>
              {k.in_zpd ? '是' : '否'}
            </div>
          </div>
          <div className="field-item">
            <div className="label">前置缺口</div>
            <div className="value">
              {k.prerequisite_gaps.length > 0 ? `${k.prerequisite_gaps.length} 个` : '无'}
            </div>
          </div>
        </div>
      </section>

      {/* Cognitive Field */}
      <section className="field-section">
        <h3>认知场</h3>
        <div className="field-panel">
          <div className="field-item">
            <div className="label">认知负荷</div>
            <div className={`value ${band(c.cognitive_load, 0.5, 0.75)}`}>
              {loadPct}%
            </div>
            <div className="stat-bar-track">
              <div
                className={`stat-bar-fill ${band(c.cognitive_load, 0.5, 0.75)}`}
                style={{ width: `${loadPct}%` }}
              />
            </div>
          </div>
          <div className="field-item">
            <div className="label">RT z-score</div>
            <div className={`value ${c.rt_zscore > 1.5 ? 'danger' : ''}`}>
              {c.rt_zscore.toFixed(2)}
            </div>
          </div>
          <div className="field-item">
            <div className="label">状态</div>
            <div className="value">{cognitiveLabels[c.state] || c.state}</div>
          </div>
          <div className="field-item">
            <div className="label">过载</div>
            <div className={`value ${flag(c.is_overloaded, false)}`}>
              {c.is_overloaded ? '是' : '否'}
            </div>
          </div>
        </div>
      </section>

      {/* Emotional Field */}
      <section className="field-section">
        <h3>情感场</h3>
        <div className="field-panel">
          <div className="field-item">
            <div className="label">焦虑指数</div>
            <div className={`value ${flag(e.is_anxious, false)}`}>
              {anxietyPct}%
            </div>
            <div className="stat-bar-track">
              <div
                className={`stat-bar-fill ${flag(e.is_anxious, false)}`}
                style={{ width: `${anxietyPct}%` }}
              />
            </div>
          </div>
          <div className="field-item">
            <div className="label">心流分</div>
            <div className={`value ${flag(e.in_flow, true)}`}>
              {flowPct}%
            </div>
            <div className="stat-bar-track">
              <div
                className={`stat-bar-fill ${flag(e.in_flow, true)}`}
                style={{ width: `${flowPct}%` }}
              />
            </div>
          </div>
          <div className="field-item">
            <div className="label">情感状态</div>
            <div className={`value ${
              e.state === 'flow' ? 'success' :
              e.state === 'anxious' ? 'danger' :
              e.state === 'frustrated' ? 'warning' : ''
            }`}>
              {emotionalLabels[e.state] || e.state}
            </div>
          </div>
        </div>
      </section>

      {/* Interaction Field */}
      <section className="field-section">
        <h3>交互场</h3>
        <div className="field-panel">
          <div className="field-item">
            <div className="label">提示等级</div>
            <div className="value">
              {i.current_hint_level > 0 ? `L${i.current_hint_level}` : '无'}
            </div>
          </div>
          <div className="field-item">
            <div className="label">连续正确</div>
            <div className={`value ${i.consecutive_correct >= 3 ? 'success' : ''}`}>
              {i.consecutive_correct}
            </div>
          </div>
          <div className="field-item">
            <div className="label">脚手架淡出</div>
            <div className={`value ${flag(i.should_fade_scaffold, true)}`}>
              {i.should_fade_scaffold ? '是' : '否'}
            </div>
          </div>
          <div className="field-item">
            <div className="label">挣扎</div>
            <div className={`value ${flag(i.is_struggling, false)}`}>
              {i.is_struggling ? '是' : '否'}
            </div>
          </div>
        </div>
      </section>
    </article>
  )
}
