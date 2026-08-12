/**
 * MathWeaver TypeScript Backend — Entry Point
 *
 * This module is the single API surface that the Electron main process
 * interacts with. It wraps the Orchestrator and exposes methods that
 * map directly to IPC channels.
 *
 * Architecture change: the entire backend now runs in-process within
 * Electron's main process. No Python, no HTTP server, no process spawning.
 * Communication happens through Electron IPC.
 */

import { Orchestrator } from './orchestrator/engine'
import { createLLMClient, type LLMClient } from './llm/client'
import { getDag, CURRICULUM_LEVELS, type ConceptDAG } from './dag/concept_dag'
import { CounterExampleForge } from './forge/forge'
import {
  type LLMConfig,
  type StartSessionRequest,
  type StudentInputRequest,
  type CayleyTableRequest,
  type StructuredError,
  defaultLLMConfig,
} from './types'
import logger from './utils/logger'

// ---------------------------------------------------------------------------
// Dynamic content generation — age-level labels
// ---------------------------------------------------------------------------

const AGE_LEVEL_LABELS: Record<string, string> = {
  kids: '少儿（6-9 岁）',
  tweens: '少年（10-13 岁）',
  teens: '青少年（14-17 岁）',
}

// ---------------------------------------------------------------------------
// Backend Manager (singleton)
// ---------------------------------------------------------------------------

class Backend {
  private orchestrator: Orchestrator | null = null
  private llmClient: LLMClient | null = null
  private llmConfig: LLMConfig = defaultLLMConfig()
  private forge: CounterExampleForge
  private dag: ConceptDAG
  private initialized = false
  private dbPath: string | undefined

  constructor() {
    this.forge = new CounterExampleForge()
    this.dag = getDag('group_theory')
  }

  /**
   * Initialize the backend with LLM configuration.
   * Called when the app starts or when LLM settings change.
   */
  init(config?: Partial<LLMConfig>, dbPath?: string): void {
    if (config) {
      this.llmConfig = { ...this.llmConfig, ...config }
    }
    this.dbPath = dbPath ?? this.dbPath
    this.llmClient = createLLMClient(this.llmConfig)
    this.orchestrator = new Orchestrator({
      llmClient: this.llmClient,
      dag: this.dag,
      forge: this.forge,
      dbPath: dbPath ?? ':memory:',
    })
    this.initialized = true
    logger.info('Backend initialized', {
      module: 'Backend',
      provider: this.llmConfig.provider,
      model: this.llmConfig.model,
    })
  }

  /**
   * Update LLM configuration at runtime (from Settings panel).
   */
  updateLLMConfig(config: Partial<LLMConfig>): void {
    this.llmConfig = { ...this.llmConfig, ...config }
    // Re-create the LLM client
    this.llmClient = createLLMClient(this.llmConfig)
    // Re-initialize the orchestrator with the new client
    this.init(undefined, this.dbPath)
  }

  getLLMConfig(): LLMConfig {
    return { ...this.llmConfig }
  }

  /**
   * Test the current LLM connection by sending a simple ping message.
   * Returns latency and status info.
   */
  async testLLMConnection(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      if (!this.llmClient) {
        return { ok: false, message: 'LLM 客户端未初始化' }
      }
      if (!this.llmClient.isConfigured) {
        return { ok: true, message: '演示模式正常运行中（Mock）' }
      }
      const resp = await this.llmClient.chat(
        'You are a test endpoint. Respond with exactly: ok',
        'Say "ok" in one word.',
        undefined,
        0.1,
      )
      const latency = Date.now() - start
      if (resp.content && resp.content.length > 0) {
        return {
          ok: true,
          message: `连接成功 · ${latency}ms · ${this.llmConfig.model}`,
          latencyMs: latency,
        }
      }
      return { ok: false, message: '返回内容为空' }
    } catch (e) {
      const latency = Date.now() - start
      const errMsg = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        message: `连接失败 (${latency}ms): ${errMsg.substring(0, 120)}`,
        latencyMs: latency,
      }
    }
  }

  get isReady(): boolean {
    return this.initialized && this.orchestrator !== null
  }

  // -------------------------------------------------------------------------
  // API Methods (mapped to IPC channels)
  // -------------------------------------------------------------------------

  async health(): Promise<Record<string, unknown>> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      llm_provider: this.llmConfig.provider,
      llm_model: this.llmConfig.model,
      llm_configured: this.llmClient?.isConfigured ?? false,
      dag_nodes: this.dag.getAllNodes().length,
    }
  }

  async getDag(level?: string): Promise<Record<string, unknown> | StructuredError> {
    try {
      const dag = level ? getDag(level) : this.dag
      const nodes = dag.getAllNodes()
      const summary = dag.getCurriculumSummary()
      const levelLabel = (summary.label as string) || dag.getLevel()
      const milestoneCount = nodes.filter(n => n.is_milestone).length

      return {
        headline: `${levelLabel} · ${nodes.length} 个概念节点 · ${milestoneCount} 个里程碑`,
        level: dag.getLevel(),
        nodes: nodes.map(n => ({
          id: n.id,
          name: n.name,
          description: n.description,
          prerequisites: n.prerequisites,
          abstraction_level: n.abstraction_level,
          difficulty: n.difficulty,
          is_milestone: n.is_milestone,
          domain: n.domain,
        })),
        milestones: dag.getMilestoneNodes().map(n => n.id),
        summary,
      }
    } catch {
      return {
        headline: `未找到课程层级「${level}」`,
        detail: '该层级不在当前课程体系中。',
        recovery: {
          suggestion: '请从可用层级中选择',
          available_options: CURRICULUM_LEVELS,
        },
      }
    }
  }

  async listCurricula(): Promise<Record<string, unknown>> {
    return {
      curricula: CURRICULUM_LEVELS.map(level => {
        const dag = getDag(level)
        const summary = dag.getCurriculumSummary()
        return {
          level,
          label: summary.label || level,
          node_count: dag.getAllNodes().length,
          milestone_count: dag.getMilestoneNodes().length,
        }
      }),
    }
  }

  async startSession(req: StartSessionRequest): Promise<Record<string, unknown>> {
    this.ensureReady()
    return this.orchestrator!.startSession(
      req.student_id,
      req.student_name || '',
      req.target_node_id || 'group_definition',
    )
  }

  async getSessionState(): Promise<Record<string, unknown>> {
    this.ensureReady()
    return this.orchestrator!.getStateSnapshot()
  }

  async processInput(req: StudentInputRequest): Promise<Record<string, unknown>> {
    this.ensureReady()
    return await this.orchestrator!.processStudentInput(req.student_input, {
      response_time_ms: req.response_time_ms ?? 5000,
      age_level: req.age_level,
      cognitive_load: req.cognitive_load,
      backtrack_count: req.backtrack_count,
      trial_sequence_length: req.trial_sequence_length,
    })
  }

  async verifyGroup(req: CayleyTableRequest): Promise<Record<string, unknown>> {
    const result = this.forge.checkGroupAxioms(req.table)
    const assocResult = this.forge.verifyAssociativity(req.table)
    const commResult = this.forge.checkCommutativity(req.table)

    const isGroup = !result.success
    const isAbelian = isGroup && !commResult.success

    let headline: string
    if (isGroup && isAbelian) {
      headline = '四条公理悉数通过，运算可交换——这是一个交换群'
    } else if (isGroup) {
      headline = '群公理成立，但交换律被打破——这是一个非交换群'
    } else {
      headline = '群公理未通过——这不是一个群'
    }

    return {
      headline,
      verdict: {
        is_group: isGroup,
        is_abelian: isAbelian,
        level: result.level,
      },
      evidence: {
        axiom_violation: result.counterExample,
        explanation: result.explanation,
        associativity: {
          satisfied: !assocResult.success,
          violation: assocResult.success ? assocResult.counterExample : null,
        },
        commutativity: {
          satisfied: !commResult.success,
          violation: commResult.success ? commResult.counterExample : null,
        },
      },
    }
  }

  async findNonAssociative(n: number): Promise<Record<string, unknown>> {
    const result = this.forge.findNonAssociativeTable(n)
    return {
      headline: result.success ? '找到了一个不满足结合律的运算' : '所有运算都满足结合律',
      result: {
        found: result.success,
        counter_example: result.counterExample,
        explanation: result.explanation,
      },
      metadata: {
        level: result.level,
      },
    }
  }

  async getMetrics(): Promise<Record<string, unknown>> {
    this.ensureReady()
    return this.orchestrator!.getMetrics()
  }

  async listTheorems(level?: string): Promise<Record<string, unknown>> {
    this.ensureReady()
    return this.orchestrator!.getTheorems(level || 'group_theory')
  }

  async verifyProof(
    theoremId: string,
    studentSteps: string[],
    curriculumLevel?: string,
  ): Promise<Record<string, unknown>> {
    this.ensureReady()
    return this.orchestrator!.submitProof(
      theoremId,
      studentSteps,
      curriculumLevel || 'group_theory',
    )
  }

  async startGrill(
    _studentId?: string,
    curriculumLevel?: string,
  ): Promise<Record<string, unknown>> {
    this.ensureReady()
    if (curriculumLevel) {
      this.orchestrator!.switchCurriculum(curriculumLevel)
    }
    return await this.orchestrator!.processStudentInput('考考我')
  }

  async submitGrillAnswer(
    _qid: string,
    answer: string,
    responseTimeMs?: number,
  ): Promise<Record<string, unknown>> {
    this.ensureReady()
    return await this.orchestrator!.processStudentInput(answer, {
      response_time_ms: responseTimeMs ?? 5000,
    })
  }

  // -------------------------------------------------------------------------
  // Dynamic Content Generation (LLM-powered)
  // -------------------------------------------------------------------------

  /**
   * Generate AI-powered dynamic content: exercises, story scenes, or
   * interactive challenges. Uses the configured LLM client directly (bypassing
   * the orchestrator) so the frontend can request ad-hoc learning material.
   *
   * When the LLM client is null, unconfigured, or running in mock mode,
   * pre-built fallback content is returned instead so the feature degrades
   * gracefully in development environments.
   */
  async generateDynamicContent(req: {
    type: 'exercise' | 'story' | 'challenge'
    topic: string
    ageLevel: 'kids' | 'tweens' | 'teens'
    difficulty: number
    currentTable?: number[][]
    context?: string
  }): Promise<Record<string, unknown>> {
    const { type, topic, ageLevel, difficulty, currentTable, context } = req

    // --- Fallback: LLM unavailable or in mock mode ---
    if (!this.llmClient || !this.llmClient.isConfigured || this.llmClient.provider === 'mock') {
      return this.getFallbackDynamicContent(type, topic, ageLevel, difficulty)
    }

    const systemPrompt = this.buildDynamicContentSystemPrompt(type, ageLevel)
    const userMessage = this.buildDynamicContentUserMessage(
      type,
      topic,
      ageLevel,
      difficulty,
      currentTable,
      context,
    )

    try {
      const resp = await this.llmClient.chat(systemPrompt, userMessage, undefined, 0.8)
      return this.parseDynamicContentResponse(resp.content, type, topic, ageLevel, difficulty)
    } catch (err) {
      logger.error('generateDynamicContent LLM call failed', {
        module: 'Backend',
        error: err instanceof Error ? err.message : String(err),
      })
      return this.getFallbackDynamicContent(type, topic, ageLevel, difficulty)
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureReady(): void {
    if (!this.initialized || !this.orchestrator) {
      this.init()
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic content — private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a system prompt tailored to the content type and age level.
   * Each prompt instructs the model to return a pure JSON object so the
   * response can be parsed reliably.
   */
  private buildDynamicContentSystemPrompt(type: string, ageLevel: string): string {
    const ageLabel = AGE_LEVEL_LABELS[ageLevel] || ageLevel
    const base =
      `你是 MathWeaver 的动态内容生成引擎。你的任务是为 ${ageLabel} 的学生生成数学学习内容。` +
      '所有内容必须使用中文，语言风格和难度必须严格匹配目标年龄段的认知水平。'

    if (type === 'exercise') {
      return (
        base +
        '\n\n请生成一道数学练习题，严格输出以下 JSON 对象（不要输出任何其他文字或 markdown 代码块标记）：\n' +
        '{\n' +
        '  "question": "题目正文",\n' +
        '  "options": ["选项A", "选项B", "选项C", "选项D"],  // 选择题时提供，非选择题可省略\n' +
        '  "hint": "解题提示，不给直接答案",\n' +
        '  "answer": "标准答案",\n' +
        '  "explanation": "解题过程的详细解释"\n' +
        '}'
      )
    }

    if (type === 'story') {
      return (
        base +
        '\n\n请生成一个与数学主题相关的故事场景，严格输出以下 JSON 对象（不要输出任何其他文字或 markdown 代码块标记）：\n' +
        '{\n' +
        '  "title": "故事标题",\n' +
        '  "text": "故事正文，200-400 字，要有情节、角色和数学元素的巧妙融入",\n' +
        '  "visualDescription": "配图的视觉描述，用于生成插图，描述画面中的角色、场景、色彩和氛围",\n' +
        '  "mathHook": "故事中蕴含的数学悬念或问题"\n' +
        '}'
      )
    }

    // challenge
    return (
      base +
      '\n\n请生成一个互动挑战任务，严格输出以下 JSON 对象（不要输出任何其他文字或 markdown 代码块标记）：\n' +
      '{\n' +
      '  "title": "挑战标题",\n' +
      '  "task": "挑战任务描述，明确告诉学生要做什么",\n' +
      '  "hint": "完成挑战的提示",\n' +
      '  "successCriteria": "成功标准，描述怎样算完成挑战",\n' +
      '  "steps": ["建议步骤1", "建议步骤2", "建议步骤3"]\n' +
      '}'
    )
  }

  /**
   * Build the user message that carries the generation parameters to the LLM.
   */
  private buildDynamicContentUserMessage(
    type: string,
    topic: string,
    ageLevel: string,
    difficulty: number,
    currentTable?: number[][],
    context?: string,
  ): string {
    const ageLabel = AGE_LEVEL_LABELS[ageLevel] || ageLevel
    const diffLabel = difficulty < 0.33 ? '入门' : difficulty < 0.66 ? '进阶' : '挑战'
    const typeLabel = type === 'exercise' ? '练习题' : type === 'story' ? '故事场景' : '互动挑战'

    const parts: string[] = [
      `主题: ${topic}`,
      `年龄段: ${ageLabel}`,
      `难度: ${difficulty.toFixed(2)}（${diffLabel}）`,
      `内容类型: ${typeLabel}`,
    ]

    if (currentTable && currentTable.length > 0) {
      const tableStr = currentTable.map(row => row.join('\t')).join('\n')
      parts.push(`当前运算表:\n${tableStr}`)
    }

    if (context) {
      parts.push(`上下文: ${context}`)
    }

    parts.push('请根据以上信息生成内容，严格输出 JSON。')
    return parts.join('\n')
  }

  /**
   * Parse the LLM response into a structured object. The response may be
   * pure JSON, JSON wrapped in markdown code fences, or plain text. We try
   * JSON extraction first, then fall back to wrapping the raw text.
   */
  private parseDynamicContentResponse(
    content: string,
    type: string,
    topic: string,
    ageLevel: string,
    difficulty: number,
  ): Record<string, unknown> {
    const extracted = this.extractJsonFromText(content)

    if (extracted) {
      return {
        type,
        topic,
        ageLevel,
        difficulty,
        ...extracted,
        source: 'llm',
        generatedAt: new Date().toISOString(),
      }
    }

    // Fallback: wrap raw text into a best-effort structure based on type.
    const base: Record<string, unknown> = {
      type,
      topic,
      ageLevel,
      difficulty,
      source: 'llm_fallback',
      generatedAt: new Date().toISOString(),
    }

    if (type === 'exercise') {
      return {
        ...base,
        question: content,
        hint: '',
        answer: '',
        explanation: content,
      }
    }

    if (type === 'story') {
      return {
        ...base,
        title: topic,
        text: content,
        visualDescription: '',
        mathHook: '',
      }
    }

    // challenge
    return {
      ...base,
      title: topic,
      task: content,
      hint: '',
      successCriteria: '',
      steps: [],
    }
  }

  /**
   * Attempt to extract a JSON object from a string that may be pure JSON,
   * wrapped in ```json fences, or contain JSON embedded in prose.
   */
  private extractJsonFromText(text: string): Record<string, unknown> | null {
    if (!text) return null

    // 1. Direct parse
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      // continue
    }

    // 2. Extract from ```json ... ``` or ``` ... ``` code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>
      } catch {
        // continue
      }
    }

    // 3. Find the first balanced { ... } block
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        // continue
      }
    }

    return null
  }

  /**
   * Return pre-built fallback content when the LLM is unavailable. The
   * structure mirrors what the LLM would produce so the frontend can render
   * it without special-casing.
   */
  private getFallbackDynamicContent(
    type: string,
    topic: string,
    ageLevel: string,
    difficulty: number,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      type,
      topic,
      ageLevel,
      difficulty,
      source: 'fallback',
      generatedAt: new Date().toISOString(),
    }

    if (type === 'exercise') {
      return {
        ...base,
        question: `关于「${topic}」的练习题：请描述该主题的核心定义，并举出一个具体例子。`,
        hint: '回想课堂上学过的定义，尝试用自己的话复述。',
        answer: `${topic}的核心定义与示例`,
        explanation:
          `这是一道关于「${topic}」的入门练习题。请结合教材或课堂笔记组织你的回答。` +
          `当前难度等级: ${difficulty.toFixed(2)}。`,
      }
    }

    if (type === 'story') {
      return {
        ...base,
        title: `${topic}的奇妙之旅`,
        text:
          `在一个充满数字的王国里，年轻的探险家发现了一块刻着「${topic}」的古老石碑。` +
          `石碑上的符号闪烁着微光，仿佛在诉说着一个被遗忘的秘密。` +
          `随着探险家一步步破解符号的含义，${topic}的奥秘逐渐展现在眼前……`,
        visualDescription:
          '一座古老的石碑矗立在数字王国的森林中央，石碑表面刻满发光的数学符号，' +
          '周围环绕着漂浮的几何图形，色调温暖而神秘。',
        mathHook: `石碑上的符号如何组合才能解开「${topic}」的秘密？`,
      }
    }

    // challenge
    return {
      ...base,
      title: `${topic}挑战`,
      task: `请围绕「${topic}」主题，构造一个具体的例子并验证它是否满足相关性质。`,
      hint: '从一个最简单的例子开始，逐步增加复杂度。',
      successCriteria: '能给出一个正确例子并清晰说明验证过程。',
      steps: ['回顾主题的定义', '构造一个具体的例子', '验证相关性质', '总结发现'],
    }
  }
}

// Export singleton
export const backend = new Backend()
export { LLM_PRESETS, type LLMPreset } from './llm/client'
export type { LLMConfig, StructuredError } from './types'
