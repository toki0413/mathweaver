/**
 * Mock Electron API for browser-based testing.
 * Injects window.api and window.electronAPI with realistic mock data.
 */

(function () {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

  // --- Mock DAG data ---
  const mockDagNodes = [
    { id: 'set_basics', name: '集合基础', description: '集合、元素、子集', prerequisites: [], abstraction_level: 0, difficulty: 0.2, is_milestone: true, mastery: 0.85, status: 'mastered', is_current: false, domain: 'group_theory' },
    { id: 'function_basics', name: '函数基础', description: '映射、单射、满射', prerequisites: ['set_basics'], abstraction_level: 0, difficulty: 0.3, is_milestone: false, mastery: 0.5, status: 'needs_review', is_current: false, domain: 'group_theory' },
    { id: 'group_definition', name: '群的定义', description: '群、幺元、逆元', prerequisites: ['set_basics', 'function_basics'], abstraction_level: 1, difficulty: 0.4, is_milestone: true, mastery: 0.35, status: 'current', is_current: true, domain: 'group_theory' },
    { id: 'subgroup', name: '子群', description: '子群、陪集', prerequisites: ['group_definition'], abstraction_level: 1, difficulty: 0.5, is_milestone: false, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'cyclic_group', name: '循环群', description: '循环群、生成元', prerequisites: ['group_definition'], abstraction_level: 1, difficulty: 0.45, is_milestone: false, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'normal_subgroup', name: '正规子群', description: '正规子群、商群', prerequisites: ['subgroup'], abstraction_level: 2, difficulty: 0.6, is_milestone: true, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'homomorphism', name: '同态', description: '群同态、核', prerequisites: ['group_definition', 'normal_subgroup'], abstraction_level: 2, difficulty: 0.65, is_milestone: true, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'isomorphism_theorem', name: '同构定理', description: '三大同构定理', prerequisites: ['homomorphism'], abstraction_level: 3, difficulty: 0.8, is_milestone: true, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'ring_definition', name: '环的定义', description: '环、整环、域', prerequisites: ['group_definition'], abstraction_level: 2, difficulty: 0.55, is_milestone: false, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
    { id: 'field_definition', name: '域', description: '域的公理体系', prerequisites: ['ring_definition'], abstraction_level: 3, difficulty: 0.7, is_milestone: true, mastery: 0, status: 'locked', is_current: false, domain: 'group_theory' },
  ]

  // --- Mock four fields ---
  function mockFourFields() {
    return {
      knowledge: {
        current_node_id: 'group_definition',
        mastery_estimate: 0.35,
        zpd_lower: 0.2,
        zpd_upper: 0.6,
        prerequisite_gaps: ['function_basics'],
        in_zpd: true,
        ready_to_advance: false,
      },
      cognitive: {
        response_time_ms: 12500,
        rt_zscore: 0.8,
        cognitive_load: 0.72,
        state: 'moderate_load',
        is_overloaded: false,
      },
      emotional: {
        anxiety_index: 0.3,
        flow_score: 0.55,
        state: 'engaged',
        is_anxious: false,
        in_flow: false,
      },
      interaction: {
        current_hint_level: 2,
        consecutive_correct: 1,
        scaffold_fade_threshold: 3,
        should_fade_scaffold: false,
        is_struggling: false,
      },
    }
  }

  // --- Mock visual data ---
  function mockVisualData() {
    return {
      four_field_gauges: {
        cognitive_load: 0.72,
        cognitive_state: 'moderate_load',
        anxiety_index: 0.3,
        flow_score: 0.55,
        hint_dependency: 0.4,
      },
      mastery_radar: {
        accuracy: 0.65,
        conjecture: 0.4,
        independence: 0.5,
        fluency: 0.6,
        abstraction: 0.3,
        overall: 0.49,
      },
      conjecture_journey: {
        timeline: [
          { step: 1, claim: '所有群都是交换群', verdict: 'refuted', counter_example: 'S3', is_refinement: false },
          { step: 2, claim: '所有阿贝尔群都是循环群', verdict: 'refuted', counter_example: 'Klein four-group V4', is_refinement: false },
          { step: 3, claim: '有限阿贝尔群可分解为循环群的直积', verdict: 'confirmed', counter_example: null, is_refinement: false },
        ],
        refinement_chains: [{ steps: [1, 2, 3], claim: '有限阿贝尔群结构定理' }],
        total_conjectures: 3,
        confirmed: 1,
        refuted: 2,
      },
      difficulty_gauge: {
        current_difficulty: 0.5,
        difficulty_band: 'standard',
        trend: 'rising',
        accuracy_rate: 0.6,
      },
      dag_progress: {
        total_nodes: 10,
        mastered_nodes: 3,
        current_node: 'group_definition',
        progress_percent: 0.3,
      },
    }
  }

  // --- Mock grill question ---
  let grillQuestionCounter = 0
  function mockGrillQuestion() {
    grillQuestionCounter++
    const questions = [
      { qid: 'q1', concept_node_id: 'group_definition', concept_name: '群的定义', question: '什么是群？请给出群的三条公理。', recommended_answer: '群是一个非空集合G配上一个二元运算·，满足：1)封闭性 2)结合律 3)存在幺元 4)每个元素有逆元', difficulty: 0.4, branch_type: 'definition' },
      { qid: 'q2', concept_node_id: 'group_definition', concept_name: '群的定义', question: '证明：群的幺元是唯一的。', recommended_answer: '设e和e\'都是幺元，则e = e·e\' = e\'', difficulty: 0.5, branch_type: 'proof' },
      { qid: 'q3', concept_node_id: 'group_definition', concept_name: '群的定义', question: '群的逆元是否唯一？为什么？', recommended_answer: '唯一。若a有两个逆元b和c，则b = b·e = b·(a·c) = (b·a)·c = e·c = c', difficulty: 0.55, branch_type: 'uniqueness' },
      { qid: 'q4', concept_node_id: 'subgroup', concept_name: '子群', question: '什么是子群？如何判定子群？', recommended_answer: 'H是G的子群当且仅当H非空且对任意a,b∈H有ab^{-1}∈H', difficulty: 0.6, branch_type: 'definition' },
      { qid: 'q5', concept_node_id: 'cyclic_group', concept_name: '循环群', question: '什么是循环群？给出一个例子。', recommended_answer: '由单个元素生成的群称为循环群，如(Z,+)由1生成', difficulty: 0.45, branch_type: 'definition' },
    ]
    return questions[Math.min(grillQuestionCounter - 1, questions.length - 1)]
  }

  // --- Mock theorems ---
  const mockTheorems = [
    '群的幺元唯一性',
    '群的逆元唯一性',
    '消去律',
    '子群判定定理',
    'Lagrange定理',
    '循环群结构定理',
    '同态基本定理',
    '第一同构定理',
  ]

  // --- Mock proof result ---
  function mockProofResult(theoremName, steps) {
    const results = steps.map((step, i) => ({
      step_number: i + 1,
      claim: step,
      justification: i < steps.length - 1 ? '使用了群公理' : '需要补充中间步骤',
      is_valid: i < steps.length - 1,
      feedback: i < steps.length - 1 ? '正确' : '此步跳转过大，建议添加中间步骤',
      matched_expected: `Expected step ${i + 1}`,
      implicit_steps: i === steps.length - 1 ? ['利用结合律', '利用逆元定义'] : [],
    }))
    const allValid = results.every((r) => r.is_valid)
    return {
      theorem_name: theoremName,
      steps: results,
      is_complete: allValid,
      missing_steps: allValid ? [] : ['需要补充消去律的证明'],
      socratic_hint: allValid ? '证明完整，思路清晰' : '你能解释为什么最后一步成立吗？',
      overall_feedback: allValid ? '优秀的证明！' : '基本思路正确，但需要完善细节。',
      progress: allValid ? '100%' : `${Math.round((results.filter(r => r.is_valid).length / results.length) * 100)}%`,
    }
  }

  // --- Mock chat responses ---
  const chatResponses = [
    '很好！你正确地识别了群的结构。让我们深入看看 $Z_3$ 的性质。\n\n注意 $1 + 1 = 2$，$1 + 2 = 0$（模3），这正是循环群 $C_3$ 的结构。',
    '你的运算表满足群的四条公理：\n1. **封闭性** ✓\n2. **结合律** ✓\n3. **幺元** 为 $0$ ✓\n4. **逆元** 每个元素的逆元存在 ✓\n\n这是一个有效的群！',
    '让我分析一下你的答案...\n\n$Z_3$ 是一个阿贝尔群（交换群），因为 $a + b = b + a$ 对所有元素成立。\n\n这个群也是循环群，由 $1$ 生成：$\\langle 1 \\rangle = \\{0, 1, 2\\}$。',
  ]
  let chatResponseIndex = 0

  // --- Settings ---
  let mockSettings = {
    studentId: 'test_student_001',
    onboardingComplete: false,
  }
  let mockLLMConfig = {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.7,
    maxTokens: 2048,
  }
  const mockLLMPresets = [
    { id: 'deepseek', label: 'DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', requiresApiKey: true, helpUrl: 'https://platform.deepseek.com', description: '性价比高的云端 API' },
    { id: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', requiresApiKey: true, helpUrl: 'https://platform.openai.com', description: 'GPT 系列模型' },
    { id: 'ollama', label: 'Ollama (本地)', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', defaultModel: 'qwen2.5:7b', requiresApiKey: false, helpUrl: 'https://ollama.ai', description: '完全本地运行，无需网络' },
    { id: 'lmstudio', label: 'LM Studio (本地)', provider: 'lmstudio', baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', requiresApiKey: false, helpUrl: 'https://lmstudio.ai', description: '本地模型推理' },
    { id: 'custom', label: '自定义端点', provider: 'custom', baseUrl: '', defaultModel: '', requiresApiKey: false, helpUrl: '', description: '兼容 OpenAI 格式的自定义端点' },
  ]

  // --- Build the mock API ---
  const mockApi = {
    invoke: async (channel, ...args) => {
      console.log('[Mock IPC invoke]', channel, args)
      await delay(200)
      switch (channel) {
        case 'app:get-info': return { version: '0.2.0', name: 'MathWeaver', electron: '31.7.7' }
        case 'student:get-id': return mockSettings.studentId
        case 'api:health': return { status: 'ok', version: '0.2.0' }
        case 'api:dag': return { nodes: mockDagNodes }
        case 'api:curricula': return ['group_theory', 'linear_algebra', 'calculus', 'number_theory']
        case 'api:session-start': return {
          session_id: 'mock_session_001',
          target_node: args[0]?.target_node_id || 'group_definition',
          node_name: '群的定义',
          node_description: '群是一个非空集合 G 配上一个二元运算 ·，满足封闭性、结合律、存在幺元和逆元四条公理。',
          phase: 'exploration',
          learning_path: [
            { name: '集合基础' }, { name: '函数基础' }, { name: '群的定义' },
          ],
        }
        case 'api:session-input': {
          await delay(800)
          const resp = chatResponses[chatResponseIndex % chatResponses.length]
          chatResponseIndex++
          return {
            response: { content: resp, action: 'explore' },
            phase: 'exploration',
            four_fields: mockFourFields(),
            phase_trace: ['perception', 'abstraction', 'counter_example', 'epistemic', 'historical', 'collaboration', 'meta'],
            decision: { action: 'continue', reason: '学生在ZPD内，继续当前路径' },
            visual_data: mockVisualData(),
          }
        }
        case 'api:verify-group': {
          await delay(500)
          return { is_group: true, message: '运算表定义了一个有效的群', group_type: 'cyclic', order: args[0]?.length || 3 }
        }
        case 'api:metrics': return { sessions: 5, interactions: 42, avg_response_time: 8500 }
        case 'api:proof-theorems': return { theorems: mockTheorems }
        case 'api:proof-verify': {
          await delay(600)
          return mockProofResult(args[0] || '群的幺元唯一性', args[1] || [''])
        }
        case 'api:grill-start': {
          await delay(500)
          return {
            grill: {
              active: true,
              current_question: mockGrillQuestion(),
              difficulty: 0.5,
              encouragement: '让我们开始面试吧！',
              summary: {
                active: true,
                total_branches: 4,
                resolved_branches: 0,
                correct_answers: 0,
                progress: '0/4',
                adaptive: {
                  current_difficulty: 0.5,
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
        }
        case 'api:grill-answer': {
          await delay(700)
          grillQuestionCounter++
          return {
            grill: {
              active: true,
              current_question: mockGrillQuestion(),
              difficulty: 0.5 + (grillQuestionCounter * 0.05),
              encouragement: grillQuestionCounter % 2 === 0 ? '回答正确！难度提升' : '没关系，继续努力！',
              summary: {
                active: true,
                total_branches: 4,
                resolved_branches: Math.floor(grillQuestionCounter / 2),
                correct_answers: Math.floor(grillQuestionCounter / 2),
                progress: `${Math.floor(grillQuestionCounter / 2)}/4`,
                adaptive: {
                  current_difficulty: 0.5 + (grillQuestionCounter * 0.05),
                  difficulty_band: 'standard',
                  target_difficulty: 0.6,
                  accuracy_rate: 0.5,
                  streak_correct: grillQuestionCounter % 2,
                  streak_wrong: (grillQuestionCounter + 1) % 2,
                  total_questions: grillQuestionCounter,
                  total_correct: Math.floor(grillQuestionCounter / 2),
                  trend: 'rising',
                  should_increase: grillQuestionCounter % 2 === 0,
                  should_decrease: false,
                },
                encouragement: {},
                branches: {},
              },
            },
          }
        }
        case 'settings:get': return mockSettings[args[0]]
        case 'settings:set': mockSettings[args[0]] = args[1]; return { success: true }
        case 'settings:get-llm-config': return mockLLMConfig
        case 'settings:set-llm-config': mockLLMConfig = { ...mockLLMConfig, ...args[0] }; return { success: true, config: mockLLMConfig }
        case 'settings:get-llm-presets': return mockLLMPresets
        case 'settings:is-onboarding-complete': return mockSettings.onboardingComplete
        case 'settings:set-onboarding-complete': mockSettings.onboardingComplete = args[0]; return { success: true }
        case 'file:save-session': return '/tmp/mathweaver_session.json'
        case 'file:load-session': return null
        default: return null
      }
    },
    on: (channel, callback) => {
      console.log('[Mock IPC on]', channel)
      return () => {}
    },
    send: (channel, ...args) => { console.log('[Mock IPC send]', channel, args) },
    health: function () { return this.invoke('api:health') },
    getDag: function (level) { return this.invoke('api:dag', level) },
    getCurricula: function () { return this.invoke('api:curricula') },
    getCurriculumDag: function (level) { return this.invoke('api:curriculum-dag', level) },
    startSession: function (req) { return this.invoke('api:session-start', req) },
    getSessionState: function () { return this.invoke('api:session-state') },
    sendInput: function (req) { return this.invoke('api:session-input', req) },
    verifyGroup: function (table) { return this.invoke('api:verify-group', table) },
    findNonAssociative: function (n) { return this.invoke('api:find-non-associative', n) },
    getMetrics: function () { return this.invoke('api:metrics') },
    getTheorems: function (level) { return this.invoke('api:proof-theorems', level) },
    submitProof: function (theoremId, steps, level) { return this.invoke('api:proof-verify', theoremId, steps, level) },
    startGrill: function (studentId, curriculumLevel) { return this.invoke('api:grill-start', studentId, curriculumLevel) },
    submitGrillAnswer: function (qid, answer, responseTimeMs) { return this.invoke('api:grill-answer', qid, answer, responseTimeMs) },
    getLLMConfig: function () { return this.invoke('settings:get-llm-config') },
    setLLMConfig: function (config) { return this.invoke('settings:set-llm-config', config) },
    getLLMPresets: function () { return this.invoke('settings:get-llm-presets') },
    getSetting: function (key) { return this.invoke('settings:get', key) },
    setSetting: function (key, value) { return this.invoke('settings:set', key, value) },
    isOnboardingComplete: function () { return this.invoke('settings:is-onboarding-complete') },
    setOnboardingComplete: function (value) { return this.invoke('settings:set-onboarding-complete', value) },
    saveSession: function (data) { return this.invoke('file:save-session', data) },
    loadSession: function () { return this.invoke('file:load-session') },
    exportTable: function (data) { return this.invoke('file:export-table', data) },
    getAppInfo: function () { return this.invoke('app:get-info') },
    getBackendUrl: async function () { return 'mock://in-process' },
  }

  window.api = mockApi
  window.electronAPI = mockApi
  console.log('[Mock API] Electron API injected for browser testing')
})()
