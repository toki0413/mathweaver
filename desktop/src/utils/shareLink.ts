/**
 * Build a shareable URL / payload for a MathWeaver session snapshot.
 *
 * Strategy: encode the compact JSON payload into a base64url string and embed
 * it as the query fragment of a `mathweaver://share/` deep link. On the web
 * build the same payload is used to populate a share modal.
 */

export interface SharePayload {
  targetNode: string
  chat: Array<{ role: string; content: string }>
  visualData?: Record<string, unknown> | null
  savedAt?: string
}

function toBase64Url(s: string): string {
  return btoa(encodeURIComponent(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  return decodeURIComponent(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad))
}

export function encodeSharePayload(payload: SharePayload): string {
  return toBase64Url(JSON.stringify(payload))
}

export function decodeSharePayload(urlOrEncoded: string): SharePayload | null {
  try {
    const raw = urlOrEncoded.includes('://')
      ? (urlOrEncoded.split('share/')[1] ?? '')
      : urlOrEncoded
    const json = fromBase64Url(raw)
    return JSON.parse(json) as SharePayload
  } catch {
    return null
  }
}

export function buildShareUrl(payload: SharePayload): string {
  return `mathweaver://share/${encodeSharePayload(payload)}`
}
