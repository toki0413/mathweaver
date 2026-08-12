import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ttsSystem } from '@/utils/tts'

// ---------------------------------------------------------------------------
// speechSynthesis mock — jsdom does not implement it, so we install a minimal
// stub that records speak/cancel calls and exposes a couple of voices.
// ---------------------------------------------------------------------------

function installSpeechMock() {
  const speak = vi.fn()
  const cancel = vi.fn()
  const getVoices = vi.fn(() => [
    { lang: 'zh-CN', name: 'Ting-Ting', localService: true, default: false, voiceURI: 'builtin' },
    { lang: 'en-US', name: 'Samantha', localService: true, default: false, voiceURI: 'builtin' },
  ])

  // Mock the global SpeechSynthesisUtterance constructor
  const SpeechSynthesisUtteranceMock = vi.fn(function (
    this: Record<string, unknown>,
    text: string,
  ) {
    this.text = text
    this.lang = ''
    this.volume = 0
    this.rate = 0
    this.pitch = 0
    this.voice = null
  })

  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak, cancel, getVoices },
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: SpeechSynthesisUtteranceMock,
  })

  return { speak, cancel, UtteranceMock: SpeechSynthesisUtteranceMock }
}

describe('ttsSystem', () => {
  let mocks: ReturnType<typeof installSpeechMock>

  beforeEach(() => {
    ttsSystem.setEnabled(true)
    ttsSystem.setVolume(1)
    mocks = installSpeechMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports supported when speechSynthesis exists', () => {
    expect(ttsSystem.supported).toBe(true)
  })

  it('speak() creates an utterance with the right language and voice', () => {
    const ok = ttsSystem.speak('你好', { language: 'zh-CN' })
    expect(ok).toBe(true)
    expect(mocks.speak).toHaveBeenCalledTimes(1)
    const utterance = mocks.speak.mock.calls[0][0] as SpeechSynthesisUtterance
    expect(utterance.lang).toBe('zh-CN')
    expect(utterance.voice).not.toBeNull()
  })

  it('speak() returns false when disabled', () => {
    ttsSystem.setEnabled(false)
    expect(ttsSystem.speak('hi')).toBe(false)
    expect(mocks.speak).not.toHaveBeenCalled()
  })

  it('speak() returns false for empty/whitespace text', () => {
    expect(ttsSystem.speak('   ')).toBe(false)
    expect(ttsSystem.speak('')).toBe(false)
  })

  it('stop() cancels the current utterance', () => {
    ttsSystem.stop()
    expect(mocks.cancel).toHaveBeenCalled()
  })

  it('disabling stops current speech', () => {
    ttsSystem.setEnabled(false)
    expect(mocks.cancel).toHaveBeenCalled()
  })
})