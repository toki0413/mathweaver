import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface SessionData {
  studentId: string
  targetNode: string
  chat: ChatMessage[]
  fourFields: FourFields | null
  phaseTrace: string[]
  savedAt: string
}

interface DagNodeInfo {
  id: string
  name: string
  description: string
  prerequisites: string[]
  abstraction_level: number
  difficulty: number
  is_milestone: boolean
}

interface LLMPreset {
  id: string
  label: string
  provider: string
  baseUrl: string
  defaultModel: string
  requiresApiKey: boolean
  helpUrl: string
  description: string
}

interface LLMConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
}

interface GrillQuestion {
  qid: string
  concept_node_id: string
  concept_name: string
  question: string
  recommended_answer: string
  difficulty: number
  branch_type: string
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
  branches: Record<string, unknown>
}

interface GrillState {
  active: boolean
  currentQuestion: GrillQuestion | null
  difficulty: number
  questionsAsked: number
  encouragement: string
  summary: GrillSummary | null
}

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

interface ConjectureRecord {
  claim: string
  verdict: 'confirmed' | 'refuted' | 'undecidable'
  counter_example: string | null
  timestamp: string
}

interface ConjectureState {
  entries: ConjectureRecord[]
  loading: boolean
  error: string | null
}

interface DynamicContentState {
  loading: boolean
  exercises: Record<string, unknown>[]
  stories: Record<string, unknown>[]
  challenges: Record<string, unknown>[]
  lastGenerated: number | null
}

interface VisualData {
  dag_progress?: Record<string, unknown>
  four_field_gauges?: {
    cognitive_load: number
    cognitive_state: string
    anxiety_index: number
    flow_score: number
    hint_dependency: number
  }
  mastery_radar?: {
    accuracy: number
    conjecture: number
    independence: number
    fluency: number
    abstraction: number
    overall: number
  }
  conjecture_journey?: {
    timeline: Array<{
      step: number
      claim: string
      verdict: 'confirmed' | 'refuted' | 'undecidable'
      counter_example?: string | null
      is_refinement?: boolean
    }>
    refinement_chains: Array<{ steps: number[]; claim: string }>
    total_conjectures: number
    confirmed: number
    refuted: number
  }
  difficulty_gauge?: {
    current_difficulty: number
    difficulty_band: string
    trend: string
    accuracy_rate: number
  }
  [key: string]: unknown
}

interface ErrorState {
  message: string
  headline: string
  detail?: string
  recovery?: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// API helper — uses IPC (no HTTP)
// ---------------------------------------------------------------------------

function getAPI(): MathWeaverAPI {
  return (window as unknown as { api: MathWeaverAPI }).api
}

// ---------------------------------------------------------------------------
// Session Store
// ---------------------------------------------------------------------------

interface SessionState {
  // Session core
  sessionId: string | null
  targetNode: string | null
  phase: string
  fourFields: FourFields | null
  chat: ChatMessage[]
  loading: boolean
  phaseTrace: string[]
  decision: { action: string; reason: string } | null
  visualData: VisualData | null
  backendReady: boolean
  dagNodes: DagNodeInfo[]

  // Grill
  grillState: GrillState

  // Proof
  proofState: ProofState

  // Conjecture
  conjectureState: ConjectureState

  // Error
  error: ErrorState | null

  // LLM
  llmConfig: LLMConfig | null
  llmPresets: LLMPreset[]

  // Onboarding
  onboardingCompleted: boolean

  // Dynamic Content
  dynamicContent: DynamicContentState

  // Actions
  startSession: (studentId: string, targetNode: string) => Promise<void>
  sendInput: (input: string, responseTimeMs: number) => Promise<void>
  clearChat: () => void
  checkBackend: () => Promise<void>
  fetchDagNodes: () => Promise<void>
  saveSession: () => Promise<string | null>
  loadSession: () => Promise<boolean>

  // Grill actions
  startGrill: (studentId?: string, curriculumLevel?: string) => Promise<void>
  submitGrillAnswer: (qid: string, answer: string, responseTimeMs?: number) => Promise<void>

  // Proof actions
  fetchTheorems: (level?: string) => Promise<void>
  submitProof: (theoremId: string, steps: string[], level?: string) => Promise<void>
  setSelectedTheorem: (theoremId: string | null) => void

  // Conjecture actions
  submitConjecture: (claim: string, nodeId?: string) => Promise<void>

  // LLM actions
  fetchLLMConfig: () => Promise<void>
  saveLLMConfig: (config: Partial<LLMConfig>) => Promise<void>
  fetchLLMPresets: () => Promise<void>

  // Onboarding
  checkOnboarding: () => Promise<void>
  completeOnboarding: () => Promise<void>

  // Dynamic content
  generateContent: (req: {
    type: 'exercise' | 'story' | 'challenge'
    topic: string
    ageLevel: 'kids' | 'tweens' | 'teens'
    difficulty: number
    currentTable?: number[][]
    context?: string
  }) => Promise<void>

  // Error
  clearError: () => void
  setError: (headline: string, detail?: string, recovery?: string) => void
}

// ---------------------------------------------------------------------------
// Persisted slice (Task 2a) — only these fields are written to localStorage
// ---------------------------------------------------------------------------

interface PersistedSessionState {
  sessionId: string | null
  targetNode: string | null
  phase: string
  chat: ChatMessage[]
  phaseTrace: string[]
  grillState: GrillState
  proofState: ProofState
  conjectureState: ConjectureState
}

export const useStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessionId: null,
      targetNode: null,
      phase: 'idle',
      fourFields: null,
      chat: [],
      loading: false,
      phaseTrace: [],
      decision: null,
      visualData: null,
      backendReady: false,
      dagNodes: [],

      grillState: {
        active: false,
        currentQuestion: null,
        difficulty: 0.5,
        questionsAsked: 0,
        encouragement: '',
        summary: null,
      },

      proofState: {
        theorems: [],
        currentResult: null,
        selectedTheorem: null,
      },

      conjectureState: {
        entries: [],
        loading: false,
        error: null,
      },

      error: null,

      llmConfig: null,
      llmPresets: [],

      onboardingCompleted: false,

      dynamicContent: {
        loading: false,
        exercises: [],
        stories: [],
        challenges: [],
        lastGenerated: null,
      },

      // -------------------------------------------------------------------------
      // Backend health
      // -------------------------------------------------------------------------

      checkBackend: async () => {
        try {
          const api = getAPI()
          if (!api) return
          const result = await api.health()
          set({ backendReady: result != null })
        } catch (e) {
          console.error('Backend health check failed:', e)
          set({ backendReady: false })
        }
      },

      // -------------------------------------------------------------------------
      // DAG
      // -------------------------------------------------------------------------

      fetchDagNodes: async () => {
        try {
          const api = getAPI()
          if (!api) return
          const data = (await api.getDag()) as Record<string, unknown> | null
          if (data && typeof data === 'object' && 'nodes' in data) {
            set({ dagNodes: (data.nodes as DagNodeInfo[]) || [] })
          }
        } catch (e) {
          console.error('Failed to fetch DAG nodes:', e)
          set({
            error: {
              message: '概念图谱加载失败',
              headline: '无法加载概念图谱',
              detail: String(e),
              recovery: '请检查应用是否正常启动，或重启应用',
              timestamp: Date.now(),
            },
          })
        }
      },

      // -------------------------------------------------------------------------
      // Session
      // -------------------------------------------------------------------------

      startSession: async (studentId: string, targetNode: string) => {
        set({ loading: true, error: null })
        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.startSession({
            student_id: studentId,
            target_node_id: targetNode,
          })) as Record<string, unknown> | null

          if (!data) throw new Error('No response from backend')

          set({
            sessionId: (data.session_id as string) || null,
            targetNode: (data.target_node as string) || targetNode,
            phase: (data.phase as string) || 'idle',
            loading: false,
            chat: [
              {
                role: 'system',
                content: `学习目标: ${data.node_name || targetNode}\n${data.node_description || ''}\n\n学习路径: ${((data.learning_path as Array<{ name: string }>) || []).map(n => n.name).join(' → ') || '直接开始'}`,
                phase: 'session_start',
              },
            ],
          })
        } catch (e) {
          set({
            loading: false,
            error: {
              message: 'Session start failed',
              headline: '会话启动失败',
              detail: String(e),
              recovery: '请检查应用是否正常启动',
              timestamp: Date.now(),
            },
          })
          console.error('Failed to start session:', e)
        }
      },

      sendInput: async (input: string, responseTimeMs: number) => {
        set(state => ({
          chat: [...state.chat, { role: 'user', content: input }],
          loading: true,
          error: null,
        }))

        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.sendInput({
            student_input: input,
            response_time_ms: responseTimeMs,
          })) as Record<string, unknown> | null

          if (!data) throw new Error('No response from backend')

          const response = data.response as Record<string, unknown> | undefined
          const grillData = data.grill as Record<string, unknown> | undefined

          set(state => ({
            chat: [
              ...state.chat,
              {
                role: 'system' as const,
                content: (response?.content as string) || '',
                phase: (response?.action as string) || undefined,
              },
            ],
            phase: (data.phase as string) || 'idle',
            fourFields: (data.four_fields as FourFields) || null,
            phaseTrace: (data.phase_trace as string[]) || [],
            decision: (data.decision as { action: string; reason: string }) || null,
            visualData: (data.visual_data as VisualData) || null,
            loading: false,
          }))

          // Update grill state if grill data is present
          if (grillData) {
            set({
              grillState: {
                active: (grillData.active as boolean) || false,
                currentQuestion: (grillData.current_question as GrillQuestion) || null,
                difficulty: (grillData.difficulty as number) || 0.5,
                questionsAsked: (grillData.questions_asked as number) || 0,
                encouragement: (grillData.encouragement as string) || '',
                summary: (grillData.summary as GrillSummary) || null,
              },
            })
          }
        } catch (e) {
          set({
            loading: false,
            error: {
              message: 'Send input failed',
              headline: '提交失败',
              detail: String(e),
              recovery: '请重试或检查网络连接',
              timestamp: Date.now(),
            },
          })
          console.error('Failed to send input:', e)
        }
      },

      clearChat: () => set({ chat: [] }),

      // -------------------------------------------------------------------------
      // File operations
      // -------------------------------------------------------------------------

      saveSession: async () => {
        const state = get()
        const sessionData: SessionData = {
          studentId: state.sessionId || '',
          targetNode: state.targetNode || '',
          chat: state.chat,
          fourFields: state.fourFields,
          phaseTrace: state.phaseTrace,
          savedAt: new Date().toISOString(),
        }
        const api = getAPI()
        if (!api) return null
        try {
          return (await api.saveSession(JSON.stringify(sessionData, null, 2))) as string | null
        } catch (e) {
          set({
            error: {
              message: 'Failed to save session',
              headline: '保存会话失败',
              detail: String(e),
              recovery: '请检查存储空间或重试',
              timestamp: Date.now(),
            },
          })
          return null
        }
      },

      loadSession: async () => {
        const api = getAPI()
        if (!api) return false
        let content: string | null
        try {
          content = (await api.loadSession()) as string | null
        } catch (e) {
          set({
            error: {
              message: 'Failed to load session',
              headline: '加载会话失败',
              detail: String(e),
              recovery: '请检查存储空间或重试',
              timestamp: Date.now(),
            },
          })
          return false
        }
        if (!content) return false

        try {
          const data: SessionData = JSON.parse(content)
          set({
            sessionId: data.studentId,
            targetNode: data.targetNode,
            chat: data.chat,
            fourFields: data.fourFields,
            phaseTrace: data.phaseTrace,
          })
          return true
        } catch (e) {
          set({
            error: {
              message: 'Failed to parse session data',
              headline: '会话数据损坏',
              detail: String(e),
              recovery: '会话文件已损坏，请重新开始',
              timestamp: Date.now(),
            },
          })
          return false
        }
      },

      // -------------------------------------------------------------------------
      // Grill
      // -------------------------------------------------------------------------

      startGrill: async (studentId?: string, curriculumLevel?: string) => {
        set({ loading: true, error: null })
        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.startGrill(studentId, curriculumLevel)) as Record<
            string,
            unknown
          > | null
          if (!data) throw new Error('No response')

          const grillData = data.grill as Record<string, unknown> | undefined
          const summary = (grillData?.summary as GrillSummary) || null
          set({
            loading: false,
            grillState: {
              active: (grillData?.active as boolean) || true,
              currentQuestion: (grillData?.current_question as GrillQuestion) || null,
              difficulty:
                (grillData?.difficulty as number) || summary?.adaptive?.current_difficulty || 0.5,
              questionsAsked: 0,
              encouragement: (grillData?.encouragement as string) || '',
              summary,
            },
          })
        } catch (e) {
          set({
            loading: false,
            error: {
              message: 'Grill start failed',
              headline: '面试模式启动失败',
              detail: String(e),
              timestamp: Date.now(),
            },
          })
        }
      },

      submitGrillAnswer: async (qid: string, answer: string, responseTimeMs?: number) => {
        set({ loading: true, error: null })
        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.submitGrillAnswer(qid, answer, responseTimeMs)) as Record<
            string,
            unknown
          > | null
          if (!data) throw new Error('No response')

          const grillData = data.grill as Record<string, unknown> | undefined
          const summary = (grillData?.summary as GrillSummary) || null
          set(state => ({
            loading: false,
            grillState: {
              active: (grillData?.active as boolean) || state.grillState.active,
              currentQuestion: (grillData?.current_question as GrillQuestion) || null,
              difficulty:
                (grillData?.difficulty as number) ||
                summary?.adaptive?.current_difficulty ||
                state.grillState.difficulty,
              questionsAsked: state.grillState.questionsAsked + 1,
              encouragement: (grillData?.encouragement as string) || '',
              summary,
            },
          }))
        } catch (e) {
          set({
            loading: false,
            error: {
              message: 'Grill answer failed',
              headline: '答案提交失败',
              detail: String(e),
              timestamp: Date.now(),
            },
          })
        }
      },

      // -------------------------------------------------------------------------
      // Proof
      // -------------------------------------------------------------------------

      fetchTheorems: async (level?: string) => {
        try {
          const api = getAPI()
          if (!api) return
          const data = (await api.getTheorems(level)) as Record<string, unknown> | null
          if (data && 'theorems' in data) {
            const theorems = (data.theorems as string[]) || []
            set({
              proofState: {
                theorems,
                currentResult: null,
                selectedTheorem: theorems[0] || null,
              },
            })
          }
        } catch (e) {
          console.error('Failed to fetch theorems:', e)
          set({
            error: {
              message: 'Failed to fetch theorems',
              headline: '定理列表加载失败',
              detail: String(e),
              recovery: '请检查应用是否正常启动',
              timestamp: Date.now(),
            },
          })
        }
      },

      submitProof: async (theoremId: string, steps: string[], level?: string) => {
        set({ loading: true, error: null })
        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.submitProof(theoremId, steps, level)) as Record<
            string,
            unknown
          > | null
          if (!data) throw new Error('No response')

          set(state => ({
            loading: false,
            proofState: {
              ...state.proofState,
              currentResult: data as unknown as ProofResult,
            },
          }))
        } catch (e) {
          set({
            loading: false,
            error: {
              message: 'Proof verification failed',
              headline: '证明验证失败',
              detail: String(e),
              timestamp: Date.now(),
            },
          })
        }
      },

      setSelectedTheorem: (theoremId: string | null) =>
        set(state => ({
          proofState: { ...state.proofState, selectedTheorem: theoremId },
        })),

      // -------------------------------------------------------------------------
      // Conjecture
      // -------------------------------------------------------------------------

      submitConjecture: async (claim: string, nodeId?: string) => {
        set(state => ({
          conjectureState: { ...state.conjectureState, loading: true, error: null },
        }))

        const record: ConjectureRecord = {
          claim,
          verdict: 'undecidable',
          counter_example: null,
          timestamp: new Date().toISOString(),
        }

        let errorMsg: string | null = null

        try {
          const api = getAPI()
          let data: Record<string, unknown> | null = null

          // Primary: IPC invoke (consistent with app architecture)
          if (api?.invoke) {
            const result = await api.invoke('conjecture:test', { claim, node_id: nodeId })
            if (result && typeof result === 'object') {
              data = result as Record<string, unknown>
            }
          }

          // Fallback: HTTP fetch to backend REST endpoint
          if (!data && typeof fetch === 'function') {
            try {
              const res = await fetch('/api/conjecture/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claim, node_id: nodeId }),
              })
              if (res.ok) {
                data = (await res.json()) as Record<string, unknown>
              }
            } catch {
              // Backend not available — proceed with undecidable fallback
            }
          }

          if (data) {
            record.verdict = (data.verdict as ConjectureRecord['verdict']) || 'undecidable'
            record.counter_example = (data.counter_example as string) ?? null
          }
        } catch (e) {
          console.error('Failed to submit conjecture:', e)
          errorMsg = e instanceof Error ? e.message : String(e)
        }

        set(state => ({
          conjectureState: {
            entries: [...state.conjectureState.entries, record],
            loading: false,
            error: errorMsg,
          },
        }))
      },

      // -------------------------------------------------------------------------
      // LLM Settings
      // -------------------------------------------------------------------------

      fetchLLMConfig: async () => {
        try {
          const api = getAPI()
          if (!api) return
          const config = (await api.getLLMConfig()) as LLMConfig | null
          if (config) set({ llmConfig: config })
        } catch (e) {
          console.error('Failed to fetch LLM config:', e)
          set({
            error: {
              message: 'Failed to fetch LLM config',
              headline: 'LLM 配置加载失败',
              detail: String(e),
              recovery: '请检查应用是否正常启动',
              timestamp: Date.now(),
            },
          })
        }
      },

      saveLLMConfig: async (config: Partial<LLMConfig>) => {
        try {
          const api = getAPI()
          if (!api) return
          const result = (await api.setLLMConfig(config)) as {
            success: boolean
            config: LLMConfig
          } | null
          if (result?.config) {
            set({ llmConfig: result.config })
          }
        } catch (e) {
          console.error('Failed to save LLM config:', e)
          set({
            error: {
              message: 'LLM config save failed',
              headline: 'LLM 配置保存失败',
              detail: String(e),
              timestamp: Date.now(),
            },
          })
        }
      },

      fetchLLMPresets: async () => {
        try {
          const api = getAPI()
          if (!api) return
          const presets = (await api.getLLMPresets()) as LLMPreset[] | null
          if (presets) set({ llmPresets: presets })
        } catch (e) {
          console.error('Failed to fetch LLM presets:', e)
          set({
            error: {
              message: 'Failed to fetch LLM presets',
              headline: 'LLM 预设加载失败',
              detail: String(e),
              recovery: '请检查应用是否正常启动',
              timestamp: Date.now(),
            },
          })
        }
      },

      // -------------------------------------------------------------------------
      // Onboarding
      // -------------------------------------------------------------------------

      checkOnboarding: async () => {
        try {
          const api = getAPI()
          if (!api) return
          const complete = (await api.isOnboardingComplete()) as boolean | null
          set({ onboardingCompleted: complete ?? false })
        } catch (e) {
          console.error('Failed to check onboarding status:', e)
        }
      },

      completeOnboarding: async () => {
        try {
          const api = getAPI()
          if (!api) return
          await api.setOnboardingComplete(true)
          set({ onboardingCompleted: true })
        } catch (e) {
          console.error('Failed to complete onboarding:', e)
          set({
            error: {
              message: 'Failed to complete onboarding',
              headline: '引导流程完成失败',
              detail: String(e),
              recovery: '请重启应用重试',
              timestamp: Date.now(),
            },
          })
        }
      },

      // -------------------------------------------------------------------------
      // Dynamic Content Generation
      // -------------------------------------------------------------------------

      generateContent: async (req: {
        type: 'exercise' | 'story' | 'challenge'
        topic: string
        ageLevel: 'kids' | 'tweens' | 'teens'
        difficulty: number
        currentTable?: number[][]
        context?: string
      }) => {
        set(state => ({
          dynamicContent: { ...state.dynamicContent, loading: true },
          error: null,
        }))
        try {
          const api = getAPI()
          if (!api) throw new Error('API not available')
          const data = (await api.generateContent(req as Record<string, unknown>)) as Record<
            string,
            unknown
          > | null
          if (!data) throw new Error('No response from backend')

          const type = (data.type as string) || req.type
          set(state => {
            const exercises =
              type === 'exercise'
                ? [...state.dynamicContent.exercises, data]
                : state.dynamicContent.exercises
            const stories =
              type === 'story'
                ? [...state.dynamicContent.stories, data]
                : state.dynamicContent.stories
            const challenges =
              type === 'challenge'
                ? [...state.dynamicContent.challenges, data]
                : state.dynamicContent.challenges
            return {
              dynamicContent: {
                loading: false,
                exercises,
                stories,
                challenges,
                lastGenerated: Date.now(),
              },
            }
          })
        } catch (e) {
          set(state => ({
            dynamicContent: { ...state.dynamicContent, loading: false },
            error: {
              message: 'Dynamic content generation failed',
              headline: '内容生成失败',
              detail: String(e),
              recovery: '请检查 LLM 配置或稍后重试',
              timestamp: Date.now(),
            },
          }))
        }
      },

      // -------------------------------------------------------------------------
      // Error management
      // -------------------------------------------------------------------------

      clearError: () => set({ error: null }),

      setError: (headline: string, detail?: string, recovery?: string) =>
        set({
          error: {
            message: headline,
            headline,
            detail,
            recovery,
            timestamp: Date.now(),
          },
        }),
    }),

    // -----------------------------------------------------------------------
    // Persist configuration (Task 2a)
    // -----------------------------------------------------------------------
    {
      name: 'mathweaver-session',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only persist session-critical fields. Transient runtime state
      // (loading, error, backendReady, dagNodes, …) is re-fetched on startup
      // and must not be persisted.
      partialize: (state): PersistedSessionState => ({
        sessionId: state.sessionId,
        targetNode: state.targetNode,
        phase: state.phase,
        // Cap chat history to the most recent 100 messages to keep the
        // localStorage payload small.
        chat: state.chat.slice(-100),
        phaseTrace: state.phaseTrace,
        grillState: state.grillState,
        proofState: state.proofState,
        conjectureState: state.conjectureState,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('[sessionStore] Failed to rehydrate persisted state:', error)
        } else if (state) {
          console.log('[sessionStore] Rehydrated session from localStorage:', {
            sessionId: state.sessionId,
            targetNode: state.targetNode,
            phase: state.phase,
            chatLength: state.chat.length,
          })
        }
      },
    },
  ),
)

// ---------------------------------------------------------------------------
// Backend URL bootstrap
// ---------------------------------------------------------------------------
// App.tsx calls this once at startup. The store itself talks to the backend
// through `window.api` (contextBridge IPC, which needs no URL), so this only
// resolves the local backend URL via IPC so the bridge/main process is ready.
// It is a safe no-op when the Electron bridge is unavailable.

export async function initBackendUrl(): Promise<void> {
  try {
    const api = (
      window as unknown as {
        api?: { getBackendUrl?: () => Promise<string> }
      }
    ).api
    if (api?.getBackendUrl) {
      await api.getBackendUrl()
    }
  } catch {
    // no-op: communication goes through window.api (contextBridge IPC)
  }
}
