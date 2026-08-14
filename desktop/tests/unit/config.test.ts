import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as fs from 'node:fs'

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/fake/app/path',
  },
}))

// Mock dotenv so we can control .env loading
vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
}))

// Mock fs.existsSync to control .env file detection
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  }
})

// Import after mocks are set up
import {
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
  hasEnvLLMConfig,
  getLLMConfigFromEnv,
} from '../../electron/backend/utils/config'

// ---------------------------------------------------------------------------
// getEnv / getEnvNumber / getEnvBoolean
// ---------------------------------------------------------------------------

describe('config — generic accessors', () => {
  beforeEach(() => {
    // Clear all env vars we care about
    delete process.env.TEST_STRING
    delete process.env.TEST_NUMBER
    delete process.env.TEST_BOOL
  })

  describe('getEnv', () => {
    it('returns the env var value when set', () => {
      process.env.TEST_STRING = 'hello'
      expect(getEnv('TEST_STRING')).toBe('hello')
    })

    it('returns default value when env var is unset', () => {
      expect(getEnv('NONEXISTENT', 'fallback')).toBe('fallback')
    })

    it('returns empty string when unset and no default', () => {
      expect(getEnv('NONEXISTENT')).toBe('')
    })

    it('returns default when env var is empty string', () => {
      process.env.TEST_STRING = ''
      expect(getEnv('TEST_STRING', 'fallback')).toBe('fallback')
    })
  })

  describe('getEnvNumber', () => {
    it('returns the numeric value when valid', () => {
      process.env.TEST_NUMBER = '42'
      expect(getEnvNumber('TEST_NUMBER', 0)).toBe(42)
    })

    it('returns negative numbers', () => {
      process.env.TEST_NUMBER = '-3.14'
      expect(getEnvNumber('TEST_NUMBER', 0)).toBe(-3.14)
    })

    it('returns default when env var is unset', () => {
      expect(getEnvNumber('NONEXISTENT', 99)).toBe(99)
    })

    it('returns default when env var is empty string', () => {
      process.env.TEST_NUMBER = ''
      expect(getEnvNumber('TEST_NUMBER', 7)).toBe(7)
    })

    it('returns default when env var is non-numeric', () => {
      process.env.TEST_NUMBER = 'not-a-number'
      expect(getEnvNumber('TEST_NUMBER', 5)).toBe(5)
    })

    it('returns default when env var is Infinity', () => {
      process.env.TEST_NUMBER = 'Infinity'
      expect(getEnvNumber('TEST_NUMBER', 1)).toBe(1)
    })

    it('returns default when env var is NaN', () => {
      process.env.TEST_NUMBER = 'NaN'
      expect(getEnvNumber('TEST_NUMBER', 1)).toBe(1)
    })
  })

  describe('getEnvBoolean', () => {
    it.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'ON'])(
      'returns true for "%s"',
      val => {
        process.env.TEST_BOOL = val
        expect(getEnvBoolean('TEST_BOOL', false)).toBe(true)
      },
    )

    it.each(['false', 'FALSE', '0', 'no', 'off', 'random'])('returns false for "%s"', val => {
      process.env.TEST_BOOL = val
      expect(getEnvBoolean('TEST_BOOL', true)).toBe(false)
    })

    it('returns default when env var is unset', () => {
      expect(getEnvBoolean('NONEXISTENT', true)).toBe(true)
      expect(getEnvBoolean('NONEXISTENT', false)).toBe(false)
    })

    it('returns default when env var is empty string', () => {
      process.env.TEST_BOOL = ''
      expect(getEnvBoolean('TEST_BOOL', true)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// isProduction / isDevelopment
// ---------------------------------------------------------------------------

describe('config — environment mode', () => {
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('isProduction returns true when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production'
    expect(isProduction()).toBe(true)
  })

  it('isProduction returns false when NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development'
    expect(isProduction()).toBe(false)
  })

  it('isDevelopment is the negation of isProduction', () => {
    process.env.NODE_ENV = 'production'
    expect(isDevelopment()).toBe(false)
    process.env.NODE_ENV = 'development'
    expect(isDevelopment()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LLM accessors
// ---------------------------------------------------------------------------

describe('config — LLM accessors', () => {
  beforeEach(() => {
    // Clean all LLM env vars
    delete process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_TEMPERATURE
    delete process.env.LLM_MAX_TOKENS
    delete process.env.MATHWEAVER_LLM_API_KEY
    delete process.env.MATHWEAVER_LLM_BASE_URL
    delete process.env.MATHWEAVER_LLM_MODEL
    delete process.env.MATHWEAVER_LLM_PROVIDER
    delete process.env.MATHWEAVER_LLM_TEMPERATURE
    delete process.env.MATHWEAVER_LLM_MAX_TOKENS
  })

  describe('getLLMApiKey', () => {
    it('returns the LLM_API_KEY value', () => {
      process.env.LLM_API_KEY = 'sk-test'
      expect(getLLMApiKey()).toBe('sk-test')
    })

    it('prefers MATHWEAVER_LLM_API_KEY over LLM_API_KEY', () => {
      process.env.LLM_API_KEY = 'short'
      process.env.MATHWEAVER_LLM_API_KEY = 'prefixed'
      expect(getLLMApiKey()).toBe('prefixed')
    })

    it('returns empty string when neither is set', () => {
      expect(getLLMApiKey()).toBe('')
    })
  })

  describe('getLLMBaseUrl', () => {
    it('defaults to OpenAI-compatible endpoint', () => {
      expect(getLLMBaseUrl()).toBe('https://api.openai.com/v1')
    })

    it('returns configured value', () => {
      process.env.LLM_BASE_URL = 'https://api.openai.com/v1'
      expect(getLLMBaseUrl()).toBe('https://api.openai.com/v1')
    })

    it('prefers MATHWEAVER_ prefix', () => {
      process.env.LLM_BASE_URL = 'https://short.com'
      process.env.MATHWEAVER_LLM_BASE_URL = 'https://prefixed.com'
      expect(getLLMBaseUrl()).toBe('https://prefixed.com')
    })
  })

  describe('getLLMModel', () => {
    it('defaults to gpt-4o-mini', () => {
      expect(getLLMModel()).toBe('gpt-4o-mini')
    })

    it('returns configured model', () => {
      process.env.LLM_MODEL = 'gpt-4o'
      expect(getLLMModel()).toBe('gpt-4o')
    })
  })

  describe('getLLMProvider', () => {
    it('defaults to mock', () => {
      expect(getLLMProvider()).toBe('mock')
    })

    it('returns openai_compatible when set', () => {
      process.env.LLM_PROVIDER = 'openai_compatible'
      expect(getLLMProvider()).toBe('openai_compatible')
    })

    it('returns ollama when set', () => {
      process.env.LLM_PROVIDER = 'ollama'
      expect(getLLMProvider()).toBe('ollama')
    })

    it('returns mock for unknown values', () => {
      process.env.LLM_PROVIDER = 'something-invalid'
      expect(getLLMProvider()).toBe('mock')
    })

    it('prefers MATHWEAVER_ prefix', () => {
      process.env.LLM_PROVIDER = 'mock'
      process.env.MATHWEAVER_LLM_PROVIDER = 'ollama'
      expect(getLLMProvider()).toBe('ollama')
    })
  })

  describe('getLLMTemperature', () => {
    it('defaults to 0.7', () => {
      expect(getLLMTemperature()).toBe(0.7)
    })

    it('returns configured value', () => {
      process.env.LLM_TEMPERATURE = '0.2'
      expect(getLLMTemperature()).toBe(0.2)
    })

    it('returns default for invalid value', () => {
      process.env.LLM_TEMPERATURE = 'hot'
      expect(getLLMTemperature()).toBe(0.7)
    })
  })

  describe('getLLMMaxTokens', () => {
    it('defaults to 2048', () => {
      expect(getLLMMaxTokens()).toBe(2048)
    })

    it('returns configured value', () => {
      process.env.LLM_MAX_TOKENS = '8192'
      expect(getLLMMaxTokens()).toBe(8192)
    })
  })
})

// ---------------------------------------------------------------------------
// hasEnvLLMConfig / getLLMConfigFromEnv
// ---------------------------------------------------------------------------

describe('config — hasEnvLLMConfig', () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
    delete process.env.LLM_PROVIDER
    delete process.env.MATHWEAVER_LLM_API_KEY
    delete process.env.MATHWEAVER_LLM_PROVIDER
  })

  it('returns false when no LLM env vars are set', () => {
    expect(hasEnvLLMConfig()).toBe(false)
  })

  it('returns true when LLM_API_KEY is set', () => {
    process.env.LLM_API_KEY = 'sk-test'
    expect(hasEnvLLMConfig()).toBe(true)
  })

  it('returns true when LLM_PROVIDER is not mock', () => {
    process.env.LLM_PROVIDER = 'openai_compatible'
    expect(hasEnvLLMConfig()).toBe(true)
  })

  it('returns false when LLM_PROVIDER is mock and no API key', () => {
    process.env.LLM_PROVIDER = 'mock'
    expect(hasEnvLLMConfig()).toBe(false)
  })
})

describe('config — getLLMConfigFromEnv', () => {
  beforeEach(() => {
    delete process.env.LLM_API_KEY
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_BASE_URL
    delete process.env.LLM_MODEL
    delete process.env.LLM_TEMPERATURE
    delete process.env.LLM_MAX_TOKENS
    delete process.env.MATHWEAVER_LLM_API_KEY
    delete process.env.MATHWEAVER_LLM_PROVIDER
  })

  it('returns null when no env config is present', () => {
    expect(getLLMConfigFromEnv()).toBeNull()
  })

  it('returns full LLMConfig when env vars are set', () => {
    process.env.LLM_API_KEY = 'sk-test-key'
    process.env.LLM_PROVIDER = 'openai_compatible'
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1'
    process.env.LLM_MODEL = 'gpt-4o'
    process.env.LLM_TEMPERATURE = '0.5'
    process.env.LLM_MAX_TOKENS = '4096'

    const config = getLLMConfigFromEnv()
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai_compatible')
    expect(config!.apiKey).toBe('sk-test-key')
    expect(config!.baseUrl).toBe('https://api.openai.com/v1')
    expect(config!.model).toBe('gpt-4o')
    expect(config!.temperature).toBe(0.5)
    expect(config!.maxTokens).toBe(4096)
  })

  it('uses default values for unset optional fields', () => {
    process.env.LLM_API_KEY = 'sk-minimal'
    process.env.LLM_PROVIDER = 'openai_compatible'

    const config = getLLMConfigFromEnv()
    expect(config).not.toBeNull()
    expect(config!.apiKey).toBe('sk-minimal')
    expect(config!.baseUrl).toBe('https://api.openai.com/v1')
    expect(config!.model).toBe('gpt-4o-mini')
    expect(config!.temperature).toBe(0.7)
    expect(config!.maxTokens).toBe(2048)
  })
})
