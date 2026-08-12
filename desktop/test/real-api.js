/**
 * Real-Backend Electron IPC bridge for E2E testing.
 *
 * Loaded by test/real-index.html BEFORE the React app bundle. It installs a
 * `window.api` that talks to the REAL FastAPI backend over HTTP (instead of the
 * deterministic mock in test/mock-api.js), so E2E tests exercise the genuine
 * frontend -> HTTP -> FastAPI -> Orchestrator -> (mock LLM) chain.
 *
 * Responsibilities:
 *  1. Route every core IPC channel to the real FastAPI REST endpoint.
 *  2. Normalize the real backend response into the exact shape the frontend
 *     contract expects (the real backend and the renderer evolved in parallel,
 *     so e.g. `response` is a string on the backend but an object in the UI).
 *  3. Fall back to browser/local behaviour for Electron-only channels that the
 *     FastAPI backend does not provide (settings, file dialogs, app info,
 *     LLM-preset persistence, dynamic content — all local concerns).
 *
 * The backend base URL is read from `window.__MATHWEAVER_BACKEND_URL__`
 * (defaults to http://localhost:8010) so the Playwright config can point at the
 * uvicorn instance it starts.
 */
;(function () {
  'use strict'

  const BACKEND_URL =
    (typeof window !== 'undefined' && window.__MATHWEAVER_BACKEND_URL__) ||
    'http://localhost:8010'

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  async function http(method, path, body) {
    const opts = { method, headers: {} }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    const res = await fetch(BACKEND_URL + path, opts)
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (!res.ok) {
      const headline = (json && json.headline) || json && json.detail || `HTTP ${res.status}`
      throw new Error(headline)
    }
    return json
  }

  const get = (path) => http('GET', path)
  const post = (path, body) => http('POST', path, body)

  // Concept id -> name map, fetched lazily from the real DAG and cached.
  let dagNameCache = null
  async function getDagNameMap() {
    if (dagNameCache) return dagNameCache
    try {
      const dag = await get('/api/dag')
      const map = {}
      for (const n of dag.nodes || []) map[n.id] = n.name
      dagNameCache = map
      return map
    } catch {
      return {}
    }
  }

  async function nodeName(id) {
    if (!id) return null
    const map = await getDagNameMap()
    return map[id] || id
  }

  // -------------------------------------------------------------------------
  // Response normalization (backend shape -> frontend contract)
  // -------------------------------------------------------------------------

  /**
   * process_student_input returns `response` as a string and visualization
   * under `visual` (non-grill mode exposes only 3 of the 5 sub-charts). The
   * renderer expects `response` to be an object and reads `visual_data` with
   * all five sub-charts, so we adapt.
   */
  function normalizeSessionInput(data) {
    const visual = data.visual || {}
    const phaseTrace = Array.isArray(data.phase_trace) ? data.phase_trace : []
    const decision = data.decision || {}
    return {
      ...data,
      response: {
        content: typeof data.response === 'string' ? data.response : String(data.response || ''),
        action: decision.action || 'deliver',
      },
      phase: phaseTrace.length ? phaseTrace[phaseTrace.length - 1] : 'idle',
      visual_data: {
        ...visual,
        conjecture_journey:
          visual.conjecture_journey || {
            timeline: [],
            refinement_chains: [],
            total_conjectures: 0,
            confirmed: 0,
            refuted: 0,
          },
        difficulty_gauge:
          visual.difficulty_gauge || {
            current_difficulty: 0.5,
            difficulty_band: 'standard',
            trend: 'stable',
            accuracy_rate: 0,
          },
      },
    }
  }

  /**
   * The real backend drives grill through the orchestrator loop and exposes
   * `grill_mode`/`grill_summary` rather than a `grill.current_question`
   * envelope. We synthesize a question from the current concept so the UI can
   * render a prompt; answers still flow through the real backend.
   */
  async function normalizeGrill(data) {
    const grillMode = !!data.grill_mode
    const gs = data.grill_summary || null
    const active = grillMode && (!gs || gs.active !== false)

    let questionText = '请讲解当前学习概念的核心定义、关键性质，并给出一个具体例子。'
    const currentId = data.visual && data.visual.dag_progress && data.visual.dag_progress.current_node
    const currentName = await nodeName(currentId)
    if (currentName) {
      questionText = `请讲解「${currentName}」的核心概念：它的定义、关键性质，并给出一个具体例子。`
    }

    return {
      grill: {
        active,
        current_question: {
          qid: `real_${Date.now()}`,
          concept_node_id: currentId || 'group_definition',
          concept_name: currentName || '群论',
          question: questionText,
          recommended_answer: '请结合定义与性质给出有条理的回答。',
          difficulty: (gs && gs.adaptive && gs.adaptive.current_difficulty) || 0.5,
          branch_type: 'concept',
        },
        difficulty: (gs && gs.adaptive && gs.adaptive.current_difficulty) || 0.5,
        questions_asked: (gs && gs.resolved_branches) || 0,
        encouragement:
          (gs && gs.encouragement && gs.encouragement.message) ||
          (active ? '面试进行中，请继续回答。' : '本轮面试结束。'),
        summary: gs
          ? {
              active,
              total_branches: gs.total_branches || 0,
              resolved_branches: gs.resolved_branches || 0,
              correct_answers: gs.correct_answers || 0,
              progress: gs.progress || '0/0',
              adaptive: gs.adaptive || {},
              encouragement: gs.encouragement || {},
              branches: gs.branches || {},
            }
          : null,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Mock fallbacks for Electron-local channels (no FastAPI counterpart)
  // -------------------------------------------------------------------------

  const STORAGE_PREFIX = 'mathweaver:real:'
  function storageGet(key) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + key)
    } catch {
      return null
    }
  }
  function storageSet(key, val) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, val)
    } catch {
      /* ignore */
    }
  }

  const LLM_PRESETS = [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      provider: 'openai_compatible',
      providerType: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      requiresApiKey: true,
      helpUrl: 'https://platform.deepseek.com/api_keys',
      description: 'DeepSeek Chat API',
    },
    {
      id: 'ollama',
      label: 'Ollama (本地)',
      provider: 'openai_compatible',
      providerType: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.2',
      requiresApiKey: false,
      helpUrl: 'https://ollama.ai',
      description: '本地运行的 Ollama 模型',
    },
  ]

  function fallbackDynamicContent(req) {
    const type = (req && req.type) || 'exercise'
    const topic = (req && req.topic) || '群论'
    const difficulty = (req && req.difficulty) || 0.5
    if (type === 'exercise') {
      return {
        type,
        topic,
        title: `练习题：${topic}`,
        question: `请描述「${topic}」的核心定义并举出一个具体例子。`,
        hint: '回想课堂上学过的定义，尝试用自己的话复述。',
        answer: `${topic}的核心定义与示例`,
        explanation: `这是一道关于「${topic}」的入门练习题。`,
        difficulty,
        source: 'fallback',
      }
    }
    if (type === 'story') {
      return {
        type,
        topic,
        title: `${topic}的奇妙之旅`,
        text: `在一个古老的知识王国里，一位年轻的探索者发现了刻着「${topic}」的奥秘……`,
        difficulty,
        source: 'fallback',
      }
    }
    return {
      type,
      topic,
      title: `${topic}挑战`,
      task: `请围绕「${topic}」构造一个具体例子并验证其性质。`,
      hint: '从一个最简单的例子开始。',
      successCriteria: '能给出正确例子并清晰说明验证过程。',
      steps: ['回顾定义', '构造例子', '验证性质', '总结'],
      difficulty,
      source: 'fallback',
    }
  }

  // -------------------------------------------------------------------------
  // Channel handlers
  // -------------------------------------------------------------------------

  const handlers = {
    // --- App / identity (local) ---
    'student:get-id': () => `e2e_real_${Date.now().toString(36)}`,
    'app:get-info': () => ({
      name: 'MathWeaver',
      version: '0.4.5-real-e2e',
      electron: 'e2e (real backend)',
      platform: 'e2e',
    }),
    'app:get-backend-url': () => BACKEND_URL,
    'app:log-error': () => null,

    // --- Real backend health ---
    'api:health': () => get('/api/health'),

    // --- Real DAG / curricula ---
    'api:dag': (level) => {
      dagNameCache = null
      return get(level ? `/api/dag?level=${encodeURIComponent(level)}` : '/api/dag')
    },
    'api:curricula': () => get('/api/curricula'),
    'api:curriculum-dag': (level) =>
      get(`/api/curricula/${encodeURIComponent(level || 'group_theory')}/dag`),

    // --- Real session ---
    'api:session-start': async (req) => {
      const data = await post('/api/session/start', {
        student_id: (req && req.student_id) || 'e2e_student',
        student_name: (req && req.student_name) || '',
        target_node_id: (req && req.target_node_id) || 'group_definition',
      })
      // Real backend returns learning_path as node-id strings; the UI reads .name.
      if (Array.isArray(data.learning_path)) {
        const map = await getDagNameMap()
        data.learning_path = data.learning_path.map((id) => ({
          id,
          name: map[id] || id,
        }))
      }
      return data
    },
    'api:session-state': () => get('/api/session/state'),
    'api:session-input': (req) =>
      post('/api/session/input', {
        student_input: (req && req.student_input) || '',
        response_time_ms: (req && req.response_time_ms) || 5000,
      }).then(normalizeSessionInput),

    // --- Real forge ---
    'api:verify-group': (table) =>
      post('/api/forge/verify-group', { table: table || [] }).then((data) => ({
        is_group: data.verdict && data.verdict.is_group,
        is_abelian: data.verdict && data.verdict.is_abelian,
        issues: data.evidence && data.evidence.axiom_violation ? [data.evidence.axiom_violation] : [],
        details: {
          closure: data.evidence && data.evidence.axiom_violation ? '失败' : '通过',
          associativity:
            data.evidence && data.evidence.associativity && !data.evidence.associativity.satisfied
              ? '失败'
              : '通过',
          identity: '通过',
          inverses: '通过',
        },
        headline: data.headline,
      })),
    'api:find-non-associative': (n) =>
      post(`/api/forge/find-non-associative?n=${Number(n) || 3}`, {}).then((data) => ({
        found: data.result && data.result.found,
        table: data.result && data.result.counter_example,
        message: data.headline,
      })),

    // --- Real metrics ---
    'api:metrics': () => get('/api/metrics'),

    // --- Real proof ---
    'api:proof-theorems': (level) =>
      get(`/api/proof/theorems${level ? `?level=${encodeURIComponent(level)}` : ''}`),
    'api:proof-verify': (theoremId, steps, level) =>
      post('/api/proof/verify', {
        theorem_id: theoremId || 'identity_unique',
        student_steps: Array.isArray(steps) ? steps : [],
        curriculum_level: level || 'group_theory',
      }),

    // --- Real grill (normalized) ---
    'api:grill-start': (studentId, level) =>
      post('/api/grill/start', {
        student_id: studentId || 'grill_student',
        curriculum_level: level || 'group_theory',
      })
        .then(normalizeSessionInput)
        .then(normalizeGrill),
    'api:grill-answer': (_qid, answer, rt) =>
      post('/api/grill/answer', {
        qid: _qid || 'q',
        answer: answer || '',
        response_time_ms: rt || 5000,
      })
        .then(normalizeSessionInput)
        .then(normalizeGrill),

    // --- Real conjecture (NL -> Z3) ---
    'conjecture:test': async (req) => {
      const data = await post('/api/conjecture/translate', {
        claim: (req && req.claim) || '',
      })
      return {
        verdict: data.verdict || 'undecidable',
        counter_example: data.counter_example || null,
        claim: (req && req.claim) || '',
        explanation: data.explanation || '',
      }
    },

    // --- Dynamic content (local fallback) ---
    'api:generate-content': (req) => fallbackDynamicContent(req),

    // --- Settings / file (local) ---
    'settings:get': (key) => {
      const raw = storageGet('setting:' + key)
      return raw === null ? null : raw
    },
    'settings:set': (key, value) => {
      storageSet('setting:' + key, String(value))
      return true
    },
    'settings:get-llm-config': () => ({
      provider: 'mock',
      providerType: 'openai-compatible',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 4096,
    }),
    'settings:set-llm-config': (config) => ({ success: true, config }),
    'settings:get-llm-presets': () => LLM_PRESETS,
    'settings:is-onboarding-complete': () => storageGet('onboarding') === 'done',
    'settings:set-onboarding-complete': (value) => {
      storageSet('onboarding', value ? 'done' : '')
      return true
    },
    'file:save-session': () => null,
    'file:load-session': () => null,
    'file:export-table': () => null,
  }

  // -------------------------------------------------------------------------
  // window.api object
  // -------------------------------------------------------------------------

  const realApi = {
    invoke: async (channel, ...args) => {
      const handler = handlers[channel]
      if (handler) {
        try {
          return await handler(...args)
        } catch (e) {
          console.error('[RealAPI] channel failed:', channel, e)
          return null
        }
      }
      console.warn('[RealAPI] Unknown channel:', channel)
      return null
    },

    on: () => () => {},
    send: () => {},

    health: () => realApi.invoke('api:health'),
    getDag: (level) => realApi.invoke('api:dag', level),
    getCurricula: () => realApi.invoke('api:curricula'),
    getCurriculumDag: (level) => realApi.invoke('api:curriculum-dag', level),
    startSession: (req) => realApi.invoke('api:session-start', req),
    getSessionState: () => realApi.invoke('api:session-state'),
    sendInput: (req) => realApi.invoke('api:session-input', req),
    verifyGroup: (table) => realApi.invoke('api:verify-group', table),
    findNonAssociative: (n) => realApi.invoke('api:find-non-associative', n),
    getMetrics: () => realApi.invoke('api:metrics'),
    getTheorems: (level) => realApi.invoke('api:proof-theorems', level),
    submitProof: (theoremId, steps, level) =>
      realApi.invoke('api:proof-verify', theoremId, steps, level),
    startGrill: (studentId, level) => realApi.invoke('api:grill-start', studentId, level),
    submitGrillAnswer: (qid, answer, rt) =>
      realApi.invoke('api:grill-answer', qid, answer, rt),
    generateContent: (req) => realApi.invoke('api:generate-content', req),
    getLLMConfig: () => realApi.invoke('settings:get-llm-config'),
    setLLMConfig: (config) => realApi.invoke('settings:set-llm-config', config),
    getLLMPresets: () => realApi.invoke('settings:get-llm-presets'),
    getSetting: (key) => realApi.invoke('settings:get', key),
    setSetting: (key, value) => realApi.invoke('settings:set', key, value),
    isOnboardingComplete: () => realApi.invoke('settings:is-onboarding-complete'),
    setOnboardingComplete: (value) => realApi.invoke('settings:set-onboarding-complete', value),
    saveSession: (data) => realApi.invoke('file:save-session', data),
    loadSession: () => realApi.invoke('file:load-session'),
    exportTable: (data) => realApi.invoke('file:export-table', data),
    getAppInfo: () => realApi.invoke('app:get-info'),
    getBackendUrl: () => realApi.invoke('app:get-backend-url'),
  }

  // -------------------------------------------------------------------------
  // Install on window
  // -------------------------------------------------------------------------

  try {
    Object.defineProperty(window, 'api', {
      value: realApi,
      writable: true,
      configurable: true,
    })
  } catch (e) {
    window.api = realApi
  }

  // -------------------------------------------------------------------------
  // HTTP fetch proxy: rewrite frontend /api/* calls to the real backend and
  // normalize the responses to the shapes the UI expects.
  // -------------------------------------------------------------------------

  if (typeof fetch === 'function') {
    const originalFetch = window.fetch
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url
      if (url && url.startsWith('/api/')) {
        let body = {}
        if (init && init.body) {
          try {
            body = JSON.parse(init.body)
          } catch {
            body = {}
          }
        }

        // Conjecture: frontend hits /api/conjecture/test -> real /translate
        if (url === '/api/conjecture/test') {
          const real = await post('/api/conjecture/translate', {
            claim: body.claim || '',
          })
          return new Response(
            JSON.stringify({
              verdict: real.verdict || 'undecidable',
              counter_example: real.counter_example || null,
              claim: body.claim || '',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        // Historical narrative: real returns { narrative, entries:[...] } -> UI expects array
        if (url === '/api/historical/narrative') {
          const real = await post('/api/historical/narrative', {
            query: body.claim || body.query || '',
            node_id: body.node_id || 'group_definition',
            top_k: 3,
          })
          const entries = Array.isArray(real.entries) ? real.entries : []
          return new Response(JSON.stringify(entries), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Curriculum compare: real returns { comparisons:[...] } -> UI expects { structures:[...] }
        if (url === '/api/curriculum/compare') {
          const real = await post('/api/curriculum/compare', {
            levels: body.levels || ['group_theory', 'linear_algebra', 'number_theory'],
            concept_keyword: body.concept || body.keyword || 'isomorphism',
          })
          const structure = (c) => ({
            name: c.concept_name || c.concept_id,
            domain: c.structural_type || '',
            definition: c.description || '',
            example: '',
            key_properties: [],
          })
          return new Response(
            JSON.stringify({
              structures: (real.comparisons || []).map(structure),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return originalFetch.call(this, input, init)
    }
  }

  console.log('[RealAPI] Installed. backend=' + BACKEND_URL)
})()