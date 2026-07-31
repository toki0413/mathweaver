/**
 * Abstraction Agent: extracts formal structure from perception.
 *
 * Ported from Python backend (backend/mathweaver/agents/abstraction.py)
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'

export class AbstractionAgent extends BaseAgent {
  /**
   * Extracts formal mathematical structure from perceived input.
   * For Cayley tables: identifies the binary operation structure.
   * For natural language: uses LLM to identify mathematical concepts.
   */

  constructor(llmClient: LLMClient | null = null) {
    super(AgentRole.ABSTRACTION, llmClient)
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const perception = ctx.prior_results['perception'] ?? {}
    const perceptionMeta = (perception['metadata'] ?? {}) as Record<string, unknown>
    const inputType = (perceptionMeta['input_type'] as string) ?? 'question'

    if (inputType === 'cayley_table') {
      const table = (perceptionMeta['cayley_table'] as number[][]) ?? []
      const n = (perceptionMeta['n'] as number) ?? 0
      return createAgentMessage(this.role, `辨认出 ${n} 元集合上的二元运算结构`, {
        confidence: 0.9,
        metadata: {
          structure_type: 'binary_operation',
          cayley_table: table,
          n,
        },
      })
    }

    // Use LLM for abstraction if available
    if (this.llmClient !== null) {
      const resp = await this.llmClient.chat(
        '从学生写下的文字中，蒸馏出形式化的数学骨架。\n' +
          '辨认其中涉及的概念、调用的公理、引用的定理。\n' +
          '像从矿石中提纯金属——保留结构，丢弃杂质。输出 JSON。',
        ctx.student_input,
      )
      return createAgentMessage(this.role, resp.content, {
        confidence: 0.7,
        metadata: { structure_type: 'natural_language' },
        tool_calls: (resp.tool_calls ?? []).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      })
    }

    return createAgentMessage(this.role, ctx.student_input, {
      confidence: 0.5,
      metadata: { structure_type: 'natural_language' },
    })
  }
}
