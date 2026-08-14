/**
 * LLM Client — configurable interface for cloud/local/custom model providers.
 *
 * Supports three provider types:
 * 1. Cloud API (OpenAI/DeepSeek/Qwen compatible) — uses Bearer token auth
 * 2. Local model (Ollama/LM Studio) — uses local endpoint, no auth required
 * 3. Mock — deterministic fallback for development without LLM access
 *
 * Configuration is managed via electron-store and can be changed at runtime
 * through the Settings panel.
 */

import type { LLMConfig } from '../types'
import { createModuleLogger } from '../utils/logger'

const log = createModuleLogger('LLM')

// ---------------------------------------------------------------------------
// LLM Response
// ---------------------------------------------------------------------------

export interface LLMResponse {
  content: string
  tool_calls: ToolCall[] | null
  next_action: 'call_agent' | 'deliver' | 'use_tool' | null
  next_agent: string | null
  finish_reason: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// LLM Error (Task 1c) — typed, user-friendly errors with retry classification
// ---------------------------------------------------------------------------

export type LLMErrorKind =
  'network' | 'timeout' | 'auth' | 'rate_limit' | 'server' | 'client' | 'parse' | 'unknown'

export interface LLMErrorOptions {
  kind?: LLMErrorKind
  statusCode?: number
  retryable?: boolean
  userMessage?: string
  cause?: unknown
}

/**
 * Structured LLM error.
 *
 * Distinguishes network / timeout / auth / rate-limit / server / client /
 * parse errors so callers can decide whether to retry and surface a friendly
 * message to the end user. `retryable` is the canonical flag consulted by
 * {@link OpenAICompatibleClient.retryWithBackoff}.
 */
export class LLMError extends Error {
  readonly kind: LLMErrorKind
  readonly statusCode?: number
  readonly retryable: boolean
  readonly userMessage: string
  readonly cause?: unknown

  constructor(message: string, opts: LLMErrorOptions = {}) {
    super(message)
    this.name = 'LLMError'
    this.kind = opts.kind ?? 'unknown'
    this.statusCode = opts.statusCode
    this.retryable = opts.retryable ?? false
    this.userMessage = opts.userMessage ?? this.defaultUserMessage()
    if (opts.cause !== undefined) {
      this.cause = opts.cause
    }
  }

  private defaultUserMessage(): string {
    switch (this.kind) {
      case 'network':
        return '网络连接失败，请检查网络后重试'
      case 'timeout':
        return '请求超时，请稍后重试'
      case 'auth':
        return 'API 认证失败，请检查 API Key 配置'
      case 'rate_limit':
        return '请求过于频繁，请稍后重试'
      case 'server':
        return '服务端暂时不可用，请稍后重试'
      case 'client':
        return '请求参数有误，请检查 LLM 配置'
      case 'parse':
        return '响应解析失败，请稍后重试'
      default:
        return 'LLM 请求失败，请重试'
    }
  }
}

/**
 * Classify a fetch-level exception (abort, network, TypeError) into an
 * LLMError. Errors already typed as LLMError pass through unchanged.
 */
export function classifyFetchError(err: unknown): LLMError {
  if (err instanceof LLMError) return err

  // AbortController timeout / manual abort — standard DOMException form.
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new LLMError(`Request aborted (timeout): ${err.message}`, {
      kind: 'timeout',
      retryable: true,
      cause: err,
    })
  }
  // Some runtimes throw a plain Error whose `name` is 'AbortError'.
  if (err instanceof Error && err.name === 'AbortError') {
    return new LLMError(`Request aborted (timeout): ${err.message}`, {
      kind: 'timeout',
      retryable: true,
      cause: err,
    })
  }
  // fetch() throws TypeError on network failures (DNS, connection refused, …).
  if (err instanceof TypeError) {
    return new LLMError(`Network error: ${err.message}`, {
      kind: 'network',
      retryable: true,
      cause: err,
    })
  }

  return new LLMError(`Unexpected error: ${String(err)}`, {
    cause: err,
  })
}

/**
 * Classify an HTTP status code + response body into an LLMError with the
 * appropriate kind and retryable flag. 5xx and 429 are retryable; 4xx (auth,
 * bad request, …) are not.
 */
export function classifyHttpError(status: number, body: string): LLMError {
  const snippet = body.length > 500 ? body.slice(0, 500) + '…' : body

  if (status === 401 || status === 403) {
    return new LLMError(`Authentication error ${status}: ${snippet}`, {
      kind: 'auth',
      statusCode: status,
      retryable: false,
    })
  }
  if (status === 429) {
    return new LLMError(`Rate limit error 429: ${snippet}`, {
      kind: 'rate_limit',
      statusCode: status,
      retryable: true,
    })
  }
  if (status >= 500) {
    return new LLMError(`Server error ${status}: ${snippet}`, {
      kind: 'server',
      statusCode: status,
      retryable: true,
    })
  }
  if (status >= 400) {
    return new LLMError(`Client error ${status}: ${snippet}`, {
      kind: 'client',
      statusCode: status,
      retryable: false,
    })
  }
  return new LLMError(`HTTP error ${status}: ${snippet}`, {
    statusCode: status,
    retryable: false,
  })
}

// ---------------------------------------------------------------------------
// Shared retry helper (used by OpenAI-compatible, Anthropic and Gemini clients)
// ---------------------------------------------------------------------------

/** Sleep helper for backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry an async operation with exponential backoff.
 *
 * - Max retries: 3 (so up to 4 total attempts including the first).
 * - Backoff schedule: 1s, 2s, 4s.
 * - Only retries 5xx server errors, rate-limit (429) and network/timeout
 *   errors (as flagged by {@link LLMError.retryable}). 4xx client/auth
 *   errors are NOT retried.
 * - Logs every retry attempt.
 *
 * The optional `canRetry` callback lets callers veto a retry — e.g. a
 * streaming caller that has already emitted tokens cannot safely re-run
 * the request, because a retry would duplicate already-delivered output.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  context: string,
  canRetry?: (error: LLMError, attempt: number) => boolean,
): Promise<T> {
  const overallDeadline = 120000 // 2 minutes total max
  const startTime = Date.now()
  const maxRetries = 3
  const backoffMs = [1000, 2000, 4000]
  let lastError: unknown = new Error('No attempts made')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = backoffMs[attempt - 1]
        log.info('Retrying after backoff', {
          context,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          delayMs: delay,
        })
        await sleep(delay)
        // Check overall deadline before retrying
        const elapsed = Date.now() - startTime
        if (elapsed >= overallDeadline) {
          log.warn('Overall deadline exceeded, giving up', {
            context,
            elapsedMs: elapsed,
            deadlineMs: overallDeadline,
          })
          throw lastError instanceof LLMError ? lastError : classifyFetchError(lastError)
        }
      }
      return await fn()
    } catch (err) {
      lastError = err
      const llmErr = err instanceof LLMError ? err : classifyFetchError(err)
      const retryable = canRetry ? canRetry(llmErr, attempt) : llmErr.retryable
      if (!retryable || attempt === maxRetries) {
        throw llmErr
      }
      log.warn('Request failed', {
        context,
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        errorKind: llmErr.kind,
        errorMessage: llmErr.message,
      })
    }
  }

  // Unreachable in practice, but keeps the type-checker satisfied.
  throw lastError
}

// ---------------------------------------------------------------------------
// LLM Client Interface
// ---------------------------------------------------------------------------

export interface LLMClient {
  chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse>

  /**
   * Streaming chat (Task 1b). Calls `onToken` for each incremental content
   * fragment as it arrives (SSE `delta.content`), then resolves with the
   * fully-assembled {@link LLMResponse}.
   */
  chatStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse>

  /**
   * Multimodal chat (vision). Sends a text prompt plus one or more images
   * (base64 data URIs) to a vision-capable model. Providers that lack vision
   * support should throw so the caller can fall back to local OCR.
   */
  chatVision(
    systemPrompt: string,
    userMessage: string,
    images: { dataUrl: string }[],
    temperature?: number,
  ): Promise<LLMResponse>

  readonly provider: string
  readonly isConfigured: boolean
}

// ---------------------------------------------------------------------------
// Mock LLM Client (deterministic, for development)
// ---------------------------------------------------------------------------

export class MockLLMClient implements LLMClient {
  readonly provider = 'mock'
  readonly isConfigured = true
  private callHistory: Array<{ system: string; user: string }> = []

  async chat(
    systemPrompt: string,
    userMessage: string,
    _tools?: Record<string, unknown>[],
    _temperature?: number,
  ): Promise<LLMResponse> {
    this.callHistory.push({
      system: systemPrompt.slice(0, 200),
      user: userMessage.slice(0, 200),
    })

    // Parse which agents have already been called
    const called = new Set<string>()
    const execMatch = userMessage.match(/已执行:\s*(.*)/)
    if (execMatch) {
      const execStr = execMatch[1].trim()
      if (execStr && execStr !== '无') {
        execStr.split(',').forEach(a => called.add(a.trim()))
      }
    }

    // Parse student input
    let studentInput = ''
    const inputMatch = userMessage.match(/学生输入:\s*(.*)/)
    if (inputMatch) studentInput = inputMatch[1]

    const isCayley = studentInput.includes('[[') || studentInput.toLowerCase().includes('cayley')
    const isHistory =
      studentInput.includes('历史') || studentInput.toLowerCase().includes('history')
    const isConjecture = ['我猜', '猜想', '所有', '任何', '每个', '一定', '必然', '总是'].some(kw =>
      studentInput.includes(kw),
    )
    const isGrillTrigger = ['考考我', 'grill me', '考考看', '来考考', '审问我', '面试我'].some(kw =>
      studentInput.toLowerCase().includes(kw),
    )
    const isProof = ['证明', '求证', 'prove', 'proof', '我要证', '验证以下'].some(kw =>
      studentInput.includes(kw),
    )

    // Grill mode routing
    if (isGrillTrigger && !called.has('perception')) {
      return mkResponse('Grill mode triggered', 'call_agent', 'perception')
    }
    if (isGrillTrigger && called.has('perception')) {
      return mkResponse('Grill mode: delivering question to student', 'deliver')
    }

    // Proof mode routing
    if (isProof && !called.has('perception')) {
      return mkResponse('Proof attempt detected', 'call_agent', 'perception')
    }
    if (isProof && called.has('perception')) {
      return mkResponse('Proof mode: delivering proof verification', 'deliver')
    }

    // Standard routing
    if (!called.has('perception')) {
      return mkResponse('Starting with perception', 'call_agent', 'perception')
    }

    if (isCayley) {
      if (!called.has('abstraction'))
        return mkResponse('Abstracting Cayley table structure', 'call_agent', 'abstraction')
      if (!called.has('counter_example'))
        return mkResponse('Verifying with Z3', 'call_agent', 'counter_example')
      if (!called.has('epistemic'))
        return mkResponse('Diagnosing cognitive state', 'call_agent', 'epistemic')
    } else if (isConjecture) {
      if (!called.has('counter_example'))
        return mkResponse('Testing conjecture with Z3', 'call_agent', 'counter_example')
      if (!called.has('epistemic'))
        return mkResponse('Diagnosing cognitive state after conjecture', 'call_agent', 'epistemic')
    } else if (isHistory) {
      if (!called.has('historical'))
        return mkResponse('Retrieving historical context', 'call_agent', 'historical')
    } else {
      if (!called.has('abstraction'))
        return mkResponse('Abstracting input', 'call_agent', 'abstraction')
      if (!called.has('epistemic'))
        return mkResponse('Diagnosing cognitive state', 'call_agent', 'epistemic')
    }

    return mkResponse('All agents complete, delivering response [DELIVER]', 'deliver')
  }

  /**
   * Streaming chat (Task 1b) — mock implementation.
   *
   * Computes the full response via {@link chat}, then replays its content
   * character-by-character through `onToken` with a 50 ms delay per character
   * to simulate server-side streaming. Resolves with the complete response.
   */
  async chatStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const full = await this.chat(systemPrompt, userMessage, tools, temperature)
    for (const ch of full.content) {
      onToken(ch)
      await MockLLMClient.sleep(50)
    }
    return full
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Mock vision: acknowledges the image count and returns a deterministic
   * placeholder. In mock mode there is no real image understanding, so the
   * caller should fall back to local OCR when higher fidelity is needed.
   */
  async chatVision(
    systemPrompt: string,
    userMessage: string,
    images: { dataUrl: string }[],
    _temperature?: number,
  ): Promise<LLMResponse> {
    this.callHistory.push({
      system: systemPrompt.slice(0, 200),
      user: `[vision ${images.length} image(s)] ${userMessage.slice(0, 200)}`,
    })
    return mkResponse(
      `（演示模式）已收到 ${images.length} 张图片，但未配置视觉模型，请在本机 OCR 或配置多模态模型后查看实际内容。`,
      'deliver',
    )
  }
}

function mkResponse(
  content: string,
  nextAction: LLMResponse['next_action'],
  nextAgent?: string,
): LLMResponse {
  return {
    content,
    tool_calls: null,
    next_action: nextAction,
    next_agent: nextAgent ?? null,
    finish_reason: 'stop',
    usage: null,
  }
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Client (DeepSeek, OpenAI, Qwen, vLLM, LiteLLM, etc.)
// ---------------------------------------------------------------------------

export class OpenAICompatibleClient implements LLMClient {
  readonly provider: string
  readonly isConfigured: boolean
  private apiKey: string
  private baseUrl: string
  private model: string
  private totalTokens = 0

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.model = config.model
    this.provider = config.provider
    this.isConfigured = !!config.apiKey
  }

  // -------------------------------------------------------------------------
  // Request building (shared by chat & chatStream)
  // -------------------------------------------------------------------------

  private buildRequest(
    systemPrompt: string,
    userMessage: string,
    tools: Record<string, unknown>[] | undefined,
    temperature: number | undefined,
    stream: boolean,
  ): { headers: Record<string, string>; payload: Record<string, unknown>; url: string } {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Ollama doesn't require an auth header; others need a Bearer token.
    if (this.provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: temperature ?? 0.7,
    }

    if (stream) {
      payload.stream = true
    }

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({ type: 'function', function: t }))
    }

    const url = `${this.baseUrl}/chat/completions`
    return { headers, payload, url }
  }

  // -------------------------------------------------------------------------
  // Response parsing helpers
  // -------------------------------------------------------------------------

  private parseNextAction(content: string): {
    next_action: LLMResponse['next_action']
    next_agent: string | null
  } {
    if (content.includes('[DELIVER]')) {
      return { next_action: 'deliver', next_agent: null }
    }
    if (content.includes('[CALL:')) {
      const match = content.match(/\[CALL:(\w+)\]/)
      if (match) {
        return { next_action: 'call_agent', next_agent: match[1] }
      }
    }
    return { next_action: null, next_agent: null }
  }

  private parseToolCalls(message: Record<string, unknown>): ToolCall[] | null {
    const raw = message.tool_calls as Array<Record<string, unknown>> | undefined
    if (!raw) return null
    return raw.map(tc => {
      const fn = (tc.function as Record<string, unknown>) ?? {}
      const argsStr = (fn.arguments as string) || '{}'
      let args: Record<string, unknown>
      try {
        args = JSON.parse(argsStr)
      } catch {
        args = { raw: argsStr }
      }
      return {
        id: (tc.id as string) || '',
        name: (fn.name as string) || '',
        arguments: args,
      }
    })
  }

  // -------------------------------------------------------------------------
  // Retry with exponential backoff (Task 1a)
  // -------------------------------------------------------------------------

  /** Delegates to the shared {@link retryWithBackoff} helper. */
  private retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
    canRetry?: (error: LLMError, attempt: number) => boolean,
  ): Promise<T> {
    return retryWithBackoff(fn, context, canRetry)
  }

  // -------------------------------------------------------------------------
  // chat (non-streaming)
  // -------------------------------------------------------------------------

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const { headers, payload, url } = this.buildRequest(
      systemPrompt,
      userMessage,
      tools,
      temperature,
      false,
    )

    const doFetch = async (): Promise<LLMResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        if (!resp.ok) {
          const errorText = await resp.text()
          throw classifyHttpError(resp.status, errorText)
        }

        let data: Record<string, unknown>
        try {
          data = (await resp.json()) as Record<string, unknown>
        } catch (e) {
          throw new LLMError(`Failed to parse JSON response: ${String(e)}`, {
            kind: 'parse',
            retryable: false,
            cause: e,
          })
        }

        const choices = (data.choices as Array<Record<string, unknown>>) ?? []
        const choice = choices[0] ?? {}
        const message = (choice.message as Record<string, unknown>) ?? {}
        const usage = (data.usage as Record<string, number>) ?? {}

        this.totalTokens += usage.total_tokens ?? 0

        const toolCalls = this.parseToolCalls(message)
        const content = (message.content as string) || ''
        const { next_action, next_agent } = this.parseNextAction(content)

        return {
          content,
          tool_calls: toolCalls,
          next_action,
          next_agent,
          finish_reason: (choice.finish_reason as string) ?? 'stop',
          usage: {
            prompt_tokens: usage.prompt_tokens ?? 0,
            completion_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
          },
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    return this.retryWithBackoff(doFetch, 'chat')
  }

  // -------------------------------------------------------------------------
  // chatStream (Task 1b) — SSE streaming via fetch + ReadableStream
  // -------------------------------------------------------------------------

  async chatStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const { headers, payload, url } = this.buildRequest(
      systemPrompt,
      userMessage,
      tools,
      temperature,
      true,
    )

    // Once the stream has started emitting tokens we can no longer safely
    // retry, because a retry would duplicate the already-delivered output.
    let streamStarted = false

    const doFetch = async (): Promise<LLMResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        if (!resp.ok) {
          const errorText = await resp.text()
          throw classifyHttpError(resp.status, errorText)
        }

        if (!resp.body) {
          throw new LLMError('Streaming response has no body', {
            kind: 'parse',
            retryable: false,
          })
        }

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let finishReason = 'stop'
        let promptTokens = 0
        let completionTokens = 0
        let totalTokens = 0
        // Accumulated tool-call fragments, indexed by their SSE `index` field.
        const toolCallFrags: Array<{ id: string; name: string; args: string }> = []

        const handleSSEData = (data: string): void => {
          if (data === '[DONE]') return
          let json: unknown
          try {
            json = JSON.parse(data)
          } catch {
            return // ignore malformed lines
          }
          const obj = json as Record<string, unknown>

          // Some providers emit a final chunk with usage stats.
          const usage = obj.usage as Record<string, number> | undefined
          if (usage) {
            promptTokens = usage.prompt_tokens ?? promptTokens
            completionTokens = usage.completion_tokens ?? completionTokens
            totalTokens = usage.total_tokens ?? totalTokens
          }

          const choices = (obj.choices as Array<Record<string, unknown>>) ?? []
          const choice = choices[0]
          if (!choice) return

          const finish = choice.finish_reason as string | null | undefined
          if (finish) finishReason = finish

          const delta = (choice.delta as Record<string, unknown>) ?? undefined
          if (!delta) return

          const contentPiece = delta.content as string | undefined
          if (contentPiece) {
            fullContent += contentPiece
            streamStarted = true
            onToken(contentPiece)
          }

          const deltaToolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
          if (deltaToolCalls) {
            for (const tc of deltaToolCalls) {
              const idx = (tc.index as number) ?? 0
              const fn = (tc.function as Record<string, unknown>) ?? {}
              if (!toolCallFrags[idx]) {
                toolCallFrags[idx] = {
                  id: (tc.id as string) || '',
                  name: (fn.name as string) || '',
                  args: '',
                }
              } else {
                if (tc.id) toolCallFrags[idx].id = tc.id as string
                if (fn.name) toolCallFrags[idx].name = fn.name as string
              }
              if (fn.arguments) toolCallFrags[idx].args += fn.arguments as string
            }
            streamStarted = true
          }
        }

        // Read the SSE stream chunk by chunk, processing complete lines.

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          // Keep the trailing partial line in the buffer for the next chunk.
          buffer = lines.pop() ?? ''
          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line) continue
            if (line.startsWith('data:')) {
              handleSSEData(line.slice(5).trim())
            }
            // Other SSE fields (event:, id:, retry:, comments) are ignored.
          }
        }
        // Flush any remaining buffered content after the stream closes.
        const tail = buffer.trim()
        if (tail.startsWith('data:')) {
          handleSSEData(tail.slice(5).trim())
        }

        this.totalTokens += totalTokens

        let toolCalls: ToolCall[] | null = null
        if (toolCallFrags.length > 0) {
          toolCalls = toolCallFrags.map(f => {
            let args: Record<string, unknown>
            try {
              args = JSON.parse(f.args || '{}')
            } catch {
              args = { raw: f.args }
            }
            return { id: f.id, name: f.name, arguments: args }
          })
        }

        const { next_action, next_agent } = this.parseNextAction(fullContent)

        return {
          content: fullContent,
          tool_calls: toolCalls,
          next_action,
          next_agent,
          finish_reason: finishReason,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    return this.retryWithBackoff(doFetch, 'chatStream', err => {
      if (streamStarted) {
        log.warn('chatStream cannot retry: stream already started', { errorKind: err.kind })
        return false
      }
      return err.retryable
    })
  }

  // -------------------------------------------------------------------------
  // Multimodal (vision) chat
  // -------------------------------------------------------------------------

  /**
   * Send a text prompt plus images to a vision-capable model. Builds the
   * OpenAI-style multimodal payload:
   *
   *   messages: [{ role:'user', content: [
   *     { type:'text', text: ... },
   *     { type:'image_url', image_url: { url: '<dataUrl>' } },
   *   ]}]
   *
   * Providers that do not support vision (e.g. pure text models) will return
   * a 4xx error; the caller should catch it and fall back to local OCR.
   */
  async chatVision(
    systemPrompt: string,
    userMessage: string,
    images: { dataUrl: string }[],
    temperature?: number,
  ): Promise<LLMResponse> {
    if (images.length === 0) {
      return this.chat(systemPrompt, userMessage, undefined, temperature)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.provider !== 'ollama') {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: userMessage }]
    for (const img of images) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl } })
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      temperature: temperature ?? 0.7,
    }

    const url = `${this.baseUrl}/chat/completions`

    const doFetch = async (): Promise<LLMResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)
      let resp: Response
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
      } catch (err) {
        clearTimeout(timeout)
        throw err instanceof LLMError ? err : classifyFetchError(err)
      }
      clearTimeout(timeout)

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw classifyHttpError(resp.status, errText)
      }

      const body = (await resp.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const message = body.choices?.[0]?.message ?? {}
      const contentStr = (message.content as string) || ''
      const { next_action, next_agent } = this.parseNextAction(contentStr)
      return {
        content: contentStr,
        tool_calls: null,
        next_action,
        next_agent,
        finish_reason: 'stop',
        usage: null,
      }
    }

    return this.retryWithBackoff(doFetch, 'chatVision')
  }
}

// ---------------------------------------------------------------------------
// Anthropic Claude Client
// ---------------------------------------------------------------------------

/**
 * Anthropic Claude client (Messages API).
 *
 * Uses the `anthropic-version: 2023-06-01` header and `x-api-key` auth.
 * The system prompt is passed via the `system` field; conversation turns
 * are sent as `messages`. Tool definitions use Anthropic's `input_schema`.
 */
export class AnthropicClient implements LLMClient {
  readonly provider: string
  readonly isConfigured: boolean
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.model = config.model
    this.provider = config.provider
    this.isConfigured = !!config.apiKey
  }

  private parseNextAction(content: string): {
    next_action: LLMResponse['next_action']
    next_agent: string | null
  } {
    if (content.includes('[DELIVER]')) {
      return { next_action: 'deliver', next_agent: null }
    }
    if (content.includes('[CALL:')) {
      const match = content.match(/\[CALL:(\w+)\]/)
      if (match) {
        return { next_action: 'call_agent', next_agent: match[1] }
      }
    }
    return { next_action: null, next_agent: null }
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const url = `${this.baseUrl}/messages`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: 2048,
      temperature: temperature ?? 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }
    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        name: t.name ?? 'tool',
        description: t.description ?? '',
        input_schema:
          (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
      }))
    }

    const doFetch = async (): Promise<LLMResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!resp.ok) {
          const errorText = await resp.text()
          throw classifyHttpError(resp.status, errorText)
        }
        const data = (await resp.json()) as Record<string, unknown>
        const contentBlock = (data.content as Array<Record<string, unknown>>)?.[0]
        const content = (contentBlock?.text as string) || ''
        const { next_action, next_agent } = this.parseNextAction(content)
        const usage = (data.usage as Record<string, number>) ?? {}
        return {
          content,
          tool_calls: null,
          next_action,
          next_agent,
          finish_reason: (data.stop_reason as string) ?? 'stop',
          usage: {
            prompt_tokens: usage.input_tokens ?? 0,
            completion_tokens: usage.output_tokens ?? 0,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          },
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    return retryWithBackoff(doFetch, 'anthropic.chat')
  }

  async chatStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const result = await this.chat(systemPrompt, userMessage, tools, temperature)
    if (result.content) onToken(result.content)
    return result
  }

  async chatVision(
    systemPrompt: string,
    userMessage: string,
    images: { dataUrl: string }[],
    temperature?: number,
  ): Promise<LLMResponse> {
    if (images.length === 0) {
      return this.chat(systemPrompt, userMessage, undefined, temperature)
    }
    throw new LLMError('当前 provider 不支持图片输入，请改用支持视觉的模型或本机 OCR', {
      kind: 'client',
      retryable: false,
    })
  }
}

// ---------------------------------------------------------------------------
// Google Gemini Client
// ---------------------------------------------------------------------------

/**
 * Google Gemini client (generateContent API).
 *
 * Uses the API key as a query parameter and the native `contents` /
 * `systemInstruction` payload shape. Usage is reported via `usageMetadata`.
 */
export class GeminiClient implements LLMClient {
  readonly provider: string
  readonly isConfigured: boolean
  private apiKey: string
  private baseUrl: string
  private model: string

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.model = config.model
    this.provider = config.provider
    this.isConfigured = !!config.apiKey
  }

  private parseNextAction(content: string): {
    next_action: LLMResponse['next_action']
    next_agent: string | null
  } {
    if (content.includes('[DELIVER]')) {
      return { next_action: 'deliver', next_agent: null }
    }
    if (content.includes('[CALL:')) {
      const match = content.match(/\[CALL:(\w+)\]/)
      if (match) {
        return { next_action: 'call_agent', next_agent: match[1] }
      }
    }
    return { next_action: null, next_agent: null }
  }

  async chat(
    systemPrompt: string,
    userMessage: string,
    _tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`
    const payload: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: temperature ?? 0.7,
        maxOutputTokens: 2048,
      },
    }

    const doFetch = async (): Promise<LLMResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!resp.ok) {
          const errorText = await resp.text()
          throw classifyHttpError(resp.status, errorText)
        }
        const data = (await resp.json()) as Record<string, unknown>
        const contentBlock = (data.candidates as Array<Record<string, unknown>>)?.[0]
          ?.content as Record<string, unknown> | undefined
        const parts = (contentBlock?.parts as Array<Record<string, unknown>> | undefined) ?? []
        const content = (parts as Array<Record<string, unknown>>)
          .map(p => (p.text as string) ?? '')
          .join('')
        const { next_action, next_agent } = this.parseNextAction(content)
        const usage = (data.usageMetadata as Record<string, number>) ?? {}
        return {
          content,
          tool_calls: null,
          next_action,
          next_agent,
          finish_reason: (data.candidates as Array<Record<string, unknown>>)?.[0]
            ?.finishReason as string,
          usage: {
            prompt_tokens: usage.promptTokenCount ?? 0,
            completion_tokens: usage.candidatesTokenCount ?? 0,
            total_tokens: usage.totalTokenCount ?? 0,
          },
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    return retryWithBackoff(doFetch, 'gemini.chat')
  }

  async chatStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (token: string) => void,
    tools?: Record<string, unknown>[],
    temperature?: number,
  ): Promise<LLMResponse> {
    const result = await this.chat(systemPrompt, userMessage, tools, temperature)
    if (result.content) onToken(result.content)
    return result
  }

  async chatVision(
    systemPrompt: string,
    userMessage: string,
    images: { dataUrl: string }[],
    temperature?: number,
  ): Promise<LLMResponse> {
    if (images.length === 0) {
      return this.chat(systemPrompt, userMessage, undefined, temperature)
    }
    throw new LLMError('当前 provider 不支持图片输入，请改用支持视觉的模型或本机 OCR', {
      kind: 'client',
      retryable: false,
    })
  }
}

// ---------------------------------------------------------------------------
// Factory: create LLM client from config
// ---------------------------------------------------------------------------

export function createLLMClient(config: LLMConfig): LLMClient {
  if (config.provider === 'mock' || (!config.apiKey && config.provider !== 'ollama')) {
    return new MockLLMClient()
  }

  if (config.provider === 'ollama') {
    // Ollama exposes an OpenAI-compatible endpoint at /v1
    const ollamaConfig: LLMConfig = {
      ...config,
      // Ensure baseUrl ends with /v1 for Ollama
      baseUrl: config.baseUrl.includes('/v1')
        ? config.baseUrl
        : config.baseUrl.replace(/\/$/, '') + '/v1',
    }
    return new OpenAICompatibleClient(ollamaConfig)
  }

  if (config.provider === 'anthropic' || config.providerType === 'anthropic') {
    return new AnthropicClient(config)
  }

  if (config.provider === 'gemini' || config.providerType === 'gemini') {
    return new GeminiClient(config)
  }

  // openai_compatible — cloud API
  return new OpenAICompatibleClient(config)
}

// ---------------------------------------------------------------------------
// Preset configurations for common providers
// ---------------------------------------------------------------------------

export interface LLMPreset {
  id: string
  label: string
  provider: string
  providerType: string
  baseUrl: string
  defaultModel: string
  requiresApiKey: boolean
  helpUrl: string
  description: string
  local: boolean
}

export const LLM_PRESETS: LLMPreset[] = [
  // --- 云端：OpenAI 兼容 ---
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai_compatible',
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
    provider: 'openai_compatible',
    providerType: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-sol',
    requiresApiKey: true,
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT-5.6 Sol · 旗舰推理',
    local: false,
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    provider: 'openai_compatible',
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
    provider: 'openai_compatible',
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
    provider: 'openai_compatible',
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
    provider: 'openai_compatible',
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

  // --- 本地 ---
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    provider: 'ollama',
    providerType: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:8b',
    requiresApiKey: false,
    helpUrl: 'https://ollama.com/download',
    description: '本地运行 · 隐私优先 · 免费',
    local: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (本地)',
    provider: 'lmstudio',
    providerType: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    requiresApiKey: false,
    helpUrl: 'https://lmstudio.ai/',
    description: '本地 GGUF 模型 · OpenAI 兼容',
    local: true,
  },

  // --- 演示 ---
  {
    id: 'mock',
    label: '演示模式',
    provider: 'mock',
    providerType: 'openai-compatible',
    baseUrl: '',
    defaultModel: 'demo',
    requiresApiKey: false,
    helpUrl: '',
    description: '无需配置 · 离线演示',
    local: false,
  },
]

export function getPresetById(id: string): LLMPreset | undefined {
  return LLM_PRESETS.find(p => p.id === id)
}
