/**
 * Orchestrator: Four-field coupling engine.
 *
 * Ported from Python backend (backend/mathweaver/orchestrator/engine.py)
 *
 * This is the central coordinator that:
 * 1. Maintains the FourFieldState (single-writer pattern)
 * 2. Routes messages between agents via an LLM-driven loop
 * 3. Makes pedagogical decisions based on field coupling
 * 4. Manages the teaching loop state machine
 *
 * State machine phases:
 *   PERCEIVE -> ABSTRACT -> VERIFY -> DIAGNOSE -> REFLECT -> COLLABORATE -> DELIVER
 *
 * SIMPLIFICATIONS (per porting instructions):
 * - observability / trace / metrics / safety / persistence / audit modules are
 *   replaced with console.log.
 * - grill/session.py is NOT ported; grill mode is handled by a simplified
 *   inline session (one-question-at-a-time over a small question bank).
 * - proof/assistant.py is NOT ported; proof mode is handled by a simplified
 *   inline verifier (keyword theorem detection + step counting).
 * - dag/concept_dag.py is NOT ported; a minimal inline concept DAG with a few
 *   group-theory nodes is provided.
 * - Map replaces dict, async/await replaces asyncio, console.log replaces logging.
 */

import {
  type AgentRole,
  SessionPhase,
  type FourFieldState,
  type StudentProfile,
  type AgentMessage,
  type AgentContext,
  type TeachingDecision,
  defaultFourFieldState,
  defaultStudentProfile,
  getMastery,
  isCognitiveOverloaded,
  isEmotionalAnxious,
  isEmotionalInFlow,
  isKnowledgeInZPD,
  isKnowledgeReadyToAdvance,
  shouldFadeScaffold,
  isInteractionStruggling,
  snapshotFourField,
} from '../types'
import type { LLMClient } from '../llm/client'
import { MockLLMClient } from '../llm/client'
import { CounterExampleForge } from '../forge/forge'
import { type BaseAgent } from '../agents/base'
import {
  PerceptionAgent,
  AbstractionAgent,
  CounterExampleAgent,
  EpistemicAgent,
  HistoricalAgent,
  CollaborationAgent,
  MetaEvolutionAgent,
} from '../agents'
import { ParameterLearner } from '../agents/meta'
import { type KnowledgeBase, buildDefaultKB } from '../agents/historical'
import type { ConceptDAG } from '../dag/concept_dag'
import { getDag } from '../dag/concept_dag'
import { createModuleLogger } from '../utils/logger'
import { StateStore } from '../persistence/store'

const log = createModuleLogger('Orchestrator')

// ---------------------------------------------------------------------------
// Minimal Concept DAG (replaces dag/concept_dag.py)
// ---------------------------------------------------------------------------

interface DagNode {
  id: string
  name: string
  description: string
  prerequisites: string[]
  abstraction_level: number
  domain: string
}

const DEFAULT_DAG_NODES: DagNode[] = [
  {
    id: 'group_definition',
    name: '群的定义',
    description: '集合配上二元运算，满足封闭性、结合律、单位元、逆元四条公理。',
    prerequisites: [],
    abstraction_level: 1,
    domain: 'group_theory',
  },
  {
    id: 'subgroup',
    name: '子群',
    description: '群的子集在原运算下仍构成群。',
    prerequisites: ['group_definition'],
    abstraction_level: 2,
    domain: 'group_theory',
  },
  {
    id: 'cyclic_group',
    name: '循环群',
    description: '由单个元素生成的群，如 Z_n。',
    prerequisites: ['group_definition'],
    abstraction_level: 2,
    domain: 'group_theory',
  },
  {
    id: 'abelian_group',
    name: '交换群',
    description: '满足交换律 a·b = b·a 的群。',
    prerequisites: ['group_definition'],
    abstraction_level: 2,
    domain: 'group_theory',
  },
  {
    id: 'lagrange_theorem',
    name: 'Lagrange 定理',
    description: '有限群的子群阶必然整除群的阶。',
    prerequisites: ['subgroup', 'cyclic_group'],
    abstraction_level: 3,
    domain: 'group_theory',
  },
  {
    id: 'symmetric_group',
    name: '对称群',
    description: '所有置换构成的群，S_n 是最小的非交换群例子。',
    prerequisites: ['group_definition', 'abelian_group'],
    abstraction_level: 3,
    domain: 'group_theory',
  },
]

/** @internal Simple in-memory DAG for unit testing and development. */
export class SimpleConceptDAG {
  private nodes: Map<string, DagNode>

  constructor(nodes: DagNode[] = DEFAULT_DAG_NODES) {
    this.nodes = new Map(nodes.map(n => [n.id, n]))
  }

  getNode(id: string): DagNode | undefined {
    return this.nodes.get(id)
  }

  getAllNodes(): DagNode[] {
    return [...this.nodes.values()]
  }

  getNodeCount(): number {
    return this.nodes.size
  }

  checkPrerequisites(targetId: string, mastery: Record<string, number>): string[] {
    const node = this.nodes.get(targetId)
    if (!node) return []
    const gaps: string[] = []
    for (const pre of node.prerequisites) {
      if ((mastery[pre] ?? 0) < 0.6) gaps.push(pre)
    }
    return gaps
  }

  getLearningPath(targetId: string, _mastery: Record<string, number>): string[] {
    const node = this.nodes.get(targetId)
    if (!node) return []
    const path: string[] = [...node.prerequisites, targetId]
    return path
  }

  /** Nodes that depend on `id` (children). */
  getDependents(id: string): string[] {
    const deps: string[] = []
    for (const node of this.nodes.values()) {
      if (node.prerequisites.includes(id)) deps.push(node.id)
    }
    return deps
  }

  getCurriculumSummary(): Record<string, unknown> {
    const domains = new Set<string>()
    for (const n of this.nodes.values()) domains.add(n.domain)
    return {
      total_nodes: this.nodes.size,
      domains: [...domains],
      levels: Math.max(...[...this.nodes.values()].map(n => n.abstraction_level)),
    }
  }
}

// ---------------------------------------------------------------------------
// Proof Step Validation (replaces the old "non-empty = valid" check)
// ---------------------------------------------------------------------------

/** @internal Exported for unit testing. */
export interface ProofStepValidation {
  isValid: boolean
  feedback: string
  implicitSteps: string[]
}

/**
 * Validate a single proof step against the expected step.
 *
 * Strategy:
 * 1. Empty claim → invalid
 * 2. If we have an expected step, check key-term overlap (≥40% match = valid)
 * 3. If no expected step (extra step), check for mathematical reasoning content
 * 4. Check justification contains logical connectors
 */
/** @internal Exported for unit testing. */
export function validateProofStep(
  claim: string,
  justification: string,
  expectedStep: string,
  _stepIndex: number,
  _allExpected: string[],
): ProofStepValidation {
  // Rule 1: empty claim is never valid
  if (!claim.trim()) {
    return {
      isValid: false,
      feedback: '步骤内容为空，请写出你的论断。',
      implicitSteps: [],
    }
  }

  // Rule 2: if we have an expected step, use key-term matching
  if (expectedStep) {
    const expectedTerms = extractKeyTerms(expectedStep)
    const claimTerms = extractKeyTerms(claim)
    const claimLower = claim.toLowerCase()
    const justLower = justification.toLowerCase()
    const combined = `${claimLower} ${justLower}`

    let matched = 0
    for (const term of expectedTerms) {
      if (combined.includes(term.toLowerCase())) {
        matched += 1
      }
    }

    const matchRatio = expectedTerms.length > 0 ? matched / expectedTerms.length : 0

    if (matchRatio >= 0.4) {
      // Check for justification quality — at least some logical reasoning
      const hasJustification =
        justification.length > 0 ||
        claimLower.includes('因为') ||
        claimLower.includes('since') ||
        claimLower.includes('由') ||
        claimLower.includes('根据') ||
        claimLower.includes('定义') ||
        claimLower.includes('结合律') ||
        claimLower.includes('逆元') ||
        claimLower.includes('单位元') ||
        claimLower.includes('传递')
      return {
        isValid: true,
        feedback: hasJustification ? '✓ 步骤有效，逻辑清晰。' : '✓ 步骤有效，建议补充理由说明。',
        implicitSteps: [],
      }
    } else if (matchRatio >= 0.2) {
      // Partial match — check if the claim direction is right
      const hasCorrectDirection = expectedTerms.some(
        t => claimLower.includes(t.toLowerCase()) || justLower.includes(t.toLowerCase()),
      )
      if (hasCorrectDirection) {
        return {
          isValid: true,
          feedback: '△ 步骤方向正确，但表述不够完整。参考期望步骤。',
          implicitSteps: [],
        }
      }
      return {
        isValid: false,
        feedback: `✗ 步骤与期望不符。期望涉及：${expectedStep.slice(0, 40)}…`,
        implicitSteps: [],
      }
    } else {
      // Check if this could be an implicit/rearranged step
      const claimTermsSet = new Set(claimTerms.map(t => t.toLowerCase()))
      const expectedTermsSet = new Set(expectedTerms.map(t => t.toLowerCase()))
      const overlap = [...claimTermsSet].filter(t => expectedTermsSet.has(t))
      if (overlap.length >= 2) {
        return {
          isValid: true,
          feedback: '△ 步骤内容与期望部分重叠，可能需要调整顺序。',
          implicitSteps: [],
        }
      }
      return {
        isValid: false,
        feedback: `✗ 步骤无效。期望涉及：${expectedStep.slice(0, 40)}…`,
        implicitSteps: [],
      }
    }
  }

  // Rule 3: extra step (no expected step at this index)
  // Check if the step contains mathematical reasoning
  const claimLower = claim.toLowerCase()
  const hasMathContent =
    extractKeyTerms(claim).length > 0 ||
    claimLower.includes('=') ||
    claimLower.includes('∈') ||
    claimLower.includes('·') ||
    /\d/.test(claim)
  if (hasMathContent) {
    return {
      isValid: true,
      feedback: '△ 额外步骤，内容有效但不在标准证明路径中。',
      implicitSteps: [],
    }
  }

  return {
    isValid: false,
    feedback: '✗ 步骤缺乏数学内容，请写出具体的数学论断。',
    implicitSteps: [],
  }
}

const CURRICULUM_LABELS: Record<string, string> = {
  elementary: '小学数学',
  middle_school: '初中数学',
  high_school: '高中数学',
  group_theory: '群论（抽象代数）',
}

// ---------------------------------------------------------------------------
// Minimal Topology (replaces topology/config.py) — permissive
// ---------------------------------------------------------------------------

class SimpleTopology {
  entryAgent = 'perception'
  exitAgent = 'collaboration'
  agents = [
    'perception',
    'abstraction',
    'counter_example',
    'epistemic',
    'historical',
    'collaboration',
  ]
  maxIterations = 10

  isActive(name: string): boolean {
    return this.agents.includes(name)
  }

  availableFrom(_from: string): string[] {
    return [...this.agents]
  }

  canRoute(_from: string, _to: string): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// Simplified Grill Session (replaces grill/session.py)
// ---------------------------------------------------------------------------

interface GrillQuestion {
  qid: string
  concept_name: string
  question: string
  recommended_answer: string
  branch_type: string
  difficulty: number
}

const GRILL_QUESTIONS: GrillQuestion[] = [
  {
    qid: 'g1',
    concept_name: '群的定义',
    question: '什么是群？群需要满足哪几条公理？',
    recommended_answer: '群是一个集合配上一个二元运算，满足封闭性、结合律、单位元、逆元四条公理。',
    branch_type: 'concept',
    difficulty: 0.3,
  },
  {
    qid: 'g2',
    concept_name: '单位元',
    question: '群的单位元为什么是唯一的？',
    recommended_answer: '若 e 和 f 都是单位元，则 e = e·f = f，由传递性得 e = f。',
    branch_type: 'concept',
    difficulty: 0.5,
  },
  {
    qid: 'g3',
    concept_name: '逆元',
    question: '群中每个元素的逆元是否唯一？为什么？',
    recommended_answer: '唯一。若 b、c 都是 a 的逆元，则 b = b·e = b·(a·c) = (b·a)·c = e·c = c。',
    branch_type: 'concept',
    difficulty: 0.6,
  },
  {
    qid: 'g4',
    concept_name: '交换群',
    question: '举一个非交换群的例子。',
    recommended_answer: 'S₃（3次对称群）是非交换群，存在 a,b 使 a·b ≠ b·a。',
    branch_type: 'edge_case',
    difficulty: 0.7,
  },
  {
    qid: 'g5',
    concept_name: 'Lagrange 定理',
    question: 'Lagrange 定理说了什么？',
    recommended_answer: '子群的阶必然整除群的阶，即 |H| 整除 |G|。',
    branch_type: 'application',
    difficulty: 0.8,
  },
]

interface GrillConjectureRecord {
  text: string
  verdict: string
  counter_example: string | null
}

/** @internal Exported for unit testing. */
export class SimpleGrillSession {
  active = false
  currentIndex = 0
  cayleyTablesSeen = 0
  conjectureHistory: GrillConjectureRecord[] = []
  answerHistory: Array<{ qid: string; answer: string; isCorrect: boolean }> = []
  private streakCorrect = 0
  private streakWrong = 0
  private currentDifficulty = 0.4

  activate(): void {
    this.active = true
  }

  reactivate(): void {
    this.active = true
    this.currentIndex = 0
    this.answerHistory = []
    this.streakCorrect = 0
    this.streakWrong = 0
    this.currentDifficulty = 0.4
  }

  nextQuestion(): GrillQuestion | null {
    if (this.currentIndex < GRILL_QUESTIONS.length) {
      return GRILL_QUESTIONS[this.currentIndex]
    }
    return null
  }

  advance(): void {
    this.currentIndex += 1
  }

  recordCayleyTable(): void {
    this.cayleyTablesSeen += 1
  }

  recordConjecture(text: string, verdict: string, counterExample: string | null): void {
    this.conjectureHistory.push({ text, verdict, counter_example: counterExample })
  }

  /**
   * Evaluate a student's free-text answer against the recommended answer.
   *
   * Uses keyword overlap + key-term detection to determine correctness.
   * When an LLM is available, the caller may pre-evaluate and pass isCorrect
   * directly; otherwise we fall back to the keyword heuristic.
   */
  recordAnswer(qid: string, answer: string, isCorrect?: boolean): boolean {
    const question = GRILL_QUESTIONS.find(q => q.qid === qid)
    let correct: boolean
    if (isCorrect !== undefined) {
      correct = isCorrect
    } else if (question) {
      correct = evaluateAnswer(answer, question.recommended_answer)
    } else {
      correct = false
    }

    this.answerHistory.push({ qid, answer, isCorrect: correct })
    if (correct) {
      this.streakCorrect += 1
      this.streakWrong = 0
      // Increase difficulty after 2 consecutive correct
      if (this.streakCorrect >= 2) {
        this.currentDifficulty = Math.min(0.9, this.currentDifficulty + 0.15)
      }
    } else {
      this.streakWrong += 1
      this.streakCorrect = 0
      // Decrease difficulty after 2 consecutive wrong
      if (this.streakWrong >= 2) {
        this.currentDifficulty = Math.max(0.2, this.currentDifficulty - 0.1)
      }
    }
    return correct
  }

  getSummary(): Record<string, unknown> {
    const total = GRILL_QUESTIONS.length
    const resolved = Math.min(this.currentIndex, total)
    const correctCount = this.answerHistory.filter(a => a.isCorrect).length
    const totalAnswered = this.answerHistory.length
    const accuracy = totalAnswered > 0 ? correctCount / totalAnswered : 0
    const conjSuccess =
      this.conjectureHistory.length > 0
        ? this.conjectureHistory.filter(c => c.verdict === 'confirmed').length /
          this.conjectureHistory.length
        : 0

    // Determine trend from recent answers
    let trend = 'stable'
    if (totalAnswered >= 3) {
      const recent = this.answerHistory.slice(-3)
      const recentCorrect = recent.filter(a => a.isCorrect).length
      if (recentCorrect >= 2) trend = 'rising'
      else if (recentCorrect === 0) trend = 'falling'
    }

    const diffBand =
      this.currentDifficulty < 0.4 ? '基础' : this.currentDifficulty < 0.7 ? '进阶' : '挑战'

    return {
      resolved_branches: resolved,
      total_branches: total,
      correct_answers: correctCount,
      conjecture_count: this.conjectureHistory.length,
      cayley_tables_seen: this.cayleyTablesSeen,
      adaptive: {
        streak_correct: this.streakCorrect,
        streak_wrong: this.streakWrong,
        total_questions: totalAnswered,
        difficulty_band: diffBand,
        trend,
        accuracy_rate: accuracy,
        conjecture_success_rate: conjSuccess,
        current_difficulty: this.currentDifficulty,
        should_increase: this.streakCorrect >= 2,
        should_decrease: this.streakWrong >= 2,
      },
    }
  }

  getConjectureHistory(): GrillConjectureRecord[] {
    return this.conjectureHistory
  }
}

/**
 * Evaluate a free-text answer against a reference answer using keyword overlap.
 *
 * Strategy: extract key mathematical terms from the recommended answer, then
 * check what fraction appear in the student's answer. If ≥60% of key terms are
 * present, the answer is considered correct.
 */
/** @internal Exported for unit testing. */
export function evaluateAnswer(studentAnswer: string, recommendedAnswer: string): boolean {
  const student = studentAnswer.toLowerCase().trim()
  const recommended = recommendedAnswer.toLowerCase().trim()

  // Empty answer is never correct
  if (!student) return false

  // Extract key terms: Chinese math terms, numbers, Latin math symbols
  const keyTerms = extractKeyTerms(recommended)
  if (keyTerms.length === 0) {
    // No extractable key terms — fall back to length + overlap check
    return student.length >= recommended.length * 0.3
  }

  let matched = 0
  for (const term of keyTerms) {
    if (student.includes(term.toLowerCase())) {
      matched += 1
    }
  }

  const matchRatio = matched / keyTerms.length
  return matchRatio >= 0.6
}

/** @internal Exported for unit testing. Extract mathematically significant terms from a reference answer string. */
export function extractKeyTerms(text: string): string[] {
  const terms: string[] = []

  // Chinese math terms (2+ chars, common group theory vocabulary)
  const cnTerms = text.match(/[\u4e00-\u9fff]{2,6}/g) ?? []
  // Filter out common stop words
  const cnStopWords = new Set([
    '一个',
    '群的',
    '就是',
    '如果',
    '那么',
    '因为',
    '所以',
    '这是',
    '满足',
  ])
  for (const t of cnTerms) {
    if (!cnStopWords.has(t)) {
      terms.push(t)
    }
  }

  // Latin math terms and symbols (e.g., "S₃", "a·b", "Lagrange")
  const latinTerms = text.match(/[A-Za-z][A-Za-z₃₄₅₆⁻¹²³₍₎]*/g) ?? []
  for (const t of latinTerms) {
    if (t.length >= 2) {
      terms.push(t)
    }
  }

  // Numbers (e.g., "3", "4" in group theory context)
  const numbers = text.match(/\d+/g) ?? []
  terms.push(...numbers)

  // Deduplicate
  return [...new Set(terms)]
}

// ---------------------------------------------------------------------------
// Simplified Proof Templates (replaces proof/assistant.py)
// ---------------------------------------------------------------------------

interface ProofTemplate {
  description: string
  given: string[]
  toProve: string
  expectedSteps: string[]
  socraticHints: string[]
}

const PROOF_TEMPLATES: Record<string, ProofTemplate> = {
  identity_unique: {
    description: '群的单位元唯一',
    given: ['G 是群', 'e, f 都是单位元'],
    toProve: 'e = f',
    expectedSteps: ['e·f = f（e 是单位元）', 'e·f = e（f 是单位元）', 'e = f（传递性）'],
    socraticHints: ['试试用单位元的定义。'],
  },
  inverse_unique: {
    description: '群中元素的逆元唯一',
    given: ['G 是群', 'a ∈ G', 'b, c 都是 a 的逆元'],
    toProve: 'b = c',
    expectedSteps: [
      'b = b·e（e 是单位元）',
      'b = b·(a·c)（c 是 a 的逆元）',
      'b = (b·a)·c（结合律）',
      'b = e·c（b 是 a 的逆元）',
      'b = c（e 是单位元）',
    ],
    socraticHints: ['从 b = b·e 开始，把 e 替换成 a·c。'],
  },
  cancellation_law: {
    description: '群的消去律',
    given: ['G 是群', 'a·b = a·c'],
    toProve: 'b = c',
    expectedSteps: [
      'a⁻¹·(a·b) = a⁻¹·(a·c)（两边左乘 a 的逆元）',
      '(a⁻¹·a)·b = (a⁻¹·a)·c（结合律）',
      'e·b = e·c（逆元定义）',
      'b = c（单位元定义）',
    ],
    socraticHints: ['两边同时左乘 a 的逆元。'],
  },
  trivial_subgroup: {
    description: '{e} 是子群',
    given: ['G 是群', 'e 是单位元'],
    toProve: '{e} 是 G 的子群',
    expectedSteps: ['封闭性：e·e = e ∈ {e}', '单位元：e ∈ {e}', '逆元：e 的逆元是 e ∈ {e}'],
    socraticHints: ['逐条验证子群判定条件。'],
  },
  abelian_subgroup_of_squares: {
    description: '交换群中平方元素构成子群',
    given: ['G 是交换群', 'H = {g² : g ∈ G}'],
    toProve: 'H 是 G 的子群',
    expectedSteps: [
      '封闭性：(a²)·(b²) = (a·b)² ∈ H（交换律）',
      '单位元：e² = e ∈ H',
      '逆元：(a²)⁻¹ = (a⁻¹)² ∈ H',
    ],
    socraticHints: ['利用交换律证明封闭性。'],
  },
}

// ---------------------------------------------------------------------------
// DecisionEffectivenessTracker
// ---------------------------------------------------------------------------

interface ActionStat {
  count: number
  positive: number
  totalEffectiveness: number
}

/**
 * DecisionEffectivenessTracker — 教学决策效果追踪器。
 *
 * 让 meta-agent 的参数学习闭环拥有「真实」数据，而非硬编码占位。
 *
 * 工作方式：
 * - 每个回合结束时 `recordDecision(action)` 记录一次教学决策；
 * - 下一回合开始时 `observeInput(...)` 依据可观测的学生信号评估上一回合
 *   决策是否「有效」，并把结果归因到对应的 action；
 * - 汇总为 meta-agent 需要的 feedback（action_stats）与 metrics
 *   （success_rate / avg_latency_ms）。
 *
 * 有效性是诚实代理（honest proxy），并非推测的绝对值：
 * - 学生提交了凯莱表（发生了实质学习产出）→ +1
 * - 认知负荷较上一回合下降 → +1
 * - 无回溯（探索更顺畅）→ +0.5
 * - 认知负荷上升且出现回溯（决策未奏效）→ -1
 */
class DecisionEffectivenessTracker {
  private actionStats: Record<string, ActionStat> = {}
  private previousAction: string | null = null
  private previousLoad = 0.4
  private previousStrokes = 0
  private totalTurns = 0
  private positiveTurns = 0
  private latencySum = 0
  private latencyCount = 0

  /** 记录本回合做出的教学决策（每回合恰好一次）。 */
  recordDecision(action: string): void {
    this.previousAction = action
    if (!this.actionStats[action]) {
      this.actionStats[action] = { count: 0, positive: 0, totalEffectiveness: 0 }
    }
    this.actionStats[action].count += 1
  }

  /** 新会话开始时清空历史统计。 */
  reset(): void {
    this.actionStats = {}
    this.previousAction = null
    this.previousLoad = 0.4
    this.previousStrokes = 0
    this.totalTurns = 0
    this.positiveTurns = 0
    this.latencySum = 0
    this.latencyCount = 0
  }

  /** 下一回合开始时调用：评估上一回合决策的有效性并汇总指标。 */
  observeInput(studentInput: string, rtMs: number, metadata: Record<string, unknown>): void {
    const load =
      typeof metadata['cognitive_load'] === 'number'
        ? Math.max(0, Math.min(1, metadata['cognitive_load']))
        : this.previousLoad
    const backtrack = metadata['backtrack_count'] as number | undefined
    const sentTable = this.isCayleyTable(studentInput)
    const strokes = metadata['whiteboard_strokes'] as number | undefined
    const drewMore = typeof strokes === 'number' && strokes > this.previousStrokes

    let eff = 0
    if (sentTable) eff += 1
    if (drewMore) eff += 0.5 // visual exploration on the whiteboard = active learning
    if (load < this.previousLoad - 0.05) eff += 1
    if (typeof backtrack === 'number' && backtrack === 0 && this.previousAction) eff += 0.5
    if (load > this.previousLoad + 0.1 && (backtrack ?? 0) > 0) eff -= 1

    if (this.previousAction && this.actionStats[this.previousAction]) {
      const stat = this.actionStats[this.previousAction]
      stat.totalEffectiveness += eff
      if (eff > 0) stat.positive += 1
    }

    this.totalTurns += 1
    if (eff > 0) this.positiveTurns += 1
    this.latencySum += rtMs
    this.latencyCount += 1
    this.previousLoad = load
    if (typeof strokes === 'number') this.previousStrokes = strokes
  }

  private isCayleyTable(input: string): boolean {
    const t = input.trim()
    return t.startsWith('[') && t.endsWith(']')
  }

  /** 汇总为 meta-agent 需要的 feedback 结构。 */
  getFeedback(): {
    evaluated: number
    action_stats: Record<string, Record<string, number>>
  } {
    const actionStats: Record<string, Record<string, number>> = {}
    for (const [action, s] of Object.entries(this.actionStats)) {
      actionStats[action] = {
        count: s.count,
        avg_effectiveness: s.count > 0 ? s.totalEffectiveness / s.count : 0,
        positive_rate: s.count > 0 ? s.positive / s.count : 0,
      }
    }
    return { evaluated: this.totalTurns, action_stats: actionStats }
  }

  /** 汇总为 meta-agent 需要的 metrics 结构。 */
  getMetrics(): { success_rate: number; avg_latency_ms: number } {
    return {
      success_rate: this.totalTurns > 0 ? this.positiveTurns / this.totalTurns : 0,
      avg_latency_ms: this.latencyCount > 0 ? Math.round(this.latencySum / this.latencyCount) : 0,
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  /** The central orchestrator implementing four-field coupling. */

  curriculumLevel: string
  /** Age band of the current student ('kids' | 'tweens' | 'teens'), passed to
   *  agents so they adapt explanation language (magical vs formal terms). */
  ageLevel: string = 'kids'
  dag: ConceptDAG
  forge: CounterExampleForge
  llmClient: LLMClient | null
  state: FourFieldState
  profile: StudentProfile | null
  phase: SessionPhase
  messageHistory: AgentMessage[]
  topology: SimpleTopology
  knowledgeBase: KnowledgeBase
  paramLearner: ParameterLearner
  grillSession: SimpleGrillSession | null
  agents: Record<string, BaseAgent>
  /** 教学决策效果追踪器，为 meta-agent 提供真实反馈数据 */
  private effectivenessTracker = new DecisionEffectivenessTracker()
  private sessionStart: Date | null = null
  private store: StateStore | null
  /** 串行化锁，防止并发 processStudentInput 竞态 */
  private _processingLock: Promise<Record<string, unknown>> = Promise.resolve({})

  constructor(
    opts: {
      dag?: ConceptDAG
      forge?: CounterExampleForge
      llmClient?: LLMClient | null
      curriculumLevel?: string
      dbPath?: string
    } = {},
  ) {
    this.curriculumLevel = opts.curriculumLevel ?? 'group_theory'
    this.dag = opts.dag ?? getDag(this.curriculumLevel)
    this.llmClient = opts.llmClient ?? null
    this.forge = opts.forge ?? new CounterExampleForge(opts.llmClient ?? undefined)
    this.state = defaultFourFieldState()
    this.profile = null
    this.phase = SessionPhase.IDLE
    this.messageHistory = []
    this.topology = new SimpleTopology()
    this.knowledgeBase = buildDefaultKB()
    this.paramLearner = new ParameterLearner()
    this.grillSession = null

    // Initialize persistence store
    if (opts.dbPath) {
      this.store = new StateStore(opts.dbPath)
      if (this.store.isFallbackMode) {
        log.warn('StateStore is in fallback (in-memory) mode — session data will not persist')
      }
    } else {
      this.store = null
    }

    // Initialize independent agents (1.1: each agent is self-contained)
    const llm = this.llmClient
    this.agents = {
      perception: new PerceptionAgent(llm),
      abstraction: new AbstractionAgent(llm),
      counter_example: new CounterExampleAgent(this.forge, llm),
      epistemic: new EpistemicAgent(llm),
      historical: new HistoricalAgent(llm, this.knowledgeBase),
      collaboration: new CollaborationAgent(llm),
      meta: new MetaEvolutionAgent(llm, this.paramLearner),
    }
  }

  // -- Session Management --

  startSession(
    studentId: string,
    studentName = '',
    targetNodeId?: string,
    curriculumLevel?: string,
  ): Record<string, unknown> {
    if (curriculumLevel && curriculumLevel !== this.curriculumLevel) {
      this.switchCurriculum(curriculumLevel)
    }

    this.profile = defaultStudentProfile(studentId)
    this.profile.name = studentName
    this.state = defaultFourFieldState()
    this.phase = SessionPhase.PERCEIVE
    this.messageHistory = []
    this.grillSession = null
    this.effectivenessTracker.reset()
    this.sessionStart = new Date()

    // Set initial knowledge field
    if (targetNodeId) {
      const node = this.dag.getNode(targetNodeId)
      if (node) {
        this.state.knowledge.current_node_id = targetNodeId
        this.state.knowledge.mastery_estimate = getMastery(this.profile, targetNodeId)
        const gaps = this.dag.checkPrerequisites(targetNodeId, this.profile.dag_mastery)
        this.state.knowledge.prerequisite_gaps = gaps

        // Persist session to SQLite
        if (this.store) {
          try {
            this.store.saveSession(studentId, studentId, this.state, this.profile)
          } catch (err) {
            log.error('Failed to persist session', {
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return {
          session_id: `sess_${studentId}_${Math.floor(this.sessionStart.getTime() / 1000)}`,
          student_id: studentId,
          target_node: targetNodeId,
          node_name: node.name,
          node_description: node.description,
          prerequisite_gaps: gaps,
          learning_path: this.dag.getLearningPath(targetNodeId, this.profile.dag_mastery),
          phase: this.phase,
        }
      }
    }

    // Persist session to SQLite
    if (this.store) {
      try {
        this.store.saveSession(studentId, studentId, this.state, this.profile)
      } catch (err) {
        log.error('Failed to persist session', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return {
      session_id: `sess_${studentId}_${Math.floor(this.sessionStart.getTime() / 1000)}`,
      student_id: studentId,
      phase: this.phase,
    }
  }

  getStateSnapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      four_fields: snapshotFourField(this.state),
      current_node: this.state.knowledge.current_node_id,
      in_zpd: isKnowledgeInZPD(this.state.knowledge),
      cognitive_overloaded: isCognitiveOverloaded(this.state.cognitive),
      emotional_state: this.state.emotional.state,
      in_flow: isEmotionalInFlow(this.state.emotional),
      should_fade_scaffold: shouldFadeScaffold(this.state.interaction),
    }
  }

  switchCurriculum(level: string): void {
    this.curriculumLevel = level
    // Reset grill session — it was tied to the old DAG
    this.grillSession = null
    const allNodes = this.dag.getAllNodes()
    if (allNodes.length > 0) {
      const first = allNodes.reduce((a, b) => (a.abstraction_level <= b.abstraction_level ? a : b))
      this.state.knowledge.current_node_id = first.id
    }
    log.info('Switched curriculum', {
      level,
      label: CURRICULUM_LABELS[level] ?? level,
      conceptCount: this.dag.getNodeCount(),
    })
  }

  detectCurriculumSwitch(text: string): [string, string] | null {
    const textLower = text.toLowerCase()
    const switchMap: Record<string, string[]> = {
      elementary: ['小学', 'elementary', 'primary'],
      middle_school: ['初中', 'middle school', '中学'],
      high_school: ['高中', 'high school'],
      group_theory: ['群论', 'group theory', '大学', '抽象代数'],
    }
    const switchVerbs = ['切换', '学', '想学', '换', '转到', 'switch', 'change']
    const hasSwitchIntent = switchVerbs.some(v => textLower.includes(v))

    for (const [level, keywords] of Object.entries(switchMap)) {
      if (keywords.some(kw => textLower.includes(kw))) {
        if (hasSwitchIntent || level !== this.curriculumLevel) {
          return [level, CURRICULUM_LABELS[level] ?? level]
        }
      }
    }
    return null
  }

  getCurriculumInfo(): Record<string, unknown> {
    return {
      current_level: this.curriculumLevel,
      current_label: CURRICULUM_LABELS[this.curriculumLevel] ?? this.curriculumLevel,
      current_summary: this.dag.getCurriculumSummary(),
    }
  }

  // -- Agent Registration --

  registerAgent(role: AgentRole, _handler: unknown): void {
    // Placeholder for custom agent handlers (kept for API compatibility)
    log.debug('Registered agent handler', { role })
  }

  // -- Single-Writer Field Update --

  /** Apply a field update atomically (single-writer pattern). */
  private applyFieldUpdate(fieldName: string, updates: Record<string, unknown>): void {
    const fieldMap: Record<string, Record<string, unknown>> = {
      knowledge: this.state.knowledge as unknown as Record<string, unknown>,
      cognitive: this.state.cognitive as unknown as Record<string, unknown>,
      emotional: this.state.emotional as unknown as Record<string, unknown>,
      interaction: this.state.interaction as unknown as Record<string, unknown>,
    }
    const model = fieldMap[fieldName]
    if (!model) {
      log.warn('Rejected field update: unknown field', { field: fieldName })
      return
    }

    // Type/range constraints per field
    const float01Fields: Record<string, Set<string>> = {
      knowledge: new Set(['mastery_estimate', 'misconception_rate']),
      cognitive: new Set(['cognitive_load']),
      emotional: new Set(['anxiety_index', 'flow_score', 'skip_rate']),
      interaction: new Set(['hint_dependency']),
    }
    const intFields: Record<string, Set<string>> = {
      cognitive: new Set(['backtrack_count', 'trial_sequence_length']),
      interaction: new Set([
        'current_hint_level',
        'consecutive_correct',
        'scaffold_fade_threshold',
      ]),
    }
    const nnFloatFields: Record<string, Set<string>> = {
      cognitive: new Set(['response_time_ms', 'baseline_rt_ms', 'struggle_duration_s']),
      interaction: new Set(['struggle_duration_s']),
    }

    const ok01 = float01Fields[fieldName] ?? new Set<string>()
    const okInt = intFields[fieldName] ?? new Set<string>()
    const okNnFloat = nnFloatFields[fieldName] ?? new Set<string>()

    for (const [key, val] of Object.entries(updates)) {
      if (!(key in model)) {
        log.warn('Rejected: field.key does not exist', { field: fieldName, key })
        continue
      }

      if (ok01.has(key)) {
        if (typeof val !== 'number' || !(val >= 0.0 && val <= 1.0)) {
          log.warn('Rejected: field.value out of [0,1]', { field: fieldName, key, value: val })
          continue
        }
      }
      if (okInt.has(key)) {
        if (!Number.isInteger(val) || (val as number) < 0) {
          log.warn('Rejected: field.value not non-negative int', {
            field: fieldName,
            key,
            value: val,
          })
          continue
        }
      }
      if (okNnFloat.has(key)) {
        if (typeof val !== 'number' || (val as number) < 0) {
          log.warn('Rejected: field.value not non-negative', { field: fieldName, key, value: val })
          continue
        }
      }

      model[key] = val
    }

    this.state.updated_at = new Date().toISOString()
  }

  // -- Pedagogical Decision Engine --

  /** Make a pedagogical decision based on four-field coupling. */
  makeDecision(): TeachingDecision {
    const k = this.state.knowledge
    const c = this.state.cognitive
    const e = this.state.emotional
    const i = this.state.interaction

    // Case 1: Student is overwhelmed — reduce load
    if (isCognitiveOverloaded(c) && !isEmotionalInFlow(e)) {
      return {
        action: 'reduce_abstraction',
        reason: `Cognitive overload detected (RT z-score=${c.rt_zscore.toFixed(2)}), reducing abstraction level`,
        field_signals: { cognitive_load: c.cognitive_load, rt_zscore: c.rt_zscore },
        hint_level: Math.min(i.current_hint_level + 1, 3),
        next_phase: SessionPhase.COLLABORATE,
      }
    }

    // Case 2: Student is anxious — provide emotional support
    if (isEmotionalAnxious(e)) {
      return {
        action: 'emotional_support',
        reason: `Anxiety index ${e.anxiety_index.toFixed(2)} exceeds threshold, providing scaffolding before proceeding`,
        field_signals: { anxiety_index: e.anxiety_index },
        hint_level: Math.min(i.current_hint_level + 1, 3),
        next_phase: SessionPhase.REFLECT,
      }
    }

    // Case 3: Student is in flow — advance
    if (isEmotionalInFlow(e) && isKnowledgeReadyToAdvance(k)) {
      return {
        action: 'advance',
        reason: 'Student is in flow and mastery exceeds ZPD upper bound, advancing',
        field_signals: { flow_score: e.flow_score, mastery: k.mastery_estimate },
        hint_level: 0,
        next_phase: SessionPhase.ABSTRACT,
      }
    }

    // Case 4: Student in ZPD — continue guided discovery
    if (isKnowledgeInZPD(k)) {
      return {
        action: 'guided_discovery',
        reason: 'Mastery is in ZPD grey area, continuing guided discovery',
        field_signals: { mastery: k.mastery_estimate, zpd_range: [k.zpd_lower, k.zpd_upper] },
        hint_level: shouldFadeScaffold(i)
          ? Math.max(i.current_hint_level - 1, 0)
          : i.current_hint_level,
        next_phase: SessionPhase.VERIFY,
      }
    }

    // Case 5: Student struggling — provide hint
    if (isInteractionStruggling(i)) {
      return {
        action: 'provide_hint',
        reason: `Struggle duration ${i.struggle_duration_s.toFixed(0)}s, providing hint level ${i.current_hint_level + 1}`,
        field_signals: { struggle_duration: i.struggle_duration_s },
        hint_level: Math.min(i.current_hint_level + 1, 3),
        next_phase: SessionPhase.COLLABORATE,
      }
    }

    // Default: continue current phase
    return {
      action: 'continue',
      reason: 'No special condition detected, continuing current phase',
      field_signals: {},
      hint_level: 0,
      next_phase: this.phase,
    }
  }

  // -- Teaching Loop --

  async processStudentInput(
    studentInput: string,
    inputMetadata: Record<string, unknown> | null = null,
  ): Promise<Record<string, unknown>> {
    const run = this._processStudentInputInternal.bind(this, studentInput, inputMetadata)
    // Chain onto the previous lock holder to serialize execution
    this._processingLock = this._processingLock.then(() => run())
    return this._processingLock
  }

  private async _processStudentInputInternal(
    studentInput: string,
    inputMetadata: Record<string, unknown> | null = null,
  ): Promise<Record<string, unknown>> {
    const metadata = inputMetadata ?? {}
    const rtMs = (metadata['response_time_ms'] as number) ?? 5000

    // Update cognitive field from response time
    if ('response_time_ms' in metadata) {
      this.state.cognitive.response_time_ms = rtMs
      this.state.cognitive.rt_zscore =
        (rtMs - this.state.cognitive.baseline_rt_ms) /
        Math.max(this.state.cognitive.baseline_rt_ms * 0.3, 1.0)
    }

    // Merge real epistemic/interaction signals captured on the frontend
    // (eye-tracking cognitive load, table edit backtracks) into the state so
    // makeDecision() consumes actual student behavior, not simulated defaults.
    if (typeof metadata['cognitive_load'] === 'number') {
      this.state.cognitive.cognitive_load = Math.max(0, Math.min(1, metadata['cognitive_load']))
    }
    if (typeof metadata['backtrack_count'] === 'number') {
      this.state.cognitive.backtrack_count = metadata['backtrack_count']
    }
    if (typeof metadata['trial_sequence_length'] === 'number') {
      this.state.cognitive.trial_sequence_length = metadata['trial_sequence_length']
    }

    // Whiteboard (visual exploration) engagement: drawing means active learning.
    // Nudge flow slightly positive so makeDecision() reflects real engagement.
    if (metadata['whiteboard_active'] === true) {
      this.state.emotional.flow_score = Math.min(1, this.state.emotional.flow_score + 0.06)
    }

    // Age adaptation: remember the student's age band so downstream agents can
    // adapt their explanation language (magical / transitional / formal).
    if (typeof metadata['age_level'] === 'string' && metadata['age_level'].length > 0) {
      this.ageLevel = metadata['age_level']
    }

    // Evaluate the previous turn's teaching decision using this turn's signals,
    // so the meta-agent can learn from real outcomes (not hardcoded numbers).
    this.effectivenessTracker.observeInput(studentInput, rtMs, metadata)

    // --- Curriculum switch detection ---
    const switched = this.detectCurriculumSwitch(studentInput)
    if (switched) {
      const [level, label] = switched
      this.switchCurriculum(level)
      return {
        response:
          `已切换到「${label}」课程体系！\n` +
          `当前课程包含 ${this.dag.getNodeCount()} 个概念，` +
          `涵盖 ${(this.dag.getCurriculumSummary()['domains'] as unknown[]).length} 个知识域。\n` +
          `你可以开始学习，或说「考考我」进入提问模式。`,
        curriculum_switched: true,
        curriculum_level: level,
        curriculum_label: label,
        curriculum_summary: this.dag.getCurriculumSummary(),
      }
    }

    // --- Grill Me mode detection ---
    const grillTriggerKeywords = ['考考我', 'grill me', '考考看', '来考考', '审问我', '面试我']
    const isGrillTrigger = grillTriggerKeywords.some(kw => studentInput.toLowerCase().includes(kw))

    if (isGrillTrigger && this.grillSession === null) {
      this.grillSession = new SimpleGrillSession()
      this.grillSession.activate()
      log.info('Grill mode activated by student request')
    } else if (isGrillTrigger && this.grillSession !== null) {
      this.grillSession.reactivate()
      log.info('Grill mode re-activated by student request')
    }

    // --- Proof mode detection ---
    const proofTriggerKeywords = ['证明', '求证', 'prove', 'proof', '我要证', '验证以下']
    const isProof = proofTriggerKeywords.some(kw => studentInput.toLowerCase().includes(kw))
    let proofResultData: Record<string, unknown> | null = null
    if (isProof) {
      proofResultData = this.handleProof(studentInput)
      log.info('Proof mode', {
        theorem: proofResultData['theorem_name'] ?? '?',
        progress: proofResultData['progress'] ?? '?',
      })
    }

    // --- Track Cayley tables for grill session ---
    if (this.grillSession !== null) {
      const trimmed = studentInput.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const table = JSON.parse(trimmed)
          if (Array.isArray(table) && table.every(r => Array.isArray(r))) {
            this.grillSession.recordCayleyTable()
          }
        } catch {
          // not a valid table
        }
      }
    }

    // --- Evaluate grill answer (non-trigger input during active grill) ---
    if (this.grillSession !== null && this.grillSession.active && !isGrillTrigger && !isProof) {
      const currentQ = this.grillSession.nextQuestion()
      if (currentQ && !studentInput.trim().startsWith('[')) {
        // Evaluate the answer using LLM if available, otherwise keyword heuristic
        let isCorrect: boolean | undefined
        if (this.llmClient && this.llmClient.isConfigured && this.llmClient.provider !== 'mock') {
          try {
            isCorrect = await this.evaluateGrillAnswerLLM(
              currentQ.question,
              currentQ.recommended_answer,
              studentInput,
            )
          } catch {
            // LLM evaluation failed — fall back to keyword heuristic
            isCorrect = undefined
          }
        }
        const wasCorrect = this.grillSession.recordAnswer(currentQ.qid, studentInput, isCorrect)
        // Store result for collaboration agent to use
        this.grillSession.recordConjecture(
          studentInput,
          wasCorrect ? 'confirmed' : 'refuted',
          wasCorrect ? null : `参考答案：${currentQ.recommended_answer}`,
        )
      }
    }

    // LLM-driven agent loop (1.2: LLM controls flow, not hardcoded pipeline)
    const llm = this.llmClient ?? new MockLLMClient()

    const priorResults: Record<string, Record<string, unknown>> = {}
    const phaseTrace: string[] = []
    const fullTrace: Record<string, unknown>[] = []
    const maxIterations = this.topology.maxIterations
    const calledAgents = new Set<string>()
    const sessionId = this.profile ? this.profile.student_id : 'unknown'

    // Pre-compute a default decision in case the loop exits early
    let decision = this.makeDecision()

    // 2.1: LLM generates task decomposition
    const decomposition = await this.decomposeTask(llm, studentInput)
    fullTrace.push({ phase: 'decompose', decomposition })

    let lastAgent = 'orchestrator'
    let delivered = false

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Build agent descriptions, filtered by topology + called set
      let agentDescriptions: Record<string, unknown> = {}
      for (const [name, agent] of Object.entries(this.agents)) {
        if (!calledAgents.has(name) || name === this.topology.exitAgent) {
          agentDescriptions[name] = agent.describe()
        }
      }
      // Topology filtering (permissive)
      let topologyAllowed: Set<string>
      if (calledAgents.size > 0) {
        topologyAllowed = new Set(this.topology.availableFrom(lastAgent))
      } else {
        topologyAllowed = new Set([this.topology.entryAgent])
      }
      topologyAllowed.add(this.topology.exitAgent)
      const filtered: Record<string, unknown> = {}
      for (const [name, desc] of Object.entries(agentDescriptions)) {
        if (topologyAllowed.has(name) || !this.topology.agents.includes(name)) {
          filtered[name] = desc
        }
      }
      agentDescriptions = filtered

      const llmInput = this.buildLlmInput(
        studentInput,
        priorResults,
        calledAgents,
        agentDescriptions,
      )
      const llmResp = await llm.chat(this.systemPrompt(), llmInput)

      // LLM decides to deliver
      if (llmResp.next_action === 'deliver' || iteration === maxIterations - 1) {
        const exitName = this.topology.exitAgent

        // Compute pedagogical decision BEFORE collaboration
        decision = this.makeDecision()

        // --- Grill Me mode: prepare grill session data for collaboration agent ---
        let grillData: Record<string, unknown> | null = null
        if (this.grillSession !== null && this.grillSession.active) {
          // Record conjecture result if this was a conjecture input
          const ceResult = (priorResults['counter_example'] ?? {}) as Record<string, unknown>
          const ceMeta = (ceResult['metadata'] ?? {}) as Record<string, unknown>
          if (ceMeta['conjecture_verdict']) {
            const resultDict = (ceMeta['conjecture_result'] as Record<string, unknown>) ?? {}
            this.grillSession.recordConjecture(
              (resultDict['claim'] as string) ?? studentInput,
              ceMeta['conjecture_verdict'] as string,
              (ceMeta['conjecture_counter_example'] as string) ?? null,
            )
          }

          const grillQ = this.grillSession.nextQuestion()
          grillData = {
            active: true,
            next_question: grillQ,
            summary: this.grillSession.getSummary(),
            conjecture_history: this.grillSession.getConjectureHistory(),
          }
          // Advance to the next question for the following turn (simplified)
          this.grillSession.advance()
        }

        const ctx: AgentContext = {
          student_input: studentInput,
          four_field_state: this.state,
          prior_results: priorResults,
          metadata: {
            response_time_ms: rtMs,
            age_level: this.ageLevel,
            pedagogical_decision: {
              action: decision.action,
              reason: decision.reason,
              hint_level: decision.hint_level,
              field_signals: decision.field_signals,
            },
            grill_session: grillData,
            proof_result: proofResultData,
          },
        }

        log.debug('Context message orchestrator -> exit agent', { exitAgent: exitName, sessionId })

        const msg = await this.agents[exitName].run(ctx)
        this.messageHistory.push(msg)
        priorResults[exitName] = {
          content: msg.content,
          metadata: msg.metadata,
        }
        phaseTrace.push('collaborate')
        fullTrace.push({
          phase: 'collaborate',
          agent: exitName,
          result: { content: msg.content },
          iteration,
          tool_calls: msg.tool_calls.length,
        })

        delivered = true
        break
      }

      // LLM decides which agent to call
      let nextAgentName = llmResp.next_agent
      if (nextAgentName && !this.topology.isActive(nextAgentName)) {
        log.info('Agent not in topology, ignoring', { agent: nextAgentName })
        nextAgentName = null
      }
      if (!nextAgentName || !(nextAgentName in this.agents)) {
        if (!calledAgents.has(this.topology.exitAgent)) {
          nextAgentName = this.topology.exitAgent
        } else {
          break
        }
      }

      // Topology routing validation (permissive)
      if (this.topology.isActive(nextAgentName)) {
        if (nextAgentName !== this.topology.exitAgent) {
          const isEntry = calledAgents.size === 0 && nextAgentName === this.topology.entryAgent
          if (!isEntry && !this.topology.canRoute(lastAgent, nextAgentName)) {
            log.warn('Topology blocked route, falling back to exit', {
              from: lastAgent,
              to: nextAgentName,
            })
            nextAgentName = this.topology.exitAgent
          }
        }
      }

      const agent = this.agents[nextAgentName]
      calledAgents.add(nextAgentName)
      lastAgent = nextAgentName
      const phaseName = this.agentToPhase(nextAgentName)
      this.phase = phaseName

      // Build context for this agent
      const ctx: AgentContext = {
        student_input: studentInput,
        four_field_state: this.state,
        prior_results: priorResults,
        metadata: { response_time_ms: rtMs, age_level: this.ageLevel },
      }

      // Run the agent
      const msg = await agent.run(ctx)
      this.messageHistory.push(msg)

      // Apply field updates (single-writer: orchestrator applies, not agent)
      for (const [fieldName, updates] of Object.entries(msg.field_updates)) {
        this.applyFieldUpdate(fieldName, updates as Record<string, unknown>)
      }

      // Store result for next agent
      priorResults[nextAgentName] = {
        content: msg.content,
        field_updates: msg.field_updates,
        tool_calls: msg.tool_calls,
        confidence: msg.confidence,
        metadata: msg.metadata,
      }

      phaseTrace.push(phaseName)
      fullTrace.push({
        phase: phaseName,
        agent: nextAgentName,
        result: priorResults[nextAgentName],
        iteration,
        llm_decision: llmResp.next_action,
        tool_calls: msg.tool_calls.length,
      })
    }

    if (!delivered) {
      // Loop ended without explicit deliver — synthesize a fallback response
      decision = this.makeDecision()
      const exitName = this.topology.exitAgent
      const ctx: AgentContext = {
        student_input: studentInput,
        four_field_state: this.state,
        prior_results: priorResults,
        metadata: {
          response_time_ms: rtMs,
          age_level: this.ageLevel,
          pedagogical_decision: {
            action: decision.action,
            reason: decision.reason,
            hint_level: decision.hint_level,
            field_signals: decision.field_signals,
          },
          grill_session: null,
          proof_result: proofResultData,
        },
      }
      const msg = await this.agents[exitName].run(ctx)
      this.messageHistory.push(msg)
      priorResults[exitName] = { content: msg.content, metadata: msg.metadata }
      phaseTrace.push('collaborate')
    }

    // Update interaction field
    this.state.interaction.hint_dependency = Math.min(
      this.state.interaction.hint_dependency + 0.01,
      1.0,
    )
    if (this.profile) {
      this.profile.total_interactions += 1
    }

    // Get final response
    const finalResponse = (priorResults['collaboration'] ?? {}) as Record<string, unknown>
    const responseContent = (finalResponse['content'] as string) ?? '未能生成回应。'

    this.phase = SessionPhase.DELIVER

    // S3: Run meta-evolution agent (during post-processing)
    let metaResult: Record<string, unknown> | null = null
    try {
      const metaAgent = this.agents['meta']
      if (metaAgent) {
        // Record the final pedagogical decision of this turn so the next turn's
        // outcome can be attributed to it.
        this.effectivenessTracker.recordDecision(decision.action)
        const metaCtx: AgentContext = {
          student_input: studentInput,
          four_field_state: this.state,
          prior_results: {},
          metadata: {
            age_level: this.ageLevel,
            feedback: this.effectivenessTracker.getFeedback(),
            metrics: this.effectivenessTracker.getMetrics(),
          },
        }
        const metaMsg = await metaAgent.run(metaCtx)
        metaResult = {
          content: metaMsg.content,
          version: metaMsg.metadata['version'] ?? 0,
          effectiveness: metaMsg.metadata['effectiveness'] ?? 0,
          evolution_count: metaMsg.metadata['evolution_count'] ?? 0,
          param_learner_state: metaMsg.metadata['param_learner_state'] ?? {},
        }
      }
    } catch (e) {
      log.warn('MetaEvolution agent failed', { error: e instanceof Error ? e.message : String(e) })
    }

    // DAG 自主推进: 当掌握度超过 ZPD 上界时，推荐下一概念
    let dagAdvance: Record<string, unknown> | null = null
    if (this.state.knowledge.mastery_estimate >= this.state.knowledge.zpd_upper) {
      const current = this.state.knowledge.current_node_id
      if (current) {
        const dependents = this.dag.getDependents(current)
        if (dependents.length > 0) {
          const nextId = dependents[0]
          const nextNode = this.dag.getNode(nextId)
          if (nextNode) {
            dagAdvance = {
              from: current,
              to: nextId,
              to_name: nextNode.name,
              to_description: nextNode.description,
              reason:
                `掌握度 ${(this.state.knowledge.mastery_estimate * 100).toFixed(0)}% 超过 ZPD 上界 ` +
                `${(this.state.knowledge.zpd_upper * 100).toFixed(0)}%`,
            }
          }
        }
      }
    }

    return {
      response: responseContent,
      four_fields: snapshotFourField(this.state),
      decision,
      phase_trace: phaseTrace,
      full_trace: fullTrace,
      dag_advance: dagAdvance,
      grill_mode: this.grillSession !== null && this.grillSession.active,
      grill_summary: this.grillSession ? this.grillSession.getSummary() : null,
      proof_mode: proofResultData !== null,
      proof_result: proofResultData,
      curriculum_level: this.curriculumLevel,
      meta: metaResult,
      visual: this.buildVisualData(rtMs),
    }
  }

  private buildVisualData(rtMs: number): Record<string, unknown> {
    const speedFactor = Math.min(1.0, 5000.0 / Math.max(rtMs, 500.0))
    return {
      four_field_gauges: {
        cognitive_load: Math.round(this.state.cognitive.cognitive_load * 100) / 100,
        cognitive_state: this.state.cognitive.state,
        anxiety_index: Math.round(this.state.emotional.anxiety_index * 100) / 100,
        flow_score: Math.round(this.state.emotional.flow_score * 100) / 100,
        emotional_state: this.state.emotional.state,
        hint_dependency: Math.round(this.state.interaction.hint_dependency * 100) / 100,
        mastery_estimate: Math.round(this.state.knowledge.mastery_estimate * 100) / 100,
        consecutive_correct: this.state.interaction.consecutive_correct,
        in_zpd: isKnowledgeInZPD(this.state.knowledge),
        ready_to_advance: isKnowledgeReadyToAdvance(this.state.knowledge),
      },
      mastery_radar: {
        accuracy_rate: this.state.knowledge.mastery_estimate,
        conjecture_success_rate: 0.5,
        hint_independence: 1.0 - this.state.interaction.hint_dependency,
        speed_factor: speedFactor,
        abstraction_level: Math.min(1.0, this.state.knowledge.mastery_estimate),
      },
    }
  }

  // -- Grill Answer Evaluation --

  /** Use LLM to evaluate whether a student's free-text answer is correct. */
  private async evaluateGrillAnswerLLM(
    question: string,
    recommendedAnswer: string,
    studentAnswer: string,
  ): Promise<boolean> {
    if (!this.llmClient || !this.llmClient.isConfigured) return false

    const prompt =
      `你是一位数学教师，正在评估学生对群论问题的回答。\n\n` +
      `问题：${question}\n` +
      `参考答案：${recommendedAnswer}\n` +
      `学生答案：${studentAnswer}\n\n` +
      `请判断学生答案是否在数学上正确（允许不同表述方式，但核心数学内容必须正确）。\n` +
      `只回答 "correct" 或 "incorrect"，不要其他解释。`

    try {
      const resp = await this.llmClient.chat('你是一位数学教师。', prompt, undefined, 0.1)
      const content = resp.content.toLowerCase().trim()
      return content.includes('correct') && !content.includes('incorrect')
    } catch {
      return false
    }
  }

  // -- Proof Assistant Integration --

  /** Handle a proof attempt: parse, verify, and return results. */
  private handleProof(studentInput: string): Record<string, unknown> {
    const theoremName = this.detectTheorem(studentInput)
    const steps = this.parseProofSteps(studentInput)

    if (theoremName && steps.length > 0) {
      const template = PROOF_TEMPLATES[theoremName]
      const expected = template.expectedSteps
      const verifiedSteps = steps.map((s, idx) => {
        const expectedStep = idx < expected.length ? expected[idx] : ''
        const validation = validateProofStep(s.claim, s.justification, expectedStep, idx, expected)
        return {
          step_number: idx + 1,
          claim: s.claim,
          justification: s.justification,
          is_valid: validation.isValid,
          feedback: validation.feedback,
          matched_expected: expectedStep,
          implicit_steps: validation.implicitSteps,
        }
      })
      const validCount = verifiedSteps.filter(s => s.is_valid).length
      const isComplete = validCount >= expected.length
      const missing = expected.slice(steps.length)
      const allValid = validCount === steps.length
      return {
        theorem_name: theoremName,
        is_complete: isComplete,
        progress: `${validCount}/${expected.length}`,
        overall_feedback: isComplete
          ? `证明完成！${validCount}/${expected.length} 步全部有效。`
          : allValid
            ? `已记录 ${validCount} 步有效步骤，还需要 ${missing.length} 步。`
            : `已记录 ${steps.length} 步，其中 ${validCount} 步有效。${missing.length} 步待完成。`,
        socratic_hint: template.socraticHints[0] ?? '',
        steps: verifiedSteps,
        missing_steps: missing,
        available_theorems: [],
      }
    }

    if (theoremName && steps.length === 0) {
      const template = PROOF_TEMPLATES[theoremName]
      return {
        theorem_name: theoremName,
        is_complete: false,
        progress: `0/${template.expectedSteps.length}`,
        overall_feedback:
          `你想证明「${template.description}」。\n` +
          `已知：${template.given.join(', ')}\n` +
          `求证：${template.toProve}\n\n` +
          `请写出你的证明步骤，每一步包含论断和理由。`,
        socratic_hint: template.socraticHints[0] ?? '',
        steps: [],
        missing_steps: template.expectedSteps,
        available_theorems: [],
      }
    }

    // No theorem matched — show theorems available
    const available = Object.entries(PROOF_TEMPLATES).map(([name, t]) => ({
      name,
      description: t.description,
      given: t.given,
      to_prove: t.toProve,
      num_expected_steps: t.expectedSteps.length,
    }))
    return {
      theorem_name: null,
      is_complete: false,
      progress: '0/0',
      overall_feedback: '我可以帮你验证以下定理的证明：',
      available_theorems: available,
      steps: [],
      missing_steps: [],
      socratic_hint: '选择一个定理，写出你的证明步骤。',
    }
  }

  /** Detect which theorem the student is trying to prove. */
  private detectTheorem(text: string): string | null {
    const textLower = text.toLowerCase()
    const theoremMap: Record<string, string[]> = {
      identity_unique: ['单位元唯一', 'identity unique', 'identity is unique', '唯一单位元'],
      inverse_unique: ['逆元唯一', 'inverse unique', '逆元唯一性', '唯一逆元'],
      cancellation_law: ['消去律', 'cancellation', '消去'],
      trivial_subgroup: ['平凡子群', 'trivial subgroup', '{e}是子群', '{e} 是子群'],
      abelian_subgroup_of_squares: ['平方子群', 'squares', '{g²}', '交换群的平方'],
    }
    for (const [name, keywords] of Object.entries(theoremMap)) {
      if (keywords.some(kw => textLower.includes(kw.toLowerCase()))) {
        return name
      }
    }
    return null
  }

  /** Parse proof steps from natural language text. */
  private parseProofSteps(text: string): Array<{ claim: string; justification: string }> {
    const steps: Array<{ claim: string; justification: string }> = []

    // Pattern 1: 第X步：claim
    const re1 = new RegExp(
      '第[一二三四五六七八九十\\d]+步[：:]\\s*(.*?)(?=第[一二三四五六七八九十\\d]+步[：:]|$)',
      'gs',
    )
    let matches = text.match(re1)
    if (matches) {
      for (const m of matches) {
        steps.push(this.splitClaimJustification(m.trim()))
      }
      return steps
    }

    // Pattern 2: Step N: claim
    const re2 = new RegExp('Step\\s*\\d+[：:]\\s*(.*?)(?=Step\\s*\\d+[：:]|$)', 'gsi')
    matches = text.match(re2)
    if (matches) {
      for (const m of matches) {
        steps.push(this.splitClaimJustification(m.trim()))
      }
      return steps
    }

    // Pattern 3: N. claim  or  N、 claim
    const re3 = new RegExp('(?:^|\\n)\\s*(\\d+)[.、]\\s*(.*?)(?=\\n\\s*\\d+[.、]|$)', 'gs')
    const found3 = text.match(re3)
    if (found3 && found3.length >= 2) {
      for (const m of found3) {
        // strip leading number
        const cleaned = m.replace(/(?:^|\n)\s*\d+[.、]\s*/, '').trim()
        if (cleaned) steps.push(this.splitClaimJustification(cleaned))
      }
      return steps
    }

    return steps
  }

  private splitClaimJustification(text: string): { claim: string; justification: string } {
    const seps = ['因为', '（', '(', 'since', 'because']
    for (const sep of seps) {
      if (text.includes(sep)) {
        const idx = text.indexOf(sep)
        const claim = text.slice(0, idx).trim()
        const just = text
          .slice(idx + sep.length)
          .trim()
          .replace(/[)）]+$/, '')
          .trim()
        return { claim, justification: just }
      }
    }
    if (text.includes('，')) {
      const idx = text.indexOf('，')
      return { claim: text.slice(0, idx).trim(), justification: text.slice(idx + 1).trim() }
    }
    return { claim: text, justification: '' }
  }

  // -- LLM Orchestration Helpers --

  private async decomposeTask(
    llm: LLMClient,
    studentInput: string,
  ): Promise<Record<string, unknown>> {
    const resp = await llm.chat(
      '一位学生刚刚写下了他的数学笔记。作为课程设计者，' +
        '你需要判断这个问题需要从哪些角度来回应。\n' +
        '可用的视角：\n' +
        '  perception —— 辨认学生在做什么\n' +
        '  abstraction —— 提炼数学结构\n' +
        '  counter_example —— 用暴力枚举做形式化验证\n' +
        '  epistemic —— 诊断学生的认知状态\n' +
        '  historical —— 连接数学史\n' +
        '  collaboration —— 综合苏格拉底式回应\n\n' +
        '并非每个问题都需要全部视角。想想：这个学生此刻最需要什么？\n' +
        '用 [CALL:视角名] 标注每个需要的步骤，以 [DELIVER] 结束。',
      `学生写下了：${studentInput}\n\n这个回答需要哪些视角？`,
    )

    const calls = Array.from(resp.content.matchAll(/\[CALL:(\w+)\]/g)).map(m => m[1])
    let finalCalls = calls
    if (finalCalls.length === 0) {
      // Fallback: infer from input type
      if (studentInput.includes('[[')) {
        finalCalls = ['perception', 'abstraction', 'counter_example', 'epistemic']
      } else if (studentInput.includes('历史')) {
        finalCalls = ['perception', 'historical']
      } else {
        finalCalls = ['perception', 'abstraction', 'epistemic']
      }
    }

    return {
      student_input: studentInput,
      steps: finalCalls.map(name => ({
        agent: name,
        reason: `LLM decided: needed for ${name}`,
        optional: name === 'historical',
      })),
    }
  }

  private systemPrompt(): string {
    const agentLines: Record<string, string> = {
      perception: '辨认学生在做什么',
      abstraction: '提炼数学结构',
      counter_example: '用暴力枚举做形式化验证',
      epistemic: '感知学生的认知状态',
      historical: '连接数学史脉络',
      collaboration: '综合苏格拉底式回应',
    }
    const active = this.topology.agents
      .filter(name => name in this.agents)
      .map(name => `- ${name}: ${agentLines[name] ?? '未知'}`)
      .join('\n')
    return (
      '你是一位指挥，面前有几位各有所长的乐手。\n' +
      '学生抛出了一个数学问题，你需要决定让谁先回应。\n\n' +
      `在场的乐手：\n${active}\n\n` +
      '听完一位乐手的演奏后，判断是否需要其他视角补充，还是已经可以交付回应。\n' +
      '用 [CALL:agent_name] 召唤下一位，用 [DELIVER] 表示可以交付。'
    )
  }

  /**
   * Build the input message for the LLM to decide next action.
   * NOTE: uses "学生输入:" and "已执行:" labels so the MockLLMClient can parse
   * the student input and the set of already-called agents.
   */
  private buildLlmInput(
    studentInput: string,
    priorResults: Record<string, Record<string, unknown>>,
    calledAgents: Set<string>,
    availableAgents: Record<string, unknown>,
  ): string {
    const parts: string[] = []
    parts.push(`学生输入: ${studentInput.slice(0, 500)}`)
    const calledStr = [...calledAgents].sort().join(',') || '无'
    parts.push(`已执行: ${calledStr}`)

    for (const [name, result] of Object.entries(priorResults)) {
      const content = ((result['content'] as string) ?? '').slice(0, 200)
      parts.push(`[${name}]: ${content}`)
    }

    parts.push(`可以召唤: ${Object.keys(availableAgents).join(', ')}`)
    parts.push('下一位该是谁？')
    return parts.join('\n')
  }

  private agentToPhase(agentName: string): SessionPhase {
    const mapping: Record<string, SessionPhase> = {
      perception: SessionPhase.PERCEIVE,
      abstraction: SessionPhase.ABSTRACT,
      counter_example: SessionPhase.VERIFY,
      epistemic: SessionPhase.DIAGNOSE,
      historical: SessionPhase.REFLECT,
      collaboration: SessionPhase.COLLABORATE,
      meta: SessionPhase.REFLECT,
    }
    return mapping[agentName] ?? SessionPhase.IDLE
  }

  // -- Metrics --

  /** Return session metrics for observability. */
  getMetrics(): Record<string, unknown> {
    const agentCallCounts: Record<string, number> = {}
    for (const msg of this.messageHistory) {
      const role = msg.role as string
      agentCallCounts[role] = (agentCallCounts[role] ?? 0) + 1
    }

    const sessionDurationMs = this.sessionStart ? Date.now() - this.sessionStart.getTime() : 0

    return {
      session_start: this.sessionStart?.toISOString() ?? null,
      session_duration_ms: sessionDurationMs,
      total_messages: this.messageHistory.length,
      agent_call_counts: agentCallCounts,
      current_phase: this.phase,
      curriculum_level: this.curriculumLevel,
      dag_node_count: this.dag.getNodeCount(),
      profile: this.profile
        ? {
            student_id: this.profile.student_id,
            total_interactions: this.profile.total_interactions,
            total_sessions: this.profile.total_sessions,
            mastered_concepts: Object.keys(this.profile.dag_mastery).length,
          }
        : null,
      four_fields: snapshotFourField(this.state),
      grill_active: this.grillSession !== null && this.grillSession.active,
      llm_configured: this.llmClient !== null,
    }
  }

  // -- Theorem Listing --

  /** List available proof theorems for a given curriculum level. */
  getTheorems(level?: string): Record<string, unknown> {
    const _level = level ?? this.curriculumLevel

    const theorems = Object.entries(PROOF_TEMPLATES).map(([id, template]) => ({
      id,
      name: template.description,
      statement: template.toProve,
      given: template.given,
      expected_step_count: template.expectedSteps.length,
      level: _level,
    }))

    return {
      level: _level,
      theorems,
      count: theorems.length,
    }
  }

  // -- Proof Submission --

  /** Submit and verify a student's proof for a given theorem. */
  submitProof(
    theoremId: string,
    studentSteps: string[],
    curriculumLevel?: string,
  ): Record<string, unknown> {
    const _level = curriculumLevel ?? this.curriculumLevel
    const template = PROOF_TEMPLATES[theoremId]

    if (!template) {
      return {
        theorem_id: theoremId,
        is_valid: false,
        headline: `未找到定理「${theoremId}」`,
        detail: '请从可用定理列表中选择。',
        available_theorems: Object.keys(PROOF_TEMPLATES),
      }
    }

    const expectedSteps = template.expectedSteps
    const verifiedSteps = studentSteps.map((step, idx) => {
      const expected = idx < expectedSteps.length ? expectedSteps[idx] : ''
      const isValid = step.trim().length > 0
      return {
        step_number: idx + 1,
        student_step: step,
        expected_step: expected,
        is_valid: isValid,
        feedback: isValid ? '步骤已记录。' : '步骤内容为空，请补充。',
        matched_expected: idx < expectedSteps.length && step.includes(expected.slice(0, 10)),
      }
    })

    const completedSteps = verifiedSteps.filter(s => s.is_valid).length
    const isComplete = completedSteps >= expectedSteps.length
    const missingSteps = expectedSteps.slice(studentSteps.length)

    return {
      theorem_id: theoremId,
      theorem_name: template.description,
      level: _level,
      is_complete: isComplete,
      is_valid: true,
      progress: `${completedSteps}/${expectedSteps.length}`,
      headline: isComplete
        ? '证明步骤完整！'
        : `已记录 ${completedSteps} 步，还需要 ${missingSteps.length} 步。`,
      given: template.given,
      to_prove: template.toProve,
      steps: verifiedSteps,
      missing_steps: missingSteps,
      socratic_hint: template.socraticHints[0] ?? '',
      overall_feedback: isComplete
        ? '你的证明已经完整。试着回顾每一步的依据，确保逻辑链条严密。'
        : '继续补充剩余步骤。每一步都应有明确的论断和理由。',
    }
  }
}
