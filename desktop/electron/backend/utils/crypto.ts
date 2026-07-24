/**
 * MathWeaver API Key Encryption — P1-3
 *
 * Authenticated symmetric encryption for at-rest secrets (LLM API keys)
 * stored in electron-store. The encryption key is derived from a per-install
 * machine ID that is generated once and persisted alongside the app data.
 *
 * Algorithm: AES-256-GCM (authenticated encryption).
 *   - Key:      32 bytes, derived via scrypt(machineId, salt).
 *   - IV:       12 bytes, freshly random per encryption.
 *   - AuthTag:  16 bytes, verifies ciphertext integrity on decrypt.
 *
 * Ciphertext envelope (base64 of iv || authTag || ciphertext), prefixed with
 * a version tag so the format can evolve:
 *   "v1:<base64>"
 *
 * Backward compatibility: `decrypt()` returns values that do not carry the
 * version prefix unchanged, so existing plaintext API keys keep working
 * until they are re-saved through the settings flow (which encrypts them).
 */

import crypto from 'node:crypto'
import Store from 'electron-store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32 // 256-bit key for AES-256
const IV_LENGTH = 12 // 96-bit IV (recommended for GCM)
const AUTH_TAG_LENGTH = 16 // 128-bit authentication tag
const SALT = 'mathweaver-crypto-v1-salt'
const VERSION_PREFIX = 'v1:'
const VERSION_PREFIX_LENGTH = VERSION_PREFIX.length

// ---------------------------------------------------------------------------
// Per-install machine ID (persisted via electron-store)
// ---------------------------------------------------------------------------

interface CryptoStoreSchema {
  machineId: string
}

// A separate store file (`crypto.json`) so the machine ID is isolated from
// the main application settings and is never surfaced through the settings
// IPC handlers. No `encryptionKey` option: the machine ID itself is just a
// random UUID and is not sensitive — the secret material (API keys) is
// encrypted by this module before it ever touches storage.
const cryptoStore = new Store<CryptoStoreSchema>({
  name: 'crypto',
  defaults: {
    machineId: '',
  },
})

/**
 * Return the per-install machine ID, generating + persisting one on first use.
 * This is the seed for the encryption key.
 */
function getMachineId(): string {
  let id = cryptoStore.get('machineId')
  if (!id) {
    id = crypto.randomUUID()
    cryptoStore.set('machineId', id)
  }
  return id
}

/**
 * Derive a 32-byte AES key from the machine ID using scrypt (memory-hard KDF).
 * The salt is a fixed app constant; the per-install entropy comes from the
 * random machine ID.
 */
function deriveKey(machineId: string): Buffer {
  return crypto.scryptSync(machineId, SALT, KEY_LENGTH)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string (e.g. an LLM API key).
 * Returns an empty string for empty input.
 * Returns the versioned ciphertext envelope otherwise.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return ''

  const key = deriveKey(getMachineId())
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Pack iv || authTag || ciphertext, then base64 and version-tag.
  const combined = Buffer.concat([iv, authTag, encrypted])
  return `${VERSION_PREFIX}${combined.toString('base64')}`
}

/**
 * Decrypt a ciphertext envelope produced by `encrypt()`.
 *
 * Backward compatibility: values without the version prefix are returned
 * unchanged (treated as plaintext), so previously-stored plaintext API keys
 * continue to work until they are re-saved (and thus encrypted).
 *
 * Throws if the ciphertext is malformed or the auth tag does not verify
 * (tampering / wrong machine ID).
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ''

  // Plaintext passthrough for backward compatibility.
  if (!ciphertext.startsWith(VERSION_PREFIX)) {
    return ciphertext
  }

  const key = deriveKey(getMachineId())
  const payload = ciphertext.slice(VERSION_PREFIX_LENGTH)
  let data: Buffer
  try {
    data = Buffer.from(payload, 'base64')
  } catch {
    throw new Error('Invalid ciphertext: malformed base64 payload')
  }

  const minLen = IV_LENGTH + AUTH_TAG_LENGTH + 1
  if (data.length < minLen) {
    throw new Error(`Invalid ciphertext: expected >= ${minLen} bytes, got ${data.length}`)
  }

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return decrypted.toString('utf8')
}

/**
 * Decrypt, returning a fallback instead of throwing. Useful for defensive
 * call sites (e.g. during backend init) where a bad key should not crash
 * the app — the caller can simply prompt the user to re-enter their key.
 */
export function decryptSafe(ciphertext: string, fallback = ''): string {
  try {
    return decrypt(ciphertext)
  } catch {
    return fallback
  }
}

export default { encrypt, decrypt, decryptSafe }
