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
import { buildDefaultKB, type KnowledgeBase } from './rag/retriever'
import { StateStore } from './persistence/store'
import {
  type LLMConfig,
  type StartSessionRequest,
  type StudentInputRequest,
  type CayleyTableRequest,
  type StructuredError,
  defaultLLMConfig,
  type FourFieldState,
} from './types'

// ---------------------------------------------------------------------------
// Backend Manager (singleton)
// ---------------------------------------------------------------------------

class Backend {
  private orchestrator: Orchestrator | null = null
  private llmClient: LLMClient | null = null
  private llmConfig: LLMConfig = defaultLLMConfig()
  private store: StateStore
  private kb: KnowledgeBase
  private forge: CounterExampleForge
  private dag: ConceptDAG
  private initialized = false

  constructor() {
    this.store = new StateStore(':memory:')
    this.kb = buildDefaultKB()
    this.forge = new CounterExampleForge()
    this.dag = getDag('group_theory')
  }

  /**
   * Initialize the backend with LLM configuration.
   * Called when the app starts or when LLM settings change.
   */
  init(config?: Partial<LLMConfig>): void {
    if (config) {
      this.llmConfig = { ...this.llmConfig, ...config }
    }
    this.llmClient = createLLMClient(this.llmConfig)
    this.orchestrator = new Orchestrator({
      llmClient: this.llmClient,
      dag: this.dag,
      forge: this.forge,
      dbPath: ':memory:',
    })
    this.initialized = true
    console.log(`[Backend] Initialized — LLM provider: ${this.llmConfig.provider}, model: ${this.llmConfig.model}`)
  }

  /**
   * Update LLM configuration at runtime (from Settings panel).
   */
  updateLLMConfig(config: Partial<LLMConfig>): void {
    this.llmConfig = { ...this.llmConfig, ...config }
    // Re-create the LLM client
    this.llmClient = createLLMClient(this.llmConfig)
    // Re-initialize the orchestrator with the new client
    this.init()
  }

  getLLMConfig(): LLMConfig {
    return { ...this.llmConfig }
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
      const milestoneCount = nodes.filter((n) => n.is_milestone).length

      return {
        headline: `${levelLabel} · ${nodes.length} 个概念节点 · ${milestoneCount} 个里程碑`,
        level: dag.getLevel(),
        nodes: nodes.map((n) => ({
          id: n.id,
          name: n.name,
          description: n.description,
          prerequisites: n.prerequisites,
          abstraction_level: n.abstraction_level,
          difficulty: n.difficulty,
          is_milestone: n.is_milestone,
          domain: n.domain,
        })),
        milestones: dag.getMilestoneNodes().map((n) => n.id),
        summary,
      }
    } catch (err) {
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
      curricula: CURRICULUM_LEVELS.map((level) => {
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
    return this.orchestrator!.submitProof(theoremId, studentSteps, curriculumLevel || 'group_theory')
  }

  async startGrill(studentId?: string, curriculumLevel?: string): Promise<Record<string, unknown>> {
    this.ensureReady()
    if (curriculumLevel) {
      this.orchestrator!.switchCurriculum(curriculumLevel)
    }
    return await this.orchestrator!.processStudentInput('考考我')
  }

  async submitGrillAnswer(
    qid: string,
    answer: string,
    responseTimeMs?: number,
  ): Promise<Record<string, unknown>> {
    this.ensureReady()
    return await this.orchestrator!.processStudentInput(answer, {
      response_time_ms: responseTimeMs ?? 5000,
    })
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureReady(): void {
    if (!this.initialized || !this.orchestrator) {
      this.init()
    }
  }
}

// Export singleton
export const backend = new Backend()
export { LLM_PRESETS, type LLMPreset } from './llm/client'
export type { LLMConfig, StructuredError } from './types'
