/**
 * Perception Agent: parses student input, detects math content.
 *
 * Ported from Python backend (backend/mathweaver/agents/perception.py)
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('PerceptionAgent')

export class PerceptionAgent extends BaseAgent {
  /** Parses raw student input into structured form. */

  constructor(llmClient: LLMClient | null = null) {
    super(AgentRole.PERCEPTION, llmClient)
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const text = ctx.student_input.trim()

    // Try Cayley table parsing
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const table = JSON.parse(text)
        if (Array.isArray(table) && table.every(r => Array.isArray(r))) {
          const n = table.length
          const allValid = table.every((r: unknown[]) =>
            r.every(v => {
              const num = v as number
              return Number.isInteger(num) && num >= 0 && num < n
            }),
          )
          if (allValid) {
            return createAgentMessage(this.role, `检测到 ${n}x${n} 运算表`, {
              confidence: 0.95,
              metadata: {
                input_type: 'cayley_table',
                cayley_table: table,
                n,
              },
            })
          }
        }
      } catch {
        // JSON parse failed — fall through
      }
    }

    // Use LLM for complex perception if available
    let llmInputType: string | null = null
    if (this.llmClient !== null) {
      try {
        const resp = await this.llmClient.chat(
          '你正在审阅一位学生写下的数学笔记。辨认学生正在进行哪种数学活动：\n' +
            '提交了一张运算表（cayley_table）——学生在做结构实验；\n' +
            '提出了一个猜想（conjecture）——学生在试探命题的边界；\n' +
            '给出了一段证明（proof_attempt）——学生在构建逻辑链；\n' +
            '提出了一个问题（question）——学生在寻找方向。\n' +
            '只回复标签本身，不加任何修饰。',
          text,
        )
        const llmText = resp.content
        const llmTextLower = llmText.toLowerCase().trim()
        if (llmTextLower.includes('conjecture')) {
          llmInputType = 'conjecture'
        } else if (llmTextLower.includes('proof') || llmTextLower.includes('证明')) {
          llmInputType = 'proof_attempt'
        } else if (llmTextLower.includes('question')) {
          llmInputType = 'question'
        }
      } catch {
        log.debug('LLM perception failed, falling back to keywords')
      }
    }

    // Proof attempt detection: LLM result takes priority, then keywords
    const proofKeywords = ['证明', '求证', 'prove', 'proof', '我要证', '验证以下']
    const isProof =
      llmInputType === 'proof_attempt' || proofKeywords.some(kw => text.toLowerCase().includes(kw))

    if (isProof) {
      return createAgentMessage(this.role, text, {
        confidence: 0.9,
        metadata: {
          input_type: 'proof_attempt',
          is_proof: true,
          is_conjecture: false,
          raw_text: text,
        },
      })
    }

    // Conjecture detection: LLM result takes priority, then keywords
    const conjectureKeywords = [
      '我猜',
      '猜想',
      '所有',
      '任',
      '每个',
      '任何',
      '一定',
      '必然',
      '总是',
      'all',
      'every',
      'must',
      'conjecture',
    ]
    const isConjecture =
      llmInputType === 'conjecture' ||
      conjectureKeywords.some(kw => text.toLowerCase().includes(kw))
    const inputType = isConjecture ? 'conjecture' : 'question'

    return createAgentMessage(this.role, text, {
      confidence: 0.8,
      metadata: {
        input_type: inputType,
        is_conjecture: isConjecture,
        raw_text: text,
      },
    })
  }
}
