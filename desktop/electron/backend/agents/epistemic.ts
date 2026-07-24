/**
 * Epistemic Agent: diagnoses cognitive state from four-field model.
 *
 * Ported from Python backend (backend/mathweaver/agents/epistemic.py)
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, CognitiveState, EmotionalState, createAgentMessage } from '../types'

export class EpistemicAgent extends BaseAgent {
  /**
   * Diagnoses the student's cognitive and emotional state.
   * Updates the four-field state model based on:
   * - Response time (cognitive load)
   * - Correctness (mastery estimate)
   * - Pattern of errors (struggle detection)
   * - Consecutive correct (flow detection)
   */

  constructor(llmClient: LLMClient | null = null) {
    super(AgentRole.EPISTEMIC, llmClient)
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const state = ctx.four_field_state
    const counterExample = ctx.prior_results['counter_example'] ?? {}
    const ceMeta = (counterExample['metadata'] ?? {}) as Record<string, unknown>

    const isGroup = (ceMeta['is_group'] as boolean) ?? false
    const hasVerification = 'is_group' in ceMeta
    const rtMs = (ctx.metadata['response_time_ms'] as number) ?? 5000
    const baseline = state.cognitive.baseline_rt_ms || 5000

    // Compute RT z-score
    let z: number
    if (baseline > 0) {
      z = (rtMs - baseline) / Math.max(baseline, 1)
    } else {
      z = 0.0
    }

    // Cognitive load (dead-code-free formula)
    let cognitiveLoad: number
    let cognitiveState: CognitiveState
    if (z > 1.5) {
      cognitiveLoad = Math.min(0.5 + Math.abs(z) * 0.2, 1.0)
      cognitiveState = CognitiveState.OVERLOAD
    } else if (z < -0.5) {
      cognitiveLoad = Math.max(0.3, 0.5 + z * 0.15)
      cognitiveState = CognitiveState.OPTIMAL
    } else {
      cognitiveLoad = 0.5
      cognitiveState = CognitiveState.OPTIMAL
    }

    // Mastery estimate
    let mastery: number
    let consecutive: number
    if (!hasVerification) {
      mastery = state.knowledge.mastery_estimate
      consecutive = state.interaction.consecutive_correct
    } else if (isGroup) {
      mastery = Math.min(state.knowledge.mastery_estimate + 0.05, 1.0)
      consecutive = state.interaction.consecutive_correct + 1
    } else {
      mastery = Math.max(state.knowledge.mastery_estimate - 0.03, 0.0)
      consecutive = 0
    }

    // Emotional state
    let emotionalState: EmotionalState
    let anxiety: number
    let flowScore: number
    if (consecutive >= 3 && z < 0) {
      emotionalState = EmotionalState.FLOW
      flowScore = Math.min(state.emotional.flow_score + 0.1, 1.0)
      anxiety = Math.max(state.emotional.anxiety_index - 0.05, 0.0)
    } else if (state.cognitive.backtrack_count > 2) {
      emotionalState = EmotionalState.ANXIOUS
      anxiety = Math.min(state.emotional.anxiety_index + 0.1, 1.0)
      flowScore = Math.max(state.emotional.flow_score - 0.05, 0.0)
    } else {
      emotionalState = EmotionalState.ENGAGED
      anxiety = state.emotional.anxiety_index
      flowScore = state.emotional.flow_score
    }

    // ZPD check
    const zpdLower = state.knowledge.zpd_lower
    const zpdUpper = state.knowledge.zpd_upper
    const inZpd = zpdLower <= mastery && mastery <= zpdUpper

    // Struggling detection
    const isStruggling =
      state.cognitive.backtrack_count > 2 ||
      (!isGroup && state.cognitive.backtrack_count > 1)

    // Scaffolding fade
    const shouldFade = consecutive >= state.interaction.scaffold_fade_threshold

    const fieldUpdates: Record<string, Record<string, unknown>> = {
      knowledge: { mastery_estimate: mastery },
      cognitive: {
        response_time_ms: rtMs,
        rt_zscore: z,
        cognitive_load: cognitiveLoad,
        state: cognitiveState,
      },
      emotional: {
        anxiety_index: anxiety,
        flow_score: flowScore,
        state: emotionalState,
      },
      interaction: {
        consecutive_correct: consecutive,
        hint_dependency: Math.max(0, state.interaction.hint_dependency - 0.01),
      },
    }

    if (isStruggling) {
      fieldUpdates['interaction']['struggle_duration_s'] =
        state.interaction.struggle_duration_s + rtMs / 1000
    }

    const diagnosis = this.diagnose(
      z,
      isGroup,
      hasVerification,
      consecutive,
      emotionalState,
      inZpd,
    )

    return createAgentMessage(this.role, diagnosis, {
      confidence: 0.85,
      field_updates: fieldUpdates,
      metadata: {
        rt_zscore: z,
        cognitive_load: cognitiveLoad,
        mastery_delta: mastery - state.knowledge.mastery_estimate,
        in_zpd: inZpd,
        is_struggling: isStruggling,
        should_fade_scaffold: shouldFade,
        emotional_state: emotionalState,
      },
    })
  }

  private diagnose(
    z: number,
    isGroup: boolean,
    hasVerification: boolean,
    consecutive: number,
    emotionalState: EmotionalState,
    inZpd: boolean,
  ): string {
    const parts: string[] = []
    if (z > 1.5) {
      parts.push('学生停顿较久，可能在消化新概念')
    } else if (z < -0.5) {
      parts.push('学生回答迅速，思路流畅')
    }
    if (hasVerification) {
      if (isGroup) {
        parts.push(`已连续答对 ${consecutive} 次`)
      } else {
        parts.push('这次的答案有偏差，需要引导')
      }
    } else {
      parts.push('收到学生的文字提问')
    }
    if (emotionalState === EmotionalState.FLOW) {
      parts.push('学生进入了心流')
    } else if (emotionalState === EmotionalState.ANXIOUS) {
      parts.push('学生似乎有些焦虑')
    }
    if (!inZpd) {
      parts.push('当前内容略超出学生的舒适区')
    }
    return parts.join('；') + '。'
  }
}
