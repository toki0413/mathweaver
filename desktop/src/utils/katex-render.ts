/**
 * Shared KaTeX rendering & HTML sanitization utilities.
 *
 * Extracted from MathText.tsx and FormulaLiveEditor.tsx to eliminate
 * duplicated DOMPurify configuration, HTML escaping, and KaTeX rendering
 * logic across the two components.
 *
 * Security: All KaTeX HTML output is sanitized through DOMPurify before
 * being injected via dangerouslySetInnerHTML. This prevents XSS attacks
 * where malicious LaTeX input could inject arbitrary HTML/JS into the DOM.
 *
 * In environments without a DOM (SSR, unit tests), DOMPurify may not be
 * fully initialized, so a basic HTML escaper is used as fallback.
 */

import katex from 'katex'
import DOMPurify, { type Config } from 'dompurify'

/**
 * DOMPurify configuration: allows only KaTeX-safe HTML tags and attributes.
 *
 * KaTeX output uses: span, MathML elements, aria attributes, class, style.
 * Script/iframe/event-handler attributes are explicitly forbidden as defense
 * in depth (DOMPurify strips them by default, but we belt-and-suspenders it).
 */
export const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'span',
    'math',
    'semantics',
    'mrow',
    'mi',
    'mo',
    'mn',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'mroot',
    'msqrt',
    'mtable',
    'mtr',
    'mtd',
    'mtext',
    'mspace',
    'annotation',
    'menclose',
    'mover',
    'munder',
    'munderover',
  ],
  ALLOWED_ATTR: ['class', 'style', 'aria-hidden', 'aria-label', 'role', 'mathvariant', 'encoding'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
}

/**
 * Basic HTML escaper for SSR/test fallback.
 * In production (Electron renderer), DOMPurify sanitization is always used.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Sanitize HTML using DOMPurify if available (browser/Electron renderer).
 * Falls back to HTML escaping in Node.js/SSR/test environments.
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMPurify?.sanitize === 'function') {
    return String(DOMPurify.sanitize(html, PURIFY_CONFIG))
  }
  return escapeHtml(html)
}

/** Rendering result with optional error message. */
export interface RenderResult {
  html: string
  error: string | null
}

/**
 * Render LaTeX to sanitized HTML string.
 *
 * Uses `throwOnError: false` so KaTeX renders an inline error marker instead
 * of throwing. The returned HTML is always sanitized.
 */
export function renderTex(tex: string, displayMode: boolean): string {
  try {
    const rawHtml = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    })
    return sanitizeHtml(rawHtml)
  } catch {
    return sanitizeHtml(tex)
  }
}

/**
 * Render LaTeX to sanitized HTML with detailed error information.
 *
 * Primary render uses `throwOnError: false` (KaTeX shows red error text inline).
 * A second probe with `throwOnError: true` extracts a human-readable error
 * message for display below the preview area.
 *
 * The returned HTML is always sanitized.
 */
export function renderLatexWithErrors(latex: string, displayMode = true): RenderResult {
  const src = latex.trim()
  if (!src) return { html: '', error: null }

  let html = ''
  try {
    html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
    })
  } catch {
    return { html: '', error: '渲染失败：内部错误' }
  }

  let error: string | null = null
  try {
    katex.renderToString(latex, { throwOnError: true, displayMode })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    error = raw.replace(/^KaTeX parse error:\s*/i, '').trim() || raw
  }

  return { html: sanitizeHtml(html), error }
}
