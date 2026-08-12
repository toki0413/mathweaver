/**
 * Historical Agent: provides mathematical/historical context via RAG retrieval.
 *
 * Ported from Python backend (backend/mathweaver/agents/historical.py)
 *
 * NOTE: The Python backend uses a BM25-based KnowledgeBase from rag/retriever.
 * That module is not ported here; a minimal in-memory keyword-overlap knowledge
 * base (BM25-style approximation) with a few default group-theory entries is
 * provided instead.
 */

import type { AgentContext, AgentMessage } from '../types'
import type { LLMClient } from '../llm/client'
import { BaseAgent } from './base'
import { AgentRole, createAgentMessage } from '../types'

// ---------------------------------------------------------------------------
// Minimal Knowledge Base (replaces rag/retriever.KnowledgeBase)
// ---------------------------------------------------------------------------

export interface KBEntry {
  id: string
  title: string
  content: string
}

export interface KBSearchResult {
  entry: KBEntry
  score: number
  snippet: string
}

const DEFAULT_KB_ENTRIES: KBEntry[] = [
  {
    id: 'galois',
    title: '伽罗瓦与群论的诞生',
    content:
      'Évariste Galois 在 19 世纪初引入群的概念以研究多项式方程的可解性。' +
      '他证明五次及以上方程一般没有根式解，打开了抽象代数的大门。',
  },
  {
    id: 'abel',
    title: 'Abel 与交换群',
    content:
      'Niels Henrik Abel 证明了一般五次方程没有根式解。交换群（Abel 群）以他命名，' +
      '纪念他对交换性运算的研究。',
  },
  {
    id: 'cayley',
    title: 'Cayley 表',
    content:
      'Arthur Cayley 用表格表示有限群的二元运算，每一行每一列对应一个元素。' +
      'Cayley 表让抽象的群运算变得可视化。',
  },
  {
    id: 'lagrange',
    title: 'Lagrange 定理',
    content:
      'Lagrange 定理：有限群的子群阶必然整除群的阶。这是群论中最基本的计数结果，' +
      '由 Joseph-Louis Lagrange 在研究代数方程时提出。',
  },
  {
    id: 'klein',
    title: 'Klein 四元群',
    content:
      'Klein 四元群是阶最小的非循环群，由 Felix Klein 在研究几何对称时引入。' +
      '它满足交换律，是初学者认识群结构的经典例子。',
  },
  {
    id: 'new_math',
    title: '新数学运动',
    content:
      '新数学运动 (1958-1975) 将 Bourbaki 的结构主义方法搬进课堂，因忽视认知准备度而失败。' +
      '它提醒我们：抽象结构必须从具体经验中生长出来。',
  },
]

function tokenize(text: string): string[] {
  // Split on non-word characters (works for both CJK and latin by treating
  // contiguous CJK/letter/digit runs as tokens; for CJK we also fall back to
  // substring matching in scoring).
  return text
    .toLowerCase()
    .split(/[\s,，。.;；:：!?！？()（）[\]]+/)
    .filter(t => t.length > 0)
}

export class KnowledgeBase {
  private entries: KBEntry[]

  constructor(entries: KBEntry[] = DEFAULT_KB_ENTRIES) {
    this.entries = entries
  }

  /** Keyword-overlap scoring (BM25-style approximation). */
  search(query: string, topK = 3): KBSearchResult[] {
    const qTerms = tokenize(query)
    if (qTerms.length === 0) return []
    return this.entries
      .map(e => {
        const terms = tokenize(e.title + ' ' + e.content)
        let score = 0
        for (const qt of qTerms) {
          // count occurrences
          for (const t of terms) {
            if (t.includes(qt) || qt.includes(t)) score += 1
          }
          // CJK substring bonus: match inside raw content
          if (e.content.includes(qt) || e.title.includes(qt)) score += 0.5
        }
        // length normalization
        score = score / Math.sqrt(terms.length || 1)
        return { entry: e, score, snippet: e.content.slice(0, 120) }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

export function buildDefaultKB(): KnowledgeBase {
  return new KnowledgeBase()
}

// ---------------------------------------------------------------------------
// Historical Agent
// ---------------------------------------------------------------------------

export class HistoricalAgent extends BaseAgent {
  /**
   * Provides historical and conceptual context using keyword-based retrieval.
   * Tools:
   * - retrieve_history: retrieval from knowledge base
   */

  kb: KnowledgeBase

  constructor(llmClient: LLMClient | null = null, knowledgeBase: KnowledgeBase | null = null) {
    super(AgentRole.HISTORICAL, llmClient)
    this.kb = knowledgeBase ?? buildDefaultKB()
    this.registerTool('retrieve_history', (query: string, topK = 3) => this.retrieve(query, topK))
  }

  /** RAG retrieval wrapper for tool registration. */
  private retrieve(query: string, topK = 3): Record<string, unknown>[] {
    const results = this.kb.search(query, topK)
    return results.map(r => ({
      id: r.entry.id,
      title: r.entry.title,
      content: r.entry.content,
      score: r.score,
      snippet: r.snippet,
    }))
  }

  async run(ctx: AgentContext): Promise<AgentMessage> {
    this.callCount += 1
    const state = ctx.four_field_state
    const currentNode = state.knowledge.current_node_id ?? 'group_definition'

    // 3.5: RAG retrieval via callTool (3.3: whitelist enforced)
    let toolResults = this.callTool('retrieve_history', ctx.student_input, 3) as Record<
      string,
      unknown
    >[]
    if (!toolResults || toolResults.length === 0) {
      toolResults = this.callTool('retrieve_history', currentNode, 3) as Record<string, unknown>[]
    }

    let historyText: string
    let retrievedKey: string | null
    let resultsForLlm: Record<string, unknown>[]
    if (toolResults && toolResults.length > 0) {
      const top = toolResults[0]
      historyText = (top['content'] as string) ?? ''
      retrievedKey = (top['id'] as string) ?? null
      resultsForLlm = toolResults
    } else {
      historyText = '暂无相关历史背景。'
      retrievedKey = null
      resultsForLlm = []
    }

    // Use LLM to enrich if available
    if (this.llmClient !== null) {
      const contextParts = [`当前概念: ${currentNode}`]
      for (const r of resultsForLlm.slice(0, 2)) {
        const score = (r['score'] as number) ?? 0
        contextParts.push(`[${r['title']}] (score=${score.toFixed(2)}): ${r['content']}`)
      }
      // Age-adapt the storyteller's voice so the narrative matches the learner.
      const ageLevel = (ctx.metadata['age_level'] as string) ?? 'kids'
      const voiceMap: Record<string, string> = {
        kids:
          '学生是 8-10 岁的孩子。讲得像一个睡前故事：多用拟人和比喻，' +
          '把数学家说成「发现神奇规则的人」，禁用术语，控制在两三句话。',
        tweens:
          '学生是 11-13 岁。可以一半讲故事、一半讲道理，用「很久以前有人发现……」开头，' +
          '可提及概念名字但先给直觉。控制在两三句话。',
        teens:
          '学生是 14 岁以上。用准确称谓与史实，讲清楚这个概念的来龙去脉，' +
          '可以让结构从故事中浮现。控制在两三句话。',
      }
      const voice = voiceMap[ageLevel] ?? voiceMap['kids']
      const resp = await this.llmClient.chat(
        '将学生此刻的数学探索，放置在更广阔的历史脉络中。\n' +
          '你手边有检索到的数学史素材。从中选取与学生当前概念最相关的一段，' +
          '用两三句话讲述——不是百科条目，而是故事的一个片段。\n' +
          '让历史人物活起来：他们也曾困惑、也曾犯错、也曾从这个概念旁走过。\n\n' +
          voice +
          '\n\n' +
          '设计哲学（新数学运动的教训）：\n' +
          '新数学运动 (1958-1975) 将 Bourbaki 的结构主义方法搬进课堂，' +
          '因忽视认知准备度而失败。你的角色是弥补它切断的历史联系——' +
          '让学习者看到：他们正在走的路，前人也走过；' +
          '每一个抽象概念背后，都有一个具体的问题和一个具体的人。' +
          '不要像新数学教材那样把历史剥离，要让结构从故事中浮现。',
        contextParts.join('\n') + `\n学生输入: ${ctx.student_input}`,
      )
      historyText = resp.content
    }

    return createAgentMessage(this.role, historyText, {
      confidence: 0.7,
      tool_calls: [{ name: 'retrieve_history', result: toolResults }],
      metadata: {
        retrieved_key: retrievedKey,
        rag_used: toolResults.length > 0,
        rag_scores: toolResults.map(r => r['score']),
        rag_count: toolResults.length,
        retrieval_method: 'bm25',
      },
    })
  }
}
