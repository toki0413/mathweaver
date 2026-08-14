/**
 * Mock Electron IPC bridge for E2E testing.
 *
 * This file is loaded by test/index.html BEFORE the React app bundle.
 * It creates window.api that mimics the Electron preload bridge,
 * returning deterministic mock data for all IPC channels.
 *
 * The mock also intercepts fetch() calls to /api/* endpoints to provide
 * HTTP fallback responses (historical narrative, curriculum compare, etc.).
 */
;(function () {
  'use strict'

  // -------------------------------------------------------------------------
  // Mock data
  // -------------------------------------------------------------------------

  const VERSION = '0.3.0'

  const DAG_NODES = [
    {
      id: 'set_theory',
      name: '集合论基础',
      description: '集合、元素、子集、幂集等基本概念',
      prerequisites: [],
      abstraction_level: 0,
      difficulty: 0.2,
      is_milestone: true,
    },
    {
      id: 'binary_operation',
      name: '二元运算',
      description: '集合上的二元运算及其性质（封闭性、结合律等）',
      prerequisites: ['set_theory'],
      abstraction_level: 1,
      difficulty: 0.3,
      is_milestone: false,
    },
    {
      id: 'group_definition',
      name: '群的定义',
      description: '群是配备二元运算的集合，满足封闭性、结合律、幺元和逆元四条公理',
      prerequisites: ['binary_operation'],
      abstraction_level: 2,
      difficulty: 0.45,
      is_milestone: true,
    },
    {
      id: 'subgroup',
      name: '子群',
      description: '群的子集在原运算下仍构成群',
      prerequisites: ['group_definition'],
      abstraction_level: 3,
      difficulty: 0.55,
      is_milestone: false,
    },
    {
      id: 'cyclic_group',
      name: '循环群',
      description: '由单个元素生成的群',
      prerequisites: ['subgroup'],
      abstraction_level: 3,
      difficulty: 0.6,
      is_milestone: true,
    },
    {
      id: 'homomorphism',
      name: '同态与同构',
      description: '群之间的结构保持映射',
      prerequisites: ['group_definition'],
      abstraction_level: 4,
      difficulty: 0.7,
      is_milestone: true,
    },
    {
      id: 'normal_subgroup',
      name: '正规子群与商群',
      description: '不变子群及由此构造的商群结构',
      prerequisites: ['subgroup', 'homomorphism'],
      abstraction_level: 5,
      difficulty: 0.8,
      is_milestone: false,
    },
    {
      id: 'sylow_theorem',
      name: 'Sylow 定理',
      description: '有限群中 Sylow p-子群的存在性、共轭性与数量约束',
      prerequisites: ['normal_subgroup'],
      abstraction_level: 6,
      difficulty: 0.9,
      is_milestone: true,
    },
  ]

  const THEOREMS = [
    '群的幺元唯一性',
    '群的逆元唯一性',
    '子群的判定定理',
    '循环群的阶',
    '同态基本定理',
    'Sylow 第一定理',
  ]

  const GRILL_QUESTIONS = [
    {
      qid: 'grill_q1',
      concept_node_id: 'group_definition',
      concept_name: '群论基础',
      question: 'What is a group? Define it formally.',
      recommended_answer:
        'A group is a set equipped with a binary operation that satisfies closure, associativity, identity, and invertibility axioms.',
      difficulty: 0.45,
      branch_type: 'concept',
    },
    {
      qid: 'grill_q2',
      concept_node_id: 'subgroup',
      concept_name: '子群',
      question: '什么是子群？如何判定一个子集是否为子群？',
      recommended_answer:
        '子群是群的子集在原运算下仍构成群。判定方法：非空子集H对运算封闭且对取逆封闭，则H是子群。',
      difficulty: 0.55,
      branch_type: 'application',
    },
    {
      qid: 'grill_q3',
      concept_node_id: 'cyclic_group',
      concept_name: '循环群',
      question: '证明循环群一定是交换群。',
      recommended_answer:
        '设G=<a>是循环群。对任意a^m, a^n ∈ G，a^m·a^n = a^(m+n) = a^(n+m) = a^n·a^m，故G是交换群。',
      difficulty: 0.6,
      branch_type: 'proof',
    },
  ]

  // State tracking
  let onboardingComplete = false
  let grillQuestionIndex = 0
  let grillCorrectCount = 0
  let grillStreakCorrect = 0
  let grillStreakWrong = 0
  let grillQuestionsAsked = 0

  // -------------------------------------------------------------------------
  // IPC channel handlers
  // -------------------------------------------------------------------------

  const handlers = {
    // --- App ---
    'app:get-info': () => ({
      name: 'MathWeaver',
      version: VERSION,
      electron: 'test',
      platform: 'e2e',
    }),
    'app:log-error': () => null,
    'app:get-backend-url': () => 'mock://test',

    // --- Student ---
    'student:get-id': () => 'test_student_e2e',

    // --- Backend API ---
    'api:health': () => ({
      status: 'ok',
      version: VERSION,
      uptime: 12345,
    }),

    'api:dag': (level) => {
      // If a level is specified, filter nodes; otherwise return all.
      const nodes = level
        ? DAG_NODES.filter(
            (n) => n.difficulty <= 0.6 || n.id === 'group_definition',
          )
        : DAG_NODES
      return {
        nodes,
        edges: [
          { source: 'set_theory', target: 'binary_operation' },
          { source: 'binary_operation', target: 'group_definition' },
          { source: 'group_definition', target: 'subgroup' },
          { source: 'group_definition', target: 'homomorphism' },
          { source: 'subgroup', target: 'cyclic_group' },
          { source: 'subgroup', target: 'normal_subgroup' },
          { source: 'homomorphism', target: 'normal_subgroup' },
          { source: 'normal_subgroup', target: 'sylow_theorem' },
        ],
      }
    },

    'api:curricula': () => ({
      curricula: [
        { id: 'group_theory', name: '群论（大学）', levels: 8 },
        { id: 'linear_algebra', name: '线性代数（大学）', levels: 6 },
        { id: 'high_school', name: '高中数学', levels: 5 },
        { id: 'elementary', name: '小学数学', levels: 3 },
      ],
    }),

    'api:curriculum-dag': (level) => ({
      nodes: DAG_NODES.slice(0, 4),
      edges: [
        { source: 'set_theory', target: 'binary_operation' },
        { source: 'binary_operation', target: 'group_definition' },
      ],
    }),

    'api:dag-path': () => ({
      path: ['set_theory', 'binary_operation', 'group_definition'],
    }),

    'api:session-start': (req) => ({
      session_id: 'sess_' + Date.now(),
      student_id: req.student_id,
      target_node: req.target_node_id || 'group_definition',
      node_name: '群的定义',
      node_description:
        '群是配备二元运算的集合，满足封闭性、结合律、幺元和逆元四条公理',
      phase: 'session_start',
      learning_path: [
        { id: 'set_theory', name: '集合论基础' },
        { id: 'binary_operation', name: '二元运算' },
        { id: 'group_definition', name: '群的定义' },
      ],
    }),

    'api:session-state': () => ({
      session_id: 'sess_state',
      phase: 'dialogue',
      target_node: 'group_definition',
    }),

    'api:session-input': (req) => ({
      response: {
        content:
          '这是一个很好的问题。群是配备二元运算的集合，满足四条公理：封闭性、结合律、存在幺元、每个元素有逆元。',
        action: 'advance',
      },
      phase: 'dialogue',
      four_fields: {
        knowledge: {
          current_node_id: 'group_definition',
          mastery_estimate: 0.45,
          zpd_lower: 0.3,
          zpd_upper: 0.6,
          prerequisite_gaps: [],
          in_zpd: true,
          ready_to_advance: false,
        },
        cognitive: {
          response_time_ms: req.response_time_ms || 5000,
          rt_zscore: 0.2,
          cognitive_load: 0.5,
          state: 'normal',
          is_overloaded: false,
        },
        emotional: {
          anxiety_index: 0.2,
          flow_score: 0.6,
          state: 'engaged',
          is_anxious: false,
          in_flow: true,
        },
        interaction: {
          current_hint_level: 0,
          consecutive_correct: 0,
          scaffold_fade_threshold: 3,
          should_fade_scaffold: false,
          is_struggling: false,
        },
      },
      phase_trace: ['session_start', 'dialogue'],
      decision: {
        action: 'advance',
        reason: '学生表现出对基础概念的理解',
      },
      visual_data: {
        dag_progress: {
          resolved: 2,
          total: 8,
          current: 'group_definition',
        },
        four_field_gauges: {
          cognitive_load: 0.5,
          cognitive_state: 'normal',
          anxiety_index: 0.2,
          flow_score: 0.6,
          hint_dependency: 0,
        },
        mastery_radar: {
          accuracy: 0.65,
          conjecture: 0.3,
          independence: 0.5,
          fluency: 0.4,
          abstraction: 0.35,
          overall: 0.44,
        },
        conjecture_journey: {
          timeline: [],
          refinement_chains: [],
          total_conjectures: 0,
          confirmed: 0,
          refuted: 0,
        },
        difficulty_gauge: {
          current_difficulty: 0.45,
          difficulty_band: 'standard',
          trend: 'stable',
          accuracy_rate: 0.65,
        },
      },
    }),

    'api:verify-group': (table) => ({
      is_closed: true,
      is_associative: true,
      has_identity: true,
      has_inverses: true,
      is_group: true,
      issues: [],
    }),

    'api:find-non-associative': (n) => ({
      found: false,
      table: null,
      message: '未找到非结合的运算表',
    }),

    'api:metrics': () => ({
      total_sessions: 1,
      total_questions: 10,
      correct_rate: 0.6,
      avg_response_time: 5000,
      mastery_distribution: {
        mastered: 2,
        learning: 3,
        not_started: 3,
      },
    }),

    'api:proof-theorems': () => ({
      theorems: THEOREMS,
    }),

    'api:proof-verify': (theoremId, steps, level) => ({
      theorem_name: theoremId || '群的幺元唯一性',
      steps: steps.map((step, i) => ({
        step_number: i + 1,
        claim: step,
        justification: i < steps.length - 1 ? '由群公理可直接推出' : '证明完成',
        is_valid: true,
        feedback: '正确',
        matched_expected: step,
        implicit_steps: [],
      })),
      is_complete: steps.length >= 2,
      missing_steps: steps.length < 2 ? ['需要补充中间步骤'] : [],
      socratic_hint: '思考幺元的定义：满足 e·a = a·e = a',
      overall_feedback: '证明思路清晰，逻辑正确',
      progress: steps.length >= 2 ? '100%' : `${Math.round((steps.length / 2) * 100)}%`,
    }),

    'api:grill-start': (studentId, curriculumLevel) => {
      grillQuestionIndex = 0
      grillCorrectCount = 0
      grillStreakCorrect = 0
      grillStreakWrong = 0
      grillQuestionsAsked = 0
      return {
        grill: {
          active: true,
          current_question: GRILL_QUESTIONS[0],
          difficulty: 0.45,
          questions_asked: 0,
          encouragement: '准备好了吗？开始挑战！',
          summary: {
            active: true,
            total_branches: 5,
            resolved_branches: 0,
            correct_answers: 0,
            progress: '0%',
            adaptive: {
              current_difficulty: 0.45,
              difficulty_band: 'standard',
              target_difficulty: 0.5,
              accuracy_rate: 0,
              streak_correct: 0,
              streak_wrong: 0,
              total_questions: 0,
              total_correct: 0,
              trend: 'stable',
              should_increase: false,
              should_decrease: false,
            },
            encouragement: {},
            branches: {},
          },
        },
      }
    },

    'api:grill-answer': (qid, answer, responseTimeMs) => {
      grillQuestionsAsked++
      const isCorrect = answer && answer.length > 2
      if (isCorrect) {
        grillCorrectCount++
        grillStreakCorrect++
        grillStreakWrong = 0
      } else {
        grillStreakCorrect = 0
        grillStreakWrong++
      }
      grillQuestionIndex = (grillQuestionIndex + 1) % GRILL_QUESTIONS.length
      const nextQ = GRILL_QUESTIONS[grillQuestionIndex]
      const accuracy = grillQuestionsAsked > 0 ? grillCorrectCount / grillQuestionsAsked : 0
      const currentDiff = Math.min(0.45 + grillQuestionsAsked * 0.05, 0.9)

      return {
        grill: {
          active: true,
          current_question: nextQ,
          difficulty: currentDiff,
          questions_asked: grillQuestionsAsked,
          encouragement: isCorrect
            ? '回答正确！继续加油！'
            : '没关系，让我们看下一题。',
          summary: {
            active: true,
            total_branches: 5,
            resolved_branches: Math.min(grillQuestionsAsked, 5),
            correct_answers: grillCorrectCount,
            progress: `${Math.round((grillQuestionsAsked / 5) * 100)}%`,
            adaptive: {
              current_difficulty: currentDiff,
              difficulty_band: currentDiff < 0.3 ? 'warmup' : currentDiff < 0.5 ? 'basic' : currentDiff < 0.7 ? 'standard' : currentDiff < 0.85 ? 'advanced' : 'challenge',
              target_difficulty: Math.min(currentDiff + 0.05, 0.95),
              accuracy_rate: accuracy,
              streak_correct: grillStreakCorrect,
              streak_wrong: grillStreakWrong,
              total_questions: grillQuestionsAsked,
              total_correct: grillCorrectCount,
              trend: accuracy > 0.6 ? 'rising' : accuracy < 0.4 ? 'falling' : 'stable',
              should_increase: accuracy > 0.7,
              should_decrease: accuracy < 0.3,
            },
            encouragement: {},
            branches: {},
          },
        },
      }
    },

    'api:generate-content': (req) => ({
      exercises: [
        {
          id: 'ex1',
          question: '判断 {1, -1} 在乘法下是否构成群',
          answer: '是的，{1, -1} 在乘法下构成二阶循环群',
          difficulty: 0.4,
        },
      ],
      stories: [
        {
          title: 'Galois 的群论之旅',
          content: 'Évariste Galois 在19世纪提出了群论的核心概念...',
        },
      ],
      challenges: [
        {
          title: '构造一个非交换群',
          description: '找出一个最小的非交换群并验证其性质',
          difficulty: 0.7,
        },
      ],
    }),

    // --- Settings ---
    'settings:get': (key) => {
      const defaults = {
        theme: 'dark',
        language: 'zh-CN',
        sound: 'true',
      }
      return defaults[key] ?? null
    },
    'settings:set': (key, value) => true,
    'settings:get-llm-config': () => ({
      provider: 'mock',
      apiKey: '',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 4096,
    }),
    'settings:set-llm-config': (config) => ({ success: true, config }),
    'settings:get-llm-presets': () => [
      {
        id: 'deepseek',
        label: 'DeepSeek',
        provider: 'openai_compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        requiresApiKey: true,
        helpUrl: 'https://platform.deepseek.com/api_keys',
        description: 'DeepSeek Chat API',
      },
      {
        id: 'openai',
        label: 'OpenAI',
        provider: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        requiresApiKey: true,
        helpUrl: 'https://platform.openai.com/api-keys',
        description: 'OpenAI GPT API',
      },
      {
        id: 'ollama',
        label: 'Ollama (本地)',
        provider: 'openai_compatible',
        baseUrl: 'http://localhost:11434/v1',
        defaultModel: 'llama3.2',
        requiresApiKey: false,
        helpUrl: 'https://ollama.ai',
        description: '本地运行的 Ollama 模型',
      },
    ],
    'settings:is-onboarding-complete': () => onboardingComplete,
    'settings:set-onboarding-complete': (value) => {
      onboardingComplete = value
      return true
    },

    // --- File ---
    'file:save-session': (data) => '/tmp/mathweaver-session.json',
    'file:load-session': () => null,
    'file:export-table': (data) => '/tmp/mathweaver-table.csv',
    'file:export-html': (data) => '/tmp/mathweaver-snapshot.html',

    // --- Course generation (LLM) ---
    'api:generate-course': (req) => {
      const topic = (req && req.topic) || '线性代数基础'
      const base = topic.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').slice(0, 12)
      return {
        ok: true,
        count: 3,
        nodes: [
          {
            id: 'gen_' + base + '_1',
            name: `${topic} · 入门`,
            description: `关于「${topic}」的入门概念（演示数据）`,
            prerequisites: [],
            abstraction_level: 1,
            domain: 'generated',
            difficulty: 0.4,
            is_milestone: true,
            learning_objectives: [],
            examples: [],
            assessment_criteria: [],
            estimated_minutes: 30,
            historical_context: '',
            related_theorems: [],
            common_misconceptions: [],
          },
          {
            id: 'gen_' + base + '_2',
            name: `${topic} · 进阶`,
            description: `关于「${topic}」的进阶概念（演示数据）`,
            prerequisites: ['gen_' + base + '_1'],
            abstraction_level: 2,
            domain: 'generated',
            difficulty: 0.6,
            is_milestone: false,
            learning_objectives: [],
            examples: [],
            assessment_criteria: [],
            estimated_minutes: 45,
            historical_context: '',
            related_theorems: [],
            common_misconceptions: [],
          },
          {
            id: 'gen_' + base + '_3',
            name: `${topic} · 综合`,
            description: `关于「${topic}」的综合应用（演示数据）`,
            prerequisites: ['gen_' + base + '_2'],
            abstraction_level: 3,
            domain: 'generated',
            difficulty: 0.8,
            is_milestone: true,
            learning_objectives: [],
            examples: [],
            assessment_criteria: [],
            estimated_minutes: 60,
            historical_context: '',
            related_theorems: [],
            common_misconceptions: [],
          },
        ],
      }
    },

    // --- Conjecture (not in whitelist but used via api.invoke) ---
    'conjecture:test': (req) => {
      const claim = (req && req.claim) || ''
      if (claim.includes('交换') && !claim.includes('唯一')) {
        return {
          verdict: 'refuted',
          counter_example: 'S₃（三阶对称群）是非交换群： (12)(13) ≠ (13)(12)',
          claim,
        }
      }
      if (claim.includes('唯一')) {
        return {
          verdict: 'confirmed',
          counter_example: null,
          claim,
        }
      }
      return {
        verdict: 'undecidable',
        counter_example: null,
        claim,
      }
    },

    // --- Historical narrative ---
    'api:historical-narrative': (req) => {
      const claim = (req && req.claim) || ''
      if (claim.includes('唯一')) {
        return [
          {
            title: '幺元唯一性的历史',
            content: '群的幺元唯一性是群论中最基本的定理之一，由 Galois 在19世纪首次提出。',
            score: 0.95,
          },
          {
            title: '代数结构的早期研究',
            content: 'Cayley 和 Sylvester 在19世纪对代数结构的研究奠定了群论基础。',
            score: 0.7,
          },
        ]
      }
      return [
        {
          title: '群论的发展史',
          content: '群论从 Galois 的方程理论发展到现代抽象代数的核心分支。',
          score: 0.8,
        },
      ]
    },

    // --- Curriculum compare ---
    'api:curriculum-compare': (req) => ({
      structures: [
        {
          name: '群同构',
          domain: '抽象代数',
          definition: '保持运算的双射映射',
          example: '(Z,+) → (Z_n,+) 的商群同构',
          key_properties: ['双射', '保持运算', '核为正规子群'],
        },
        {
          name: '线性同构',
          domain: '线性代数',
          definition: '保持向量空间结构的可逆线性映射',
          example: 'R^n → R^n 的可逆矩阵',
          key_properties: ['线性', '可逆', '保持维度'],
        },
        {
          name: '拓扑同胚',
          domain: '拓扑学',
          definition: '双向连续的双射',
          example: '开区间 (0,1) 同胚于 R',
          key_properties: ['连续', '双射', '逆连续'],
        },
      ],
    }),
  }

  // -------------------------------------------------------------------------
  // Mock API object
  // -------------------------------------------------------------------------

  const mockApi = {
    invoke: async (channel, ...args) => {
      const handler = handlers[channel]
      if (handler) {
        return await handler(...args)
      }
      console.warn('[MockAPI] Unknown channel:', channel)
      return null
    },

    on: (channel, callback) => {
      // No-op: no main process events in test mode
      return () => {}
    },

    send: (channel, ...args) => {
      // No-op
    },

    // Convenience methods — all return Promises to match the real IPC bridge
    health: () => mockApi.invoke('api:health'),
    getDag: (level) => mockApi.invoke('api:dag', level),
    getCurricula: () => mockApi.invoke('api:curricula'),
    getCurriculumDag: (level) => mockApi.invoke('api:curriculum-dag', level),
    startSession: (req) => mockApi.invoke('api:session-start', req),
    getSessionState: () => mockApi.invoke('api:session-state'),
    sendInput: (req) => mockApi.invoke('api:session-input', req),
    verifyGroup: (table) => mockApi.invoke('api:verify-group', table),
    findNonAssociative: (n) => mockApi.invoke('api:find-non-associative', n),
    getMetrics: () => mockApi.invoke('api:metrics'),
    getTheorems: (level) => mockApi.invoke('api:proof-theorems', level),
    submitProof: (theoremId, steps, level) =>
      mockApi.invoke('api:proof-verify', theoremId, steps, level),
    startGrill: (studentId, curriculumLevel) =>
      mockApi.invoke('api:grill-start', studentId, curriculumLevel),
    submitGrillAnswer: (qid, answer, responseTimeMs) =>
      mockApi.invoke('api:grill-answer', qid, answer, responseTimeMs),
    generateContent: (req) => mockApi.invoke('api:generate-content', req),
    getLLMConfig: () => mockApi.invoke('settings:get-llm-config'),
    setLLMConfig: (config) => mockApi.invoke('settings:set-llm-config', config),
    getLLMPresets: () => mockApi.invoke('settings:get-llm-presets'),
    getSetting: (key) => mockApi.invoke('settings:get', key),
    setSetting: (key, value) => mockApi.invoke('settings:set', key, value),
    isOnboardingComplete: () => mockApi.invoke('settings:is-onboarding-complete'),
    setOnboardingComplete: (value) =>
      mockApi.invoke('settings:set-onboarding-complete', value),
    saveSession: (data) => mockApi.invoke('file:save-session', data),
    loadSession: () => mockApi.invoke('file:load-session'),
    exportTable: (data) => mockApi.invoke('file:export-table', data),
    exportSnapshot: (html) => mockApi.invoke('file:export-html', html),
    generateCourse: (topic) => mockApi.invoke('api:generate-course', { topic }),
    getAppInfo: () => mockApi.invoke('app:get-info'),
    getBackendUrl: () => mockApi.invoke('app:get-backend-url'),
  }

  // -------------------------------------------------------------------------
  // Install on window
  // -------------------------------------------------------------------------

  // Use Object.defineProperty so the app's `window.api = ...` assignment
  // (if any) can still work, but the initial value is set here.
  try {
    Object.defineProperty(window, 'api', {
      value: mockApi,
      writable: true,
      configurable: true,
    })
  } catch (e) {
    window.api = mockApi
  }

  // -------------------------------------------------------------------------
  // HTTP fetch interceptor for /api/* endpoints
  // -------------------------------------------------------------------------

  if (typeof fetch === 'function') {
    const originalFetch = window.fetch
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input?.url

      if (url && url.startsWith('/api/')) {
        // Parse the request body
        let body = {}
        if (init && init.body) {
          try {
            body = JSON.parse(init.body)
          } catch {
            // Not JSON
          }
        }

        // Route to mock handler
        if (url === '/api/historical/narrative') {
          const narratives = handlers['api:historical-narrative'](body)
          return new Response(JSON.stringify(narratives), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url === '/api/curriculum/compare') {
          const result = handlers['api:curriculum-compare'](body)
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url === '/api/conjecture/test') {
          const result = handlers['conjecture:test'](body)
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Default: 404
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Pass through to original fetch
      return originalFetch.call(this, input, init)
    }
  }

  console.log('[MockAPI] Installed. version=' + VERSION)
})()
