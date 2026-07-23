import { memo } from 'react'

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

function FourFieldDashboardBase({ fields, decision }: Props) {
  if (!fields) {
    return (
      <div className="card">
        <h2>四场状态</h2>
        <p className="desc">开始会话后显示</p>
      </div>
    )
  }

  const { knowledge: k, cognitive: c, emotional: e, interaction: i } = fields

  const cls = (ok: boolean, warn?: boolean) =>
    ok ? 'ok' : warn ? 'warn' : 'err'

  return (
    <div className="card">
      <h2>四场状态</h2>

      {decision && (
        <div className="decision-box">
          <div className="action">{decision.action}</div>
          <div className="reason">{decision.reason}</div>
        </div>
      )}

      <h3>知识</h3>
      <div className="field-panel">
        <div className="field-item">
          <div className="label">掌握度</div>
          <div className={`value ${cls(k.mastery_estimate > 0.6, k.mastery_estimate > 0.3)}`}>
            {(k.mastery_estimate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="field-item">
          <div className="label">ZPD</div>
          <div className="value">[{k.zpd_lower}, {k.zpd_upper}]</div>
        </div>
        <div className="field-item">
          <div className="label">在 ZPD</div>
          <div className={`value ${k.in_zpd ? 'warn' : ''}`}>{k.in_zpd ? '是' : '否'}</div>
        </div>
        <div className="field-item">
          <div className="label">前置缺口</div>
          <div className="value">{k.prerequisite_gaps.length > 0 ? `${k.prerequisite_gaps.length} 个` : '无'}</div>
        </div>
      </div>

      <h3>认知</h3>
      <div className="field-panel">
        <div className="field-item">
          <div className="label">负荷</div>
          <div className={`value ${cls(!c.is_overloaded, c.cognitive_load <= 0.7)}`}>
            {(c.cognitive_load * 100).toFixed(0)}%
          </div>
        </div>
        <div className="field-item">
          <div className="label">RT z</div>
          <div className={`value ${c.rt_zscore > 1.5 ? 'err' : ''}`}>{c.rt_zscore.toFixed(2)}</div>
        </div>
        <div className="field-item">
          <div className="label">状态</div>
          <div className="value">{c.state}</div>
        </div>
        <div className="field-item">
          <div className="label">过载</div>
          <div className={`value ${c.is_overloaded ? 'err' : 'ok'}`}>{c.is_overloaded ? '是' : '否'}</div>
        </div>
      </div>

      <h3>情感</h3>
      <div className="field-panel">
        <div className="field-item">
          <div className="label">焦虑</div>
          <div className={`value ${cls(!e.is_anxious)}`}>{(e.anxiety_index * 100).toFixed(0)}%</div>
        </div>
        <div className="field-item">
          <div className="label">心流</div>
          <div className={`value ${e.in_flow ? 'ok' : ''}`}>{(e.flow_score * 100).toFixed(0)}%</div>
        </div>
        <div className="field-item">
          <div className="label">状态</div>
          <div className={`value ${e.state === 'flow' ? 'ok' : e.state === 'anxious' ? 'err' : ''}`}>{e.state}</div>
        </div>
        <div className="field-item">
          <div className="label">心流中</div>
          <div className={`value ${e.in_flow ? 'ok' : ''}`}>{e.in_flow ? '是' : '否'}</div>
        </div>
      </div>

      <h3>交互</h3>
      <div className="field-panel">
        <div className="field-item">
          <div className="label">提示级</div>
          <div className="value">{i.current_hint_level > 0 ? `L${i.current_hint_level}` : '-'}</div>
        </div>
        <div className="field-item">
          <div className="label">连续正确</div>
          <div className={`value ${i.consecutive_correct >= 3 ? 'ok' : ''}`}>{i.consecutive_correct}</div>
        </div>
        <div className="field-item">
          <div className="label">淡出</div>
          <div className={`value ${i.should_fade_scaffold ? 'ok' : ''}`}>{i.should_fade_scaffold ? '是' : '否'}</div>
        </div>
        <div className="field-item">
          <div className="label">挣扎</div>
          <div className={`value ${i.is_struggling ? 'warn' : 'ok'}`}>{i.is_struggling ? '是' : '否'}</div>
        </div>
      </div>
    </div>
  )
}

export const FourFieldDashboard = memo(FourFieldDashboardBase)
