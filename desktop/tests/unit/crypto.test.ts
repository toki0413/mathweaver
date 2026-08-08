import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron-store before importing crypto.ts
const mockStore: Record<string, unknown> = {}
vi.mock('electron-store', () => {
  return {
    default: class FakeStore {
      get(key: string): unknown {
        return mockStore[key]
      }
      set(key: string, value: unknown): void {
        mockStore[key] = value
      }
    },
  }
})

// Import after mock is set up
import { encrypt, decrypt, decryptSafe } from '../../electron/backend/utils/crypto'

// ---------------------------------------------------------------------------
// encrypt / decrypt round-trip
// ---------------------------------------------------------------------------

describe('crypto — encrypt/decrypt', () => {
  beforeEach(() => {
    // Reset the mock store; the first call to getMachineId() will generate a new UUID
    delete mockStore['machineId']
  })

  it('encrypt returns empty string for empty input', () => {
    expect(encrypt('')).toBe('')
  })

  it('encrypt returns versioned ciphertext for non-empty input', () => {
    const ciphertext = encrypt('sk-test-api-key')
    expect(ciphertext).toMatch(/^v1:/)
    expect(ciphertext).not.toContain('sk-test-api-key')
  })

  it('decrypt returns empty string for empty input', () => {
    expect(decrypt('')).toBe('')
  })

  it('decrypt round-trips encrypt output correctly', () => {
    const plaintext = 'my-secret-api-key-12345'
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('decrypt round-trips with unicode content', () => {
    const plaintext = '密钥🔑安全'
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('decrypt round-trips with long content', () => {
    const plaintext = 'x'.repeat(1000)
    const ciphertext = encrypt(plaintext)
    expect(decrypt(ciphertext)).toBe(plaintext)
  })

  it('each encryption produces different ciphertext (random IV)', () => {
    const c1 = encrypt('same-plaintext')
    const c2 = encrypt('same-plaintext')
    // Different IV → different ciphertext (extremely unlikely to collide)
    expect(c1).not.toBe(c2)
    // But both decrypt to the same value
    expect(decrypt(c1)).toBe('same-plaintext')
    expect(decrypt(c2)).toBe('same-plaintext')
  })
})

// ---------------------------------------------------------------------------
// decrypt — backward compatibility (plaintext passthrough)
// ---------------------------------------------------------------------------

describe('crypto — backward compatibility', () => {
  beforeEach(() => {
    delete mockStore['machineId']
  })

  it('decrypt returns plaintext for values without version prefix', () => {
    expect(decrypt('sk-plain-api-key')).toBe('sk-plain-api-key')
  })

  it('decrypt returns plaintext for values that look like base64 but have no v1: prefix', () => {
    const plain = 'aGVsbG8='
    expect(decrypt(plain)).toBe('aGVsbG8=')
  })
})

// ---------------------------------------------------------------------------
// decrypt — error handling
// ---------------------------------------------------------------------------

describe('crypto — error handling', () => {
  beforeEach(() => {
    delete mockStore['machineId']
  })

  it('decrypt throws on tampered ciphertext', () => {
    const ciphertext = encrypt('secret')
    // Tamper with the base64 payload (flip a character)
    const tampered = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === 'AA' ? 'BB' : 'AA')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('decrypt throws on truncated ciphertext', () => {
    // Valid prefix but too short (iv=12 + authtag=16 + at least 1 byte = 29 bytes minimum)
    const short = 'v1:' + Buffer.from('short').toString('base64')
    expect(() => decrypt(short)).toThrow(/expected >= \d+ bytes/)
  })

  it('decrypt throws on invalid base64', () => {
    // The payload is not valid base64 — Buffer.from will produce empty/partial data
    // which will fail the length check or the GCM auth check
    const bad = 'v1:!!!not-base64!!!'
    expect(() => decrypt(bad)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// decryptSafe
// ---------------------------------------------------------------------------

describe('crypto — decryptSafe', () => {
  beforeEach(() => {
    delete mockStore['machineId']
  })

  it('returns decrypted value for valid ciphertext', () => {
    const plaintext = 'safe-secret-key'
    const ciphertext = encrypt(plaintext)
    expect(decryptSafe(ciphertext)).toBe(plaintext)
  })

  it('returns fallback for invalid ciphertext', () => {
    const bad = 'v1:!!!invalid!!!'
    expect(decryptSafe(bad, 'fallback')).toBe('fallback')
  })

  it('returns empty string as default fallback', () => {
    const bad = 'v1:!!!invalid!!!'
    expect(decryptSafe(bad)).toBe('')
  })

  it('returns plaintext for values without version prefix', () => {
    expect(decryptSafe('plain-key')).toBe('plain-key')
  })

  it('returns empty string for empty input', () => {
    expect(decryptSafe('')).toBe('')
  })

  it('returns fallback for empty input when fallback provided', () => {
    expect(decryptSafe('', 'default')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Machine ID persistence
// ---------------------------------------------------------------------------

describe('crypto — machine ID persistence', () => {
  it('generates and persists machine ID on first use', () => {
    delete mockStore['machineId']
    encrypt('test')
    // After first encrypt, machineId should be set
    expect(mockStore['machineId']).toBeTruthy()
    expect(typeof mockStore['machineId']).toBe('string')
  })

  it('reuses existing machine ID across calls', () => {
    delete mockStore['machineId']
    // First encryption generates a machine ID
    const c1 = encrypt('secret1')
    const firstMachineId = mockStore['machineId']

    // Second encryption should reuse the same machine ID
    const c2 = encrypt('secret2')
    expect(mockStore['machineId']).toBe(firstMachineId)

    // Both should decrypt correctly
    expect(decrypt(c1)).toBe('secret1')
    expect(decrypt(c2)).toBe('secret2')
  })

  it('decrypt fails if machine ID changes (different encryption key)', () => {
    delete mockStore['machineId']
    const ciphertext = encrypt('secret-data')

    // Simulate a new machine ID (e.g., different install)
    delete mockStore['machineId']

    // decrypt should fail because the key is now different
    expect(() => decrypt(ciphertext)).toThrow()
  })
})
