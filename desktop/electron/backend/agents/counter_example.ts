/**
 * Counter-Example Agent: uses the brute-force forge to verify or find counter-examples.
 *
 * Ported from Python backend (backend/mathweaver/agents/counter_example.py)
 *
 * Handles two input modes:
 * 1. Cayley table: direct brute-force axiom verification
 * 2. Conjecture: uses ConjectureHandler to test claims against known structures
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'
import { CounterExampleForge, ConjectureHandler, type ForgeResult } from '../forge/forge'
import type { ConjectureResult } from '../forge/forge'

export class CounterExampleAgent extends BaseAgent {
  forge: CounterExampleForge
  conjectureHandler: ConjectureHandler

  constructor(forge: CounterExampleForge | null = null, llmClient: LLMClient | null = null) {
    super(AgentRole.COUNTER_EXAMPLE, llmClient)
    this.forge = forge ?? new CounterExampleForge(llmClient)
    this.conjectureHandler = new ConjectureHandler(this.forge)
    // Register forge tools (3.3: whitelist enforced via callTool)
    this.registerTool('z3_verify_group', (table: number[][]) => this.forge.checkGroupAxioms(table))
    this.registerTool('z3_verify_associativity', (table: number[][]) =>
      this.forge.verifyAssociativity(table),
    )
    this.registerTool('z3_check_commutativity', (table: number[][]) =>
      this.forge.checkCommutativity(table),
    )
    this.registerTool('test_conjecture', (text: string) =>
      this.conjectureHandler.testConjecture(text),
    )
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const abstraction = ctx.prior_results['abstraction'] ?? {}
    const perception = ctx.prior_results['perception'] ?? {}
    const meta = (abstraction['metadata'] ?? abstraction) as Record<string, unknown>

    // Check if this is a conjecture input
    const percMeta = (perception['metadata'] ?? {}) as Record<string, unknown>
    if (percMeta['is_conjecture'] || percMeta['input_type'] === 'conjecture') {
      return await this.handleConjecture(ctx, percMeta)
    }

    if (meta['structure_type'] === 'binary_operation') {
      const table = (meta['cayley_table'] as number[][]) ?? []
      if (!table || table.length === 0) {
        return createAgentMessage(this.role, '未检测到运算表', {
          confidence: 0.3,
        })
      }

      // 3.1: LLM-driven tool selection
      const toolCallsMade: Record<string, unknown>[] = []
      const n = table.length
      let selectedTools: Set<string>

      if (this.llmClient !== null) {
        const toolDefs = [
          { name: 'z3_verify_group', description: 'Verify all 4 group axioms' },
          { name: 'z3_verify_associativity', description: 'Check associativity only' },
          { name: 'z3_check_commutativity', description: 'Check Abelian property' },
        ]
        const toolResp = await this.llmClient.chat(
          '面前是一张 n×n 运算表。作为一位严谨的代数学家，判断哪些性质值得检验。\n' +
            '可选的验证手段：\n' +
            '  z3_verify_group —— 检验四条群公理\n' +
            '  z3_verify_associativity —— 单独检验结合律\n' +
            '  z3_check_commutativity —— 检验交换律\n' +
            '返回需要执行的工具名，用逗号分隔。',
          `这是一张 ${n}×${n} 运算表。哪些性质需要检验？`,
        )

        selectedTools = new Set<string>()
        for (const toolDef of toolDefs) {
          if (toolResp.content.includes(toolDef.name)) {
            selectedTools.add(toolDef.name)
          }
        }
        if (selectedTools.size === 0) {
          selectedTools.add('z3_verify_group')
        }
      } else {
        // Fallback: use all tools for Cayley tables
        selectedTools = new Set<string>([
          'z3_verify_group',
          'z3_verify_associativity',
          'z3_check_commutativity',
        ])
      }

      // Execute selected tools (3.3: via callTool for whitelist enforcement)
      let axiomsResult: ForgeResult | null = null
      let assocResult: ForgeResult | null = null
      let commResult: ForgeResult | null = null

      if (selectedTools.has('z3_verify_group')) {
        axiomsResult = this.callTool('z3_verify_group', table) as ForgeResult
        toolCallsMade.push({
          name: 'z3_verify_group',
          result: { is_group: !axiomsResult.success },
          selected_by: this.llmClient ? 'llm' : 'default',
        })
      }

      if (selectedTools.has('z3_verify_associativity')) {
        assocResult = this.callTool('z3_verify_associativity', table) as ForgeResult
        toolCallsMade.push({
          name: 'z3_verify_associativity',
          result: { satisfied: !assocResult.success },
          selected_by: this.llmClient ? 'llm' : 'default',
        })
      }

      if (selectedTools.has('z3_check_commutativity')) {
        commResult = this.callTool('z3_check_commutativity', table) as ForgeResult
        toolCallsMade.push({
          name: 'z3_check_commutativity',
          result: { satisfied: !commResult.success },
          selected_by: this.llmClient ? 'llm' : 'default',
        })
      }

      // Determine result from available data
      let isGroup: boolean
      if (axiomsResult) {
        isGroup = !axiomsResult.success
      } else if (assocResult) {
        isGroup = !assocResult.success
      } else {
        isGroup = false
      }

      const isAbelian = isGroup && commResult !== null && !commResult.success

      const content = this.formatResult(
        axiomsResult,
        assocResult,
        commResult,
        isGroup,
        isAbelian,
        this.ageOf(ctx),
      )

      // Propose field updates based on verification
      const fieldUpdates: Record<string, Record<string, unknown>> = {}
      if (!isGroup) {
        fieldUpdates['interaction'] = {
          consecutive_correct: ctx.four_field_state.interaction.consecutive_correct + 1,
        }
      } else {
        fieldUpdates['cognitive'] = {
          backtrack_count: ctx.four_field_state.cognitive.backtrack_count + 1,
        }
      }

      return createAgentMessage(this.role, content, {
        confidence: 0.95,
        field_updates: fieldUpdates,
        tool_calls: toolCallsMade,
        metadata: {
          is_group: isGroup,
          is_abelian: isAbelian,
          axiom_violation:
            axiomsResult && axiomsResult.success ? axiomsResult.counterExample : null,
          assoc_violation: assocResult && assocResult.success ? assocResult.counterExample : null,
          comm_violation: commResult && commResult.success ? commResult.counterExample : null,
          z3_level: axiomsResult ? axiomsResult.level : 'none',
          tools_selected_by: this.llmClient ? 'llm' : 'default',
          selected_tools: [...selectedTools],
        },
      })
    }

    return createAgentMessage(this.role, '未发现可验证的形式化结构', {
      confidence: 0.3,
    })
  }

  private formatResult(
    axioms: ForgeResult | null,
    _assoc: ForgeResult | null,
    comm: ForgeResult | null,
    isGroup: boolean,
    isAbelian: boolean,
    ageLevel: string = 'kids',
  ): string {
    // Age-adaptive phrasing for the verification verdict.
    const abelianOk: Record<string, string> = {
      kids: '四条规则全部通过，而且碰起来的顺序可以随便换——这是一个「合作无间」的魔法家族！',
      tweens: '四条公理悉数通过，运算还满足交换律——这是一个交换群。',
      teens: '四条公理悉数通过，运算可交换——这是一个交换群。',
    }
    const groupOnlyOk: Record<string, string> = {
      kids: '四条规则都通过了，但碰起来的顺序会影响结果——顺序很重要哦！反例：',
      tweens: '群公理成立，但交换律被打破（这不是交换群）。反例：',
      teens: '群公理成立，但交换律被打破。反例：',
    }
    const failed: Record<string, string> = {
      kids: '有几条规则没通过，魔法家族还不完整。',
      tweens: '群公理未通过。',
      teens: '群公理未通过。',
    }
    if (isGroup && isAbelian) {
      return abelianOk[ageLevel] ?? abelianOk['kids']
    } else if (isGroup) {
      const ce = comm ? comm.counterExample : 'N/A'
      return `${groupOnlyOk[ageLevel] ?? groupOnlyOk['kids']}${ce}`
    }
    const explanation = axioms ? axioms.explanation : '未执行验证'
    return `${failed[ageLevel] ?? failed['kids']}${explanation}`
  }

  /** Read the current student's age band from context (default kids). */
  private ageOf(ctx: AgentContext): string {
    return (ctx.metadata['age_level'] as string) ?? 'kids'
  }

  /**
   * Handle student conjectures via ConjectureHandler + brute-force.
   * The discovery loop: student conjectures -> forge tests -> counter-example or confirmation -> Socratic prompt.
   */
  private async handleConjecture(
    ctx: AgentContext,
    percMeta: Record<string, unknown>,
  ): Promise<AgentMessage> {
    const rawText = (percMeta['raw_text'] as string) ?? ctx.student_input

    // Use callTool for whitelist enforcement (3.3)
    const result = this.callTool('test_conjecture', rawText) as ConjectureResult
    const ageLevel = this.ageOf(ctx)

    const verdictMap: Record<string, string> = {
      kids: {
        confirmed: '你的发现是对的！',
        refuted: '这个猜想被推翻了——',
        undecidable: '暂时还无法判定',
      },
      tweens: {
        confirmed: '猜想成立。',
        refuted: '猜想被反驳。',
        undecidable: '无法判定。',
      },
      teens: {
        confirmed: '猜想成立。',
        refuted: '猜想被反驳。',
        undecidable: '无法判定。',
      },
    }[ageLevel] ?? {
      confirmed: '猜想成立',
      refuted: '猜想被反驳',
      undecidable: '无法判定',
    }

    const contentParts = [`${verdictMap[result.verdict] ?? '未知'}：${result.explanation}`]
    if (result.counterExample) {
      contentParts.push(`反例：${result.counterExample}`)
    }
    if (result.socraticPrompt) {
      contentParts.push(result.socraticPrompt)
    }
    const content = contentParts.join('\n')

    // Field updates based on conjecture result
    const fieldUpdates: Record<string, Record<string, unknown>> = {}
    if (result.verdict === 'refuted') {
      fieldUpdates['interaction'] = {
        consecutive_correct: ctx.four_field_state.interaction.consecutive_correct,
      }
    } else if (result.verdict === 'confirmed') {
      fieldUpdates['interaction'] = {
        consecutive_correct: ctx.four_field_state.interaction.consecutive_correct + 1,
      }
    }

    return createAgentMessage(this.role, content, {
      confidence: 0.9,
      field_updates: fieldUpdates,
      tool_calls: [{ name: 'test_conjecture', result: result.toDict() }],
      metadata: {
        conjecture_result: result.toDict(),
        conjecture_verdict: result.verdict,
        conjecture_counter_example: result.counterExample,
        conjecture_socratic_prompt: result.socraticPrompt,
        is_conjecture: true,
      },
    })
  }
}
