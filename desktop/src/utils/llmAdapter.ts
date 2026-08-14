/**
 * LLM Adapter — 统一的大模型接入层
 *
 * 支持的 Provider 分类：
 *   1. OpenAI 兼容 (openai-compatible): OpenAI, DeepSeek, Moonshot/Kimi, Zhipu/GLM,
 *      零一万物, LM Studio, vLLM, Together AI, Groq, OpenRouter …
 *   2. Anthropic: Claude 3.5 / 4 系列
 *   3. Google Gemini: Gemini 1.5 / 2.0 系列
 *   4. Ollama: 本地模型 (Llama, Qwen, Mistral …)
 *   5. 自定义: 用户提供 baseUrl + API 格式
 *
 * 核心接口：
 *   - chatCompletion(messages, options) → { content, usage }
 *   - testConnection() → { ok, message }
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type ProviderType = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMConfig {
  provider: string // 逻辑标识，如 'deepseek', 'openai', 'ollama'
  providerType: ProviderType // API 协议类型
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  raw?: unknown
}

export interface LLMPreset {
  id: string
  label: string
  provider: string
  providerType: ProviderType
  baseUrl: string
  defaultModel: string
  requiresApiKey: boolean
  helpUrl: string
  description: string
  local: boolean
}

// ---------------------------------------------------------------------------
// 预设列表
// ---------------------------------------------------------------------------

export const LLM_PRESETS: LLMPreset[] = [
  // --- 云端：OpenAI 兼容 ---
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'deepseek',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
    requiresApiKey: true,
    helpUrl: 'https://platform.deepseek.com/api_keys',
    description: '深度求索 · 高性价比 · 中文优秀',
    local: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    requiresApiKey: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT-5.4 / GPT-5.x · 全面能力',
    local: false,
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    provider: 'moonshot',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    requiresApiKey: true,
    helpUrl: 'https://platform.moonshot.cn/console/api-keys',
    description: '长上下文窗口 · 中文友好',
    local: false,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    provider: 'zhipu',
    providerType: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7-flash',
    requiresApiKey: true,
    helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    description: 'GLM-4 系列 · 国产自研',
    local: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    providerType: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-5',
    requiresApiKey: true,
    helpUrl: 'https://openrouter.ai/keys',
    description: '聚合 100+ 模型 · 统一接口',
    local: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    provider: 'groq',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    requiresApiKey: true,
    helpUrl: 'https://console.groq.com/keys',
    description: '超快推理 · 开源模型',
    local: false,
  },

  // --- 云端：Anthropic ---
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    providerType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5',
    requiresApiKey: true,
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude Sonnet 5 · 强推理',
    local: false,
  },

  // --- 云端：Google Gemini ---
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    providerType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.6-flash',
    requiresApiKey: true,
    helpUrl: 'https://aistudio.google.com/app/apikey',
    description: 'Gemini 3.6 · Google 出品',
    local: false,
  },

  // --- 本地：Ollama ---
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    provider: 'ollama',
    providerType: 'ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'qwen3:8b',
    requiresApiKey: false,
    helpUrl: 'https://ollama.com/download',
    description: '本地运行 · 隐私优先 · 免费',
    local: true,
  },

  // --- 本地：LM Studio ---
  {
    id: 'lmstudio',
    label: 'LM Studio (本地)',
    provider: 'lmstudio',
    providerType: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    requiresApiKey: false,
    helpUrl: 'https://lmstudio.ai',
    description: '本地 GGUF 模型 · OpenAI 兼容',
    local: true,
  },

  // --- 演示模式 ---
  {
    id: 'mock',
    label: '演示模式',
    provider: 'mock',
    providerType: 'openai-compatible',
    baseUrl: '',
    defaultModel: 'demo',
    requiresApiKey: false,
    helpUrl: '',
    description: '无需配置 · Web 演示',
    local: false,
  },
]

// ---------------------------------------------------------------------------
// 适配器实现
// ---------------------------------------------------------------------------

/**
 * OpenAI 兼容 API 适配器
 * 覆盖: OpenAI, DeepSeek, Moonshot, Zhipu, Groq, OpenRouter, LM Studio, vLLM …
 */
async function callOpenAICompatible(
  config: LLMConfig,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const body = {
    model: config.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`)
  }

  const data = await resp.json()
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
    },
    raw: data,
  }
}

/**
 * Anthropic Claude 适配器
 */
async function callAnthropic(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  }

  // Anthropic separates system from conversation messages
  const systemMsg = messages.find(m => m.role === 'system')
  const convMsgs = messages.filter(m => m.role !== 'system')

  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemMsg?.content || undefined,
    messages: convMsgs.map(m => ({ role: m.role, content: m.content })),
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${errText.substring(0, 200)}`)
  }

  const data = await resp.json()
  return {
    content: data.content?.[0]?.text ?? '',
    usage: {
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
      totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
    raw: data,
  }
}

/**
 * Google Gemini 适配器
 */
async function callGemini(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  const model = config.model
  const url = `${config.baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${config.apiKey}`

  const systemMsg = messages.find(m => m.role === 'system')
  const convMsgs = messages.filter(m => m.role !== 'system')

  const body: Record<string, unknown> = {
    contents: convMsgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: config.temperature,
      maxOutputTokens: config.maxTokens,
    },
  }

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] }
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Gemini ${resp.status}: ${errText.substring(0, 200)}`)
  }

  const data = await resp.json()
  const content =
    data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ?? ''

  return {
    content,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
      totalTokens: data.usageMetadata?.totalTokenCount,
    },
    raw: data,
  }
}

/**
 * Ollama 适配器（本地）
 */
async function callOllama(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/chat`

  const body = {
    model: config.model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    stream: false,
    options: {
      temperature: config.temperature,
    },
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Ollama ${resp.status}: ${errText.substring(0, 200)}`)
  }

  const data = await resp.json()
  return {
    content: data.message?.content ?? '',
    usage: {
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    },
    raw: data,
  }
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

/**
 * 根据 LLMConfig 调用对应的大模型
 */
export async function chatCompletion(
  config: LLMConfig,
  messages: LLMMessage[],
): Promise<LLMResponse> {
  switch (config.providerType) {
    case 'openai-compatible':
      return callOpenAICompatible(config, messages)
    case 'anthropic':
      return callAnthropic(config, messages)
    case 'gemini':
      return callGemini(config, messages)
    case 'ollama':
      return callOllama(config, messages)
    default:
      // 默认走 OpenAI 兼容
      return callOpenAICompatible(config, messages)
  }
}

/**
 * 测试连接 — 发送一个简单的 ping 消息
 */
export async function testConnection(
  config: LLMConfig,
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const start = Date.now()
  try {
    const resp = await chatCompletion(config, [{ role: 'user', content: 'Say "ok" in one word.' }])
    const latency = Date.now() - start
    if (resp.content && resp.content.length > 0) {
      return {
        ok: true,
        message: `连接成功 · ${latency}ms · ${config.model}`,
        latencyMs: latency,
      }
    }
    return { ok: false, message: '返回内容为空' }
  } catch (e) {
    return { ok: false, message: String(e).substring(0, 150) }
  }
}

/**
 * 从预设 ID 构建 LLMConfig
 */
export function configFromPreset(
  presetId: string,
  overrides?: Partial<LLMConfig>,
): LLMConfig | null {
  const preset = LLM_PRESETS.find(p => p.id === presetId)
  if (!preset) return null
  return {
    provider: preset.provider,
    providerType: preset.providerType,
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    temperature: 0.7,
    maxTokens: 2048,
    ...overrides,
  }
}

/**
 * 获取预设列表（供 SettingsPanel 使用）
 */
export function getPresets(): LLMPreset[] {
  return LLM_PRESETS
}

/**
 * 默认系统提示词（年龄自适应）
 */
export function getSystemPrompt(ageLevel: string): string {
  const prompts: Record<string, string> = {
    kids: '你是 MathWeaver 的数学导师，面向 8-10 岁小学生。用游戏化语言和生活比喻，避免学术术语。用中文回答，200字以内。',
    tweens:
      '你是 MathWeaver 的数学导师，面向 11-13 岁初中生。半学术语言，保留直觉入口。用中文回答。',
    teens:
      '你是 MathWeaver 的数学导师，面向 14+ 岁高中生。使用完整学术术语和严谨表达。用中文回答。',
  }
  return prompts[ageLevel] || prompts.tweens
}
