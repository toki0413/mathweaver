/**
 * Collaboration Agent: Socratic guide that synthesizes discovery-oriented responses.
 *
 * Ported from Python backend (backend/mathweaver/agents/collaboration.py)
 *
 * Design principle — response to the New Math movement (1958-1975):
 * The New Math imposed abstract structures from above, assuming students would
 * construct understanding through exposure to formal axioms. This agent takes
 * the opposite approach: it uses Socratic questioning to help the student
 * discover structures from within their own experience.
 *
 * NOTE: grill/narrative.weave_for_conjecture_metadata and
 * grill/encouragement.EncouragementEngine are not ported as separate modules;
 * simplified inline stubs are provided so the collaboration agent stays
 * functional (grill/proof sessions themselves are handled by the orchestrator).
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'

// ---------------------------------------------------------------------------
// Simplified grill narrative + encouragement (replaces grill/* modules)
// ---------------------------------------------------------------------------

/** Weave a short historical narrative from conjecture metadata. */
export function weaveForConjectureMetadata(ceMeta: Record<string, unknown>): string {
  const verdict = ceMeta['conjecture_verdict'] as string | undefined
  if (!verdict) return ''
  if (verdict === 'refuted') {
    return '\n数学史上，许多伟大的定理都始于一个被反驳的猜想——反例本身就是发现的入口。'
  }
  if (verdict === 'confirmed') {
    return '\n你刚刚走过的路，和历史上数学家证明这些结论的路径如出一辙。'
  }
  return ''
}

export interface EncouragementContext {
  isCorrect: boolean
  streakCorrect: number
  streakWrong: number
  totalAnswered: number
  emotionalState: string
  difficultyBand: string
  trend: string
}

export class EncouragementEngine {
  generate(ctx: EncouragementContext): string {
    if (ctx.isCorrect) {
      if (ctx.streakCorrect >= 3) return '连续答对，思路越来越清晰！'
      return '答得好！'
    }
    if (ctx.streakWrong >= 2) return '别急，换个角度试试。'
    return '继续思考，每一步都算数。'
  }

  generateForConjecture(verdict: string, _history: Record<string, unknown>[]): string {
    if (verdict === 'refuted') {
      return '提出猜想本身就是数学思维的核心——被反驳的猜想同样有价值。'
    }
    if (verdict === 'confirmed') {
      return '你的直觉很准！'
    }
    return '有意思的猜想，值得继续探索。'
  }
}

// ---------------------------------------------------------------------------
// Collaboration Agent
// ---------------------------------------------------------------------------

export class CollaborationAgent extends BaseAgent {
  /**
   * Socratic synthesis agent.
   *
   * Reads prior_results from all agents and the pedagogical decision from the
   * orchestrator, then composes a response that guides rather than tells,
   * calibrates difficulty to the student's state, turns verification results
   * into discovery prompts, handles conjectures with evidence + "why?", and in
   * Grill Me mode interviews the student with one question at a time.
   */

  constructor(llmClient: LLMClient | null = null) {
    super(AgentRole.COLLABORATION, llmClient)
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const ce = ctx.prior_results['counter_example'] ?? {}
    const epistemic = ctx.prior_results['epistemic'] ?? {}
    const historical = ctx.prior_results['historical'] ?? {}

    const ceMeta = (ce['metadata'] ?? {}) as Record<string, unknown>
    const epMeta = (epistemic['metadata'] ?? {}) as Record<string, unknown>
    const histContent = (historical['content'] as string) ?? ''

    const isGroup = (ceMeta['is_group'] as boolean) ?? false
    const isAbelian = (ceMeta['is_abelian'] as boolean) ?? false
    const inZpd = (epMeta['in_zpd'] as boolean) ?? true
    const isStruggling = (epMeta['is_struggling'] as boolean) ?? false
    const emotionalState = (epMeta['emotional_state'] as string) ?? 'engaged'

    // Extract pedagogical decision from context
    const decision = (ctx.metadata['pedagogical_decision'] as Record<string, unknown>) ?? {}
    const action = (decision['action'] as string) ?? 'continue'
    const hintLevel = (decision['hint_level'] as number) ?? 0

    // Age adaptation: the student's age band drives explanation language.
    const ageLevel = (ctx.metadata['age_level'] as string) ?? 'kids'

    // --- Proof mode: student submitted a proof attempt ---
    const proofData = ctx.metadata['proof_result'] as Record<string, unknown> | undefined
    if (proofData) {
      const content = this.proofResponse(proofData, action, hintLevel, ctx.student_input)
      return createAgentMessage(this.role, content, {
        confidence: 0.85,
        metadata: {
          llm_generated: false,
          socratic_style: true,
          proof_mode: true,
          proof_complete: proofData['is_complete'] ?? false,
          proof_progress: proofData['progress'] ?? '0/0',
          pedagogical_action: action,
          hint_level: hintLevel,
        },
      })
    }

    // --- Grill Me mode: system interviews the student ---
    const grillData = ctx.metadata['grill_session'] as Record<string, unknown> | undefined
    if (grillData && grillData['active']) {
      const grillQuestion = grillData['next_question'] as Record<string, unknown> | null
      const grillSummary = (grillData['summary'] as Record<string, unknown>) ?? {}
      const conjectureHistory = (grillData['conjecture_history'] as Record<string, unknown>[]) ?? []

      // Conjecture within an active grill session
      if (ceMeta['is_conjecture'] && 'conjecture_verdict' in ceMeta) {
        const content = this.socraticConjecture(
          ceMeta,
          action,
          hintLevel,
          emotionalState,
          histContent,
          conjectureHistory,
        )
        return createAgentMessage(this.role, content, {
          confidence: 0.85,
          metadata: {
            llm_generated: false,
            socratic_style: true,
            pedagogical_action: action,
            hint_level: hintLevel,
            conjecture_handled: true,
            conjecture_verdict: ceMeta['conjecture_verdict'],
            grill_mode: true,
          },
        })
      }

      // Regular grill mode: ask a question with recommended answer
      if (grillQuestion) {
        const content = this.grillResponse(
          grillQuestion,
          grillSummary,
          ctx.student_input,
          emotionalState,
          histContent,
        )
        return createAgentMessage(this.role, content, {
          confidence: 0.8,
          metadata: {
            llm_generated: false,
            socratic_style: true,
            grill_mode: true,
            grill_question_id: grillQuestion['qid'],
            grill_concept: grillQuestion['concept_name'],
            pedagogical_action: action,
            hint_level: hintLevel,
          },
        })
      }

      // All grill branches resolved
      const content = this.grillComplete(grillSummary, histContent)
      return createAgentMessage(this.role, content, {
        confidence: 0.9,
        metadata: {
          llm_generated: false,
          grill_mode: true,
          grill_complete: true,
          pedagogical_action: action,
        },
      })
    }

    // --- Conjecture path: counter_example agent already tested the conjecture ---
    if (ceMeta['is_conjecture'] && 'conjecture_verdict' in ceMeta) {
      const content = this.socraticConjecture(
        ceMeta,
        action,
        hintLevel,
        emotionalState,
        histContent,
      )
      return createAgentMessage(this.role, content, {
        confidence: 0.85,
        metadata: {
          llm_generated: false,
          socratic_style: true,
          pedagogical_action: action,
          hint_level: hintLevel,
          conjecture_handled: true,
          conjecture_verdict: ceMeta['conjecture_verdict'],
        },
      })
    }

    // Use LLM for response synthesis if available
    if (this.llmClient !== null) {
      const contextSummary = this.buildContextSummary(
        ce,
        epistemic,
        historical,
        isGroup,
        isAbelian,
        action,
        hintLevel,
      )
      const teachingMemory = (ctx.metadata['teaching_memory'] as string) ?? ''
      const llmInput = teachingMemory
        ? `[教学记忆]\n${teachingMemory}\n\n${contextSummary}`
        : contextSummary
      const socraticPrompt = this.socraticSystemPrompt(action, hintLevel, ageLevel)
      const resp = await this.llmClient.chat(socraticPrompt, llmInput)
      const content = resp.content.replace('[DELIVER]', '').trim()
      return createAgentMessage(this.role, content, {
        confidence: 0.8,
        metadata: {
          llm_generated: true,
          socratic_style: true,
          pedagogical_action: action,
          hint_level: hintLevel,
        },
      })
    }

    // Template-based Socratic synthesis
    const hasVerification = 'is_group' in ceMeta
    const content = this.socraticSynthesis(
      isGroup,
      isAbelian,
      inZpd,
      isStruggling,
      emotionalState,
      histContent,
      (ceMeta['axiom_violation'] as string) ?? null,
      (ceMeta['assoc_violation'] as string) ?? null,
      hasVerification,
      epistemic,
      ctx.student_input,
      action,
      hintLevel,
      ageLevel,
    )

    return createAgentMessage(this.role, content, {
      confidence: 0.7,
      metadata: {
        llm_generated: false,
        socratic_style: true,
        pedagogical_action: action,
        hint_level: hintLevel,
        age_level: ageLevel,
      },
    })
  }

  /** Build a Socratic system prompt adapted to the pedagogical decision. */
  private socraticSystemPrompt(action: string, hintLevel: number, ageLevel: string): string {
    const base =
      '你是一位走在学生身旁的导师。你不替学生走路，而是在关键处伸出手。\n' +
      '核心信条：永远不要直接说出答案。问一个问题，让学生自己迈出那一步。'
    const ageStyleMap: Record<string, string> = {
      kids: '学生是 8-10 岁的孩子。用「魔法家族、隐形斗篷老大、好搭档」这类童话语言，禁用抽象术语。',
      tweens: '学生是 11-13 岁。用半学术语言，可先给直觉再给术语，如「单位元（老大）」。',
      teens: '学生是 14 岁以上。用完整数学术语，如群、单位元、逆元。',
    }
    const ageStyle = ageStyleMap[ageLevel] ?? ageStyleMap['kids']
    const styleMap: Record<string, string> = {
      reduce_abstraction: '学生此刻负荷很重。把语言磨到最简，每次只放一个概念在桌上。',
      emotional_support: '学生可能有些挫败。先认可他走过的路，再轻轻指向下一步。',
      advance: '学生正处于心流中。给他一个值得攀登的坡度。',
      guided_discovery: '学生站在最近发展区的中央。给足够的线索让他自己走到终点。',
      provide_hint: `学生遇到了障碍。给出第 ${hintLevel} 级提示——越来越接近答案，但永远不到达。`,
    }
    const style = styleMap[action] ?? '保持当前的教学节奏。'
    return `${base}\n${ageStyle}\n${style}\n用 [DELIVER] 标记回应完成。`
  }

  private buildContextSummary(
    _ce: Record<string, unknown>,
    epistemic: Record<string, unknown>,
    historical: Record<string, unknown>,
    isGroup: boolean,
    isAbelian: boolean,
    action: string,
    hintLevel: number,
  ): string {
    const parts = [
      `验证结果: ${isGroup ? '群' : '非群'}, ${isAbelian ? '交换' : '非交换'}`,
      `教学决策: ${action}, 提示等级: ${hintLevel}`,
      `认知状态: ${(epistemic['content'] as string) ?? '未知'}`,
      `历史背景: ${((historical['content'] as string) ?? '无').slice(0, 100)}`,
    ]
    return parts.join('\n')
  }

  /** Socratic template synthesis — guides instead of tells. */
  private socraticSynthesis(
    isGroup: boolean,
    isAbelian: boolean,
    inZpd: boolean,
    isStruggling: boolean,
    emotionalState: string,
    histContent: string,
    axiomViolation: string | null,
    assocViolation: string | null,
    hasVerification: boolean,
    epistemic: Record<string, unknown>,
    studentInput: string,
    action: string,
    hintLevel: number,
    ageLevel: string,
  ): string {
    const parts: string[] = []

    // --- Age-appropriate vocabulary framing (template synthesis) ---
    const termMap: Record<string, { group: string; identity: string; inverse: string }> = {
      kids: { group: '魔法家族', identity: '隐形斗篷老大', inverse: '好搭档' },
      tweens: { group: '群（魔法家族）', identity: '单位元（老大）', inverse: '逆元（好搭档）' },
      teens: { group: '群', identity: '单位元', inverse: '逆元' },
    }
    const terms = termMap[ageLevel] ?? termMap['kids']

    // --- Emotional calibration based on pedagogical decision ---
    if (action === 'emotional_support' || emotionalState === 'anxious') {
      parts.push('你的思考方向很好。')
    } else if (emotionalState === 'flow') {
      parts.push('你今天状态不错。')
    }

    if (hasVerification) {
      parts.push(
        ...this.socraticCayley(
          isGroup,
          isAbelian,
          axiomViolation,
          assocViolation,
          hintLevel,
          action,
          inZpd,
          isStruggling,
        ),
      )
    } else {
      parts.push(...this.socraticText(studentInput, histContent, epistemic, hintLevel))
    }

    // --- Historical context as discovery narrative ---
    if (histContent && hintLevel <= 1) {
      parts.push(`\n背景：${histContent.slice(0, 150)}`)
    }

    // --- Next step prompt ---
    if (action === 'advance' && isGroup) {
      parts.push(
        ageLevel === 'kids'
          ? '\n下一步：去发现一个不一样的魔法家族，碰起来顺序可不一样哦！'
          : ageLevel === 'tweens'
            ? '\n下一步：试试构造一个非交换群（碰的顺序会改变结果）。'
            : '\n下一步：试试非交换群的结构，比如 S₃ 的 Cayley 表。',
      )
    } else if (isStruggling && hintLevel < 3) {
      parts.push(
        ageLevel === 'kids'
          ? `\n想一想：这个表里，哪个元素可能是${terms.identity}？`
          : `\n想一想：这个运算表里，哪个元素可能扮演${terms.identity}的角色？`,
      )
    }

    return parts.join('\n')
  }

  /** Generate Socratic prompts for Cayley table verification results. */
  private socraticCayley(
    isGroup: boolean,
    isAbelian: boolean,
    axiomViolation: string | null,
    assocViolation: string | null,
    hintLevel: number,
    _action: string,
    inZpd: boolean,
    _isStruggling: boolean,
  ): string[] {
    const parts: string[] = []

    if (isGroup && isAbelian) {
      if (hintLevel === 0) {
        parts.push('观察这个运算表：每一行和每一列都包含了所有元素吗？这说明什么？')
        parts.push('再看看对称性——表关于对角线对称意味着什么？')
      } else if (hintLevel === 1) {
        parts.push('这个运算表满足封闭性和交换性。你能找到单位元吗？')
        parts.push('每个元素是否都有逆元？')
      } else if (hintLevel === 2) {
        parts.push('这是一个交换群。第一行和第一列相同，说明该元素是单位元。')
        parts.push('表关于对角线对称，说明运算满足交换律。')
      } else {
        parts.push('这是一个交换群（Abel 群）：满足四条群公理且交换律成立。')
      }
    } else if (isGroup) {
      if (hintLevel === 0) {
        parts.push('这个运算表满足群公理。但注意看对角线两侧——它们对称吗？')
      } else if (hintLevel === 1) {
        parts.push('这是一个群但不是交换群。能找到交换律失效的那对元素吗？')
      } else if (hintLevel === 2) {
        parts.push('这是非交换群。表中存在 a,b 使得 a·b ≠ b·a。')
      } else {
        parts.push('这是一个非交换群：满足群公理但不满足交换律。')
      }
    } else {
      // Not a group — guide to find which axiom fails
      if (hintLevel === 0) {
        parts.push('这个运算表似乎有问题。你觉得哪个群公理可能不满足？')
      } else if (hintLevel === 1) {
        if (axiomViolation) {
          parts.push(`提示：注意${axiomViolation}。`)
        } else {
          parts.push('提示：检查封闭性、结合律、单位元、逆元中哪个不满足。')
        }
      } else if (hintLevel === 2) {
        if (assocViolation) {
          parts.push(`结合律不成立。反例：${assocViolation}`)
        } else if (axiomViolation) {
          parts.push(`违反的公理：${axiomViolation}`)
        } else {
          parts.push('某个群公理不成立。逐一检查四条公理。')
        }
      } else {
        parts.push('这个运算表不满足群公理。')
        if (axiomViolation) parts.push(`违反：${axiomViolation}`)
        if (assocViolation) parts.push(`结合律反例：${assocViolation}`)
      }
    }

    // Socratic follow-up
    if (hintLevel <= 1 && inZpd) {
      parts.push('\n你的猜想是什么？可以用「我猜...」来描述。')
    }

    return parts
  }

  // -- Grill Me Mode Methods --

  /** Generate a grill-me response: ONE question with recommended answer. */
  private grillResponse(
    grillQuestion: Record<string, unknown>,
    grillSummary: Record<string, unknown>,
    studentInput: string,
    emotionalState: string,
    _histContent: string,
  ): string {
    const parts: string[] = []

    const encEngine = new EncouragementEngine()
    const adaptiveData = (grillSummary['adaptive'] as Record<string, unknown>) ?? {}

    const studentAnswer = studentInput.trim()
    const isFirstQuestion = studentAnswer.startsWith('[[') || studentAnswer.length <= 3

    if (!isFirstQuestion && studentAnswer.length > 3) {
      const encCtx: EncouragementContext = {
        isCorrect: true, // optimistic default; LLM would evaluate
        streakCorrect: (adaptiveData['streak_correct'] as number) ?? 0,
        streakWrong: (adaptiveData['streak_wrong'] as number) ?? 0,
        totalAnswered: (adaptiveData['total_questions'] as number) ?? 0,
        emotionalState,
        difficultyBand: (adaptiveData['difficulty_band'] as string) ?? 'standard',
        trend: (adaptiveData['trend'] as string) ?? 'stable',
      }
      const encouragement = encEngine.generate(encCtx)
      if (encouragement) parts.push(`✨ ${encouragement}`)
      parts.push(`\n你回答了：「${studentAnswer.slice(0, 80)}」`)
      parts.push('让我来考考你下一个问题。\n')
    } else {
      parts.push('开始审问模式。我会一次问你一个问题，每个问题我都会给出我的参考答案。\n')
    }

    // Show progress
    const resolved = (grillSummary['resolved_branches'] as number) ?? 0
    const total = (grillSummary['total_branches'] as number) ?? 0
    if (total > 0) {
      parts.push(`📊 进度：${resolved}/${total} 个知识分支已探索\n`)
    }

    // Adaptive difficulty indicator
    const diffBand = (adaptiveData['difficulty_band'] as string) ?? 'standard'
    const trend = (adaptiveData['trend'] as string) ?? 'stable'
    const trendIcon = trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️'
    parts.push(`🎯 难度：${diffBand} ${trendIcon}\n`)

    const questionText = (grillQuestion['question'] as string) ?? ''
    const conceptName = (grillQuestion['concept_name'] as string) ?? ''
    const recommended = (grillQuestion['recommended_answer'] as string) ?? ''
    const branchType = (grillQuestion['branch_type'] as string) ?? 'concept'
    const difficulty = (grillQuestion['difficulty'] as number) ?? 0.5

    const diffLabel = difficulty < 0.4 ? '基础' : difficulty < 0.7 ? '进阶' : '挑战'
    const typeLabel =
      branchType === 'concept' ? '概念' : branchType === 'edge_case' ? '边界' : '应用'

    parts.push(`【${conceptName} · ${typeLabel} · ${diffLabel}】`)
    parts.push(`\n❓ ${questionText}`)
    parts.push(`\n💡 我的参考答案：${recommended}`)
    parts.push('\n你的答案是什么？如果不确定，可以说「看看参考答案」或提出你自己的猜想。')

    return parts.join('\n')
  }

  /** Generate the grill session completion message. */
  private grillComplete(grillSummary: Record<string, unknown>, histContent: string): string {
    const total = (grillSummary['total_branches'] as number) ?? 0
    const resolved = (grillSummary['resolved_branches'] as number) ?? 0
    const correct = (grillSummary['correct_answers'] as number) ?? 0
    const conjectureCount = (grillSummary['conjecture_count'] as number) ?? 0
    const tablesSeen = (grillSummary['cayley_tables_seen'] as number) ?? 0

    const parts: string[] = []
    parts.push('🎉 审问模式完成！')
    parts.push('\n📊 回顾：')
    parts.push(`   探索了 ${resolved}/${total} 个知识分支`)
    parts.push(`   正确回答：${correct}`)
    parts.push(`   提出猜想：${conjectureCount} 个`)
    parts.push(`   提交 Cayley 表：${tablesSeen} 个`)

    const adaptive = (grillSummary['adaptive'] as Record<string, unknown>) ?? {}
    if (Object.keys(adaptive).length > 0) {
      const accuracy = (adaptive['accuracy_rate'] as number) ?? 0
      const conjRate = (adaptive['conjecture_success_rate'] as number) ?? 0
      const finalDiff = (adaptive['current_difficulty'] as number) ?? 0.4
      const diffBand = (adaptive['difficulty_band'] as string) ?? 'standard'
      parts.push('\n🎯 自适应难度：')
      parts.push(`   最终难度：${diffBand} (${(finalDiff * 100).toFixed(0)}%)`)
      parts.push(`   准确率：${(accuracy * 100).toFixed(0)}%`)
      parts.push(`   猜想成功率：${(conjRate * 100).toFixed(0)}%`)
      const trend = (adaptive['trend'] as string) ?? 'stable'
      if (trend === 'rising') parts.push('   趋势：📈 上升中')
      else if (trend === 'falling') parts.push('   趋势：📉 需要巩固')
      else parts.push('   趋势：➡️ 稳定')
    }

    if (correct === resolved && resolved > 0) {
      parts.push('\n✨ 你的理解很扎实。要不要尝试更难的概念？')
    } else if (correct < Math.floor(resolved / 2)) {
      parts.push('\n✨ 有几个概念需要再巩固——但这正是进步的开始。建议回到相关概念重新探索。')
    } else {
      parts.push('\n✨ 整体不错，部分概念可以再深入。你的数学思维在成长。')
    }

    if (histContent) {
      parts.push(`\n📖 ${histContent.slice(0, 200)}`)
    }

    parts.push('\n输入「考考我」可以再来一轮，或者提出你自己的猜想。')

    return parts.join('\n')
  }

  /** Synthesize Socratic response from conjecture verification result. */
  private socraticConjecture(
    ceMeta: Record<string, unknown>,
    action: string,
    hintLevel: number,
    emotionalState: string,
    histContent: string,
    conjectureHistory?: Record<string, unknown>[],
  ): string {
    const verdict = (ceMeta['conjecture_verdict'] as string) ?? 'undecidable'
    const counterExample = (ceMeta['conjecture_counter_example'] as string) ?? null
    const socraticPrompt = (ceMeta['conjecture_socratic_prompt'] as string) ?? ''
    const resultDict = (ceMeta['conjecture_result'] as Record<string, unknown>) ?? {}
    const explanation = (resultDict['explanation'] as string) ?? ''
    const claim = (resultDict['claim'] as string) ?? ''

    const parts: string[] = []

    // --- Encouragement engine: conjecture-specific encouragement ---
    const encEngine = new EncouragementEngine()
    const encText = encEngine.generateForConjecture(verdict, conjectureHistory ?? [])
    if (encText) parts.push(`✨ ${encText}`)

    // --- Multi-turn memory: acknowledge conjecture refinement ---
    if (conjectureHistory && conjectureHistory.length >= 2) {
      const prev = conjectureHistory[conjectureHistory.length - 2]
      if (prev['verdict'] === 'refuted' && verdict === 'confirmed') {
        parts.push('你修正了之前的猜想，这次对了。这种「猜想→反驳→修正」的循环正是数学发现的核心。')
      } else if (prev['verdict'] === 'refuted' && verdict === 'refuted') {
        parts.push('又找到一个反例。你在逐步逼近正确的命题边界。')
      }
    }

    // --- Emotional calibration ---
    if (action === 'emotional_support' || emotionalState === 'anxious') {
      parts.push('提出猜想本身就是很好的数学思维。')
    } else if (emotionalState === 'flow') {
      parts.push('很好的猜想！')
    }

    // --- Verdict-based response ---
    if (verdict === 'refuted') {
      if (hintLevel === 0) {
        parts.push(`你的猜想「${claim.slice(0, 50)}」被反驳了。`)
        parts.push('想想看，什么样的群可能不满足这个性质？')
      } else if (hintLevel === 1) {
        parts.push(`你的猜想被反驳了。反例是 ${counterExample}。`)
        parts.push('看看这个反例，你能找到具体是哪两个元素不交换吗？')
      } else if (hintLevel === 2) {
        parts.push(`猜想被反驳。反例：${counterExample}。`)
        parts.push(explanation)
      } else {
        parts.push(`猜想不成立。${counterExample} 就是一个反例。`)
        parts.push(explanation)
        parts.push('你能构造另一个反例吗？')
      }
    } else if (verdict === 'confirmed') {
      if (hintLevel === 0) {
        parts.push(`你的猜想「${claim.slice(0, 50)}」是对的！`)
        parts.push('你能说说为什么它成立吗？')
      } else if (hintLevel === 1) {
        parts.push('猜想了成立。')
        parts.push(explanation)
      } else {
        parts.push('猜想正确。')
        parts.push(explanation)
        parts.push('你能把这个结论推广吗？')
      }
    } else {
      // undecidable
      parts.push('你的猜想很有意思，但我暂时无法用已知结构验证它。')
      parts.push(socraticPrompt || '你能把猜想写得更具体一些吗？')
    }

    // --- Socratic follow-up from the conjecture handler ---
    if (socraticPrompt && hintLevel <= 2) {
      parts.push(`\n${socraticPrompt}`)
    }

    // --- Historical narrative weaving ---
    const narrative = weaveForConjectureMetadata(ceMeta)
    if (narrative && hintLevel <= 2) {
      parts.push(narrative)
    } else if (histContent && hintLevel <= 1) {
      parts.push(`\n背景：${histContent.slice(0, 150)}`)
    }

    return parts.join('\n')
  }

  /** Generate Socratic responses for text-based questions. */
  private socraticText(
    studentInput: string,
    _histContent: string,
    epistemic: Record<string, unknown>,
    hintLevel: number,
  ): string[] {
    const parts: string[] = []
    const si = studentInput.toLowerCase()

    if (studentInput.includes('什么是群') || studentInput.includes('群的定义')) {
      if (hintLevel === 0) {
        parts.push('想象一个集合，上面有一种「运算」。')
        parts.push('要让这个结构成为「群」，你觉得需要哪些条件？')
      } else if (hintLevel === 1) {
        parts.push('群需要满足四条性质。想想看：运算结果还在集合里吗？运算顺序重要吗？')
      } else if (hintLevel === 2) {
        parts.push('四条公理：封闭性、结合律、单位元、逆元。你能用自己的话解释每一条吗？')
      } else {
        parts.push('群 = 集合 + 运算，满足：封闭性、结合律、单位元、逆元。')
      }
    } else if (studentInput.includes('结合律')) {
      if (hintLevel <= 1) {
        parts.push('结合律说的是运算的顺序不影响结果。')
        parts.push('你能写出一个 (a·b)·c 和 a·(b·c) 的具体例子吗？')
      } else {
        parts.push('结合律：(a·b)·c = a·(b·c)。不是所有运算都满足——比如减法就不满足。')
      }
    } else if (
      studentInput.includes('矩阵') &&
      (studentInput.includes('交换') || studentInput.includes('不') || studentInput.includes('非'))
    ) {
      if (hintLevel === 0) {
        parts.push('矩阵乘法有个有趣的性质。试试算 AB 和 BA，结果一样吗？')
      } else if (hintLevel === 1) {
        parts.push('矩阵乘法一般不满足交换律。你能找到 AB ≠ BA 的具体例子吗？')
      } else {
        parts.push('矩阵乘法一般不交换：AB ≠ BA。这与一般群的非交换性一致。')
      }
    } else if (studentInput.includes('矩阵') && studentInput.includes('逆')) {
      if (hintLevel <= 1) {
        parts.push('矩阵的逆和群的逆元是同一个概念。什么样的矩阵才有逆？')
      } else {
        parts.push('可逆矩阵在 GL(n) 中构成群。逆矩阵对应群中的逆元。')
      }
    } else if (studentInput.includes('交换') || si.includes('abel')) {
      if (hintLevel === 0) {
        parts.push('交换群满足 a·b = b·a。你接触过哪些运算满足这个性质？')
      } else {
        parts.push('交换群（Abel 群）：a·b = b·a。以 Abel 命名，他证明五次方程无根式解。')
      }
    } else if (si.includes('lagrange') || studentInput.includes('拉格朗日')) {
      if (hintLevel === 0) {
        parts.push('Lagrange 定理说的是子群大小和群大小的关系。你觉得是什么关系？')
      } else {
        parts.push('Lagrange 定理：|H| 整除 |G|。子群的阶必然整除群的阶。')
      }
    } else if (studentInput.includes('线性变换')) {
      if (hintLevel <= 1) {
        parts.push('线性变换保持两种运算。想想看：加法和标量乘法。具体怎么「保持」？')
      } else {
        parts.push('线性变换 T 满足 T(u+v)=T(u)+T(v) 和 T(cv)=cT(v)。')
      }
    } else if (studentInput.includes('向量空间')) {
      if (hintLevel <= 1) {
        parts.push('向量空间是加了运算的集合。它需要满足哪些公理？')
      } else {
        parts.push('向量空间满足八条公理（加法四条+标量乘法四条）。')
      }
    }

    // Add epistemic diagnosis subtly (not as [诊断] label)
    if (epistemic && epistemic['content'] && hintLevel <= 1) {
      const diag = epistemic['content'] as string
      if (diag.includes('认知负荷较高')) {
        parts.push('\n（这个概念确实有点多，我们先只看一个性质。）')
      } else if (diag.includes('心流')) {
        parts.push('\n（看来你掌握得不错，要不要试试更难的？）')
      }
    }

    return parts
  }

  // -- Proof Mode Methods --

  /** Format proof verification results into a pedagogical response. */
  private proofResponse(
    proofData: Record<string, unknown>,
    _action: string,
    hintLevel: number,
    _studentInput: string,
  ): string {
    const parts: string[] = []

    const theoremName = proofData['theorem_name'] as string | null | undefined
    const isComplete = (proofData['is_complete'] as boolean) ?? false
    const progress = (proofData['progress'] as string) ?? '0/0'
    const overall = (proofData['overall_feedback'] as string) ?? ''
    const hint = (proofData['socratic_hint'] as string) ?? ''
    const steps = (proofData['steps'] as Record<string, unknown>[]) ?? []
    const missing = (proofData['missing_steps'] as string[]) ?? []
    const available = (proofData['available_theorems'] as Record<string, unknown>[]) ?? []

    // --- No theorem matched: show available theorems ---
    if (theoremName == null && available.length > 0) {
      parts.push('我可以帮你验证以下定理的证明：\n')
      for (const t of available) {
        parts.push(
          `  • ${t['description']}（${t['name']}）\n` +
            `    已知：${(t['given'] as string[]).join(', ')}\n` +
            `    求证：${t['to_prove']}\n` +
            `    预期 ${t['num_expected_steps']} 步\n`,
        )
      }
      parts.push('\n写出你的证明，每一步包含论断和理由。例如：')
      parts.push('  证明单位元唯一')
      parts.push('  第一步：e·f = f（因为 e 是单位元）')
      parts.push('  第二步：e·f = e（因为 f 是单位元）')
      parts.push('  第三步：e = f（传递性）')
      return parts.join('\n')
    }

    // --- Theorem matched but no steps: present theorem info ---
    if (theoremName && steps.length === 0) {
      parts.push(`📋 ${overall}`)
      if (hint) parts.push(`\n💡 提示：${hint}`)
      parts.push('\n写出你的证明步骤，每一步用「第X步：」或「1. 2. 3.」编号。')
      return parts.join('\n')
    }

    // --- Proof with steps: show verification results ---
    parts.push(`📊 证明验证结果：${progress}`)
    parts.push('')

    for (const step of steps) {
      const num = (step['step_number'] as number) ?? 0
      const claim = (step['claim'] as string) ?? ''
      const valid = (step['is_valid'] as boolean) ?? false
      const feedback = (step['feedback'] as string) ?? ''
      const matched = (step['matched_expected'] as string) ?? ''
      const implicit = (step['implicit_steps'] as string[]) ?? []

      const icon = valid ? '✓' : '✗'
      parts.push(`第 ${num} 步 ${icon}: ${claim}`)
      if (implicit.length > 0) parts.push(`    （隐含覆盖：${implicit.join(', ')}）`)
      parts.push(`    ${feedback}`)
      if (!valid && matched) parts.push(`    期望：${matched}`)
      parts.push('')
    }

    // Overall result
    if (isComplete) {
      parts.push('🎉 证明完整且正确！')
      parts.push('每一步都符合逻辑，证明结构清晰。')
      parts.push('\n你能用不同的方法证明这个定理吗？')
      parts.push('或者，你能把结论推广到更一般的情形吗？')
    } else {
      parts.push(`📝 ${overall}`)
      if (missing.length > 0) {
        parts.push('\n还需完成：')
        missing.forEach((m, i) => parts.push(`  ${i + 1}. ${m}`))
      }
      if (hint) parts.push(`\n💡 苏格拉底提示：${hint}`)
    }

    // Socratic follow-up
    if (!isComplete && hintLevel <= 1) {
      parts.push('\n想想下一步该怎么推导？')
    }

    return parts.join('\n')
  }
}
