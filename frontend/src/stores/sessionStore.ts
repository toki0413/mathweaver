import { create } from 'zustand'

interface ChatMessage {
  role: 'user' | 'system'
  content: string
  phase?: string
}

interface FourFields {
  knowledge: {
    current_node_id: string | null
    mastery_estimate: number
    zpd_lower: number
    zpd_upper: number
    prerequisite_gaps: string[]
    in_zpd: boolean
    ready_to_advance: boolean
  }
  cognitive: {
    response_time_ms: number
    rt_zscore: number
    cognitive_load: number
    state: string
    is_overloaded: boolean
  }
  emotional: {
    anxiety_index: number
    flow_score: number
    state: string
    is_anxious: boolean
    in_flow: boolean
  }
  interaction: {
    current_hint_level: number
    consecutive_correct: number
    scaffold_fade_threshold: number
    should_fade_scaffold: boolean
    is_struggling: boolean
  }
}

// ---------------------------------------------------------------------------
// Grill types (mirror backend GrillSession / GrillQuestion / AdaptiveDifficulty)
// ---------------------------------------------------------------------------

interface GrillQuestion {
  qid: string
  concept_node_id: string
  concept_name: string
  question: string
  recommended_answer: string
  difficulty: number
  branch_type: string
}

interface GrillBranch {
  concept_node_id: string
  concept_name: string
  status: string
  student_answer: string
  question: GrillQuestion | null
  children: string[]
}

interface AdaptiveDifficulty {
  current_difficulty: number
  difficulty_band: string
  target_difficulty: number
  accuracy_rate: number
  streak_correct: number
  streak_wrong: number
  total_questions: number
  total_correct: number
  trend: string
  should_increase: boolean
  should_decrease: boolean
}

interface GrillSummary {
  active: boolean
  total_branches: number
  resolved_branches: number
  correct_answers: number
  progress: string
  adaptive: AdaptiveDifficulty
  encouragement: Record<string, unknown>
  branches: Record<string, GrillBranch>
}

interface GrillState {
  active: boolean
  currentQuestion: GrillQuestion | null
  difficulty: number
  questionsAsked: number
  encouragement: string
  summary: GrillSummary | null
}

// ---------------------------------------------------------------------------
// Proof types (mirror backend ProofResult / ProofStep / ProofTemplate)
// ---------------------------------------------------------------------------

interface ProofStepResult {
  step_number: number
  claim: string
  justification: string
  is_valid: boolean
  feedback: string
  matched_expected: string
  implicit_steps: string[]
}

interface ProofResult {
  theorem_name: string
  steps: ProofStepResult[]
  is_complete: boolean
  missing_steps: string[]
  socratic_hint: string
  overall_feedback: string
  progress: string
}

interface ProofState {
  theorems: string[]
  currentResult: ProofResult | null
  selectedTheorem: string | null
}

// ---------------------------------------------------------------------------
// Session store interface
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string | null
  targetNode: string | null
  phase: string
  fourFields: FourFields | null
  chat: ChatMessage[]
  loading: boolean
  phaseTrace: string[]
  decision: { action: string; reason: string } | null
  visualData: Record<string, any> | null

  // Grill state
  grillState: GrillState

  // Proof state
  proofState: ProofState

  startSession: (studentId: string, targetNode: string) => Promise<void>
  sendInput: (input: string, responseTimeMs: number) => Promise<void>
  clearChat: () => void

  // Grill actions
  startGrill: (studentId: string, curriculumLevel?: string) => Promise<void>
  submitGrillAnswer: (qid: string, answer: string, responseTimeMs?: number) => Promise<void>

  // Proof actions
  fetchTheorems: (level?: string) => Promise<void>
  submitProof: (theoremId: string, studentSteps: string[], curriculumLevel?: string) => Promise<void>
  setSelectedTheorem: (theoremId: string | null) => void
}

// Base URL for the backend API. Defaults to "" (relative) so requests are
// served through the Vite dev proxy in development and the nginx reverse proxy
// in the Docker image. Override at build time with VITE_API_URL if needed.
export const API_BASE = import.meta.env.VITE_API_URL || ''

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the currently-active (status "asked") question from a grill summary. */
function extractCurrentQuestion(summary: GrillSummary | null): GrillQuestion | null {
  if (!summary || !summary.branches) return null
  for (const branch of Object.values(summary.branches)) {
    if (branch.status === 'asked' && branch.question) {
      return branch.question
    }
  }
  return null
}

/** Derive a short encouragement string from adaptive difficulty data. */
function deriveEncouragement(summary: GrillSummary | null): string {
  if (!summary || !summary.adaptive) return ''
  const a = summary.adaptive
  if (a.streak_correct >= 5) return '五连对！你已经掌握了核心概念。'
  if (a.streak_correct >= 3) return '三连对！你的数学直觉在变强。'
  if (a.streak_wrong >= 2) return '还没有到，但这正是学习发生的时刻。'
  if (a.total_questions > 0 && a.accuracy_rate >= 0.7) return '保持节奏，状态很好！'
  if (a.total_questions > 0 && a.accuracy_rate < 0.4) return '别灰心，每一步都在积累。'
  return '继续加油！'
}

const initialGrillState: GrillState = {
  active: false,
  currentQuestion: null,
  difficulty: 0.4,
  questionsAsked: 0,
  encouragement: '',
  summary: null,
}

const initialProofState: ProofState = {
  theorems: [],
  currentResult: null,
  selectedTheorem: null,
}

export const useStore = create<SessionState>((set, get) => ({
  sessionId: null,
  targetNode: null,
  phase: 'idle',
  fourFields: null,
  chat: [],
  loading: false,
  phaseTrace: [],
  decision: null,
  visualData: null,

  grillState: initialGrillState,
  proofState: initialProofState,

  startSession: async (studentId: string, targetNode: string) => {
    set({ loading: true })
    try {
      const res = await fetch(`${API_BASE}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, target_node_id: targetNode }),
      })
      const data = await res.json()
      set({
        sessionId: data.session_id,
        targetNode: data.target_node,
        phase: data.phase,
        loading: false,
        chat: [{
          role: 'system',
          content: `学习目标: ${data.node_name}\n${data.node_description}\n\n学习路径: ${data.learning_path?.map((n: any) => n.name).join(' → ') || '直接开始'}`,
          phase: 'session_start',
        }],
      })
    } catch (e) {
      set({ loading: false })
      console.error('Failed to start session:', e)
    }
  },

  sendInput: async (input: string, responseTimeMs: number) => {
    set((state) => ({
      chat: [...state.chat, { role: 'user', content: input }],
      loading: true,
    }))

    try {
      const res = await fetch(`${API_BASE}/api/session/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_input: input, response_time_ms: responseTimeMs }),
      })
      const data = await res.json()

      set((state) => ({
        chat: [...state.chat, {
          role: 'system',
          content: data.response?.content || '',
          phase: data.response?.action,
        }],
        phase: data.phase || 'idle',
        fourFields: data.four_fields,
        phaseTrace: data.phase_trace || [],
        decision: data.decision,
        visualData: data.visual || null,
        loading: false,
      }))
    } catch (e) {
      set({ loading: false })
      console.error('Failed to send input:', e)
    }
  },

  clearChat: () => set({ chat: [] }),

  // --- Grill actions ---

  startGrill: async (studentId: string, curriculumLevel?: string) => {
    set({ loading: true })
    try {
      const res = await fetch(`${API_BASE}/api/grill/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, curriculum_level: curriculumLevel }),
      })
      const data = await res.json()
      const summary: GrillSummary | null = data.grill_summary || null
      const currentQuestion = extractCurrentQuestion(summary)
      const adaptive = summary?.adaptive
      set({
        grillState: {
          active: data.grill_mode || false,
          currentQuestion,
          difficulty: adaptive?.current_difficulty ?? 0.4,
          questionsAsked: adaptive?.total_questions ?? 0,
          encouragement: data.response || deriveEncouragement(summary),
          summary,
        },
        loading: false,
      })
    } catch (e) {
      set({ loading: false })
      console.error('Failed to start grill:', e)
    }
  },

  submitGrillAnswer: async (qid: string, answer: string, responseTimeMs?: number) => {
    set({ loading: true })
    try {
      const res = await fetch(`${API_BASE}/api/grill/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qid,
          answer,
          response_time_ms: responseTimeMs ?? 5000,
        }),
      })
      const data = await res.json()
      const summary: GrillSummary | null = data.grill_summary || null
      const currentQuestion = extractCurrentQuestion(summary)
      const adaptive = summary?.adaptive
      set({
        grillState: {
          active: data.grill_mode || false,
          currentQuestion,
          difficulty: adaptive?.current_difficulty ?? 0.4,
          questionsAsked: adaptive?.total_questions ?? 0,
          encouragement: data.response || deriveEncouragement(summary),
          summary,
        },
        loading: false,
      })
    } catch (e) {
      set({ loading: false })
      console.error('Failed to submit grill answer:', e)
    }
  },

  // --- Proof actions ---

  fetchTheorems: async (level?: string) => {
    try {
      const url = `${API_BASE}/api/proof/theorems${level ? `?level=${encodeURIComponent(level)}` : ''}`
      const res = await fetch(url)
      const data = await res.json()
      set((state) => ({
        proofState: {
          ...state.proofState,
          theorems: data.theorems || [],
        },
      }))
    } catch (e) {
      console.error('Failed to fetch theorems:', e)
    }
  },

  submitProof: async (theoremId: string, studentSteps: string[], curriculumLevel?: string) => {
    set({ loading: true })
    try {
      const res = await fetch(`${API_BASE}/api/proof/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theorem_id: theoremId,
          student_steps: studentSteps,
          curriculum_level: curriculumLevel,
        }),
      })
      const data = await res.json()
      set((state) => ({
        proofState: {
          ...state.proofState,
          currentResult: data,
          selectedTheorem: theoremId,
        },
        loading: false,
      }))
    } catch (e) {
      set({ loading: false })
      console.error('Failed to submit proof:', e)
    }
  },

  setSelectedTheorem: (theoremId: string | null) => {
    set((state) => ({
      proofState: {
        ...state.proofState,
        selectedTheorem: theoremId,
      },
    }))
  },
}))
