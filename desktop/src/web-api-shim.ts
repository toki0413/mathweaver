/**
 * Web API Shim — provides a mock backend for standalone web builds.
 *
 * When MathWeaver runs in a browser (without Electron), this shim is
 * injected before the app boots. It implements the same `window.api`
 * interface as the Electron preload bridge, but returns mock data
 * instead of calling a real backend.
 *
 * This allows users to try MathWeaver instantly in a browser without
 * installing anything — lowering the barrier to entry significantly.
 */

// ---------------------------------------------------------------------------
// Mock data generators
// ---------------------------------------------------------------------------

const MOCK_DAG_NODES = [
  {
    id: 'group_definition',
    name: '群的定义',
    description: '群是具有一个二元运算的集合，满足封闭性、结合律、有幺元、有逆元。',
    prerequisites: [],
    abstraction_level: 1,
    difficulty: 0.3,
    is_milestone: true,
  },
  {
    id: 'subgroup',
    name: '子群',
    description: '群的子集在群的运算下仍构成群。',
    prerequisites: ['group_definition'],
    abstraction_level: 2,
    difficulty: 0.4,
    is_milestone: false,
  },
  {
    id: 'cyclic_group',
    name: '循环群',
    description: '由单个元素生成的群。',
    prerequisites: ['group_definition'],
    abstraction_level: 2,
    difficulty: 0.4,
    is_milestone: false,
  },
  {
    id: 'coset',
    name: '陪集',
    description: '群的子群在群中的左/右陪集。',
    prerequisites: ['subgroup'],
    abstraction_level: 3,
    difficulty: 0.6,
    is_milestone: false,
  },
  {
    id: 'quotient_group',
    name: '商群',
    description: '正规子群的陪集构成的群。',
    prerequisites: ['coset'],
    abstraction_level: 4,
    difficulty: 0.7,
    is_milestone: true,
  },
  {
    id: 'symmetric_group',
    name: '对称群',
    description: 'n 个元素的全体置换构成的群。',
    prerequisites: ['group_definition'],
    abstraction_level: 3,
    difficulty: 0.6,
    is_milestone: true,
  },
  {
    id: 'homomorphism',
    name: '同态与同构',
    description: '保持群结构的映射。',
    prerequisites: ['group_definition'],
    abstraction_level: 4,
    difficulty: 0.7,
    is_milestone: true,
  },
  {
    id: 'direct_product',
    name: '直积',
    description: '两个群的笛卡尔积。',
    prerequisites: ['group_definition'],
    abstraction_level: 3,
    difficulty: 0.5,
    is_milestone: false,
  },
]

const MOCK_RESPONSES = [
  '让我来帮你分析这个问题。\n\n首先，我们需要理解群的基本定义：一个群 $(G, \\cdot)$ 是一个集合 $G$ 配上一个二元运算 $\\cdot$，满足：\n1. **封闭性**：$\\forall a, b \\in G, a \\cdot b \\in G$\n2. **结合律**：$\\forall a, b, c \\in G, (a \\cdot b) \\cdot c = a \\cdot (b \\cdot c)$\n3. **幺元**：$\\exists e \\in G, \\forall a \\in G, e \\cdot a = a \\cdot e = a$\n4. **逆元**：$\\forall a \\in G, \\exists a^{-1} \\in G, a \\cdot a^{-1} = e$',
  '很好的问题！让我们通过反例来理解。\n\n考虑集合 $\\{0, 1, 2\\}$ 上的运算表：\n$$\\begin{array}{c|ccc} & 0 & 1 & 2 \\\\ 0 & 0 & 1 & 2 \\\\ 1 & 1 & 2 & 0 \\\\ 2 & 2 & 0 & 1 \\end{array}$$\n\n这就是 $\\mathbb{Z}_3$ 的加法群，是一个循环群。',
  '这个思路很棒！根据**拉格朗日定理**，子群的阶整除群的阶。\n\n$$|H| \\mid |G|$$\n\n这意味着如果 $|G| = 6$，那么子群的阶只能是 1, 2, 3, 或 6。',
  '观察得很仔细！这里涉及到**同态**的概念。\n\n如果 $\\phi: G \\to H$ 是群同态，那么：\n- $\\phi(e_G) = e_H$\n- $\\phi(a^{-1}) = \\phi(a)^{-1}$\n- $\\ker(\\phi) \\trianglelefteq G$',
]

let responseIndex = 0

// ---------------------------------------------------------------------------
// Mock API implementation
// ---------------------------------------------------------------------------

const mockApi = {
  invoke: async (_channel: string, ..._args: unknown[]): Promise<unknown> => {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 200))
    return null
  },

  on:
    (_channel: string, _callback: (data: unknown) => void): (() => void) =>
    () => {},

  send: (_channel: string, ..._args: unknown[]) => {},

  // Health — always returns OK in web mode
  health: async () => ({ status: 'ok', mode: 'web-demo', backend: 'mock' }),

  // DAG
  getDag: async () => ({ nodes: MOCK_DAG_NODES, edges: [] }),
  getCurricula: async () => ({ levels: ['undergraduate', 'graduate'] }),
  getCurriculumDag: async (level: string) => ({ nodes: MOCK_DAG_NODES, edges: [], level }),

  // Session
  startSession: async (req: { student_id: string; target_node_id?: string }) => {
    const node = MOCK_DAG_NODES.find(n => n.id === (req.target_node_id || 'group_definition'))
    return {
      session_id: `web-session-${Date.now()}`,
      target_node: req.target_node_id || 'group_definition',
      node_name: node?.name || '群的定义',
      node_description: node?.description || '',
      learning_path: MOCK_DAG_NODES.slice(0, 3).map(n => ({ name: n.name })),
      phase: 'PERCEIVE',
    }
  },

  getSessionState: async () => ({
    session_id: `web-session-${Date.now()}`,
    phase: 'IDLE',
  }),

  sendInput: async (req: { student_input: string; response_time_ms?: number }) => {
    const response = MOCK_RESPONSES[responseIndex % MOCK_RESPONSES.length]
    responseIndex++
    return {
      response: {
        content: response,
        action: 'EXPLAIN',
      },
      phase: 'REFLECT',
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
          rt_zscore: 0.1,
          cognitive_load: 0.4,
          state: 'engaged',
          is_overloaded: false,
        },
        emotional: {
          anxiety_index: 0.2,
          flow_score: 0.7,
          state: 'flow',
          is_anxious: false,
          in_flow: true,
        },
        interaction: {
          current_hint_level: 1,
          consecutive_correct: 1,
          scaffold_fade_threshold: 3,
          should_fade_scaffold: false,
          is_struggling: false,
        },
      },
      phase_trace: [
        'PERCEIVE',
        'ABSTRACT',
        'VERIFY',
        'DIAGNOSE',
        'REFLECT',
        'COLLABORATE',
        'DELIVER',
      ],
      decision: { action: 'continue', reason: '学生表现良好，继续推进' },
      visual_data: {
        four_field_gauges: {
          cognitive_load: 0.4,
          cognitive_state: '专注',
          anxiety_index: 0.2,
          flow_score: 0.7,
          hint_dependency: 0.3,
        },
        mastery_radar: {
          accuracy: 0.7,
          conjecture: 0.5,
          independence: 0.6,
          fluency: 0.65,
          abstraction: 0.4,
          overall: 0.57,
        },
      },
    }
  },

  // Forge
  verifyGroup: async (table: number[][]) => {
    const n = table.length
    // Basic checks
    const closed = table.every(row => row.every(v => v >= 0 && v < n))
    return {
      is_group: closed,
      is_abelian: closed,
      has_identity: true,
      has_inverses: true,
      is_associative: true,
      order: n,
      details: {
        closure: closed ? '通过' : '失败',
        associativity: '通过',
        identity: '通过',
        inverses: '通过',
      },
    }
  },

  findNonAssociative: async (n: number) => ({
    found: n >= 3,
    table:
      n >= 3
        ? [
            [0, 1, 2],
            [1, 1, 0],
            [2, 0, 2],
          ]
        : null,
    reason: n >= 3 ? '找到了非结合运算表' : '阶数太小',
  }),

  // Metrics
  getMetrics: async () => ({
    total_sessions: 1,
    total_interactions: responseIndex,
    avg_response_time: 3500,
  }),

  // Proof
  getTheorems: async () => ({
    theorems: ['Lagrange 定理', '群的幺元唯一性', '逆元唯一性', '循环群的子群结构'],
  }),

  submitProof: async (theoremId: string, steps: string[]) => ({
    theorem_name: theoremId,
    steps: steps.map((s, i) => ({
      step_number: i + 1,
      claim: s,
      justification: '验证通过',
      is_valid: true,
      feedback: '正确',
      matched_expected: '',
      implicit_steps: [],
    })),
    is_complete: true,
    missing_steps: [],
    socratic_hint: '',
    overall_feedback: '证明完整，逻辑清晰。',
    progress: '100%',
  }),

  // Grill
  startGrill: async () => ({
    grill: {
      active: true,
      current_question: {
        qid: 'q1',
        concept_node_id: 'group_definition',
        concept_name: '群的定义',
        question: '什么是群？请列出群的四个公理。',
        recommended_answer: '封闭性、结合律、幺元、逆元',
        difficulty: 0.4,
        branch_type: 'definition',
      },
      difficulty: 0.4,
      encouragement: '开始面试！',
      summary: null,
    },
  }),

  submitGrillAnswer: async (_qid: string, _answer: string) => ({
    grill: {
      active: true,
      current_question: {
        qid: 'q2',
        concept_node_id: 'subgroup',
        concept_name: '子群',
        question: '子群的判定条件是什么？',
        recommended_answer: '非空子集对运算封闭，且对逆元封闭',
        difficulty: 0.5,
        branch_type: 'theorem',
      },
      difficulty: 0.5,
      encouragement: '继续加油！',
      summary: {
        active: true,
        total_branches: 3,
        resolved_branches: 1,
        correct_answers: 1,
        progress: '33%',
        adaptive: {
          current_difficulty: 0.5,
          difficulty_band: '中级',
          target_difficulty: 0.6,
          accuracy_rate: 1.0,
          streak_correct: 1,
          streak_wrong: 0,
          total_questions: 1,
          total_correct: 1,
          trend: '上升',
          should_increase: true,
          should_decrease: false,
        },
        encouragement: {},
        branches: {},
      },
    },
  }),

  // Settings
  getLLMConfig: async () => ({
    provider: 'mock',
    apiKey: '',
    baseUrl: '',
    model: 'demo',
    temperature: 0.7,
    maxTokens: 2048,
  }),

  setLLMConfig: async (config: Record<string, unknown>) => ({
    success: true,
    config: {
      provider: 'mock',
      apiKey: '',
      baseUrl: '',
      model: 'demo',
      temperature: 0.7,
      maxTokens: 2048,
      ...config,
    },
  }),

  getLLMPresets: async () => [
    {
      id: 'mock',
      label: '演示模式 (Web)',
      provider: 'mock',
      baseUrl: '',
      defaultModel: 'demo',
      requiresApiKey: false,
      helpUrl: '',
      description: 'Web 演示模式，无需配置',
    },
  ],

  getSetting: async (_key: string) => null,
  setSetting: async (_key: string, _value: unknown) => true,
  isOnboardingComplete: async () => false,
  setOnboardingComplete: async (_value: boolean) => true,

  // File operations — use browser download instead
  saveSession: async (data: string) => {
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mathweaver-session.json'
    a.click()
    URL.revokeObjectURL(url)
    return 'mathweaver-session.json'
  },

  loadSession: async () => {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsText(file)
      }
      input.click()
    })
  },

  exportTable: async (data: string) => {
    const blob = new Blob([data], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cayley-table.txt'
    a.click()
    URL.revokeObjectURL(url)
    return 'cayley-table.txt'
  },

  // App
  getAppInfo: async () => ({
    name: 'MathWeaver',
    version: '0.3.0-web',
    electron: 'N/A (Web)',
    chrome: navigator.userAgent,
    node: 'N/A (Web)',
    platform: 'web',
  }),

  getBackendUrl: async () => 'web-mock',
}

// ---------------------------------------------------------------------------
// Inject the mock API when running in a browser without Electron
// ---------------------------------------------------------------------------

function injectWebApi() {
  const w = window as unknown as { api?: typeof mockApi }
  if (!w.api) {
    w.api = mockApi
    console.log('[MathWeaver Web] Mock API injected — running in web demo mode')
  }
}

injectWebApi()
