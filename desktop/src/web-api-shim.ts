/**
 * Web API Shim — provides a backend for standalone web builds.
 *
 * When MathWeaver runs in a browser (without Electron), this shim is
 * injected before the app boots. It implements the same `window.api`
 * interface as the Electron preload bridge.
 *
 * Supports two modes:
 *   1. Mock mode — no API key configured, returns canned responses
 *   2. Real LLM mode — user configures a provider (DeepSeek, OpenAI,
 *      Claude, Gemini, Ollama, etc.), and this shim calls the real API
 *
 * LLM config is persisted in localStorage.
 */

import {
  chatCompletion,
  testConnection,
  getPresets,
  getSystemPrompt,
  type LLMConfig,
  type LLMMessage,
} from './utils/llmAdapter'

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
// LLM Config persistence (localStorage)
// ---------------------------------------------------------------------------

const LLM_CONFIG_KEY = 'mathweaver:llm-config'

function loadStoredConfig(): LLMConfig | null {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LLMConfig
    // Never log or expose the API key
    return parsed
  } catch {
    return null
  }
}

function saveStoredConfig(config: LLMConfig): void {
  try {
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // localStorage might be unavailable in some contexts
  }
}

function getDefaultConfig(): LLMConfig {
  return {
    provider: 'mock',
    providerType: 'openai-compatible',
    apiKey: '',
    baseUrl: '',
    model: 'demo',
    temperature: 0.7,
    maxTokens: 2048,
  }
}

function getActiveConfig(): LLMConfig {
  return loadStoredConfig() || getDefaultConfig()
}

function isRealLLM(config: LLMConfig): boolean {
  return config.provider !== 'mock' && !!config.baseUrl && !!config.model
}

/**
 * Call the real LLM with the student's input.
 * Returns the AI response content, or falls back to mock on error.
 */
async function callLLM(userInput: string, ageLevel?: string): Promise<string> {
  const config = getActiveConfig()
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: getSystemPrompt(ageLevel || 'tweens'),
    },
    { role: 'user', content: userInput },
  ]

  const resp = await chatCompletion(config, messages)
  return resp.content
}

// ---------------------------------------------------------------------------
// Mock API implementation
// ---------------------------------------------------------------------------

const mockApi = {
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 200))

    // Handle known IPC channels with mock responses
    switch (channel) {
      case 'student:get-id':
        return `web-student-${Date.now().toString(36)}`

      case 'conjecture:test': {
        const arg = (args[0] as { claim?: string; node_id?: string } | undefined) ?? {}
        const claim = arg.claim || ''

        // --- Real LLM mode ---
        const config = getActiveConfig()
        if (isRealLLM(config)) {
          try {
            const messages: LLMMessage[] = [
              {
                role: 'system',
                content:
                  '你是一个数学问题检查器。评估学生提出的数学猜想的：1) 良构性 2) 数学意义 3) 新颖性。用 JSON 格式返回：{"wellFormed":bool,"meaningful":bool,"novel":bool,"verdict":"plausible|refuted|undecidable","feedback":"中文反馈"}',
              },
              { role: 'user', content: claim },
            ]
            const resp = await chatCompletion(config, messages)
            try {
              const parsed = JSON.parse(resp.content)
              return {
                verdict: parsed.verdict || 'undecidable',
                counter_example: parsed.verdict === 'refuted' ? parsed.feedback : null,
                claim,
                message: parsed.feedback || '检查完成',
              }
            } catch {
              // LLM didn't return valid JSON, use as plain feedback
              return {
                verdict: 'undecidable',
                counter_example: null,
                claim,
                message: resp.content.substring(0, 500),
              }
            }
          } catch (e) {
            console.error('[MathWeaver] LLM conjecture check failed:', e)
            // Fall through to mock
          }
        }

        // --- Mock mode (fallback) ---
        const lowerClaim = claim.toLowerCase()
        if (
          lowerClaim.includes('true') ||
          lowerClaim.includes('成立') ||
          lowerClaim.includes('正确')
        ) {
          return {
            verdict: 'plausible',
            counter_example: null,
            claim,
            message: '[演示数据] 该猜想看起来是合理的，但需要严格证明。',
          }
        }
        if (
          lowerClaim.includes('false') ||
          lowerClaim.includes('不成立') ||
          lowerClaim.includes('错误')
        ) {
          return {
            verdict: 'refuted',
            counter_example: '[演示数据] 存在反例',
            claim,
            message: '[演示数据] 该猜想存在反例。',
          }
        }
        return {
          verdict: 'undecidable',
          counter_example: null,
          claim,
          message: '[演示数据] 无法确定此猜想的正确性，请尝试更具体的表述。',
        }
      }

      case 'app:log-error':
        // Error logging — silently acknowledge
        return { success: true }

      default:
        return null
    }
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

  sendInput: async (req: {
    student_input: string
    response_time_ms?: number
    age_level?: string
  }) => {
    const config = getActiveConfig()

    // --- Real LLM mode ---
    if (isRealLLM(config)) {
      try {
        const aiContent = await callLLM(req.student_input, req.age_level)
        return {
          response: { content: aiContent, action: 'EXPLAIN' },
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
      } catch (e) {
        // LLM 调用失败 — 返回明确标注的回退回复，而非静默 mock
        console.error('[MathWeaver] LLM call failed, falling back to mock:', e)
        responseIndex++
        return {
          response: {
            content:
              '[LLM 调用失败，以下为演示回复]\n\n' +
              MOCK_RESPONSES[responseIndex % MOCK_RESPONSES.length],
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
      }
    }

    // --- Mock mode (no API key configured) ---
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

  submitProof: async (theoremId: string, steps: string[]) => {
    // Evaluate each step: non-empty steps with mathematical content are valid
    const validSteps = steps.map((s, i) => {
      const trimmed = s.trim()
      const hasMathContent =
        trimmed.length > 0 &&
        (/[=∈·∑∏∀∃]/.test(trimmed) ||
          /[\u4e00-\u9fff]{2,}/.test(trimmed) || // Chinese math terms
          /[a-zA-Z]{2,}/.test(trimmed)) // Latin terms
      return {
        step_number: i + 1,
        claim: s,
        justification: hasMathContent ? '步骤已验证' : '步骤缺乏数学内容',
        is_valid: hasMathContent,
        feedback: hasMathContent ? '✓ 步骤有效' : '✗ 步骤无效，请补充数学论断',
        matched_expected: '',
        implicit_steps: [] as string[],
      }
    })
    const validCount = validSteps.filter(s => s.is_valid).length
    const isComplete = validCount > 0 && validCount === steps.length
    return {
      theorem_name: theoremId,
      steps: validSteps,
      is_complete: isComplete,
      missing_steps: isComplete ? [] : ['补充更完整的证明步骤'],
      socratic_hint: '',
      overall_feedback: isComplete
        ? `证明完整，${validCount}/${steps.length} 步全部有效。`
        : `已提交 ${steps.length} 步，其中 ${validCount} 步有效。`,
      progress: `${validCount}/${steps.length}`,
    }
  },

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

  // Dynamic Content Generation
  generateContent: async (req: Record<string, unknown>) => {
    const type = (req.type as string) || 'exercise'
    const topic = (req.topic as string) || '群论'
    const difficulty = (req.difficulty as number) || 0.5
    const ageLevel = (req.ageLevel as string) || 'tweens'

    // --- Real LLM mode ---
    const config = getActiveConfig()
    if (isRealLLM(config)) {
      try {
        const promptMap: Record<string, string> = {
          exercise: `请出一道关于「${topic}」的练习题。难度: ${difficulty}。包含题目、提示和参考答案。`,
          story: `请讲一个关于「${topic}」的数学故事，要有趣且富有教育意义。`,
          challenge: `请出一道关于「${topic}」的挑战题，需要有相当的深度。`,
        }
        const messages: LLMMessage[] = [
          { role: 'system', content: getSystemPrompt(ageLevel) },
          { role: 'user', content: promptMap[type] || promptMap.exercise },
        ]
        const resp = await chatCompletion(config, messages)
        return {
          type,
          topic,
          title: `${type === 'exercise' ? '练习题' : type === 'story' ? '数学故事' : '挑战题'}：${topic}`,
          content: resp.content,
          problem: resp.content,
          hint: '',
          answer: '',
          difficulty,
        }
      } catch (e) {
        console.error('[MathWeaver] LLM generateContent failed, using mock:', e)
      }
    }

    // --- Mock mode (fallback) ---
    await new Promise(r => setTimeout(r, 300))

    if (type === 'exercise') {
      return {
        type: 'exercise',
        topic,
        title: `练习题：${topic}`,
        problem:
          ageLevel === 'kids'
            ? `关于${topic}的小练习：\n\n请找出以下运算表中的单位元：\n$$\\begin{array}{c|ccc} & 0 & 1 & 2 \\\\ 0 & 0 & 1 & 2 \\\\ 1 & 1 & 2 & 0 \\\\ 2 & 2 & 0 & 1 \\end{array}$$`
            : `关于${topic}的练习题：\n\n设 $(G, \\cdot)$ 是一个群，$H$ 是 $G$ 的子群。证明：对于任意 $g \\in G$，$gHg^{-1}$ 也是 $G$ 的子群。`,
        hint: '提示：验证 $gHg^{-1}$ 满足子群的判定条件（非空、封闭、逆元封闭）。',
        answer:
          '参考答案：\n1. $e \\in gHg^{-1}$（因为 $e = geg^{-1}$，$e \\in H$）\n2. 封闭性：$gh_1g^{-1} \\cdot gh_2g^{-1} = g(h_1h_2)g^{-1} \\in gHg^{-1}$\n3. 逆元：$(ghg^{-1})^{-1} = gh^{-1}g^{-1} \\in gHg^{-1}$',
        difficulty,
      }
    }

    if (type === 'story') {
      return {
        type: 'story',
        topic,
        title: `数学故事：${topic}`,
        content:
          ageLevel === 'kids'
            ? `从前有一位叫伽罗瓦的年轻数学家，他发现了${topic}的奥秘...\n\n他说：「每个方程式都有自己的『性格』，而${topic}就是描述这种性格的语言。」`
            : `1832 年，20 岁的伽罗瓦在决斗前夜写下了关于${topic}的核心思想...\n\n他发现，每个多项式方程的根的对称性可以用一个群来描述，这就是后来被称为「伽罗瓦群」的概念。`,
        difficulty,
      }
    }

    if (type === 'challenge') {
      return {
        type: 'challenge',
        topic,
        title: `挑战题：${topic}`,
        problem:
          ageLevel === 'teens'
            ? `Challenge: Prove that every group of order 6 is isomorphic to either $\\mathbb{Z}_6$ or $S_3$.`
            : `挑战：证明 6 阶群必同构于 $\\mathbb{Z}_6$ 或 $S_3$。\n\n提示：考虑群中元素的阶。`,
        hint: '提示：利用拉格朗日定理分析元素的阶，分别讨论是否存在 6 阶元素。',
        answer:
          '参考解答：\n若存在 6 阶元素，则群为循环群 $\\mathbb{Z}_6$。\n若不存在 6 阶元素，则由 Sylow 定理，存在 3 阶子群 $\\langle a \\rangle$ 和 2 阶子群 $\\langle b \\rangle$。分析 $ba$ 与 $ab$ 的关系可推出群同构于 $S_3$。',
        difficulty,
      }
    }

    return {
      type,
      topic,
      content: '[演示数据] AI 生成内容不可用，请在设置中配置 API Key',
      difficulty,
    }
  },

  // Settings — LLM config persisted in localStorage
  getLLMConfig: async () => {
    const config = getActiveConfig()
    return config
  },

  setLLMConfig: async (config: Record<string, unknown>) => {
    const current = getActiveConfig()
    const merged: LLMConfig = {
      ...current,
      ...(config as Partial<LLMConfig>),
    }
    // Ensure providerType is set based on preset if not provided
    if (!merged.providerType) {
      const preset = getPresets().find(p => p.provider === merged.provider)
      merged.providerType = preset?.providerType || 'openai-compatible'
    }
    saveStoredConfig(merged)
    return { success: true, config: merged }
  },

  getLLMPresets: async () => getPresets(),

  testLLMConnection: async () => {
    const config = getActiveConfig()
    if (!isRealLLM(config)) {
      return { ok: true, message: '演示模式正常运行中' }
    }
    return testConnection(config)
  },

  getSetting: async (_key: string) => null,
  setSetting: async (_key: string, _value: unknown) => true,
  isOnboardingComplete: async () => true,
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
    console.warn('[MathWeaver Web] Mock API injected — running in web demo mode')
  }
}

injectWebApi()
