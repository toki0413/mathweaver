/**
 * Core domain models for MathWeaver TypeScript backend.
 *
 * Ported from Python backend (backend/mathweaver/models/state.py)
 * These types define the four-field coupling state, agent messages,
 * concept DAG nodes, and student profiles.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum FieldType {
  KNOWLEDGE = 'knowledge',
  COGNITIVE = 'cognitive',
  EMOTIONAL = 'emotional',
  INTERACTION = 'interaction',
}

export enum AgentRole {
  PERCEPTION = 'perception',
  ABSTRACTION = 'abstraction',
  COUNTER_EXAMPLE = 'counter_example',
  EPISTEMIC = 'epistemic',
  HISTORICAL = 'historical',
  COLLABORATION = 'collaboration',
  META = 'meta',
}

export enum CognitiveState {
  OPTIMAL = 'optimal',
  OVERLOAD = 'overload',
  BOREDOM = 'boredom',
  FATIGUE = 'fatigue',
}

export enum EmotionalState {
  FLOW = 'flow',
  ENGAGED = 'engaged',
  ANXIOUS = 'anxious',
  FRUSTRATED = 'frustrated',
  NEUTRAL = 'neutral',
}

export enum SessionPhase {
  IDLE = 'idle',
  PERCEIVE = 'perceive',
  ABSTRACT = 'abstract',
  VERIFY = 'verify',
  DIAGNOSE = 'diagnose',
  REFLECT = 'reflect',
  COLLABORATE = 'collaborate',
  DELIVER = 'deliver',
}

// ---------------------------------------------------------------------------
// Four-Field State
// ---------------------------------------------------------------------------

export interface KnowledgeField {
  current_node_id: string | null
  mastery_estimate: number
  zpd_lower: number
  zpd_upper: number
  prerequisite_gaps: string[]
  misconception_rate: number
}

export function defaultKnowledgeField(): KnowledgeField {
  return {
    current_node_id: null,
    mastery_estimate: 0.0,
    zpd_lower: 0.4,
    zpd_upper: 0.6,
    prerequisite_gaps: [],
    misconception_rate: 0.0,
  }
}

export function isKnowledgeInZPD(f: KnowledgeField): boolean {
  return f.zpd_lower <= f.mastery_estimate && f.mastery_estimate <= f.zpd_upper
}

export function isKnowledgeReadyToAdvance(f: KnowledgeField): boolean {
  return f.mastery_estimate > f.zpd_upper && f.prerequisite_gaps.length === 0
}

export interface CognitiveField {
  response_time_ms: number
  baseline_rt_ms: number
  rt_zscore: number
  backtrack_count: number
  trial_sequence_length: number
  state: CognitiveState
  cognitive_load: number
}

export function defaultCognitiveField(): CognitiveField {
  return {
    response_time_ms: 0.0,
    baseline_rt_ms: 5000.0,
    rt_zscore: 0.0,
    backtrack_count: 0,
    trial_sequence_length: 0,
    state: CognitiveState.OPTIMAL,
    cognitive_load: 0.5,
  }
}

export function updateCognitiveRT(f: CognitiveField, rt_ms: number): void {
  f.response_time_ms = rt_ms
  f.rt_zscore = (rt_ms - f.baseline_rt_ms) / Math.max(f.baseline_rt_ms * 0.3, 1.0)
}

export function isCognitiveOverloaded(f: CognitiveField): boolean {
  return f.rt_zscore > 1.5 || f.cognitive_load > 0.85
}

export interface EmotionalField {
  anxiety_index: number
  flow_score: number
  skip_rate: number
  pause_after_counterexample: boolean
  state: EmotionalState
}

export function defaultEmotionalField(): EmotionalField {
  return {
    anxiety_index: 0.3,
    flow_score: 0.5,
    skip_rate: 0.0,
    pause_after_counterexample: false,
    state: EmotionalState.NEUTRAL,
  }
}

export function isEmotionalAnxious(f: EmotionalField): boolean {
  return f.anxiety_index > 0.65
}

export function isEmotionalInFlow(f: EmotionalField): boolean {
  return f.flow_score > 0.75 && f.anxiety_index < 0.4
}

export interface InteractionField {
  current_hint_level: number
  consecutive_correct: number
  struggle_duration_s: number
  scaffold_fade_threshold: number
  hint_dependency: number
}

export function defaultInteractionField(): InteractionField {
  return {
    current_hint_level: 0,
    consecutive_correct: 0,
    struggle_duration_s: 0.0,
    scaffold_fade_threshold: 3,
    hint_dependency: 0.0,
  }
}

export function shouldFadeScaffold(f: InteractionField): boolean {
  return f.consecutive_correct >= f.scaffold_fade_threshold
}

export function isInteractionStruggling(f: InteractionField): boolean {
  return f.struggle_duration_s > 10.0 && f.struggle_duration_s < 120.0
}

export interface FourFieldState {
  knowledge: KnowledgeField
  cognitive: CognitiveField
  emotional: EmotionalField
  interaction: InteractionField
  updated_at: string
}

export function defaultFourFieldState(): FourFieldState {
  return {
    knowledge: defaultKnowledgeField(),
    cognitive: defaultCognitiveField(),
    emotional: defaultEmotionalField(),
    interaction: defaultInteractionField(),
    updated_at: new Date().toISOString(),
  }
}

export function snapshotFourField(state: FourFieldState): Record<string, unknown> {
  return {
    knowledge: { ...state.knowledge },
    cognitive: { ...state.cognitive },
    emotional: { ...state.emotional },
    interaction: { ...state.interaction },
    updated_at: state.updated_at,
  }
}

// ---------------------------------------------------------------------------
// Agent Message
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: AgentRole
  content: string
  field_updates: Record<string, Record<string, unknown>>
  tool_calls: Record<string, unknown>[]
  confidence: number
  metadata: Record<string, unknown>
}

export function createAgentMessage(
  role: AgentRole,
  content: string,
  opts: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    role,
    content,
    field_updates: opts.field_updates ?? {},
    tool_calls: opts.tool_calls ?? [],
    confidence: opts.confidence ?? 1.0,
    metadata: opts.metadata ?? {},
  }
}

// ---------------------------------------------------------------------------
// Concept DAG
// ---------------------------------------------------------------------------

export interface ConceptNode {
  id: string
  name: string
  description: string
  prerequisites: string[]
  abstraction_level: number
  domain: string
  difficulty: number
  is_milestone: boolean
  learning_objectives: string[]
  examples: string[]
  assessment_criteria: string[]
  estimated_minutes: number
  historical_context: string
  related_theorems: string[]
  common_misconceptions: string[]
}

// ---------------------------------------------------------------------------
// Student Profile
// ---------------------------------------------------------------------------

export interface StudentProfile {
  student_id: string
  name: string
  dag_mastery: Record<string, number>
  learning_style: string
  total_sessions: number
  total_interactions: number
  key_events: Record<string, unknown>[]
}

export function defaultStudentProfile(studentId: string): StudentProfile {
  return {
    student_id: studentId,
    name: '',
    dag_mastery: {},
    learning_style: 'balanced',
    total_sessions: 0,
    total_interactions: 0,
    key_events: [],
  }
}

export function getMastery(profile: StudentProfile, nodeId: string): number {
  return profile.dag_mastery[nodeId] ?? 0.0
}

export function updateMastery(profile: StudentProfile, nodeId: string, delta: number): void {
  const current = getMastery(profile, nodeId)
  profile.dag_mastery[nodeId] = Math.max(0.0, Math.min(1.0, current + delta))
}

// ---------------------------------------------------------------------------
// Agent Context (read-only)
// ---------------------------------------------------------------------------

export interface AgentContext {
  student_input: string
  four_field_state: FourFieldState
  prior_results: Record<string, Record<string, unknown>>
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Teaching Decision
// ---------------------------------------------------------------------------

export interface TeachingDecision {
  action: string
  reason: string
  field_signals: Record<string, unknown>
  hint_level: number
  next_phase: SessionPhase
}

// ---------------------------------------------------------------------------
// LLM Configuration
// ---------------------------------------------------------------------------

export interface LLMConfig {
  /** Provider type: 'mock' | 'openai_compatible' | 'ollama' */
  provider: 'mock' | 'openai_compatible' | 'ollama'
  /** Frontend provider type for adapter routing (web mode) */
  providerType?: string
  /** API key for cloud providers */
  apiKey: string
  /** Base URL for API calls (e.g. https://api.deepseek.com/v1) */
  baseUrl: string
  /** Model name (e.g. deepseek-chat, gpt-4o, qwen2.5:7b) */
  model: string
  /** Temperature for response generation */
  temperature: number
  /** Max tokens for response */
  maxTokens: number
}

export function defaultLLMConfig(): LLMConfig {
  return {
    provider: 'mock',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxTokens: 2048,
  }
}

// ---------------------------------------------------------------------------
// API Response Types (for IPC)
// ---------------------------------------------------------------------------

export interface StartSessionRequest {
  student_id: string
  student_name?: string
  target_node_id?: string
}

export interface StudentInputRequest {
  student_input: string
  response_time_ms?: number
}

export interface CayleyTableRequest {
  table: number[][]
}

export interface ProofSubmitRequest {
  theorem_id: string
  student_steps: string[]
  curriculum_level?: string
}

export interface GrillStartRequest {
  student_id?: string
  curriculum_level?: string
}

export interface GrillAnswerRequest {
  qid: string
  answer: string
  is_correct?: boolean
  response_time_ms?: number
}

export interface StructuredError {
  headline: string
  detail?: string
  recovery?: {
    suggestion: string
    available_options?: string[]
    endpoint?: string
  }
}
