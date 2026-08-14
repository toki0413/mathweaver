import { describe, it, expect } from 'vitest'
import { encodeSharePayload, decodeSharePayload, buildShareUrl } from '../../src/utils/shareLink'

describe('shareLink', () => {
  const payload = { targetNode: 'symmetric_group', chat: [{ role: 'user', content: 'hi' }] }

  it('round-trips a payload through URL encoding', () => {
    const url = buildShareUrl(payload)
    expect(url).toContain('mathweaver://share/')
    const decoded = decodeSharePayload(url)
    expect(decoded).toEqual(payload)
  })

  it('compresses large payloads with base64url JSON', () => {
    const encoded = encodeSharePayload(payload)
    expect(typeof encoded).toBe('string')
    expect(encoded).toBeTruthy()
  })

  it('returns null for malformed input', () => {
    expect(decodeSharePayload('not-a-valid-payload!!')).toBeNull()
  })
})