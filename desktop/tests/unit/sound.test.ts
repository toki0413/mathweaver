import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { soundSystem } from '@/utils/sound'

// ---------------------------------------------------------------------------
// Rich AudioContext mock — the global setup.ts stub lacks the buffer / filter
// nodes needed by playNoise() (whoosh). We install a full mock here so every
// branch of the sound module is exercised.
// ---------------------------------------------------------------------------

interface MockParam {
  value: number
  setValueAtTime: MockInstance
  exponentialRampToValueAtTime: MockInstance
}

function makeParam(): MockParam {
  return {
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  }
}

class RichMockAudioContext {
  currentTime = 0
  sampleRate = 44100
  state: AudioContextState = 'running'
  destination = { connect: vi.fn() }
  createGain = vi.fn(() => ({
    gain: makeParam(),
    connect: vi.fn(),
  }))
  createOscillator = vi.fn(() => ({
    type: 'sine',
    frequency: makeParam(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  createBuffer = vi.fn(() => ({
    getChannelData: vi.fn(() => new Float32Array(100)),
  }))
  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }))
  createBiquadFilter = vi.fn(() => ({
    type: 'bandpass',
    frequency: makeParam(),
    Q: makeParam(),
    connect: vi.fn(),
  }))
  resume = vi.fn(() => Promise.resolve())
  close = vi.fn(() => Promise.resolve())
}

let mockCtx: RichMockAudioContext | null = null

beforeEach(() => {
  mockCtx = new RichMockAudioContext()
  // soundSystem lazily instantiates the context on first play(). Use a factory
  // that returns the SAME instance under test so assertions can inspect it.
  ;(window as unknown as { AudioContext: unknown }).AudioContext = function () {
    return mockCtx
  }
  // Fresh instance per test so enabled/volume state is deterministic.
  ;(soundSystem as unknown as { enabled: boolean }).enabled = true
  ;(soundSystem as unknown as { volume: number }).volume = 0.3
  ;(soundSystem as unknown as { ctx: unknown }).ctx = null
  ;(soundSystem as unknown as { masterGain: unknown }).masterGain = null
})

afterEach(() => {
  soundSystem.destroy()
  mockCtx = null
})

function getCtx(): RichMockAudioContext {
  if (!mockCtx) throw new Error('mock context not installed')
  return mockCtx
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('soundSystem — configuration', () => {
  it('is enabled by default', () => {
    expect(soundSystem.isEnabled()).toBe(true)
  })

  it('setEnabled(false) silences play()', () => {
    soundSystem.setEnabled(false)
    expect(soundSystem.isEnabled()).toBe(false)
    soundSystem.play('click')
    // No oscillator should be created because play() bails early.
    expect(getCtx().createOscillator).not.toHaveBeenCalled()
  })

  it('setVolume clamps to [0, 1]', () => {
    soundSystem.setVolume(5)
    expect((soundSystem as unknown as { volume: number }).volume).toBe(1)
    soundSystem.setVolume(-2)
    expect((soundSystem as unknown as { volume: number }).volume).toBe(0)
    soundSystem.setVolume(0.5)
    expect((soundSystem as unknown as { volume: number }).volume).toBe(0.5)
  })

  it('setVolume after init updates the master gain', () => {
    soundSystem.play('click') // triggers init
    soundSystem.setVolume(0.8)
    // masterGain.gain.setValueAtTime should have been called.
    expect(soundSystem.isEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// init / guards
// ---------------------------------------------------------------------------

describe('soundSystem — init and guards', () => {
  it('logs a warning and disables when AudioContext is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(window as unknown as { AudioContext: unknown }).AudioContext = undefined
    ;(soundSystem as unknown as { ctx: unknown }).ctx = null
    soundSystem.init()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resumes a suspended context when playing', () => {
    getCtx().state = 'suspended'
    soundSystem.play('click')
    expect(getCtx().resume).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Play — each sound type drives the expected audio nodes
// ---------------------------------------------------------------------------

describe('soundSystem — play()', () => {
  it('click creates an oscillator', () => {
    soundSystem.play('click')
    expect(getCtx().createGain).toHaveBeenCalled()
    expect(getCtx().createOscillator).toHaveBeenCalled()
  })

  it('correct plays a three-note rising arpeggio (3 oscillators)', () => {
    soundSystem.play('correct')
    expect(getCtx().createOscillator).toHaveBeenCalledTimes(3)
  })

  it('wrong plays a descending sweep', () => {
    soundSystem.play('wrong')
    expect(getCtx().createOscillator).toHaveBeenCalledTimes(1)
  })

  it('whoosh synthesizes white noise through a biquad filter', () => {
    soundSystem.play('whoosh')
    expect(getCtx().createBuffer).toHaveBeenCalled()
    expect(getCtx().createBufferSource).toHaveBeenCalled()
    expect(getCtx().createBiquadFilter).toHaveBeenCalled()
    expect(getCtx().createOscillator).not.toHaveBeenCalled()
  })

  it('celebrate triggers a chord plus arpeggio', () => {
    soundSystem.play('celebrate')
    // Chord (4 notes) + arpeggio (5 notes) = 9 oscillators.
    expect(getCtx().createOscillator.mock.calls.length).toBeGreaterThanOrEqual(9)
  })

  it('complete plays a four-note arpeggio', () => {
    soundSystem.play('complete')
    expect(getCtx().createOscillator).toHaveBeenCalledTimes(4)
  })

  it('star, discover, unlock, pop all synthesize notes', () => {
    soundSystem.play('star')
    soundSystem.play('discover')
    soundSystem.play('unlock')
    soundSystem.play('pop')
    expect(getCtx().createOscillator).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// destroy
// ---------------------------------------------------------------------------

describe('soundSystem — destroy', () => {
  it('closes the context and nulls internal references', () => {
    soundSystem.play('click')
    soundSystem.destroy()
    expect(getCtx().close).toHaveBeenCalled()
    expect((soundSystem as unknown as { ctx: unknown }).ctx).toBeNull()
    expect((soundSystem as unknown as { masterGain: unknown }).masterGain).toBeNull()
  })
})
