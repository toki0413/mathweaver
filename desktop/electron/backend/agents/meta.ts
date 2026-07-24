/**
 * MetaEvolutionAgent: recursive self-improvement agent.
 *
 * Ported from Python backend (backend/mathweaver/agents/meta.py)
 *
 * NOTE: The Python backend uses evolution/param_learner.ParameterLearner
 * (Bayesian/bandit optimization). That module is not ported here; a minimal
 * ParameterLearner stub is provided so the meta agent remains functional.
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'

// ---------------------------------------------------------------------------
// Minimal ParameterLearner (replaces evolution/param_learner.ParameterLearner)
// ---------------------------------------------------------------------------

export interface ParamVersion {
  version: number
  weights: Record<string, number>
  thresholds: Record<string, number>
  promptVariant: string
  effectiveness: number
}

export class ParameterLearner {
  private versionNum = 0
  private currentWeights: Record<string, number> = {
    cognitive: 0.3,
    emotional: 0.2,
    knowledge: 0.3,
    interaction: 0.2,
  }
  private currentThresholds: Record<string, number> = {
    overload_zscore: 1.5,
    anxiety: 0.65,
    flow: 0.75,
  }
  private currentPromptVariant = 'socratic'

  evolve(feedback: Record<string, unknown>): ParamVersion {
    this.versionNum += 1
    const evaluated = (feedback['evaluated'] as number) ?? 0
    const actionStats = (feedback['action_stats'] as Record<string, Record<string, number>>) ?? {}
    // crude effectiveness: average of avg_effectiveness across actions
    let sum = 0
    let count = 0
    for (const action of Object.keys(actionStats)) {
      sum += actionStats[action]?.avg_effectiveness ?? 0
      count += 1
    }
    const effectiveness = count > 0 ? sum / count : evaluated > 0 ? 0.5 : 0
    return {
      version: this.versionNum,
      weights: { ...this.currentWeights },
      thresholds: { ...this.currentThresholds },
      promptVariant: this.currentPromptVariant,
      effectiveness,
    }
  }

  toDict(): Record<string, unknown> {
    return {
      version: this.versionNum,
      weights: { ...this.currentWeights },
      thresholds: { ...this.currentThresholds },
      prompt_variant: this.currentPromptVariant,
    }
  }
}

// ---------------------------------------------------------------------------
// MetaEvolutionAgent
// ---------------------------------------------------------------------------

export class MetaEvolutionAgent extends BaseAgent {
  /**
   * Meta-agent for recursive self-improvement.
   *
   * Observes system performance and evolves parameters using:
   * 1. Feedback data from the decision effectiveness tracker
   * 2. ParameterLearner for optimization
   * 3. LLM for pattern analysis and prompt generation
   *
   * This agent does NOT directly modify other agents. Instead it proposes
   * parameter changes, generates evolution reports, and suggests prompt variants.
   */

  paramLearner: ParameterLearner
  private evolutionCount = 0

  constructor(
    llmClient: LLMClient | null = null,
    paramLearner: ParameterLearner | null = null,
  ) {
    super(AgentRole.META, llmClient)
    this.paramLearner = paramLearner ?? new ParameterLearner()
  }

  /**
   * Execute meta-evolution: analyze performance and evolve parameters.
   * Runs during the REFLECT phase, after historical context is provided but
   * before the collaboration agent synthesizes the final response.
   */
  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1

    const feedbackData = (ctx.metadata['feedback'] as Record<string, unknown>) ?? {}
    const metricsSummary = (ctx.metadata['metrics'] as Record<string, unknown>) ?? {}

    // Only evolve if we have enough data
    const evaluatedCount = (feedbackData['evaluated'] as number) ?? 0
    if (evaluatedCount < 1) {
      return createAgentMessage(
        this.role,
        '尚未积累足够的反馈数据，暂不进行参数调整。',
        {
          metadata: {
            meta_active: true,
            evolution_count: this.evolutionCount,
            evaluated_decisions: evaluatedCount,
            reason: 'insufficient_data',
          },
        },
      )
    }

    // Evolve parameters
    const version = this.paramLearner.evolve(feedbackData)
    this.evolutionCount += 1

    // Use LLM for deeper analysis if available
    let analysis = ''
    if (this.llmClient !== null) {
      analysis = await this.llmAnalyze(feedbackData, version, metricsSummary)
    }

    // Generate evolution report
    const report = this.generateReport(feedbackData, version, analysis)

    console.info(
      `MetaEvolution: v${version.version}, effectiveness=${version.effectiveness.toFixed(3)}, ` +
        `prompt=${version.promptVariant}`,
    )

    return createAgentMessage(this.role, report, {
      metadata: {
        meta_active: true,
        evolution_count: this.evolutionCount,
        version: version.version,
        current_weights: version.weights,
        current_thresholds: version.thresholds,
        prompt_variant: version.promptVariant,
        effectiveness: version.effectiveness,
        analysis,
        param_learner_state: this.paramLearner.toDict(),
      },
    })
  }

  /** Use LLM to analyze performance and suggest improvements. */
  private async llmAnalyze(
    feedbackData: Record<string, unknown>,
    version: ParamVersion,
    metrics: Record<string, unknown>,
  ): Promise<string> {
    const actionStats = (feedbackData['action_stats'] as Record<string, Record<string, number>>) ?? {}

    const systemPrompt =
      '你是一位在课后复盘的教练。翻看今天每一回合的教学记录，' +
      '找出哪些策略奏效、哪些落空了。\n' +
      '不必面面俱到——抓住最关键的一两个发现：\n' +
      '哪个策略收效最差？为什么？怎么调？\n' +
      '回复精炼，100字以内。像在笔记本上写给自己看的一句话。'

    const statsStr = Object.entries(actionStats)
      .map(
        ([action, stats]) =>
          `  ${action}: 平均效果=${(stats?.avg_effectiveness ?? 0).toFixed(2)}, ` +
          `正率=${((stats?.positive_rate ?? 0) * 100).toFixed(0)}%`,
      )
      .join('\n')

    const userMessage =
      `决策效果统计:\n${statsStr}\n\n` +
      `当前参数版本: v${version.version}\n` +
      `权重: ${JSON.stringify(version.weights)}\n` +
      `阈值: ${JSON.stringify(version.thresholds)}\n` +
      `Prompt变体: ${version.promptVariant}\n` +
      `总效果: ${version.effectiveness.toFixed(3)}\n\n` +
      `系统指标: 成功率=${(((metrics['success_rate'] as number) ?? 0) * 100).toFixed(0)}%, ` +
      `平均延迟=${Math.round((metrics['avg_latency_ms'] as number) ?? 0)}ms\n\n` +
      `请分析并建议改进。`

    try {
      const resp = await this.llmClient!.chat(systemPrompt, userMessage, undefined, 0.5)
      return resp.content
    } catch (e) {
      console.warn('MetaEvolution LLM analysis failed: %s', e)
      return ''
    }
  }

  /** Generate a human-readable evolution report. */
  private generateReport(
    feedbackData: Record<string, unknown>,
    version: ParamVersion,
    analysis: string,
  ): string {
    const lines: string[] = [
      `复盘报告 · 第 ${version.version} 版`,
      `已评估决策: ${feedbackData['evaluated'] ?? 0}`,
      `整体效果: ${version.effectiveness >= 0 ? '+' : ''}${version.effectiveness.toFixed(3)}`,
      `当前权重: ${JSON.stringify(version.weights)}`,
      `当前Prompt: ${version.promptVariant}`,
    ]

    const actionStats = (feedbackData['action_stats'] as Record<string, Record<string, number>>) ?? {}
    if (Object.keys(actionStats).length > 0) {
      lines.push('\n策略效果:')
      const sorted = Object.entries(actionStats).sort(
        (a, b) => (a[1]?.avg_effectiveness ?? 0) - (b[1]?.avg_effectiveness ?? 0),
      )
      for (const [action, stats] of sorted) {
        const eff = stats?.avg_effectiveness ?? 0
        const marker = eff > 0 ? '✓' : eff < 0 ? '✗' : '→'
        lines.push(
          `  ${marker} ${action}: ${eff >= 0 ? '+' : ''}${eff.toFixed(3)} ` +
            `(正率 ${((stats?.positive_rate ?? 0) * 100).toFixed(0)}%)`,
        )
      }
    }

    if (analysis) {
      lines.push(`\nLLM 分析: ${analysis}`)
    }

    return lines.join('\n')
  }

  /** Return enhanced description for orchestrator. */
  describe(): Record<string, unknown> {
    const base = super.describe()
    return {
      ...base,
      evolution_count: this.evolutionCount,
      param_learner_state: this.paramLearner.toDict(),
    }
  }

  /** Get summary of evolution state for metrics endpoint. */
  getEvolutionSummary(): Record<string, unknown> {
    return {
      evolution_count: this.evolutionCount,
      param_learner: this.paramLearner.toDict(),
    }
  }
}
