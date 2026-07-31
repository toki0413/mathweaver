import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from '@/stores/sessionStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reset the in-memory store state to its initial values.
 * Also clears localStorage so the persist middleware does not rehydrate
 * stale data from a previous test.
 */
function resetStore() {
  localStorage.clear()
  useStore.setState({
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
  })
}

type MockApi = {
  health: ReturnType<typeof vi.fn>
  startSession: ReturnType<typeof vi.fn>
  sendInput: ReturnType<typeof vi.fn>
  getDag: ReturnType<typeof vi.fn>
  startGrill: ReturnType<typeof vi.fn>
  submitGrillAnswer: ReturnType<typeof vi.fn>
  getTheorems: ReturnType<typeof vi.fn>
  submitProof: ReturnType<typeof vi.fn>
  invoke: ReturnType<typeof vi.fn>
  saveSession: ReturnType<typeof vi.fn>
  loadSession: ReturnType<typeof vi.fn>
}

/**
 * Install a fresh mock `window.api` with vi.fn stubs for every IPC method
 * the store touches. Individual tests can configure return values on the
 * returned mock object.
 */
function setupMockApi(overrides: Partial<MockApi> = {}): MockApi {
  const api: MockApi = {
    health: vi.fn(),
    startSession: vi.fn(),
    sendInput: vi.fn(),
    getDag: vi.fn(),
    startGrill: vi.fn(),
    submitGrillAnswer: vi.fn(),
    getTheorems: vi.fn(),
    submitProof: vi.fn(),
    invoke: vi.fn(),
    saveSession: vi.fn(),
    loadSession: vi.fn(),
    ...overrides,
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sessionStore', () => {
  let api: MockApi

  beforeEach(() => {
    resetStore()
    api = setupMockApi()
    // Stub fetch so the conjecture HTTP fallback does not attempt a real
    // network call inside jsdom.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn() }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('sessionId is null', () => {
      expect(useStore.getState().sessionId).toBeNull()
    })

    it('phase is idle', () => {
      expect(useStore.getState().phase).toBe('idle')
    })

    it('chat is empty', () => {
      expect(useStore.getState().chat).toEqual([])
    })

    it('backendReady is false', () => {
      expect(useStore.getState().backendReady).toBe(false)
    })

    it('targetNode is null', () => {
      expect(useStore.getState().targetNode).toBeNull()
    })

    it('loading is false', () => {
      expect(useStore.getState().loading).toBe(false)
    })

    it('error is null', () => {
      expect(useStore.getState().error).toBeNull()
    })

    it('grillState has default values', () => {
      const gs = useStore.getState().grillState
      expect(gs.active).toBe(false)
      expect(gs.currentQuestion).toBeNull()
      expect(gs.difficulty).toBe(0.5)
      expect(gs.questionsAsked).toBe(0)
      expect(gs.encouragement).toBe('')
      expect(gs.summary).toBeNull()
    })

    it('proofState has default values', () => {
      const ps = useStore.getState().proofState
      expect(ps.theorems).toEqual([])
      expect(ps.currentResult).toBeNull()
      expect(ps.selectedTheorem).toBeNull()
    })

    it('conjectureState has default values', () => {
      const cs = useStore.getState().conjectureState
      expect(cs.entries).toEqual([])
      expect(cs.loading).toBe(false)
      expect(cs.error).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Store shape — valid Zustand store
  // -------------------------------------------------------------------------

  describe('store shape', () => {
    it('is a valid Zustand store with getState / setState / subscribe', () => {
      expect(typeof useStore.getState).toBe('function')
      expect(typeof useStore.setState).toBe('function')
      expect(typeof useStore.subscribe).toBe('function')
    })

    it('exposes all expected action methods', () => {
      const state = useStore.getState()
      for (const action of [
        'checkBackend',
        'startSession',
        'sendInput',
        'clearChat',
        'fetchDagNodes',
        'saveSession',
        'loadSession',
        'startGrill',
        'submitGrillAnswer',
        'fetchTheorems',
        'submitProof',
        'setSelectedTheorem',
        'submitConjecture',
        'fetchLLMConfig',
        'saveLLMConfig',
        'fetchLLMPresets',
        'checkOnboarding',
        'completeOnboarding',
        'clearError',
        'setError',
      ] as const) {
        expect(typeof state[action]).toBe('function')
      }
    })
  })

  // -------------------------------------------------------------------------
  // checkBackend
  // -------------------------------------------------------------------------

  describe('checkBackend', () => {
    it('sets backendReady true when health returns a non-null result', async () => {
      api.health.mockResolvedValue({ status: 'ok' })
      await useStore.getState().checkBackend()
      expect(useStore.getState().backendReady).toBe(true)
      expect(api.health).toHaveBeenCalledOnce()
    })

    it('sets backendReady false when health returns null', async () => {
      api.health.mockResolvedValue(null)
      await useStore.getState().checkBackend()
      expect(useStore.getState().backendReady).toBe(false)
    })

    it('sets backendReady false when health throws', async () => {
      api.health.mockRejectedValue(new Error('network error'))
      await useStore.getState().checkBackend()
      expect(useStore.getState().backendReady).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // startSession
  // -------------------------------------------------------------------------

  describe('startSession', () => {
    it('updates sessionId, targetNode, phase, and chat on success', async () => {
      api.startSession.mockResolvedValue({
        session_id: 'sess-123',
        target_node: 'group_theory',
        phase: 'assess',
        node_name: 'Group Theory',
        node_description: 'Study of algebraic groups',
        learning_path: [{ name: 'Sets' }, { name: 'Operations' }],
      })

      await useStore.getState().startSession('student-1', 'group_theory')

      const state = useStore.getState()
      expect(state.sessionId).toBe('sess-123')
      expect(state.targetNode).toBe('group_theory')
      expect(state.phase).toBe('assess')
      expect(state.loading).toBe(false)
      expect(state.error).toBeNull()

      // A single system message is pushed to chat.
      expect(state.chat).toHaveLength(1)
      expect(state.chat[0].role).toBe('system')
      expect(state.chat[0].phase).toBe('session_start')
      expect(state.chat[0].content).toContain('Group Theory')
      expect(state.chat[0].content).toContain('Study of algebraic groups')
      expect(state.chat[0].content).toContain('Sets → Operations')

      // The IPC call receives the correct payload.
      expect(api.startSession).toHaveBeenCalledWith({
        student_id: 'student-1',
        target_node_id: 'group_theory',
      })
    })

    it('falls back to the provided targetNode when backend omits it', async () => {
      api.startSession.mockResolvedValue({
        session_id: 'sess-456',
        phase: 'idle',
      })

      await useStore.getState().startSession('student-2', 'linear_algebra')

      expect(useStore.getState().targetNode).toBe('linear_algebra')
    })

    it('falls back to idle phase when backend omits it', async () => {
      api.startSession.mockResolvedValue({
        session_id: 'sess-789',
        target_node: 'calculus',
      })

      await useStore.getState().startSession('s', 'calculus')

      expect(useStore.getState().phase).toBe('idle')
    })

    it('sets loading true during the request then false on success', async () => {
      let resolve!: (v: unknown) => void
      api.startSession.mockReturnValue(
        new Promise(r => {
          resolve = r
        }),
      )

      const promise = useStore.getState().startSession('s', 'n')
      expect(useStore.getState().loading).toBe(true)

      resolve({ session_id: 'x', phase: 'idle' })
      await promise

      expect(useStore.getState().loading).toBe(false)
    })

    it('sets error on failure', async () => {
      api.startSession.mockRejectedValue(new Error('boom'))

      await useStore.getState().startSession('student-1', 'group_theory')

      const state = useStore.getState()
      expect(state.loading).toBe(false)
      expect(state.error).not.toBeNull()
      expect(state.error?.headline).toBe('会话启动失败')
      expect(state.error?.detail).toContain('boom')
      expect(state.sessionId).toBeNull()
    })

    it('sets error when backend returns null', async () => {
      api.startSession.mockResolvedValue(null)

      await useStore.getState().startSession('student-1', 'group_theory')

      expect(useStore.getState().error).not.toBeNull()
      expect(useStore.getState().error?.headline).toBe('会话启动失败')
    })
  })

  // -------------------------------------------------------------------------
  // sendInput
  // -------------------------------------------------------------------------

  describe('sendInput', () => {
    it('appends user message and system response to chat', async () => {
      // Pre-populate chat to verify appending (not replacing).
      useStore.setState({
        chat: [{ role: 'system', content: 'welcome' }],
      })

      api.sendInput.mockResolvedValue({
        response: { content: 'Good answer', action: 'advance' },
        phase: 'practice',
        four_fields: null,
        phase_trace: ['assess', 'practice'],
        decision: { action: 'advance', reason: 'correct' },
        visual_data: null,
      })

      await useStore.getState().sendInput('What is a group?', 1500)

      const state = useStore.getState()
      // 1 original system message + 1 user message + 1 system response
      expect(state.chat).toHaveLength(3)
      expect(state.chat[1]).toEqual({ role: 'user', content: 'What is a group?' })
      expect(state.chat[2].role).toBe('system')
      expect(state.chat[2].content).toBe('Good answer')
      expect(state.chat[2].phase).toBe('advance')
      expect(state.phase).toBe('practice')
      expect(state.loading).toBe(false)
      expect(state.phaseTrace).toEqual(['assess', 'practice'])
      expect(state.decision).toEqual({ action: 'advance', reason: 'correct' })

      expect(api.sendInput).toHaveBeenCalledWith({
        student_input: 'What is a group?',
        response_time_ms: 1500,
      })
    })

    it('updates grill state when grill data is present in the response', async () => {
      api.sendInput.mockResolvedValue({
        response: { content: 'next', action: 'grill' },
        phase: 'grill',
        grill: {
          active: true,
          current_question: { qid: 'q1', question: 'Define a subgroup' },
          difficulty: 0.7,
          questions_asked: 3,
          encouragement: 'Keep going!',
          summary: null,
        },
      })

      await useStore.getState().sendInput('answer', 500)

      const gs = useStore.getState().grillState
      expect(gs.active).toBe(true)
      expect(gs.currentQuestion).toEqual({ qid: 'q1', question: 'Define a subgroup' })
      expect(gs.difficulty).toBe(0.7)
      expect(gs.questionsAsked).toBe(3)
      expect(gs.encouragement).toBe('Keep going!')
    })

    it('does not modify grill state when no grill data is present', async () => {
      const before = useStore.getState().grillState
      api.sendInput.mockResolvedValue({
        response: { content: 'ok', action: 'idle' },
        phase: 'idle',
      })

      await useStore.getState().sendInput('hi', 100)

      expect(useStore.getState().grillState).toBe(before)
    })

    it('sets error on failure but keeps the user message in chat', async () => {
      api.sendInput.mockRejectedValue(new Error('network'))

      await useStore.getState().sendInput('test', 100)

      const state = useStore.getState()
      expect(state.error).not.toBeNull()
      expect(state.error?.headline).toBe('提交失败')
      expect(state.loading).toBe(false)
      // The user message was appended before the API call failed.
      expect(state.chat).toHaveLength(1)
      expect(state.chat[0].role).toBe('user')
      expect(state.chat[0].content).toBe('test')
    })

    it('sets error when backend returns null', async () => {
      api.sendInput.mockResolvedValue(null)

      await useStore.getState().sendInput('test', 100)

      expect(useStore.getState().error).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // clearChat
  // -------------------------------------------------------------------------

  describe('clearChat', () => {
    it('empties the chat array', () => {
      useStore.setState({
        chat: [
          { role: 'system', content: 'a' },
          { role: 'user', content: 'b' },
          { role: 'system', content: 'c' },
        ],
      })

      useStore.getState().clearChat()

      expect(useStore.getState().chat).toEqual([])
    })

    it('is safe to call on an already-empty chat', () => {
      useStore.getState().clearChat()
      expect(useStore.getState().chat).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // submitConjecture
  // -------------------------------------------------------------------------

  describe('submitConjecture', () => {
    it('adds a record to conjectureState.entries', async () => {
      api.invoke.mockResolvedValue(null)

      await useStore.getState().submitConjecture('Every group has an identity')

      const cs = useStore.getState().conjectureState
      expect(cs.entries).toHaveLength(1)
      expect(cs.entries[0].claim).toBe('Every group has an identity')
      expect(cs.entries[0].verdict).toBe('undecidable')
      expect(cs.entries[0].counter_example).toBeNull()
      expect(cs.loading).toBe(false)
      expect(cs.error).toBeNull()
    })

    it('calls window.api.invoke with the conjecture:test channel and correct args', async () => {
      api.invoke.mockResolvedValue(null)

      await useStore.getState().submitConjecture('Claim text', 'node-1')

      expect(api.invoke).toHaveBeenCalledWith('conjecture:test', {
        claim: 'Claim text',
        node_id: 'node-1',
      })
    })

    it('works without a node_id argument', async () => {
      api.invoke.mockResolvedValue(null)

      await useStore.getState().submitConjecture('No node claim')

      expect(api.invoke).toHaveBeenCalledWith('conjecture:test', {
        claim: 'No node claim',
        node_id: undefined,
      })
    })

    it('updates verdict and counter_example from the invoke response', async () => {
      api.invoke.mockResolvedValue({
        verdict: 'refuted',
        counter_example: 'S3 is not abelian',
      })

      await useStore.getState().submitConjecture('All groups are abelian')

      const entry = useStore.getState().conjectureState.entries[0]
      expect(entry.verdict).toBe('refuted')
      expect(entry.counter_example).toBe('S3 is not abelian')
    })

    it('handles a confirmed verdict', async () => {
      api.invoke.mockResolvedValue({ verdict: 'confirmed', counter_example: null })

      await useStore.getState().submitConjecture('True claim')

      const entry = useStore.getState().conjectureState.entries[0]
      expect(entry.verdict).toBe('confirmed')
      expect(entry.counter_example).toBeNull()
    })

    it('falls back to undecidable when invoke returns null', async () => {
      api.invoke.mockResolvedValue(null)

      await useStore.getState().submitConjecture('Maybe true')

      const entry = useStore.getState().conjectureState.entries[0]
      expect(entry.verdict).toBe('undecidable')
      expect(entry.counter_example).toBeNull()
    })

    it('appends multiple entries across successive calls', async () => {
      api.invoke.mockResolvedValue(null)

      await useStore.getState().submitConjecture('claim 1')
      await useStore.getState().submitConjecture('claim 2')
      await useStore.getState().submitConjecture('claim 3')

      const entries = useStore.getState().conjectureState.entries
      expect(entries).toHaveLength(3)
      expect(entries[0].claim).toBe('claim 1')
      expect(entries[1].claim).toBe('claim 2')
      expect(entries[2].claim).toBe('claim 3')
    })

    it('still adds the record when invoke throws', async () => {
      api.invoke.mockRejectedValue(new Error('IPC failure'))

      await useStore.getState().submitConjecture('resilient claim')

      const cs = useStore.getState().conjectureState
      expect(cs.entries).toHaveLength(1)
      expect(cs.entries[0].claim).toBe('resilient claim')
      expect(cs.entries[0].verdict).toBe('undecidable')
      expect(cs.loading).toBe(false)
    })

    it('sets loading to true during submission then false after', async () => {
      api.invoke.mockResolvedValue({ verdict: 'confirmed' })

      const promise = useStore.getState().submitConjecture('test claim')
      // loading is set synchronously before the await
      expect(useStore.getState().conjectureState.loading).toBe(true)

      await promise
      expect(useStore.getState().conjectureState.loading).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // fetchTheorems
  // -------------------------------------------------------------------------

  describe('fetchTheorems', () => {
    it('populates proofState.theorems from the backend response', async () => {
      api.getTheorems.mockResolvedValue({
        theorems: ['Lagrange', 'Cayley', 'First Isomorphism'],
      })

      await useStore.getState().fetchTheorems()

      const ps = useStore.getState().proofState
      expect(ps.theorems).toEqual(['Lagrange', 'Cayley', 'First Isomorphism'])
      expect(ps.selectedTheorem).toBe('Lagrange')
      expect(ps.currentResult).toBeNull()
    })

    it('passes the level argument to getTheorems', async () => {
      api.getTheorems.mockResolvedValue({ theorems: [] })

      await useStore.getState().fetchTheorems('advanced')

      expect(api.getTheorems).toHaveBeenCalledWith('advanced')
    })

    it('sets selectedTheorem to null when the theorems list is empty', async () => {
      api.getTheorems.mockResolvedValue({ theorems: [] })

      await useStore.getState().fetchTheorems()

      expect(useStore.getState().proofState.selectedTheorem).toBeNull()
    })

    it('does not modify proofState when response lacks theorems key', async () => {
      api.getTheorems.mockResolvedValue({ other: 'data' })

      const before = useStore.getState().proofState
      await useStore.getState().fetchTheorems()

      // Same object reference — state was not touched.
      expect(useStore.getState().proofState).toBe(before)
    })

    it('handles errors gracefully without throwing', async () => {
      api.getTheorems.mockRejectedValue(new Error('fail'))

      await expect(useStore.getState().fetchTheorems()).resolves.toBeUndefined()
      expect(useStore.getState().proofState.theorems).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // setError / clearError
  // -------------------------------------------------------------------------

  describe('setError / clearError', () => {
    it('setError sets error state with headline, detail, and recovery', () => {
      useStore.getState().setError('Something broke', 'detail here', 'try again')

      const err = useStore.getState().error
      expect(err).not.toBeNull()
      expect(err?.headline).toBe('Something broke')
      expect(err?.message).toBe('Something broke')
      expect(err?.detail).toBe('detail here')
      expect(err?.recovery).toBe('try again')
      expect(typeof err?.timestamp).toBe('number')
    })

    it('setError works with only a headline', () => {
      useStore.getState().setError('Just a headline')

      const err = useStore.getState().error
      expect(err?.headline).toBe('Just a headline')
      expect(err?.detail).toBeUndefined()
      expect(err?.recovery).toBeUndefined()
    })

    it('clearError resets error to null', () => {
      useStore.getState().setError('error')
      expect(useStore.getState().error).not.toBeNull()

      useStore.getState().clearError()
      expect(useStore.getState().error).toBeNull()
    })

    it('clearError is safe when error is already null', () => {
      useStore.getState().clearError()
      expect(useStore.getState().error).toBeNull()
    })

    it('setError overwrites a previous error', () => {
      useStore.getState().setError('first')
      useStore.getState().setError('second')

      expect(useStore.getState().error?.headline).toBe('second')
    })
  })

  // -------------------------------------------------------------------------
  // startGrill
  // -------------------------------------------------------------------------

  describe('startGrill', () => {
    it('updates grillState on success', async () => {
      api.startGrill.mockResolvedValue({
        grill: {
          active: true,
          current_question: { qid: 'q1', question: 'What is a group?' },
          difficulty: 0.6,
          encouragement: 'Welcome!',
          summary: null,
        },
      })

      await useStore.getState().startGrill('student-1', 'group_theory')

      const gs = useStore.getState().grillState
      expect(gs.active).toBe(true)
      expect(gs.currentQuestion?.qid).toBe('q1')
      expect(gs.difficulty).toBe(0.6)
      expect(gs.encouragement).toBe('Welcome!')
      expect(useStore.getState().loading).toBe(false)
    })

    it('passes studentId and curriculumLevel to the API', async () => {
      api.startGrill.mockResolvedValue({ grill: { active: true } })

      await useStore.getState().startGrill('stu', 'calculus')

      expect(api.startGrill).toHaveBeenCalledWith('stu', 'calculus')
    })

    it('defaults active to true when grill data omits it', async () => {
      api.startGrill.mockResolvedValue({ grill: { difficulty: 0.5 } })

      await useStore.getState().startGrill()

      expect(useStore.getState().grillState.active).toBe(true)
    })

    it('uses summary.adaptive.current_difficulty as fallback difficulty', async () => {
      api.startGrill.mockResolvedValue({
        grill: {
          active: true,
          summary: {
            adaptive: { current_difficulty: 0.8 },
          },
        },
      })

      await useStore.getState().startGrill()

      expect(useStore.getState().grillState.difficulty).toBe(0.8)
    })

    it('sets error on failure', async () => {
      api.startGrill.mockRejectedValue(new Error('nope'))

      await useStore.getState().startGrill()

      expect(useStore.getState().error?.headline).toBe('面试模式启动失败')
      expect(useStore.getState().loading).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // submitGrillAnswer
  // -------------------------------------------------------------------------

  describe('submitGrillAnswer', () => {
    it('increments questionsAsked and updates grill state', async () => {
      useStore.setState({
        grillState: {
          ...useStore.getState().grillState,
          questionsAsked: 2,
          difficulty: 0.5,
          active: true,
        },
      })

      api.submitGrillAnswer.mockResolvedValue({
        grill: {
          active: true,
          current_question: { qid: 'q2', question: 'Next?' },
          difficulty: 0.65,
          encouragement: 'Good!',
          summary: null,
        },
      })

      await useStore.getState().submitGrillAnswer('q1', 'my answer', 3000)

      const gs = useStore.getState().grillState
      expect(gs.questionsAsked).toBe(3)
      expect(gs.difficulty).toBe(0.65)
      expect(gs.encouragement).toBe('Good!')
      expect(gs.currentQuestion?.qid).toBe('q2')

      expect(api.submitGrillAnswer).toHaveBeenCalledWith('q1', 'my answer', 3000)
    })

    it('works without a responseTimeMs argument', async () => {
      api.submitGrillAnswer.mockResolvedValue({
        grill: { active: true, difficulty: 0.5 },
      })

      await useStore.getState().submitGrillAnswer('q1', 'ans')

      expect(api.submitGrillAnswer).toHaveBeenCalledWith('q1', 'ans', undefined)
    })

    it('preserves active state from previous grillState when response omits it', async () => {
      useStore.setState({
        grillState: {
          ...useStore.getState().grillState,
          active: true,
        },
      })

      api.submitGrillAnswer.mockResolvedValue({
        grill: { difficulty: 0.5 },
      })

      await useStore.getState().submitGrillAnswer('q1', 'ans')

      expect(useStore.getState().grillState.active).toBe(true)
    })

    it('sets error on failure', async () => {
      api.submitGrillAnswer.mockRejectedValue(new Error('fail'))

      await useStore.getState().submitGrillAnswer('q1', 'ans')

      expect(useStore.getState().error?.headline).toBe('答案提交失败')
    })
  })
})
