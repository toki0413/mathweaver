/**
 * MathWeaver Environment Configuration — P1-3
 *
 * Thin, typed wrapper around process.env. Loads a .env file via dotenv when
 * present (development) and exposes functional accessors so that no other
 * module needs to touch process.env directly.
 *
 * Supported environment variables (see getLLM* helpers):
 *   - LLM_API_KEY      Cloud provider API key
 *   - LLM_BASE_URL     OpenAI-compatible endpoint base URL
 *   - LLM_MODEL        Model name
 *   - LLM_PROVIDER     'mock' | 'openai_compatible' | 'ollama'
 *   - LLM_TEMPERATURE  Sampling temperature (number)
 *   - LLM_MAX_TOKENS   Max response tokens (number)
 *   - LOG_LEVEL        Override the winston log level
 *   - NODE_ENV         'production' | 'development'
 */

import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// ---------------------------------------------------------------------------
// dotenv loader
// ---------------------------------------------------------------------------

let envLoaded = false

/**
 * Load the first available .env file via dotenv. Real environment variables
 * always take precedence over file values (dotenv does not override keys
 * that already exist on process.env).
 */
function loadEnvFile(): void {
  if (envLoaded) return
  envLoaded = true

  // Candidate locations for the .env file. The first one that exists wins.
  const candidates: string[] = [join(process.cwd(), '.env')]

  // app.getAppPath() is safe once electron is loaded; guard anyway so the
  // module never hard-fails during partial initialization.
  try {
    candidates.push(join(app.getAppPath(), '.env'))
  } catch {
    // app unavailable — skip this candidate
  }

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      dotenv.config({ path: filePath })
      return
    } catch {
      // ignore malformed files and try the next candidate
    }
  }
}

// Load once at import time.
loadEnvFile()

// ---------------------------------------------------------------------------
// Generic accessors — the only sanctioned way to read env values
// ---------------------------------------------------------------------------

/**
 * Read a string environment variable.
 * Returns `defaultValue` (or '') when unset/empty.
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    return defaultValue ?? ''
  }
  return value
}

/** Read a numeric environment variable with a safe fallback. */
export function getEnvNumber(key: string, defaultValue: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return defaultValue
  const num = Number(raw)
  return Number.isFinite(num) ? num : defaultValue
}

/** Read a boolean environment variable with a safe fallback. */
export function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return defaultValue
  const lower = raw.toLowerCase()
  return lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on'
}

// ---------------------------------------------------------------------------
// Environment mode helpers
// ---------------------------------------------------------------------------

/**
 * Whether the app is running in production mode.
 * Honors NODE_ENV first, then falls back to Electron's `app.isPackaged`.
 */
export function isProduction(): boolean {
  const nodeEnv = getEnv('NODE_ENV')
  if (nodeEnv === 'production') return true
  if (nodeEnv === 'development') return false
  try {
    return app.isPackaged
  } catch {
    return false
  }
}

/** Whether the app is running in development mode (negation of isProduction). */
export function isDevelopment(): boolean {
  return !isProduction()
}

// ---------------------------------------------------------------------------
// LLM-specific accessors
// ---------------------------------------------------------------------------

export type LLMProvider = 'mock' | 'openai_compatible' | 'ollama'

/** LLM API key for cloud providers (DeepSeek, OpenAI, etc.). */
export function getLLMApiKey(): string {
  return getEnv('LLM_API_KEY')
}

/**
 * OpenAI-compatible base URL.
 * Defaults to the DeepSeek endpoint.
 */
export function getLLMBaseUrl(): string {
  return getEnv('LLM_BASE_URL', 'https://api.deepseek.com/v1')
}

/** Model name, e.g. `deepseek-chat`, `gpt-4o`, `qwen2.5:7b`. */
export function getLLMModel(): string {
  return getEnv('LLM_MODEL', 'deepseek-chat')
}

/** Provider type. Defaults to `mock` for safe offline behavior. */
export function getLLMProvider(): LLMProvider {
  const raw = getEnv('LLM_PROVIDER', 'mock')
  if (raw === 'openai_compatible' || raw === 'ollama' || raw === 'mock') {
    return raw
  }
  return 'mock'
}

/** Sampling temperature (0.0–2.0). Defaults to 0.7. */
export function getLLMTemperature(): number {
  return getEnvNumber('LLM_TEMPERATURE', 0.7)
}

/** Maximum response tokens. Defaults to 2048. */
export function getLLMMaxTokens(): number {
  return getEnvNumber('LLM_MAX_TOKENS', 2048)
}

export default {
  getEnv,
  getEnvNumber,
  getEnvBoolean,
  isProduction,
  isDevelopment,
  getLLMApiKey,
  getLLMBaseUrl,
  getLLMModel,
  getLLMProvider,
  getLLMTemperature,
  getLLMMaxTokens,
}
