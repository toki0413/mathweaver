import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  LLMError,
  classifyFetchError,
  classifyHttpError,
  MockLLMClient,
  OpenAICompatibleClient,
  createLLMClient,
  LLM_PRESETS,
  getPresetById,
} from '../../electron/backend/llm/client'
import type { LLMConfig } from '../../electron/backend/types'
import logger from '../../electron/backend/utils/logger'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseConfig: LLMConfig = {
  provider: 'openai_compatible',
  providerType: 'openai-compatible',
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  temperature: 0.7,
  maxTokens: 4096,
}

const mockChatResponse = {
  choices: [
    {
      message: {
        content: 'Hello from LLM [DELIVER]',
        tool_calls: null,
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30,
  },
}

const ollamaConfig: LLMConfig = {
  provider: 'ollama',
  providerType: 'ollama',
  apiKey: '',
  baseUrl: 'http://localhost:11434',
  model: 'qwen2.5:7b',
  temperature: 0.7,
  maxTokens: 4096,
}

/** Helper: build a MockLLMClient userMessage with student input and executed agents. */
function mockUserMessage(input: string, executed: string = '无'): string {
  return `学生输入: ${input}\n已执行: ${executed}`
}

// ---------------------------------------------------------------------------
// LLMError
// ---------------------------------------------------------------------------

describe('LLMError', () => {
  it('constructs with default options (kind=unknown, not retryable)', () => {
    const err = new LLMError('something went wrong')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LLMError')
    expect(err.message).toBe('something went wrong')
    expect(err.kind).toBe('unknown')
    expect(err.retryable).toBe(false)
    expect(err.userMessage).toBe('LLM 请求失败，请重试')
    expect(err.statusCode).toBeUndefined()
    expect(err.cause).toBeUndefined()
  })

  it('constructs with explicit kind and options', () => {
    const cause = new Error('root cause')
    const err = new LLMError('timeout occurred', {
      kind: 'timeout',
      statusCode: 408,
      retryable: true,
      userMessage: 'custom message',
      cause,
    })
    expect(err.kind).toBe('timeout')
    expect(err.statusCode).toBe(408)
    expect(err.retryable).toBe(true)
    expect(err.userMessage).toBe('custom message')
    expect(err.cause).toBe(cause)
  })

  it('generates correct userMessage for each error kind', () => {
    const cases: Array<[LLMError['kind'], string]> = [
      ['network', '网络连接失败，请检查网络后重试'],
      ['timeout', '请求超时，请稍后重试'],
      ['auth', 'API 认证失败，请检查 API Key 配置'],
      ['rate_limit', '请求过于频繁，请稍后重试'],
      ['server', '服务端暂时不可用，请稍后重试'],
      ['client', '请求参数有误，请检查 LLM 配置'],
      ['parse', '响应解析失败，请稍后重试'],
      ['unknown', 'LLM 请求失败，请重试'],
    ]
    for (const [kind, expected] of cases) {
      const err = new LLMError('test', { kind })
      expect(err.userMessage).toBe(expected)
    }
  })

  it('explicit userMessage overrides defaultUserMessage', () => {
    const err = new LLMError('err', {
      kind: 'network',
      userMessage: 'my custom',
    })
    expect(err.userMessage).toBe('my custom')
  })
})

// ---------------------------------------------------------------------------
// classifyFetchError
// ---------------------------------------------------------------------------

describe('classifyFetchError', () => {
  it('passes through existing LLMError unchanged', () => {
    const original = new LLMError('existing', { kind: 'auth', retryable: false })
    const result = classifyFetchError(original)
    expect(result).toBe(original)
  })

  it('classifies DOMException AbortError as timeout (retryable)', () => {
    const err = new DOMException('aborted', 'AbortError')
    const result = classifyFetchError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.kind).toBe('timeout')
    expect(result.retryable).toBe(true)
    expect(result.cause).toBe(err)
  })

  it('classifies Error with name=AbortError as timeout (retryable)', () => {
    const err = new Error('timed out')
    err.name = 'AbortError'
    const result = classifyFetchError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.kind).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('classifies TypeError as network (retryable)', () => {
    const err = new TypeError('fetch failed')
    const result = classifyFetchError(err)
    expect(result).toBeInstanceOf(LLMError)
    expect(result.kind).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('classifies unknown errors as unknown (not retryable)', () => {
    const result = classifyFetchError('string error')
    expect(result).toBeInstanceOf(LLMError)
    expect(result.kind).toBe('unknown')
    expect(result.retryable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// classifyHttpError
// ---------------------------------------------------------------------------

describe('classifyHttpError', () => {
  it('classifies 401 as auth (not retryable)', () => {
    const err = classifyHttpError(401, 'Unauthorized')
    expect(err.kind).toBe('auth')
    expect(err.statusCode).toBe(401)
    expect(err.retryable).toBe(false)
  })

  it('classifies 403 as auth (not retryable)', () => {
    const err = classifyHttpError(403, 'Forbidden')
    expect(err.kind).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  it('classifies 429 as rate_limit (retryable)', () => {
    const err = classifyHttpError(429, 'Too Many Requests')
    expect(err.kind).toBe('rate_limit')
    expect(err.statusCode).toBe(429)
    expect(err.retryable).toBe(true)
  })

  it('classifies 500 as server (retryable)', () => {
    const err = classifyHttpError(500, 'Internal Server Error')
    expect(err.kind).toBe('server')
    expect(err.statusCode).toBe(500)
    expect(err.retryable).toBe(true)
  })

  it('classifies 503 as server (retryable)', () => {
    const err = classifyHttpError(503, 'Service Unavailable')
    expect(err.kind).toBe('server')
    expect(err.retryable).toBe(true)
  })

  it('classifies 400 as client (not retryable)', () => {
    const err = classifyHttpError(400, 'Bad Request')
    expect(err.kind).toBe('client')
    expect(err.statusCode).toBe(400)
    expect(err.retryable).toBe(false)
  })

  it('classifies 404 as client (not retryable)', () => {
    const err = classifyHttpError(404, 'Not Found')
    expect(err.kind).toBe('client')
    expect(err.retryable).toBe(false)
  })

  it('truncates body to 500 chars when too long', () => {
    const longBody = 'x'.repeat(600)
    const err = classifyHttpError(500, longBody)
    expect(err.message).toContain('…')
    expect(err.message.length).toBeLessThan(longBody.length + 50)
  })

  it('does not truncate body under 500 chars', () => {
    const shortBody = 'short error'
    const err = classifyHttpError(500, shortBody)
    expect(err.message).toContain(shortBody)
    expect(err.message).not.toContain('…')
  })

  it('classifies unexpected status (e.g. 301) as not retryable', () => {
    const err = classifyHttpError(301, 'Moved')
    expect(err.statusCode).toBe(301)
    expect(err.retryable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MockLLMClient
// ---------------------------------------------------------------------------

describe('MockLLMClient', () => {
  let client: MockLLMClient

  beforeEach(() => {
    client = new MockLLMClient()
  })

  it('has correct provider and isConfigured', () => {
    expect(client.provider).toBe('mock')
    expect(client.isConfigured).toBe(true)
  })

  it('routes first call to perception agent', async () => {
    const resp = await client.chat('system', mockUserMessage('什么是群?'))
    expect(resp.next_action).toBe('call_agent')
    expect(resp.next_agent).toBe('perception')
  })

  it('routes Cayley table input through abstraction → counter_example → epistemic', async () => {
    const input = mockUserMessage('[[1,0],[0,1]]', 'perception')
    let resp = await client.chat('system', input)
    expect(resp.next_agent).toBe('abstraction')
    resp = await client.chat('system', mockUserMessage('[[1,0],[0,1]]', 'perception, abstraction'))
    expect(resp.next_agent).toBe('counter_example')
    resp = await client.chat(
      'system',
      mockUserMessage('[[1,0],[0,1]]', 'perception, abstraction, counter_example'),
    )
    expect(resp.next_agent).toBe('epistemic')
    resp = await client.chat(
      'system',
      mockUserMessage('[[1,0],[0,1]]', 'perception, abstraction, counter_example, epistemic'),
    )
    expect(resp.next_action).toBe('deliver')
  })

  it('detects Cayley table by "cayley" keyword (case-insensitive)', async () => {
    const resp = await client.chat(
      'system',
      mockUserMessage('look at my Cayley table', 'perception'),
    )
    expect(resp.next_agent).toBe('abstraction')
  })

  it('routes conjecture input through counter_example → epistemic', async () => {
    let resp = await client.chat('system', mockUserMessage('我猜所有群都是交换群', 'perception'))
    expect(resp.next_agent).toBe('counter_example')
    resp = await client.chat(
      'system',
      mockUserMessage('我猜所有群都是交换群', 'perception, counter_example'),
    )
    expect(resp.next_agent).toBe('epistemic')
  })

  it('detects conjecture by various keywords', async () => {
    const keywords = ['猜想', '所有', '任何', '每个', '一定', '必然', '总是']
    for (const kw of keywords) {
      const c = new MockLLMClient()
      const resp = await c.chat('system', mockUserMessage(`${kw}something`, 'perception'))
      expect(resp.next_agent).toBe('counter_example')
    }
  })

  it('routes history input to historical agent', async () => {
    const resp = await client.chat('system', mockUserMessage('群论的历史', 'perception'))
    expect(resp.next_agent).toBe('historical')
  })

  it('detects history by English keyword', async () => {
    const resp = await client.chat('system', mockUserMessage('tell me the history', 'perception'))
    expect(resp.next_agent).toBe('historical')
  })

  it('routes default input through abstraction → epistemic', async () => {
    let resp = await client.chat('system', mockUserMessage('请解释子群', 'perception'))
    expect(resp.next_agent).toBe('abstraction')
    resp = await client.chat('system', mockUserMessage('请解释子群', 'perception, abstraction'))
    expect(resp.next_agent).toBe('epistemic')
    resp = await client.chat(
      'system',
      mockUserMessage('请解释子群', 'perception, abstraction, epistemic'),
    )
    expect(resp.next_action).toBe('deliver')
  })

  it('routes grill trigger to perception then deliver', async () => {
    let resp = await client.chat('system', mockUserMessage('考考我'))
    expect(resp.next_agent).toBe('perception')
    resp = await client.chat('system', mockUserMessage('考考我', 'perception'))
    expect(resp.next_action).toBe('deliver')
  })

  it('detects grill trigger by English keywords', async () => {
    const keywords = ['grill me', '考考看', '来考考', '审问我', '面试我']
    for (const kw of keywords) {
      const c = new MockLLMClient()
      const resp = await c.chat('system', mockUserMessage(kw))
      expect(resp.next_agent).toBe('perception')
    }
  })

  it('routes proof trigger to perception then deliver', async () => {
    let resp = await client.chat('system', mockUserMessage('证明群的幺元唯一'))
    expect(resp.next_agent).toBe('perception')
    resp = await client.chat('system', mockUserMessage('证明群的幺元唯一', 'perception'))
    expect(resp.next_action).toBe('deliver')
  })

  it('detects proof by various keywords', async () => {
    const keywords = ['证明', '求证', 'prove', 'proof', '我要证', '验证以下']
    for (const kw of keywords) {
      const c = new MockLLMClient()
      const resp = await c.chat('system', mockUserMessage(`${kw} something`))
      expect(resp.next_agent).toBe('perception')
    }
  })

  it('returns deliver when all agents have been called', async () => {
    const resp = await client.chat(
      'system',
      mockUserMessage('test', 'perception, abstraction, epistemic'),
    )
    expect(resp.next_action).toBe('deliver')
    expect(resp.content).toContain('[DELIVER]')
  })

  it('returns correct LLMResponse structure', async () => {
    const resp = await client.chat('system', mockUserMessage('test'))
    expect(resp).toHaveProperty('content')
    expect(resp).toHaveProperty('tool_calls')
    expect(resp).toHaveProperty('next_action')
    expect(resp).toHaveProperty('next_agent')
    expect(resp).toHaveProperty('finish_reason')
    expect(resp).toHaveProperty('usage')
    expect(resp.tool_calls).toBeNull()
    expect(resp.finish_reason).toBe('stop')
    expect(resp.usage).toBeNull()
  })

  it('chatStream replays content character-by-character via onToken', async () => {
    const tokens: string[] = []
    const resp = await client.chatStream('system', mockUserMessage('test'), t => {
      tokens.push(t)
    })
    // The mock streams each character of the full content
    expect(tokens.length).toBe(resp.content.length)
    // Reassembling tokens should match full content
    expect(tokens.join('')).toBe(resp.content)
  })

  it('chatStream resolves with full LLMResponse', async () => {
    const resp = await client.chatStream('system', mockUserMessage('test'), () => {})
    expect(resp.next_action).toBe('call_agent')
    expect(resp.next_agent).toBe('perception')
  })
})

// ---------------------------------------------------------------------------
// OpenAICompatibleClient — non-retry tests
// ---------------------------------------------------------------------------

describe('OpenAICompatibleClient', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('constructor sets provider and isConfigured correctly', () => {
    const client = new OpenAICompatibleClient(baseConfig)
    expect(client.provider).toBe('openai_compatible')
    expect(client.isConfigured).toBe(true)
  })

  it('constructor sets isConfigured=false when apiKey is empty', () => {
    const client = new OpenAICompatibleClient({ ...baseConfig, apiKey: '' })
    expect(client.isConfigured).toBe(false)
  })

  it('constructor trims trailing slash from baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient({
      ...baseConfig,
      baseUrl: 'https://api.example.com/v1/',
    })
    await client.chat('sys', 'msg')
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('https://api.example.com/v1/chat/completions')
  })

  it('chat sends POST with correct headers and payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await client.chat('system prompt', 'user message')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(options.headers['Authorization']).toBe('Bearer sk-test-key')

    const body = JSON.parse(options.body as string)
    expect(body.model).toBe('test-model')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toBe('system prompt')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('user message')
    expect(body.temperature).toBe(0.7)
  })

  it('chat uses custom temperature when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await client.chat('sys', 'msg', undefined, 0.2)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.temperature).toBe(0.2)
  })

  it('chat omits Authorization header for ollama provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(ollamaConfig)
    await client.chat('sys', 'msg')

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers['Authorization']).toBeUndefined()
  })

  it('chat includes tools in payload when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const tools = [{ name: 'search', description: 'search tool' }]
    await client.chat('sys', 'msg', tools)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].type).toBe('function')
    expect(body.tools[0].function.name).toBe('search')
  })

  it('chat returns correct LLMResponse on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chat('sys', 'msg')

    expect(resp.content).toBe('Hello from LLM [DELIVER]')
    expect(resp.next_action).toBe('deliver')
    expect(resp.next_agent).toBeNull()
    expect(resp.finish_reason).toBe('stop')
    expect(resp.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    })
  })

  it('chat parses [CALL:agent] in content', async () => {
    const callResponse = {
      choices: [
        {
          message: { content: 'routing [CALL:perception]' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => callResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chat('sys', 'msg')

    expect(resp.next_action).toBe('call_agent')
    expect(resp.next_agent).toBe('perception')
  })

  it('chat returns null next_action when content has no markers', async () => {
    const noMarkerResponse = {
      choices: [
        {
          message: { content: 'plain text response' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => noMarkerResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chat('sys', 'msg')

    expect(resp.next_action).toBeNull()
    expect(resp.next_agent).toBeNull()
  })

  it('chat parses tool_calls from response', async () => {
    const toolCallResponse = {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                function: {
                  name: 'search',
                  arguments: '{"query": "group theory"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => toolCallResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chat('sys', 'msg')

    expect(resp.tool_calls).toHaveLength(1)
    expect(resp.tool_calls![0].id).toBe('call_1')
    expect(resp.tool_calls![0].name).toBe('search')
    expect(resp.tool_calls![0].arguments).toEqual({ query: 'group theory' })
    expect(resp.finish_reason).toBe('tool_calls')
  })

  it('chat handles tool_calls with invalid JSON arguments', async () => {
    const toolCallResponse = {
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                function: {
                  name: 'search',
                  arguments: 'not valid json',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: null,
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => toolCallResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chat('sys', 'msg')

    expect(resp.tool_calls![0].arguments).toEqual({ raw: 'not valid json' })
  })

  it('chat throws LLMError on HTTP error (non-retryable 401)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await expect(client.chat('sys', 'msg')).rejects.toThrow(LLMError)
    // Should not retry on 401
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('chat throws LLMError on JSON parse failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json')
      },
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const err = await client.chat('sys', 'msg').catch(e => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.kind).toBe('parse')
  })

  it('chat does not retry on 400 client error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await expect(client.chat('sys', 'msg')).rejects.toThrow(LLMError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('chat does not retry on 404 client error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await expect(client.chat('sys', 'msg')).rejects.toThrow(LLMError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('chatVision sends a multimodal payload and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '这是图里的题目 [DELIVER]' } }],
      }),
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chatVision(
      'sys',
      '请讲解',
      [{ dataUrl: 'data:image/png;base64,AAAA' }],
      0.7,
    )

    expect(resp.content).toContain('这是图里的题目')
    expect(resp.next_action).toBe('deliver')

    // Verify the request body carried the multimodal content array.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    const payload = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: unknown }>
    }
    const userContent = payload.messages[1].content as Array<Record<string, unknown>>
    expect(userContent[0]).toMatchObject({ type: 'text', text: '请讲解' })
    expect(userContent[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAA' },
    })
  })

  it('chatVision with no images delegates to plain chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chatVision('sys', 'msg', [])
    expect(resp.content).toContain('Hello from LLM')
  })
})

// ---------------------------------------------------------------------------
// OpenAICompatibleClient — retry logic (with fake timers)
// ---------------------------------------------------------------------------

describe('OpenAICompatibleClient retry logic', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    // Replace setTimeout with an instant-resolving timer to avoid real delays
    vi.useFakeTimers()
    // Each failed attempt logs a warn via winston by design. Silence it so
    // expected retry-failure paths do not pollute the runner output.
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('chat retries on 429 rate_limit error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockChatResponse,
        text: async () => '',
      } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const chatPromise = client.chat('sys', 'msg')
    // Advance past the 1s backoff
    await vi.advanceTimersByTimeAsync(2000)
    const resp = await chatPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resp.content).toBe('Hello from LLM [DELIVER]')
  })

  it('chat retries on 500 server error then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'server error',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockChatResponse,
        text: async () => '',
      } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const chatPromise = client.chat('sys', 'msg')
    await vi.advanceTimersByTimeAsync(2000)
    const resp = await chatPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resp.content).toContain('Hello')
  })

  it('chat retries on TypeError network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockChatResponse,
        text: async () => '',
      } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const chatPromise = client.chat('sys', 'msg')
    await vi.advanceTimersByTimeAsync(2000)
    const resp = await chatPromise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resp.content).toContain('Hello')
  })

  it('chat gives up after max retries on persistent 500', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'always fails',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    // Attach catch early to prevent unhandled rejection during fake timer advancement
    const result = client.chat('sys', 'msg').catch(e => e)
    // Advance through all backoffs: 1s + 2s + 4s = 7s
    await vi.advanceTimersByTimeAsync(10000)
    const err = await result
    expect(err).toBeInstanceOf(LLMError)
    // 1 initial + 3 retries = 4 attempts
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('chat gives up after max retries on persistent network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection refused'))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    // Attach catch early to prevent unhandled rejection during fake timer advancement
    const result = client.chat('sys', 'msg').catch(e => e)
    await vi.advanceTimersByTimeAsync(10000)
    const err = await result
    expect(err).toBeInstanceOf(LLMError)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

// ---------------------------------------------------------------------------
// OpenAICompatibleClient.chatStream
// ---------------------------------------------------------------------------

describe('OpenAICompatibleClient.chatStream', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  /** Build a mock SSE response body from delta chunks. */
  function buildSSEResponse(
    chunks: Array<{ content?: string; finish_reason?: string; usage?: Record<string, number> }>,
  ): string {
    const lines: string[] = []
    for (const chunk of chunks) {
      const data: Record<string, unknown> = {
        choices: [
          {
            delta: chunk.content !== undefined ? { content: chunk.content } : {},
            finish_reason: chunk.finish_reason ?? null,
          },
        ],
      }
      if (chunk.usage) data.usage = chunk.usage
      lines.push(`data: ${JSON.stringify(data)}`)
    }
    lines.push('data: [DONE]')
    return lines.join('\n') + '\n'
  }

  function mockStreamResponse(sseBody: string): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })
    return {
      ok: true,
      body: stream,
      text: async () => '',
    } as unknown as Response
  }

  it('streams tokens via onToken and returns full response', async () => {
    const sseBody = buildSSEResponse([
      { content: 'Hello' },
      { content: ' world' },
      { content: ' [DELIVER]', finish_reason: 'stop' },
    ])
    const fetchMock = vi.fn().mockResolvedValue(mockStreamResponse(sseBody))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const tokens: string[] = []
    const resp = await client.chatStream('sys', 'msg', t => tokens.push(t))

    expect(tokens).toEqual(['Hello', ' world', ' [DELIVER]'])
    expect(resp.content).toBe('Hello world [DELIVER]')
    expect(resp.next_action).toBe('deliver')
    expect(resp.finish_reason).toBe('stop')
  })

  it('parses usage from final SSE chunk', async () => {
    const sseBody = buildSSEResponse([
      { content: 'Hi' },
      {
        content: '',
        finish_reason: 'stop',
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      },
    ])
    const fetchMock = vi.fn().mockResolvedValue(mockStreamResponse(sseBody))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chatStream('sys', 'msg', () => {})

    expect(resp.usage).toEqual({
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 10,
    })
  })

  it('accumulates tool call fragments across SSE chunks', async () => {
    const sseBody =
      [
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      function: { name: 'search', arguments: '{"q":' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: '"group"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
        'data: [DONE]',
      ].join('\n') + '\n'

    const fetchMock = vi.fn().mockResolvedValue(mockStreamResponse(sseBody))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chatStream('sys', 'msg', () => {})

    expect(resp.tool_calls).toHaveLength(1)
    expect(resp.tool_calls![0].id).toBe('call_1')
    expect(resp.tool_calls![0].name).toBe('search')
    expect(resp.tool_calls![0].arguments).toEqual({ q: 'group' })
    expect(resp.finish_reason).toBe('tool_calls')
  })

  it('does NOT retry after stream has started emitting tokens', async () => {
    // Stream emits one token then closes normally (no error, so no retry needed)
    const encoder = new TextEncoder()
    const partialSSE =
      'data: ' +
      JSON.stringify({
        choices: [{ delta: { content: 'partial' }, finish_reason: null }],
      }) +
      '\n'
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(partialSSE))
        controller.close()
      },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      text: async () => '',
    } as unknown as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const tokens: string[] = []
    const resp = await client.chatStream('sys', 'msg', t => tokens.push(t))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(tokens).toEqual(['partial'])
    expect(resp.content).toBe('partial')
  })

  it('throws LLMError on HTTP error before stream starts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await expect(client.chatStream('sys', 'msg', () => {})).rejects.toThrow(LLMError)
  })

  it('throws LLMError when response has no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      text: async () => '',
    } as unknown as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    await expect(client.chatStream('sys', 'msg', () => {})).rejects.toThrow(LLMError)
  })

  it('parses [CALL:agent] from streamed content', async () => {
    const sseBody = buildSSEResponse([
      { content: 'routing [CALL:abstraction]', finish_reason: 'stop' },
    ])
    const fetchMock = vi.fn().mockResolvedValue(mockStreamResponse(sseBody))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = new OpenAICompatibleClient(baseConfig)
    const resp = await client.chatStream('sys', 'msg', () => {})

    expect(resp.next_action).toBe('call_agent')
    expect(resp.next_agent).toBe('abstraction')
  })
})

// ---------------------------------------------------------------------------
// createLLMClient factory
// ---------------------------------------------------------------------------

describe('createLLMClient', () => {
  it('returns MockLLMClient for mock provider', () => {
    const client = createLLMClient({ ...baseConfig, provider: 'mock' })
    expect(client).toBeInstanceOf(MockLLMClient)
  })

  it('returns MockLLMClient when apiKey is empty and provider is not ollama', () => {
    const client = createLLMClient({ ...baseConfig, apiKey: '' })
    expect(client).toBeInstanceOf(MockLLMClient)
  })

  it('returns OpenAICompatibleClient for openai_compatible provider with key', () => {
    const client = createLLMClient(baseConfig)
    expect(client).toBeInstanceOf(OpenAICompatibleClient)
    expect(client.provider).toBe('openai_compatible')
  })

  it('returns OpenAICompatibleClient for ollama provider even without key', () => {
    const client = createLLMClient(ollamaConfig)
    expect(client).toBeInstanceOf(OpenAICompatibleClient)
    expect(client.provider).toBe('ollama')
  })

  it('appends /v1 to ollama baseUrl if missing', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createLLMClient(ollamaConfig)
    await client.chat('sys', 'msg')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('/v1/chat/completions')

    globalThis.fetch = originalFetch
  })

  it('does not append /v1 if ollama baseUrl already contains it', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockChatResponse,
      text: async () => '',
    } as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const client = createLLMClient({
      ...ollamaConfig,
      baseUrl: 'http://localhost:11434/v1',
    })
    await client.chat('sys', 'msg')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    // Should not double-append /v1
    expect(calledUrl).toBe('http://localhost:11434/v1/chat/completions')

    globalThis.fetch = originalFetch
  })
})

// ---------------------------------------------------------------------------
// LLM_PRESETS & getPresetById
// ---------------------------------------------------------------------------

describe('LLM_PRESETS', () => {
  it('contains a non-empty array of presets', () => {
    expect(LLM_PRESETS).toBeInstanceOf(Array)
    expect(LLM_PRESETS.length).toBeGreaterThan(5)
  })

  it('every preset has all required fields', () => {
    for (const preset of LLM_PRESETS) {
      expect(preset.id).toBeTruthy()
      expect(preset.label).toBeTruthy()
      expect(preset.provider).toBeTruthy()
      expect(preset.providerType).toBeTruthy()
      expect(preset.baseUrl).toBeDefined()
      expect(preset.defaultModel).toBeTruthy()
      expect(typeof preset.requiresApiKey).toBe('boolean')
      expect(preset.helpUrl).toBeDefined()
      expect(preset.description).toBeTruthy()
      expect(typeof preset.local).toBe('boolean')
    }
  })

  it('includes deepseek preset', () => {
    const deepseek = getPresetById('deepseek')
    expect(deepseek).toBeDefined()
    expect(deepseek!.provider).toBe('openai_compatible')
    expect(deepseek!.baseUrl).toContain('deepseek.com')
    expect(deepseek!.requiresApiKey).toBe(true)
    expect(deepseek!.local).toBe(false)
  })

  it('includes openai preset', () => {
    const openai = getPresetById('openai')
    expect(openai).toBeDefined()
    expect(openai!.defaultModel).toContain('gpt')
  })

  it('includes ollama preset (local, no API key)', () => {
    const ollama = getPresetById('ollama')
    expect(ollama).toBeDefined()
    expect(ollama!.provider).toBe('ollama')
    expect(ollama!.requiresApiKey).toBe(false)
    expect(ollama!.local).toBe(true)
    expect(ollama!.baseUrl).toContain('localhost')
  })

  it('includes mock preset', () => {
    const mock = getPresetById('mock')
    expect(mock).toBeDefined()
    expect(mock!.provider).toBe('mock')
    expect(mock!.requiresApiKey).toBe(false)
  })

  it('getPresetById returns undefined for unknown id', () => {
    expect(getPresetById('nonexistent-provider')).toBeUndefined()
  })

  it('all preset ids are unique', () => {
    const ids = LLM_PRESETS.map(p => p.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})
